import { z } from "zod";

export const DashboardDateRangeTypeEnum = z.enum([
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "custom",
]);

export type DashboardDateRangeType = z.infer<typeof DashboardDateRangeTypeEnum>;

export interface DashboardDateRangeParams {
  range: DashboardDateRangeType;
  customFrom?: string;
  customTo?: string;
}

export interface DashboardKPICards {
  orderCount: number;
  orderRevenue: number;
  completedDeliveries: number;
  pendingOrdersCount: number;
  awaitingDeliveryCount: number;
  activeCustomersCount: number;
  totalReceivables: number;
  inventoryStockSummary: {
    totalProducts: number;
    totalUnits: number;
    totalValuation: number;
    lowStockCount: number;
  };
  posSalesCount: number;
  posSalesTotal: number;
  expensesTotal: number;
}

export interface DashboardFinancialOverview {
  salesRevenue: number;
  costOfGoodsSold: number;
  grossProfit: number;
  grossProfitMarginPct: number;
  operatingExpenses: number;
  netOperatingProfit: number;
  netProfitMarginPct: number;
  cashCollections: number;
  upiBankCollections: number;
  totalCollections: number;
  accountsReceivable: number; // Cumulative / Lifetime
  accountsPayable: number;    // Cumulative / Lifetime
}

export interface DailyChartPoint {
  day: string;
  date: string;
  sales: number;
  collections: number;
}

export interface OperationalAlertItem {
  id: string;
  type: "low_stock" | "pending_dispatch" | "overdue_balance" | "jar_variance";
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  actionLabel: string;
  actionHref: string;
}

export interface DashboardRecentActivityItem {
  id: string;
  reference: string;
  party: string;
  type: "ORDER" | "DELIVERY" | "CUSTOMER_PAYMENT" | "SUPPLIER_PAYMENT" | "POS_SALE" | "EXPENSE";
  typeLabel: string;
  amount: number;
  status: string;
  timestamp: string;
  rawDate: string;
  href?: string;
}

export interface DashboardRunningOrderItem {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryDate: string;
  status: string;
  totalAmount: number;
  paymentStatus: string;
  assignedStaffName?: string;
  itemsSummary: string;
  totalQuantity: number;
  deliveredQuantity: number;
  deliveryProgressPct: number;
}

export interface DashboardSummaryData {
  dateRange: {
    range: DashboardDateRangeType;
    from: string;
    to: string;
    label: string;
  };
  kpis: DashboardKPICards;
  financials: DashboardFinancialOverview;
  trendChart: DailyChartPoint[];
  alerts: OperationalAlertItem[];
  recentActivity: DashboardRecentActivityItem[];
  runningOrders?: DashboardRunningOrderItem[];
}

/**
 * Calculates start and end YYYY-MM-DD date strings for a given range type
 */
export function getDashboardDateRange(
  range: DashboardDateRangeType,
  customFrom?: string,
  customTo?: string,
  referenceDate: Date = new Date()
): { startDate: string; endDate: string; label: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (range === "custom" && customFrom && customTo) {
    return {
      startDate: customFrom,
      endDate: customTo,
      label: `Custom (${customFrom} to ${customTo})`,
    };
  }

  const y = referenceDate.getFullYear();
  const m = referenceDate.getMonth();
  const d = referenceDate.getDate();

  if (range === "today") {
    const todayStr = toDateStr(referenceDate);
    return {
      startDate: todayStr,
      endDate: todayStr,
      label: `Today (${todayStr})`,
    };
  }

  if (range === "yesterday") {
    const yesterday = new Date(y, m, d - 1);
    const yestStr = toDateStr(yesterday);
    return {
      startDate: yestStr,
      endDate: yestStr,
      label: `Yesterday (${yestStr})`,
    };
  }

  if (range === "this_week") {
    const dayOfWeek = referenceDate.getDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(y, m, d + diffToMonday);
    const startStr = toDateStr(monday);
    const endStr = toDateStr(referenceDate);
    return {
      startDate: startStr,
      endDate: endStr,
      label: `This Week (${startStr} to ${endStr})`,
    };
  }

  if (range === "this_month") {
    const firstOfMonth = new Date(y, m, 1);
    const lastOfMonth = new Date(y, m + 1, 0);
    const startStr = toDateStr(firstOfMonth);
    const endStr = toDateStr(lastOfMonth);
    return {
      startDate: startStr,
      endDate: endStr,
      label: `This Month (${y}-${pad(m + 1)})`,
    };
  }

  // Default fallback to today
  const defaultStr = toDateStr(referenceDate);
  return {
    startDate: defaultStr,
    endDate: defaultStr,
    label: `Today (${defaultStr})`,
  };
}

