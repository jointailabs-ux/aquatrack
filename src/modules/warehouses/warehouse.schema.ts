import { z } from "zod";

export const WarehouseInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, "Warehouse name must be at least 2 characters").max(150),
  address: z.string().max(500).optional().nullable(),
  is_default: z.boolean().default(true),
});

export type WarehouseInput = z.infer<typeof WarehouseInputSchema>;

export interface WarehouseRecord {
  id: string;
  location_id: string;
  name: string;
  address?: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}
