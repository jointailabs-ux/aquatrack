import { z } from "zod";

export const SalaryPaymentMethodEnum = z.enum(["BANK_TRANSFER", "UPI", "CASH"]);
export type SalaryPaymentMethod = z.infer<typeof SalaryPaymentMethodEnum>;

export const RecordSalaryPaymentSchema = z.object({
  staff_id: z.string().uuid("Staff ID is required"),
  period_month: z.string().regex(/^\d{4}-\d{2}$/, "Period must be YYYY-MM format"),
  base_salary: z.number().nonnegative("Base salary must be non-negative"),
  advance_deducted: z.number().nonnegative("Advance deducted must be non-negative").default(0),
  other_deductions: z.number().nonnegative("Other deductions must be non-negative").default(0),
  amount_paid: z.number().positive("Amount paid must be greater than zero"),
  payment_method: SalaryPaymentMethodEnum,
  payment_date: z.string().default(() => new Date().toISOString().split("T")[0]),
  notes: z.string().max(255).optional().nullable(),
  idempotency_key: z.string().max(100).optional().nullable(),
});

export type RecordSalaryPaymentInput = z.infer<typeof RecordSalaryPaymentSchema>;

export const RecordSalaryAdvanceSchema = z.object({
  staff_id: z.string().uuid("Staff ID is required"),
  amount: z.number().positive("Advance amount must be greater than zero"),
  advance_date: z.string().default(() => new Date().toISOString().split("T")[0]),
  payment_method: SalaryPaymentMethodEnum.default("CASH"),
  reason: z.string().max(255).optional().nullable(),
  notes: z.string().max(255).optional().nullable(),
});

export type RecordSalaryAdvanceInput = z.infer<typeof RecordSalaryAdvanceSchema>;

export interface SalaryPaymentRecord {
  id: string;
  voucher_number: string;
  staff_id: string;
  staff_name: string;
  period_month: string;
  base_salary: number;
  advance_deducted: number;
  other_deductions: number;
  net_payable: number;
  amount_paid: number;
  net_paid: number;
  amount_remaining: number;
  payment_method: SalaryPaymentMethod;
  payment_date: string;
  notes?: string | null;
  created_at: string;
}

export interface StaffSalaryLedgerSummary {
  staff_id: string;
  staff_name: string;
  role: string;
  base_salary: number;
  salary_type: string;
  total_advances_outstanding: number;
  last_payment_date?: string | null;
  total_paid_this_fiscal: number;
}

export interface SalaryAdvanceRecord {
  id: string;
  staff_id: string;
  staff_name: string;
  amount: number;
  amount_deducted: number;
  remaining_balance: number;
  payment_method: SalaryPaymentMethod;
  advance_date: string;
  reason?: string | null;
  notes?: string | null;
  is_settled: boolean;
  is_deducted: boolean;
  deducted_in_payment_id?: string | null;
  created_at: string;
}

export const SalaryAdvanceFilterSchema = z.object({
  staffId: z.string().optional(),
  status: z.enum(["ALL", "OUTSTANDING", "SETTLED"]).optional().default("ALL"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type SalaryAdvanceFilterParams = z.input<typeof SalaryAdvanceFilterSchema>;
