import { z } from "zod";

export const BusinessSettingsSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, "Business name must be at least 2 characters").max(255),
  trade_name: z.string().max(255).optional().nullable(),
  tax_id: z.string().max(50).optional().nullable(),
  phone: z.string().min(5, "Valid phone number required").max(20),
  email: z.string().email("Valid email required").optional().nullable(),
  address: z.string().min(5, "Physical address required"),
  currency: z.string().length(3).default("INR"),
  default_jar_deposit: z.number().nonnegative("Default deposit must be non-negative").default(150),
  logo_url: z.string().optional().nullable(),
});

export type BusinessSettingsInput = z.infer<typeof BusinessSettingsSchema>;

export interface BusinessSettingsRecord {
  id: string;
  name: string;
  trade_name: string | null;
  tax_id: string | null;
  phone: string;
  email: string | null;
  address: string;
  currency: string;
  default_jar_deposit: number;
  logo_url?: string | null;
  created_at: string;
  updated_at: string;
}
