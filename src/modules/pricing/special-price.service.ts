"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse, PaginatedResult } from "@/types/api.types";
import {
  SpecialPriceInput,
  SpecialPriceInputSchema,
  SpecialPriceRecord,
  SpecialPriceUpdateInput,
  SpecialPriceUpdateSchema,
  SpecialPriceWithDetails,
  PricingKPIs,
} from "./special-price.schema";

export async function getCustomerSpecialPrices(
  customerId: string
): Promise<ActionResponse<SpecialPriceRecord[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customer_special_prices")
      .select("*")
      .eq("customer_id", customerId)
      .order("effective_from", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data || []) as SpecialPriceRecord[] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve special prices.";
    return { success: false, error: message };
  }
}

/**
 * Resolves the unit price for a customer and product on a specific date.
 * If an active special price contract exists, returns special price.
 * Otherwise, falls back to the product's catalog default_sale_price.
 */
export async function resolveEffectivePrice(
  customerId: string,
  productId: string,
  targetDate?: string
): Promise<ActionResponse<{ price: number; isSpecial: boolean }>> {
  try {
    const supabase = await createClient();
    const queryDate = targetDate || new Date().toISOString().split("T")[0];

    // Check special price
    const { data: specialPrice } = await supabase
      .from("customer_special_prices")
      .select("special_price")
      .eq("customer_id", customerId)
      .eq("product_id", productId)
      .lte("effective_from", queryDate)
      .or(`effective_to.is.null,effective_to.gte.${queryDate}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (specialPrice) {
      return {
        success: true,
        data: { price: Number(specialPrice.special_price), isSpecial: true },
      };
    }

    // Fall back to default catalog price
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("default_sale_price")
      .eq("id", productId)
      .single();

    if (productError || !product) {
      return { success: false, error: "Product not found to resolve price." };
    }

    return {
      success: true,
      data: { price: Number(product.default_sale_price), isSpecial: false },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to resolve effective price.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve all special price agreements with customer and product relations,
 * real-time validity status, and calculated discount amounts.
 */
export async function getAllSpecialPrices(params?: {
  customerId?: string;
  productId?: string;
  status?: "ALL" | "ACTIVE" | "EXPIRED" | "UPCOMING" | "EXPIRING_SOON";
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<ActionResponse<PaginatedResult<SpecialPriceWithDetails>>> {
  try {
    const supabase = await createClient();
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 20;

    let query = supabase
      .from("customer_special_prices")
      .select(`
        id,
        customer_id,
        product_id,
        special_price,
        effective_from,
        effective_to,
        created_at,
        updated_at,
        customer:customers(id, contact_name, business_name, customer_type, phone),
        product:products(id, name, sku, category, default_sale_price, gst_rate)
      `);

    if (params?.customerId) {
      query = query.eq("customer_id", params.customerId);
    }
    if (params?.productId) {
      query = query.eq("product_id", params.productId);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    const today = new Date().toISOString().split("T")[0];
    const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

    // Compute status and discounts for each record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let items: SpecialPriceWithDetails[] = (data || []).map((row: any) => {
      const from = row.effective_from;
      const to = row.effective_to;

      let status: "ACTIVE" | "EXPIRED" | "UPCOMING" = "ACTIVE";
      if (to && to < today) {
        status = "EXPIRED";
      } else if (from > today) {
        status = "UPCOMING";
      } else {
        status = "ACTIVE";
      }

      const stdPrice = Number(row.product?.default_sale_price || 0);
      const specPrice = Number(row.special_price || 0);
      const discountAmount = Math.max(0, Math.round((stdPrice - specPrice) * 100) / 100);
      const discountPercent =
        stdPrice > 0 ? Math.round(((stdPrice - specPrice) / stdPrice) * 1000) / 10 : 0;

      return {
        id: row.id,
        customer_id: row.customer_id,
        product_id: row.product_id,
        special_price: specPrice,
        effective_from: from,
        effective_to: to,
        created_at: row.created_at,
        updated_at: row.updated_at,
        customer: row.customer,
        product: row.product,
        status,
        discount_amount: discountAmount,
        discount_percent: discountPercent,
      };
    });

    // Filter by status if specified
    if (params?.status && params.status !== "ALL") {
      if (params.status === "EXPIRING_SOON") {
        items = items.filter(
          (i) => i.status === "ACTIVE" && i.effective_to && i.effective_to <= in30Days
        );
      } else {
        items = items.filter((i) => i.status === params.status);
      }
    }

    // Filter by search query (customer name, business name, phone, product name, sku)
    if (params?.search) {
      const q = params.search.toLowerCase();
      items = items.filter(
        (i) =>
          i.customer?.contact_name?.toLowerCase().includes(q) ||
          i.customer?.business_name?.toLowerCase().includes(q) ||
          i.customer?.phone?.includes(q) ||
          i.product?.name?.toLowerCase().includes(q) ||
          i.product?.sku?.toLowerCase().includes(q)
      );
    }

    const total = items.length;
    const offset = (page - 1) * pageSize;
    const paginatedItems = items.slice(offset, offset + pageSize);

    return {
      success: true,
      data: {
        items: paginatedItems,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve special prices.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve high-level KPI metrics for the Pricing Dashboard
 */
export async function getPricingDashboardKPIs(): Promise<ActionResponse<PricingKPIs>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customer_special_prices")
      .select("id, customer_id, product_id, effective_from, effective_to");

    if (error) {
      return { success: false, error: error.message };
    }

    const today = new Date().toISOString().split("T")[0];
    const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

    const activeCustomerIds = new Set<string>();
    const activeProductIds = new Set<string>();

    let totalActive = 0;
    let totalExpired = 0;
    let totalUpcomingExpirations = 0;

    (data || []).forEach((row) => {
      const from = row.effective_from;
      const to = row.effective_to;

      if (to && to < today) {
        totalExpired++;
      } else if (from > today) {
        // Upcoming contract
      } else {
        // Active contract
        totalActive++;
        activeCustomerIds.add(row.customer_id);
        activeProductIds.add(row.product_id);

        if (to && to <= in30Days) {
          totalUpcomingExpirations++;
        }
      }
    });

    return {
      success: true,
      data: {
        totalActive,
        totalCustomers: activeCustomerIds.size,
        totalProducts: activeProductIds.size,
        totalExpired,
        totalUpcomingExpirations,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load pricing KPIs.";
    return { success: false, error: message };
  }
}

/**
 * Create a new special price contract for a customer and product.
 * Enforces validation, non-negative price, date ranges, and prevents
 * conflicting duplicate agreements per database unique constraint.
 */
export async function createSpecialPrice(
  input: SpecialPriceInput
): Promise<ActionResponse<SpecialPriceRecord>> {
  try {
    const validated = SpecialPriceInputSchema.parse(input);
    const supabase = await createClient();

    // Check if an agreement already exists for this customer and product
    const { data: existing } = await supabase
      .from("customer_special_prices")
      .select("id, effective_from, effective_to")
      .eq("customer_id", validated.customer_id)
      .eq("product_id", validated.product_id)
      .maybeSingle();

    if (existing) {
      return {
        success: false,
        error: "A special price agreement already exists for this customer and product. Please edit the existing agreement.",
      };
    }

    const { data, error } = await supabase
      .from("customer_special_prices")
      .insert({
        customer_id: validated.customer_id,
        product_id: validated.product_id,
        special_price: validated.special_price,
        effective_from: validated.effective_from,
        effective_to: validated.effective_to || null,
      })
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as SpecialPriceRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create special price.";
    return { success: false, error: message };
  }
}

/**
 * Update an existing special price agreement without altering past invoices or orders.
 */
export async function updateSpecialPrice(
  id: string,
  input: SpecialPriceUpdateInput
): Promise<ActionResponse<SpecialPriceRecord>> {
  try {
    const validated = SpecialPriceUpdateSchema.parse(input);
    const supabase = await createClient();

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (validated.special_price !== undefined) {
      updatePayload.special_price = validated.special_price;
    }
    if (validated.effective_from !== undefined) {
      updatePayload.effective_from = validated.effective_from;
    }
    if (validated.effective_to !== undefined) {
      updatePayload.effective_to = validated.effective_to;
    }

    const { data, error } = await supabase
      .from("customer_special_prices")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as SpecialPriceRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update special price.";
    return { success: false, error: message };
  }
}

/**
 * Deactivate a special price agreement by expiring it immediately (setting effective_to to yesterday).
 * This preserves historical order and invoice auditability.
 */
export async function deactivateSpecialPrice(
  id: string
): Promise<ActionResponse<SpecialPriceRecord>> {
  try {
    const supabase = await createClient();
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("customer_special_prices")
      .update({
        effective_to: yesterday,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as SpecialPriceRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to deactivate special price.";
    return { success: false, error: message };
  }
}

/**
 * Permanently delete a special price agreement.
 */
export async function deleteSpecialPrice(id: string): Promise<ActionResponse<boolean>> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("customer_special_prices")
      .delete()
      .eq("id", id);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete special price.";
    return { success: false, error: message };
  }
}
