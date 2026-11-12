import { z } from "zod";

export const SpecialPriceInputSchema = z.object({
  id: z.string().uuid().optional(),
  customer_id: z.string().uuid("Customer ID is required"),
  product_id: z.string().uuid("Product ID is required"),
  special_price: z.number().nonnegative("Special price must be non-negative"),
  effective_from: z.string().default(() => new Date().toISOString().split("T")[0]),
  effective_to: z.string().optional().nullable(),
}).refine(
  (data) => {
    if (data.effective_to && data.effective_to < data.effective_from) {
      return false;
    }
    return true;
  },
  {
    message: "Effective to date cannot precede effective from date",
    path: ["effective_to"],
  }
);

export type SpecialPriceInput = z.infer<typeof SpecialPriceInputSchema>;

export const SpecialPriceUpdateSchema = z.object({
  special_price: z.number().nonnegative("Special price must be non-negative").optional(),
  effective_from: z.string().optional(),
  effective_to: z.string().optional().nullable(),
}).refine(
  (data) => {
    if (data.effective_from && data.effective_to && data.effective_to < data.effective_from) {
      return false;
    }
    return true;
  },
  {
    message: "Effective to date cannot precede effective from date",
    path: ["effective_to"],
  }
);

export type SpecialPriceUpdateInput = z.infer<typeof SpecialPriceUpdateSchema>;

export interface SpecialPriceRecord {
  id: string;
  customer_id: string;
  product_id: string;
  special_price: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpecialPriceWithDetails extends SpecialPriceRecord {
  customer?: {
    id: string;
    contact_name: string;
    business_name: string | null;
    customer_type: string;
    phone: string;
  } | null;
  product?: {
    id: string;
    name: string;
    sku: string;
    category?: string;
    default_sale_price: number;
    gst_rate: number;
  } | null;
  status: "ACTIVE" | "EXPIRED" | "UPCOMING";
  discount_amount?: number;
  discount_percent?: number;
}

export interface PricingKPIs {
  totalActive: number;
  totalCustomers: number;
  totalProducts: number;
  totalExpired: number;
  totalUpcomingExpirations: number;
}
