"use client";

import * as React from "react";
import {
  CreditCard,
  CheckCircle2,
  Calendar,
  AlertCircle,
  UserCheck,
  PlusCircle,
  RefreshCw,
  Filter,
  Wallet,
  Clock,
  History,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import {
  getStaffSalarySummaries,
  getSalaryPaymentHistory,
  getSalaryAdvances,
  recordSalaryPayment,
  recordSalaryAdvance,
} from "@/modules/salaries/salary.service";
import {
  SalaryPaymentRecord,
  StaffSalaryLedgerSummary,
  SalaryAdvanceRecord,
  RecordSalaryPaymentInput,
  RecordSalaryAdvanceInput,
  SalaryPaymentMethod,
} from "@/modules/salaries/salary.schema";
import { formatCurrency, formatDate } from "@/lib/utils";

type ActiveTab = "PAYROLL" | "ADVANCES";

export default function StaffSalaryPage() {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = React.useState<ActiveTab>("PAYROLL");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);

  // Core Data
  const [summaries, setSummaries] = React.useState<StaffSalaryLedgerSummary[]>([]);
  const [history, setHistory] = React.useState<SalaryPaymentRecord[]>([]);
  const [advances, setAdvances] = React.useState<SalaryAdvanceRecord[]>([]);

  // Advance History Filters
  const [filterStaffId, setFilterStaffId] = React.useState<string>("");
  const [filterStatus, setFilterStatus] = React.useState<"ALL" | "OUTSTANDING" | "SETTLED">("ALL");
  const [filterStartDate, setFilterStartDate] = React.useState<string>("");
  const [filterEndDate, setFilterEndDate] = React.useState<string>("");
  const [advancesLoading, setAdvancesLoading] = React.useState(false);

  // Disburse Salary Modal State
  const [isPayModalOpen, setIsPayModalOpen] = React.useState(false);
  const [selectedStaff, setSelectedStaff] = React.useState<StaffSalaryLedgerSummary | null>(null);
  const [periodMonth, setPeriodMonth] = React.useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [advanceDeducted, setAdvanceDeducted] = React.useState<number>(0);
  const [otherDeductions, setOtherDeductions] = React.useState<number>(0);
  const [amountPaid, setAmountPaid] = React.useState<number>(0);
  const [paymentMethod, setPaymentMethod] = React.useState<SalaryPaymentMethod>("BANK_TRANSFER");
  const [salaryNotes, setSalaryNotes] = React.useState("");
  const [isDisbursing, setIsDisbursing] = React.useState(false);
  const [salaryModalError, setSalaryModalError] = React.useState<string | null>(null);

  // Give Salary Advance Modal State
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = React.useState(false);
  const [advanceStaffId, setAdvanceStaffId] = React.useState<string>("");
  const [advanceAmount, setAdvanceAmount] = React.useState<number>(0);
  const [advanceDate, setAdvanceDate] = React.useState<string>(() => new Date().toISOString().split("T")[0]);
  const [advancePaymentMethod, setAdvancePaymentMethod] = React.useState<SalaryPaymentMethod>("CASH");
  const [advanceNotes, setAdvanceNotes] = React.useState("");
  const [isRecordingAdvance, setIsRecordingAdvance] = React.useState(false);
  const [advanceModalError, setAdvanceModalError] = React.useState<string | null>(null);

  // Load all data
  const loadData = React.useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [sumRes, histRes, advRes] = await Promise.all([
        getStaffSalarySummaries(),
        getSalaryPaymentHistory(),
        getSalaryAdvances({
          staffId: filterStaffId || undefined,
          status: filterStatus,
          startDate: filterStartDate || undefined,
          endDate: filterEndDate || undefined,
        }),
      ]);

      if (sumRes.success && sumRes.data) {
        setSummaries(sumRes.data);
      }
      if (histRes.success && histRes.data) {
        setHistory(histRes.data);
      }
      if (advRes.success && advRes.data) {
        setAdvances(advRes.data);
      }
    } catch (err: unknown) {
      console.error("Failed to load payroll data:", err);
      addToast({
        type: "error",
        title: "Load Error",
        message: err instanceof Error ? err.message : "Failed to load payroll records.",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterStaffId, filterStatus, filterStartDate, filterEndDate, addToast]);

  // Load filtered advances separately when filters change
  const loadFilteredAdvances = React.useCallback(async () => {
    setAdvancesLoading(true);
    try {
      const res = await getSalaryAdvances({
        staffId: filterStaffId || undefined,
        status: filterStatus,
        startDate: filterStartDate || undefined,
        endDate: filterEndDate || undefined,
      });

      if (res.success && res.data) {
        setAdvances(res.data);
      } else if (!res.success) {
        addToast({
          type: "error",
          title: "Advance Load Error",
          message: res.error || "Failed to load advances.",
        });
      }
    } catch (err: unknown) {
      console.error("Error filtering advances:", err);
    } finally {
      setAdvancesLoading(false);
    }
  }, [filterStaffId, filterStatus, filterStartDate, filterEndDate, addToast]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // Open Salary Disbursement Modal
  const openDisburseModal = (staff: StaffSalaryLedgerSummary) => {
    setSelectedStaff(staff);
    setSalaryModalError(null);
    // Suggest deducting up to available advance or full base salary
    const initialAdvDeduction = Math.min(staff.total_advances_outstanding, staff.base_salary);
    setAdvanceDeducted(initialAdvDeduction);
    setOtherDeductions(0);
    setAmountPaid(Math.max(0, staff.base_salary - initialAdvDeduction));
    setSalaryNotes(`Salary disbursement for ${periodMonth}`);
    setIsPayModalOpen(true);
  };

  // Open Give Advance Modal
  const openGiveAdvanceModal = (preselectedStaffId?: string) => {
    setAdvanceModalError(null);
    const targetId = preselectedStaffId || (summaries.length > 0 ? summaries[0].staff_id : "");
    setAdvanceStaffId(targetId);
    setAdvanceAmount(0);
    setAdvanceDate(new Date().toISOString().split("T")[0]);
    setAdvancePaymentMethod("CASH");
    setAdvanceNotes("");
    setIsAdvanceModalOpen(true);
  };

  // Handle Salary Disbursement Submission
  const handleDisburseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaff) return;
    setSalaryModalError(null);

    // Strict validation: advance deduction cannot exceed outstanding advance
    if (advanceDeducted > selectedStaff.total_advances_outstanding) {
      setSalaryModalError(
        `Advance deduction (${formatCurrency(advanceDeducted)}) cannot exceed outstanding advance balance (${formatCurrency(selectedStaff.total_advances_outstanding)}).`
      );
      return;
    }

    if (advanceDeducted < 0 || otherDeductions < 0) {
      setSalaryModalError("Deductions must be non-negative.");
      return;
    }

    if (amountPaid <= 0) {
      setSalaryModalError("Net disbursed amount must be greater than zero.");
      return;
    }

    setIsDisbursing(true);
    try {
      const input: RecordSalaryPaymentInput = {
        staff_id: selectedStaff.staff_id,
        period_month: periodMonth,
        base_salary: selectedStaff.base_salary,
        advance_deducted: advanceDeducted,
        other_deductions: otherDeductions,
        amount_paid: amountPaid,
        payment_method: paymentMethod,
        payment_date: new Date().toISOString().split("T")[0],
        notes: salaryNotes || `Salary disbursement for ${periodMonth}`,
      };

      const res = await recordSalaryPayment(input);
      if (res.success && res.data) {
        addToast({
          type: "success",
          title: "Salary Disbursed Successfully",
          message: `Disbursed ${formatCurrency(amountPaid)} to ${selectedStaff.staff_name}. Recovered ${formatCurrency(advanceDeducted)} advance.`,
        });
        setIsPayModalOpen(false);
        // Reload all data so advance balances and payments update
        loadData(true);
      } else {
        setSalaryModalError(res.error || "Failed to record salary disbursement.");
      }
    } catch (err: unknown) {
      setSalaryModalError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsDisbursing(false);
    }
  };

  // Handle Salary Advance Submission
  const handleAdvanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdvanceModalError(null);

    if (!advanceStaffId) {
      setAdvanceModalError("Please select an active staff member.");
      return;
    }

    if (advanceAmount <= 0) {
      setAdvanceModalError("Advance amount must be greater than zero.");
      return;
    }

    const staffObj = summaries.find((s) => s.staff_id === advanceStaffId);

    setIsRecordingAdvance(true);
    try {
      const input: RecordSalaryAdvanceInput = {
        staff_id: advanceStaffId,
        amount: advanceAmount,
        advance_date: advanceDate,
        payment_method: advancePaymentMethod,
        reason: advanceNotes || "Mid-month salary advance",
        notes: advanceNotes,
      };

      const res = await recordSalaryAdvance(input);
      if (res.success) {
        addToast({
          type: "success",
          title: "Salary Advance Disbursed",
          message: `Recorded advance of ${formatCurrency(advanceAmount)} for ${staffObj?.staff_name || "staff"}.`,
        });
        setIsAdvanceModalOpen(false);
        // Reload summaries and advances
        loadData(true);
      } else {
        setAdvanceModalError(res.error || "Failed to disburse salary advance.");
      }
    } catch (err: unknown) {
      setAdvanceModalError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsRecordingAdvance(false);
    }
  };

  // Aggregates for KPI Cards
  const totalMonthlyPayroll = summaries.reduce((s, x) => s + x.base_salary, 0);
  const totalOutstandingAdvances = summaries.reduce((s, x) => s + x.total_advances_outstanding, 0);
  const staffWithAdvancesCount = summaries.filter((s) => s.total_advances_outstanding > 0).length;
  const totalPaidThisFiscal = summaries.reduce((s, x) => s + x.total_paid_this_fiscal, 0);

  // Selected staff in Advance Modal for live balance preview
  const advanceTargetStaff = summaries.find((s) => s.staff_id === advanceStaffId);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Staff Salaries & Compensation
            </h1>
            <Badge variant="primary" className="text-xs">
              Advance & Payroll Control
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Owner management of staff compensation, atomic salary advances, and automated FIFO salary deductions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => loadData(true)}
            disabled={refreshing || loading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            variant="primary"
            onClick={() => openGiveAdvanceModal()}
            className="gap-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white font-semibold"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Give Salary Advance
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {/* Monthly Payroll Commitment */}
        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Monthly Payroll Commitment</span>
              <CreditCard className="h-4 w-4 text-primary shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-foreground">
              {formatCurrency(totalMonthlyPayroll)}
            </div>
            <p className="text-[11px] text-muted-foreground">Agreed base compensation</p>
          </CardContent>
        </Card>

        {/* Total Outstanding Staff Advances */}
        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Total Outstanding Advances</span>
              <Wallet className="h-4 w-4 text-amber-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-amber-600 dark:text-amber-400">
              {formatCurrency(totalOutstandingAdvances)}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {staffWithAdvancesCount} of {summaries.length} staff have active advance
            </p>
          </CardContent>
        </Card>

        {/* Disbursed This Fiscal */}
        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Disbursed This Fiscal</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(totalPaidThisFiscal)}
            </div>
            <p className="text-[11px] text-muted-foreground">Recognized salary period expense</p>
          </CardContent>
        </Card>

        {/* Active Staff Count */}
        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Active Staff Count</span>
              <UserCheck className="h-4 w-4 text-blue-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-blue-600 dark:text-blue-400">
              {summaries.length} Staff
            </div>
            <p className="text-[11px] text-muted-foreground">Route & warehouse members</p>
          </CardContent>
        </Card>
      </div>

      {/* TAB NAVIGATION */}
      <div className="flex items-center gap-4 border-b border-border overflow-x-auto scrollbar-none flex-nowrap">
        <button
          onClick={() => setActiveTab("PAYROLL")}
          className={`pb-3 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 -mb-px shrink-0 touch-manipulation min-h-[42px] ${
            activeTab === "PAYROLL"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CreditCard className="h-4 w-4" />
          Staff Compensation & Payroll
        </button>

        <button
          onClick={() => setActiveTab("ADVANCES")}
          className={`pb-3 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 border-b-2 -mb-px shrink-0 touch-manipulation min-h-[42px] ${
            activeTab === "ADVANCES"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="h-4 w-4" />
          Salary Advance Ledger & History
          {advances.length > 0 && (
            <Badge variant="outline" className="text-[10px] ml-1 px-1.5 py-0">
              {advances.length}
            </Badge>
          )}
        </button>
      </div>

      {/* TAB 1: STAFF COMPENSATION & PAYROLL */}
      {activeTab === "PAYROLL" && (
        <div className="space-y-6">
          {/* Staff Salary Roster Table */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-5 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <UserCheck className="h-5 w-5 text-primary" />
                    Staff Compensation Profiles & Outstanding Advances
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Overview of agreed salaries and unsettled advance balances awaiting monthly deduction.
                  </CardDescription>
                </div>
                <span className="text-xs text-muted-foreground">{summaries.length} staff records</span>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {/* Mobile View: High-density Staff Profile Cards */}
              <div className="md:hidden divide-y divide-border/60">
                {summaries.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No staff members found.
                  </div>
                ) : (
                  summaries.map((s) => (
                    <div key={s.staff_id} className="p-3.5 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h4 className="text-xs font-bold text-foreground">{s.staff_name}</h4>
                            <Badge variant="outline" className="text-[9px] py-0">{s.role}</Badge>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {s.salary_type} • Last Paid: {s.last_payment_date ? formatDate(s.last_payment_date) : "Never"}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-extrabold text-foreground block">
                            {formatCurrency(s.base_salary)}
                          </span>
                          {s.total_advances_outstanding > 0 ? (
                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 block">
                              Adv: {formatCurrency(s.total_advances_outstanding)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground block">No Adv</span>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/40">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openGiveAdvanceModal(s.staff_id)}
                          className="h-7 px-2 text-[11px] border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
                        >
                          + Advance
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => openDisburseModal(s)}
                          className="h-7 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                        >
                          Disburse Salary
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop View: Full Data Table */}
              <div className="hidden md:block overflow-x-auto relative">
                <table className="w-full text-left text-xs min-w-[700px]">
                  <thead className="bg-muted/40 text-muted-foreground border-y border-border">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Staff Name</th>
                      <th className="py-3 px-4 font-semibold">Role</th>
                      <th className="py-3 px-4 font-semibold text-right">Agreed Base Salary</th>
                      <th className="py-3 px-4 font-semibold text-right">Frequency</th>
                      <th className="py-3 px-4 font-semibold text-right">Outstanding Advance</th>
                      <th className="py-3 px-4 font-semibold text-right">Last Paid</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {summaries.map((s) => (
                      <tr key={s.staff_id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 font-bold text-foreground">{s.staff_name}</td>
                        <td className="py-3 px-4 text-muted-foreground">{s.role}</td>
                        <td className="py-3 px-4 text-right font-extrabold text-foreground">
                          {formatCurrency(s.base_salary)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Badge variant="outline" className="text-[10px] py-0">
                            {s.salary_type}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {s.total_advances_outstanding > 0 ? (
                            <span className="font-extrabold text-amber-600 dark:text-amber-400">
                              {formatCurrency(s.total_advances_outstanding)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">₹0.00</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-muted-foreground">
                          {s.last_payment_date ? formatDate(s.last_payment_date) : "—"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openGiveAdvanceModal(s.staff_id)}
                              className="h-7 text-xs border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:text-amber-500"
                            >
                              + Advance
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => openDisburseModal(s)}
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                            >
                              Disburse Salary
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {summaries.length === 0 && !loading && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-xs text-muted-foreground">
                          No staff members found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Salary Disbursement History */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Salary Payment Remittance History
              </CardTitle>
              <CardDescription className="text-xs">
                Immutable audit records from public.salary_payments showing advance deductions and net remittances.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-0">
              {/* Mobile View: High-density Salary Payment History Cards */}
              <div className="md:hidden divide-y divide-border/60">
                {history.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No salary payment records found.
                  </div>
                ) : (
                  history.map((h) => (
                    <div key={h.id} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h4 className="text-xs font-bold text-foreground">{h.staff_name}</h4>
                            <span className="text-[10px] text-muted-foreground font-mono">({h.period_month})</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDate(h.payment_date)} • #{h.voucher_number}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 block">
                            {formatCurrency(h.amount_paid)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            Base: {formatCurrency(h.base_salary)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-0.5">
                        <span className="text-muted-foreground">
                          {h.advance_deducted > 0 ? `Adv Deducted: -${formatCurrency(h.advance_deducted)}` : "No Advance Deduction"}
                        </span>
                        <Badge variant="outline" className="text-[9px] py-0">
                          {h.payment_method.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop View: Full Data Table */}
              <div className="hidden md:block overflow-x-auto relative">
                <table className="w-full text-left text-xs min-w-[700px]">
                  <thead className="bg-muted/40 text-muted-foreground border-y border-border">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Payment Date</th>
                      <th className="py-3 px-4 font-semibold">Staff Member</th>
                      <th className="py-3 px-4 font-semibold">Period Month</th>
                      <th className="py-3 px-4 font-semibold text-right">Base Salary</th>
                      <th className="py-3 px-4 font-semibold text-right">Advance Deducted</th>
                      <th className="py-3 px-4 font-semibold text-right">Net Paid</th>
                      <th className="py-3 px-4 font-semibold text-right">Payment Mode</th>
                      <th className="py-3 px-4 font-semibold">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {history.map((h) => (
                      <tr key={h.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                          <div>{formatDate(h.payment_date)}</div>
                          <span className="font-mono text-[10px] text-muted-foreground block">{h.voucher_number}</span>
                        </td>
                        <td className="py-3 px-4 font-bold text-foreground">{h.staff_name}</td>
                        <td className="py-3 px-4 font-mono">{h.period_month}</td>
                        <td className="py-3 px-4 text-right text-muted-foreground">
                          {formatCurrency(h.base_salary)}
                        </td>
                        <td className="py-3 px-4 text-right text-amber-600 dark:text-amber-400 font-semibold">
                          {h.advance_deducted > 0 ? `-${formatCurrency(h.advance_deducted)}` : "—"}
                        </td>
                        <td className="py-3 px-4 text-right font-extrabold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(h.amount_paid)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Badge variant="outline" className="text-[10px] py-0">
                            {h.payment_method.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground max-w-xs truncate" title={h.notes || ""}>
                          {h.notes || "—"}
                        </td>
                      </tr>
                    ))}
                    {history.length === 0 && !loading && (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-xs text-muted-foreground">
                          No salary payment records found.
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

      {/* TAB 2: SALARY ADVANCE LEDGER & HISTORY */}
      {activeTab === "ADVANCES" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <Card className="border-border shadow-xs">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {/* Staff Filter */}
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                    Staff Member
                  </label>
                  <select
                    value={filterStaffId}
                    onChange={(e) => setFilterStaffId(e.target.value)}
                    className="w-full h-9 rounded-md border border-border bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">All Staff Members</option>
                    {summaries.map((s) => (
                      <option key={s.staff_id} value={s.staff_id}>
                        {s.staff_name} {s.total_advances_outstanding > 0 ? `(Bal: ${formatCurrency(s.total_advances_outstanding)})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Filter */}
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                    Settlement Status
                  </label>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as "ALL" | "OUTSTANDING" | "SETTLED")}
                    className="w-full h-9 rounded-md border border-border bg-card px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="ALL">All Advances</option>
                    <option value="OUTSTANDING">Outstanding Advances (Unsettled)</option>
                    <option value="SETTLED">Fully Settled Advances</option>
                  </select>
                </div>

                {/* Start Date */}
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                    From Date
                  </label>
                  <Input
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    className="text-xs h-9"
                  />
                </div>

                {/* End Date */}
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                    To Date
                  </label>
                  <Input
                    type="date"
                    value={filterEndDate}
                    onChange={(e) => setFilterEndDate(e.target.value)}
                    className="text-xs h-9"
                  />
                </div>

                {/* Filter Actions */}
                <div className="flex items-end gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={loadFilteredAdvances}
                    disabled={advancesLoading}
                    className="flex-1 text-xs h-9 gap-1.5"
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Apply
                  </Button>
                  {(filterStaffId || filterStatus !== "ALL" || filterStartDate || filterEndDate) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setFilterStaffId("");
                        setFilterStatus("ALL");
                        setFilterStartDate("");
                        setFilterEndDate("");
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

          {/* Advances Ledger Table */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-5 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <History className="h-5 w-5 text-amber-500" />
                    Staff Salary Advance Ledger & Audit Trail
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Complete history of advances disbursed, recovered via salary deductions, and active balances.
                  </CardDescription>
                </div>
                <span className="text-xs text-muted-foreground">
                  Showing {advances.length} advance records
                </span>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {/* Mobile View: High-density Advance Ledger Cards */}
              <div className="md:hidden divide-y divide-border/60">
                {advances.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No advance records found.
                  </div>
                ) : (
                  advances.map((adv) => (
                    <div key={adv.id} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h4 className="text-xs font-bold text-foreground">{adv.staff_name}</h4>
                            <Badge variant={adv.is_settled ? "success" : "warning"} className="text-[9px] py-0">
                              {adv.is_settled ? "SETTLED" : "OUTSTANDING"}
                            </Badge>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDate(adv.advance_date)} • {adv.payment_method}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-black text-foreground block">
                            {formatCurrency(adv.amount)}
                          </span>
                          {adv.remaining_balance > 0 ? (
                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 block">
                              Bal: {formatCurrency(adv.remaining_balance)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block font-semibold">
                              Fully Settled
                            </span>
                          )}
                        </div>
                      </div>

                      {adv.reason && (
                        <p className="text-[11px] text-muted-foreground italic bg-muted/20 p-1.5 rounded-md">
                          {adv.reason}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Desktop View: Full Data Table */}
              <div className="hidden md:block overflow-x-auto relative">
                <table className="w-full text-left text-xs min-w-[700px]">
                  <thead className="bg-muted/40 text-muted-foreground border-y border-border">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Advance Date</th>
                      <th className="py-3 px-4 font-semibold">Staff Member</th>
                      <th className="py-3 px-4 font-semibold text-right">Advance Amount</th>
                      <th className="py-3 px-4 font-semibold text-right">Recovered</th>
                      <th className="py-3 px-4 font-semibold text-right">Remaining Balance</th>
                      <th className="py-3 px-4 font-semibold text-center">Payment Mode</th>
                      <th className="py-3 px-4 font-semibold text-center">Status</th>
                      <th className="py-3 px-4 font-semibold">Notes / Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {advances.map((adv) => (
                      <tr key={adv.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                          {formatDate(adv.advance_date)}
                        </td>
                        <td className="py-3 px-4 font-bold text-foreground">
                          {adv.staff_name}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                          {formatCurrency(adv.amount)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                          {adv.amount_deducted > 0 ? formatCurrency(adv.amount_deducted) : "₹0.00"}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-extrabold">
                          {adv.remaining_balance > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400">
                              {formatCurrency(adv.remaining_balance)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">₹0.00</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge variant="outline" className="text-[10px] py-0">
                            {adv.payment_method}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center">
                          {adv.is_settled ? (
                            <Badge variant="success" className="text-[10px] py-0">
                              SETTLED
                            </Badge>
                          ) : (
                            <Badge variant="warning" className="text-[10px] py-0">
                              OUTSTANDING
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground max-w-xs truncate" title={adv.reason || adv.notes || ""}>
                          {adv.reason || adv.notes || "—"}
                        </td>
                      </tr>
                    ))}
                    {advances.length === 0 && !advancesLoading && (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-xs text-muted-foreground">
                          No salary advance records match the selected filters.
                        </td>
                      </tr>
                    )}
                    {advancesLoading && (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-xs text-muted-foreground">
                          <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                          Loading salary advances...
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

      {/* MODAL 1: GIVE SALARY ADVANCE */}
      {isAdvanceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Wallet className="h-5 w-5 text-amber-500" />
                Give Staff Salary Advance
              </h3>
              <button
                onClick={() => setIsAdvanceModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {advanceModalError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{advanceModalError}</span>
              </div>
            )}

            <form onSubmit={handleAdvanceSubmit} className="space-y-3">
              {/* Select Staff Member */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Select Active Staff Member</label>
                <select
                  value={advanceStaffId}
                  onChange={(e) => setAdvanceStaffId(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="" disabled>Choose staff member...</option>
                  {summaries.map((s) => (
                    <option key={s.staff_id} value={s.staff_id}>
                      {s.staff_name} — Base: {formatCurrency(s.base_salary)} (Current Adv: {formatCurrency(s.total_advances_outstanding)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Amount and Date */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Advance Amount (₹)</label>
                  <Input
                    type="number"
                    min={1}
                    value={advanceAmount || ""}
                    onChange={(e) => setAdvanceAmount(Number(e.target.value))}
                    placeholder="e.g. 2000"
                    required
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Disbursement Date</label>
                  <Input
                    type="date"
                    value={advanceDate}
                    onChange={(e) => setAdvanceDate(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Payment Method */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Disbursement Payment Mode</label>
                <select
                  value={advancePaymentMethod}
                  onChange={(e) => setAdvancePaymentMethod(e.target.value as SalaryPaymentMethod)}
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="CASH">Cash Drawer (Vault 1010)</option>
                  <option value="UPI">UPI Payment (Bank 1020)</option>
                  <option value="BANK_TRANSFER">Bank Transfer (Bank 1020)</option>
                </select>
              </div>

              {/* Reason / Notes */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Reason / Optional Notes</label>
                <Input
                  placeholder="e.g. Festival advance, emergency medical loan"
                  value={advanceNotes}
                  onChange={(e) => setAdvanceNotes(e.target.value)}
                  className="text-xs"
                />
              </div>

              {/* Balance Preview Card */}
              {advanceTargetStaff && advanceAmount > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Current Outstanding Advance:</span>
                    <span className="font-semibold text-foreground">
                      {formatCurrency(advanceTargetStaff.total_advances_outstanding)}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>New Advance Added:</span>
                    <span className="font-bold text-amber-600">
                      +{formatCurrency(advanceAmount)}
                    </span>
                  </div>
                  <div className="flex justify-between font-extrabold text-foreground pt-1 border-t border-border">
                    <span>Total Outstanding After Disbursement:</span>
                    <span className="text-amber-600 dark:text-amber-400">
                      {formatCurrency(advanceTargetStaff.total_advances_outstanding + advanceAmount)}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAdvanceModalOpen(false)}
                  disabled={isRecordingAdvance}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isRecordingAdvance || advanceAmount <= 0}
                  className="bg-amber-600 hover:bg-amber-500 text-white font-semibold"
                >
                  {isRecordingAdvance ? "Recording..." : "Confirm Advance"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: DISBURSE SALARY WITH AUTOMATIC ADVANCE DEDUCTION */}
      {isPayModalOpen && selectedStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" />
                Disburse Monthly Salary — {selectedStaff.staff_name}
              </h3>
              <button
                onClick={() => setIsPayModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {salaryModalError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{salaryModalError}</span>
              </div>
            )}

            <form onSubmit={handleDisburseSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Period Month</label>
                  <Input
                    type="month"
                    value={periodMonth}
                    onChange={(e) => setPeriodMonth(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Payment Mode</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as SalaryPaymentMethod)
                    }
                    className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="BANK_TRANSFER">Bank Transfer (IMPS/NEFT)</option>
                    <option value="UPI">UPI Payment</option>
                    <option value="CASH">Cash Payment</option>
                  </select>
                </div>
              </div>

              {/* Deductions & Salary Calculation Card */}
              <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-2.5 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Agreed Base Salary:</span>
                  <span className="font-bold text-foreground">{formatCurrency(selectedStaff.base_salary)}</span>
                </div>

                <div className="flex justify-between items-center text-amber-600 dark:text-amber-400 font-semibold bg-amber-500/10 p-2 rounded-lg">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    <span>Total Outstanding Advance:</span>
                  </div>
                  <span>{formatCurrency(selectedStaff.total_advances_outstanding)}</span>
                </div>

                {/* Advance Deducted Input */}
                <div className="space-y-1 pt-1 border-t border-border/60">
                  <div className="flex items-center justify-between gap-2">
                    <label className="font-semibold text-foreground">Advance Deducted (₹):</label>
                    <Input
                      type="number"
                      value={advanceDeducted}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        // Never allow deducting more than outstanding advance
                        const clamped = Math.max(0, Math.min(raw, selectedStaff.total_advances_outstanding));
                        setAdvanceDeducted(clamped);
                        setAmountPaid(Math.max(0, selectedStaff.base_salary - clamped - otherDeductions));
                      }}
                      max={selectedStaff.total_advances_outstanding}
                      min={0}
                      disabled={selectedStaff.total_advances_outstanding === 0}
                      className="w-32 text-xs h-7 text-right font-bold text-amber-600"
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>
                      {selectedStaff.total_advances_outstanding > 0
                        ? `Max deductible: ${formatCurrency(selectedStaff.total_advances_outstanding)}`
                        : "No outstanding advance to deduct"}
                    </span>
                    <span>
                      New advance bal:{" "}
                      <strong className="text-foreground">
                        {formatCurrency(Math.max(0, selectedStaff.total_advances_outstanding - advanceDeducted))}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* Other Deductions Input */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Other Deductions:</span>
                  <Input
                    type="number"
                    value={otherDeductions}
                    onChange={(e) => {
                      const oth = Math.max(0, Number(e.target.value));
                      setOtherDeductions(oth);
                      setAmountPaid(Math.max(0, selectedStaff.base_salary - advanceDeducted - oth));
                    }}
                    min={0}
                    className="w-32 text-xs h-7 text-right font-bold"
                  />
                </div>

                {/* Net Final Payable Salary */}
                <div className="flex justify-between text-base font-extrabold text-foreground pt-2 border-t border-border">
                  <span>Final Payable Salary:</span>
                  <span className="text-emerald-600 dark:text-emerald-400">{formatCurrency(amountPaid)}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Remarks / Ref #</label>
                <Input
                  placeholder="e.g. Bank transaction reference or month settlement"
                  value={salaryNotes}
                  onChange={(e) => setSalaryNotes(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsPayModalOpen(false)}
                  disabled={isDisbursing}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isDisbursing || amountPaid <= 0}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                >
                  {isDisbursing ? "Disbursing..." : "Confirm Disbursement"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
