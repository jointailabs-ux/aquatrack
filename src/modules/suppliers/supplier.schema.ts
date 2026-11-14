import { z } from "zod";

export const SupplierInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, "Supplier/Plant name must be at least 2 characters").max(200),
  contact_person: z.string().min(2, "Contact person must be at least 2 characters").max(150),
  phone: z.string().min(6, "Valid phone number required (min 6 digits)").max(20),
  email: z.string().email("Valid email required").optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  gstin: z.string().max(30).optional().nullable(),
  payment_terms_days: z.number().int().nonnegative().default(15),
});

export type SupplierInput = z.infer<typeof SupplierInputSchema>;

export const UpdateSupplierInputSchema = z.object({
  id: z.string().uuid("Invalid supplier ID"),
  name: z.string().min(2, "Supplier/Plant name must be at least 2 characters").max(200),
  contact_person: z.string().min(2, "Contact person must be at least 2 characters").max(150),
  phone: z.string().min(6, "Valid phone number required (min 6 digits)").max(20),
  email: z.string().email("Valid email required").optional().nullable().or(z.literal("")),
  address: z.string().max(500).optional().nullable(),
  gstin: z.string().max(30).optional().nullable(),
  payment_terms_days: z.number().int().nonnegative().default(15),
  is_active: z.boolean().default(true),
});

export type UpdateSupplierInput = z.infer<typeof UpdateSupplierInputSchema>;

export interface SupplierRecord {
  id: string;
  location_id: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string | null;
  address: string | null;
  gstin: string | null;
  payment_terms_days: number;
  current_payable: number;
  jars_in_custody: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
