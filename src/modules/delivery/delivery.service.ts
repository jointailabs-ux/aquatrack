"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import {
  AdminDeliveriesData,
  DeliveryStopDetail,
  DeliveryTripOverview,
  DriverDailySettlementSummary,
  DriverPaymentSettlementRecord,
  SettleDriverCashInput,
  SettleDriverCashSchema,
  AssignOrderToDriverInput,
  AssignOrderToDriverSchema,
  TripStatus,
  DeliveryStopStatus,
  CashHandoverStatus,
} from "./delivery.schema";

/**
 * Admin Deliveries Management Overview
 * Fetches real database routes, assigned stops, vehicle inventory, and pending dispatch orders.
 */
export async function getAdminDeliveriesOverview(params?: {
  date?: string;
  driverId?: string;
  status?: string;
}): Promise<ActionResponse<AdminDeliveriesData>> {
  try {
    const supabase = await createClient();
    const date = params?.date || new Date().toISOString().split("T")[0];

    // 1. Fetch active staff/drivers
    const { data: staffList, error: staffError } = await supabase
      .from("profiles")
      .select("id, full_name, phone, role, is_active")
      .eq("is_active", true);

    if (staffError) {
      return { success: false, error: staffError.message };
    }

    const driversMap = new Map<string, { id: string; name: string; phone: string }>();
    (staffList || []).forEach((s) => {
      driversMap.set(s.id, { id: s.id, name: s.full_name, phone: s.phone });
    });

    // 2. Fetch all delivery stops for orders scheduled on this date
    let stopsQuery = supabase
      .from("delivery_stops")
      .select(`
        id,
        order_id,
        assigned_staff_id,
        sequence_number,
        status,
        actual_delivered_quantity,
        empty_jars_collected,
        damaged_jars_collected,
        payment_collected,
        payment_method,
        notes,
        failure_reason,
        executed_at,
        created_at,
        assigned_staff:profiles!delivery_stops_assigned_staff_id_fkey(id, full_name, phone),
        order:orders!inner(
          id,
          order_number,
          customer_id,
          delivery_address,
          delivery_date,
          total_amount,
          status,
          customer:customers(id, contact_name, business_name, phone, delivery_instructions),
          items:order_items(
            product_id,
            quantity,
            delivered_quantity,
            product:products(name, is_reusable_jar)
          )
        )
      `)
      .eq("order.delivery_date", date)
      .order("sequence_number", { ascending: true });

    if (params?.driverId) {
      stopsQuery = stopsQuery.eq("assigned_staff_id", params.driverId);
    }
    if (params?.status && params.status !== "ALL") {
      stopsQuery = stopsQuery.eq("status", params.status);
    }

    const { data: stopsData, error: stopsError } = await stopsQuery;
    if (stopsError) {
      return { success: false, error: stopsError.message };
    }

    interface StopQueryRow {
      id: string;
      order_id: string;
      assigned_staff_id: string;
      sequence_number: number;
      status: DeliveryStopStatus;
      actual_delivered_quantity?: number;
      empty_jars_collected?: number;
      damaged_jars_collected?: number;
      payment_collected?: number;
      payment_method?: "CASH" | "UPI" | "CREDIT" | null;
      notes?: string | null;
      failure_reason?: string | null;
      executed_at?: string | null;
      assigned_staff?: { id: string; full_name: string; phone: string } | null;
      order: {
        id: string;
        order_number: string;
        customer_id: string;
        delivery_address: string;
        delivery_date: string;
        total_amount: number;
        status: string;
        customer?: {
          id: string;
          contact_name: string;
          business_name?: string | null;
          phone: string;
          delivery_instructions?: string | null;
        } | null;
        items?: Array<{
          product_id: string;
          quantity: number;
          delivered_quantity: number;
          product?: { name: string; is_reusable_jar: boolean } | null;
        }> | null;
      };
    }

    const typedStops = (stopsData || []) as unknown as StopQueryRow[];

    // Group stops by driver (assigned_staff_id)
    const driverTripsMap = new Map<string, DeliveryStopDetail[]>();

    typedStops.forEach((row) => {
      const staffId = row.assigned_staff_id;
      if (!driverTripsMap.has(staffId)) {
        driverTripsMap.set(staffId, []);
      }

      const cust = row.order.customer;
      const custName = cust?.business_name || cust?.contact_name || "Customer";

      const stopDetail: DeliveryStopDetail = {
        id: row.id,
        order_id: row.order_id,
        order_number: row.order.order_number,
        customer_id: row.order.customer_id,
        customer_name: custName,
        customer_phone: cust?.phone || "",
        delivery_address: row.order.delivery_address,
        delivery_instructions: cust?.delivery_instructions || null,
        sequence_number: row.sequence_number,
        status: row.status,
        order_total_amount: Number(row.order.total_amount || 0),
        actual_delivered_quantity: Number(row.actual_delivered_quantity || 0),
        empty_jars_collected: Number(row.empty_jars_collected || 0),
        damaged_jars_collected: Number(row.damaged_jars_collected || 0),
        payment_collected: Number(row.payment_collected || 0),
        payment_method: row.payment_method || null,
        delivery_notes: row.notes || null,
        failure_reason: row.failure_reason || null,
        executed_at: row.executed_at || null,
        items: (row.order.items || []).map((it) => ({
          product_id: it.product_id,
          product_name: it.product?.name || "Product",
          ordered_quantity: Number(it.quantity || 0),
          delivered_quantity: Number(it.delivered_quantity || 0),
          is_reusable_jar: it.product?.is_reusable_jar || false,
        })),
      };

      driverTripsMap.get(staffId)!.push(stopDetail);
    });

    const trips: DeliveryTripOverview[] = [];
    let completedStopsCount = 0;
    let pendingStopsCount = 0;
    let failedStopsCount = 0;

    driverTripsMap.forEach((stops, staffId) => {
      const driver = driversMap.get(staffId) || {
        id: staffId,
        name: "Assigned Staff",
        phone: "",
      };

      let completed = 0;
      let pending = 0;
      let failed = 0;
      let fullDelivered = 0;
      let emptyCollected = 0;
      let damagedCollected = 0;
      let cashCollected = 0;
      let upiCollected = 0;

      stops.forEach((s) => {
        if (s.status === "COMPLETED") {
          completed++;
          completedStopsCount++;
          fullDelivered += s.actual_delivered_quantity;
          emptyCollected += s.empty_jars_collected;
          damagedCollected += s.damaged_jars_collected;
          if (s.payment_method === "CASH") {
            cashCollected += s.payment_collected;
          } else if (s.payment_method === "UPI") {
            upiCollected += s.payment_collected;
          }
        } else if (s.status === "FAILED") {
          failed++;
          failedStopsCount++;
        } else {
          pending++;
          pendingStopsCount++;
        }
      });

      let tripStatus: TripStatus = "IDLE";
      if (stops.length > 0) {
        if (completed === stops.length) {
          tripStatus = "COMPLETED";
        } else if (stops.some((s) => s.status === "EN_ROUTE") || completed > 0) {
          tripStatus = "IN_TRANSIT";
        } else {
          tripStatus = "ASSIGNED";
        }
      }

      trips.push({
        staff_id: staffId,
        driver_name: driver.name,
        driver_phone: driver.phone,
        date,
        trip_status: tripStatus,
        total_stops: stops.length,
        completed_stops: completed,
        pending_stops: pending,
        failed_stops: failed,
        full_jars_delivered: fullDelivered,
        empty_jars_collected: emptyCollected,
        damaged_jars_collected: damagedCollected,
        cash_collected: cashCollected,
        upi_collected: upiCollected,
        stops,
      });
    });

    // 3. Fetch unassigned orders awaiting dispatch on or before this date
    const { data: awaitingOrdersData } = await supabase
      .from("orders")
      .select(`
        id,
        order_number,
        delivery_address,
        delivery_date,
        total_amount,
        customer:customers(contact_name, business_name, phone),
        items:order_items(quantity)
      `)
      .is("assigned_staff_id", null)
      .in("status", ["PENDING", "CONFIRMED"])
      .order("delivery_date", { ascending: true });

    interface AwaitingOrderRow {
      id: string;
      order_number: string;
      delivery_address: string;
      delivery_date: string;
      total_amount: number;
      customer?: { contact_name: string; business_name?: string | null; phone: string } | null;
      items?: Array<{ quantity: number }> | null;
    }

    const awaitingOrders = ((awaitingOrdersData || []) as unknown as AwaitingOrderRow[]).map((o) => {
      const cust = o.customer;
      const count = (o.items || []).reduce((acc, it) => acc + Number(it.quantity || 0), 0);
      return {
        id: o.id,
        order_number: o.order_number,
        customer_name: cust?.business_name || cust?.contact_name || "Customer",
        customer_phone: cust?.phone || "",
        delivery_address: o.delivery_address,
        delivery_date: o.delivery_date,
        total_amount: Number(o.total_amount || 0),
        items_count: count,
      };
    });

    // 4. Count orders currently out for delivery
    const { count: outForDeliveryCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("status", ["ASSIGNED", "OUT_FOR_DELIVERY"])
      .eq("delivery_date", date);

    return {
      success: true,
      data: {
        date,
        trips,
        metrics: {
          total_trips: trips.length,
          total_stops: typedStops.length,
          completed_stops: completedStopsCount,
          pending_stops: pendingStopsCount,
          failed_stops: failedStopsCount,
          awaiting_assignment_count: awaitingOrders.length,
          out_for_delivery_count: outForDeliveryCount || 0,
        },
        awaiting_assignment_orders: awaitingOrders,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load admin deliveries overview.";
    return { success: false, error: message };
  }
}

/**
 * Assign an unassigned or reassign an order to a delivery driver
 */
export async function assignOrderToDriver(
  input: AssignOrderToDriverInput
): Promise<ActionResponse<{ assigned: boolean }>> {
  try {
    const validated = AssignOrderToDriverSchema.parse(input);
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to assign orders." };
    }

    // 1. Verify parent order is active
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, status, delivery_date")
      .eq("id", validated.order_id)
      .single();

    if (orderErr || !order) {
      return { success: false, error: "Order not found." };
    }

    if (order.status === "DELIVERED" || order.status === "CANCELLED") {
      return {
        success: false,
        error: `Cannot assign order in "${order.status}" status.`,
      };
    }

    // 2. Update order with assigned driver
    const { error: updateOrderErr } = await supabase
      .from("orders")
      .update({
        assigned_staff_id: validated.driver_id,
        status: "ASSIGNED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", validated.order_id);

    if (updateOrderErr) {
      return { success: false, error: updateOrderErr.message };
    }

    // 3. Upsert delivery stop for this order
    const { data: existingStop } = await supabase
      .from("delivery_stops")
      .select("id, status")
      .eq("order_id", validated.order_id)
      .maybeSingle();

    if (existingStop) {
      await supabase
        .from("delivery_stops")
        .update({
          assigned_staff_id: validated.driver_id,
          status: "ASSIGNED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingStop.id);
    } else {
      await supabase.from("delivery_stops").insert({
        order_id: validated.order_id,
        assigned_staff_id: validated.driver_id,
        sequence_number: 1,
        status: "ASSIGNED",
      });
    }

    return { success: true, data: { assigned: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to assign order to driver.";
    return { success: false, error: message };
  }
}

/**
 * Driver Trip Start: Marks assigned stops as EN_ROUTE and orders as OUT_FOR_DELIVERY
 */
export async function startDriverTrip(
  driverId?: string,
  date?: string
): Promise<ActionResponse<{ started: boolean; count: number }>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required." };
    }

    const targetDriverId = driverId || user.id;
    const targetDate = date || new Date().toISOString().split("T")[0];

    // Find assigned stops for this driver today
    const { data: stops, error: stopsErr } = await supabase
      .from("delivery_stops")
      .select("id, order_id, order:orders(id, status, delivery_date)")
      .eq("assigned_staff_id", targetDriverId)
      .eq("status", "ASSIGNED");

    if (stopsErr) {
      return { success: false, error: stopsErr.message };
    }

    interface StopWithOrder {
      id: string;
      order_id: string;
      order?: { id: string; status: string; delivery_date: string } | null;
    }

    const stopsToUpdate = ((stops || []) as unknown as StopWithOrder[]).filter((s) => {
      return !s.order?.delivery_date || s.order.delivery_date === targetDate;
    });

    if (stopsToUpdate.length === 0) {
      return {
        success: true,
        data: { started: false, count: 0 },
      };
    }

    const stopIds = stopsToUpdate.map((s) => s.id);
    const orderIds = stopsToUpdate.map((s) => s.order_id);

    // Update stops to EN_ROUTE
    await supabase
      .from("delivery_stops")
      .update({ status: "EN_ROUTE", updated_at: new Date().toISOString() })
      .in("id", stopIds);

    // Update parent orders to OUT_FOR_DELIVERY
    await supabase
      .from("orders")
      .update({ status: "OUT_FOR_DELIVERY", updated_at: new Date().toISOString() })
      .in("id", orderIds)
      .eq("status", "ASSIGNED");

    return { success: true, data: { started: true, count: stopIds.length } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to start driver trip.";
    return { success: false, error: message };
  }
}

/**
 * Driver Daily Manifest for Mobile Interface
 * Real-time stops assigned to the logged-in driver for today with full customer instructions.
 */
export async function getDriverDailyManifest(
  driverId?: string
): Promise<ActionResponse<DeliveryStopDetail[]>> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Authentication required to view driver route." };
    }

    const targetDriverId = driverId || user.id;
    const today = new Date().toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("delivery_stops")
      .select(`
        id,
        order_id,
        assigned_staff_id,
        sequence_number,
        status,
        actual_delivered_quantity,
        empty_jars_collected,
        damaged_jars_collected,
        payment_collected,
        payment_method,
        notes,
        failure_reason,
        executed_at,
        order:orders!inner(
          id,
          order_number,
          customer_id,
          delivery_address,
          delivery_date,
          total_amount,
          status,
          customer:customers(id, contact_name, business_name, phone, delivery_instructions),
          items:order_items(
            product_id,
            quantity,
            delivered_quantity,
            product:products(name, is_reusable_jar)
          )
        )
      `)
      .eq("assigned_staff_id", targetDriverId)
      .eq("order.delivery_date", today)
      .order("sequence_number", { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    interface StopRow {
      id: string;
      order_id: string;
      sequence_number: number;
      status: DeliveryStopStatus;
      actual_delivered_quantity?: number;
      empty_jars_collected?: number;
      damaged_jars_collected?: number;
      payment_collected?: number;
      payment_method?: "CASH" | "UPI" | "CREDIT" | null;
      notes?: string | null;
      failure_reason?: string | null;
      executed_at?: string | null;
      order: {
        id: string;
        order_number: string;
        customer_id: string;
        delivery_address: string;
        total_amount: number;
        customer?: {
          id: string;
          contact_name: string;
          business_name?: string | null;
          phone: string;
          delivery_instructions?: string | null;
        } | null;
        items?: Array<{
          product_id: string;
          quantity: number;
          delivered_quantity: number;
          product?: { name: string; is_reusable_jar: boolean } | null;
        }> | null;
      };
    }

    const stops: DeliveryStopDetail[] = ((data || []) as unknown as StopRow[]).map((row) => {
      const cust = row.order.customer;
      return {
        id: row.id,
        order_id: row.order_id,
        order_number: row.order.order_number,
        customer_id: row.order.customer_id,
        customer_name: cust?.business_name || cust?.contact_name || "Customer",
        customer_phone: cust?.phone || "",
        delivery_address: row.order.delivery_address,
        delivery_instructions: cust?.delivery_instructions || null,
        sequence_number: row.sequence_number,
        status: row.status,
        order_total_amount: Number(row.order.total_amount || 0),
        actual_delivered_quantity: Number(row.actual_delivered_quantity || 0),
        empty_jars_collected: Number(row.empty_jars_collected || 0),
        damaged_jars_collected: Number(row.damaged_jars_collected || 0),
        payment_collected: Number(row.payment_collected || 0),
        payment_method: row.payment_method || null,
        delivery_notes: row.notes || null,
        failure_reason: row.failure_reason || null,
        executed_at: row.executed_at || null,
        items: (row.order.items || []).map((it) => ({
          product_id: it.product_id,
          product_name: it.product?.name || "Product",
          ordered_quantity: Number(it.quantity || 0),
          delivered_quantity: Number(it.delivered_quantity || 0),
          is_reusable_jar: it.product?.is_reusable_jar || false,
        })),
      };
    });

    return { success: true, data: stops };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load driver manifest.";
    return { success: false, error: message };
  }
}

/**
 * Driver Collection Reconciliation & Evening Cash Settlement Overview
 * Provides granular payment breakdown against recorded cash handover state.
 */
export async function getDriverCollectionsReconciliation(params?: {
  date?: string;
  driverId?: string;
}): Promise<ActionResponse<DriverDailySettlementSummary[]>> {
  try {
    const supabase = await createClient();
    const targetDate = params?.date || new Date().toISOString().split("T")[0];

    // 1. Fetch staff members
    let staffQuery = supabase
      .from("profiles")
      .select("id, full_name, phone, role, is_active")
      .eq("is_active", true);

    if (params?.driverId) {
      staffQuery = staffQuery.eq("id", params.driverId);
    }

    const { data: staffList, error: staffError } = await staffQuery;
    if (staffError) {
      return { success: false, error: staffError.message };
    }

    // 2. Fetch customer payments collected on this date
    let paymentsQuery = supabase
      .from("customer_payments")
      .select(`
        id,
        payment_number,
        payment_date,
        collected_by_staff_id,
        customer_id,
        order_id,
        invoice_id,
        amount,
        payment_method,
        reference_number,
        customer:customers(contact_name, business_name),
        order:orders(order_number)
      `)
      .eq("payment_date", targetDate);

    if (params?.driverId) {
      paymentsQuery = paymentsQuery.eq("collected_by_staff_id", params.driverId);
    }

    const { data: paymentsData, error: paymentsError } = await paymentsQuery;
    if (paymentsError) {
      return { success: false, error: paymentsError.message };
    }

    // 3. Fetch existing cash_handovers on this date
    let handoversQuery = supabase
      .from("cash_handovers")
      .select(`
        id,
        staff_id,
        handover_date,
        opening_float,
        route_cash_collected,
        on_route_expenses,
        expected_cash,
        cash_handed_over,
        upi_collected,
        variance,
        status,
        verified_by,
        settled_at,
        verifier:profiles!cash_handovers_verified_by_fkey(full_name)
      `)
      .eq("handover_date", targetDate);

    if (params?.driverId) {
      handoversQuery = handoversQuery.eq("staff_id", params.driverId);
    }

    const { data: handoversData } = await handoversQuery;

    interface HandoverRow {
      id: string;
      staff_id: string;
      handover_date: string;
      opening_float: number;
      route_cash_collected: number;
      on_route_expenses: number;
      expected_cash: number;
      cash_handed_over: number;
      upi_collected: number;
      variance: number;
      status: CashHandoverStatus;
      verified_by?: string | null;
      settled_at?: string | null;
      verifier?: { full_name: string } | null;
    }

    const handoversMap = new Map<string, HandoverRow>();
    ((handoversData || []) as unknown as HandoverRow[]).forEach((h) => {
      handoversMap.set(h.staff_id, h);
    });

    // 4. Fetch on-route approved expenses created by staff on this date
    const { data: expensesData } = await supabase
      .from("expenses")
      .select("amount, created_by")
      .eq("expense_date", targetDate);

    const driverExpensesMap = new Map<string, number>();
    (expensesData || []).forEach((e) => {
      if (e.created_by) {
        const cur = driverExpensesMap.get(e.created_by) || 0;
        driverExpensesMap.set(e.created_by, cur + Number(e.amount || 0));
      }
    });

    // Map payments by driver
    interface PaymentRow {
      id: string;
      payment_number: string;
      payment_date: string;
      collected_by_staff_id?: string | null;
      customer_id: string;
      order_id?: string | null;
      invoice_id?: string | null;
      amount: number;
      payment_method: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE";
      reference_number?: string | null;
      customer?: { contact_name: string; business_name?: string | null } | null;
      order?: { order_number: string } | null;
    }

    const driverPaymentsMap = new Map<string, DriverPaymentSettlementRecord[]>();

    ((paymentsData || []) as unknown as PaymentRow[]).forEach((p) => {
      const driverId = p.collected_by_staff_id;
      if (!driverId) return;

      if (!driverPaymentsMap.has(driverId)) {
        driverPaymentsMap.set(driverId, []);
      }

      const cust = p.customer;
      const custName = cust?.business_name || cust?.contact_name || "Customer";
      const existingHandover = handoversMap.get(driverId);

      driverPaymentsMap.get(driverId)!.push({
        payment_id: p.id,
        payment_number: p.payment_number,
        payment_date: p.payment_date,
        driver_id: driverId,
        driver_name: "", // populated below
        customer_id: p.customer_id,
        customer_name: custName,
        order_id: p.order_id || "",
        order_number: p.order?.order_number || "-",
        invoice_id: p.invoice_id || null,
        amount: Number(p.amount || 0),
        payment_method: p.payment_method,
        reference_number: p.reference_number || "-",
        is_settled: existingHandover?.status === "SETTLED",
        handover_id: existingHandover?.id || null,
      });
    });

    // Build summaries for all relevant drivers
    const summaries: DriverDailySettlementSummary[] = [];

    (staffList || []).forEach((st) => {
      const driverPayments = driverPaymentsMap.get(st.id) || [];
      const handover = handoversMap.get(st.id);
      const verifiedExpense = driverExpensesMap.get(st.id) || 0;

      // Only display drivers who have payments, expenses, or an existing handover record
      if (driverPayments.length === 0 && !handover && verifiedExpense === 0) {
        return;
      }

      // Populate driver name on payments
      driverPayments.forEach((p) => {
        p.driver_name = st.full_name;
      });

      let calculatedCash = 0;
      let calculatedUpi = 0;

      driverPayments.forEach((p) => {
        if (p.payment_method === "CASH") {
          calculatedCash += p.amount;
        } else {
          calculatedUpi += p.amount;
        }
      });

      const openingFloat = handover ? Number(handover.opening_float || 0) : 0;
      const onRouteExp = handover
        ? Number(handover.on_route_expenses || 0)
        : verifiedExpense;
      const routeCash = handover
        ? Number(handover.route_cash_collected || 0)
        : calculatedCash;
      const upiCollected = handover
        ? Number(handover.upi_collected || 0)
        : calculatedUpi;
      const expectedCash = openingFloat + routeCash - onRouteExp;
      const handedOver = handover ? Number(handover.cash_handed_over || 0) : 0;
      const variance = handover ? Number(handover.variance || 0) : handedOver - expectedCash;
      const status: CashHandoverStatus = handover
        ? handover.status
        : "PENDING_VERIFICATION";

      summaries.push({
        driver_id: st.id,
        driver_name: st.full_name,
        driver_phone: st.phone,
        date: targetDate,
        opening_float: openingFloat,
        route_cash_collected: routeCash,
        on_route_expenses: onRouteExp,
        expected_cash: expectedCash,
        cash_handed_over: handedOver,
        upi_collected: upiCollected,
        variance,
        status,
        handover_id: handover?.id || null,
        settled_at: handover?.settled_at || null,
        verified_by: handover?.verified_by || null,
        verified_by_name: handover?.verifier?.full_name || null,
        payments: driverPayments,
      });
    });

    return { success: true, data: summaries };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load driver collections reconciliation.";
    return { success: false, error: message };
  }
}

/**
 * Driver Evening Cash Settlement Execution (Owner Only)
 * Enforces Section 3.3 equation:
 * Expected Cash = Opening Float + Route Cash Collections - Approved On-Route Expenses
 *
 * Atomically executes via public.rpc_settle_driver_cash with row-level locking,
 * duplicate prevention, balanced ledger posting, and immutable audit logging.
 *
 * Note on Opening Float: Opening float is declared and verified by the business owner
 * at settlement (or morning vehicle dispatch) and is not independently verified by
 * automated banking or database telemetry.
 */
export async function settleDriverDailyCash(
  input: SettleDriverCashInput
): Promise<
  ActionResponse<{
    handover_id: string;
    expected_cash: number;
    cash_handed_over: number;
    variance: number;
    status: CashHandoverStatus;
  }>
> {
  try {
    const validated = SettleDriverCashSchema.parse(input);
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("rpc_settle_driver_cash", {
      p_driver_id: validated.driver_id,
      p_handover_date: validated.handover_date,
      p_opening_float: validated.opening_float,
      p_cash_handed_over: validated.cash_handed_over,
      p_on_route_expenses: validated.on_route_expenses || 0,
      p_notes: validated.notes || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (!data || !data.success) {
      return { success: false, error: "Failed to settle driver cash handover." };
    }

    return {
      success: true,
      data: {
        handover_id: data.handover_id,
        expected_cash: Number(data.expected_cash),
        cash_handed_over: Number(data.cash_handed_over),
        variance: Number(data.variance),
        status: data.status,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to settle driver cash.";
    return { success: false, error: message };
  }
}

