export type UserRole = "owner" | "staff";

export interface UserPermissions {
  canPos: boolean;
  canWarehouse: boolean;
  canManageCustomers: boolean;
  canManageOrders: boolean;
}

export interface UserProfile {
  id: string;
  fullName: string;
  phone: string;
  role: UserRole;
  avatarUrl?: string | null;
  isActive: boolean;
  // Modular Staff Permissions
  canPos?: boolean;
  canWarehouse?: boolean;
  canManageCustomers?: boolean;
  canManageOrders?: boolean;
  salaryAmount?: number;
  salaryType?: "MONTHLY" | "FIXED_PERIOD";
  createdAt: string;
}

export interface SessionUser {
  id: string;
  email?: string;
  phone?: string;
  role: UserRole;
  profile: UserProfile;
}

export type AuthState = {
  user: SessionUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
};

export interface RoleMetadata {
  title: string;
  description: string;
  internalOnly: boolean;
}

export const ROLE_PERMISSIONS: Record<UserRole, RoleMetadata> = {
  owner: {
    title: "Owner",
    description: "Complete executive and operational access across all single-location modules",
    internalOnly: true,
  },
  staff: {
    title: "Staff",
    description: "Delivery execution, customer info, empty jar collection, and permitted operational modules",
    internalOnly: true,
  },
};

/**
 * Normalizes any legacy role representation into either 'owner' or 'staff'.
 */
export function normalizeUserRole(role: string | null | undefined): UserRole {
  if (!role) return "staff";
  const lower = role.toLowerCase().trim();
  if (lower === "owner" || lower === "super_admin") {
    return "owner";
  }
  return "staff";
}
