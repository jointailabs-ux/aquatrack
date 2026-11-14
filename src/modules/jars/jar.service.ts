"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import {
  ComprehensiveJarSystemSummary,
  CustomerJarHoldingSummary,
  JarMovementRecord,
  RecordJarMovementInput,
  RecordJarMovementSchema,
  RecordJarScrapInput,
  RecordJarScrapSchema,
  RecordJarAdjustmentInput,
  RecordJarAdjustmentSchema,
  JarCustodyLocation,
  JarCondition,
} from "./jar.schema";

/**
 * Fetch persistent enterprise jar custody dashboard summary across all physical locations.
 * Real database aggregation with zero hardcoded demonstration balances.
 */
export async function getJarSystemSummary(): Promise<ActionResponse<ComprehensiveJarSystemSummary>> {
  try {
    const supabase = await createClient();

    // 1. Fetch customer jar holdings sum
    const { data: customerTotals, error: custError } = await supabase
      .from("customers")
      .select("total_full_jars_holding, total_empty_jars_holding");

    if (custError) {
      return { success: false, error: custError.message };
    }

    let customerFullTotal = 0;
    let customerEmptyTotal = 0;
    (customerTotals || []).forEach((c) => {
      customerFullTotal += Number(c.total_full_jars_holding || 0);
      customerEmptyTotal += Number(c.total_empty_jars_holding || 0);
    });

    // 2. Fetch supplier jar custody sum
    const { data: supplierTotals, error: suppError } = await supabase
      .from("suppliers")
      .select("jars_in_custody");

    if (suppError) {
      return { success: false, error: suppError.message };
    }

    let supplierJarsTotal = 0;
    (supplierTotals || []).forEach((s) => {
      supplierJarsTotal += Number(s.jars_in_custody || 0);
    });

    // 3. Central Warehouse stock aggregation from inventory_balances and jar_custody_movements
    const { data: defaultWh } = await supabase
      .from("warehouses")
      .select("id, location_id")
      .eq("is_default", true)
      .maybeSingle();

    const whId = defaultWh?.id;
    const whLocId = defaultWh?.location_id;

    // Full usable stock in warehouse from inventory_balances for reusable jar
    let fullUsableStock = 0;
    if (whId) {
      const { data: invRow } = await supabase
        .from("inventory_balances")
        .select("quantity_on_hand, product:products!inner(is_reusable_jar)")
        .eq("warehouse_id", whId)
        .eq("product.is_reusable_jar", true)
        .maybeSingle();

      if (invRow) {
        fullUsableStock = Number(invRow.quantity_on_hand || 0);
      }
    }

    // Condition balances from jar_custody_movements
    let emptyClean = 0;
    let emptyDirty = 0;
    let damagedRepairable = 0;
    let damagedScrap = 0;

    if (whLocId) {
      const { data: movements } = await supabase
        .from("jar_custody_movements")
        .select("destination_location_id, source_location_id, condition_to, condition_from, quantity");

      (movements || []).forEach((m) => {
        const qty = Number(m.quantity || 0);
        if (m.destination_location_id === whLocId) {
          if (m.condition_to === "EMPTY_CLEAN") emptyClean += qty;
          else if (m.condition_to === "EMPTY_DIRTY") emptyDirty += qty;
          else if (m.condition_to === "DAMAGED_REPAIRABLE") damagedRepairable += qty;
          else if (m.condition_to === "DAMAGED_SCRAP") damagedScrap += qty;
        }
        if (m.source_location_id === whLocId) {
          if (m.condition_from === "EMPTY_CLEAN") emptyClean = Math.max(0, emptyClean - qty);
          else if (m.condition_from === "EMPTY_DIRTY") emptyDirty = Math.max(0, emptyDirty - qty);
          else if (m.condition_from === "DAMAGED_REPAIRABLE") damagedRepairable = Math.max(0, damagedRepairable - qty);
          else if (m.condition_from === "DAMAGED_SCRAP") damagedScrap = Math.max(0, damagedScrap - qty);
        }
      });
    }

    const warehouseJarBalance = {
      full_usable: fullUsableStock,
      empty_clean: emptyClean,
      empty_dirty: emptyDirty,
      damaged_repairable: damagedRepairable,
      damaged_scrap: damagedScrap,
      total_warehouse: fullUsableStock + emptyClean + emptyDirty + damagedRepairable + damagedScrap,
    };

    // 4. Staff / Vehicle jar balances from active delivery assignments
    const { data: staffList } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "staff")
      .eq("is_active", true);

    const staffJarBalances = await Promise.all(
      (staffList || []).map(async (st) => {
        // Find active stops assigned to this staff member
        const { data: stops } = await supabase
          .from("delivery_stops")
          .select("actual_delivered_quantity, empty_jars_collected, damaged_jars_collected, status")
          .eq("assigned_staff_id", st.id);

        const fullJars = 0;
        let emptyJars = 0;
        let damagedJars = 0;

        (stops || []).forEach((stop) => {
          if (stop.status === "COMPLETED") {
            emptyJars += Number(stop.empty_jars_collected || 0);
            damagedJars += Number(stop.damaged_jars_collected || 0);
          }
        });

        // Deduct empty jars already returned to warehouse by staff
        const { data: returnMovements } = await supabase
          .from("jar_custody_movements")
          .select("quantity")
          .eq("movement_type", "VEHICLE_RETURN_TO_WAREHOUSE")
          .eq("reference_id", st.id);

        const totalReturned = (returnMovements || []).reduce((s, m) => s + Number(m.quantity || 0), 0);
        emptyJars = Math.max(0, emptyJars - totalReturned);

        return {
          staff_id: st.id,
          staff_name: st.full_name,
          full_jars: fullJars,
          empty_jars: emptyJars,
          damaged_jars: damagedJars,
          total: fullJars + emptyJars + damagedJars,
        };
      })
    );

    const totalWithStaff = staffJarBalances.reduce((sum, s) => sum + s.total, 0);
    const totalWithCustomers = customerFullTotal + customerEmptyTotal;
    const totalInCirculation = warehouseJarBalance.total_warehouse + totalWithStaff + totalWithCustomers;

    const summary: ComprehensiveJarSystemSummary = {
      warehouse: warehouseJarBalance,
      staff: staffJarBalances,
      total_with_customers: {
        full_jars: customerFullTotal,
        empty_jars: customerEmptyTotal,
        total: totalWithCustomers,
      },
      total_with_suppliers: supplierJarsTotal,
      total_scrapped: warehouseJarBalance.damaged_scrap,
      total_in_circulation: totalInCirculation,
      grand_total_system_jars: totalInCirculation + supplierJarsTotal,
    };

    return { success: true, data: summary };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve jar summary.";
    return { success: false, error: message };
  }
}

/**
 * Fetch customer-level jar holding balances and pending collection obligations
 */
export async function getCustomerJarHoldings(): Promise<ActionResponse<CustomerJarHoldingSummary[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .select("id, contact_name, business_name, phone, total_full_jars_holding, total_empty_jars_holding, max_jar_limit, total_deposit_held")
      .order("total_full_jars_holding", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    const holdings: CustomerJarHoldingSummary[] = (data || []).map((c) => {
      const full = Number(c.total_full_jars_holding || 0);
      const empty = Number(c.total_empty_jars_holding || 0);
      const total = full + empty;
      return {
        customer_id: c.id,
        customer_name: c.business_name ? `${c.business_name} (${c.contact_name})` : c.contact_name,
        phone: c.phone,
        total_full_jars_holding: full,
        total_empty_jars_holding: empty,
        total_holding: total,
        max_jar_limit: Number(c.max_jar_limit || 5),
        total_deposit_held: Number(c.total_deposit_held || 0),
        pending_empty_collections: empty,
      };
    });

    return { success: true, data: holdings };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve customer holdings.";
    return { success: false, error: message };
  }
}

/**
 * Log an immutable jar custody movement directly to public.jar_custody_movements
 */
export async function recordJarMovement(
  input: RecordJarMovementInput
): Promise<ActionResponse<JarMovementRecord>> {
  try {
    const validated = RecordJarMovementSchema.parse(input);
    const supabase = await createClient();

    // Verify current authenticated profile
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to record jar movements." };
    }

    // Call atomic RPC rpc_record_jar_movement
    const { data: rpcResult, error: rpcError } = await supabase.rpc("rpc_record_jar_movement", {
      p_source_location_id: validated.source_location_id,
      p_destination_location_id: validated.destination_location_id,
      p_condition_from: validated.condition_from,
      p_condition_to: validated.condition_to,
      p_quantity: validated.quantity,
      p_movement_type: validated.movement_type,
      p_reference_type: validated.reference_type || "MANUAL",
      p_reference_id: validated.reference_id || null,
      p_notes: validated.notes || null,
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    const record: JarMovementRecord = {
      id: rpcResult.movement_id,
      source_location_id: validated.source_location_id,
      destination_location_id: validated.destination_location_id,
      condition_from: validated.condition_from,
      condition_to: validated.condition_to,
      quantity: validated.quantity,
      movement_type: validated.movement_type,
      reference_type: validated.reference_type || "MANUAL",
      reference_id: validated.reference_id || null,
      notes: validated.notes || null,
      created_by: user.id,
      created_at: new Date().toISOString(),
    };

    return { success: true, data: record };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record jar movement.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve active physical locations suitable for jar custody
 */
export async function getJarLocations(): Promise<ActionResponse<JarCustodyLocation[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("locations")
      .select("id, name, type, address")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data || []) as JarCustodyLocation[] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve locations.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve the current authoritative count of jars in a given location and condition
 */
export async function getLocationJarCount(
  locationId: string,
  condition: JarCondition
): Promise<number> {
  const supabase = await createClient();

  const { data: loc } = await supabase
    .from("locations")
    .select("id, type")
    .eq("id", locationId)
    .single();

  if (!loc) return 0;

  if (loc.type === "WAREHOUSE") {
    if (condition === "FULL_USABLE") {
      const { data: wh } = await supabase
        .from("warehouses")
        .select("id")
        .eq("location_id", locationId)
        .maybeSingle();

      if (!wh) return 0;

      const { data: invRow } = await supabase
        .from("inventory_balances")
        .select("quantity_on_hand, product:products!inner(is_reusable_jar)")
        .eq("warehouse_id", wh.id)
        .eq("product.is_reusable_jar", true)
        .maybeSingle();

      return Number(invRow?.quantity_on_hand || 0);
    } else {
      const { data: incoming } = await supabase
        .from("jar_custody_movements")
        .select("quantity")
        .eq("destination_location_id", locationId)
        .eq("condition_to", condition);

      const { data: outgoing } = await supabase
        .from("jar_custody_movements")
        .select("quantity")
        .eq("source_location_id", locationId)
        .eq("condition_from", condition);

      const inSum = (incoming || []).reduce((sum, r) => sum + Number(r.quantity || 0), 0);
      const outSum = (outgoing || []).reduce((sum, r) => sum + Number(r.quantity || 0), 0);
      return Math.max(0, inSum - outSum);
    }
  }

  if (loc.type === "CUSTOMER") {
    const { data: cust } = await supabase
      .from("customers")
      .select(
        "total_full_jars_holding, total_empty_jars_holding, total_damaged_jars_holding, total_empty_clean_holding, total_scrap_jars_holding"
      )
      .eq("location_id", locationId)
      .maybeSingle();

    if (!cust) return 0;
    if (condition === "FULL_USABLE") return Number(cust.total_full_jars_holding || 0);
    if (condition === "EMPTY_DIRTY") return Number(cust.total_empty_jars_holding || 0);
    if (condition === "EMPTY_CLEAN") return Number(cust.total_empty_clean_holding || 0);
    if (condition === "DAMAGED_REPAIRABLE") return Number(cust.total_damaged_jars_holding || 0);
    if (condition === "DAMAGED_SCRAP") return Number(cust.total_scrap_jars_holding || 0);
    return 0;
  }

  if (loc.type === "SUPPLIER") {
    const { data: supp } = await supabase
      .from("suppliers")
      .select("jars_in_custody")
      .eq("location_id", locationId)
      .maybeSingle();

    return Number(supp?.jars_in_custody || 0);
  }

  // VEHICLE or SCRAP_YARD
  const { data: incoming } = await supabase
    .from("jar_custody_movements")
    .select("quantity")
    .eq("destination_location_id", locationId)
    .eq("condition_to", condition);

  const { data: outgoing } = await supabase
    .from("jar_custody_movements")
    .select("quantity")
    .eq("source_location_id", locationId)
    .eq("condition_from", condition);

  const inSum = (incoming || []).reduce((sum, r) => sum + Number(r.quantity || 0), 0);
  const outSum = (outgoing || []).reduce((sum, r) => sum + Number(r.quantity || 0), 0);
  return Math.max(0, inSum - outSum);
}

/**
 * Record disposal / scrapping of unrepairable jars.
 * Enforces owner authorization and verifies quantity against available damaged stock.
 */
export async function recordJarScrap(
  input: RecordJarScrapInput
): Promise<ActionResponse<{ success: boolean; movementId: string }>> {
  try {
    const validated = RecordJarScrapSchema.parse(input);
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to scrap jars." };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "owner") {
      return {
        success: false,
        error: "Only the business owner can authorize jar scrap and disposal.",
      };
    }

    // Verify available damaged stock at source location
    const available = await getLocationJarCount(
      validated.source_location_id,
      validated.condition_from
    );
    if (validated.quantity > available) {
      return {
        success: false,
        error: `Cannot scrap ${validated.quantity} jars: only ${available} ${validated.condition_from} jars available at this custody location.`,
      };
    }

    // Determine destination location:
    // If destination_location_id is provided, use it.
    // Otherwise, check for a SCRAP_YARD location, or use source location (in-place condition transition)
    let destLocId = validated.destination_location_id;
    if (!destLocId) {
      const { data: scrapYardLoc } = await supabase
        .from("locations")
        .select("id")
        .eq("type", "SCRAP_YARD")
        .eq("is_active", true)
        .maybeSingle();

      destLocId = scrapYardLoc?.id || validated.source_location_id;
    }

    // Call rpc_record_jar_movement
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "rpc_record_jar_movement",
      {
        p_source_location_id: validated.source_location_id,
        p_destination_location_id: destLocId,
        p_condition_from: validated.condition_from,
        p_condition_to: "DAMAGED_SCRAP",
        p_quantity: validated.quantity,
        p_movement_type: "SCRAP_WRITEOFF",
        p_reference_type: "AUDIT",
        p_notes: `[Scrap Disposal - ${validated.disposal_date}] ${validated.reason}`,
      }
    );

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    return {
      success: true,
      data: { success: true, movementId: rpcResult.movement_id },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record jar scrap.";
    return { success: false, error: message };
  }
}

/**
 * Physical stock adjustment to reconcile actual physical counts with system counts.
 * Enforces owner-only authorization and records immutable audit movements in jar_custody_movements.
 * Never silently overwrites balances.
 */
export async function recordPhysicalStockAdjustment(
  input: RecordJarAdjustmentInput
): Promise<
  ActionResponse<{
    success: boolean;
    difference: number;
    previousQuantity: number;
    newQuantity: number;
  }>
> {
  try {
    const validated = RecordJarAdjustmentSchema.parse(input);
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to perform stock adjustments." };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "owner") {
      return {
        success: false,
        error: "Only the business owner can perform physical stock adjustments.",
      };
    }

    // Authoritative system count
    const systemQty = await getLocationJarCount(validated.location_id, validated.condition);
    const delta = validated.actual_quantity - systemQty;

    if (delta === 0) {
      return {
        success: true,
        data: {
          success: true,
          difference: 0,
          previousQuantity: systemQty,
          newQuantity: validated.actual_quantity,
        },
      };
    }

    const { data: loc } = await supabase
      .from("locations")
      .select("id, name, type")
      .eq("id", validated.location_id)
      .single();

    if (!loc) {
      return { success: false, error: "Target location not found." };
    }

    // Resolve reusable jar product
    const { data: jarProduct } = await supabase
      .from("products")
      .select("id")
      .eq("is_reusable_jar", true)
      .maybeSingle();

    if (!jarProduct) {
      return { success: false, error: "Reusable jar product not configured." };
    }

    const absDelta = Math.abs(delta);
    const auditNote = `[Physical Audit - ${validated.adjustment_date}] System: ${systemQty}, Actual: ${validated.actual_quantity}, Diff: ${delta > 0 ? "+" : ""}${delta}. Reason: ${validated.reason}`;

    if (loc.type === "WAREHOUSE") {
      const { data: wh } = await supabase
        .from("warehouses")
        .select("id")
        .eq("location_id", validated.location_id)
        .maybeSingle();

      if (validated.condition === "FULL_USABLE" && wh) {
        // Update inventory_balances
        await supabase
          .from("inventory_balances")
          .upsert({
            warehouse_id: wh.id,
            product_id: jarProduct.id,
            quantity_on_hand: validated.actual_quantity,
            updated_at: new Date().toISOString(),
          });

        // Insert into stock_movements
        await supabase.from("stock_movements").insert({
          product_id: jarProduct.id,
          source_location_id: delta < 0 ? validated.location_id : null,
          destination_location_id: delta > 0 ? validated.location_id : null,
          quantity: absDelta,
          movement_type: "INVENTORY_ADJUSTMENT",
          reference_type: "AUDIT",
          notes: auditNote,
          created_by: user.id,
        });

        // Insert into jar_custody_movements
        await supabase.from("jar_custody_movements").insert({
          product_id: jarProduct.id,
          source_location_id: validated.location_id,
          destination_location_id: validated.location_id,
          condition_from: "FULL_USABLE",
          condition_to: "FULL_USABLE",
          quantity: absDelta,
          movement_type: "INTERNAL_ADJUSTMENT",
          reference_type: "AUDIT",
          notes: auditNote,
          created_by: user.id,
        });
      } else {
        // Non-full warehouse condition
        // To adjust warehouse condition balance:
        // If delta > 0 (Surplus found): destination is warehouse
        // If delta < 0 (Shortage found): source is warehouse
        const { data: auditLoc } = await supabase
          .from("locations")
          .select("id")
          .eq("type", "SCRAP_YARD")
          .maybeSingle();

        const peerLocId = auditLoc?.id || validated.location_id;

        await supabase.from("jar_custody_movements").insert({
          product_id: jarProduct.id,
          source_location_id: delta < 0 ? validated.location_id : peerLocId,
          destination_location_id: delta > 0 ? validated.location_id : peerLocId,
          condition_from: validated.condition,
          condition_to: validated.condition,
          quantity: absDelta,
          movement_type: "INTERNAL_ADJUSTMENT",
          reference_type: "AUDIT",
          notes: auditNote,
          created_by: user.id,
        });
      }
    } else if (loc.type === "CUSTOMER") {
      // Update customer holding
      const columnToUpdate =
        validated.condition === "FULL_USABLE"
          ? "total_full_jars_holding"
          : validated.condition === "EMPTY_DIRTY"
          ? "total_empty_jars_holding"
          : validated.condition === "EMPTY_CLEAN"
          ? "total_empty_clean_holding"
          : validated.condition === "DAMAGED_REPAIRABLE"
          ? "total_damaged_jars_holding"
          : "total_scrap_jars_holding";

      await supabase
        .from("customers")
        .update({
          [columnToUpdate]: validated.actual_quantity,
          updated_at: new Date().toISOString(),
        })
        .eq("location_id", validated.location_id);

      await supabase.from("jar_custody_movements").insert({
        product_id: jarProduct.id,
        source_location_id: validated.location_id,
        destination_location_id: validated.location_id,
        condition_from: validated.condition,
        condition_to: validated.condition,
        quantity: absDelta,
        movement_type: "INTERNAL_ADJUSTMENT",
        reference_type: "AUDIT",
        notes: auditNote,
        created_by: user.id,
      });
    }

    return {
      success: true,
      data: {
        success: true,
        difference: delta,
        previousQuantity: systemQty,
        newQuantity: validated.actual_quantity,
      },
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to record physical stock adjustment.";
    return { success: false, error: message };
  }
}

/**
 * Fetch permanent jar custody movement history
 */
export async function getJarCustodyMovements(
  limit = 50
): Promise<ActionResponse<JarMovementRecord[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("jar_custody_movements")
      .select(`
        id,
        source_location_id,
        destination_location_id,
        condition_from,
        condition_to,
        quantity,
        movement_type,
        reference_type,
        reference_id,
        notes,
        created_by,
        created_at,
        source_location:locations!jar_custody_movements_source_location_id_fkey(name, type),
        destination_location:locations!jar_custody_movements_destination_location_id_fkey(name, type)
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return { success: false, error: error.message };
    }

    interface MovementQueryRow {
      id: string;
      source_location_id: string;
      destination_location_id: string;
      condition_from: JarMovementRecord["condition_from"];
      condition_to: JarMovementRecord["condition_to"];
      quantity: number;
      movement_type: JarMovementRecord["movement_type"];
      reference_type?: string | null;
      reference_id?: string | null;
      notes?: string | null;
      created_by?: string | null;
      created_at: string;
      source_location?: { name: string; type: string } | null;
      destination_location?: { name: string; type: string } | null;
    }

    const records: JarMovementRecord[] = ((data || []) as unknown as MovementQueryRow[]).map(
      (row) => ({
        id: row.id,
        source_location_id: row.source_location_id,
        destination_location_id: row.destination_location_id,
        source_location_name: row.source_location?.name || "Unknown Location",
        destination_location_name: row.destination_location?.name || "Unknown Location",
        condition_from: row.condition_from,
        condition_to: row.condition_to,
        quantity: Number(row.quantity || 0),
        movement_type: row.movement_type,
        reference_type: row.reference_type,
        reference_id: row.reference_id,
        notes: row.notes,
        created_by: row.created_by,
        created_at: row.created_at,
      })
    );

    return { success: true, data: records };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve jar movements.";
    return { success: false, error: message };
  }
}

/**
 * Return staff's collected empty jars from vehicle back into godown/warehouse stock
 */
export async function returnStaffJarsToStock(input: {
  staff_id: string;
  quantity: number;
  notes?: string;
}): Promise<ActionResponse<{ success: boolean; returned_quantity: number; message: string }>> {
  try {
    if (!input.staff_id) {
      return { success: false, error: "Staff ID is required." };
    }
    if (!input.quantity || input.quantity <= 0) {
      return { success: false, error: "Quantity must be at least 1." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rpc_return_staff_jars_to_stock", {
      p_staff_id: input.staff_id,
      p_quantity: input.quantity,
      p_notes: input.notes || "Staff returned empty jars to godown",
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        success: true,
        returned_quantity: input.quantity,
        message: data?.message || `Successfully returned ${input.quantity} jars to godown stock.`,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to return jars to stock.";
    return { success: false, error: message };
  }
}

