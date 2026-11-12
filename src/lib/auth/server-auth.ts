import "server-only";
import { createClient } from "@/lib/supabase/server";
import { UserProfile, normalizeUserRole, UserPermissions } from "@/types/auth.types";
import { User } from "@supabase/supabase-js";

export interface AuthenticatedContext {
  user: User;
  profile: UserProfile;
}

/**
 * Retrieves the currently authenticated Supabase user and active profile.
 * Strictly verified server-side via Supabase Auth token (never trusts client cookies).
 */
export async function getCurrentUser(): Promise<AuthenticatedContext | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return null;
    }

    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (profileError || !profileRow) {
      return null;
    }

    const role = normalizeUserRole(profileRow.role);

    const profile: UserProfile = {
      id: profileRow.id,
      fullName: profileRow.full_name,
      phone: profileRow.phone,
      role,
      avatarUrl: profileRow.avatar_url,
      isActive: profileRow.is_active,
      canPos: Boolean(profileRow.can_pos),
      canWarehouse: Boolean(profileRow.can_warehouse),
      canManageCustomers: Boolean(profileRow.can_manage_customers),
      canManageOrders: Boolean(profileRow.can_manage_orders),
      salaryAmount: profileRow.salary_amount ? Number(profileRow.salary_amount) : 0,
      salaryType: profileRow.salary_type || "MONTHLY",
      createdAt: profileRow.created_at,
    };

    return { user, profile };
  } catch {
    return null;
  }
}

/**
 * Asserts that the request is authenticated by an active user.
 */
export async function requireAuth(): Promise<AuthenticatedContext> {
  const context = await getCurrentUser();
  if (!context) {
    throw new Error("UNAUTHORIZED: Active session required.");
  }
  return context;
}

/**
 * Asserts that the caller is the Business Owner.
 */
export async function requireOwner(): Promise<AuthenticatedContext> {
  const context = await requireAuth();
  if (context.profile.role !== "owner") {
    throw new Error("FORBIDDEN: Administrative owner privileges required.");
  }
  return context;
}

/**
 * Asserts that the caller is the Owner OR Staff with the required granular permission.
 */
export async function requireStaffPermission(
  permission: keyof UserPermissions
): Promise<AuthenticatedContext> {
  const context = await requireAuth();
  if (context.profile.role === "owner") {
    return context;
  }

  const hasPerm = context.profile[permission];
  if (!hasPerm) {
    throw new Error(`FORBIDDEN: Missing required operational permission: ${String(permission)}.`);
  }

  return context;
}
