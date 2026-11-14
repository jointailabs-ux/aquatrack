"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse, PaginatedResult } from "@/types/api.types";
import { formatErrorMessage } from "@/lib/utils";
import {
  ProductInput,
  ProductInputSchema,
  ProductRecord,
  PublicProductRecord,
} from "./product.schema";

/**
 * Retrieve internal product catalog (Owner & Authorized Staff)
 */
export async function getProducts(params?: {
  category?: string;
  isReusableJar?: boolean;
  isActive?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<ActionResponse<PaginatedResult<ProductRecord>>> {
  try {
    const supabase = await createClient();
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let query = supabase.from("products").select("*", { count: "exact" });

    if (params?.category) {
      query = query.eq("category", params.category);
    }
    if (params?.isReusableJar !== undefined) {
      query = query.eq("is_reusable_jar", params.isReusableJar);
    }
    if (params?.isActive !== undefined) {
      query = query.eq("is_active", params.isActive);
    }
    if (params?.search) {
      query = query.or(`name.ilike.%${params.search}%,sku.ilike.%${params.search}%`);
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
        items: (data || []) as ProductRecord[],
        total: count || 0,
        page,
        pageSize,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve products.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve operational product catalog for POS / Delivery Staff (Excludes internal cost_price)
 */
export async function getPublicProductCatalog(params?: {
  category?: string;
  isReusableJar?: boolean;
  search?: string;
}): Promise<ActionResponse<PublicProductRecord[]>> {
  try {
    const supabase = await createClient();
    let query = supabase.from("customer_product_catalog").select("*");

    if (params?.category) {
      query = query.eq("category", params.category);
    }
    if (params?.isReusableJar !== undefined) {
      query = query.eq("is_reusable_jar", params.isReusableJar);
    }
    if (params?.search) {
      query = query.or(`name.ilike.%${params.search}%,sku.ilike.%${params.search}%`);
    }

    const { data, error } = await query.order("name", { ascending: true });

    if (error) {
      // Graceful fallback to products table if customer_product_catalog view is missing
      let fallbackQuery = supabase
        .from("products")
        .select("id, sku, name, category, unit_of_measure, default_sale_price, deposit_amount, hsn_code, gst_rate, cgst_rate, sgst_rate, igst_rate, cess_rate, is_reusable_jar, is_active, created_at, updated_at")
        .eq("is_active", true);

      if (params?.category) {
        fallbackQuery = fallbackQuery.eq("category", params.category);
      }
      if (params?.isReusableJar !== undefined) {
        fallbackQuery = fallbackQuery.eq("is_reusable_jar", params.isReusableJar);
      }
      if (params?.search) {
        fallbackQuery = fallbackQuery.or(`name.ilike.%${params.search}%,sku.ilike.%${params.search}%`);
      }

      const fallbackRes = await fallbackQuery.order("name", { ascending: true });
      if (fallbackRes.error) {
        return { success: false, error: fallbackRes.error.message };
      }
      return { success: true, data: (fallbackRes.data || []) as PublicProductRecord[] };
    }

    return { success: true, data: (data || []) as PublicProductRecord[] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve catalog.";
    return { success: false, error: message };
  }
}

// Backward-compatible alias for getPublicProductCatalog
export async function getCustomerCatalog(params?: {
  category?: string;
  isReusableJar?: boolean;
  search?: string;
}): Promise<ActionResponse<PublicProductRecord[]>> {
  return getPublicProductCatalog(params);
}

export async function getProductById(id: string): Promise<ActionResponse<ProductRecord>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as ProductRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve product.";
    return { success: false, error: message };
  }
}

export async function createProduct(
  input: ProductInput
): Promise<ActionResponse<ProductRecord>> {
  try {
    const validated = ProductInputSchema.parse(input);
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("products")
      .insert({
        sku: validated.sku,
        name: validated.name,
        category: validated.category,
        unit_of_measure: validated.unit_of_measure,
        default_sale_price: validated.default_sale_price,
        deposit_amount: validated.deposit_amount,
        cost_price: validated.cost_price,
        hsn_code: validated.hsn_code,
        gst_rate: validated.gst_rate,
        cgst_rate: validated.cgst_rate,
        sgst_rate: validated.sgst_rate,
        igst_rate: validated.igst_rate,
        cess_rate: validated.cess_rate,
        is_reusable_jar: validated.is_reusable_jar,
        is_active: validated.is_active,
      })
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as ProductRecord };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to create product.");
    return { success: false, error: message };
  }
}

export async function updateProduct(
  id: string,
  input: Partial<ProductInput>
): Promise<ActionResponse<ProductRecord>> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("products")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as ProductRecord };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to update product.");
    return { success: false, error: message };
  }
}

/**
 * Soft-delete product by setting is_active = false
 * Preserves historical transactions, orders, and ledger references.
 */
export async function deactivateProduct(id: string): Promise<ActionResponse<ProductRecord>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as ProductRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to deactivate product.";
    return { success: false, error: message };
  }
}

/**
 * Reactivate product by setting is_active = true
 * Makes product available for sales and delivery dispatch.
 */
export async function activateProduct(id: string): Promise<ActionResponse<ProductRecord>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as ProductRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to activate product.";
    return { success: false, error: message };
  }
}
