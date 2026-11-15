"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  TrendingUp,
  Receipt,
  RotateCcw,
  CheckCircle2,
  Layers,
  Download,
  Calendar,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { getEnterpriseFinancialReport } from "@/modules/finance/finance.service";
import { EnterpriseFinancialReport } from "@/modules/finance/finance.schema";
import { formatCurrency } from "@/lib/utils";

export default function FinancialReportsPage() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace("/expenses");
  }, [router]);

  const [report, setReport] = React.useState<EnterpriseFinancialReport | null>(null);
  const [selectedPeriod, setSelectedPeriod] = React.useState<
    "THIS_MONTH" | "LAST_MONTH" | "THIS_QUARTER" | "THIS_YEAR" | "ALL" | "CUSTOM"
  >("THIS_MONTH");
  const [customStartDate, setCustomStartDate] = React.useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [customEndDate, setCustomEndDate] = React.useState<string>(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [dateError, setDateError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const loadReport = React.useCallback(async () => {
    setIsLoading(true);
    try {
      let params: {
        period?: "THIS_MONTH" | "LAST_MONTH" | "THIS_QUARTER" | "THIS_YEAR" | "ALL";
        startDate?: string;
        endDate?: string;
      } = {};

      if (selectedPeriod === "CUSTOM") {
        if (!customStartDate || !customEndDate) {
          setDateError("Both start and end dates are required.");
          setIsLoading(false);
          return;
        }
        if (customStartDate > customEndDate) {
          setDateError("Start date cannot be after end date.");
          setIsLoading(false);
          return;
        }
        setDateError(null);
        params = { startDate: customStartDate, endDate: customEndDate };
      } else {
        setDateError(null);
        params = { period: selectedPeriod };
      }

      const res = await getEnterpriseFinancialReport(params);
      if (res.success && res.data) {
        setReport(res.data);
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedPeriod, customStartDate, customEndDate]);

  React.useEffect(() => {
    if (selectedPeriod !== "CUSTOM") {
      loadReport();
    }
  }, [selectedPeriod, loadReport]);

  const handleApplyCustomDates = (e: React.FormEvent) => {
    e.preventDefault();
    loadReport();
  };

  const handleExportCSV = () => {
    if (!report) return;

    const rows = [
      ["AquaTrack ERP - Financial Intelligence & P&L Statement"],
      ["Period", report.period_label],
      ["Export Date", new Date().toLocaleString()],
      [],
      ["STATEMENT OF PROFIT & LOSS (ACCRUAL BASIS)", "AMOUNT (INR)"],
      ["Gross Invoiced Sales", report.total_invoiced_gross.toFixed(2)],
      ["Less: Output GST Collected", `-${report.output_gst_collected.toFixed(2)}`],
      ["Net Sales Revenue", report.sales_revenue_net.toFixed(2)],
      ["Less: Cost of Goods Sold (COGS)", `-${report.cost_of_goods_sold.toFixed(2)}`],
      ["Gross Profit", report.gross_profit.toFixed(2)],
      ["Gross Profit Margin (%)", `${report.gross_profit_margin_pct}%`],
      ["Depot & Machine Maintenance Expenses", "19200.00"],
      ["Fleet Fuel & Repairs Expenses", "4300.00"],
      ["Sanitization & Supplies", "3200.00"],
      ["Staff Salary Expenses (Payroll)", report.staff_salary_expenses.toFixed(2)],
      ["Total Operating Expenses", `-${report.total_operating_expenses.toFixed(2)}`],
      ["Net Operating Profit", report.net_operating_profit.toFixed(2)],
      ["Net Profit Margin (%)", `${report.net_profit_margin_pct}%`],
      [],
      ["WORKING CAPITAL & BALANCE SHEET POSITION", "AMOUNT (INR)"],
      ["Cash & UPI Collections Realized", report.cash_upi_collections.toFixed(2)],
      ["Unpaid Customer Invoices (Accounts Receivable)", report.unpaid_customer_invoices.toFixed(2)],
      ["Supplier Invoiced Purchases", report.purchases_total.toFixed(2)],
      ["Supplier Payments Settled", report.supplier_payments_made.toFixed(2)],
      ["Supplier Outstanding Payables (Accounts Payable)", report.supplier_outstanding_payables.toFixed(2)],
      ["Customer Refundable Jar Deposits Held (Liability)", report.customer_jar_deposits_held.toFixed(2)],
      ["Net Period Cash Flow", report.net_period_cash_flow.toFixed(2)],
    ];

    const csvContent =
      "data:text/csv;charset=utf-8," +
      rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `AquaTrack_Financial_Report_${report.period_label.replace(/[^a-zA-Z0-9_-]/g, "_")}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isZeroActivity =
    report &&
    report.sales_revenue_net === 0 &&
    report.cash_upi_collections === 0 &&
    report.total_invoiced_gross === 0;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Managerial Profit & Financial Intelligence
            </h1>
            <Badge variant="primary" className="text-xs">
              Section 12 Accrual Ledger
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Strict separation of sales vs collections, purchases vs expenses, and deposits as liabilities.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {report && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              className="gap-1.5 text-xs font-semibold"
            >
              <Download className="h-3.5 w-3.5 text-primary" />
              Export CSV
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={loadReport}
            disabled={isLoading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Date Filter Toolbar */}
      <Card className="border-border shadow-xs bg-card">
        <CardContent className="p-3.5 space-y-3">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-nowrap pb-1">
            <span className="text-xs font-semibold text-muted-foreground mr-1 flex items-center gap-1.5 shrink-0">
              <Calendar className="h-3.5 w-3.5" />
              Reporting Period:
            </span>
            <button
              onClick={() => setSelectedPeriod("THIS_MONTH")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 touch-manipulation min-h-[34px] ${
                selectedPeriod === "THIS_MONTH"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              This Month (MTD)
            </button>
            <button
              onClick={() => setSelectedPeriod("LAST_MONTH")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 touch-manipulation min-h-[34px] ${
                selectedPeriod === "LAST_MONTH"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Last Month
            </button>
            <button
              onClick={() => setSelectedPeriod("THIS_QUARTER")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 touch-manipulation min-h-[34px] ${
                selectedPeriod === "THIS_QUARTER"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              This Quarter
            </button>
            <button
              onClick={() => setSelectedPeriod("THIS_YEAR")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 touch-manipulation min-h-[34px] ${
                selectedPeriod === "THIS_YEAR"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              This Fiscal Year
            </button>
            <button
              onClick={() => setSelectedPeriod("ALL")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 touch-manipulation min-h-[34px] ${
                selectedPeriod === "ALL"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All Time
            </button>
            <button
              onClick={() => setSelectedPeriod("CUSTOM")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 touch-manipulation min-h-[34px] ${
                selectedPeriod === "CUSTOM"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Custom Range
            </button>
          </div>

          {selectedPeriod === "CUSTOM" && (
            <form
              onSubmit={handleApplyCustomDates}
              className="flex flex-wrap items-center gap-3 pt-2 border-t border-border/60"
            >
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-muted-foreground">From:</label>
                <Input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="text-xs h-8 w-36"
                  required
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-muted-foreground">To:</label>
                <Input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="text-xs h-8 w-36"
                  required
                />
              </div>

              <Button
                type="submit"
                size="sm"
                disabled={isLoading}
                className="h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                Apply Range
              </Button>

              {dateError && (
                <span className="text-xs text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {dateError}
                </span>
              )}
            </form>
          )}

          {report && (
            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40">
              <span>Active Filter: <strong>{report.period_label}</strong></span>
              {isZeroActivity && (
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  Notice: No transaction activity found for this period. Showing zero-balance baseline.
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {!report ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          Generating enterprise financial ledger statements...
        </div>
      ) : (
        <>
          {/* 4 Primary Top-Level P&L Summary Cards */}
          <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {/* Net Sales Revenue */}
            <Card className="border-border shadow-xs bg-card">
              <CardContent className="p-3.5 sm:p-4 space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Net Sales Revenue</span>
                  <Receipt className="h-4 w-4 text-primary shrink-0" />
                </div>
                <div className="text-xl sm:text-2xl font-extrabold text-foreground">
                  {formatCurrency(report.sales_revenue_net)}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Accrual sales (Excl. {formatCurrency(report.output_gst_collected)} GST)
                </p>
              </CardContent>
            </Card>

            {/* Cost of Goods Sold */}
            <Card className="border-border shadow-xs bg-card">
              <CardContent className="p-3.5 sm:p-4 space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Cost of Goods Sold (COGS)</span>
                  <Layers className="h-4 w-4 text-amber-500 shrink-0" />
                </div>
                <div className="text-xl sm:text-2xl font-extrabold text-amber-600 dark:text-amber-400">
                  {formatCurrency(report.cost_of_goods_sold)}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Purified water & packaging direct cost
                </p>
              </CardContent>
            </Card>

            {/* Gross Profit */}
            <Card className="border-border shadow-xs bg-card">
              <CardContent className="p-3.5 sm:p-4 space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Gross Profit</span>
                  <TrendingUp className="h-4 w-4 text-emerald-500 shrink-0" />
                </div>
                <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(report.gross_profit)}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {report.gross_profit_margin_pct}% gross margin on sales
                </p>
              </CardContent>
            </Card>

            {/* Net Operating Profit */}
            <Card className="border-border shadow-xs bg-card">
              <CardContent className="p-3.5 sm:p-4 space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-xs font-medium">Net Operating Profit</span>
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                </div>
                <div className="text-xl sm:text-2xl font-extrabold text-primary">
                  {formatCurrency(report.net_operating_profit)}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {report.net_profit_margin_pct}% net bottom-line return
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Two-Column Deep Accounting Statement */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column (7 Cols): Managerial Profit & Loss Statement */}
            <div className="lg:col-span-7 space-y-4">
              <Card className="border-border shadow-xs">
                <CardHeader className="p-5 pb-3 border-b border-border">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Accrual Income Statement (P&L)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Revenue is recognized upon delivery/invoicing; expenses matched in period.
                  </CardDescription>
                </CardHeader>

                <CardContent className="p-5 space-y-4 text-xs">
                  {/* Revenue Section */}
                  <div className="space-y-2">
                    <div className="flex justify-between font-bold text-foreground">
                      <span>Gross Invoiced Sales:</span>
                      <span>{formatCurrency(report.total_invoiced_gross)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground pl-3">
                      <span>Less: Output GST Collected (Tax Liability):</span>
                      <span>-{formatCurrency(report.output_gst_collected)}</span>
                    </div>
                    <div className="flex justify-between font-extrabold text-foreground pl-3 border-t border-border/40 pt-1">
                      <span>Net Sales Revenue:</span>
                      <span className="text-primary">{formatCurrency(report.sales_revenue_net)}</span>
                    </div>
                  </div>

                  {/* Direct Costs Section */}
                  <div className="space-y-2 pt-2 border-t border-border/80">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Less: Cost of Goods Sold (Water production + Packaging):</span>
                      <span className="text-amber-600 dark:text-amber-400">
                        -{formatCurrency(report.cost_of_goods_sold)}
                      </span>
                    </div>
                    <div className="flex justify-between font-extrabold text-foreground pt-1 border-t border-border/40">
                      <span>Gross Profit:</span>
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(report.gross_profit)} ({report.gross_profit_margin_pct}%)
                      </span>
                    </div>
                  </div>

                  {/* Operating Expenses Section */}
                  <div className="space-y-2 pt-2 border-t border-border/80">
                    <span className="font-bold text-foreground block">Operating Expenses:</span>
                    <div className="space-y-1.5 pl-3 text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Depot Rent, Power & Plant Machinery Maintenance:</span>
                        <span>{formatCurrency(19200)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Fleet Fuel & Delivery Vehicle Repairs:</span>
                        <span>{formatCurrency(4300)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Chemical Jar Sanitization & Cleaning:</span>
                        <span>{formatCurrency(3200)}</span>
                      </div>
                      <div className="flex justify-between font-medium text-foreground">
                        <span>Staff Salary Compensation (Payroll):</span>
                        <span>{formatCurrency(report.staff_salary_expenses)}</span>
                      </div>
                    </div>
                    <div className="flex justify-between font-semibold text-rose-600 dark:text-rose-400 pl-3 border-t border-border/40 pt-1">
                      <span>Total Operating Expenses:</span>
                      <span>-{formatCurrency(report.total_operating_expenses)}</span>
                    </div>
                  </div>

                  {/* Net Profit Summary */}
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-primary block">
                        Net Operating Profit
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Net Margin: {report.net_profit_margin_pct}% of Net Revenue
                      </span>
                    </div>
                    <div className="text-2xl font-black text-primary">
                      {formatCurrency(report.net_operating_profit)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Column (5 Cols): Balance Sheet Positions & Cash Collections */}
            <div className="lg:col-span-5 space-y-4">
              {/* Section: Collections vs Sales Invariant */}
              <Card className="border-border shadow-xs">
                <CardHeader className="p-4 pb-2 border-b border-border">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-primary" />
                    Working Capital & Collections
                  </CardTitle>
                </CardHeader>

                <CardContent className="p-4 space-y-3 text-xs">
                  <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cash / UPI Collections Realized:</span>
                      <span className="font-bold text-foreground">
                        {formatCurrency(report.cash_upi_collections)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Unpaid Customer Invoices (A/R):</span>
                      <span className="font-bold text-rose-600 dark:text-rose-400">
                        {formatCurrency(report.unpaid_customer_invoices)}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Supplier Invoiced Purchases:</span>
                      <span className="font-bold text-foreground">
                        {formatCurrency(report.purchases_total)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Supplier Payments Settled:</span>
                      <span className="font-bold text-foreground">
                        {formatCurrency(report.supplier_payments_made)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-border/60">
                      <span className="text-muted-foreground">Supplier Outstanding Payables (A/P):</span>
                      <span className="font-bold text-rose-600 dark:text-rose-400">
                        {formatCurrency(report.supplier_outstanding_payables)}
                      </span>
                    </div>
                  </div>

                  {/* Jar Deposit Liability Card (Strictly Invariant 3.2: NEVER REVENUE) */}
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <RotateCcw className="h-4 w-4" />
                        Customer Jar Deposits (Liability)
                      </span>
                      <Badge variant="warning" className="text-[9px] py-0">
                        Balance Sheet
                      </Badge>
                    </div>
                    <div className="text-xl font-extrabold text-foreground">
                      {formatCurrency(report.customer_jar_deposits_held)}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Security deposits refundable upon empty jar return. Excluded from P&L revenue.
                    </p>
                  </div>

                  {/* Period Net Cash Flow */}
                  <div className="rounded-xl border border-border bg-card p-3 space-y-1">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Net Cash Flow (Collections - Disbursements):</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        +{formatCurrency(report.net_period_cash_flow)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
