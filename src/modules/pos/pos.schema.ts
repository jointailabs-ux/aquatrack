import { z } from "zod";

export const PosPaymentMethodEnum = z.enum(["CASH", "UPI", "CARD"]);
export type PosPaymentMethod = z.infer<typeof PosPaymentMethodEnum>;

export const PosCartItemSchema = z.object({
  product_id: z.string().uuid("Product ID is required"),
  product_sku: z.string().min(1),
  product_name: z.string().min(1),
  unit_price: z.number().nonnegative(),
  quantity: z.number().int().positive("Quantity must be positive"),
  discount_percent: z.number().min(0).max(100).default(0),
  discount_amount: z.number().nonnegative().default(0),
  gst_rate: z.number().nonnegative().default(0),
  tax_amount: z.number().nonnegative().default(0),
  total: z.number().nonnegative(),
  is_reusable_jar: z.boolean().default(false),
});

export type PosCartItem = z.infer<typeof PosCartItemSchema>;

export const CompletePosSaleSchema = z.object({
  customer_id: z.string().uuid().optional().nullable(),
  walk_in_name: z.string().max(100).default("Walk-in Customer"),
  items: z.array(PosCartItemSchema).min(1, "Cart cannot be empty"),
  subtotal: z.number().nonnegative(),
  discount_amount: z.number().nonnegative().default(0),
  tax_amount: z.number().nonnegative().default(0),
  total_amount: z.number().positive("Sale total must be positive"),
  payment_method: PosPaymentMethodEnum,
  tendered_amount: z.number().nonnegative(),
  change_returned: z.number().nonnegative().default(0),
  notes: z.string().max(255).optional().nullable(),
  idempotency_key: z.string().max(100).optional().nullable(),
});

export type CompletePosSaleInput = z.infer<typeof CompletePosSaleSchema>;

export interface PosSaleRecord {
  id: string;
  receipt_number: string;
  cashier_id?: string | null;
  cashier_name?: string | null;
  customer_name: string;
  items: PosCartItem[];
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_method: PosPaymentMethod;
  tendered_amount: number;
  change_returned: number;
  created_at: string;
}
