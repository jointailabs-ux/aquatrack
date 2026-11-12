"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse, PaginatedResult } from "@/types/api.types";
import {
  SupplierInput,
  SupplierInputSchema,
  SupplierRecord,
  UpdateSupplierInput,
  UpdateSupplierInputSchema,
} from "./supplier.schema";

export async function getSuppliers(params?: {
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<ActionResponse<PaginatedResult<SupplierRecord>>> {
  try {
    const supabase = await createClient();
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let query = supabase.from("suppliers").select("*", { count: "exact" });

    if (params?.search) {
      query = query.or(
        `name.ilike.%${params.search}%,contact_person.ilike.%${params.search}%,phone.ilike.%${params.search}%`
      );
    }

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        items: (data || []) as SupplierRecord[],
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve suppliers.";
    return { success: false, error: message };
  }
}

export async function getSupplierById(id: string): Promise<ActionResponse<SupplierRecord>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as SupplierRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve supplier.";
    return { success: false, error: message };
  }
}

export async function createSupplier(
  input: SupplierInput
): Promise<ActionResponse<SupplierRecord>> {
  try {
    const validated = SupplierInputSchema.parse(input);
    const supabase = await createClient();

    // Atomic supplier creation with parent custody location via secured RPC
    const { data: supplierId, error: rpcError } = await supabase.rpc(
      "rpc_create_supplier_with_location",
      {
        p_name: validated.name,
        p_contact_person: validated.contact_person,
        p_phone: validated.phone,
        p_email: validated.email || null,
        p_address: validated.address || null,
        p_gstin: validated.gstin || null,
        p_payment_terms_days: validated.payment_terms_days,
      }
    );

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    return getSupplierById(supplierId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create supplier.";
    return { success: false, error: message };
  }
}

export async function updateSupplier(
  input: UpdateSupplierInput
): Promise<ActionResponse<SupplierRecord>> {
  try {
    const validated = UpdateSupplierInputSchema.parse(input);
    const supabase = await createClient();

    // 1. Fetch current supplier to get location_id
    const { data: existing, error: fetchErr } = await supabase
      .from("suppliers")
      .select("id, location_id")
      .eq("id", validated.id)
      .single();

    if (fetchErr || !existing) {
      return { success: false, error: fetchErr?.message || "Supplier not found." };
    }

    const cleanEmail = validated.email && validated.email.trim() ? validated.email.trim() : null;
    const cleanAddress = validated.address && validated.address.trim() ? validated.address.trim() : null;
    const cleanGstin = validated.gstin && validated.gstin.trim() ? validated.gstin.trim() : null;

    // 2. Update supplier record (preserves all child records: purchases, payments, ledger)
    const { error: updateErr } = await supabase
      .from("suppliers")
      .update({
        name: validated.name.trim(),
        contact_person: validated.contact_person.trim(),
        phone: validated.phone.trim(),
        email: cleanEmail,
        address: cleanAddress,
        gstin: cleanGstin,
        payment_terms_days: validated.payment_terms_days,
        is_active: validated.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", validated.id);

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    // 3. Update associated location record if it exists
    if (existing.location_id) {
      await supabase
        .from("locations")
        .update({
          name: `${validated.name.trim()} (Supplier Plant)`,
          address: cleanAddress,
          is_active: validated.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.location_id);
    }

    return getSupplierById(validated.id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update supplier.";
    return { success: false, error: message };
  }
}
