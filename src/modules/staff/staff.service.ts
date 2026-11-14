"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import { requireOwner, getCurrentUser } from "@/lib/auth/server-auth";
import { formatErrorMessage } from "@/lib/utils";
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

    // Auto-generate clean internal email if not provided
    const cleanPhoneDigits = validated.phone.replace(/\D/g, "");
    const staffEmail = validated.email?.trim() || `staff_${cleanPhoneDigits || Date.now()}@aquatrack.internal`;
    const staffPassword = validated.password?.trim() || `Staff@${validated.login_pin}#Safe`;

    let newUserId: string;

    // 2. Provision Supabase Auth User
    const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
      email: staffEmail,
      password: staffPassword,
      email_confirm: true,
      user_metadata: {
        role: "staff",
        full_name: validated.full_name,
        phone: validated.phone,
        login_pin: validated.login_pin,
        can_pos: validated.can_pos,
        can_warehouse: validated.can_warehouse,
        can_manage_customers: validated.can_manage_customers,
        can_manage_orders: validated.can_manage_orders,
        can_deliveries: true,
        salary_amount: validated.salary_amount,
        salary_type: validated.salary_type,
      },
    });

    if (authError) {
      // If user with this email already exists, update their password and metadata
      const { data: usersList } = await adminSupabase.auth.admin.listUsers();
      const existingUser = usersList?.users?.find(
        (u) => u.email?.toLowerCase() === staffEmail.toLowerCase()
      );
      if (existingUser) {
        newUserId = existingUser.id;
        await adminSupabase.auth.admin.updateUserById(newUserId, {
          password: staffPassword,
          user_metadata: {
            role: "staff",
            full_name: validated.full_name,
            phone: validated.phone,
            login_pin: validated.login_pin,
          },
        });
      } else {
        return { success: false, error: authError.message || "Failed to create staff authentication user." };
      }
    } else if (authData.user) {
      newUserId = authData.user.id;
    } else {
      return { success: false, error: "Failed to create staff authentication user." };
    }

    // 3. Upsert profile with staff role, login_pin, and permissions
    const { data: profileData, error: profileError } = await adminSupabase
      .from("profiles")
      .upsert({
        id: newUserId,
        full_name: validated.full_name,
        phone: validated.phone,
        email: staffEmail,
        role: "staff", // Strictly hardcoded to prevent privilege escalation
        login_pin: validated.login_pin,
        is_active: true,
        can_pos: validated.can_pos,
        can_warehouse: validated.can_warehouse,
        can_manage_customers: validated.can_manage_customers,
        can_manage_orders: validated.can_manage_orders,
        can_deliveries: true,
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
        email: staffEmail,
        login_pin: validated.login_pin,
      },
    };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to provision staff account.");
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
    const message = formatErrorMessage(err, "Failed to retrieve staff.");
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
    const message = formatErrorMessage(err, "Failed to update staff permissions.");
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
    const message = formatErrorMessage(err, "Failed to update staff salary.");
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
    const message = formatErrorMessage(err, "Failed to update staff status.");
    return { success: false, error: message };
  }
}

/**
 * Retrieve active staff list for PIN login screen (No authentication required)
 */
export async function getActiveStaffListForLogin(): Promise<
  ActionResponse<Array<{ id: string; full_name: string; phone: string; avatar_url?: string | null }>>
> {
  try {
    const adminSupabase = createAdminClient();
    const { data, error } = await adminSupabase
      .from("profiles")
      .select("id, full_name, phone, avatar_url")
      .eq("role", "staff")
      .eq("is_active", true)
      .order("full_name", { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to load staff list.");
    return { success: false, error: message };
  }
}

/**
 * Validate staff 6-digit PIN and return sign-in credentials for client auth
 */
export async function authenticateStaffWithPin(
  staffId: string,
  pin: string
): Promise<ActionResponse<{ email: string; password: string; staffName: string }>> {
  try {
    const adminSupabase = createAdminClient();
    const { data: profile, error } = await adminSupabase
      .from("profiles")
      .select("id, full_name, phone, role, is_active, login_pin, email")
      .eq("id", staffId)
      .maybeSingle();

    if (error || !profile) {
      return { success: false, error: "Staff account not found." };
    }

    if (!profile.is_active) {
      return { success: false, error: "This staff account has been deactivated." };
    }

    if (!profile.login_pin || profile.login_pin.trim() !== pin.trim()) {
      return { success: false, error: "Incorrect 6-digit staff PIN. Please check and try again." };
    }

    // Direct in-memory fast credential resolution without slow external GoTrue API lookup
    const staffEmail = profile.email || `staff_${profile.phone.replace(/\D/g, "")}@aquatrack.internal`;
    const staffPassword = `Staff@${profile.login_pin}#Safe`;

    return {
      success: true,
      data: {
        email: staffEmail,
        password: staffPassword,
        staffName: profile.full_name,
      },
    };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Staff authentication failed.");
    return { success: false, error: message };
  }
}

/**
 * Update 6-digit PIN for a staff member (Owner only)
 */
export async function updateStaffPin(
  staffId: string,
  newPin: string
): Promise<ActionResponse<{ success: boolean }>> {
  try {
    await requireOwner();
    if (!/^\d{6}$/.test(newPin)) {
      return { success: false, error: "PIN must be exactly 6 numeric digits." };
    }
    const adminSupabase = createAdminClient();
    const { error } = await adminSupabase
      .from("profiles")
      .update({ login_pin: newPin, updated_at: new Date().toISOString() })
      .eq("id", staffId);

    if (error) {
      return { success: false, error: error.message };
    }

    await adminSupabase.auth.admin.updateUserById(staffId, {
      password: `Staff@${newPin}#Safe`,
      user_metadata: { login_pin: newPin },
    });

    return { success: true, data: { success: true } };
  } catch (err: unknown) {
    const message = formatErrorMessage(err, "Failed to update staff PIN.");
    return { success: false, error: message };
  }
}
