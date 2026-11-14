"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Truck,
  Package,
  Users,
  Grid,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavProps {
  onOpenMore: () => void;
  isMoreOpen?: boolean;
}

interface BottomTabItem {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  isMore?: boolean;
}

const TABS: BottomTabItem[] = [
  {
    label: "Home",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Orders",
    href: "/orders",
    icon: Truck,
  },
  {
    label: "Inventory",
    href: "/inventory",
    icon: Package,
  },
  {
    label: "Customers",
    href: "/customers",
    icon: Users,
  },
  {
    label: "More",
    icon: Grid,
    isMore: true,
  },
];

export function BottomNav({ onOpenMore, isMoreOpen = false }: BottomNavProps) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-card/95 backdrop-blur-md border-t border-border shadow-[0_-2px_10px_rgba(0,0,0,0.04)] safe-area-bottom select-none"
      role="navigation"
      aria-label="Mobile Bottom Navigation"
    >
      <div className="flex h-16 items-center justify-around px-1 max-w-md mx-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;

          if (tab.isMore) {
            const isActive = isMoreOpen;
            return (
              <button
                key={tab.label}
                type="button"
                onClick={onOpenMore}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center py-1.5 px-1 min-h-[48px] rounded-xl transition-all touch-manipulation cursor-pointer",
                  isActive
                    ? "text-primary font-bold"
                    : "text-muted-foreground hover:text-foreground active:scale-95"
                )}
                aria-label="Open more navigation options"
                aria-expanded={isMoreOpen}
              >
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                    isActive ? "bg-primary text-primary-foreground shadow-xs shadow-primary/30" : "text-muted-foreground"
                  )}
                >
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <span className={cn("text-[10px] mt-0.5 tracking-tight font-medium", isActive ? "text-primary font-bold" : "text-muted-foreground")}>
                  {tab.label}
                </span>
              </button>
            );
          }

          const isActive =
            tab.href === "/dashboard"
              ? pathname === "/dashboard"
              : tab.href
              ? pathname === tab.href || pathname.startsWith(`${tab.href}/`)
              : false;

          return (
            <Link
              key={tab.label}
              href={tab.href!}
              className={cn(
                "flex flex-1 flex-col items-center justify-center py-1.5 px-1 min-h-[48px] rounded-xl transition-all touch-manipulation",
                isActive
                  ? "text-primary font-bold"
                  : "text-muted-foreground hover:text-foreground active:scale-95"
              )}
            >
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg transition-all",
                  isActive ? "bg-primary text-primary-foreground shadow-xs shadow-primary/30" : "text-muted-foreground"
                )}
              >
                <Icon className="h-4.5 w-4.5" />
              </div>
              <span className={cn("text-[10px] mt-0.5 tracking-tight font-medium", isActive ? "text-primary font-bold" : "text-muted-foreground")}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

