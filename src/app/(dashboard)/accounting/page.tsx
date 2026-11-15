"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  ArrowRight,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Wallet,
  Landmark,
  CreditCard,
  Receipt,
  FileSpreadsheet,
  Calendar,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  getAccountingOverview,
  getChartOfAccountsBalances,
  getLedgerTransactions,
} from "@/modules/accounting/accounting.service";
import {
  AccountingOverview,
  AccountBalanceItem,
  TrialBalanceSummary,
  LedgerTransactionItem,
  STANDARD_CHART_OF_ACCOUNTS,
} from "@/modules/accounting/accounting.schema";

type PeriodType = "THIS_MONTH" | "LAST_MONTH" | "THIS_YEAR" | "ALL";
type ActiveTab = "ACCOUNTS" | "JOURNAL";

export default function AccountingPage() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace("/expenses");
  }, [router]);

  const [activeTab, setActiveTab] = React.useState<ActiveTab>("ACCOUNTS");
  const [selectedPeriod, setSelectedPeriod] = React.useState<PeriodType>("THIS_MONTH");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Overview Data
  const [overview, setOverview] = React.useState<AccountingOverview | null>(null);

  // Chart of Accounts Data
  const [accounts, setAccounts] = React.useState<AccountBalanceItem[]>([]);
  const [trialBalance, setTrialBalance] = React.useState<TrialBalanceSummary | null>(null);

  // Ledger Journal Data & Filters
  const [transactions, setTransactions] = React.useState<LedgerTransactionItem[]>([]);
  const [totalCount, setTotalCount] = React.useState(0);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterAccount, setFilterAccount] = React.useState<string>("");
  const [filterRefType, setFilterRefType] = React.useState<string>("");
  const [journalLoading, setJournalLoading] = React.useState(false);

  // Load Overview & Accounts
  const loadAccountingData = React.useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [overviewRes, accountsRes] = await Promise.all([
        getAccountingOverview({ period: selectedPeriod }),
        getChartOfAccountsBalances(),
      ]);

      if (!overviewRes.success) {
        setError(overviewRes.error || "Failed to load accounting overview.");
      } else if (overviewRes.data) {
        setOverview(overviewRes.data);
      }

      if (!accountsRes.success) {
        setError((prev) => prev || accountsRes.error || "Failed to load chart of accounts.");
      } else if (accountsRes.data) {
        setAccounts(accountsRes.data.accounts);
        setTrialBalance(accountsRes.data.trial_balance);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedPeriod]);

  // Load Ledger Journal Transactions
  const loadTransactions = React.useCallback(async () => {
    setJournalLoading(true);
    try {
      const res = await getLedgerTransactions({
        period: selectedPeriod,
        accountCode: filterAccount || undefined,
        referenceType: filterRefType || undefined,
        search: searchQuery.trim() || undefined,
        limit: 100,
      });

      if (res.success && res.data) {
        setTransactions(res.data.transactions);
        setTotalCount(res.data.total_count);
      }
    } catch (err: unknown) {
      console.error("Error loading journal entries:", err);
    } finally {
      setJournalLoading(false);
    }
  }, [selectedPeriod, filterAccount, filterRefType, searchQuery]);

  // Initial and reactive loads
  React.useEffect(() => {
    loadAccountingData();
  }, [loadAccountingData]);

  React.useEffect(() => {
    if (activeTab === "JOURNAL") {
      loadTransactions();
    }
  }, [activeTab, loadTransactions]);

  const handleManualRefresh = () => {
    loadAccountingData(true);
    if (activeTab === "JOURNAL") {
      loadTransactions();
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              General Ledger & Accounting Dashboard
            </h1>
            <Badge variant="primary" className="text-xs">
              Dual-Entry GAAP
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Strict separation of sales vs collections, real-time double-entry trial balance, and posted immutable journal entries.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Period selector */}
          <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-xs overflow-x-auto scrollbar-none flex-nowrap max-w-full">
            {(
              [
                { id: "THIS_MONTH", label: "This Month" },
                { id: "LAST_MONTH", label: "Last Month" },
                { id: "THIS_YEAR", label: "This Year" },
                { id: "ALL", label: "All Time" },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPeriod(p.id)}
                className={`px-2.5 sm:px-3 py-1 font-medium rounded-sm transition-colors shrink-0 touch-manipulation min-h-[32px] ${
                  selectedPeriod === p.id
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleManualRefresh}
            disabled={refreshing || loading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Link href="/reports">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              P&L Reports
              <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">Accounting ledger access restriction</p>
            <p className="text-xs mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* SECTION 1: FINANCIAL OVERVIEW KPI CARDS */}
      {overview && (
        <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Total Revenue */}
          <Card className="border-border shadow-xs">
            <CardContent className="p-3.5 sm:p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Total Revenue (Accrual)</span>
                <span className="p-1.5 bg-emerald-500/10 text-emerald-600 rounded-md shrink-0">
                  <TrendingUp className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                {formatCurrency(overview.total_revenue)}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/50 pt-2">
                <span>Orders: {formatCurrency(overview.order_revenue)}</span>
                <span>POS: {formatCurrency(overview.pos_revenue)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Customer Collections */}
          <Card className="border-border shadow-xs">
            <CardContent className="p-3.5 sm:p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Customer Collections</span>
                <span className="p-1.5 bg-blue-500/10 text-blue-600 rounded-md shrink-0">
                  <Receipt className="h-4 w-4" />
                </span>
              </div>
              <div className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                {formatCurrency(overview.total_customer_collections)}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground border-t border-border/50 pt-2">
                Satisfies A/R balances; not counted as duplicate revenue.
              </p>
            </CardContent>
          </Card>

          {/* Gross Profit & COGS */}
          <Card className="border-border shadow-xs">
            <CardContent className="p-3.5 sm:p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Gross Profit</span>
                <Badge variant={overview.gross_profit >= 0 ? "success" : "warning"} className="text-[10px] py-0 shrink-0">
                  {overview.gross_profit_margin_pct}% Margin
                </Badge>
              </div>
              <div className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                {formatCurrency(overview.gross_profit)}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/50 pt-2">
                <span>COGS: {formatCurrency(overview.cost_of_goods_sold)}</span>
                <span>Net Rev: {formatCurrency(overview.total_revenue)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Net Operating Profit */}
          <Card className="border-border shadow-xs">
            <CardContent className="p-3.5 sm:p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Net Operating Profit</span>
                <Badge variant={overview.net_operating_profit >= 0 ? "success" : "destructive"} className="text-[10px] py-0 shrink-0">
                  {overview.net_profit_margin_pct}% Margin
                </Badge>
              </div>
              <div className={`mt-2 text-xl sm:text-2xl font-bold tracking-tight ${overview.net_operating_profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {formatCurrency(overview.net_operating_profit)}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/50 pt-2">
                <span>Expenses: {formatCurrency(overview.total_expenses)}</span>
                <span>Salaries: {formatCurrency(overview.salary_expenses)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* WORKING CAPITAL & LIQUIDITY BAR */}
      {overview && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Outstanding Receivables */}
          <Card className="border-border shadow-xs bg-muted/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-amber-500" />
                  <span className="text-xs font-semibold text-foreground">Accounts Receivable (A/R)</span>
                </div>
                <span className="text-xs font-mono font-bold text-amber-600">
                  {formatCurrency(overview.accounts_receivable)}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Total outstanding credit due from registered B2B and residential customers.
              </p>
            </CardContent>
          </Card>

          {/* Outstanding Payables */}
          <Card className="border-border shadow-xs bg-muted/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-purple-500" />
                  <span className="text-xs font-semibold text-foreground">Accounts Payable (A/P)</span>
                </div>
                <span className="text-xs font-mono font-bold text-purple-600">
                  {formatCurrency(overview.accounts_payable)}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Total unpaid balance owed to bulk water purification plants and container suppliers.
              </p>
            </CardContent>
          </Card>

          {/* Cash & Bank Balances */}
          <Card className="border-border shadow-xs bg-muted/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold text-foreground">Liquid Cash & Bank</span>
                </div>
                <span className="text-xs font-mono font-bold text-primary">
                  {formatCurrency(overview.total_cash_and_bank)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Depot: {formatCurrency(overview.cash_in_hand)}</span>
                <span>Drivers: {formatCurrency(overview.cash_with_drivers)}</span>
                <span>Bank: {formatCurrency(overview.bank_balance)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* NAVIGATION TABS */}
      <div className="flex items-center gap-4 border-b border-border overflow-x-auto scrollbar-none flex-nowrap">
        <button
          onClick={() => setActiveTab("ACCOUNTS")}
          className={`pb-3 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 -mb-px shrink-0 touch-manipulation min-h-[42px] ${
            activeTab === "ACCOUNTS"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <BookOpen className="h-4 w-4" />
          Chart of Accounts & Trial Balance
        </button>

        <button
          onClick={() => setActiveTab("JOURNAL")}
          className={`pb-3 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 -mb-px shrink-0 touch-manipulation min-h-[42px] ${
            activeTab === "JOURNAL"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Calendar className="h-4 w-4" />
          General Ledger Journal
          {totalCount > 0 && (
            <Badge variant="outline" className="text-[10px] ml-1 px-1.5 py-0">
              {totalCount}
            </Badge>
          )}
        </button>
      </div>

      {/* TAB 1: CHART OF ACCOUNTS & TRIAL BALANCE */}
      {activeTab === "ACCOUNTS" && (
        <div className="space-y-4">
          {/* Trial Balance Banner */}
          {trialBalance && (
            <Card className="border-border shadow-xs bg-card">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {trialBalance.is_balanced ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-amber-500" />
                    )}
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">
                        Trial Balance Status:{" "}
                        <span className={trialBalance.is_balanced ? "text-emerald-600" : "text-amber-600"}>
                          {trialBalance.is_balanced ? "Perfect Dual-Entry Equilibrium" : "Discrepancy Detected"}
                        </span>
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Fundamental accounting equation: Every debit has an equal and opposite credit.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div>
                      <span className="text-muted-foreground mr-1">Total Debits:</span>
                      <span className="font-bold text-foreground">{formatCurrency(trialBalance.total_debit)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground mr-1">Total Credits:</span>
                      <span className="font-bold text-foreground">{formatCurrency(trialBalance.total_credit)}</span>
                    </div>
                    <Badge variant={trialBalance.is_balanced ? "success" : "destructive"} className="text-xs font-mono">
                      Δ = {formatCurrency(trialBalance.difference)}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Chart of Accounts Table */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-5 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary" />
                    Standard Chart of Accounts (COA)
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Live balances calculated from posted dual-entry records in public.financial_ledger.
                  </CardDescription>
                </div>
                <span className="text-xs text-muted-foreground">{accounts.length} active ledger codes</span>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {/* Mobile View: High-density Account Cards */}
              <div className="md:hidden divide-y divide-border/60">
                {accounts.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No chart of accounts records found.
                  </div>
                ) : (
                  accounts.map((acc) => (
                    <div key={acc.account_code} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-xs font-bold text-foreground">
                              {acc.account_code}
                            </span>
                            <Badge
                              variant={
                                acc.type === "ASSET"
                                  ? "primary"
                                  : acc.type === "LIABILITY"
                                  ? "warning"
                                  : acc.type === "REVENUE"
                                  ? "success"
                                  : acc.type === "DIRECT_COST"
                                  ? "info"
                                  : "secondary"
                              }
                              className="text-[9px] py-0"
                            >
                              {acc.type}
                            </Badge>
                          </div>
                          <h4 className="text-xs font-semibold text-foreground mt-0.5">
                            {acc.account_name}
                          </h4>
                          {acc.description && (
                            <p className="text-[10px] text-muted-foreground line-clamp-1">
                              {acc.description}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-black font-mono text-foreground block">
                            {formatCurrency(acc.current_balance)}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            Normal: {acc.normal_balance}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] bg-muted/20 p-2 rounded-lg font-mono">
                        <span className="text-muted-foreground">
                          Dr: <strong className="text-foreground">{formatCurrency(acc.total_debit)}</strong>
                        </span>
                        <span className="text-muted-foreground">
                          Cr: <strong className="text-foreground">{formatCurrency(acc.total_credit)}</strong>
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop View: Full Data Table */}
              <div className="hidden md:block overflow-x-auto relative">
                <table className="w-full text-left text-xs min-w-[750px]">
                  <thead className="bg-muted/40 text-muted-foreground border-y border-border">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Account Code</th>
                      <th className="py-3 px-4 font-semibold">Account Name & Description</th>
                      <th className="py-3 px-4 font-semibold">Classification</th>
                      <th className="py-3 px-4 font-semibold text-center">Normal Side</th>
                      <th className="py-3 px-4 font-semibold text-right">Total Debit</th>
                      <th className="py-3 px-4 font-semibold text-right">Total Credit</th>
                      <th className="py-3 px-4 font-semibold text-right">Current Net Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {accounts.map((acc) => (
                      <tr key={acc.account_code} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-foreground">
                          {acc.account_code}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-foreground">{acc.account_name}</div>
                          {acc.description && (
                            <div className="text-[11px] text-muted-foreground line-clamp-1">
                              {acc.description}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={
                              acc.type === "ASSET"
                                ? "primary"
                                : acc.type === "LIABILITY"
                                ? "warning"
                                : acc.type === "REVENUE"
                                ? "success"
                                : acc.type === "DIRECT_COST"
                                ? "info"
                                : "secondary"
                            }
                            className="text-[10px] py-0"
                          >
                            {acc.type}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-[11px] text-muted-foreground">
                          {acc.normal_balance}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                          {formatCurrency(acc.total_debit)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                          {formatCurrency(acc.total_credit)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                          {formatCurrency(acc.current_balance)}
                        </td>
                      </tr>
                    ))}
                    {accounts.length === 0 && !loading && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                          No chart of accounts records found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: GENERAL LEDGER JOURNAL */}
      {activeTab === "JOURNAL" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <Card className="border-border shadow-xs">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search entry #, desc, account..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 text-xs h-9"
                  />
                </div>

                {/* Account Code Filter */}
                <div>
                  <select
                    value={filterAccount}
                    onChange={(e) => setFilterAccount(e.target.value)}
                    className="w-full h-9 rounded-md border border-border bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">All Account Codes</option>
                    {STANDARD_CHART_OF_ACCOUNTS.map((acc) => (
                      <option key={acc.code} value={acc.code}>
                        {acc.code} — {acc.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Reference Type Filter */}
                <div>
                  <select
                    value={filterRefType}
                    onChange={(e) => setFilterRefType(e.target.value)}
                    className="w-full h-9 rounded-md border border-border bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">All Reference Types</option>
                    <option value="INVOICE">INVOICE (B2B/B2C)</option>
                    <option value="POS_SALE">POS_SALE (Counter)</option>
                    <option value="CUSTOMER_PAYMENT">CUSTOMER_PAYMENT (A/R Collection)</option>
                    <option value="EXPENSE">EXPENSE (OpEx)</option>
                    <option value="PURCHASE">PURCHASE (Stock / CapEx)</option>
                    <option value="SUPPLIER_PAYMENT">SUPPLIER_PAYMENT (A/P)</option>
                    <option value="SALARY_PAYMENT">SALARY_PAYMENT (Payroll)</option>
                    <option value="CASH_HANDOVER">CASH_HANDOVER (Driver Settlement)</option>
                    <option value="DEPOSIT_COLLECTION">DEPOSIT_COLLECTION (Liability)</option>
                    <option value="DEPOSIT_REFUND">DEPOSIT_REFUND</option>
                    <option value="MANUAL_JOURNAL">MANUAL_JOURNAL</option>
                  </select>
                </div>

                {/* Filter Action */}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={loadTransactions}
                    disabled={journalLoading}
                    className="flex-1 text-xs h-9 gap-1.5"
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Apply Filters
                  </Button>
                  {(searchQuery || filterAccount || filterRefType) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSearchQuery("");
                        setFilterAccount("");
                        setFilterRefType("");
                      }}
                      className="text-xs h-9"
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Ledger Journal Table */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-5 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    Posted Dual-Entry Journal Transactions
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Immutable audit records from public.financial_ledger with source transaction references.
                  </CardDescription>
                </div>
                <span className="text-xs text-muted-foreground">
                  Showing {transactions.length} of {totalCount} records
                </span>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {/* Mobile View: High-density Journal Entry Cards */}
              <div className="md:hidden divide-y divide-border/60">
                {transactions.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No posted ledger transactions found.
                  </div>
                ) : (
                  transactions.map((tx) => (
                    <div key={tx.id} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-xs font-bold text-foreground">
                              {tx.entry_number}
                            </span>
                            {tx.is_reversal && (
                              <Badge variant="destructive" className="text-[9px] py-0 px-1">
                                REV
                              </Badge>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {formatDate(tx.entry_date)}
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-foreground mt-0.5">
                            <span className="font-mono text-primary font-bold mr-1">{tx.account_code}</span>
                            {tx.account_name}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {Number(tx.debit) > 0 ? (
                            <span className="text-xs font-black font-mono text-emerald-600 dark:text-emerald-400 block">
                              Dr: {formatCurrency(tx.debit)}
                            </span>
                          ) : (
                            <span className="text-xs font-black font-mono text-blue-600 dark:text-blue-400 block">
                              Cr: {formatCurrency(tx.credit)}
                            </span>
                          )}
                          {tx.reference_type && (
                            <Badge variant="outline" className="text-[9px] py-0 font-mono">
                              {tx.reference_type}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {tx.description && (
                        <p className="text-[11px] text-muted-foreground bg-muted/20 p-1.5 rounded-md">
                          {tx.description}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Desktop View: Full Data Table */}
              <div className="hidden md:block overflow-x-auto relative">
                <table className="w-full text-left text-xs min-w-[750px]">
                  <thead className="bg-muted/40 text-muted-foreground border-y border-border">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Date</th>
                      <th className="py-3 px-4 font-semibold">Entry #</th>
                      <th className="py-3 px-4 font-semibold">Account</th>
                      <th className="py-3 px-4 font-semibold">Description</th>
                      <th className="py-3 px-4 font-semibold">Ref Type</th>
                      <th className="py-3 px-4 font-semibold text-right">Debit (Dr)</th>
                      <th className="py-3 px-4 font-semibold text-right">Credit (Cr)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                          {formatDate(tx.entry_date)}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-foreground whitespace-nowrap">
                          {tx.entry_number}
                          {tx.is_reversal && (
                            <Badge variant="destructive" className="ml-1 text-[9px] py-0 px-1">
                              REV
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono font-semibold text-foreground mr-1.5">
                            {tx.account_code}
                          </span>
                          <span className="text-muted-foreground">{tx.account_name}</span>
                        </td>
                        <td className="py-3 px-4 max-w-xs truncate text-foreground" title={tx.description}>
                          {tx.description}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <Badge variant="outline" className="text-[10px] py-0">
                            {tx.reference_type}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-foreground whitespace-nowrap">
                          {tx.debit > 0 ? formatCurrency(tx.debit) : "—"}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-foreground whitespace-nowrap">
                          {tx.credit > 0 ? formatCurrency(tx.credit) : "—"}
                        </td>
                      </tr>
                    ))}
                    {transactions.length === 0 && !journalLoading && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-xs text-muted-foreground">
                          No ledger journal transactions found for the selected period and filters.
                        </td>
                      </tr>
                    )}
                    {journalLoading && (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-xs text-muted-foreground">
                          <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                          Loading journal entries...
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
