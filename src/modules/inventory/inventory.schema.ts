import { z } from "zod";

export const StockMovementTypeEnum = z.enum([
  "PURCHASE_RECEIPT",
  "POS_SALE",
  "DELIVERY_DISPATCH",
  "DELIVERY_RETURN",
  "ROUTE_RETURN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "SCRAP_WRITEOFF",
  "DAMAGE_WRITEOFF",
  "PHYSICAL_AUDIT_ADJUSTMENT",
  "OPENING_BALANCE",
  "RETURN_TO_SUPPLIER",
]);

export type StockMovementType = z.infer<typeof StockMovementTypeEnum>;

export const StockAdjustmentInputSchema = z.object({
  product_id: z.string().uuid("Product ID is required"),
  quantity_delta: z.number().int("Quantity delta must be an integer"),
  reason: z.string().min(3, "Adjustment reason is required").max(255),
  movement_type: StockMovementTypeEnum.optional().default("PHYSICAL_AUDIT_ADJUSTMENT"),
});

export type StockAdjustmentInput = z.input<typeof StockAdjustmentInputSchema>;

export interface InventoryItemRecord {
  product_id: string;
  sku: string;
  name: string;
  category: string;
  unit_of_measure: string;
  current_stock: number;
  reserved_stock: number;
  available_stock: number;
  raw_available_stock?: number;
  overcommitted_stock?: number;
  reorder_level: number;
  shortage?: number;
  cost_price: number;
  valuation: number;
  is_reusable_jar: boolean;
  updated_at: string;
}

export interface InventoryMovementRecord {
  id: string;
  product_id: string;
  product_name?: string;
  product_sku?: string;
  unit_of_measure?: string;
  movement_type: StockMovementType | string;
  quantity: number; // positive = increase, negative = decrease
  balance_after?: number | null;
  reference_type?: string | null;
  reference_id?: string | null;
  notes?: string | null;
  created_by?: string | null;
  creator_name?: string | null;
  created_at: string;
}

export interface InventoryValuationSummary {
  total_distinct_products: number;
  total_units_in_warehouse: number;
  total_inventory_valuation: number;
  low_stock_items_count: number;
}
