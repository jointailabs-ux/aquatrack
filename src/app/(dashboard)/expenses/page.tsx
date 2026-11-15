"use client";

import * as React from "react";
import Link from "next/link";
import {
  FileSpreadsheet,
  Plus,
  Truck,
  ShoppingBag,
  Users,
  Search,
  RefreshCw,
  Calendar,
  DollarSign,
  Fuel,
  Wrench,
  Building2,
  Coffee,
  CheckCircle2,
  X,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import {
  getUnifiedFinancialSpendingReport,
  recordExpense,
} from "@/modules/expenses/expense.service";
import {
  ExpenseCategory,
  ExpensePaymentMethod,
  RecordExpenseInput,
  UnifiedFinancialSpendingSummary,
} from "@/modules/expenses/expense.schema";
import { formatCurrency } from "@/lib/utils";

const EXPENSES_STORAGE_KEY = "aquatrack_expenses_cache_v2";

let cachedExpensesState: {
  data: UnifiedFinancialSpendingSummary;
  preset: string;
  timestamp: number;
} | null = null;

function getInitialExpensesData(preset: string): UnifiedFinancialSpendingSummary | null {
  if (cachedExpensesState && cachedExpensesState.preset === preset) {
    return cachedExpensesState.data;
  }
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(EXPENSES_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.data && parsed?.preset === preset) {
          cachedExpensesState = parsed;
          return parsed.data;
        }
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

export default function UnifiedExpensesFinancialPage() {
  const { addToast } = useToast();

  const [datePreset, setDatePreset] = React.useState<"THIS_MONTH" | "LAST_MONTH" | "TODAY" | "ALL" | "CUSTOM">("THIS_MONTH");
  const initialCache = React.useMemo(() => getInitialExpensesData("THIS_MONTH"), []);

  const [spendingData, setSpendingData] = React.useState<UnifiedFinancialSpendingSummary | null>(initialCache);
  const [loading, setLoading] = React.useState(!initialCache);
  const [refreshing, setRefreshing] = React.useState(false);

  // Filters
  const [customFrom, setCustomFrom] = React.useState("");
  const [customTo, setCustomTo] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState<string>("ALL");
  const [searchQuery, setSearchQuery] = React.useState("");

  // Add Expense Modal
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [amount, setAmount] = React.useState<string>("");
  const [category, setCategory] = React.useState<ExpenseCategory>("FUEL");
  const [expenseDate, setExpenseDate] = React.useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = React.useState<ExpensePaymentMethod>("CASH");
  const [description, setDescription] = React.useState("");
  const [vehicleNumber, setVehicleNumber] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Calculate Date Boundaries
  const getDateRangeParams = React.useCallback(() => {
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    if (datePreset === "TODAY") {
      return { startDate: today, endDate: today };
    }
    if (datePreset === "THIS_MONTH") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      return { startDate: start, endDate: today };
    }
    if (datePreset === "LAST_MONTH") {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];
      const end = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];
      return { startDate: start, endDate: end };
    }
    if (datePreset === "CUSTOM") {
      return {
        startDate: customFrom || undefined,
        endDate: customTo || undefined,
      };
    }
    return {}; // ALL
  }, [datePreset, customFrom, customTo]);

  // Load Data
  const loadSpendingReport = React.useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else if (!cachedExpensesState || cachedExpensesState.preset !== datePreset) {
      setLoading(true);
    }

    try {
      const dates = getDateRangeParams();
      const res = await getUnifiedFinancialSpendingReport(dates);
      if (res.success && res.data) {
        setSpendingData(res.data);
        const freshCache = { data: res.data, preset: datePreset, timestamp: Date.now() };
        cachedExpensesState = freshCache;
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(freshCache));
          } catch {
            // Ignore
          }
        }
      } else if (!cachedExpensesState) {
        addToast({
          type: "error",
          title: "Failed to load report",
          message: res.error || "Could not retrieve spending transactions.",
        });
      }
    } catch (err: unknown) {
      if (!cachedExpensesState) {
        addToast({
          type: "error",
          title: "Connection Error",
          message: err instanceof Error ? err.message : "Failed to load expenses data.",
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getDateRangeParams, datePreset, addToast]);

  React.useEffect(() => {
    loadSpendingReport();
  }, [loadSpendingReport]);

  // Quick Preset Helper for Recording Expenses
  const handleSelectQuickCategory = (cat: ExpenseCategory, defaultDesc: string, defaultAmt: string) => {
    setCategory(cat);
    setDescription(defaultDesc);
    if (!amount) setAmount(defaultAmt);
  };

  // Submit New Expense
  const handleRecordExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      addToast({
        type: "error",
        title: "Invalid Amount",
        message: "Expense amount must be greater than zero.",
      });
      return;
    }

    if (!description.trim() || description.trim().length < 2) {
      addToast({
        type: "error",
        title: "Description Required",
        message: "Please enter a brief expense description.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const input: RecordExpenseInput = {
        amount: parsedAmount,
        category,
        expense_date: expenseDate,
        payment_method: paymentMethod,
        description: description.trim(),
        vehicle_number: vehicleNumber.trim() || null,
      };

      const res = await recordExpense(input);
      if (res.success) {
        addToast({
          type: "success",
          title: "Expense Logged / খরচ রেকর্ড সম্পন্ন",
          message: `Recorded ${formatCurrency(parsedAmount)} for ${description}.`,
        });
        setIsAddModalOpen(false);
        setAmount("");
        setDescription("");
        setVehicleNumber("");
        loadSpendingReport(true);
      } else {
        addToast({
          type: "error",
          title: "Failed to Record Expense",
          message: res.error || "Database error.",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered Transactions List
  const filteredTransactions = (spendingData?.items || []).filter((tx) => {
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const matches =
        tx.description.toLowerCase().includes(q) ||
        (tx.reference && tx.reference.toLowerCase().includes(q)) ||
        (tx.supplierName && tx.supplierName.toLowerCase().includes(q)) ||
        (tx.staffName && tx.staffName.toLowerCase().includes(q)) ||
        (tx.vehicleNumber && tx.vehicleNumber.toLowerCase().includes(q));
      if (!matches) return false;
    }

    if (selectedCategory !== "ALL") {
      if (selectedCategory === "PURCHASE" && tx.sourceType !== "PURCHASE") return false;
      if (selectedCategory === "SALARY" && tx.sourceType !== "SALARY") return false;
      if (selectedCategory === "FUEL" && tx.category !== "FUEL") return false;
      if (selectedCategory === "VEHICLE_MAINTENANCE" && tx.category !== "VEHICLE_MAINTENANCE" && tx.category !== "REPAIRS") return false;
      if (selectedCategory === "OPERATIONS" && (tx.sourceType === "PURCHASE" || tx.sourceType === "SALARY" || tx.category === "FUEL")) return false;
    }

    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16 px-3 sm:px-6">
      {/* 1. VISUAL PAGE HEADER */}
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-slate-900 via-indigo-950 to-slate-900 border border-slate-800 p-5 sm:p-7 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md text-xs font-semibold text-sky-300 mb-2">
              <DollarSign className="h-4 w-4 text-sky-400" />
              <span>টাকা ও খরচের হিসাব (All Money Spent & Expenses)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Expenses & Financial Report
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
              Complete view of all money going out: supplier water purchases, staff monthly salaries, fuel, and daily operating expenses.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadSpendingReport(true)}
              disabled={refreshing || loading}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs font-semibold cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh (রিফ্রেশ)
            </Button>

            <Link href="/purchases">
              <Button
                size="sm"
                className="bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shadow-md shadow-sky-950/20 cursor-pointer"
              >
                <ShoppingBag className="h-3.5 w-3.5 mr-1.5" />
                + Purchase Stock (মাল কিনুন)
              </Button>
            </Link>

            <Button
              size="sm"
              onClick={() => setIsAddModalOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-md shadow-emerald-950/20 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              + Add Expense (নতুন খরচ)
            </Button>
          </div>
        </div>
      </div>

      {/* 2. FOUR ESSENTIAL SPENDING KPI CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Money Spent */}
        <div className="rounded-2xl border-2 border-rose-500/40 bg-linear-to-br from-rose-950/30 via-background to-rose-900/10 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400">
              Total Spent (মোট খরচ)
            </span>
            <div className="p-2 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30">
              <TrendingDown className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
            {loading ? "..." : formatCurrency(spendingData?.totalSpent || 0)}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 font-medium">
            All purchases, salaries & ops
          </p>
        </div>

        {/* Supplier Purchases */}
        <div className="rounded-2xl border-2 border-blue-500/30 bg-linear-to-br from-blue-950/30 via-background to-blue-900/10 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
              Purchases (মাল কেনা)
            </span>
            <div className="p-2 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30">
              <ShoppingBag className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
            {loading ? "..." : formatCurrency(spendingData?.purchasesTotal || 0)}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 font-medium">
            Water & Jar Purchase Orders
          </p>
        </div>

        {/* Staff Salaries */}
        <div className="rounded-2xl border-2 border-emerald-500/30 bg-linear-to-br from-emerald-950/30 via-background to-emerald-900/10 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              Salaries (স্টাফের বেতন)
            </span>
            <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
            {loading ? "..." : formatCurrency(spendingData?.salariesTotal || 0)}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 font-medium">
            Monthly driver & staff wages
          </p>
        </div>

        {/* Operations & Fuel */}
        <div className="rounded-2xl border-2 border-amber-500/30 bg-linear-to-br from-amber-950/30 via-background to-amber-900/10 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
              Operations & Fuel (জ্বালানি)
            </span>
            <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <Fuel className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
            {loading ? "..." : formatCurrency(spendingData?.operationsTotal || 0)}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 font-medium">
            Fuel, repairs, rent & tea
          </p>
        </div>
      </div>

      {/* 3. MULTI-DIMENSIONAL FILTER TOOLBAR */}
      <div className="rounded-2xl border border-border bg-card p-3 sm:p-4 shadow-sm space-y-3">
        {/* Row 1: Search & Date Presets */}
        <div className="flex flex-col sm:flex-row items-center gap-2.5">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search description, supplier, staff, or vehicle..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-8 text-xs h-9.5 rounded-xl bg-background"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Quick Date Range Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none w-full sm:w-auto pb-1 sm:pb-0">
            {[
              { id: "THIS_MONTH", label: "This Month (এই মাস)" },
              { id: "LAST_MONTH", label: "Last Month (গত মাস)" },
              { id: "TODAY", label: "Today (আজ)" },
              { id: "ALL", label: "All Time (সব)" },
              { id: "CUSTOM", label: "Custom (তারিখ)" },
            ].map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDatePreset(d.id as "THIS_MONTH" | "LAST_MONTH" | "TODAY" | "ALL" | "CUSTOM")}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  datePreset === d.id
                    ? "bg-blue-600 text-white shadow-xs"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Pickers */}
        {datePreset === "CUSTOM" && (
          <div className="p-2.5 rounded-xl bg-muted/30 border border-border/60 flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-muted-foreground">From:</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2 py-1 rounded-lg border border-border bg-background text-xs font-semibold text-foreground"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-muted-foreground">To:</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2 py-1 rounded-lg border border-border bg-background text-xs font-semibold text-foreground"
              />
            </div>
          </div>
        )}

        {/* Row 2: Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pt-2 border-t border-border/50">
          <span className="text-[11px] font-bold text-muted-foreground mr-1 shrink-0">
            Category (ধরন):
          </span>
          {[
            { id: "ALL", label: "All Expenses (সব)" },
            { id: "PURCHASE", label: "📦 Supplier Purchases (মাল কেনা)" },
            { id: "SALARY", label: "👤 Staff Salaries (বেতন)" },
            { id: "FUEL", label: "⛽ Fuel (জ্বালানি)" },
            { id: "VEHICLE_MAINTENANCE", label: "🔧 Repairs (গাড়ি মেরামত)" },
            { id: "OPERATIONS", label: "🏢 Operations & Tea (অন্যান্য)" },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCategory(c.id)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                selectedCategory === c.id
                  ? "bg-slate-800 text-sky-400 border border-sky-500/40 shadow-xs font-black"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4. EXPENSE & SPENDING TRANSACTIONS STREAM */}
      <div className="rounded-3xl border border-border bg-card p-4 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base sm:text-lg font-black text-foreground flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-rose-500" />
            <span>Money Spent Transactions ({filteredTransactions.length} records)</span>
          </h2>
          <span className="text-xs text-muted-foreground font-semibold">
            Sorted newest first
          </span>
        </div>

        {loading && !spendingData ? (
          <div className="py-12 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-cyan-600" />
            <span>Loading spending records...</span>
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="py-12 text-center rounded-2xl border border-dashed border-border bg-muted/10 p-6 space-y-2">
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm font-bold text-foreground">No expenses recorded for this period.</p>
            <p className="text-xs text-muted-foreground">
              Click &quot;+ Add Expense&quot; to record fuel, repairs, or &quot;+ Purchase Stock&quot; to order water.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTransactions.map((tx) => {
              const isPurchase = tx.sourceType === "PURCHASE";
              const isSalary = tx.sourceType === "SALARY";
              const isFuel = tx.category === "FUEL";

              return (
                <div
                  key={tx.id}
                  className="rounded-2xl border-2 border-border/80 bg-card p-4 shadow-sm hover:border-primary/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        isPurchase
                          ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                          : isSalary
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : isFuel
                          ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                          : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                      }`}
                    >
                      {isPurchase ? (
                        <ShoppingBag className="h-5 w-5" />
                      ) : isSalary ? (
                        <Users className="h-5 w-5" />
                      ) : isFuel ? (
                        <Fuel className="h-5 w-5" />
                      ) : (
                        <FileSpreadsheet className="h-5 w-5" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-bold py-0.5 ${
                            isPurchase
                              ? "border-blue-500/40 text-blue-400 bg-blue-500/10"
                              : isSalary
                              ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                              : "border-amber-500/40 text-amber-400 bg-amber-500/10"
                          }`}
                        >
                          {tx.categoryLabel}
                        </Badge>

                        {tx.reference && (
                          <span className="font-mono text-[10px] font-semibold text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded border border-border">
                            #{tx.reference}
                          </span>
                        )}

                        <span className="text-[11px] text-muted-foreground flex items-center gap-1 font-medium">
                          <Calendar className="h-3 w-3" />
                          {tx.date}
                        </span>
                      </div>

                      <h3 className="font-bold text-sm text-foreground leading-snug">
                        {tx.description}
                      </h3>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        {tx.supplierName && (
                          <span className="inline-flex items-center gap-1 text-blue-400 font-semibold">
                            <Building2 className="h-3 w-3" />
                            {tx.supplierName}
                          </span>
                        )}
                        {tx.staffName && (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                            <Users className="h-3 w-3" />
                            {tx.staffName}
                          </span>
                        )}
                        {tx.vehicleNumber && (
                          <span className="inline-flex items-center gap-1 text-amber-400 font-semibold">
                            <Truck className="h-3 w-3" />
                            Van: {tx.vehicleNumber}
                          </span>
                        )}
                        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                          {tx.paymentMethod}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Amount Tag */}
                  <div className="text-right sm:self-center shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/40">
                    <span className="text-lg sm:text-xl font-black text-rose-400 block">
                      -{formatCurrency(tx.amount)}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-semibold">
                      Money Out
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. ADD DAILY EXPENSE MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in">
          <div className="relative w-full max-w-lg rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xl text-foreground max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-rose-500" />
                <h3 className="font-black text-base sm:text-lg">
                  Record Operating Expense (খরচ লিখুন)
                </h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRecordExpense} className="space-y-4 mt-4">
              {/* Quick Preset Buttons */}
              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">
                  Quick Category Presets (দ্রুত পছন্দ)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectQuickCategory("FUEL", "Delivery Van Diesel", "1000")}
                    className="p-2 rounded-xl border border-border hover:border-amber-500/50 hover:bg-amber-500/10 text-xs font-bold text-left cursor-pointer transition-all"
                  >
                    <Fuel className="h-4 w-4 text-amber-400 mb-1" />
                    <span>Fuel (ডিজেল/পেট্রোল)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectQuickCategory("VEHICLE_MAINTENANCE", "Van Repair / Servicing", "1500")}
                    className="p-2 rounded-xl border border-border hover:border-blue-500/50 hover:bg-blue-500/10 text-xs font-bold text-left cursor-pointer transition-all"
                  >
                    <Wrench className="h-4 w-4 text-blue-400 mb-1" />
                    <span>Van Repair (মেরামত)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectQuickCategory("OTHER", "Driver Tea & Snacks", "150")}
                    className="p-2 rounded-xl border border-border hover:border-emerald-500/50 hover:bg-emerald-500/10 text-xs font-bold text-left cursor-pointer transition-all"
                  >
                    <Coffee className="h-4 w-4 text-emerald-400 mb-1" />
                    <span>Tea & Meals (চা/নাস্তা)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectQuickCategory("RENT", "Warehouse / Godown Rent", "5000")}
                    className="p-2 rounded-xl border border-border hover:border-purple-500/50 hover:bg-purple-500/10 text-xs font-bold text-left cursor-pointer transition-all"
                  >
                    <Building2 className="h-4 w-4 text-purple-400 mb-1" />
                    <span>Shop Rent (দোকান ভাড়া)</span>
                  </button>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">
                  Expense Amount (টাকার পরিমাণ) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted-foreground text-sm">₹</span>
                  <Input
                    type="number"
                    min="1"
                    placeholder="e.g. 500"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="pl-8 text-base font-black rounded-xl bg-background"
                    required
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">
                  Description / Details (বিবরণ) *
                </label>
                <Input
                  placeholder="e.g. Van diesel at Shell bunk, or Oil change"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="text-xs rounded-xl bg-background"
                  required
                />
              </div>

              {/* Date & Payment Method */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-foreground block mb-1.5">
                    Expense Date (তারিখ)
                  </label>
                  <Input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="text-xs rounded-xl bg-background"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-foreground block mb-1.5">
                    Payment Method (কীভাবে দিয়েছেন?)
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as ExpensePaymentMethod)}
                    className="w-full h-9.5 px-3 rounded-xl border border-border bg-background text-xs font-semibold text-foreground focus:outline-none"
                  >
                    <option value="CASH">Cash (নগদ)</option>
                    <option value="UPI">UPI / GPay / PhonePe</option>
                    <option value="BANK_TRANSFER">Bank Transfer (ব্যাংক)</option>
                    <option value="CARD">Card</option>
                  </select>
                </div>
              </div>

              {/* Vehicle Number (optional) */}
              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">
                  Vehicle Number (গাড়ির নম্বর - যদি থাকে)
                </label>
                <Input
                  placeholder="e.g. WB-02-1234"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  className="text-xs rounded-xl bg-background font-mono"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/60">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddModalOpen(false)}
                  disabled={isSubmitting}
                  className="h-9 px-4 text-xs font-semibold cursor-pointer"
                >
                  Cancel (বাতিল)
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 px-5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                >
                  {isSubmitting ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Save Expense (খরচ সংরক্ষণ করুন)
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
