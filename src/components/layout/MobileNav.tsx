"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X, Droplets, Lock, Settings, LogOut, User } from "lucide-react";
import { NAVIGATION_GROUPS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { getBusinessSettings } from "@/modules/settings/business-settings.service";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileNav({ isOpen, onClose }: MobileNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { addToast } = useToast();
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null);
  const [userName, setUserName] = React.useState<string>("Staff User");
  const [userRole, setUserRole] = React.useState<string>("staff");

  const prevPathnameRef = React.useRef(pathname);

  // Close only when navigation actually changes
  React.useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      onClose();
    }
  }, [pathname, onClose]);

  // Load business logo & user info
  React.useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        const [settingsRes, supabase] = await Promise.all([
          getBusinessSettings(),
          createClient(),
        ]);

        if (isMounted && settingsRes.success && settingsRes.data?.logo_url) {
          setLogoUrl(settingsRes.data.logo_url);
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (user && isMounted) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, role")
            .eq("id", user.id)
            .maybeSingle();

          if (isMounted) {
            setUserName(profile?.full_name || user.email?.split("@")[0] || "User");
            setUserRole(profile?.role || "staff");
          }
        }
      } catch {
        // Fallback gracefully
      }
    }

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
      isMounted = false;
      window.removeEventListener("aquatrack_logo_updated", handleLogoUpdate);
    };
  }, []);

  // Lock background scroll when open
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  const handleLogout = async () => {
    onClose();
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Fallback
    }

    addToast({
      type: "info",
      title: "Signed Out",
      message: "You have been logged out of your session.",
    });
    router.push("/login");
    router.refresh();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-label="Mobile Navigation">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="relative z-10 flex w-full max-w-xs flex-1 flex-col bg-slate-900 text-slate-100 border-r border-slate-800 shadow-2xl animate-in slide-in-from-left duration-200 safe-area-bottom">
        {/* Header with Branding */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-slate-800">
          <Link href="/dashboard" onClick={onClose} className="flex items-center gap-2.5 min-w-0">
            {logoUrl ? (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 border border-slate-700 p-1 shadow-xs overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl}
                  alt="Business Logo"
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-sky-500 via-sky-400 to-cyan-300 text-slate-950 shadow-md shadow-sky-500/30">
                <Droplets className="h-5 w-5" />
              </div>
            )}
            <div className="flex flex-col truncate">
              <span className="font-extrabold text-sm tracking-tight text-white truncate">
                AquaTrack <span className="text-sky-400 font-bold">ERP</span>
              </span>
              <span className="text-[10px] text-sky-300/70 uppercase tracking-widest font-semibold truncate">
                Distribution Hub
              </span>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="flex h-10 w-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors touch-manipulation"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Item Groups */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {NAVIGATION_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1">
              <h4 className="px-3 text-[11px] font-extrabold uppercase tracking-wider text-sky-400/90 mb-2">
                {group.label}
              </h4>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  const isClickable = item.isImplemented;

                  if (!isClickable) {
                    return (
                      <div
                        key={item.title}
                        className="flex min-h-[44px] items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium text-slate-500 cursor-not-allowed select-none"
                      >
                        <div className="flex items-center gap-3">
                          <Icon className="h-4 w-4 text-slate-600 shrink-0" />
                          <span className="truncate">{item.title}</span>
                        </div>
                        <Lock className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.title}
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        "flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors touch-manipulation",
                        isActive
                          ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white font-bold shadow-md shadow-sky-500/20"
                          : "text-slate-300 hover:bg-slate-800/80 hover:text-white active:bg-slate-800"
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-white" : "text-slate-400")} />
                      <span className="truncate">{item.title}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Mobile User Account & Quick Actions Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/60 space-y-2">
          <div className="flex items-center justify-between px-2 py-1 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-400 font-bold text-xs border border-sky-500/30">
                <User className="h-3.5 w-3.5" />
              </div>
              <div className="truncate">
                <p className="font-semibold text-slate-200 text-xs truncate">{userName}</p>
                <p className="text-[10px] text-slate-400 capitalize truncate">{userRole}</p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Link
                href="/settings"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors touch-manipulation"
                title="Settings"
                aria-label="Account Settings"
              >
                <Settings className="h-4 w-4" />
              </Link>
              <button
                onClick={handleLogout}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors touch-manipulation"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
