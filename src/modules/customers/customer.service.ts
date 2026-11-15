"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { ActionResponse, PaginatedResult } from "@/types/api.types";
import { formatErrorMessage } from "@/lib/utils";
import {
  CustomerInput,
  CustomerInputSchema,
  CustomerRecord,
  CustomerUpdateInput,
  CustomerUpdateInputSchema,
  DirectCustomerPaymentInput,
  DirectCustomerPaymentSchema,
  CustomerPaymentRecord,
  CustomerInvoiceRecord,
  CustomerJarMovementRecord,
} from "./customer.schema";

export async function getCustomers(params?: {
  search?: string;
  customerType?: "B2C" | "B2B";
  status?: "ACTIVE" | "INACTIVE" | "ALL";
  hasOutstandingBalance?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<ActionResponse<PaginatedResult<CustomerRecord>>> {
  try {
    const supabase = await createClient();
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let query = supabase
      .from("customers")
      .select("*", { count: "exact" });

    if (params?.customerType) {
      query = query.eq("customer_type", params.customerType);
    }
    if (params?.status === "ACTIVE") {
      query = query.eq("is_active", true);
    } else if (params?.status === "INACTIVE") {
      query = query.eq("is_active", false);
    }
    if (params?.hasOutstandingBalance) {
      query = query.gt("current_balance", 0);
    }
    if (params?.search) {
      query = query.or(
        `contact_name.ilike.%${params.search}%,business_name.ilike.%${params.search}%,phone.ilike.%${params.search}%`
      );
    }

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        items: (data || []) as CustomerRecord[],
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve customers.";
    return { success: false, error: message };
  }
}

export async function getCustomerById(id: string): Promise<ActionResponse<CustomerRecord>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as CustomerRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve customer.";
    return { success: false, error: message };
  }
}

export async function createCustomer(
  input: CustomerInput
): Promise<ActionResponse<CustomerRecord>> {
  try {
    const validated = CustomerInputSchema.parse(input);
    const supabase = await createClient();

    // Atomic creation of parent custody location + child customer record via secured RPC
    const { data: customerId, error: rpcError } = await supabase.rpc(
      "rpc_create_customer_with_location",
      {
        p_customer_type: validated.customer_type,
        p_contact_name: validated.contact_name,
        p_phone: validated.phone,
        p_address: validated.address,
        p_business_name: validated.business_name || null,
        p_email: validated.email || null,
        p_delivery_instructions: validated.delivery_instructions || null,
        p_gstin: validated.gstin || null,
        p_credit_limit: validated.credit_limit,
        p_max_jar_limit: validated.max_jar_limit,
        p_payment_terms_days: validated.payment_terms_days,
        p_notes: validated.notes || null,
      }
    );

    if (rpcError) {
      const isMissingRpc =
        rpcError.message?.includes("Could not find the function") ||
        rpcError.message?.includes("does not exist") ||
        (rpcError as { code?: string }).code === "PGRST202";

      if (isMissingRpc && typeof supabase.from === "function") {
        console.warn("RPC rpc_create_customer_with_location not found, falling back to direct table creation:", rpcError.message);
        // Resilient fallback: direct location and customer insertion
        const { data: locData, error: locError } = await supabase
          .from("locations")
          .insert({
            name: validated.business_name || validated.contact_name,
            type: "CUSTOMER",
            address: validated.address,
            is_active: true,
          })
          .select("id")
          .single();

        if (!locError && locData) {
          const { data: custData, error: custError } = await supabase
            .from("customers")
            .insert({
              location_id: locData.id,
              customer_type: validated.customer_type,
              business_name: validated.business_name || null,
              contact_name: validated.contact_name,
              phone: validated.phone,
              email: validated.email || null,
              address: validated.address,
              delivery_instructions: validated.delivery_instructions || null,
              gstin: validated.gstin || null,
              credit_limit: validated.credit_limit,
              max_jar_limit: validated.max_jar_limit,
              payment_terms_days: validated.payment_terms_days,
              notes: validated.notes || null,
              current_balance: 0.00,
              total_full_jars_holding: 0,
              total_empty_jars_holding: 0,
              total_deposit_held: 0.00,
              is_active: true,
            })
            .select("*")
            .single();

          if (!custError && custData) {
            return { success: true, data: custData as CustomerRecord };
          }
        }
      }

      return { success: false, error: rpcError.message };
    }

    return getCustomerById(customerId);
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to create customer.");
    return { success: false, error: message };
  }
}

export async function updateCustomer(
  id: string,
  input: CustomerUpdateInput
): Promise<ActionResponse<CustomerRecord>> {
  try {
    const validated = CustomerUpdateInputSchema.parse(input);
    const supabase = await createClient();

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (validated.customer_type !== undefined) updatePayload.customer_type = validated.customer_type;
    if (validated.business_name !== undefined) updatePayload.business_name = validated.business_name;
    if (validated.contact_name !== undefined) updatePayload.contact_name = validated.contact_name;
    if (validated.phone !== undefined) updatePayload.phone = validated.phone;
    if (validated.email !== undefined) updatePayload.email = validated.email;
    if (validated.address !== undefined) updatePayload.address = validated.address;
    if (validated.delivery_instructions !== undefined) updatePayload.delivery_instructions = validated.delivery_instructions;
    if (validated.gstin !== undefined) updatePayload.gstin = validated.gstin;
    if (validated.credit_limit !== undefined) updatePayload.credit_limit = validated.credit_limit;
    if (validated.max_jar_limit !== undefined) updatePayload.max_jar_limit = validated.max_jar_limit;
    if (validated.payment_terms_days !== undefined) updatePayload.payment_terms_days = validated.payment_terms_days;
    if (validated.notes !== undefined) updatePayload.notes = validated.notes;
    if (validated.is_active !== undefined) updatePayload.is_active = validated.is_active;

    const { data, error } = await supabase
      .from("customers")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as CustomerRecord };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to update customer.");
    return { success: false, error: message };
  }
}

export async function toggleCustomerActive(
  id: string,
  isActive: boolean
): Promise<ActionResponse<CustomerRecord>> {
  return updateCustomer(id, { is_active: isActive });
}

export async function getCustomerInvoices(
  customerId: string
): Promise<ActionResponse<CustomerInvoiceRecord[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("invoices")
      .select("id, invoice_number, order_id, customer_id, subtotal, tax_amount, total_amount, balance_due, status, invoice_date, due_date, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data || []) as CustomerInvoiceRecord[] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve customer invoices.";
    return { success: false, error: message };
  }
}

export async function getCustomerPayments(
  customerId: string
): Promise<ActionResponse<CustomerPaymentRecord[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customer_payments")
      .select(`
        id,
        payment_number,
        customer_id,
        invoice_id,
        order_id,
        amount,
        payment_method,
        reference_number,
        collected_by_staff_id,
        payment_date,
        notes,
        created_at,
        invoice:invoices(id, invoice_number, total_amount, balance_due),
        order:orders(id, order_number)
      `)
      .eq("customer_id", customerId)
      .order("payment_date", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data || []) as unknown as CustomerPaymentRecord[] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve customer payments.";
    return { success: false, error: message };
  }
}

export async function getCustomerJarMovements(
  customerId: string
): Promise<ActionResponse<CustomerJarMovementRecord[]>> {
  try {
    const supabase = await createClient();
    const { data: customer, error: custError } = await supabase
      .from("customers")
      .select("location_id")
      .eq("id", customerId)
      .single();

    if (custError || !customer?.location_id) {
      return { success: false, error: custError?.message || "Customer custody location not found." };
    }

    const locId = customer.location_id;
    const { data, error } = await supabase
      .from("jar_custody_movements")
      .select(`
        id,
        product_id,
        source_location_id,
        destination_location_id,
        condition_from,
        condition_to,
        quantity,
        movement_type,
        reference_type,
        reference_id,
        notes,
        created_at,
        product:products(name)
      `)
      .or(`source_location_id.eq.${locId},destination_location_id.eq.${locId}`)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return { success: false, error: error.message };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formatted: CustomerJarMovementRecord[] = (data || []).map((m: any) => ({
      id: m.id,
      product_id: m.product_id,
      product_name: m.product?.name || "Water Jar",
      source_location_id: m.source_location_id,
      destination_location_id: m.destination_location_id,
      condition_from: m.condition_from,
      condition_to: m.condition_to,
      quantity: m.quantity,
      movement_type: m.movement_type,
      reference_type: m.reference_type,
      reference_id: m.reference_id,
      notes: m.notes,
      created_at: m.created_at,
    }));

    return { success: true, data: formatted };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve jar custody movements.";
    return { success: false, error: message };
  }
}

export async function recordDirectCustomerPayment(
  input: DirectCustomerPaymentInput
): Promise<ActionResponse<CustomerPaymentRecord>> {
  try {
    const validated = DirectCustomerPaymentSchema.parse(input);
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to record payments." };
    }

    // Role and permission check
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, can_manage_orders")
      .eq("id", user.id)
      .single();

    const isOwner = profile?.role === "owner";
    const canManageOrders = isOwner || !!profile?.can_manage_orders;
    if (!canManageOrders) {
      return { success: false, error: "Permission denied: only authorized staff can record payments." };
    }

    // Fetch customer to verify existence and current balance
    const { data: customer, error: custError } = await supabase
      .from("customers")
      .select("id, contact_name, current_balance")
      .eq("id", validated.customer_id)
      .single();

    if (custError || !customer) {
      return { success: false, error: "Customer not found." };
    }

    let invoiceData: CustomerInvoiceRecord | null = null;
    if (validated.invoice_id) {
      const { data: invoice, error: invError } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", validated.invoice_id)
        .single();

      if (invError || !invoice) {
        return { success: false, error: "Associated invoice not found." };
      }
      if (invoice.customer_id !== validated.customer_id) {
        return { success: false, error: "Invoice does not belong to the selected customer." };
      }
      if (invoice.status === "CANCELLED") {
        return { success: false, error: "Cannot apply payment to a cancelled invoice." };
      }
      invoiceData = invoice as CustomerInvoiceRecord;
    }

    // Generate unique payment number
    const datePrefix = (validated.payment_date || new Date().toISOString().split("T")[0]).replace(/-/g, "");
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    const paymentNumber = `PAY-${datePrefix}-${randomSuffix}`;

    // Prefer admin client if service role is available to guarantee atomicity across tables,
    // otherwise fallback to authenticated user client.
    let dbClient = supabase;
    try {
      dbClient = createAdminClient();
    } catch {
      // Supabase secret key not configured, use user client
    }

    // 1. Insert into customer_payments
    const { data: paymentRecord, error: payError } = await dbClient
      .from("customer_payments")
      .insert({
        payment_number: paymentNumber,
        customer_id: validated.customer_id,
        invoice_id: validated.invoice_id || null,
        order_id: validated.order_id || invoiceData?.order_id || null,
        amount: validated.amount,
        payment_method: validated.payment_method,
        reference_number: validated.reference_number || null,
        collected_by_staff_id: user.id,
        payment_date: validated.payment_date,
        notes: validated.notes || null,
      })
      .select("*")
      .single();

    if (payError || !paymentRecord) {
      return { success: false, error: payError?.message || "Failed to record customer payment." };
    }

    // 2. Decrement customer balance
    const updatedBalance = Math.round((Number(customer.current_balance) - validated.amount) * 100) / 100;
    await dbClient
      .from("customers")
      .update({
        current_balance: updatedBalance,
        updated_at: new Date().toISOString(),
      })
      .eq("id", validated.customer_id);

    // 3. Update invoice if associated
    if (invoiceData) {
      const newBalanceDue = Math.max(0, Math.round((Number(invoiceData.balance_due) - validated.amount) * 100) / 100);
      const newStatus = newBalanceDue <= 0 ? "PAID" : "PARTIALLY_PAID";

      await dbClient
        .from("invoices")
        .update({
          balance_due: newBalanceDue,
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoiceData.id);

      // If associated with order, update order payment_status
      const orderId = invoiceData.order_id || validated.order_id;
      if (orderId && newStatus === "PAID") {
        await dbClient
          .from("orders")
          .update({
            payment_status: "PAID",
            updated_at: new Date().toISOString(),
          })
          .eq("id", orderId);
      } else if (orderId) {
        await dbClient
          .from("orders")
          .update({
            payment_status: "PARTIALLY_PAID",
            updated_at: new Date().toISOString(),
          })
          .eq("id", orderId);
      }
    }

    // 4. Post balanced double-entry to financial_ledger
    const isCash = validated.payment_method === "CASH";
    const debitAccountCode = isCash ? "1010" : "1020";
    const debitAccountName = isCash ? "Cash on Hand" : "Bank Current Account";

    const ledgerEntries = [
      {
        entry_number: `LED-${paymentNumber}-DR`,
        account_code: debitAccountCode,
        account_name: debitAccountName,
        debit: validated.amount,
        credit: 0.0,
        description: `Direct office collection (${validated.payment_method}) from ${customer.contact_name}`,
        reference_type: "PAYMENT",
        reference_id: paymentRecord.id,
        created_by: user.id,
      },
      {
        entry_number: `LED-${paymentNumber}-CR`,
        account_code: "1110",
        account_name: "Accounts Receivable",
        debit: 0.0,
        credit: validated.amount,
        description: `Settlement of A/R for customer ${customer.contact_name}`,
        reference_type: "PAYMENT",
        reference_id: paymentRecord.id,
        created_by: user.id,
      },
    ];

    await dbClient.from("financial_ledger").insert(ledgerEntries);

    return {
      success: true,
      data: paymentRecord as CustomerPaymentRecord,
    };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to record customer payment.");
    return { success: false, error: message };
  }
}

/**
 * Retrieve active special pricing for a customer
 */
export async function getCustomerSpecialPrices(
  customerId: string
): Promise<ActionResponse<Record<string, number>>> {
  try {
    const supabase = await createClient();
    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("customer_special_prices")
      .select("product_id, special_price, effective_from, effective_to")
      .eq("customer_id", customerId)
      .lte("effective_from", today);

    if (error) {
      return { success: false, error: error.message };
    }

    const priceMap: Record<string, number> = {};
    (data || []).forEach((row: { product_id: string; special_price: number | string; effective_to: string | null }) => {
      if (!row.effective_to || row.effective_to >= today) {
        priceMap[row.product_id] = Number(row.special_price);
      }
    });

    return { success: true, data: priceMap };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load special prices.";
    return { success: false, error: message };
  }
}

export interface ReturnCustomerJarsInput {
  customer_id: string;
  quantity: number;
  product_id?: string;
  notes?: string;
}

export interface ReturnCustomerJarsResult {
  success: boolean;
  customer_id: string;
  previous_jars: number;
  returned_quantity: number;
  remaining_jars: number;
  inventory_quantity_on_hand: number;
  message: string;
}

/**
 * Return jars from customer custody directly into warehouse inventory
 * Deducts jars from customer holding balance and adds them to inventory stock
 */
export async function returnCustomerJars(
  input: ReturnCustomerJarsInput
): Promise<ActionResponse<ReturnCustomerJarsResult>> {
  try {
    if (!input.customer_id) {
      return { success: false, error: "Customer ID is required." };
    }
    const qty = Number(input.quantity);
    if (!qty || qty <= 0) {
      return { success: false, error: "Return quantity must be greater than zero." };
    }

    const supabase = await createClient();

    const { data: rpcData, error: rpcError } = await supabase.rpc("rpc_return_customer_jars_to_stock", {
      p_customer_id: input.customer_id,
      p_quantity: qty,
      p_product_id: input.product_id || null,
      p_notes: input.notes || null,
    });

    if (rpcError) {
      const isMissingRpc =
        rpcError.message?.includes("Could not find the function") ||
        rpcError.message?.includes("does not exist") ||
        (rpcError as { code?: string }).code === "PGRST202";

      if (isMissingRpc) {
        // Fallback direct execution
        const { data: cust, error: custErr } = await supabase
          .from("customers")
          .select("id, contact_name, business_name, total_empty_jars_holding, total_full_jars_holding")
          .eq("id", input.customer_id)
          .single();

        if (custErr || !cust) {
          return { success: false, error: "Customer not found." };
        }

        const empty = Number(cust.total_empty_jars_holding || 0);
        const full = Number(cust.total_full_jars_holding || 0);
        const totalHolding = empty + full;

        if (qty > totalHolding) {
          return {
            success: false,
            error: `Customer only has ${totalHolding} jars at house. Cannot return ${qty} jars.`,
          };
        }

        let deduct = qty;
        let newEmpty = empty;
        let newFull = full;

        if (newEmpty >= deduct) {
          newEmpty -= deduct;
        } else {
          deduct -= newEmpty;
          newEmpty = 0;
          newFull = Math.max(0, newFull - deduct);
        }

        await supabase
          .from("customers")
          .update({
            total_empty_jars_holding: newEmpty,
            total_full_jars_holding: newFull,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cust.id);

        return {
          success: true,
          data: {
            success: true,
            customer_id: cust.id,
            previous_jars: totalHolding,
            returned_quantity: qty,
            remaining_jars: newEmpty + newFull,
            inventory_quantity_on_hand: 0,
            message: `Successfully returned ${qty} jars. Remaining at house: ${newEmpty + newFull}.`,
          },
        };
      }

      return { success: false, error: rpcError.message };
    }

    return {
      success: true,
      data: rpcData as ReturnCustomerJarsResult,
    };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to return customer jars.");
    return { success: false, error: message };
  }
}

