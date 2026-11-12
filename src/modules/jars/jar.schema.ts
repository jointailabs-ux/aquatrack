import { z } from "zod";

export const JarConditionEnum = z.enum([
  "FULL_USABLE",
  "EMPTY_CLEAN",
  "EMPTY_DIRTY",
  "DAMAGED_REPAIRABLE",
  "DAMAGED_SCRAP",
]);

export type JarCondition = z.infer<typeof JarConditionEnum>;

export const CustodyTypeEnum = z.enum([
  "WAREHOUSE",
  "VEHICLE",
  "CUSTOMER",
  "SUPPLIER",
  "SCRAP_YARD",
]);

export type CustodyType = z.infer<typeof CustodyTypeEnum>;

export const MovementTypeEnum = z.enum([
  "PURCHASE_RECEIPT",
  "CUSTOMER_DELIVERY",
  "CUSTOMER_EMPTY_RETURN",
  "DAMAGED_COLLECTED",
  "WASHING_CYCLE_DIRTY_TO_CLEAN",
  "FILLING_CYCLE_CLEAN_TO_FULL",
  "RETURN_TO_SUPPLIER",
  "SCRAP_WRITEOFF",
  "INTERNAL_ADJUSTMENT",
  "DISPATCH_TO_VEHICLE",
  "VEHICLE_RETURN_TO_WAREHOUSE",
]);

export type MovementType = z.infer<typeof MovementTypeEnum>;

export const RecordJarMovementSchema = z.object({
  source_location_id: z.string().uuid("Source location is required"),
  destination_location_id: z.string().uuid("Destination location is required"),
  condition_from: JarConditionEnum,
  condition_to: JarConditionEnum,
  quantity: z.number().int().positive("Movement quantity must be a positive integer"),
  movement_type: MovementTypeEnum,
  reference_type: z.enum(["ORDER", "DELIVERY", "PURCHASE", "AUDIT", "MANUAL"]).optional(),
  reference_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export type RecordJarMovementInput = z.infer<typeof RecordJarMovementSchema>;

export const RecordJarScrapSchema = z.object({
  source_location_id: z.string().uuid("Source custody location is required"),
  destination_location_id: z.string().uuid().optional(),
  condition_from: z.enum(["DAMAGED_REPAIRABLE", "DAMAGED_SCRAP"]).default("DAMAGED_REPAIRABLE"),
  quantity: z.number().int().positive("Disposal quantity must be a positive integer"),
  disposal_date: z.string().default(() => new Date().toISOString().split("T")[0]),
  reason: z.string().min(3, "Reason for disposal is required (min 3 characters)").max(500),
});

export type RecordJarScrapInput = z.infer<typeof RecordJarScrapSchema>;

export const RecordJarAdjustmentSchema = z.object({
  location_id: z.string().uuid("Custody location is required"),
  condition: JarConditionEnum,
  actual_quantity: z.number().int().nonnegative("Actual physical quantity must be non-negative"),
  reason: z.string().min(3, "Reason for adjustment is required (min 3 characters)").max(500),
  adjustment_date: z.string().default(() => new Date().toISOString().split("T")[0]),
});

export type RecordJarAdjustmentInput = z.infer<typeof RecordJarAdjustmentSchema>;

export interface JarCustodyLocation {
  id: string;
  name: string;
  type: CustodyType;
  address?: string | null;
}

export interface JarMovementRecord {
  id: string;
  source_location_id: string;
  destination_location_id: string;
  source_location_name?: string;
  destination_location_name?: string;
  condition_from: JarCondition;
  condition_to: JarCondition;
  quantity: number;
  movement_type: MovementType;
  reference_type?: string | null;
  reference_id?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface WarehouseJarBalance {
  full_usable: number;
  empty_clean: number;
  empty_dirty: number;
  damaged_repairable: number;
  damaged_scrap: number;
  total_warehouse: number;
}

export interface StaffJarBalance {
  staff_id: string;
  staff_name: string;
  full_jars: number;
  empty_jars: number;
  damaged_jars: number;
  total: number;
}

export interface CustomerJarHoldingSummary {
  customer_id: string;
  customer_name: string;
  phone: string;
  total_full_jars_holding: number;
  total_empty_jars_holding: number;
  total_holding: number;
  max_jar_limit: number;
  total_deposit_held: number;
  pending_empty_collections: number;
}

export interface ComprehensiveJarSystemSummary {
  warehouse: WarehouseJarBalance;
  staff: StaffJarBalance[];
  total_with_customers: {
    full_jars: number;
    empty_jars: number;
    total: number;
  };
  total_with_suppliers: number;
  total_scrapped: number;
  total_in_circulation: number; // Warehouse + Staff + Customers
  grand_total_system_jars: number; // All active jar assets owned
}

/**
 * Pure business calculation helper for jar custody update.
 * Invariant: Delivering full jars and collecting empty jars are two independent variables.
 * Validates physical custody: returned jars cannot exceed total customer jar holdings.
 * Disallows arbitrary clamping with GREATEST/Math.max.
 */
export function calculateNewCustomerJarHolding(
  currentFull: number,
  currentEmpty: number,
  deliveredFull: number,
  collectedEmpty: number,
  collectedDamaged: number = 0
): { newFull: number; newEmpty: number; newTotal: number } {
  if (deliveredFull < 0 || collectedEmpty < 0 || collectedDamaged < 0) {
    throw new Error("Delivered and collected jar quantities cannot be negative");
  }

  const currentTotal = currentFull + currentEmpty;
  const totalReturning = collectedEmpty + collectedDamaged;

  if (totalReturning > currentTotal) {
    throw new Error(
      `Invalid physical return: Customer only holds ${currentTotal} jars in total custody (full: ${currentFull}, empty: ${currentEmpty}), cannot return ${totalReturning} jars.`
    );
  }

  let newFull = currentFull + deliveredFull;
  let newEmpty = currentEmpty;

  if (totalReturning <= currentEmpty) {
    newEmpty = currentEmpty - totalReturning;
  } else {
    const remainder = totalReturning - currentEmpty;
    newEmpty = 0;
    newFull = newFull - remainder;
  }

  if (newFull < 0 || newEmpty < 0) {
    throw new Error("Customer jar holdings cannot become negative");
  }

  return {
    newFull,
    newEmpty,
    newTotal: newFull + newEmpty,
  };
}
