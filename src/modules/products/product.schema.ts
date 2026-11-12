import { z } from "zod";

export const ProductCategoryEnum = z.enum([
  "REFILLABLE_WATER",
  "EMPTY_JAR_ASSET",
  "PACKAGED_WATER",
  "DISPENSER_EQUIPMENT",
  "CONSUMABLE",
  "SERVICE",
  "BEVERAGE",
]);

export const ProductInputSchema = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().min(2, "SKU must be at least 2 characters").max(50),
  name: z.string().min(2, "Product name must be at least 2 characters").max(150),
  category: ProductCategoryEnum,
  unit_of_measure: z.string().max(20).default("UNIT"),
  default_sale_price: z.number().nonnegative("Sale price must be non-negative"),
  deposit_amount: z.number().nonnegative("Deposit amount must be non-negative").default(0),
  cost_price: z.number().nonnegative("Cost price must be non-negative").default(0),
  hsn_code: z.string().min(2, "HSN code required").max(20),
  gst_rate: z.number().nonnegative("GST rate must be non-negative"),
  cgst_rate: z.number().nonnegative("CGST rate must be non-negative"),
  sgst_rate: z.number().nonnegative("SGST rate must be non-negative"),
  igst_rate: z.number().nonnegative("IGST rate must be non-negative"),
  cess_rate: z.number().nonnegative("CESS rate must be non-negative").default(0),
  is_reusable_jar: z.boolean().default(false),
  is_active: z.boolean().default(true),
}).refine(
  (data) => Math.abs(data.gst_rate - (data.cgst_rate + data.sgst_rate)) < 0.01,
  {
    message: "Total GST rate must equal the sum of CGST and SGST rates",
    path: ["gst_rate"],
  }
);

export type ProductInput = z.infer<typeof ProductInputSchema>;

// Full product record (Owner & Authorized Staff — Includes cost_price)
export interface ProductRecord {
  id: string;
  sku: string;
  name: string;
  category: z.infer<typeof ProductCategoryEnum>;
  unit_of_measure: string;
  default_sale_price: number;
  deposit_amount: number;
  cost_price: number;
  hsn_code: string;
  gst_rate: number;
  cgst_rate: number;
  sgst_rate: number;
  igst_rate: number;
  cess_rate: number;
  is_reusable_jar: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Operational product catalog item for POS & Delivery Staff (Omits internal cost_price)
export interface PublicProductRecord {
  id: string;
  sku: string;
  name: string;
  category: z.infer<typeof ProductCategoryEnum>;
  unit_of_measure: string;
  default_sale_price: number;
  deposit_amount: number;
  hsn_code: string;
  gst_rate: number;
  cgst_rate: number;
  sgst_rate: number;
  igst_rate: number;
  cess_rate: number;
  is_reusable_jar: boolean;
  is_active: boolean;
}

// Backward-compatible alias
export type CustomerProductRecord = PublicProductRecord;
