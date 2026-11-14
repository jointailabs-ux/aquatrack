"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Droplets, Menu, ShoppingCart, Truck, UserPlus } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { UserMenu } from "@/components/layout/UserMenu";
import { NotificationsDropdown } from "@/components/layout/NotificationsDropdown";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Badge } from "@/components/ui/Badge";
import { NAVIGATION_GROUPS } from "@/lib/constants";
import { useAppSession } from "@/components/providers/AppSessionProvider";

interface TopbarProps {
  onOpenMobileNav: () => void;
}

export function Topbar({ onOpenMobileNav }: TopbarProps) {
  const pathname = usePathname();
  const { logoUrl } = useAppSession();

  const activeTitle = React.useMemo(() => {
    for (const group of NAVIGATION_GROUPS) {
      for (const item of group.items) {
        if (item.href === pathname || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))) {
          return item.title;
        }
      }
    }
    const lastSegment = pathname.split("/").filter(Boolean).pop() || "Dashboard";
    return lastSegment.charAt(0).toUpperCase() + lastSegment.slice(1).replace(/-/g, " ");
  }, [pathname]);

  return (
    <header className="sticky top-0 z-30 flex h-14 md:h-16 w-full items-center justify-between border-b border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs px-3 sm:px-4 md:px-6 relative select-none">
      {/* Top Brand Accent Ribbon */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600" />

      {/* Left: Mobile Branding + Page Title / Desktop Breadcrumbs */}
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        {/* Mobile Logo & Title */}
        <div className="flex md:hidden items-center gap-2 min-w-0">
          <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
            {logoUrl ? (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-card border-2 border-border p-0.5 shadow-xs overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
              </div>
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sm shadow-sky-500/30">
                <Droplets className="h-4.5 w-4.5" />
              </div>
            )}
          </Link>

          <div className="flex items-center gap-1.5 min-w-0 truncate">
            <span className="font-extrabold text-sm truncate text-foreground tracking-tight">
              {activeTitle}
            </span>
          </div>
        </div>

        {/* Mobile Quick Drawer Trigger */}
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 md:hidden transition-all touch-manipulation cursor-pointer border border-border"
          aria-label="Open navigation menu"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>

        {/* Desktop Breadcrumbs */}
        <div className="hidden md:block">
          <Breadcrumbs />
        </div>
      </div>

      {/* Middle: Fast Action Speed Bar */}
      <div className="hidden md:flex items-center gap-2.5 mx-4">
        <Link
          href="/orders?new=true"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-sky-500 to-blue-600 text-white hover:from-sky-600 hover:to-blue-700 transition-all duration-150 shadow-sm shadow-sky-500/25 active:scale-95"
        >
          <Truck className="h-3.5 w-3.5" />
          <span>+ New Order (নতুন অর্ডার)</span>
        </Link>
        <Link
          href="/inventory"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 transition-all duration-150 shadow-sm shadow-emerald-500/25 active:scale-95"
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          <span>+ Stock Inventory (স্টক)</span>
        </Link>
        <Link
          href="/customers?new=true"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 transition-all duration-150 shadow-sm shadow-indigo-500/25 active:scale-95"
        >
          <UserPlus className="h-3.5 w-3.5" />
          <span>+ Add Customer (কাস্টমার)</span>
        </Link>
      </div>

      {/* Right: Status badge, Notifications & User menu */}
      <div className="flex items-center gap-1.5 xs:gap-2 md:gap-3 shrink-0">
        <Badge
          variant="outline"
          className="hidden sm:inline-flex text-[11px] font-normal border-primary/30 text-primary bg-primary/5 py-0.5"
        >
          Central Hub #1
        </Badge>

        <NotificationsDropdown />

        <ThemeToggle />

        <div className="h-4 w-px bg-border mx-0.5 hidden xs:block" />

        <UserMenu />
      </div>
    </header>
  );
}
