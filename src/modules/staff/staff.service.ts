"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import { requireOwner, getCurrentUser } from "@/lib/auth/server-auth";
import {
  StaffRecord,
  CreateStaffAccountInput,
  CreateStaffAccountSchema,
  UpdateStaffPermissionsInput,
  UpdateStaffPermissionsSchema,
} from "./staff.schema";

/**
 * Create a new staff account (Owner Only)
 * - Provisions Supabase auth user securely using service-role via createAdminClient()
 * - Inserts corresponding profile record with role='staff' and configured permissions
 */
export async function createStaffAccount(
  input: CreateStaffAccountInput
): Promise<ActionResponse<StaffRecord>> {
  try {
    // 1. Enforce Owner privilege server-side
    await requireOwner();

    const validated = CreateStaffAccountSchema.parse(input);
    const adminSupabase = createAdminClient();

    // 2. Provision Supabase Auth User
    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
      email: validated.email,
      password: validated.password,
      email_confirm: true,
      user_metadata: {
        full_name: validated.full_name,
        phone: validated.phone,
      },
    });

    if (authError || !authData.user) {
      return { success: false, error: authError?.message || "Failed to create staff authentication user." };
    }

    const newUserId = authData.user.id;

    // 3. Upsert profile with staff role and permissions
    const { data: profileData, error: profileError } = await adminSupabase
      .from("profiles")
      .upsert({
        id: newUserId,
        full_name: validated.full_name,
        phone: validated.phone,
        role: "staff", // Strictly hardcoded to prevent privilege escalation
        is_active: true,
        can_pos: validated.can_pos,
        can_warehouse: validated.can_warehouse,
        can_manage_customers: validated.can_manage_customers,
        can_manage_orders: validated.can_manage_orders,
        salary_amount: validated.salary_amount,
        salary_type: validated.salary_type,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (profileError || !profileData) {
      return { success: false, error: profileError?.message || "Failed to create staff profile record." };
    }

    return {
      success: true,
      data: {
        ...(profileData as StaffRecord),
        email: validated.email,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to provision staff account.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve all staff members (Owner only)
 */
export async function getStaffMembers(): Promise<ActionResponse<StaffRecord[]>> {
  try {
    await requireOwner();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data || []) as StaffRecord[] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve staff.";
    return { success: false, error: message };
  }
}

/**
 * Retrieve current authenticated user's profile and modular permissions
 */
export async function getCurrentUserProfile(): Promise<ActionResponse<StaffRecord | null>> {
  try {
    const context = await getCurrentUser();
    if (!context) {
      return { success: false, error: "Not authenticated" };
    }

    const { user, profile } = context;

    return {
      success: true,
      data: {
        id: profile.id,
        full_name: profile.fullName,
        phone: profile.phone,
        role: profile.role,
        avatar_url: profile.avatarUrl,
        is_active: profile.isActive,
        can_pos: Boolean(profile.canPos),
        can_warehouse: Boolean(profile.canWarehouse),
        can_manage_customers: Boolean(profile.canManageCustomers),
        can_manage_orders: Boolean(profile.canManageOrders),
        salary_amount: profile.salaryAmount || 0,
        salary_type: profile.salaryType || "MONTHLY",
        created_at: profile.createdAt,
        updated_at: profile.createdAt,
        email: user.email,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve profile.";
    return { success: false, error: message };
  }
}

/**
 * Update modular permissions for a staff member (Owner only)
 */
export async function updateStaffPermissions(
  id: string,
  input: UpdateStaffPermissionsInput
): Promise<ActionResponse<StaffRecord>> {
  try {
    await requireOwner();
    const validated = UpdateStaffPermissionsSchema.parse(input);
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("profiles")
      .update({
        can_pos: validated.can_pos,
        can_warehouse: validated.can_warehouse,
        can_manage_customers: validated.can_manage_customers,
        can_manage_orders: validated.can_manage_orders,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as StaffRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update staff permissions.";
    return { success: false, error: message };
  }
}

/**
 * Update salary details for staff (Owner only)
 */
export async function updateStaffSalary(
  id: string,
  salaryAmount: number,
  salaryType: "MONTHLY" | "FIXED_PERIOD"
): Promise<ActionResponse<StaffRecord>> {
  try {
    await requireOwner();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .update({
        salary_amount: salaryAmount,
        salary_type: salaryType,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as StaffRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update staff salary.";
    return { success: false, error: message };
  }
}

/**
 * Activate or deactivate a staff profile (Owner only)
 */
export async function toggleStaffStatus(
  id: string,
  isActive: boolean
): Promise<ActionResponse<StaffRecord>> {
  try {
    await requireOwner();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("profiles")
      .update({ is_active: isActive })
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as StaffRecord };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update staff status.";
    return { success: false, error: message };
  }
}
