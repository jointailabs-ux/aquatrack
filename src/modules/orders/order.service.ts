"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import { formatErrorMessage } from "@/lib/utils";
import {
  CancelOrderInput,
  CancelOrderResult,
  CancelOrderSchema,
  CreateOrderInput,
  CreateOrderSchema,
  DeliveryExecutionInput,
  DeliveryExecutionSchema,
  OrderRecord,
  OrderStatus,
} from "./order.schema";

/**
 * Retrieve customer orders with filtering for owner and mobile staff
 * Direct database aggregation with zero mock fallbacks
 */
export async function getOrders(params?: {
  status?: OrderStatus;
  staffId?: string;
  customerId?: string;
  orderId?: string;
  deliveryDate?: string;
}): Promise<ActionResponse<OrderRecord[]>> {
  try {
    const supabase = await createClient();

    let query = supabase
      .from("orders")
      .select(`
        id,
        order_number,
        customer_id,
        delivery_address,
        delivery_date,
        assigned_staff_id,
        status,
        subtotal,
        tax_total,
        total_amount,
        payment_status,
        notes,
        created_at,
        updated_at,
        customer:customers(contact_name, business_name, phone, delivery_instructions, total_full_jars_holding, total_empty_jars_holding),
        assigned_staff:profiles!orders_assigned_staff_id_fkey(full_name),
        items:order_items(
          product_id,
          quantity,
          unit_price,
          tax_rate,
          tax_amount,
          total_amount,
          product:products(name, is_reusable_jar)
        ),
        stop:delivery_stops(
          id,
          actual_delivered_quantity,
          empty_jars_collected,
          damaged_jars_collected,
          failure_reason,
          executed_at
        ),
        payments:customer_payments(
          amount
        )
      `)
      .order("created_at", { ascending: false });

    if (params?.orderId) {
      query = query.eq("id", params.orderId);
    }
    if (params?.status) {
      query = query.eq("status", params.status);
    }
    if (params?.staffId) {
      query = query.eq("assigned_staff_id", params.staffId);
    }
    if (params?.customerId) {
      query = query.eq("customer_id", params.customerId);
    }
    if (params?.deliveryDate) {
      query = query.eq("delivery_date", params.deliveryDate);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    interface OrderQueryItem {
      product_id: string;
      quantity: number | string;
      unit_price: number | string;
      tax_rate: number | string;
      tax_amount: number | string;
      total_amount: number | string;
      product?: { name: string; is_reusable_jar: boolean } | null;
    }

    interface OrderQueryRow {
      id: string;
      order_number: string;
      customer_id: string;
      delivery_address: string;
      delivery_date: string;
      assigned_staff_id?: string | null;
      status: OrderRecord["status"];
      subtotal: number | string;
      tax_total: number | string;
      total_amount: number | string;
      payment_status: string;
      notes?: string | null;
      created_at: string;
      updated_at: string;
      customer?: {
        contact_name: string;
        business_name?: string | null;
        phone: string;
        delivery_instructions?: string | null;
        total_full_jars_holding?: number;
        total_empty_jars_holding?: number;
      } | null;
      assigned_staff?: { full_name: string } | null;
      items?: OrderQueryItem[] | null;
      stop?: {
        id?: string;
        actual_delivered_quantity?: number;
        empty_jars_collected?: number;
        damaged_jars_collected?: number;
        failure_reason?: string | null;
        executed_at?: string | null;
      } | Array<{
        id?: string;
        actual_delivered_quantity?: number;
        empty_jars_collected?: number;
        damaged_jars_collected?: number;
        failure_reason?: string | null;
        executed_at?: string | null;
      }> | null;
      payments?: Array<{ amount?: number | string }> | null;
    }

    const orders: OrderRecord[] = ((data || []) as unknown as OrderQueryRow[]).map((row) => {
      const stopInfo = Array.isArray(row.stop) ? row.stop[0] : row.stop;
      const cust = row.customer;
      const custName = cust?.business_name
        ? `${cust.business_name} (${cust.contact_name})`
        : cust?.contact_name || "Customer Account";

      const paymentsSum = Array.isArray(row.payments)
        ? row.payments.reduce((sum, p) => sum + Number(p?.amount || 0), 0)
        : 0;

      const orderTotal = Number(row.total_amount);
      const computedPaymentStatus = paymentsSum >= orderTotal && orderTotal > 0
        ? "PAID"
        : paymentsSum > 0
          ? "PARTIALLY_PAID"
          : row.payment_status === "PAID"
            ? "PAID"
            : row.payment_status === "PARTIALLY_PAID"
              ? "PARTIALLY_PAID"
              : "PENDING";

      return {
        id: row.id,
        order_number: row.order_number,
        customer_id: row.customer_id,
        customer_name: custName,
        customer_phone: cust?.phone || "",
        customer_jars_holding: (cust?.total_full_jars_holding || 0) + (cust?.total_empty_jars_holding || 0),
        assigned_staff_id: row.assigned_staff_id || null,
        assigned_staff_name: row.assigned_staff?.full_name || null,
        order_date: row.created_at ? row.created_at.split("T")[0] : new Date().toISOString().split("T")[0],
        delivery_date: row.delivery_date,
        delivery_address: row.delivery_address,
        status: row.status,
        payment_status: computedPaymentStatus,
        subtotal: Number(row.subtotal),
        tax_total: Number(row.tax_total),
        total_amount: orderTotal,
        amount_paid: paymentsSum > 0 ? paymentsSum : (row.payment_status === "PAID" ? orderTotal : 0),
        notes: row.notes,
        delivery_instructions: cust?.delivery_instructions || null,
        failure_reason: stopInfo?.failure_reason || null,
        stop_id: stopInfo?.id || null,
        actual_quantity_delivered: stopInfo?.actual_delivered_quantity,
        empty_jars_collected: stopInfo?.empty_jars_collected,
        damaged_jars_collected: stopInfo?.damaged_jars_collected,
        delivered_at: stopInfo?.executed_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        items: (row.items || []).map((item) => ({
          product_id: item.product_id,
          product_name: item.product?.name || "Product",
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          gst_rate: Number(item.tax_rate),
          tax_amount: Number(item.tax_amount),
          total_amount: Number(item.total_amount),
          is_reusable_jar: Boolean(item.product?.is_reusable_jar),
        })),
      };
    });

    return { success: true, data: orders };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve orders.";
    return { success: false, error: message };
  }
}

/**
 * Mobile Delivery Driver API: Fetch orders assigned to current logged-in delivery staff
 */
export async function getStaffAssignedDeliveries(
  dateStr?: string
): Promise<ActionResponse<OrderRecord[]>> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required to view assigned route." };
    }

    return getOrders({ staffId: user.id, deliveryDate: dateStr });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve driver deliveries.";
    return { success: false, error: message };
  }
}

/**
 * Create a new customer delivery order (Owner & Staff with can_manage_orders)
 * Also creates an accrual invoice and sets up route delivery stop.
 */
export async function createOrder(
  input: CreateOrderInput
): Promise<ActionResponse<OrderRecord>> {
  try {
    const validated = CreateOrderSchema.parse(input);
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to create orders." };
    }

    // Call atomic RPC rpc_create_customer_order (security definer handles caller fallback)
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "rpc_create_customer_order",
      {
        p_customer_id: validated.customer_id,
        p_delivery_address: validated.delivery_address,
        p_delivery_date: validated.delivery_date,
        p_assigned_staff_id: validated.assigned_staff_id || null,
        p_notes: validated.notes || null,
        p_items: validated.items.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          gst_rate: item.gst_rate,
        })),
        p_idempotency_key: validated.idempotency_key || null,
        p_price_override_reason: validated.price_override_reason || null,
      }
    );

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    const resObj = typeof rpcResult === "string" ? JSON.parse(rpcResult) : Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    if (!resObj || (!resObj.order_id && !resObj.id)) {
      return { success: false, error: "Failed to generate order ID from database." };
    }

    const orderId = resObj.order_id || resObj.id;
    const orderNumber = resObj.order_number || resObj.order_num || `ORD-${Date.now()}`;

    const calculatedSubtotal = validated.items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
    const calculatedTax = validated.items.reduce((sum, i) => sum + i.tax_amount, 0);
    const subtotal = Number(resObj.subtotal ?? calculatedSubtotal);
    const taxTotal = Number(resObj.tax_total ?? calculatedTax);
    const totalAmount = Number(resObj.total_amount ?? (subtotal + taxTotal));

    const record: OrderRecord = {
      id: orderId,
      order_number: orderNumber,
      customer_id: validated.customer_id,
      customer_name: "Customer",
      customer_phone: "",
      assigned_staff_id: validated.assigned_staff_id || null,
      assigned_staff_name: null,
      order_date: validated.order_date,
      delivery_date: validated.delivery_date,
      delivery_address: validated.delivery_address,
      status: validated.assigned_staff_id ? "ASSIGNED" : "PENDING",
      payment_status: "PENDING",
      subtotal,
      tax_total: taxTotal,
      total_amount: totalAmount,
      amount_paid: 0,
      items: validated.items,
      notes: validated.notes || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return { success: true, data: record };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to create order.");
    return { success: false, error: message };
  }
}

/**
 * Assign or reassign a staff member to an order
 */
export async function assignOrderStaff(
  orderId: string,
  staffId: string | null
): Promise<ActionResponse<{ success: boolean }>> {
  try {
    const supabase = await createClient();
    const { error: orderErr } = await supabase
      .from("orders")
      .update({
        assigned_staff_id: staffId,
        status: staffId ? "ASSIGNED" : "PENDING",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (orderErr) {
      return { success: false, error: orderErr.message };
    }

    // Also update active delivery stops
    if (staffId) {
      await supabase
        .from("delivery_stops")
        .update({
          assigned_staff_id: staffId,
          status: "ASSIGNED",
          updated_at: new Date().toISOString(),
        })
        .eq("order_id", orderId)
        .in("status", ["PENDING", "ASSIGNED", "EN_ROUTE"]);
    }

    return { success: true, data: { success: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to assign staff.";
    return { success: false, error: message };
  }
}

/**
 * Mobile Delivery Driver API: Resolves a stop identifier and loads its authoritative order.
 * Strictly separates delivery stop ID (delivery_stops.id) from order ID (orders.id).
 * Handles both:
 * 1. stopOrOrderId referring to a delivery_stops record (primary key)
 * 2. stopOrOrderId referring to an orders record (fallback / direct navigation)
 * Safely handles missing, cancelled, or invalid relationships.
 */
export async function getOrderForDeliveryStop(
  stopOrOrderId: string
): Promise<
  ActionResponse<{
    order: OrderRecord;
    stopId: string | null;
    orderId: string;
    isStopId: boolean;
  }>
> {
  try {
    if (!stopOrOrderId || typeof stopOrOrderId !== "string" || !stopOrOrderId.trim()) {
      return { success: false, error: "Invalid delivery stop identifier." };
    }

    const cleanId = stopOrOrderId.trim();
    const supabase = await createClient();

    // 1. First, check if cleanId is a delivery_stops.id
    const { data: stopRow, error: stopErr } = await supabase
      .from("delivery_stops")
      .select("id, order_id, status, sequence_number, assigned_staff_id")
      .eq("id", cleanId)
      .maybeSingle();

    if (stopErr) {
      return { success: false, error: stopErr.message };
    }

    let resolvedOrderId: string;
    let resolvedStopId: string | null = null;
    let isStopId = false;

    if (stopRow) {
      resolvedOrderId = stopRow.order_id;
      resolvedStopId = stopRow.id;
      isStopId = true;
    } else {
      // 2. Fallback: check if cleanId is an orders.id
      const { data: orderRow, error: orderErr } = await supabase
        .from("orders")
        .select("id, status")
        .eq("id", cleanId)
        .maybeSingle();

      if (orderErr) {
        return { success: false, error: orderErr.message };
      }

      if (!orderRow) {
        return {
          success: false,
          error: "Delivery stop or associated order not found. It may have been reassigned, completed, or removed.",
        };
      }

      resolvedOrderId = orderRow.id;
      // Find matching stop for this order
      const { data: matchedStop } = await supabase
        .from("delivery_stops")
        .select("id")
        .eq("order_id", resolvedOrderId)
        .order("sequence_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      resolvedStopId = matchedStop?.id || null;
      isStopId = false;
    }

    // 3. Fetch authoritative order details
    const orderRes = await getOrders({ orderId: resolvedOrderId });
    if (!orderRes.success || !orderRes.data || orderRes.data.length === 0) {
      return { success: false, error: "Associated order record could not be retrieved." };
    }

    const order = orderRes.data[0];

    return {
      success: true,
      data: {
        order,
        stopId: resolvedStopId,
        orderId: resolvedOrderId,
        isStopId,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to resolve delivery stop.";
    return { success: false, error: message };
  }
}

/**
 * Mobile Delivery Execution at Customer Doorstep
 * Calls PostgreSQL atomic RPC rpc_execute_delivery_stop
 */
export async function executeDeliveryStop(
  input: DeliveryExecutionInput
): Promise<ActionResponse<{ delivered: boolean; newCustomerHolding?: number; status?: string }>> {
  try {
    const validated = DeliveryExecutionSchema.parse(input);
    const supabase = await createClient();

    // Verify caller authenticated staff
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to complete delivery stop." };
    }

    let stopId: string | undefined;

    // If exact stop_id is provided, verify it belongs to this order
    if (validated.stop_id) {
      const { data: exactStop } = await supabase
        .from("delivery_stops")
        .select("id, status, order_id")
        .eq("id", validated.stop_id)
        .maybeSingle();

      if (exactStop && exactStop.order_id === validated.order_id) {
        stopId = exactStop.id;
      }
    }

    if (!stopId) {
      // Look up existing stops for this order to find an active stop or create a subsequent stop
      const { data: stops } = await supabase
        .from("delivery_stops")
        .select("id, status, sequence_number")
        .eq("order_id", validated.order_id)
        .order("sequence_number", { ascending: false });

      // Active stops are only those eligible for execution (ASSIGNED, PENDING, EN_ROUTE)
      // Do NOT select FAILED, COMPLETED, or CANCELLED stops as active.
      const activeStop = (stops || []).find(
        (s) => s.status === "ASSIGNED" || s.status === "PENDING" || s.status === "EN_ROUTE"
      );
      stopId = activeStop?.id;

      if (!stopId) {
        // Check that the parent order remains active before creating a retry delivery stop
        const { data: orderData, error: orderFetchErr } = await supabase
          .from("orders")
          .select("status")
          .eq("id", validated.order_id)
          .single();

        if (orderFetchErr || !orderData) {
          return { success: false, error: "Parent order not found." };
        }

        if (orderData.status === "DELIVERED" || orderData.status === "CANCELLED") {
          return {
            success: false,
            error: `Cannot create delivery stop: Order is already in "${orderData.status}" status.`,
          };
        }

        // Allow authorized staff member to create a new delivery stop for a failed delivery
        const nextSequence = stops && stops.length > 0 ? (stops[0].sequence_number + 1) : 1;
        const { data: newStop, error: newStopError } = await supabase
          .from("delivery_stops")
          .insert({
            order_id: validated.order_id,
            assigned_staff_id: user.id,
            sequence_number: nextSequence,
            status: "ASSIGNED",
          })
          .select("id")
          .single();

        if (newStopError || !newStop) {
          return { success: false, error: newStopError?.message || "Failed to create delivery stop for retry." };
        }
        stopId = newStop.id;
      }
    }

    // Execute atomic stop reconciliation via PostgreSQL RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc("rpc_execute_delivery_stop", {
      p_stop_id: stopId,
      p_actual_delivered: validated.actual_quantity_delivered,
      p_empty_jars: validated.empty_jars_collected,
      p_damaged_jars: validated.damaged_jars_collected,
      p_payment_amount: validated.amount_collected,
      p_payment_method: validated.payment_method,
      p_notes: validated.delivery_notes || null,
      p_failure_reason: validated.failure_reason || null,
      p_items: validated.items || null,
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    return {
      success: true,
      data: {
        delivered: rpcResult?.status === "COMPLETED",
        newCustomerHolding: rpcResult?.customer_closing_holding,
        status: rpcResult?.status,
      },
    };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to execute delivery stop.");
    return { success: false, error: message };
  }
}

/**
 * Cancel an existing customer order and release remaining undelivered reserved inventory.
 * Calls atomic PostgreSQL RPC rpc_cancel_customer_order with canonical checks.
 */
export async function cancelOrder(
  input: CancelOrderInput
): Promise<ActionResponse<CancelOrderResult>> {
  try {
    const validated = CancelOrderSchema.parse(input);
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to cancel orders." };
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "rpc_cancel_customer_order",
      {
        p_order_id: validated.order_id,
        p_reason: validated.reason || null,
      }
    );

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    return {
      success: true,
      data: {
        order_id: rpcResult.order_id,
        order_number: rpcResult.order_number,
        status: rpcResult.status,
        released_reservation: Boolean(rpcResult.released_reservation),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to cancel order.";
    return { success: false, error: message };
  }
}

/**
 * Backward-compatible alias for cancelOrder
 */
export const cancelCustomerOrder = cancelOrder;

