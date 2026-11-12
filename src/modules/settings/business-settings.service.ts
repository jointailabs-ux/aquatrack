"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import {
  BusinessSettingsInput,
  BusinessSettingsRecord,
} from "./business-settings.schema";

export async function getBusinessSettings(): Promise<ActionResponse<BusinessSettingsRecord>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("business_settings")
      .select("*")
      .limit(1)
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as BusinessSettingsRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve business settings.";
    return { success: false, error: message };
  }
}

export async function updateBusinessSettings(
  id: string,
  input: Partial<BusinessSettingsInput>
): Promise<ActionResponse<BusinessSettingsRecord>> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("business_settings")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as BusinessSettingsRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update business settings.";
    return { success: false, error: message };
  }
}

/**
 * Uploads a business logo to Supabase Storage and persists the public URL
 * to the business_settings table.
 *
 * Enforces file size (<= 2MB), allowed image types (PNG, JPG, WebP, SVG),
 * and reports exact infrastructure blockers if storage buckets or the
 * business_settings.logo_url column are not provisioned.
 */
export async function uploadBusinessLogo(
  formData: FormData
): Promise<ActionResponse<{ logo_url: string }>> {
  try {
    const file = formData.get("logo") as File | null;
    if (!file) {
      return { success: false, error: "No image file provided for logo upload." };
    }

    // 1. Validate file size (max 2MB)
    const MAX_SIZE = 2 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return { success: false, error: "Business logo must be under 2MB in size." };
    }

    // 2. Validate MIME type
    const validMimes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];
    if (!validMimes.includes(file.type)) {
      return {
        success: false,
        error: "Unsupported file format. Please upload a PNG, JPG, WebP, or SVG image.",
      };
    }

    const supabase = await createClient();

    // 3. Authenticate caller
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        error: "Authentication required to upload business branding.",
      };
    }

    // 4. Inspect existing Supabase Storage buckets
    const candidateBuckets = ["branding", "business-assets", "public", "logos"];
    let targetBucket: string | null = null;

    try {
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      if (!listError && buckets && buckets.length > 0) {
        for (const candidate of candidateBuckets) {
          const match = buckets.find(
            (b) => b.name.toLowerCase() === candidate.toLowerCase()
          );
          if (match) {
            targetBucket = match.name;
            break;
          }
        }
        if (!targetBucket) {
          const anyPublic = buckets.find((b) => b.public);
          if (anyPublic) {
            targetBucket = anyPublic.name;
          }
        }
      }
    } catch {
      // Storage API inspection error
    }

    if (!targetBucket) {
      return {
        success: false,
        error:
          "Storage Infrastructure Blocker: No active Supabase Storage bucket found for business branding (checked: 'branding', 'business-assets', 'public', 'logos'). Please create an appropriate public storage bucket in Supabase.",
      };
    }

    // 5. Upload buffer to target storage bucket
    const fileExt = file.name.split(".").pop() || "png";
    const fileName = `business-logo-${Date.now()}.${fileExt}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from(targetBucket)
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      return {
        success: false,
        error: `Supabase Storage Upload Error: ${uploadError.message}`,
      };
    }

    const { data: publicUrlData } = supabase.storage
      .from(targetBucket)
      .getPublicUrl(fileName);

    const publicUrl = publicUrlData.publicUrl;

    // 6. Persist URL to business_settings
    const { data: settingsRow, error: fetchErr } = await supabase
      .from("business_settings")
      .select("id")
      .limit(1)
      .single();

    if (fetchErr || !settingsRow) {
      return {
        success: false,
        error: `Failed to locate business settings record: ${fetchErr?.message || "No record found"}.`,
      };
    }

    const { error: updateErr } = await supabase
      .from("business_settings")
      .update({ logo_url: publicUrl } as Record<string, unknown>)
      .eq("id", settingsRow.id);

    if (updateErr) {
      return {
        success: false,
        error: `Database Persistence Blocker: Failed to update 'logo_url' on 'business_settings' (${updateErr.message}). Ensure the 'logo_url' column exists in the 'business_settings' table.`,
      };
    }

    return {
      success: true,
      data: { logo_url: publicUrl },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to upload business logo.";
    return { success: false, error: message };
  }
}

/**
 * Removes the persistent business logo from business_settings.
 */
export async function removeBusinessLogo(): Promise<ActionResponse<{ success: boolean }>> {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        error: "Authentication required to manage business branding.",
      };
    }

    const { data: settingsRow, error: fetchErr } = await supabase
      .from("business_settings")
      .select("id, logo_url")
      .limit(1)
      .single();

    if (fetchErr || !settingsRow) {
      return {
        success: false,
        error: `Failed to locate business settings: ${fetchErr?.message || "No record found"}.`,
      };
    }

    const { error: updateErr } = await supabase
      .from("business_settings")
      .update({ logo_url: null } as Record<string, unknown>)
      .eq("id", settingsRow.id);

    if (updateErr) {
      return {
        success: false,
        error: `Database Persistence Blocker: Failed to clear 'logo_url' on 'business_settings' (${updateErr.message}).`,
      };
    }

    return {
      success: true,
      data: { success: true },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to remove business logo.";
    return { success: false, error: message };
  }
}

