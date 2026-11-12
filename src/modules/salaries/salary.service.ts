"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import {
  RecordSalaryAdvanceInput,
  RecordSalaryAdvanceSchema,
  RecordSalaryPaymentInput,
  RecordSalaryPaymentSchema,
  SalaryPaymentRecord,
  StaffSalaryLedgerSummary,
  SalaryAdvanceRecord,
  SalaryAdvanceFilterParams,
} from "./salary.schema";

/**
 * Retrieve staff salary summaries for owner review
 * Aggregates real base salary, active advances, and fiscal disbursements
 */
export async function getStaffSalarySummaries(): Promise<ActionResponse<StaffSalaryLedgerSummary[]>> {
  try {
    const supabase = await createClient();

    // Fetch staff profiles
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, full_name, role, salary_amount, salary_type")
      .eq("role", "staff")
      .order("full_name", { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    const summaries: StaffSalaryLedgerSummary[] = await Promise.all(
      (profiles || []).map(async (p) => {
        const baseSalary = Number(p.salary_amount || 0);

        // Fetch unsettled advances for this staff
        const { data: advances } = await supabase
          .from("salary_advances")
          .select("amount, amount_deducted")
          .eq("staff_id", p.id)
          .eq("is_settled", false);

        const totalAdvances = (advances || []).reduce(
          (sum, a) =>
            sum + Math.max(0, Number(a.amount || 0) - Number(a.amount_deducted || 0)),
          0
        );

        // Fetch disbursement history for this staff
        const { data: payments } = await supabase
          .from("salary_payments")
          .select("net_paid, amount_paid, payment_date")
          .eq("staff_id", p.id)
          .order("payment_date", { ascending: false });

        const lastPayment = payments?.[0]?.payment_date || null;
        const totalPaid = (payments || []).reduce(
          (sum, pay) => sum + Number(pay.amount_paid ?? pay.net_paid ?? 0),
          0
        );

        return {
          staff_id: p.id,
          staff_name: p.full_name,
          role: "Delivery Staff",
          base_salary: baseSalary,
          salary_type: p.salary_type || "MONTHLY",
          total_advances_outstanding: totalAdvances,
          last_payment_date: lastPayment,
          total_paid_this_fiscal: totalPaid,
        };
      })
    );

    return { success: true, data: summaries };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve salary summaries.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve salary disbursement history directly from public.salary_payments
 * Zero mock records
 */
export async function getSalaryPaymentHistory(
  staffId?: string
): Promise<ActionResponse<SalaryPaymentRecord[]>> {
  try {
    const supabase = await createClient();

    let query = supabase
      .from("salary_payments")
      .select(`
        id,
        voucher_number,
        staff_id,
        period_month,
        base_salary,
        advance_deducted,
        other_deductions,
        net_payable,
        amount_paid,
        net_paid,
        payment_method,
        payment_date,
        notes,
        created_at,
        staff:profiles!salary_payments_staff_id_fkey(full_name)
      `)
      .order("payment_date", { ascending: false });

    if (staffId) {
      query = query.eq("staff_id", staffId);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    interface SalaryQueryRow {
      id: string;
      voucher_number?: string | null;
      staff_id: string;
      period_month: string;
      base_salary: number | string;
      advance_deducted: number | string;
      other_deductions?: number | string | null;
      net_payable?: number | string | null;
      amount_paid?: number | string | null;
      net_paid?: number | string | null;
      payment_method: SalaryPaymentRecord["payment_method"];
      payment_date: string;
      notes?: string | null;
      created_at: string;
      staff?: { full_name: string } | null;
    }

    const history: SalaryPaymentRecord[] = ((data || []) as unknown as SalaryQueryRow[]).map((row) => {
      const base = Number(row.base_salary);
      const adv = Number(row.advance_deducted || 0);
      const other = Number(row.other_deductions || 0);
      const netPayable = Number(row.net_payable ?? Math.max(0, base - adv - other));
      const paid = Number(row.amount_paid ?? row.net_paid ?? 0);

      return {
        id: row.id,
        voucher_number: row.voucher_number || `SAL-${row.id.slice(0, 8)}`,
        staff_id: row.staff_id,
        staff_name: row.staff?.full_name || "Staff Member",
        period_month: row.period_month,
        base_salary: base,
        advance_deducted: adv,
        other_deductions: other,
        net_payable: netPayable,
        amount_paid: paid,
        net_paid: paid,
        amount_remaining: Math.max(0, netPayable - paid),
        payment_method: row.payment_method,
        payment_date: row.payment_date,
        notes: row.notes,
        created_at: row.created_at,
      };
    });

    return { success: true, data: history };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve payment history.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve staff salary advances history with recovered amount and remaining balance
 * Supports filtering by staff member, status (OUTSTANDING, SETTLED, ALL), and date range
 */
export async function getSalaryAdvances(
  params?: SalaryAdvanceFilterParams
): Promise<ActionResponse<SalaryAdvanceRecord[]>> {
  try {
    const supabase = await createClient();

    let query = supabase
      .from("salary_advances")
      .select(`
        id,
        staff_id,
        amount,
        amount_deducted,
        payment_method,
        advance_date,
        reason,
        notes,
        is_settled,
        is_deducted,
        deducted_in_payment_id,
        created_at,
        staff:profiles!salary_advances_staff_id_fkey(full_name)
      `)
      .order("advance_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (params?.staffId) {
      query = query.eq("staff_id", params.staffId);
    }

    if (params?.status === "OUTSTANDING") {
      query = query.eq("is_settled", false);
    } else if (params?.status === "SETTLED") {
      query = query.eq("is_settled", true);
    }

    if (params?.startDate) {
      query = query.gte("advance_date", params.startDate);
    }
    if (params?.endDate) {
      query = query.lte("advance_date", params.endDate);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    interface SalaryAdvanceQueryRow {
      id: string;
      staff_id: string;
      amount: number | string;
      amount_deducted?: number | string | null;
      payment_method: SalaryAdvanceRecord["payment_method"];
      advance_date: string;
      reason?: string | null;
      notes?: string | null;
      is_settled?: boolean | null;
      is_deducted?: boolean | null;
      deducted_in_payment_id?: string | null;
      created_at: string;
      staff?: { full_name: string } | null;
    }

    const records: SalaryAdvanceRecord[] = (
      (data || []) as unknown as SalaryAdvanceQueryRow[]
    ).map((row) => {
      const amt = Number(row.amount || 0);
      const deducted = Number(row.amount_deducted || 0);
      const remaining = Math.max(0, amt - deducted);

      return {
        id: row.id,
        staff_id: row.staff_id,
        staff_name: row.staff?.full_name || "Staff Member",
        amount: amt,
        amount_deducted: deducted,
        remaining_balance: remaining,
        payment_method: row.payment_method,
        advance_date: row.advance_date,
        reason: row.reason || row.notes,
        notes: row.notes,
        is_settled: Boolean(row.is_settled || remaining <= 0),
        is_deducted: Boolean(row.is_deducted || deducted > 0),
        deducted_in_payment_id: row.deducted_in_payment_id,
        created_at: row.created_at,
      };
    });

    return { success: true, data: records };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to retrieve salary advances.";
    return { success: false, error: message };
  }
}

/**
 * Record a staff salary disbursement with advance deduction
 * Uses atomic PostgreSQL RPC rpc_record_salary_payment
 * Disallows duplicate salary disbursements and writes balanced ledger
 */
export async function recordSalaryPayment(
  input: RecordSalaryPaymentInput
): Promise<ActionResponse<SalaryPaymentRecord>> {
  try {
    const validated = RecordSalaryPaymentSchema.parse(input);
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("rpc_record_salary_payment", {
      p_staff_id: validated.staff_id,
      p_period_month: validated.period_month,
      p_base_salary: validated.base_salary,
      p_advance_deducted: validated.advance_deducted,
      p_other_deductions: validated.other_deductions,
      p_amount_paid: validated.amount_paid,
      p_payment_method: validated.payment_method,
      p_payment_date: validated.payment_date,
      p_notes: validated.notes || null,
      p_idempotency_key: validated.idempotency_key || null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    const { data: staffProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", validated.staff_id)
      .single();

    const record: SalaryPaymentRecord = {
      id: data.payment_id,
      voucher_number: data.voucher_number,
      staff_id: validated.staff_id,
      staff_name: staffProfile?.full_name || "Staff Member",
      period_month: validated.period_month,
      base_salary: Number(data.authoritative_base_salary ?? validated.base_salary),
      advance_deducted: validated.advance_deducted,
      other_deductions: validated.other_deductions,
      net_payable: Number(data.net_payable),
      amount_paid: Number(data.amount_paid),
      net_paid: Number(data.amount_paid),
      amount_remaining: Math.max(0, Number(data.net_payable)),
      payment_method: validated.payment_method,
      payment_date: validated.payment_date,
      notes: validated.notes,
      created_at: new Date().toISOString(),
    };

    return { success: true, data: record };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record salary payment.";
    return { success: false, error: message };
  }
}

/**
 * Record a mid-month salary advance for staff
 * Calls atomic PostgreSQL RPC rpc_record_salary_advance with balanced ledger posting
 */
export async function recordSalaryAdvance(
  input: RecordSalaryAdvanceInput
): Promise<ActionResponse<{ success: boolean; advanceId: string }>> {
  try {
    const validated = RecordSalaryAdvanceSchema.parse(input);
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to disburse salary advances." };
    }

    const desc = validated.reason || validated.notes || "Salary advance disbursement";

    const { data: rpcResult, error: rpcError } = await supabase.rpc("rpc_record_salary_advance", {
      p_staff_id: validated.staff_id,
      p_amount: validated.amount,
      p_payment_method: validated.payment_method || "CASH",
      p_advance_date: validated.advance_date,
      p_notes: desc,
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    return { success: true, data: { success: true, advanceId: rpcResult.advance_id } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record salary advance.";
    return { success: false, error: message };
  }
}
