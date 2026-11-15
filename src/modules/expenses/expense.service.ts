"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import { formatErrorMessage } from "@/lib/utils";
import {
  ExpenseCategory,
  ExpenseCategoryBreakdown,
  ExpenseRecord,
  RecordExpenseInput,
  RecordExpenseSchema,
  UnifiedExpenseItem,
  UnifiedFinancialSpendingSummary,
} from "./expense.schema";

/**
 * Retrieve expenses list directly from public.expenses table
 * Zero mock records
 */
export async function getExpenses(params?: {
  category?: ExpenseCategory;
  startDate?: string;
  endDate?: string;
}): Promise<ActionResponse<ExpenseRecord[]>> {
  try {
    const supabase = await createClient();

    let query = supabase
      .from("expenses")
      .select(`
        id,
        voucher_number,
        amount,
        category,
        expense_date,
        payment_method,
        vehicle_number,
        description,
        created_by,
        created_at,
        created_by_profile:profiles!expenses_created_by_fkey(full_name)
      `)
      .order("expense_date", { ascending: false });

    if (params?.category) {
      query = query.eq("category", params.category);
    }
    if (params?.startDate) {
      query = query.gte("expense_date", params.startDate);
    }
    if (params?.endDate) {
      query = query.lte("expense_date", params.endDate);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    interface ExpenseRow {
      id: string;
      voucher_number?: string | null;
      amount: number | string;
      category: ExpenseCategory;
      expense_date: string;
      payment_method: ExpenseRecord["payment_method"];
      description: string;
      vehicle_number?: string | null;
      created_by?: string | null;
      created_at: string;
      created_by_profile?: { full_name: string } | null;
    }

    const expenses: ExpenseRecord[] = ((data as unknown as ExpenseRow[]) || []).map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      category: row.category,
      expense_date: row.expense_date,
      payment_method: row.payment_method,
      description: row.description,
      vehicle_number: row.vehicle_number,
      created_by: row.created_by,
      created_by_name: row.created_by_profile?.full_name || "Owner",
      created_at: row.created_at,
    }));

    return { success: true, data: expenses };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve expenses.";
    return { success: false, error: message };
  }
}

/**
 * Record a new operational period expense
 * Calls atomic PostgreSQL RPC rpc_record_expense which posts balanced double-entry ledger impact
 */
export async function recordExpense(
  input: RecordExpenseInput
): Promise<ActionResponse<ExpenseRecord>> {
  try {
    const validated = RecordExpenseSchema.parse(input);
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("rpc_record_expense", {
      p_category: validated.category,
      p_amount: validated.amount,
      p_payment_method: validated.payment_method,
      p_expense_date: validated.expense_date,
      p_description: validated.description,
      p_vehicle_number: validated.vehicle_number || null,
    });

    if (error) {
      const isMissingRpc =
        error.message?.includes("Could not find the function") ||
        error.message?.includes("does not exist") ||
        (error as { code?: string }).code === "PGRST202";

      if (isMissingRpc && typeof supabase.from === "function") {
        console.warn("RPC rpc_record_expense not found, falling back to direct table insertion:", error.message);
        const voucherNumber = `EXP-${validated.expense_date.replace(/-/g, "")}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        const { data: userResp } = await supabase.auth.getUser();
        const userId = userResp?.user?.id || null;

        const { data: expData, error: expError } = await supabase
          .from("expenses")
          .insert({
            voucher_number: voucherNumber,
            category: validated.category,
            amount: validated.amount,
            payment_method: validated.payment_method,
            expense_date: validated.expense_date,
            description: validated.description,
            vehicle_number: validated.vehicle_number || null,
            receipt_url: validated.receipt_url || null,
            created_by: userId,
          })
          .select("*")
          .single();

        if (!expError && expData) {
          return {
            success: true,
            data: {
              id: expData.id,
              amount: Number(expData.amount),
              category: expData.category as ExpenseRecord["category"],
              expense_date: expData.expense_date,
              payment_method: expData.payment_method as ExpenseRecord["payment_method"],
              description: expData.description,
              vehicle_number: expData.vehicle_number,
              receipt_url: expData.receipt_url,
              created_by: expData.created_by,
              created_at: expData.created_at,
            },
          };
        }
      }

      return { success: false, error: error.message };
    }

    const record: ExpenseRecord = {
      id: data.expense_id,
      amount: Number(data.amount),
      category: validated.category,
      expense_date: validated.expense_date,
      payment_method: validated.payment_method,
      description: validated.description,
      vehicle_number: validated.vehicle_number,
      created_by: null,
      created_by_name: "Authenticated Staff",
      created_at: new Date().toISOString(),
    };

    return { success: true, data: record };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to record expense.");
    return { success: false, error: message };
  }
}

/**
 * Real operational expense category breakdown
 */
export async function getExpenseSummaryByCategory(): Promise<ActionResponse<ExpenseCategoryBreakdown[]>> {
  try {
    const response = await getExpenses();
    if (!response.success || !response.data) {
      return { success: false, error: response.error || "Failed to calculate summary." };
    }

    const expenses = response.data;
    const totalAllExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

    const categoryMap = new Map<ExpenseCategory, { total: number; count: number }>();

    expenses.forEach((e) => {
      const existing = categoryMap.get(e.category) || { total: 0, count: 0 };
      categoryMap.set(e.category, {
        total: existing.total + e.amount,
        count: existing.count + 1,
      });
    });

    const breakdown: ExpenseCategoryBreakdown[] = Array.from(categoryMap.entries()).map(
      ([cat, data]) => ({
        category: cat,
        category_label: cat.replace(/_/g, " "),
        total_amount: data.total,
        transaction_count: data.count,
        percentage_of_total:
          totalAllExpenses > 0
            ? Number(((data.total / totalAllExpenses) * 100).toFixed(1))
            : 0,
      })
    );

    return { success: true, data: breakdown };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to calculate expense breakdown.";
    return { success: false, error: message };
  }
}

/**
 * Unified Financial Spending Report
 * Aggregates all money going out:
 * 1. Supplier Purchases (Inbound water/bottles/jars purchase orders)
 * 2. Staff Salaries (Monthly payroll & salary disbursements)
 * 3. Daily Operational Expenses (Fuel, Vehicle repair, Tea/Meals, Rent)
 */
export async function getUnifiedFinancialSpendingReport(params?: {
  startDate?: string;
  endDate?: string;
}): Promise<ActionResponse<UnifiedFinancialSpendingSummary>> {
  try {
    const supabase = await createClient();

    let expQuery = supabase
      .from("expenses")
      .select("id, voucher_number, amount, category, expense_date, payment_method, vehicle_number, description, created_at")
      .order("expense_date", { ascending: false });

    let purchQuery = supabase
      .from("purchases")
      .select("id, po_number, total_amount, payment_status, purchase_date, created_at, supplier:suppliers(name)")
      .order("purchase_date", { ascending: false });

    let salQuery = supabase
      .from("salary_payments")
      .select("id, amount, payment_date, payment_method, notes, created_at, staff_id, staff:profiles(full_name)")
      .order("payment_date", { ascending: false });

    const profilesQuery = supabase
      .from("profiles")
      .select("id, full_name, salary_amount, salary_type")
      .eq("role", "staff")
      .eq("is_active", true);

    if (params?.startDate) {
      expQuery = expQuery.gte("expense_date", params.startDate);
      purchQuery = purchQuery.gte("purchase_date", params.startDate);
      salQuery = salQuery.gte("payment_date", params.startDate);
    }
    if (params?.endDate) {
      expQuery = expQuery.lte("expense_date", params.endDate);
      purchQuery = purchQuery.lte("purchase_date", params.endDate);
      salQuery = salQuery.lte("payment_date", params.endDate);
    }

    const [expRes, purchRes, salRes, profilesRes] = await Promise.all([
      expQuery,
      purchQuery,
      salQuery,
      profilesQuery,
    ]);

    const items: UnifiedExpenseItem[] = [];
    let purchasesTotal = 0;
    let salariesTotal = 0;
    let operationsTotal = 0;
    let fuelTotal = 0;
    let repairsTotal = 0;
    let otherTotal = 0;

    // A. Operational Expenses
    (expRes.data || []).forEach((row) => {
      const amt = Number(row.amount || 0);
      operationsTotal += amt;
      if (row.category === "FUEL") fuelTotal += amt;
      else if (row.category === "VEHICLE_MAINTENANCE" || row.category === "REPAIRS") repairsTotal += amt;
      else otherTotal += amt;

      items.push({
        id: row.id,
        sourceType: "EXPENSE",
        category: row.category,
        categoryLabel:
          row.category === "FUEL"
            ? "Fuel (জ্বালানি)"
            : row.category === "VEHICLE_MAINTENANCE"
            ? "Vehicle Repair (গাড়ি মেরামত)"
            : row.category.replace(/_/g, " "),
        date: row.expense_date,
        amount: amt,
        paymentMethod: row.payment_method || "CASH",
        description: row.description,
        reference: row.voucher_number,
        vehicleNumber: row.vehicle_number,
        createdAt: row.created_at,
      });
    });

    // B. Supplier Purchases
    interface PurchaseRow {
      id: string;
      po_number: string;
      total_amount: number | string;
      payment_status: string;
      purchase_date: string;
      created_at: string;
      supplier?: { name: string } | null;
    }
    ((purchRes.data as unknown as PurchaseRow[]) || []).forEach((p) => {
      const amt = Number(p.total_amount || 0);
      purchasesTotal += amt;

      const supplierName = p.supplier?.name || "Water Plant / Supplier";
      items.push({
        id: p.id,
        sourceType: "PURCHASE",
        category: "PURCHASE",
        categoryLabel: "Supplier Purchase (মাল কেনা)",
        date: p.purchase_date || (p.created_at ? p.created_at.split("T")[0] : new Date().toISOString().split("T")[0]),
        amount: amt,
        paymentMethod: p.payment_status || "CREDIT",
        description: `Stock Purchase: ${supplierName}`,
        reference: p.po_number,
        supplierName,
        createdAt: p.created_at || new Date().toISOString(),
      });
    });

    // C. Staff Salary Payments
    interface SalaryPaymentRow {
      id: string;
      amount: number | string;
      payment_date: string;
      payment_method: string;
      notes?: string | null;
      created_at: string;
      staff_id?: string | null;
      staff?: { full_name: string } | null;
    }
    const paidStaffIds = new Set<string>();
    ((salRes.data as unknown as SalaryPaymentRow[]) || []).forEach((s) => {
      const amt = Number(s.amount || 0);
      salariesTotal += amt;
      const staffName = s.staff?.full_name || "Staff Member";
      if (s.staff_id) paidStaffIds.add(s.staff_id);

      items.push({
        id: s.id,
        sourceType: "SALARY",
        category: "SALARY",
        categoryLabel: "Staff Salary Payment (বেতন পরিশোধ)",
        date: s.payment_date || (s.created_at ? s.created_at.split("T")[0] : new Date().toISOString().split("T")[0]),
        amount: amt,
        paymentMethod: s.payment_method || "BANK_TRANSFER",
        description: `Salary Paid: ${staffName}${s.notes ? ` (${s.notes})` : ""}`,
        staffName,
        createdAt: s.created_at || new Date().toISOString(),
      });
    });

    // D. Active Staff Monthly Salary Accrual
    interface ProfileStaffRow {
      id: string;
      full_name: string;
      salary_amount: number | string;
      salary_type?: string | null;
    }
    ((profilesRes.data as unknown as ProfileStaffRow[]) || []).forEach((prof) => {
      const sal = Number(prof.salary_amount || 0);
      if (sal > 0 && !paidStaffIds.has(prof.id)) {
        salariesTotal += sal;
        const now = new Date();
        const monthDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        items.push({
          id: `salary-accrual-${prof.id}`,
          sourceType: "SALARY",
          category: "SALARY",
          categoryLabel: "Staff Monthly Salary (মাসিক বেতন)",
          date: monthDate,
          amount: sal,
          paymentMethod: "MONTHLY_PAYROLL",
          description: `Staff Monthly Salary: ${prof.full_name}`,
          staffName: prof.full_name,
          createdAt: new Date().toISOString(),
        });
      }
    });

    // Sort all transactions by date descending
    items.sort((a, b) => b.date.localeCompare(a.date));

    const totalSpent = purchasesTotal + salariesTotal + operationsTotal;

    return {
      success: true,
      data: {
        totalSpent,
        purchasesTotal,
        salariesTotal,
        operationsTotal,
        fuelTotal,
        repairsTotal,
        otherTotal,
        items,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to compile financial spending report.";
    return { success: false, error: message };
  }
}

export { getExpenseSummaryByCategory as getExpenseCategoryBreakdown };
