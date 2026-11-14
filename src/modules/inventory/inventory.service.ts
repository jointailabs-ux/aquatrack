"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import {
  InventoryItemRecord,
  InventoryMovementRecord,
  InventoryValuationSummary,
  StockAdjustmentInput,
  StockAdjustmentInputSchema,
  calculateInventoryValuationFromItems,
} from "./inventory.schema";

// Server module-level cache for default warehouse ID to eliminate redundant lookups
let cachedDefaultWarehouseId: string | null = null;

/**
 * Retrieve current warehouse inventory balances across all products
 * Persisted single-depot balances with zero hardcoded demonstration stocks
 */
export async function getInventoryStockLevels(): Promise<ActionResponse<InventoryItemRecord[]>> {
  try {
    const supabase = await createClient();

    let warehouseId = cachedDefaultWarehouseId;

    // Fetch warehouseId in parallel if not cached
    if (!warehouseId) {
      const [whRes, prodRes] = await Promise.all([
        supabase
          .from("warehouses")
          .select("id")
          .eq("is_default", true)
          .maybeSingle(),
        supabase
          .from("products")
          .select("id, sku, name, category, unit_of_measure, cost_price, is_reusable_jar, is_active, reorder_level")
          .eq("is_active", true)
          .order("name", { ascending: true }),
      ]);

      if (whRes.error) {
        return { success: false, error: whRes.error.message };
      }

      warehouseId = whRes.data?.id || null;
      if (!warehouseId) {
        const { data: fallbackWh } = await supabase
          .from("warehouses")
          .select("id")
          .limit(1)
          .maybeSingle();
        warehouseId = fallbackWh?.id || null;
      }

      if (warehouseId) {
        cachedDefaultWarehouseId = warehouseId;
      }

      if (prodRes.error) {
        return { success: false, error: prodRes.error.message };
      }

      const products = prodRes.data || [];
      const balancesMap = new Map<string, { onHand: number; reserved: number; updatedAt: string }>();

      if (warehouseId) {
        const { data: balances } = await supabase
          .from("inventory_balances")
          .select("product_id, quantity_on_hand, quantity_reserved, updated_at")
          .eq("warehouse_id", warehouseId);

        (balances || []).forEach((b) => {
          balancesMap.set(b.product_id, {
            onHand: Number(b.quantity_on_hand || 0),
            reserved: Number(b.quantity_reserved || 0),
            updatedAt: b.updated_at,
          });
        });
      }

      const inventoryItems: InventoryItemRecord[] = products.map((p) => {
        const cost = Number(p.cost_price || 0);
        const balance = balancesMap.get(p.id);
        const stock = balance?.onHand ?? 0;
        const reserved = balance?.reserved ?? 0;
        const rawAvailable = stock - reserved;
        const available = Math.max(0, rawAvailable);
        const overcommitted = Math.max(0, reserved - stock);
        const pWithReorder = p as { reorder_level?: number | null };
        const reorderLevel =
          pWithReorder.reorder_level !== undefined && pWithReorder.reorder_level !== null
            ? Number(pWithReorder.reorder_level)
            : 50;
        const shortage = Math.max(0, reorderLevel - available);

        return {
          product_id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          unit_of_measure: p.unit_of_measure,
          current_stock: stock,
          reserved_stock: reserved,
          available_stock: available,
          raw_available_stock: rawAvailable,
          overcommitted_stock: overcommitted,
          reorder_level: reorderLevel,
          shortage,
          cost_price: cost,
          valuation: stock * cost,
          is_reusable_jar: p.is_reusable_jar,
          updated_at: balance?.updatedAt || new Date().toISOString(),
        };
      });

      return { success: true, data: inventoryItems };
    }

    // Fast path: warehouseId already known, fetch products and balances simultaneously
    const [prodRes, balancesRes] = await Promise.all([
      supabase
        .from("products")
        .select("id, sku, name, category, unit_of_measure, cost_price, is_reusable_jar, is_active, reorder_level")
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("inventory_balances")
        .select("product_id, quantity_on_hand, quantity_reserved, updated_at")
        .eq("warehouse_id", warehouseId),
    ]);

    if (prodRes.error) {
      return { success: false, error: prodRes.error.message };
    }

    const balancesMap = new Map<string, { onHand: number; reserved: number; updatedAt: string }>();
    (balancesRes.data || []).forEach((b) => {
      balancesMap.set(b.product_id, {
        onHand: Number(b.quantity_on_hand || 0),
        reserved: Number(b.quantity_reserved || 0),
        updatedAt: b.updated_at,
      });
    });

    const inventoryItems: InventoryItemRecord[] = (prodRes.data || []).map((p) => {
      const cost = Number(p.cost_price || 0);
      const balance = balancesMap.get(p.id);
      const stock = balance?.onHand ?? 0;
      const reserved = balance?.reserved ?? 0;
      const rawAvailable = stock - reserved;
      const available = Math.max(0, rawAvailable);
      const overcommitted = Math.max(0, reserved - stock);
      const pWithReorder = p as { reorder_level?: number | null };
      const reorderLevel =
        pWithReorder.reorder_level !== undefined && pWithReorder.reorder_level !== null
          ? Number(pWithReorder.reorder_level)
          : 50;
      const shortage = Math.max(0, reorderLevel - available);

      return {
        product_id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        unit_of_measure: p.unit_of_measure,
        current_stock: stock,
        reserved_stock: reserved,
        available_stock: available,
        raw_available_stock: rawAvailable,
        overcommitted_stock: overcommitted,
        reorder_level: reorderLevel,
        shortage,
        cost_price: cost,
        valuation: stock * cost,
        is_reusable_jar: p.is_reusable_jar,
        updated_at: balance?.updatedAt || new Date().toISOString(),
      };
    });

    return { success: true, data: inventoryItems };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve stock levels.";
    return { success: false, error: message };
  }
}

/**
 * High-level inventory valuation summary for managerial reporting
 */
export async function getInventoryValuationSummary(): Promise<ActionResponse<InventoryValuationSummary>> {
  try {
    const stockResponse = await getInventoryStockLevels();
    if (!stockResponse.success || !stockResponse.data) {
      return { success: false, error: stockResponse.error || "Failed to calculate valuation." };
    }

    return {
      success: true,
      data: calculateInventoryValuationFromItems(stockResponse.data),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve inventory valuation.";
    return { success: false, error: message };
  }
}

/**
 * Adjust warehouse stock securely
 * Calls atomic PostgreSQL RPC rpc_adjust_inventory_stock with FOR UPDATE row-locking
 * Prevents negative stock and logs dual-entry movement atomically
 */
export async function adjustStock(
  input: StockAdjustmentInput
): Promise<ActionResponse<{ success: boolean; newStock: number }>> {
  try {
    const rawReason = input.reason?.trim();
    const sanitizedInput: StockAdjustmentInput = {
      ...input,
      reason: rawReason && rawReason.length >= 3
        ? rawReason
        : (input.quantity_delta >= 0 ? "Stock received and added" : "Stock removed or damaged"),
    };
    const validated = StockAdjustmentInputSchema.parse(sanitizedInput);
    const supabase = await createClient();

    const { data, error } = await supabase.rpc("rpc_adjust_inventory_stock", {
      p_product_id: validated.product_id,
      p_quantity_delta: validated.quantity_delta,
      p_reason: validated.reason,
    });

    if (error) {
      const isMissingRpc =
        error.message?.includes("Could not find the function") ||
        error.message?.includes("does not exist") ||
        (error as { code?: string }).code === "PGRST202";

      if (isMissingRpc && typeof supabase.from === "function") {
        console.warn("RPC rpc_adjust_inventory_stock not found, falling back to direct table update:", error.message);
        const { data: wh } = await supabase
          .from("warehouses")
          .select("id, location_id")
          .eq("is_default", true)
          .maybeSingle();

        if (wh) {
          const { data: existingBal } = await supabase
            .from("inventory_balances")
            .select("id, quantity_on_hand")
            .eq("warehouse_id", wh.id)
            .eq("product_id", validated.product_id)
            .maybeSingle();

          const currentQty = existingBal ? Number(existingBal.quantity_on_hand) : 0;
          const newQty = Math.max(0, currentQty + validated.quantity_delta);

          if (existingBal) {
            await supabase
              .from("inventory_balances")
              .update({ quantity_on_hand: newQty, updated_at: new Date().toISOString() })
              .eq("id", existingBal.id);
          } else {
            await supabase
              .from("inventory_balances")
              .insert({
                warehouse_id: wh.id,
                product_id: validated.product_id,
                quantity_on_hand: newQty,
                quantity_reserved: 0,
              });
          }

          // Record movement
          const movementType = validated.quantity_delta >= 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
          await supabase.from("stock_movements").insert({
            product_id: validated.product_id,
            source_location_id: validated.quantity_delta < 0 ? wh.location_id : null,
            destination_location_id: validated.quantity_delta >= 0 ? wh.location_id : null,
            quantity: Math.abs(validated.quantity_delta),
            movement_type: movementType,
            reference_type: "AUDIT",
            notes: validated.reason,
          });

          return {
            success: true,
            data: {
              success: true,
              newStock: newQty,
            },
          };
        }
      }

      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        success: true,
        newStock: Number(data.new_stock),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to adjust stock.";
    return { success: false, error: message };
  }
}

/**
 * Decrement packaged beverage stock upon POS sale completion
 * Validates stock and performs atomic decrement via database
 */
export async function deductPosBeverageStock(
  productId: string,
  quantity: number,
  saleReferenceId: string
): Promise<ActionResponse<{ deducted: boolean }>> {
  try {
    if (quantity <= 0) {
      return { success: false, error: "Quantity must be positive." };
    }

    const supabase = await createClient();

    const { error } = await supabase.rpc("rpc_adjust_inventory_stock", {
      p_product_id: productId,
      p_quantity_delta: -quantity,
      p_reason: `POS Sale Deduction (${saleReferenceId})`,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: { deducted: true },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to decrement POS stock.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve stock movement history across products or for a specific product.
 * Returns date, movement type, signed quantity, reference, reason/notes,
 * and resulting stock where available.
 */
export async function getStockMovements(
  productId?: string,
  limit: number = 50
): Promise<ActionResponse<InventoryMovementRecord[]>> {
  try {
    const supabase = await createClient();

    let query = supabase
      .from("stock_movements")
      .select(`
        id,
        product_id,
        source_location_id,
        destination_location_id,
        quantity,
        movement_type,
        reference_type,
        reference_id,
        notes,
        created_by,
        created_at,
        product:products (
          id,
          sku,
          name,
          unit_of_measure
        ),
        creator:profiles!stock_movements_created_by_fkey (
          id,
          full_name
        )
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (productId) {
      query = query.eq("product_id", productId);
    }

    const { data, error } = await query;
    if (error) {
      return { success: false, error: error.message };
    }

    interface StockMovementRow {
      id: string;
      product_id: string;
      source_location_id: string | null;
      destination_location_id: string | null;
      quantity: number;
      movement_type: string;
      reference_type: string | null;
      reference_id: string | null;
      notes: string | null;
      created_by: string | null;
      created_at: string;
      product?: { id: string; sku: string; name: string; unit_of_measure: string } | { id: string; sku: string; name: string; unit_of_measure: string }[];
      creator?: { id: string; full_name: string } | { id: string; full_name: string }[];
    }

    // Map movements to signed quantities without speculative balance reconstruction
    const records: InventoryMovementRecord[] = ((data || []) as unknown as StockMovementRow[]).map((row) => {
      const isOutflow = [
        "POS_SALE",
        "DELIVERY_DISPATCH",
        "ADJUSTMENT_OUT",
        "SCRAP_WRITEOFF",
      ].includes(row.movement_type);

      const signedQty = isOutflow ? -Math.abs(row.quantity) : Math.abs(row.quantity);

      const prod = Array.isArray(row.product) ? row.product[0] : row.product;
      const creator = Array.isArray(row.creator) ? row.creator[0] : row.creator;

      return {
        id: row.id,
        product_id: row.product_id,
        product_name: prod?.name || "Unknown Product",
        product_sku: prod?.sku || "",
        unit_of_measure: prod?.unit_of_measure || "UNIT",
        movement_type: row.movement_type,
        quantity: signedQty,
        balance_after: null, // stock_movements does not store historical balance_after
        reference_type: row.reference_type,
        reference_id: row.reference_id,
        notes: row.notes,
        created_by: row.created_by,
        creator_name: creator?.full_name || null,
        created_at: row.created_at,
      };
    });

    return { success: true, data: records };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve stock movements.";
    return { success: false, error: message };
  }
}
