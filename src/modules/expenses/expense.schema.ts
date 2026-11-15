import { z } from "zod";

export const ExpenseCategoryEnum = z.enum([
  "FUEL",
  "VEHICLE_MAINTENANCE",
  "RENT",
  "ELECTRICITY",
  "PACKAGING",
  "CLEANING",
  "REPAIRS",
  "STAFF_SALARY",
  "OTHER",
]);

export type ExpenseCategory = z.infer<typeof ExpenseCategoryEnum>;

export const ExpensePaymentMethodEnum = z.enum(["CASH", "UPI", "BANK_TRANSFER", "CARD"]);
export type ExpensePaymentMethod = z.infer<typeof ExpensePaymentMethodEnum>;

export const RecordExpenseSchema = z.object({
  amount: z.number().positive("Expense amount must be greater than zero"),
  category: ExpenseCategoryEnum,
  expense_date: z.string().default(() => new Date().toISOString().split("T")[0]),
  payment_method: ExpensePaymentMethodEnum,
  description: z.string().min(3, "Description must be at least 3 characters").max(255),
  receipt_url: z.string().url().optional().nullable(),
  vehicle_number: z.string().max(20).optional().nullable(),
});

export type RecordExpenseInput = z.infer<typeof RecordExpenseSchema>;

export interface ExpenseRecord {
  id: string;
  amount: number;
  category: ExpenseCategory;
  expense_date: string;
  payment_method: ExpensePaymentMethod;
  description: string;
  receipt_url?: string | null;
  vehicle_number?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export interface ExpenseCategoryBreakdown {
  category: ExpenseCategory;
  category_label: string;
  total_amount: number;
  transaction_count: number;
  percentage_of_total: number;
}

export interface UnifiedExpenseItem {
  id: string;
  sourceType: "EXPENSE" | "PURCHASE" | "SALARY";
  category: string;
  categoryLabel: string;
  date: string;
  amount: number;
  paymentMethod: string;
  description: string;
  reference?: string | null;
  supplierName?: string | null;
  staffName?: string | null;
  vehicleNumber?: string | null;
  createdAt: string;
}

export interface UnifiedFinancialSpendingSummary {
  totalSpent: number;
  purchasesTotal: number;
  salariesTotal: number;
  operationsTotal: number;
  fuelTotal: number;
  repairsTotal: number;
  otherTotal: number;
  items: UnifiedExpenseItem[];
}
