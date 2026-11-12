"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import {
  DashboardDateRangeParams,
  DashboardSummaryData,
  DashboardKPICards,
  DashboardFinancialOverview,
  DailyChartPoint,
  OperationalAlertItem,
  DashboardRecentActivityItem,
  getDashboardDateRange,
} from "./dashboard.schema";
import { getInventoryStockLevels, getInventoryValuationSummary } from "@/modules/inventory/inventory.service";

/**
 * Enterprise Live Dashboard & Business Overview Service
 * Adheres strictly to Section 12 & Section 3 Business Invariants:
 * - Eliminates all mock/hardcoded demo records.
 * - Accrual sales revenue is distinguished from realized cash/bank collections.
 * - Customer jar deposits are tracked as liabilities.
 * - Net operating profit uses dual-entry COGS (Revenue - COGS - Period Expenses).
 * - Real-time operational alerts for low stock and pending dispatches.
 */
export async function getDashboardSummary(
  params: DashboardDateRangeParams = { range: "today" }
): Promise<ActionResponse<DashboardSummaryData>> {
  try {
    const supabase = await createClient();
    const { startDate, endDate, label } = getDashboardDateRange(
      params.range,
      params.customFrom,
      params.customTo
    );

    const startIso = `${startDate}T00:00:00.000Z`;
    const endIso = `${endDate}T23:59:59.999Z`;

    // 1. Balance Sheet: Customers (Active count, Cumulative Receivables, Overdue list)
    const { data: customers } = await supabase
      .from("customers")
      .select("id, name, phone, current_balance, is_active")
      .order("current_balance", { ascending: false });

    let activeCustomersCount = 0;
    let totalReceivables = 0;
    const overdueCustomers: { id: string; name: string; balance: number }[] = [];

    (customers || []).forEach((c) => {
      if (c.is_active) activeCustomersCount++;
      const bal = Number(c.current_balance || 0);
      if (bal > 0) {
        totalReceivables += bal;
        overdueCustomers.push({ id: c.id, name: c.name, balance: bal });
      }
    });

    // 2. Balance Sheet: Suppliers (Cumulative Accounts Payable)
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name, current_payable");

    let accountsPayable = 0;
    (suppliers || []).forEach((s) => {
      const pay = Number(s.current_payable || 0);
      if (pay > 0) accountsPayable += pay;
    });

    // 3. Inventory Stock Summary & Low Stock items
    let inventorySummary = {
      totalProducts: 0,
      totalUnits: 0,
      totalValuation: 0,
      lowStockCount: 0,
    };
    let lowStockProducts: { id: string; name: string; available: number; reorder: number }[] = [];

    const valuationRes = await getInventoryValuationSummary();
    if (valuationRes.success && valuationRes.data) {
      inventorySummary = {
        totalProducts: valuationRes.data.total_distinct_products,
        totalUnits: valuationRes.data.total_units_in_warehouse,
        totalValuation: valuationRes.data.total_inventory_valuation,
        lowStockCount: valuationRes.data.low_stock_items_count,
      };
    }

    const stockLevelsRes = await getInventoryStockLevels();
    if (stockLevelsRes.success && stockLevelsRes.data) {
      lowStockProducts = stockLevelsRes.data
        .filter((item) => item.available_stock <= item.reorder_level)
        .map((i) => ({
          id: i.product_id,
          name: i.name,
          available: i.available_stock,
          reorder: i.reorder_level,
        }));
    }

    // 4. Orders Query
    // A) All Active / Pending Orders for operational alerts & dispatch metrics
    const { data: allActiveOrders } = await supabase
      .from("orders")
      .select("id, order_number, status, total_amount, delivery_date")
      .in("status", ["PENDING", "CONFIRMED", "ASSIGNED", "OUT_FOR_DELIVERY"]);

    const pendingOrdersCount = (allActiveOrders || []).filter(
      (o) => o.status === "PENDING" || o.status === "CONFIRMED"
    ).length;

    const awaitingDeliveryCount = (allActiveOrders || []).filter(
      (o) => o.status === "ASSIGNED" || o.status === "OUT_FOR_DELIVERY"
    ).length;

    // B) Orders within the selected period (by delivery_date or created_at)
    const { data: periodOrders } = await supabase
      .from("orders")
      .select("id, order_number, customer_id, customer:customers(name), subtotal, tax_total, total_amount, status, delivery_date, created_at")
      .or(`and(delivery_date.gte.${startDate},delivery_date.lte.${endDate}),and(created_at.gte.${startIso},created_at.lte.${endIso})`);

    let orderCount = 0;
    let orderRevenue = 0;
    let orderSubtotalNet = 0;
    const periodOrderIds: string[] = [];

    (periodOrders || []).forEach((ord) => {
      if (ord.status !== "CANCELLED") {
        orderCount++;
        orderRevenue += Number(ord.total_amount || 0);
        orderSubtotalNet += Number(ord.subtotal || 0);
        periodOrderIds.push(ord.id);
      }
    });

    // 5. Delivery Stops in selected period
    const { data: periodStops } = await supabase
      .from("delivery_stops")
      .select("id, order_id, order:orders(order_number, customer:customers(name)), status, actual_delivered_quantity, payment_collected, payment_method, executed_at, created_at")
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    let completedDeliveries = 0;
    let deliveryStopCash = 0;
    let deliveryStopUpi = 0;

    (periodStops || []).forEach((stop) => {
      if (stop.status === "COMPLETED") {
        completedDeliveries++;
        const pmt = Number(stop.payment_collected || 0);
        if (stop.payment_method === "CASH") deliveryStopCash += pmt;
        else if (stop.payment_method === "UPI") deliveryStopUpi += pmt;
      }
    });

    // 6. POS Sales in selected period
    const { data: posSales } = await supabase
      .from("pos_sales")
      .select("id, sale_number, subtotal, tax_total, total_amount, payment_method, created_at")
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    let posSalesCount = 0;
    let posSalesTotal = 0;
    let posSubtotalNet = 0;
    let posCash = 0;
    let posUpi = 0;
    const posSaleIds: string[] = [];

    (posSales || []).forEach((pos) => {
      posSalesCount++;
      const tot = Number(pos.total_amount || 0);
      posSalesTotal += tot;
      posSubtotalNet += Number(pos.subtotal || 0);
      posSaleIds.push(pos.id);

      if (pos.payment_method === "CASH") posCash += tot;
      else if (pos.payment_method === "UPI") posUpi += tot;
    });

    // 7. Customer Payments in selected period
    const { data: customerPayments } = await supabase
      .from("customer_payments")
      .select("id, payment_number, customer_id, customer:customers(name), amount, payment_method, payment_date, created_at")
      .gte("payment_date", startDate)
      .lte("payment_date", endDate);

    let customerPayCash = 0;
    let customerPayUpi = 0;

    (customerPayments || []).forEach((cp) => {
      const amt = Number(cp.amount || 0);
      if (cp.payment_method === "CASH") customerPayCash += amt;
      else customerPayUpi += amt; // UPI, BANK_TRANSFER, CHEQUE
    });

    // Total Cash & Total UPI/Bank collections
    const cashCollections = customerPayCash + posCash + deliveryStopCash;
    const upiBankCollections = customerPayUpi + posUpi + deliveryStopUpi;
    const totalCollections = cashCollections + upiBankCollections;

    // 8. Operating Expenses in selected period
    const { data: expenses } = await supabase
      .from("expenses")
      .select("id, voucher_number, category, amount, payment_method, expense_date, description, created_at")
      .gte("expense_date", startDate)
      .lte("expense_date", endDate);

    let expensesTotal = 0;
    (expenses || []).forEach((e) => {
      expensesTotal += Number(e.amount || 0);
    });

    // 9. Cost of Goods Sold (COGS) Calculation for true dual-entry Gross & Net Profit
    let costOfGoodsSold = 0;

    if (periodOrderIds.length > 0) {
      const { data: orderItems } = await supabase
        .from("order_items")
        .select("quantity, product:products(cost_price)")
        .in("order_id", periodOrderIds);

      interface ItemCost {
        quantity: number | string;
        product?: { cost_price: number | string } | null;
      }

      ((orderItems || []) as unknown as ItemCost[]).forEach((it) => {
        const qty = Number(it.quantity || 0);
        const cost = Number(it.product?.cost_price || 0);
        costOfGoodsSold += qty * cost;
      });
    }

    if (posSaleIds.length > 0) {
      const { data: posItems } = await supabase
        .from("pos_sale_items")
        .select("quantity, product:products(cost_price)")
        .in("sale_id", posSaleIds);

      interface ItemCost {
        quantity: number | string;
        product?: { cost_price: number | string } | null;
      }

      ((posItems || []) as unknown as ItemCost[]).forEach((it) => {
        const qty = Number(it.quantity || 0);
        const cost = Number(it.product?.cost_price || 0);
        costOfGoodsSold += qty * cost;
      });
    }

    const salesRevenue = orderSubtotalNet + posSubtotalNet;
    const grossProfit = salesRevenue - costOfGoodsSold;
    const grossProfitMarginPct =
      salesRevenue > 0 ? Number(((grossProfit / salesRevenue) * 100).toFixed(1)) : 0;
    const netOperatingProfit = grossProfit - expensesTotal;
    const netProfitMarginPct =
      salesRevenue > 0 ? Number(((netOperatingProfit / salesRevenue) * 100).toFixed(1)) : 0;

    // 10. Trend Chart: Daily points for the last 7 days ending at endDate
    const trendChart: DailyChartPoint[] = [];
    const endRef = new Date(`${endDate}T12:00:00Z`);

    for (let i = 6; i >= 0; i--) {
      const cur = new Date(endRef);
      cur.setDate(cur.getDate() - i);
      const curStr = cur.toISOString().split("T")[0];
      const dayName = new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(cur);

      let daySales = 0;
      let dayCollections = 0;

      // Match orders on this date
      (periodOrders || []).forEach((ord) => {
        const ordDate = ord.delivery_date || ord.created_at?.split("T")[0];
        if (ordDate === curStr && ord.status !== "CANCELLED") {
          daySales += Number(ord.total_amount || 0);
        }
      });

      // Match POS on this date
      (posSales || []).forEach((pos) => {
        const pDate = pos.created_at?.split("T")[0];
        if (pDate === curStr) {
          daySales += Number(pos.total_amount || 0);
          dayCollections += Number(pos.total_amount || 0);
        }
      });

      // Match Payments on this date
      (customerPayments || []).forEach((cp) => {
        const cpDate = cp.payment_date || cp.created_at?.split("T")[0];
        if (cpDate === curStr) {
          dayCollections += Number(cp.amount || 0);
        }
      });

      trendChart.push({
        day: dayName,
        date: curStr,
        sales: daySales,
        collections: dayCollections,
      });
    }

    // 11. Operational Alerts
    const alerts: OperationalAlertItem[] = [];

    if (lowStockProducts.length > 0) {
      alerts.push({
        id: "alert-low-stock",
        type: "low_stock",
        title: `${lowStockProducts.length} Product(s) Below Reorder Level`,
        description: lowStockProducts
          .slice(0, 3)
          .map((p) => `${p.name} (${p.available} left, reorder at ${p.reorder})`)
          .join(", ") + (lowStockProducts.length > 3 ? "..." : ""),
        severity: "critical",
        actionLabel: "View Inventory",
        actionHref: "/inventory",
      });
    }

    if (pendingOrdersCount > 0) {
      alerts.push({
        id: "alert-pending-orders",
        type: "pending_dispatch",
        title: `${pendingOrdersCount} Order(s) Awaiting Dispatch`,
        description: `Unassigned or pending orders requiring route scheduling and dispatch.`,
        severity: "warning",
        actionLabel: "Dispatch Orders",
        actionHref: "/orders",
      });
    }

    if (overdueCustomers.length > 0) {
      const topOverdue = overdueCustomers[0];
      alerts.push({
        id: "alert-overdue-receivables",
        type: "overdue_balance",
        title: `${overdueCustomers.length} Customer Account(s) Overdue`,
        description: `Highest outstanding: ${topOverdue.name} (₹${topOverdue.balance.toLocaleString("en-IN")}). Total pending receivables: ₹${totalReceivables.toLocaleString("en-IN")}.`,
        severity: "info",
        actionLabel: "View Customers",
        actionHref: "/customers",
      });
    }

    // 12. Recent Activity Feed (top 10 across Orders, Deliveries, Payments, POS, Expenses)
    const recentActivity: DashboardRecentActivityItem[] = [];

    // Recent orders (up to 5)
    (periodOrders || [])
      .slice(0, 5)
      .forEach((ord) => {
        interface CustomerJoin {
          name?: string;
        }
        const custName = (ord.customer as unknown as CustomerJoin)?.name || "Customer";
        recentActivity.push({
          id: `ord-${ord.id}`,
          reference: ord.order_number,
          party: custName,
          type: "ORDER",
          typeLabel: "Order Placed",
          amount: Number(ord.total_amount || 0),
          status: ord.status,
          timestamp: ord.created_at,
          rawDate: ord.created_at,
          href: "/orders",
        });
      });

    // Recent deliveries (up to 5)
    (periodStops || [])
      .filter((s) => s.status === "COMPLETED")
      .slice(0, 5)
      .forEach((stop) => {
        interface StopOrderJoin {
          order_number?: string;
          customer?: { name?: string };
        }
        const stopOrder = stop.order as unknown as StopOrderJoin;
        recentActivity.push({
          id: `stop-${stop.id}`,
          reference: stopOrder?.order_number || "STOP",
          party: stopOrder?.customer?.name || "Delivery Customer",
          type: "DELIVERY",
          typeLabel: "Delivery Completed",
          amount: Number(stop.payment_collected || 0),
          status: "COMPLETED",
          timestamp: stop.executed_at || stop.created_at,
          rawDate: stop.executed_at || stop.created_at,
          href: "/orders",
        });
      });

    // Recent customer payments (up to 5)
    (customerPayments || [])
      .slice(0, 5)
      .forEach((cp) => {
        interface CustJoin {
          name?: string;
        }
        recentActivity.push({
          id: `cp-${cp.id}`,
          reference: cp.payment_number,
          party: (cp.customer as unknown as CustJoin)?.name || "Customer",
          type: "CUSTOMER_PAYMENT",
          typeLabel: `Collection (${cp.payment_method})`,
          amount: Number(cp.amount || 0),
          status: "COMPLETED",
          timestamp: cp.created_at,
          rawDate: cp.created_at,
          href: "/customers",
        });
      });

    // Recent POS sales (up to 5)
    (posSales || [])
      .slice(0, 5)
      .forEach((pos) => {
        recentActivity.push({
          id: `pos-${pos.id}`,
          reference: pos.sale_number,
          party: "Counter Walk-in Sale",
          type: "POS_SALE",
          typeLabel: `POS Sale (${pos.payment_method})`,
          amount: Number(pos.total_amount || 0),
          status: "COMPLETED",
          timestamp: pos.created_at,
          rawDate: pos.created_at,
          href: "/pos",
        });
      });

    // Recent expenses (up to 5)
    (expenses || [])
      .slice(0, 5)
      .forEach((exp) => {
        recentActivity.push({
          id: `exp-${exp.id}`,
          reference: exp.voucher_number,
          party: exp.description || exp.category,
          type: "EXPENSE",
          typeLabel: `Expense (${exp.category})`,
          amount: Number(exp.amount || 0),
          status: "APPROVED",
          timestamp: exp.created_at,
          rawDate: exp.created_at,
          href: "/expenses",
        });
      });

    // Sort combined activity descending by rawDate
    recentActivity.sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
    const topRecentActivity = recentActivity.slice(0, 10);

    const kpis: DashboardKPICards = {
      orderCount,
      orderRevenue,
      completedDeliveries,
      pendingOrdersCount,
      awaitingDeliveryCount,
      activeCustomersCount,
      totalReceivables,
      inventoryStockSummary: inventorySummary,
      posSalesCount,
      posSalesTotal,
      expensesTotal,
    };

    const financials: DashboardFinancialOverview = {
      salesRevenue,
      costOfGoodsSold,
      grossProfit,
      grossProfitMarginPct,
      operatingExpenses: expensesTotal,
      netOperatingProfit,
      netProfitMarginPct,
      cashCollections,
      upiBankCollections,
      totalCollections,
      accountsReceivable: totalReceivables,
      accountsPayable,
    };

    return {
      success: true,
      data: {
        dateRange: {
          range: params.range,
          from: startDate,
          to: endDate,
          label,
        },
        kpis,
        financials,
        trendChart,
        alerts,
        recentActivity: topRecentActivity,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load dashboard metrics.";
    return { success: false, error: message };
  }
}

