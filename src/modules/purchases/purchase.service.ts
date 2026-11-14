"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import { formatErrorMessage } from "@/lib/utils";
import {
  CreatePurchaseInput,
  CreatePurchaseSchema,
  PurchaseRecord,
  ReceivePurchaseItemsInput,
  ReceivePurchaseItemsSchema,
  SupplierPaymentInput,
  SupplierPaymentRecord,
  SupplierPaymentSchema,
} from "./purchase.schema";

/**
 * Retrieve purchases history directly from public.purchases and public.purchase_items
 * Zero mock purchases
 */
export async function getPurchases(params?: {
  supplierId?: string;
  status?: PurchaseRecord["status"];
}): Promise<ActionResponse<PurchaseRecord[]>> {
  try {
    const supabase = await createClient();

    let query = supabase
      .from("purchases")
      .select(`
        id,
        po_number,
        supplier_id,
        invoice_number,
        status,
        payment_status,
        subtotal,
        tax_total,
        total_amount,
        amount_paid,
        balance_due,
        purchase_date,
        received_at,
        notes,
        created_at,
        supplier:suppliers(name),
        items:purchase_items(
          id,
          product_id,
          quantity_ordered,
          quantity_received,
          unit_cost,
          gst_rate,
          tax_rate,
          tax_amount,
          total_cost,
          total_amount,
          product:products(name)
        )
      `)
      .order("created_at", { ascending: false });

    if (params?.supplierId) {
      query = query.eq("supplier_id", params.supplierId);
    }
    if (params?.status) {
      query = query.eq("status", params.status);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    interface PurchaseQueryItem {
      id?: string;
      product_id: string;
      quantity_ordered: number | string;
      quantity_received?: number | string | null;
      unit_cost: number | string;
      gst_rate?: number | string | null;
      tax_rate?: number | string | null;
      tax_amount: number | string;
      total_cost?: number | string | null;
      total_amount?: number | string | null;
      product?: { name: string } | null;
    }

    interface PurchaseQueryRow {
      id: string;
      po_number?: string | null;
      supplier_id: string;
      invoice_number?: string | null;
      status: PurchaseRecord["status"];
      payment_status: PurchaseRecord["payment_status"];
      subtotal: number | string;
      tax_total: number | string;
      total_amount: number | string;
      amount_paid: number | string;
      balance_due: number | string;
      purchase_date: string;
      received_at?: string | null;
      notes?: string | null;
      created_at: string;
      supplier?: { name: string } | null;
      items?: PurchaseQueryItem[] | null;
    }

    const purchases: PurchaseRecord[] = ((data || []) as unknown as PurchaseQueryRow[]).map((row) => ({
      id: row.id,
      po_number: row.po_number || `PO-${row.id.slice(0, 8)}`,
      supplier_id: row.supplier_id,
      supplier_name: row.supplier?.name || "Supplier",
      invoice_number: row.invoice_number,
      status: row.status,
      payment_status: row.payment_status,
      subtotal: Number(row.subtotal),
      tax_total: Number(row.tax_total),
      total_amount: Number(row.total_amount),
      amount_paid: Number(row.amount_paid),
      balance_due: Number(row.balance_due),
      purchase_date: row.purchase_date,
      received_at: row.received_at,
      notes: row.notes,
      created_at: row.created_at,
      items: (row.items || []).map((item) => {
        const rate = Number(item.gst_rate ?? item.tax_rate ?? 0);
        const cost = Number(item.total_cost ?? item.total_amount ?? 0);
        return {
          id: item.id,
          product_id: item.product_id,
          product_name: item.product?.name,
          quantity_ordered: Number(item.quantity_ordered),
          quantity_received: Number(item.quantity_received || 0),
          unit_cost: Number(item.unit_cost),
          gst_rate: rate,
          tax_rate: rate,
          tax_amount: Number(item.tax_amount),
          total_cost: cost,
          total_amount: cost,
        };
      }),
    }));

    return { success: true, data: purchases };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve purchases.";
    return { success: false, error: message };
  }
}

/**
 * Create a new purchase order (DRAFT or ORDERED)
 * Calls atomic PostgreSQL RPC rpc_create_purchase_order:
 * Inserts header and all line items atomically in one database transaction
 */
export async function createPurchase(
  input: CreatePurchaseInput
): Promise<ActionResponse<PurchaseRecord>> {
  try {
    const validated = CreatePurchaseSchema.parse(input);
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to create purchase orders." };
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc("rpc_create_purchase_order", {
      p_supplier_id: validated.supplier_id,
      p_purchase_date: validated.purchase_date,
      p_invoice_number: validated.invoice_number || null,
      p_status: validated.status || "ORDERED",
      p_items: validated.items.map((item) => ({
        product_id: item.product_id,
        quantity_ordered: item.quantity_ordered,
        unit_cost: item.unit_cost,
        gst_rate: item.gst_rate ?? item.tax_rate ?? 0,
      })),
      p_notes: validated.notes || null,
      p_po_number: validated.po_number || null,
    });

    let rpcPurchaseId = rpcResult?.purchase_id;
    let rpcPoNumber = rpcResult?.po_number;

    if (rpcError) {
      const isMissingRpc =
        rpcError.message?.includes("Could not find the function") ||
        rpcError.message?.includes("does not exist") ||
        (rpcError as { code?: string }).code === "PGRST202";

      if (isMissingRpc && typeof supabase.from === "function") {
        console.warn("RPC rpc_create_purchase_order not found, falling back to direct table insertion:", rpcError.message);
        let calcSubtotal = 0;
        let calcTaxTotal = 0;
        validated.items.forEach((item) => {
          calcSubtotal += item.unit_cost * item.quantity_ordered;
          calcTaxTotal += item.tax_amount;
        });
        const calcTotal = calcSubtotal + calcTaxTotal;
        const genPoNum = validated.po_number || `PO-${validated.purchase_date.replace(/-/g, "")}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        const { data: directPo, error: directPoErr } = await supabase
          .from("purchases")
          .insert({
            po_number: genPoNum,
            supplier_id: validated.supplier_id,
            invoice_number: validated.invoice_number || null,
            status: validated.status || "ORDERED",
            payment_status: "UNPAID",
            subtotal: calcSubtotal,
            tax_total: calcTaxTotal,
            total_amount: calcTotal,
            amount_paid: 0.00,
            balance_due: calcTotal,
            purchase_date: validated.purchase_date,
            notes: validated.notes || null,
            created_by: user.id,
          })
          .select("id, po_number")
          .single();

        if (directPo && !directPoErr) {
          rpcPurchaseId = directPo.id;
          rpcPoNumber = directPo.po_number;

          // Insert purchase_items
          for (const item of validated.items) {
            const itemLineTotal = (item.unit_cost * item.quantity_ordered) + item.tax_amount;
            await supabase.from("purchase_items").insert({
              purchase_id: directPo.id,
              product_id: item.product_id,
              quantity_ordered: item.quantity_ordered,
              quantity_received: 0,
              unit_cost: item.unit_cost,
              tax_rate: item.gst_rate ?? item.tax_rate ?? 0,
              tax_amount: item.tax_amount,
              total_cost: itemLineTotal,
              total_amount: itemLineTotal,
              gst_rate: item.gst_rate ?? item.tax_rate ?? 0,
            });
          }
        } else {
          return { success: false, error: rpcError.message || directPoErr?.message || "Failed to create purchase order." };
        }
      } else {
        return { success: false, error: rpcError.message };
      }
    }

    let subtotal = 0;
    let taxTotal = 0;
    validated.items.forEach((item) => {
      subtotal += item.unit_cost * item.quantity_ordered;
      taxTotal += item.tax_amount;
    });
    const totalAmount = Number(rpcResult?.total_amount ?? (subtotal + taxTotal));

    const record: PurchaseRecord = {
      id: rpcPurchaseId || "PO-PENDING",
      po_number: rpcPoNumber || "PO-PENDING",
      supplier_id: validated.supplier_id,
      invoice_number: validated.invoice_number,
      status: rpcResult?.status || validated.status,
      payment_status: "UNPAID",
      subtotal,
      tax_total: taxTotal,
      total_amount: totalAmount,
      amount_paid: 0,
      balance_due: totalAmount,
      purchase_date: validated.purchase_date,
      items: validated.items,
      notes: validated.notes,
      created_at: new Date().toISOString(),
    };

    return { success: true, data: record };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to create purchase order.");
    return { success: false, error: message };
  }
}

/**
 * Receive goods at warehouse (Partial or Full Goods Receipt)
 * Calls atomic PostgreSQL RPC rpc_receive_purchase_order with row-locking
 */
export async function markPurchaseReceived(
  input: string | ReceivePurchaseItemsInput
): Promise<ActionResponse<{ received: boolean; status: string; incrementalPayable: number }>> {
  try {
    const supabase = await createClient();

    let purchaseId: string;
    let receivedItemsPayload: Array<{ product_id: string; quantity_received: number }> | null = null;

    if (typeof input === "string") {
      purchaseId = input;
    } else {
      const validated = ReceivePurchaseItemsSchema.parse(input);
      purchaseId = validated.purchase_id;
      receivedItemsPayload = validated.items || null;
    }

    const { data, error } = await supabase.rpc("rpc_receive_purchase_order", {
      p_purchase_id: purchaseId,
      p_received_items: receivedItemsPayload,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        received: data?.status === "RECEIVED" || data?.status === "PARTIALLY_RECEIVED",
        status: data?.status || "RECEIVED",
        incrementalPayable: Number(data?.incremental_payable || 0),
      },
    };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to receive goods.");
    return { success: false, error: message };
  }
}

/**
 * Record payment to supplier (Cash, UPI, Bank Transfer)
 * Calls atomic PostgreSQL RPC rpc_record_supplier_payment:
 * Atomically inserts payment, updates supplier payable, updates PO balance,
 * and posts balanced double-entry to the financial ledger.
 */
export async function recordSupplierPayment(
  input: SupplierPaymentInput
): Promise<ActionResponse<SupplierPaymentRecord>> {
  try {
    const validated = SupplierPaymentSchema.parse(input);
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to record payments." };
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc("rpc_record_supplier_payment", {
      p_supplier_id: validated.supplier_id,
      p_purchase_id: validated.purchase_id || null,
      p_amount: validated.amount,
      p_payment_method: validated.payment_method,
      p_payment_date: validated.payment_date,
      p_reference_number: validated.reference_number || null,
      p_notes: validated.notes || null,
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    const { data: supplier } = await supabase
      .from("suppliers")
      .select("name")
      .eq("id", validated.supplier_id)
      .single();

    const paymentRecord: SupplierPaymentRecord = {
      id: rpcResult.payment_id,
      payment_number: rpcResult.payment_number,
      supplier_id: validated.supplier_id,
      supplier_name: supplier?.name || "Supplier",
      purchase_id: validated.purchase_id,
      amount: validated.amount,
      payment_method: validated.payment_method,
      payment_date: validated.payment_date,
      reference_number: validated.reference_number,
      notes: validated.notes,
      created_at: new Date().toISOString(),
    };

    return { success: true, data: paymentRecord };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to record supplier payment.");
    return { success: false, error: message };
  }
}

/**
 * Retrieve a single purchase order by ID with line items
 */
export async function getPurchaseById(id: string): Promise<ActionResponse<PurchaseRecord>> {
  try {
    const res = await getPurchases();
    if (!res.success || !res.data) {
      return { success: false, error: res.error || "Failed to load purchase." };
    }
    const found = res.data.find((p) => p.id === id);
    if (!found) {
      return { success: false, error: `Purchase ${id} not found.` };
    }
    return { success: true, data: found };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve purchase.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve supplier payments with optional filtering by supplier or purchase
 */
export async function getSupplierPayments(params?: {
  supplierId?: string;
  purchaseId?: string;
}): Promise<ActionResponse<SupplierPaymentRecord[]>> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("supplier_payments")
      .select(`
        id,
        payment_number,
        supplier_id,
        purchase_id,
        amount,
        payment_method,
        payment_date,
        reference_number,
        notes,
        created_at,
        supplier:suppliers(name)
      `)
      .order("payment_date", { ascending: false });

    if (params?.supplierId) {
      query = query.eq("supplier_id", params.supplierId);
    }
    if (params?.purchaseId) {
      query = query.eq("purchase_id", params.purchaseId);
    }

    const { data, error } = await query;
    if (error) {
      return { success: false, error: error.message };
    }

    interface SupplierPaymentRow {
      id: string;
      payment_number: string;
      supplier_id: string;
      purchase_id?: string | null;
      amount: number | string;
      payment_method: SupplierPaymentRecord["payment_method"];
      payment_date: string;
      reference_number?: string | null;
      notes?: string | null;
      created_at: string;
      supplier?: { name: string } | null;
    }

    const payments: SupplierPaymentRecord[] = ((data || []) as unknown as SupplierPaymentRow[]).map((row) => ({
      id: row.id,
      payment_number: row.payment_number,
      supplier_id: row.supplier_id,
      supplier_name: row.supplier?.name || "Supplier",
      purchase_id: row.purchase_id,
      amount: Number(row.amount),
      payment_method: row.payment_method,
      payment_date: row.payment_date,
      reference_number: row.reference_number,
      notes: row.notes,
      created_at: row.created_at,
    }));

    return { success: true, data: payments };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve supplier payments.";
    return { success: false, error: message };
  }
}

