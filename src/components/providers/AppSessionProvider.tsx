"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { getBusinessSettings } from "@/modules/settings/business-settings.service";
import { BusinessSettingsRecord } from "@/modules/settings/business-settings.schema";
import { UserRole } from "@/types/auth.types";

export interface AppUserSession {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AppPermissions {
  canPos: boolean;
  canWarehouse: boolean;
  canManageCustomers: boolean;
  canManageOrders: boolean;
}

interface AppSessionContextValue {
  user: AppUserSession;
  permissions: AppPermissions;
  businessSettings: BusinessSettingsRecord | null;
  logoUrl: string | null;
  updateLogo: (url: string | null) => void;
  refreshSession: () => Promise<void>;
  isLoading: boolean;
}

const DEFAULT_USER: AppUserSession = {
  id: "",
  name: "AquaTrack User",
  email: "",
  role: "staff",
};

const DEFAULT_PERMISSIONS: AppPermissions = {
  canPos: false,
  canWarehouse: false,
  canManageCustomers: false,
  canManageOrders: false,
};

const AppSessionContext = React.createContext<AppSessionContextValue>({
  user: DEFAULT_USER,
  permissions: DEFAULT_PERMISSIONS,
  businessSettings: null,
  logoUrl: null,
  updateLogo: () => {},
  refreshSession: async () => {},
  isLoading: false,
});

const CACHE_KEY = "aquatrack_session_v1";

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AppUserSession>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.user) return parsed.user;
        }
      } catch {
        // Fallback
      }
    }
    return DEFAULT_USER;
  });

  const [permissions, setPermissions] = React.useState<AppPermissions>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.permissions) return parsed.permissions;
        }
      } catch {
        // Fallback
      }
    }
    return DEFAULT_PERMISSIONS;
  });

  const [businessSettings, setBusinessSettings] = React.useState<BusinessSettingsRecord | null>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.businessSettings) return parsed.businessSettings;
        }
      } catch {
        // Fallback
      }
    }
    return null;
  });

  const [logoUrl, setLogoUrl] = React.useState<string | null>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.logoUrl !== undefined) return parsed.logoUrl;
        }
      } catch {
        // Fallback
      }
    }
    return null;
  });

  const [isLoading, setIsLoading] = React.useState(false);

  const loadData = React.useCallback(async () => {
    try {
      setIsLoading(true);
      const supabase = createClient();

      const [authRes, settingsRes] = await Promise.all([
        supabase.auth.getUser(),
        getBusinessSettings(),
      ]);

      let newUser = DEFAULT_USER;
      let newPermissions = DEFAULT_PERMISSIONS;

      if (authRes.data?.user) {
        const authUser = authRes.data.user;
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, role, can_pos, can_warehouse, can_manage_customers, can_manage_orders")
          .eq("id", authUser.id)
          .maybeSingle();

        const role = (profile?.role as UserRole) || (authUser.user_metadata?.role as UserRole) || "staff";
        newUser = {
          id: authUser.id,
          name: profile?.full_name || authUser.email?.split("@")[0] || "User",
          email: authUser.email || "",
          role,
        };

        newPermissions = {
          canPos: !!profile?.can_pos,
          canWarehouse: !!profile?.can_warehouse,
          canManageCustomers: !!profile?.can_manage_customers,
          canManageOrders: !!profile?.can_manage_orders,
        };
      }

      const newSettings = settingsRes.success && settingsRes.data ? settingsRes.data : null;
      const newLogo = newSettings?.logo_url || null;

      setUser(newUser);
      setPermissions(newPermissions);
      setBusinessSettings(newSettings);
      setLogoUrl(newLogo);

      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
              user: newUser,
              permissions: newPermissions,
              businessSettings: newSettings,
              logoUrl: newLogo,
            })
          );
        } catch {
          // Fallback
        }
      }
    } catch {
      // Fallback silently
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();

    const handleLogoUpdate = (e: Event) => {
      const customEvt = e as CustomEvent<string | null>;
      if (customEvt.detail !== undefined) {
        setLogoUrl(customEvt.detail);
      } else {
        loadData();
      }
    };

    window.addEventListener("aquatrack_logo_updated", handleLogoUpdate);
    return () => {
      window.removeEventListener("aquatrack_logo_updated", handleLogoUpdate);
    };
  }, [loadData]);

  const updateLogo = React.useCallback((url: string | null) => {
    setLogoUrl(url);
    if (typeof window !== "undefined") {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        const parsed = cached ? JSON.parse(cached) : {};
        parsed.logoUrl = url;
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(parsed));
      } catch {
        // Fallback
      }
    }
  }, []);

  const value = React.useMemo<AppSessionContextValue>(
    () => ({
      user,
      permissions,
      businessSettings,
      logoUrl,
      updateLogo,
      refreshSession: loadData,
      isLoading,
    }),
    [user, permissions, businessSettings, logoUrl, updateLogo, loadData, isLoading]
  );

  return (
    <AppSessionContext.Provider value={value}>
      {children}
    </AppSessionContext.Provider>
  );
}

export function useAppSession() {
  return React.useContext(AppSessionContext);
}

