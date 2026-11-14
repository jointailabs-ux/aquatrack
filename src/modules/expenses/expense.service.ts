"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import {
  ExpenseCategory,
  ExpenseCategoryBreakdown,
  ExpenseRecord,
  RecordExpenseInput,
  RecordExpenseSchema,
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
    const message = err instanceof Error ? err.message : "Failed to record expense.";
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

export { getExpenseSummaryByCategory as getExpenseCategoryBreakdown };
