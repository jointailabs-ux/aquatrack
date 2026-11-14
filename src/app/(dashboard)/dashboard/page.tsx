"use client";

import * as React from "react";
import Link from "next/link";
import {
  DollarSign,
  Clock,
  Truck,
  Receipt,
  AlertTriangle,
  PackageCheck,
  FileSpreadsheet,
  RefreshCw,
  Calendar,
  Users,
  Store,
  ArrowRight,
  TrendingUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  PlusCircle,
  UserPlus,
  ShoppingBag,
} from "lucide-react";
import dynamic from "next/dynamic";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DataTable } from "@/components/ui/DataTable";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { getDashboardSummary } from "@/modules/dashboard/dashboard.service";
import {
  DashboardDateRangeType,
  DashboardRecentActivityItem,
  DashboardSummaryData,
} from "@/modules/dashboard/dashboard.schema";

const RevenueChart = dynamic(
  () => import("@/components/charts/RevenueChart").then((m) => m.RevenueChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[240px] w-full flex items-center justify-center bg-muted/20 rounded-xl animate-pulse text-xs text-muted-foreground">
        Loading chart visualization...
      </div>
    ),
  }
);

// Module-level client cache for instant zero-latency page transitions
let cachedDashboardState: {
  key: string;
  data: DashboardSummaryData;
  timestamp: number;
} | null = null;

export default function DashboardPage() {
  const [dateRange, setDateRange] = React.useState<DashboardDateRangeType>("today");
  const [customFrom, setCustomFrom] = React.useState<string>("");
  const [customTo, setCustomTo] = React.useState<string>("");

  // Instant render from cache if available
  const [dashboardData, setDashboardData] = React.useState<DashboardSummaryData | null>(() => {
    if (cachedDashboardState && cachedDashboardState.key === "today") {
      return cachedDashboardState.data;
    }
    return null;
  });

  const [loading, setLoading] = React.useState<boolean>(() => {
    return !cachedDashboardState || cachedDashboardState.key !== "today";
  });
  const [refreshing, setRefreshing] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showMobileAnalytics, setShowMobileAnalytics] = React.useState<boolean>(false);

  const fetchSummary = React.useCallback(
    async (range: DashboardDateRangeType, from?: string, to?: string, isRefresh = false) => {
      const cacheKey = `${range}-${from || ""}-${to || ""}`;
      const hasMatchingCache = cachedDashboardState && cachedDashboardState.key === cacheKey;

      if (isRefresh) {
        setRefreshing(true);
      } else if (!hasMatchingCache) {
        setLoading(true);
      }
      setError(null);

      try {
        const res = await getDashboardSummary({
          range,
          customFrom: from,
          customTo: to,
        });

        if (res.success && res.data) {
          setDashboardData(res.data);
          cachedDashboardState = {
            key: cacheKey,
            data: res.data,
            timestamp: Date.now(),
          };
        } else {
          setError(res.error || "Failed to retrieve dashboard metrics.");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error loading dashboard metrics.";
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  React.useEffect(() => {
    fetchSummary("today");
  }, [fetchSummary]);

  const handleRangeChange = (newRange: DashboardDateRangeType) => {
    setDateRange(newRange);
    if (newRange !== "custom") {
      fetchSummary(newRange);
    }
  };

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFrom || !customTo) return;
    fetchSummary("custom", customFrom, customTo);
  };

  const activityColumns = [
    {
      header: "Reference",
      accessorKey: "reference" as const,
      cell: (tx: DashboardRecentActivityItem) => (
        <span className="font-mono font-medium text-xs text-foreground">
          {tx.reference}
        </span>
      ),
    },
    {
      header: "Party / Beneficiary",
      accessorKey: "party" as const,
      cell: (tx: DashboardRecentActivityItem) => (
        <div className="font-medium text-xs text-foreground">{tx.party}</div>
      ),
    },
    {
      header: "Type",
      accessorKey: "type" as const,
      cell: (tx: DashboardRecentActivityItem) => {
        const variants: Record<string, "default" | "secondary" | "outline" | "success" | "warning"> = {
          ORDER: "default",
          DELIVERY: "success",
          CUSTOMER_PAYMENT: "secondary",
          POS_SALE: "outline",
          EXPENSE: "warning",
          SUPPLIER_PAYMENT: "outline",
        };
        return (
          <Badge variant={variants[tx.type] || "outline"} className="text-[10px]">
            {tx.typeLabel}
          </Badge>
        );
      },
    },
    {
      header: "Amount",
      accessorKey: "amount" as const,
      cell: (tx: DashboardRecentActivityItem) => (
        <span className="font-semibold text-xs text-foreground">
          {formatCurrency(tx.amount)}
        </span>
      ),
    },
    {
      header: "Status",
      accessorKey: "status" as const,
      cell: (tx: DashboardRecentActivityItem) => {
        const isSuccess = tx.status === "COMPLETED" || tx.status === "APPROVED" || tx.status === "DELIVERED";
        const isWarning = tx.status === "PENDING" || tx.status === "ASSIGNED" || tx.status === "OUT_FOR_DELIVERY";
        return (
          <Badge
            variant={isSuccess ? "success" : isWarning ? "warning" : "secondary"}
            className="text-[10px]"
          >
            {tx.status}
          </Badge>
        );
      },
    },
    {
      header: "Time",
      accessorKey: "timestamp" as const,
      cell: (tx: DashboardRecentActivityItem) => (
        <span className="text-[11px] text-muted-foreground">
          {formatDateTime(tx.timestamp)}
        </span>
      ),
    },
    {
      header: "Action",
      cell: (tx: DashboardRecentActivityItem) => (
        tx.href ? (
          <Link
            href={tx.href}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
          >
            View <ArrowRight className="h-3 w-3" />
          </Link>
        ) : (
          <span className="text-muted-foreground">-</span>
        )
      ),
    },
  ];

  if (loading && !dashboardData) {
    return (
      <div className="space-y-4">
        {/* Mobile Skeleton */}
        <div className="space-y-3 md:hidden animate-pulse">
          <div className="h-10 w-44 rounded-xl bg-muted/40" />
          <div className="grid grid-cols-2 gap-2.5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-2xl bg-muted/40 border border-border" />
            ))}
          </div>
          <div className="h-20 rounded-2xl bg-muted/40" />
          <div className="h-44 rounded-2xl bg-muted/40" />
        </div>

        {/* Desktop Skeleton */}
        <div className="hidden md:block space-y-6">
          <PageHeader
            title="Operations & Financial Overview"
            description="Live distribution metrics, customer receivables, route execution, and managerial accounting."
          />
          <div className="grid grid-cols-4 gap-4 animate-pulse">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-28 rounded-xl bg-muted/40 border border-border" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error && !dashboardData) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Dashboard"
          description="Live distribution metrics, customer receivables, route execution, and revenue velocity."
        />
        <ErrorState
          title="Failed to Load Dashboard"
          message={error}
          onRetry={() => fetchSummary(dateRange, customFrom, customTo)}
        />
      </div>
    );
  }

  const kpis = dashboardData?.kpis || {
    orderCount: 0,
    orderRevenue: 0,
    completedDeliveries: 0,
    pendingOrdersCount: 0,
    awaitingDeliveryCount: 0,
    activeCustomersCount: 0,
    totalReceivables: 0,
    inventoryStockSummary: {
      totalProducts: 0,
      totalUnits: 0,
      totalValuation: 0,
      lowStockCount: 0,
    },
    posSalesCount: 0,
    posSalesTotal: 0,
    expensesTotal: 0,
  };

  const financials = dashboardData?.financials || {
    salesRevenue: 0,
    costOfGoodsSold: 0,
    grossProfit: 0,
    grossProfitMarginPct: 0,
    operatingExpenses: 0,
    netOperatingProfit: 0,
    netProfitMarginPct: 0,
    cashCollections: 0,
    upiBankCollections: 0,
    totalCollections: 0,
    accountsReceivable: 0,
    accountsPayable: 0,
  };

  const trendChart = dashboardData?.trendChart || [];
  const alerts = dashboardData?.alerts || [];
  const recentActivity = dashboardData?.recentActivity || [];
  const activePeriodLabel = dashboardData?.dateRange.label || "Today";

  // Delivery total for progress calculation
  const totalDeliveries = kpis.completedDeliveries + kpis.awaitingDeliveryCount;
  const deliveryPct = totalDeliveries > 0 ? Math.round((kpis.completedDeliveries / totalDeliveries) * 100) : 100;

  // Format today's date for header
  const todayFormatted = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());

  return (
    <div className="space-y-4 md:space-y-6">
      {/* =========================================================================
          MOBILE-FIRST DASHBOARD VIEW (md:hidden)
          Clean, beautiful, compact, fits in smartphone viewport with minimal scrolling
          ========================================================================= */}
      <div className="md:hidden space-y-3.5">
        {/* A. Compact Greeting and Date Bar */}
        <div className="flex items-center justify-between pt-0.5">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-lg text-foreground tracking-tight">
                Operations
              </span>
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <p className="text-[11px] text-muted-foreground font-medium">
              {todayFormatted} • Central Hub
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchSummary(dateRange, customFrom, customTo, true)}
              disabled={refreshing}
              className="h-8 px-2 text-xs rounded-xl"
              aria-label="Refresh data"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* B. Business Overview: Compact 2 × 2 Metric Grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* Tile 1: Today's Sales */}
          <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-white via-emerald-50/50 to-teal-50/30 p-3 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-900/80">Sales Revenue</span>
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-md shadow-emerald-500/25">
                <DollarSign className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-1.5">
              <span className="text-lg font-black text-emerald-950 dark:text-emerald-300 tracking-tight block">
                {formatCurrency(kpis.orderRevenue + kpis.posSalesTotal)}
              </span>
              <span className="text-[10px] text-emerald-700/80 font-semibold">
                {kpis.orderCount + kpis.posSalesCount} sales recorded
              </span>
            </div>
          </div>

          {/* Tile 2: Orders Count */}
          <div className="rounded-2xl border border-sky-200/80 bg-gradient-to-br from-white via-sky-50/50 to-blue-50/30 p-3 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-sky-900/80">Route Orders</span>
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-sky-500 text-white shadow-md shadow-sky-500/25">
                <Truck className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-1.5">
              <span className="text-lg font-black text-sky-950 dark:text-sky-300 tracking-tight block">
                {kpis.orderCount}
              </span>
              <span className="text-[10px] text-sky-700/80 font-semibold">
                {kpis.pendingOrdersCount} pending dispatch
              </span>
            </div>
          </div>

          {/* Tile 3: Outstanding A/R */}
          <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-white via-amber-50/50 to-orange-50/30 p-3 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-900/80">Customer A/R</span>
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-500 text-white shadow-md shadow-amber-500/25">
                <Clock className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-1.5">
              <span className="text-lg font-black text-amber-950 dark:text-amber-300 tracking-tight block">
                {formatCurrency(financials.accountsReceivable)}
              </span>
              <span className="text-[10px] text-amber-700/80 font-semibold">
                Pending collection
              </span>
            </div>
          </div>

          {/* Tile 4: Available Stock */}
          <div className="rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-white via-indigo-50/50 to-purple-50/30 p-3 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-indigo-900/80">Available Stock</span>
              <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-md shadow-indigo-500/25">
                <PackageCheck className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-1.5">
              <span className="text-lg font-black text-indigo-950 dark:text-indigo-300 tracking-tight block">
                {kpis.inventoryStockSummary.totalUnits}{" "}
                <span className="text-xs font-semibold text-indigo-700">units</span>
              </span>
              <span className="text-[10px] text-indigo-700/80 font-semibold">
                {kpis.inventoryStockSummary.lowStockCount > 0 ? (
                  <span className="text-destructive font-semibold">
                    {kpis.inventoryStockSummary.lowStockCount} below reorder
                  </span>
                ) : (
                  "Levels nominal"
                )}
              </span>
            </div>
          </div>
        </div>

        {/* C. Quick Actions: 4 Touch-Optimized Tiles */}
        <div className="rounded-2xl border border-border/70 bg-card p-3 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
          <div className="flex items-center justify-between mb-2 px-0.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Quick Actions
            </span>
            <span className="text-[10px] text-primary font-medium">Shortcuts</span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <Link
              href="/orders"
              className="flex flex-col items-center justify-center p-2 rounded-xl bg-primary/5 hover:bg-primary/10 active:scale-95 transition-all text-center touch-manipulation"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs mb-1">
                <PlusCircle className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-bold text-foreground truncate w-full">
                New Order
              </span>
            </Link>

            <Link
              href="/customers"
              className="flex flex-col items-center justify-center p-2 rounded-xl bg-sky-500/5 hover:bg-sky-500/10 active:scale-95 transition-all text-center touch-manipulation"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white shadow-xs mb-1">
                <UserPlus className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-bold text-foreground truncate w-full">
                Customer
              </span>
            </Link>

            <Link
              href="/pos"
              className="flex flex-col items-center justify-center p-2 rounded-xl bg-emerald-500/5 hover:bg-emerald-500/10 active:scale-95 transition-all text-center touch-manipulation"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-xs mb-1">
                <Store className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-bold text-foreground truncate w-full">
                POS Sale
              </span>
            </Link>

            <Link
              href="/purchases"
              className="flex flex-col items-center justify-center p-2 rounded-xl bg-purple-500/5 hover:bg-purple-500/10 active:scale-95 transition-all text-center touch-manipulation"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white shadow-xs mb-1">
                <ShoppingBag className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-bold text-foreground truncate w-full">
                Purchase
              </span>
            </Link>
          </div>
        </div>

        {/* D. Today's Operations: Fleet & Route Progress */}
        <div className="rounded-2xl border border-border/70 bg-card p-3 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-bold text-foreground">Delivery Execution</span>
            </div>
            <Link
              href="/deliveries"
              className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-0.5"
            >
              Manage Stops <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {/* Progress Bar */}
          <div>
            <div className="flex justify-between text-[11px] font-medium text-muted-foreground mb-1">
              <span>{kpis.completedDeliveries} completed</span>
              <span>{kpis.awaitingDeliveryCount} pending route</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${deliveryPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* E. Operational Alerts (if any) */}
        {alerts.length > 0 && (
          <div className="space-y-1.5">
            {alerts.slice(0, 2).map((al) => (
              <Link
                key={al.id}
                href={al.actionHref}
                className={`flex items-center justify-between p-2.5 rounded-xl border transition-all text-xs touch-manipulation ${
                  al.severity === "critical"
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-semibold truncate">{al.title}</span>
                </div>
                <span className="text-[10px] font-bold shrink-0 ml-2">Resolve ›</span>
              </Link>
            ))}
          </div>
        )}

        {/* F. Recent Activity Stream: Compact List */}
        <div className="rounded-2xl border border-border/70 bg-card p-3 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Recent Transactions
            </span>
            <Link href="/accounting" className="text-[11px] text-primary font-semibold hover:underline">
              Ledger ›
            </Link>
          </div>

          <div className="space-y-1.5">
            {recentActivity.slice(0, 4).map((tx) => (
              <Link
                key={tx.id}
                href={tx.href || "/orders"}
                className="flex items-center justify-between p-2 rounded-xl bg-muted/20 hover:bg-muted/40 active:scale-[0.99] transition-all text-xs"
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-[11px] text-foreground truncate">
                      {tx.reference}
                    </span>
                    <span className="text-[9px] px-1 py-0.2 rounded-sm bg-muted text-muted-foreground font-semibold">
                      {tx.typeLabel}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    {tx.party}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <span className="font-bold text-xs text-foreground block">
                    {formatCurrency(tx.amount)}
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {formatDateTime(tx.timestamp).split(",")[0]}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* G. Expandable Section for Detailed Charts & GAAP Profitability */}
        <div className="rounded-2xl border border-border/70 bg-card overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
          <button
            type="button"
            onClick={() => setShowMobileAnalytics((prev) => !prev)}
            className="w-full flex items-center justify-between p-3 text-xs font-bold text-foreground hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span>Weekly Trend & Financial P&L</span>
            </div>
            {showMobileAnalytics ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {showMobileAnalytics && (
            <div className="p-3 pt-0 border-t border-border/60 space-y-4 animate-in fade-in duration-200">
              <div className="pt-2">
                <p className="text-[11px] font-semibold text-muted-foreground mb-2">
                  7-Day Sales vs. Collections
                </p>
                <RevenueChart data={trendChart} />
              </div>

              {/* Accrual Financials summary */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/60 text-xs">
                <div className="p-2 rounded-xl bg-muted/20">
                  <span className="text-[10px] text-muted-foreground font-medium">Gross Profit</span>
                  <p className="font-bold text-emerald-600 text-sm mt-0.5">
                    {formatCurrency(financials.grossProfit)}
                  </p>
                  <span className="text-[9px] text-muted-foreground">
                    {financials.grossProfitMarginPct}% margin
                  </span>
                </div>

                <div className="p-2 rounded-xl bg-muted/20">
                  <span className="text-[10px] text-muted-foreground font-medium">Net Operating Profit</span>
                  <p className={`font-bold text-sm mt-0.5 ${financials.netOperatingProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                    {formatCurrency(financials.netOperatingProfit)}
                  </p>
                  <span className="text-[9px] text-muted-foreground">
                    {financials.netProfitMarginPct}% net margin
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* =========================================================================
          DESKTOP & TABLET VIEW (hidden md:block)
          Preserves the multi-column layout, detailed cards, and wide tables
          ========================================================================= */}
      <div className="hidden md:block space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <PageHeader
            title="Operations & Financial Overview"
            description="Live distribution metrics, customer receivables, route execution, and managerial accounting."
            badge={
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 bg-emerald-500/5">
                Live Database Active
              </Badge>
            }
          />

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchSummary(dateRange, customFrom, customTo, true)}
              disabled={refreshing}
              className="gap-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Quick Speed Launcher Bar */}
        <div className="rounded-2xl border border-sky-500/20 bg-gradient-to-r from-sky-500/5 via-primary/5 to-cyan-500/5 p-4 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Fast Operations Launchpad
              </h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Instant 1-Click Form Openers
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Link
              href="/orders?new=true"
              className="flex items-center gap-3 p-3.5 rounded-xl bg-gradient-to-br from-sky-50 via-white to-blue-50/70 border border-sky-200/80 hover:border-sky-500 hover:shadow-md hover:shadow-sky-500/15 transition-all active:scale-95 group"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white shadow-sm shadow-sky-500/30 group-hover:bg-sky-600 transition-colors">
                <Truck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-sky-950 block group-hover:text-sky-600 transition-colors">
                  + New Order
                </span>
                <span className="text-[10px] text-slate-500 truncate block">
                  Route Delivery Order
                </span>
              </div>
            </Link>

            <Link
              href="/pos"
              className="flex items-center gap-3 p-3.5 rounded-xl bg-gradient-to-br from-emerald-50 via-white to-teal-50/70 border border-emerald-200/80 hover:border-emerald-500 hover:shadow-md hover:shadow-emerald-500/15 transition-all active:scale-95 group"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 group-hover:bg-emerald-600 transition-colors">
                <Store className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-emerald-950 block group-hover:text-emerald-600 transition-colors">
                  + POS Counter
                </span>
                <span className="text-[10px] text-slate-500 truncate block">
                  Walk-in Quick Sale
                </span>
              </div>
            </Link>

            <Link
              href="/customers?new=true"
              className="flex items-center gap-3 p-3.5 rounded-xl bg-gradient-to-br from-indigo-50 via-white to-purple-50/70 border border-indigo-200/80 hover:border-indigo-500 hover:shadow-md hover:shadow-indigo-500/15 transition-all active:scale-95 group"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-sm shadow-indigo-500/30 group-hover:bg-indigo-600 transition-colors">
                <UserPlus className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-indigo-950 block group-hover:text-indigo-600 transition-colors">
                  + Add Customer
                </span>
                <span className="text-[10px] text-slate-500 truncate block">
                  30-Second Express Add
                </span>
              </div>
            </Link>

            <Link
              href="/expenses?new=true"
              className="flex items-center gap-3 p-3.5 rounded-xl bg-gradient-to-br from-amber-50 via-white to-orange-50/70 border border-amber-200/80 hover:border-amber-500 hover:shadow-md hover:shadow-amber-500/15 transition-all active:scale-95 group"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm shadow-amber-500/30 group-hover:bg-amber-600 transition-colors">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-amber-950 block group-hover:text-amber-600 transition-colors">
                  + Log Expense
                </span>
                <span className="text-[10px] text-slate-500 truncate block">
                  Fuel, Repairs & Supplies
                </span>
              </div>
            </Link>
          </div>
        </div>

        {/* Date Filter Bar */}
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-nowrap sm:flex-wrap pb-1 sm:pb-0">
              <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1 shrink-0">
                <Calendar className="h-3.5 w-3.5" /> Filter Period:
              </span>
              <Button
                variant={dateRange === "today" ? "primary" : "outline"}
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => handleRangeChange("today")}
              >
                Today
              </Button>
              <Button
                variant={dateRange === "yesterday" ? "primary" : "outline"}
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => handleRangeChange("yesterday")}
              >
                Yesterday
              </Button>
              <Button
                variant={dateRange === "this_week" ? "primary" : "outline"}
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => handleRangeChange("this_week")}
              >
                This Week
              </Button>
              <Button
                variant={dateRange === "this_month" ? "primary" : "outline"}
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => handleRangeChange("this_month")}
              >
                This Month
              </Button>
              <Button
                variant={dateRange === "custom" ? "primary" : "outline"}
                size="sm"
                className="h-8 text-xs shrink-0"
                onClick={() => handleRangeChange("custom")}
              >
                Custom Range
              </Button>
            </div>

            <div className="text-xs font-medium text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md border border-border self-start sm:self-auto shrink-0">
              Active Filter: <span className="text-foreground font-semibold">{activePeriodLabel}</span>
            </div>
          </div>

          {dateRange === "custom" && (
            <form onSubmit={handleApplyCustom} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-border">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-muted-foreground shrink-0 w-10 sm:w-auto">From:</span>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-8 text-xs w-full sm:w-36"
                  required
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-muted-foreground shrink-0 w-10 sm:w-auto">To:</span>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-8 text-xs w-full sm:w-36"
                  required
                />
              </div>
              <Button type="submit" size="sm" className="h-8 text-xs w-full sm:w-auto">
                Apply Range
              </Button>
            </form>
          )}
        </div>

        {/* Top Metric Cards: 4 Primary Financial Velocity Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-sky-200/90 bg-gradient-to-br from-white via-sky-50/50 to-blue-50/60 shadow-xs hover:shadow-md hover:shadow-sky-500/15 hover:border-sky-400 transition-all">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-sky-800">Orders & Sales (Period)</span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500 text-white shadow-sm shadow-sky-500/30">
                  <DollarSign className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black tracking-tight text-sky-950">
                  {formatCurrency(kpis.orderRevenue)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-sky-700/80">
                <span>{kpis.orderCount} active order(s)</span>
                <Link href="/orders" className="text-sky-700 hover:text-sky-900 hover:underline font-semibold inline-flex items-center gap-0.5">
                  Orders <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card className="border-emerald-200/90 bg-gradient-to-br from-white via-emerald-50/50 to-teal-50/60 shadow-xs hover:shadow-md hover:shadow-emerald-500/15 hover:border-emerald-400 transition-all">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">Collections (Cash & UPI)</span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm shadow-emerald-500/30">
                  <Receipt className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black tracking-tight text-emerald-950">
                  {formatCurrency(financials.totalCollections)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-emerald-700/80">
                {formatCurrency(financials.cashCollections)} Cash • {formatCurrency(financials.upiBankCollections)} UPI/Bank
              </p>
            </CardContent>
          </Card>

          <Card className="border-amber-200/90 bg-gradient-to-br from-white via-amber-50/50 to-orange-50/60 shadow-xs hover:shadow-md hover:shadow-amber-500/15 hover:border-amber-400 transition-all">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-800">Customer Receivables (A/R)</span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm shadow-amber-500/30">
                  <Clock className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black tracking-tight text-amber-950">
                  {formatCurrency(financials.accountsReceivable)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-amber-700/80">
                <span>Cumulative across accounts</span>
                <Link href="/customers" className="text-amber-700 hover:text-amber-900 hover:underline font-semibold inline-flex items-center gap-0.5">
                  Customers <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card className="border-purple-200/90 bg-gradient-to-br from-white via-purple-50/50 to-pink-50/60 shadow-xs hover:shadow-md hover:shadow-purple-500/15 hover:border-purple-400 transition-all">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-800">Period Operating Expenses</span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500 text-white shadow-sm shadow-purple-500/30">
                  <FileSpreadsheet className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black tracking-tight text-purple-950">
                  {formatCurrency(financials.operatingExpenses)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-purple-700/80">
                <span>Fuel, repairs & supplies</span>
                <Link href="/expenses" className="text-purple-700 hover:text-purple-900 hover:underline font-semibold inline-flex items-center gap-0.5">
                  Expenses <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Secondary Row: Inventory, POS, Delivery, and Dispatch Queue Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-blue-200/80 bg-gradient-to-br from-white to-blue-50/40 shadow-xs hover:border-blue-300 transition-all">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500 text-white shadow-xs">
                    <PackageCheck className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-800">Inventory Valuation</span>
                </div>
                <Badge variant="outline" className="text-[10px] border-blue-200 bg-blue-50 text-blue-700">
                  Warehouse Stock
                </Badge>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-xl font-bold text-slate-900">
                  {formatCurrency(kpis.inventoryStockSummary.totalValuation)}
                </span>
                <span className="text-xs font-medium text-slate-500">
                  {kpis.inventoryStockSummary.totalUnits} Units
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 flex justify-between items-center">
                <span>{kpis.inventoryStockSummary.totalProducts} active products</span>
                <Link href="/inventory" className="text-blue-600 hover:underline font-medium">
                  Stock List
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card className="border-teal-200/80 bg-gradient-to-br from-white to-teal-50/40 shadow-xs hover:border-teal-300 transition-all">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500 text-white shadow-xs">
                    <Store className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-800">Counter POS Sales</span>
                </div>
                <Badge variant="outline" className="text-[10px] border-teal-200 bg-teal-50 text-teal-700">
                  Walk-ins
                </Badge>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-xl font-bold text-slate-900">
                  {formatCurrency(kpis.posSalesTotal)}
                </span>
                <span className="text-xs font-medium text-slate-500">
                  {kpis.posSalesCount} Sales
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 flex justify-between items-center">
                <span>Cash & UPI counter</span>
                <Link href="/pos" className="text-teal-600 hover:underline font-medium">
                  Open POS
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card className="border-emerald-200/80 bg-gradient-to-br from-white to-emerald-50/40 shadow-xs hover:border-emerald-300 transition-all">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-xs">
                    <Truck className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-800">Route Deliveries</span>
                </div>
                <Badge variant="outline" className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold">
                  Fleet
                </Badge>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-xl font-bold text-emerald-950">
                  {kpis.completedDeliveries} Delivered
                </span>
                <span className="text-xs font-medium text-slate-500">
                  {kpis.awaitingDeliveryCount} Awaiting
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 flex justify-between items-center">
                <span>Delivery stop execution</span>
                <Link href="/orders" className="text-emerald-600 hover:underline font-medium">
                  Dispatch View
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card className="border-indigo-200/80 bg-gradient-to-br from-white to-indigo-50/40 shadow-xs hover:border-indigo-300 transition-all">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500 text-white shadow-xs">
                    <Users className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-800">Customers & Queue</span>
                </div>
                <Badge variant="outline" className="text-[10px] border-indigo-200 bg-indigo-50 text-indigo-700">
                  Accounts
                </Badge>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-xl font-bold text-slate-900">
                  {kpis.activeCustomersCount} Active
                </span>
                <span className="text-xs font-medium text-slate-500">
                  {kpis.pendingOrdersCount} Pending Orders
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-500 flex justify-between items-center">
                <span>Customer directory</span>
                <Link href="/customers" className="text-indigo-600 hover:underline font-medium">
                  Directory
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Middle Row: Revenue & Collections Chart + Operational Alerts Center */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm font-semibold">Weekly Sales vs. Cash Collections Velocity</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Real database aggregation of invoiced sales revenue versus realized cash & UPI collections.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-[#1e3a8a]" /> Invoiced Sales
                </span>
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-[#0ea5e9]" /> Collections
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <RevenueChart data={trendChart} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Operational Alert Centre
                </CardTitle>
                <Badge
                  variant={alerts.length > 0 ? "warning" : "success"}
                  className="text-[10px]"
                >
                  {alerts.length > 0 ? `${alerts.length} Active` : "Clear"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-2" />
                  <p className="text-xs font-semibold text-foreground">All Systems Nominal</p>
                  <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">
                    Stock levels are healthy, and all scheduled dispatches and route balances are in order.
                  </p>
                </div>
              ) : (
                alerts.map((al) => (
                  <div
                    key={al.id}
                    className={`rounded-lg border p-3 space-y-1.5 transition-colors ${
                      al.severity === "critical"
                        ? "border-destructive/30 bg-destructive/5"
                        : al.severity === "warning"
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-blue-500/20 bg-blue-500/5"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        {al.title}
                      </span>
                      <Badge
                        variant={
                          al.severity === "critical"
                            ? "destructive"
                            : al.severity === "warning"
                            ? "warning"
                            : "secondary"
                        }
                        className="text-[9px] py-0"
                      >
                        {al.severity.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {al.description}
                    </p>
                    <div className="pt-1">
                      <Link
                        href={al.actionHref}
                        className="text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {al.actionLabel} <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Dual-Entry Financial Performance Breakdown */}
        <Card className="border-border">
          <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Managerial Accounting & Profitability (Accrual Dual-Entry)
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Complies strictly with Section 12 invariants: Revenue - COGS - Period Operating Expenses = Net Profit.
              </p>
            </div>
            <Badge variant="outline" className="text-[10px] w-fit">
              GAAP / Accrual Compliant
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
              <div className="px-2 py-1">
                <span className="text-[11px] text-muted-foreground uppercase font-medium">Net Sales Revenue</span>
                <div className="text-base font-bold text-foreground mt-1">
                  {formatCurrency(financials.salesRevenue)}
                </div>
                <span className="text-[10px] text-muted-foreground">Orders & POS subtotal</span>
              </div>

              <div className="px-2 py-1">
                <span className="text-[11px] text-muted-foreground uppercase font-medium">Cost of Goods (COGS)</span>
                <div className="text-base font-bold text-foreground mt-1">
                  {formatCurrency(financials.costOfGoodsSold)}
                </div>
                <span className="text-[10px] text-muted-foreground">Unit product costs</span>
              </div>

              <div className="px-2 py-1">
                <span className="text-[11px] text-muted-foreground uppercase font-medium">Gross Profit</span>
                <div className="text-base font-bold text-emerald-600 mt-1">
                  {formatCurrency(financials.grossProfit)}
                </div>
                <span className="text-[10px] font-medium text-emerald-600">
                  {financials.grossProfitMarginPct}% margin
                </span>
              </div>

              <div className="px-2 py-1">
                <span className="text-[11px] text-muted-foreground uppercase font-medium">Operating Expenses</span>
                <div className="text-base font-bold text-purple-600 mt-1">
                  {formatCurrency(financials.operatingExpenses)}
                </div>
                <span className="text-[10px] text-muted-foreground">Period outflows</span>
              </div>

              <div className="px-2 py-1">
                <span className="text-[11px] text-muted-foreground uppercase font-medium">Net Operating Profit</span>
                <div className={`text-base font-bold mt-1 ${financials.netOperatingProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                  {formatCurrency(financials.netOperatingProfit)}
                </div>
                <span className="text-[10px] font-medium text-muted-foreground">
                  {financials.netProfitMarginPct}% net margin
                </span>
              </div>

              <div className="px-2 py-1">
                <span className="text-[11px] text-muted-foreground uppercase font-medium">Supplier Payables (A/P)</span>
                <div className="text-base font-bold text-foreground mt-1">
                  {formatCurrency(financials.accountsPayable)}
                </div>
                <div className="text-[10px] text-muted-foreground flex items-center justify-between">
                  <span>Cumulative</span>
                  <Link href="/purchases" className="text-primary hover:underline font-medium">
                    Payables
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bottom Row: Recent Database Activity Table */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Live Operational & Financial Stream</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Real-time audit log of recent orders, route deliveries, collections, POS transactions, and expenses.
              </p>
            </div>
            <Badge variant="outline" className="text-xs font-normal">
              Database Stream
            </Badge>
          </CardHeader>
          <CardContent>
            <DataTable
              data={recentActivity}
              columns={activityColumns}
              emptyTitle="No recent transactions"
              emptyDescription="There are no recent orders, deliveries, or payments recorded for this period."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
