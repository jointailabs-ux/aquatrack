"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAVIGATION_GROUPS } from "@/lib/constants";
import { Droplets, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { getBusinessSettings } from "@/modules/settings/business-settings.service";

export interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  className?: string;
}

export function Sidebar({
  isCollapsed,
  onToggleCollapse,
  className,
}: SidebarProps) {
  const pathname = usePathname();
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;

    const fetchSharedLogo = async () => {
      try {
        const res = await getBusinessSettings();
        if (isMounted && res.success && res.data?.logo_url) {
          setLogoUrl(res.data.logo_url);
        } else if (isMounted && res.success && !res.data?.logo_url) {
          setLogoUrl(null);
        }
      } catch {
        // Fallback silently if unauthenticated or network error
      }
    };

    fetchSharedLogo();

    const handleLogoUpdate = (e: Event) => {
      const customEvt = e as CustomEvent<string | null>;
      if (customEvt.detail !== undefined) {
        setLogoUrl(customEvt.detail);
      } else {
        fetchSharedLogo();
      }
    };

    window.addEventListener("aquatrack_logo_updated", handleLogoUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener("aquatrack_logo_updated", handleLogoUpdate);
    };
  }, []);

  return (
    <aside
      className={cn(
        "relative flex flex-col border-r border-border bg-card transition-all duration-200 z-30 select-none",
        isCollapsed ? "w-16" : "w-64",
        className
      )}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-border/80">
        <Link href="/dashboard" className="flex items-center gap-3 overflow-hidden">
          {logoUrl ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/30 border border-border p-1 shadow-xs overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="Business Logo"
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
              <Droplets className="h-5 w-5" />
            </div>
          )}
          {!isCollapsed && (
            <div className="flex flex-col truncate">
              <span className="font-bold text-sm tracking-tight text-foreground truncate">
                AquaTrack <span className="text-primary font-normal">ERP</span>
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium truncate">
                Distribution Hub
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* Collapse Toggle Button */}
      <button
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-20 z-40 hidden md:flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground transition-colors"
      >
        {isCollapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin">
        {NAVIGATION_GROUPS.map((group) => (
          <div key={group.label} className="space-y-1">
            {!isCollapsed && (
              <h4 className="px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">
                {group.label}
              </h4>
            )}

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                const isClickable = item.isImplemented;

                if (!isClickable) {
                  return (
                    <div
                      key={item.title}
                      title={`${item.title} (Available in Phase ${item.moduleNumber > 10 ? '4-9' : '4'})`}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground/50 cursor-not-allowed select-none group",
                        isCollapsed && "justify-center px-0"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                      {!isCollapsed && (
                        <div className="flex items-center justify-between flex-1 truncate">
                          <span className="truncate">{item.title}</span>
                          <Lock className="h-3 w-3 text-muted-foreground/30 ml-2 shrink-0" />
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.title}
                    href={item.href}
                    title={isCollapsed ? item.title : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors select-none",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      isCollapsed && "justify-center px-0"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive ? "text-primary-foreground" : "text-muted-foreground"
                      )}
                    />
                    {!isCollapsed && (
                      <span className="truncate">{item.title}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Info */}
      {!isCollapsed && (
        <div className="p-3 border-t border-border/80 text-[11px] text-muted-foreground flex items-center justify-between bg-muted/20">
          <span>AquaTrack ERP</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
            v1.0 Live ERP
          </Badge>
        </div>
      )}
    </aside>
  );
}
