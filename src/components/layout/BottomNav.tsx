"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Truck,
  Users,
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
    label: "Customers",
    labelBn: "গ্রাহক",
    href: "/customers",
    icon: Users,
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
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white/95 dark:bg-slate-950/95 backdrop-blur-2xl border-t border-slate-200/90 dark:border-slate-800/90 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] dark:shadow-[0_-12px_40px_rgba(0,0,0,0.7)] safe-area-bottom select-none transition-all"
      role="navigation"
      aria-label="Mobile Bottom Navigation"
    >
      {/* Top glowing accent line */}
      <div className="h-[2px] w-full bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-500 opacity-90" />
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
                  "relative flex flex-1 flex-col items-center justify-center py-1 px-1 min-h-[52px] rounded-2xl transition-all duration-200 touch-manipulation cursor-pointer active:scale-90",
                  isActive
                    ? "text-sky-600 dark:text-sky-400 font-black"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                )}
                aria-label="Open navigation menu"
                aria-expanded={isMoreOpen}
              >
                <div
                  className={cn(
                    "relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200",
                    isActive
                      ? "bg-gradient-to-tr from-sky-500 via-blue-600 to-indigo-600 text-white shadow-lg shadow-sky-500/40 scale-110 ring-2 ring-sky-400/40"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {isActive && (
                    <span className="absolute -bottom-1 w-1.5 h-1.5 rounded-full bg-white shadow-xs" />
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] mt-1 tracking-tight transition-colors",
                    isActive
                      ? "text-sky-600 dark:text-sky-400 font-extrabold"
                      : "text-slate-600 dark:text-slate-400 font-semibold"
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
                "relative flex flex-1 flex-col items-center justify-center py-1 px-1 min-h-[52px] rounded-2xl transition-all duration-200 touch-manipulation active:scale-90",
                isActive
                  ? "text-sky-600 dark:text-sky-400 font-black"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <div
                className={cn(
                  "relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200",
                  isActive
                    ? "bg-gradient-to-tr from-sky-500 via-blue-600 to-indigo-600 text-white shadow-lg shadow-sky-500/40 scale-110 ring-2 ring-sky-400/40"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800/60"
                )}
              >
                <Icon className="h-5 w-5" />
                {isActive && (
                  <span className="absolute -bottom-1 w-1.5 h-1.5 rounded-full bg-white shadow-xs" />
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] mt-1 tracking-tight transition-colors",
                  isActive
                    ? "text-sky-600 dark:text-sky-400 font-extrabold"
                    : "text-slate-600 dark:text-slate-400 font-semibold"
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

