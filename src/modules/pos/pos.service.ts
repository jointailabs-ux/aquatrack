"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import {
  CompletePosSaleInput,
  CompletePosSaleSchema,
  PosSaleRecord,
} from "./pos.schema";

/**
 * Complete a walk-in counter POS sale
 * Atomically executes PostgreSQL RPC rpc_complete_pos_sale:
 * 1. Validates and calculates prices/taxes strictly on the server from products table
 * 2. Locks inventory balances FOR UPDATE and rejects insufficient stock
 * 3. Decrements inventory automatically
 * 4. Records cash or UPI collection
 * 5. Enforces idempotency
 * 6. Posts balanced double-entry to financial ledger
 */
export async function completePosSale(
  input: CompletePosSaleInput
): Promise<ActionResponse<PosSaleRecord>> {
  try {
    const validated = CompletePosSaleSchema.parse(input);
    const supabase = await createClient();

    // Verify cashier authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to complete POS sales." };
    }

    const idempotencyKey = validated.idempotency_key || `pos-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const rpcItems = validated.items.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
    }));

    const { data: rpcResult, error: rpcError } = await supabase.rpc("rpc_complete_pos_sale", {
      p_items: rpcItems,
      p_payment_method: validated.payment_method,
      p_discount_amount: validated.discount_amount,
      p_cash_tendered: validated.tendered_amount,
      p_idempotency_key: idempotencyKey,
      p_notes: validated.walk_in_name || "Walk-in Counter Customer",
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    const serverSubtotal = Number(rpcResult.subtotal ?? validated.subtotal);
    const serverTax = Number(rpcResult.tax_total ?? validated.tax_amount);
    const serverTotal = Number(rpcResult.total_amount ?? validated.total_amount);

    const saleRecord: PosSaleRecord = {
      id: rpcResult.sale_id,
      receipt_number: rpcResult.receipt_number,
      cashier_id: user.id,
      cashier_name: "Cashier",
      customer_name: validated.walk_in_name,
      items: validated.items,
      subtotal: serverSubtotal,
      discount_amount: validated.discount_amount,
      tax_amount: serverTax,
      total_amount: serverTotal,
      payment_method: validated.payment_method,
      tendered_amount: validated.tendered_amount,
      change_returned: Number(rpcResult.change_due ?? validated.change_returned),
      created_at: new Date().toISOString(),
    };

    return { success: true, data: saleRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to complete POS sale.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve recent counter POS sales history directly from database
 * Zero mock sales
 */
export async function getRecentPosSales(): Promise<ActionResponse<PosSaleRecord[]>> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("pos_sales")
      .select(`
        id,
        receipt_number,
        staff_id,
        notes,
        subtotal,
        discount_amount,
        tax_total,
        total_amount,
        payment_method,
        cash_tendered,
        change_due,
        created_at,
        staff:profiles!pos_sales_staff_id_fkey(full_name),
        items:pos_sale_items(
          product_id,
          product_name,
          quantity,
          unit_price,
          tax_rate,
          tax_amount,
          total_amount
        )
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return { success: false, error: error.message };
    }

    interface PosQueryItem {
      product_id: string;
      product_name: string;
      quantity: number | string;
      unit_price: number | string;
      tax_rate: number | string;
      tax_amount: number | string;
      total_amount: number | string;
    }

    interface PosQueryRow {
      id: string;
      receipt_number: string;
      staff_id?: string | null;
      notes?: string | null;
      subtotal: number | string;
      discount_amount: number | string;
      tax_total: number | string;
      total_amount: number | string;
      payment_method: PosSaleRecord["payment_method"];
      cash_tendered: number | string;
      change_due: number | string;
      created_at: string;
      staff?: { full_name: string } | null;
      items?: PosQueryItem[] | null;
    }

    const sales: PosSaleRecord[] = ((data || []) as unknown as PosQueryRow[]).map((row) => ({
      id: row.id,
      receipt_number: row.receipt_number,
      cashier_id: row.staff_id,
      cashier_name: row.staff?.full_name || "Counter Cashier",
      customer_name: row.notes || "Walk-in Customer",
      subtotal: Number(row.subtotal),
      discount_amount: Number(row.discount_amount),
      tax_amount: Number(row.tax_total),
      total_amount: Number(row.total_amount),
      payment_method: row.payment_method,
      tendered_amount: Number(row.cash_tendered),
      change_returned: Number(row.change_due),
      created_at: row.created_at,
      items: (row.items || []).map((item) => ({
        product_id: item.product_id,
        product_sku: "SKU",
        product_name: item.product_name,
        unit_price: Number(item.unit_price),
        quantity: Number(item.quantity),
        discount_percent: 0,
        discount_amount: 0,
        gst_rate: Number(item.tax_rate),
        tax_amount: Number(item.tax_amount),
        total: Number(item.total_amount),
        is_reusable_jar: false,
      })),
    }));

    return { success: true, data: sales };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve recent sales.";
    return { success: false, error: message };
  }
}
