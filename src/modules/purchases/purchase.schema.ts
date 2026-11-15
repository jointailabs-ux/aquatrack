import { z } from "zod";

export const PurchaseStatusEnum = z.enum(["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]);
export type PurchaseStatus = z.infer<typeof PurchaseStatusEnum>;

export const PurchasePaymentStatusEnum = z.enum(["UNPAID", "PARTIALLY_PAID", "PAID"]);
export type PurchasePaymentStatus = z.infer<typeof PurchasePaymentStatusEnum>;

export const SupplierPaymentMethodEnum = z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]);
export type SupplierPaymentMethod = z.infer<typeof SupplierPaymentMethodEnum>;

export const PurchaseItemSchema = z.object({
  id: z.string().uuid().optional(),
  product_id: z.string().uuid("Product ID is required"),
  product_name: z.string().optional(),
  quantity_ordered: z.number().int().positive("Ordered quantity must be positive"),
  quantity_received: z.number().int().nonnegative("Received quantity must be non-negative").default(0),
  unit_cost: z.number().nonnegative("Unit cost must be non-negative"),
  gst_rate: z.number().nonnegative("GST rate must be non-negative").default(0),
  tax_rate: z.number().nonnegative("Tax rate must be non-negative").default(0),
  tax_amount: z.number().nonnegative("Tax amount must be non-negative").default(0),
  total_cost: z.number().nonnegative("Total line cost must be non-negative"),
  total_amount: z.number().nonnegative("Total line amount must be non-negative").optional(),
});

export type PurchaseItem = z.infer<typeof PurchaseItemSchema>;

export const CreatePurchaseSchema = z.object({
  supplier_id: z.string().uuid("Supplier ID is required"),
  invoice_number: z.string().max(100).optional().nullable(),
  po_number: z.string().max(50).optional().nullable(),
  status: z.enum(["DRAFT", "ORDERED"]).default("ORDERED"),
  auto_receive: z.boolean().optional().default(true),
  purchase_date: z.string().default(() => new Date().toISOString().split("T")[0]),
  expected_delivery_date: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  items: z.array(PurchaseItemSchema).min(1, "At least one item is required in a purchase order"),
});

export type CreatePurchaseInput = z.input<typeof CreatePurchaseSchema>;

export const ReceivePurchaseItemsSchema = z.object({
  purchase_id: z.string().uuid("Purchase ID is required"),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity_received: z.number().int().positive("Received quantity must be positive"),
      })
    )
    .min(1, "Items array cannot be empty when specified")
    .optional(),
});

export type ReceivePurchaseItemsInput = z.infer<typeof ReceivePurchaseItemsSchema>;

export const SupplierPaymentSchema = z.object({
  supplier_id: z.string().uuid("Supplier ID is required"),
  purchase_id: z.string().uuid("Purchase invoice ID").optional().nullable(),
  amount: z.number().positive("Payment amount must be greater than zero"),
  payment_method: SupplierPaymentMethodEnum,
  payment_date: z.string().default(() => new Date().toISOString().split("T")[0]),
  reference_number: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export type SupplierPaymentInput = z.infer<typeof SupplierPaymentSchema>;

export interface PurchaseRecord {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name?: string;
  invoice_number?: string | null;
  status: PurchaseStatus;
  payment_status: PurchasePaymentStatus;
  subtotal: number;
  tax_total: number;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  purchase_date: string;
  received_at?: string | null;
  items: PurchaseItem[];
  notes?: string | null;
  created_at: string;
}

export interface SupplierPaymentRecord {
  id: string;
  payment_number: string;
  supplier_id: string;
  supplier_name?: string;
  purchase_id?: string | null;
  amount: number;
  payment_method: SupplierPaymentMethod;
  payment_date: string;
  reference_number?: string | null;
  notes?: string | null;
  created_at: string;
}
