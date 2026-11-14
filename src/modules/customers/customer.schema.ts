import { z } from "zod";

export const CustomerTypeEnum = z.enum(["B2C", "B2B"]);

export const CustomerInputSchema = z.object({
  id: z.string().uuid().optional(),
  customer_type: CustomerTypeEnum,
  business_name: z.string().max(200).optional().nullable(),
  contact_name: z.string().min(2, "Contact name must be at least 2 characters").max(150),
  phone: z.string().min(6, "Valid phone number required (min 6 digits)").max(20),
  email: z.string().email("Valid email required").optional().nullable(),
  address: z.string().min(3, "Address is required").max(500),
  delivery_instructions: z.string().max(500).optional().nullable(),
  gstin: z.string().max(30).optional().nullable(),
  credit_limit: z.number().nonnegative("Credit limit must be positive").default(0),
  max_jar_limit: z.number().int().nonnegative("Max jar limit must be positive").default(5),
  payment_terms_days: z.number().int().nonnegative().default(0),
  notes: z.string().max(1000).optional().nullable(),
}).refine(
  (data) => {
    if (data.customer_type === "B2B" && !data.business_name) {
      return false;
    }
    return true;
  },
  {
    message: "Corporate business name is required for B2B accounts",
    path: ["business_name"],
  }
);

export type CustomerInput = z.infer<typeof CustomerInputSchema>;

export const CustomerUpdateInputSchema = z.object({
  customer_type: CustomerTypeEnum.optional(),
  business_name: z.string().max(200).optional().nullable(),
  contact_name: z.string().min(2, "Contact name must be at least 2 characters").max(150).optional(),
  phone: z.string().min(6, "Valid phone number required (min 6 digits)").max(20).optional(),
  email: z.string().email("Valid email required").optional().nullable(),
  address: z.string().min(3, "Address is required").max(500).optional(),
  delivery_instructions: z.string().max(500).optional().nullable(),
  gstin: z.string().max(30).optional().nullable(),
  credit_limit: z.number().nonnegative("Credit limit must be positive").optional(),
  max_jar_limit: z.number().int().nonnegative("Max jar limit must be positive").optional(),
  payment_terms_days: z.number().int().nonnegative().optional(),
  notes: z.string().max(1000).optional().nullable(),
  is_active: z.boolean().optional(),
});

export type CustomerUpdateInput = z.infer<typeof CustomerUpdateInputSchema>;

export const DirectCustomerPaymentSchema = z.object({
  customer_id: z.string().uuid("Customer is required"),
  invoice_id: z.string().uuid().optional().nullable(),
  order_id: z.string().uuid().optional().nullable(),
  amount: z.number().positive("Payment amount must be greater than zero"),
  payment_method: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]),
  payment_date: z.string().default(() => new Date().toISOString().split("T")[0]),
  reference_number: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export type DirectCustomerPaymentInput = z.input<typeof DirectCustomerPaymentSchema>;
export type DirectCustomerPaymentOutput = z.output<typeof DirectCustomerPaymentSchema>;

export interface CustomerRecord {
  id: string;
  location_id: string;
  customer_type: "B2C" | "B2B";
  business_name: string | null;
  contact_name: string;
  phone: string;
  email: string | null;
  address: string;
  delivery_instructions: string | null;
  gstin: string | null;
  credit_limit: number;
  max_jar_limit: number;
  payment_terms_days: number;
  current_balance: number;
  total_full_jars_holding: number;
  total_empty_jars_holding: number;
  total_damaged_jars_holding?: number;
  total_deposit_held: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerPaymentRecord {
  id: string;
  payment_number: string;
  customer_id: string;
  invoice_id: string | null;
  order_id: string | null;
  amount: number;
  payment_method: "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE";
  reference_number: string | null;
  collected_by_staff_id: string | null;
  payment_date: string;
  notes: string | null;
  created_at: string;
  invoice?: {
    id: string;
    invoice_number: string;
    total_amount: number;
    balance_due: number;
  } | null;
  order?: {
    id: string;
    order_number: string;
  } | null;
}

export interface CustomerInvoiceRecord {
  id: string;
  invoice_number: string;
  order_id: string | null;
  customer_id: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  balance_due: number;
  status: "UNPAID" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";
  invoice_date: string;
  due_date: string;
  created_at: string;
}

export interface CustomerJarMovementRecord {
  id: string;
  product_id: string;
  product_name?: string;
  source_location_id: string;
  destination_location_id: string;
  condition_from: string;
  condition_to: string;
  quantity: number;
  movement_type: string;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
}
