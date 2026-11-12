"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import { WarehouseInput, WarehouseInputSchema, WarehouseRecord } from "./warehouse.schema";

export async function getWarehouses(): Promise<ActionResponse<WarehouseRecord[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("warehouses")
      .select("*")
      .order("is_default", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data || []) as WarehouseRecord[] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve warehouses.";
    return { success: false, error: message };
  }
}

export async function getDefaultWarehouse(): Promise<ActionResponse<WarehouseRecord | null>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("warehouses")
      .select("*")
      .eq("is_default", true)
      .maybeSingle();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as WarehouseRecord | null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve default warehouse.";
    return { success: false, error: message };
  }
}

export async function createWarehouse(
  input: WarehouseInput
): Promise<ActionResponse<WarehouseRecord>> {
  try {
    const validated = WarehouseInputSchema.parse(input);
    const supabase = await createClient();

    // Enforce 2-step atomic creation via secured RPC
    const { data: warehouseId, error: rpcError } = await supabase.rpc(
      "rpc_create_warehouse_with_location",
      {
        p_name: validated.name,
        p_address: validated.address || null,
        p_is_default: validated.is_default,
      }
    );

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    const { data, error } = await supabase
      .from("warehouses")
      .select("*")
      .eq("id", warehouseId)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as WarehouseRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create warehouse.";
    return { success: false, error: message };
  }
}
