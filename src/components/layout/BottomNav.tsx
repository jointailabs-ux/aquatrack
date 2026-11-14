"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Truck,
  Package,
  UserCheck,
  Grid,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavProps {
  onOpenMore: () => void;
  isMoreOpen?: boolean;
}

interface BottomTabItem {
  label: string;
  labelBn: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  isMore?: boolean;
}

const TABS: BottomTabItem[] = [
  {
    label: "Home",
    labelBn: "হোম",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Orders",
    labelBn: "অর্ডার",
    href: "/orders",
    icon: Truck,
  },
  {
    label: "Stock",
    labelBn: "স্টক",
    href: "/inventory",
    icon: Package,
  },
  {
    label: "Staff",
    labelBn: "স্টাফ",
    href: "/staff",
    icon: UserCheck,
  },
  {
    label: "Menu",
    labelBn: "মেনু",
    icon: Grid,
    isMore: true,
  },
];

export function BottomNav({ onOpenMore, isMoreOpen = false }: BottomNavProps) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white/95 dark:bg-slate-950/98 backdrop-blur-xl border-t border-slate-200/90 dark:border-slate-800/90 shadow-[0_-4px_25px_rgba(0,0,0,0.06)] dark:shadow-[0_-8px_30px_rgba(0,0,0,0.6)] safe-area-bottom select-none transition-colors"
      role="navigation"
      aria-label="Mobile Bottom Navigation"
    >
      <div className="flex h-16 items-center justify-around px-2 max-w-md mx-auto">
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
                  "flex flex-1 flex-col items-center justify-center py-1 px-1 min-h-[48px] rounded-xl transition-all touch-manipulation cursor-pointer active:scale-95",
                  isActive
                    ? "text-primary dark:text-sky-400 font-black"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                )}
                aria-label="Open navigation menu"
                aria-expanded={isMoreOpen}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
                    isActive
                      ? "bg-gradient-to-tr from-sky-500 via-blue-600 to-indigo-600 text-white shadow-md shadow-sky-500/30 scale-105"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900"
                  )}
                >
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <span
                  className={cn(
                    "text-[10px] mt-0.5 tracking-tight",
                    isActive
                      ? "text-primary dark:text-sky-400 font-extrabold"
                      : "text-slate-600 dark:text-slate-400 font-medium"
                  )}
                >
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
                "flex flex-1 flex-col items-center justify-center py-1 px-1 min-h-[48px] rounded-xl transition-all touch-manipulation active:scale-95",
                isActive
                  ? "text-primary dark:text-sky-400 font-black"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
                  isActive
                    ? "bg-gradient-to-tr from-sky-500 via-blue-600 to-indigo-600 text-white shadow-md shadow-sky-500/30 scale-105"
                    : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900"
                )}
              >
                <Icon className="h-4.5 w-4.5" />
              </div>
              <span
                className={cn(
                  "text-[10px] mt-0.5 tracking-tight",
                  isActive
                    ? "text-primary dark:text-sky-400 font-extrabold"
                    : "text-slate-600 dark:text-slate-400 font-medium"
                )}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

