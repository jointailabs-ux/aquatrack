"use client";

import * as React from "react";
import Link from "next/link";
import {
  Receipt,
  QrCode,
  Banknote,
  Truck,
  ShieldCheck,
  RefreshCw,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatCurrency } from "@/lib/utils";
import {
  getDriverCollectionsReconciliation,
  settleDriverDailyCash,
} from "@/modules/delivery/delivery.service";
import {
  DriverDailySettlementSummary,
} from "@/modules/delivery/delivery.schema";

export default function PaymentsSettlementPage() {
  const { addToast } = useToast();
  const [selectedDate, setSelectedDate] = React.useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [loading, setLoading] = React.useState<boolean>(true);
  const [refreshing, setRefreshing] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [summaries, setSummaries] = React.useState<DriverDailySettlementSummary[]>([]);

  // Expanded driver payment audit tables
  const [expandedDrivers, setExpandedDrivers] = React.useState<Record<string, boolean>>({});

  // Active settlement modal state
  const [settlingDriver, setSettlingDriver] = React.useState<DriverDailySettlementSummary | null>(null);
  const [openingFloatInput, setOpeningFloatInput] = React.useState<string>("0");
  const [cashHandedOverInput, setCashHandedOverInput] = React.useState<string>("0");
  const [expensesInput, setExpensesInput] = React.useState<string>("0");
  const [isSubmittingSettlement, setIsSubmittingSettlement] = React.useState<boolean>(false);

  const fetchSettlements = React.useCallback(
    async (date: string, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await getDriverCollectionsReconciliation({ date });
        if (res.success && res.data) {
          setSummaries(res.data);
          // Auto expand first driver if only one
          if (res.data.length === 1) {
            setExpandedDrivers({ [res.data[0].driver_id]: true });
          }
        } else {
          setError(res.error || "Failed to load driver collections reconciliation.");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error loading settlement data.";
        setError(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  React.useEffect(() => {
    fetchSettlements(selectedDate);
  }, [fetchSettlements, selectedDate]);

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    fetchSettlements(newDate);
  };

  const toggleDriverExpand = (driverId: string) => {
    setExpandedDrivers((prev) => ({
      ...prev,
      [driverId]: !prev[driverId],
    }));
  };

  const handleOpenSettlement = (driver: DriverDailySettlementSummary) => {
    setSettlingDriver(driver);
    setOpeningFloatInput(driver.opening_float.toString());
    setCashHandedOverInput(driver.expected_cash > 0 ? driver.expected_cash.toString() : "0");
    setExpensesInput(driver.on_route_expenses.toString());
  };

  const handleExecuteSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlingDriver) return;

    setIsSubmittingSettlement(true);
    const res = await settleDriverDailyCash({
      driver_id: settlingDriver.driver_id,
      handover_date: selectedDate,
      opening_float: Number(openingFloatInput) || 0,
      cash_handed_over: Number(cashHandedOverInput) || 0,
      on_route_expenses: Number(expensesInput) || 0,
    });
    setIsSubmittingSettlement(false);

    if (res.success && res.data) {
      addToast({
        type: res.data.variance === 0 ? "success" : "info",
        title: res.data.variance === 0 ? "Settlement Complete!" : "Settled with Discrepancy",
        message:
          res.data.variance === 0
            ? `Exact cash handover recorded (₹${res.data.cash_handed_over}). Posted to general ledger.`
            : `Cash variance of ₹${res.data.variance} detected. Review cash float with driver.`,
      });
      setSettlingDriver(null);
      fetchSettlements(selectedDate, true);
    } else {
      addToast({
        type: "error",
        title: "Settlement Error",
        message: res.error || "Failed to complete driver cash settlement.",
      });
    }
  };

  // Aggregated totals across all active drivers for this date
  const totalCashCollected = summaries.reduce((acc, s) => acc + s.route_cash_collected, 0);
  const totalUpiCollected = summaries.reduce((acc, s) => acc + s.upi_collected, 0);
  const totalExpenses = summaries.reduce((acc, s) => acc + s.on_route_expenses, 0);
  const totalSettledCash = summaries.reduce((acc, s) => acc + s.cash_handed_over, 0);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Collections & Evening Cash Handover
            </h1>
            <Badge variant="outline" className="border-blue-500/30 text-blue-600 bg-blue-500/5 text-xs">
              Section 3.3 Accounting Invariant
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Evening reconciliation formula: Expected Cash = Opening Float + Route Cash Collections - Approved On-Route Expenses.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/deliveries">
            <Button size="sm" variant="outline" className="gap-2 text-xs">
              <Truck className="h-3.5 w-3.5 text-primary" />
              Deliveries View
            </Button>
          </Link>

          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchSettlements(selectedDate, true)}
            disabled={refreshing}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Date Filter & Invariant Notice */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-primary dark:text-blue-300 space-y-2">
        <div className="flex items-start gap-2.5">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold">Dual-Entry Float Accounting Law:</span>{" "}
            Morning cash given to a driver for change is an asset transfer (`Cash Float with Driver`), not an expense.
            When evening cash is handed over to the owner, it transfers to the central cash box (`Cash in Hand`).
            Customer invoices and customer ledger balances were already satisfied during stop execution;
            settlement never marks customer invoices as paid again.
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-primary/10">
          <span className="font-semibold text-foreground flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" /> Handover Date:
          </span>
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
            className="h-8 text-xs w-36 bg-background text-foreground"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Route Cash Collected</span>
              <Banknote className="h-4 w-4 text-emerald-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(totalCashCollected)}
            </div>
            <p className="text-[11px] text-muted-foreground">Physical currency collected on stops</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Digital UPI Collections</span>
              <QrCode className="h-4 w-4 text-primary shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-foreground">
              {formatCurrency(totalUpiCollected)}
            </div>
            <p className="text-[11px] text-muted-foreground">Direct customer bank QR deposits</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Approved Route Expenses</span>
              <Receipt className="h-4 w-4 text-amber-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-amber-600 dark:text-amber-400">
              {formatCurrency(totalExpenses)}
            </div>
            <p className="text-[11px] text-muted-foreground">Diesel/fuel vouchers logged by drivers</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Cash Handed Over & Settled</span>
              <ShieldCheck className="h-4 w-4 text-blue-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-bold text-foreground">
              {formatCurrency(totalSettledCash)}
            </div>
            <p className="text-[11px] text-muted-foreground">Deposited into central cash box</p>
          </CardContent>
        </Card>
      </div>

      {loading && summaries.length === 0 ? (
        <div className="p-12 text-center text-xs text-muted-foreground">
          Loading driver collection records...
        </div>
      ) : error && summaries.length === 0 ? (
        <ErrorState
          title="Failed to Load Collections"
          message={error}
          onRetry={() => fetchSettlements(selectedDate)}
        />
      ) : (
        <>
          {/* Driver Settlement Manifest List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                Driver Evening Cash Handover Reconciliation ({summaries.length})
              </h2>
              <span className="text-xs text-muted-foreground">
                Formula Reconciled per Driver
              </span>
            </div>

            {summaries.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center space-y-2">
                <ShieldCheck className="h-8 w-8 text-muted-foreground mx-auto" />
                <h3 className="text-sm font-semibold text-foreground">No Driver Collections for This Date</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  No route customer payments or driver expense vouchers were recorded on {selectedDate}.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {summaries.map((summary) => {
                  const isExpanded = !!expandedDrivers[summary.driver_id];
                  const isSettled = summary.status === "SETTLED";
                  const hasDiscrepancy = summary.status === "DISCREPANCY";

                  return (
                    <Card key={summary.driver_id} className="border-border bg-card shadow-xs">
                      <CardHeader className="p-4 pb-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="text-base font-bold text-foreground">
                                {summary.driver_name}
                              </h3>
                              <Badge
                                variant={
                                  isSettled
                                    ? "success"
                                    : hasDiscrepancy
                                    ? "destructive"
                                    : "warning"
                                }
                                className="text-[10px]"
                              >
                                {summary.status.replace(/_/g, " ")}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {summary.payments.length} customer payment(s) collected on route
                              {summary.driver_phone ? ` • Tel: ${summary.driver_phone}` : ""}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            {!isSettled ? (
                              <Button
                                size="sm"
                                onClick={() => handleOpenSettlement(summary)}
                                className="text-xs font-semibold gap-1.5 h-8 bg-emerald-600 hover:bg-emerald-500 text-white"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Verify & Settle Cash
                              </Button>
                            ) : (
                              <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Settled & Verified
                                {summary.verified_by_name ? ` by ${summary.verified_by_name}` : ""}
                              </span>
                            )}

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleDriverExpand(summary.driver_id)}
                              className="text-xs gap-1 h-8"
                            >
                              {isExpanded ? (
                                <>
                                  Hide Payments <ChevronUp className="h-3.5 w-3.5" />
                                </>
                              ) : (
                                <>
                                  View Payments ({summary.payments.length}) <ChevronDown className="h-3.5 w-3.5" />
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className="p-4 pt-0 space-y-4">
                        {/* Section 3.3 Equation Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs border border-border rounded-xl p-3 bg-muted/20">
                          <div>
                            <span className="text-[10px] text-muted-foreground uppercase font-semibold block">
                              1. Opening Float (+)
                            </span>
                            <span className="text-sm font-bold text-foreground">
                              {formatCurrency(summary.opening_float)}
                            </span>
                            <p className="text-[10px] text-muted-foreground">Morning cash</p>
                          </div>

                          <div>
                            <span className="text-[10px] text-muted-foreground uppercase font-semibold block">
                              2. Route Cash (+)
                            </span>
                            <span className="text-sm font-bold text-emerald-600">
                              {formatCurrency(summary.route_cash_collected)}
                            </span>
                            <p className="text-[10px] text-muted-foreground">Doorstep collections</p>
                          </div>

                          <div>
                            <span className="text-[10px] text-muted-foreground uppercase font-semibold block">
                              3. On-Route Exp (-)
                            </span>
                            <span className="text-sm font-bold text-amber-600">
                              {formatCurrency(summary.on_route_expenses)}
                            </span>
                            <p className="text-[10px] text-muted-foreground">Verified fuel vouchers</p>
                          </div>

                          <div className="bg-primary/5 p-1 rounded-lg border border-primary/10">
                            <span className="text-[10px] text-primary uppercase font-bold block">
                              4. Expected Cash (=)
                            </span>
                            <span className="text-sm font-black text-foreground">
                              {formatCurrency(summary.expected_cash)}
                            </span>
                            <p className="text-[10px] text-muted-foreground">Due to cash box</p>
                          </div>

                          <div>
                            <span className="text-[10px] text-muted-foreground uppercase font-semibold block">
                              5. Cash Handed Over
                            </span>
                            <span className="text-sm font-bold text-foreground">
                              {formatCurrency(summary.cash_handed_over)}
                            </span>
                            <p className="text-[10px] text-muted-foreground">Physically deposited</p>
                          </div>

                          <div>
                            <span className="text-[10px] text-muted-foreground uppercase font-semibold block">
                              6. Variance (Δ)
                            </span>
                            <span
                              className={`text-sm font-bold ${
                                summary.variance === 0
                                  ? "text-emerald-600"
                                  : "text-destructive"
                              }`}
                            >
                              {summary.variance >= 0 ? `+${formatCurrency(summary.variance)}` : formatCurrency(summary.variance)}
                            </span>
                            <p className="text-[10px] text-muted-foreground">
                              {summary.variance === 0 ? "Exact Match" : summary.variance < 0 ? "Shortage" : "Overage"}
                            </p>
                          </div>
                        </div>

                        {/* Expandable Granular Customer Payment Audit Trail */}
                        {isExpanded && (
                          <div className="rounded-xl border border-border overflow-x-auto relative">
                            <div className="sm:hidden text-[10px] text-muted-foreground px-3 py-1 bg-muted/40 border-b border-border flex items-center justify-between">
                              <span>Swipe horizontally to view customer collections</span>
                              <span>&rarr;</span>
                            </div>
                            <div className="bg-muted/40 p-2.5 border-b border-border text-xs font-semibold text-foreground flex items-center justify-between min-w-[650px]">
                              <span>Customer Collections Manifest ({summary.payments.length})</span>
                              <span className="text-[11px] text-muted-foreground">
                                Digital UPI Verified in Bank: {formatCurrency(summary.upi_collected)}
                              </span>
                            </div>
                            <table className="w-full text-left text-xs min-w-[650px]">
                              <thead className="bg-muted/30 border-b border-border text-muted-foreground">
                                <tr>
                                  <th className="py-2 px-3">Payment #</th>
                                  <th className="py-2 px-3">Customer</th>
                                  <th className="py-2 px-3">Order Ref</th>
                                  <th className="py-2 px-3">Amount</th>
                                  <th className="py-2 px-3">Method</th>
                                  <th className="py-2 px-3">Stop Reference</th>
                                  <th className="py-2 px-3 text-right">Customer Profile</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {summary.payments.map((p) => (
                                  <tr key={p.payment_id} className="hover:bg-muted/20">
                                    <td className="py-2 px-3 font-mono font-medium text-foreground">
                                      {p.payment_number}
                                    </td>
                                    <td className="py-2 px-3 font-semibold text-foreground">
                                      {p.customer_name}
                                    </td>
                                    <td className="py-2 px-3 font-mono text-muted-foreground">
                                      {p.order_number}
                                    </td>
                                    <td className="py-2 px-3 font-bold text-foreground">
                                      {formatCurrency(p.amount)}
                                    </td>
                                    <td className="py-2 px-3">
                                      <Badge
                                        variant={p.payment_method === "CASH" ? "success" : "primary"}
                                        className="text-[9px] py-0"
                                      >
                                        {p.payment_method}
                                      </Badge>
                                    </td>
                                    <td className="py-2 px-3 font-mono text-muted-foreground text-[11px]">
                                      {p.reference_number}
                                    </td>
                                    <td className="py-2 px-3 text-right">
                                      <Link
                                        href="/customers"
                                        className="text-[11px] text-primary hover:underline font-medium"
                                      >
                                        View Account →
                                      </Link>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Settle Cash Handover Modal / Dialog */}
          {settlingDriver && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
              <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div>
                    <h3 className="text-base font-bold text-foreground">
                      Settle Cash Handover
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Driver: {settlingDriver.driver_name} • Date: {selectedDate}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    Owner Verification
                  </Badge>
                </div>

                <form onSubmit={handleExecuteSettlement} className="space-y-4">
                  {/* Read-only System Figures */}
                  <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Verified Route Cash Collections:</span>
                      <span className="font-bold text-emerald-600">
                        {formatCurrency(settlingDriver.route_cash_collected)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Digital UPI Collections (Bank):</span>
                      <span className="font-bold text-blue-600">
                        {formatCurrency(settlingDriver.upi_collected)}
                      </span>
                    </div>
                  </div>

                  {/* Input 1: Opening Float */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">
                      Morning Cash Float Given (₹)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={openingFloatInput}
                      onChange={(e) => setOpeningFloatInput(e.target.value)}
                      className="text-xs font-bold"
                      required
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Starting cash given for change in the morning.
                    </p>
                  </div>

                  {/* Input 2: Approved On-Route Expenses */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">
                      Approved On-Route Expenses (₹)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={expensesInput}
                      onChange={(e) => setExpensesInput(e.target.value)}
                      className="text-xs font-bold"
                      required
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Verified fuel and vehicle emergency expenses deducted from cash.
                    </p>
                  </div>

                  {/* Expected Cash Auto-Calculation */}
                  {(() => {
                    const expected =
                      (Number(openingFloatInput) || 0) +
                      settlingDriver.route_cash_collected -
                      (Number(expensesInput) || 0);
                    const handedOver = Number(cashHandedOverInput) || 0;
                    const diff = Number((handedOver - expected).toFixed(2));

                    return (
                      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1 text-xs">
                        <div className="flex justify-between font-bold">
                          <span>Calculated Expected Cash:</span>
                          <span className="text-primary">{formatCurrency(expected)}</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-muted-foreground">Handover Difference / Variance:</span>
                          <span className={`font-semibold ${diff === 0 ? "text-emerald-600" : "text-destructive"}`}>
                            {diff >= 0 ? `+${formatCurrency(diff)}` : formatCurrency(diff)} ({diff === 0 ? "Exact Match" : diff < 0 ? "Shortage" : "Overage"})
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Input 3: Cash Physically Handed Over */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">
                      Actual Cash Counted & Handed Over (₹)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={cashHandedOverInput}
                      onChange={(e) => setCashHandedOverInput(e.target.value)}
                      className="text-xs font-bold text-emerald-600"
                      required
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Physical currency counted and placed into the central cash drawer.
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSettlingDriver(null)}
                      disabled={isSubmittingSettlement}
                      className="text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmittingSettlement}
                      className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                    >
                      {isSubmittingSettlement ? "Posting Settlement..." : "Confirm & Post Settlement"}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
