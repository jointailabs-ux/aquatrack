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
    <header className="sticky top-0 z-20 flex h-14 md:h-16 w-full items-center justify-between border-b border-border bg-card/95 backdrop-blur-md px-3 sm:px-4 md:px-6">
      {/* Left: Mobile Branding + Page Title / Desktop Breadcrumbs */}
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        {/* Mobile Logo & Title */}
        <div className="flex md:hidden items-center gap-2 min-w-0">
          <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
            {logoUrl ? (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/30 border border-border p-0.5 shadow-xs overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
              </div>
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
                <Droplets className="h-4.5 w-4.5" />
              </div>
            )}
          </Link>

          <div className="flex items-center gap-1.5 min-w-0 truncate">
            <span className="font-bold text-sm truncate text-foreground">
              {activeTitle}
            </span>
          </div>
        </div>

        {/* Mobile Quick More Trigger */}
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground active:scale-95 md:hidden transition-all touch-manipulation cursor-pointer"
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
          <span>+ Fast Order</span>
        </Link>
        <Link
          href="/pos"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:from-emerald-600 hover:to-teal-700 transition-all duration-150 shadow-sm shadow-emerald-500/25 active:scale-95"
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          <span>+ POS Sale</span>
        </Link>
        <Link
          href="/customers?new=true"
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 transition-all duration-150 shadow-sm shadow-indigo-500/25 active:scale-95"
        >
          <UserPlus className="h-3.5 w-3.5" />
          <span>+ Add Customer</span>
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
