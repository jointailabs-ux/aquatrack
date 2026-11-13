"use client";

import * as React from "react";
import {
  FileSpreadsheet,
  Plus,
  Truck,
  Building,
  Sparkles,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import {
  getExpenses,
  recordExpense,
  getExpenseCategoryBreakdown,
} from "@/modules/expenses/expense.service";
import {
  ExpenseCategory,
  ExpenseCategoryBreakdown,
  ExpensePaymentMethod,
  ExpenseRecord,
  RecordExpenseInput,
} from "@/modules/expenses/expense.schema";
import { formatCurrency } from "@/lib/utils";

export default function ExpensesPage() {
  const { addToast } = useToast();
  const [expenses, setExpenses] = React.useState<ExpenseRecord[]>([]);
  const [breakdown, setBreakdown] = React.useState<ExpenseCategoryBreakdown[]>([]);
  const [selectedCategory, setSelectedCategory] = React.useState<string>("ALL");
  const [searchQuery, setSearchQuery] = React.useState("");

  // Add Expense Modal
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [amount, setAmount] = React.useState<string>("");
  const [category, setCategory] = React.useState<ExpenseCategory>("FUEL");
  const [expenseDate, setExpenseDate] = React.useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = React.useState<ExpensePaymentMethod>("UPI");
  const [description, setDescription] = React.useState("");
  const [vehicleNumber, setVehicleNumber] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    async function load() {
      const expRes = await getExpenses();
      if (expRes.success && expRes.data) {
        setExpenses(expRes.data);
      }
      const brRes = await getExpenseCategoryBreakdown();
      if (brRes.success && brRes.data) {
        setBreakdown(brRes.data);
      }
    }
    load();
  }, []);

  const handleRecordExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) return;

    setIsSubmitting(true);
    const input: RecordExpenseInput = {
      amount: parsedAmount,
      category,
      expense_date: expenseDate,
      payment_method: paymentMethod,
      description,
      vehicle_number: vehicleNumber || null,
    };

    const res = await recordExpense(input);
    setIsSubmitting(false);

    if (res.success && res.data) {
      setExpenses((prev) => [res.data!, ...prev]);
      addToast({
        type: "success",
        title: "Expense Logged",
        message: `Recorded ${formatCurrency(parsedAmount)} under ${category}.`,
      });
      setIsAddModalOpen(false);
      setAmount("");
      setDescription("");
      setVehicleNumber("");
    }
  };

  const totalExpenseAmount = expenses.reduce((s, e) => s + e.amount, 0);

  const filteredExpenses = expenses.filter((e) => {
    const matchesSearch =
      e.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.vehicle_number && e.vehicle_number.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCat = selectedCategory === "ALL" || e.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Operating Expenses & Float Outflows
            </h1>
            <Badge variant="primary" className="text-xs">
              Single-Location Operations
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Record fuel, vehicle servicing, rent, electricity, packaging, and cleaning expenses.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => setIsAddModalOpen(true)}
          className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
        >
          <Plus className="h-4 w-4" />
          Record Expense
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Total Operating Outflows</span>
              <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-foreground">
              {formatCurrency(totalExpenseAmount)}
            </div>
            <p className="text-[11px] text-muted-foreground">Period operating expenses</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Fleet Fuel & Repairs</span>
              <Truck className="h-4 w-4 text-amber-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-amber-600 dark:text-amber-400">
              {formatCurrency(
                expenses
                  .filter((e) => e.category === "FUEL" || e.category === "VEHICLE_MAINTENANCE")
                  .reduce((s, e) => s + e.amount, 0)
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">Route vehicle operating costs</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Depot Rent & Power</span>
              <Building className="h-4 w-4 text-blue-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-blue-600 dark:text-blue-400">
              {formatCurrency(
                expenses
                  .filter((e) => e.category === "RENT" || e.category === "ELECTRICITY")
                  .reduce((s, e) => s + e.amount, 0)
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">Warehouse fixed occupancy</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Jar Sanitization & Supplies</span>
              <Sparkles className="h-4 w-4 text-emerald-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(
                expenses
                  .filter((e) => e.category === "CLEANING" || e.category === "PACKAGING")
                  .reduce((s, e) => s + e.amount, 0)
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">Caps, seals & chemical wash</p>
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown & Vouchers Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 4 Cols: Category Breakdown Cards */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="border-border shadow-xs">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold">Category Distribution</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-1 space-y-2.5">
              {breakdown.map((b) => (
                <div
                  key={b.category}
                  onClick={() => setSelectedCategory(b.category === selectedCategory ? "ALL" : b.category)}
                  className={`space-y-1 cursor-pointer p-1.5 rounded-lg transition-colors ${
                    selectedCategory === b.category ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">{b.category_label}</span>
                    <span className="text-muted-foreground">
                      {formatCurrency(b.total_amount)} ({b.percentage_of_total}%)
                    </span>
                  </div>
                  <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${b.percentage_of_total}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right 8 Cols: Expense Vouchers Log */}
        <div className="lg:col-span-8 space-y-4">
          <Card className="border-border shadow-xs">
            <CardHeader className="p-4 pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <CardTitle className="text-sm font-bold">Expense Vouchers</CardTitle>
                <div className="w-full sm:w-56">
                  <Input
                    placeholder="Search description or vehicle..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="text-xs h-8"
                  />
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {/* Mobile View: High-density Expense Cards */}
              <div className="md:hidden divide-y divide-border/60">
                {filteredExpenses.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No operating expense vouchers recorded.
                  </div>
                ) : (
                  filteredExpenses.map((e) => (
                    <div key={e.id} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="outline" className="text-[9px] py-0">
                              {e.category.replace(/_/g, " ")}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">{e.expense_date}</span>
                          </div>
                          <p className="text-xs font-semibold text-foreground mt-1">
                            {e.description}
                          </p>
                          {e.vehicle_number && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              Vehicle: {e.vehicle_number}
                            </span>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-sm font-extrabold text-foreground block">
                            {formatCurrency(e.amount)}
                          </span>
                          <Badge variant="secondary" className="text-[9px] py-0 font-bold mt-0.5">
                            {e.payment_method}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop View: Full Data Table */}
              <div className="hidden md:block overflow-x-auto relative">
                <table className="w-full text-left text-xs min-w-[550px]">
                  <thead className="bg-muted/40 text-muted-foreground border-y border-border">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Date</th>
                      <th className="py-2.5 px-4 font-semibold">Category</th>
                      <th className="py-2.5 px-4 font-semibold">Description</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Amount</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredExpenses.map((e) => (
                      <tr key={e.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 px-4 text-muted-foreground">{e.expense_date}</td>
                        <td className="py-2.5 px-4">
                          <Badge variant="outline" className="text-[10px] py-0">
                            {e.category.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="font-semibold text-foreground block">
                            {e.description}
                          </span>
                          {e.vehicle_number && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              Vehicle: {e.vehicle_number}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-extrabold text-foreground">
                          {formatCurrency(e.amount)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <Badge variant="secondary" className="text-[10px] py-0 font-bold">
                            {e.payment_method}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Expense Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                Record Operating Expense Voucher
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordExpense} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Category *</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground"
                  >
                    <option value="FUEL">Fuel (Diesel/Petrol)</option>
                    <option value="VEHICLE_MAINTENANCE">Vehicle Maintenance & Tires</option>
                    <option value="RENT">Warehouse Depot Rent</option>
                    <option value="ELECTRICITY">Electricity & Power Utility</option>
                    <option value="PACKAGING">Packaging (Caps, Sleeves, Seals)</option>
                    <option value="CLEANING">Cleaning & Sanitization Chemical</option>
                    <option value="REPAIRS">Plant Machinery Repairs</option>
                    <option value="OTHER">Other Operational Expense</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Payment Mode</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as ExpensePaymentMethod)}
                    className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground"
                  >
                    <option value="UPI">UPI Payment</option>
                    <option value="CASH">Cash / Driver Petty Float</option>
                    <option value="BANK_TRANSFER">Bank Transfer (NEFT/IMPS)</option>
                    <option value="CARD">Debit/Credit Card</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Amount (₹) *</label>
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    min={1}
                    className="text-xs font-bold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Date *</label>
                  <Input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Description *</label>
                <Input
                  placeholder="e.g. 25 Litres Diesel for Route 1 Van"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Vehicle Number (If Applicable)
                </label>
                <Input
                  placeholder="e.g. KA-01-EQ-4421"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  className="text-xs uppercase"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                >
                  {isSubmitting ? "Recording..." : "Save Voucher"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
