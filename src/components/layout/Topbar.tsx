"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { UserMenu } from "@/components/layout/UserMenu";
import { NotificationsDropdown } from "@/components/layout/NotificationsDropdown";
import { Badge } from "@/components/ui/Badge";
import { NAVIGATION_GROUPS } from "@/lib/constants";

interface TopbarProps {
  onOpenMobileNav: () => void;
}

export function Topbar({ onOpenMobileNav }: TopbarProps) {
  const pathname = usePathname();

  const activeTitle = React.useMemo(() => {
    for (const group of NAVIGATION_GROUPS) {
      for (const item of group.items) {
        if (item.href === pathname || (item.href !== "/dashboard" && pathname.startsWith(item.href))) {
          return item.title;
        }
      }
    }
    const lastSegment = pathname.split("/").filter(Boolean).pop() || "Dashboard";
    return lastSegment.charAt(0).toUpperCase() + lastSegment.slice(1).replace(/-/g, " ");
  }, [pathname]);

  return (
    <header className="sticky top-0 z-20 flex h-16 w-full items-center justify-between border-b border-border bg-card/95 backdrop-blur-xs px-3 sm:px-4 md:px-6">
      {/* Left: Mobile trigger & Breadcrumbs / Active Title */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          onClick={onOpenMobileNav}
          className="flex h-10 w-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground md:hidden transition-colors touch-manipulation"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Desktop Breadcrumbs */}
        <div className="hidden sm:block">
          <Breadcrumbs />
        </div>

        {/* Mobile Active Page Title */}
        <div className="sm:hidden font-bold text-xs truncate max-w-[125px] xs:max-w-[170px] text-foreground">
          {activeTitle}
        </div>
      </div>

      {/* Middle: Quick Search (Desktop) */}
      <div className="hidden lg:flex items-center max-w-sm w-full mx-4">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search orders, customers, jars..."
            className="h-8 w-full rounded-lg border border-input bg-muted/30 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:bg-background focus:outline-hidden focus:ring-1 focus:ring-ring"
            disabled
            title="Search will connect to database indexing in Phase 4"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden xl:inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono text-[9px] text-muted-foreground">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right: Status badge, Notifications & User menu */}
      <div className="flex items-center gap-1.5 xs:gap-2 md:gap-3 shrink-0">
        <Badge
          variant="outline"
          className="hidden sm:inline-flex text-[11px] font-normal border-primary/30 text-primary bg-primary/5 py-0.5"
        >
          Branch: Central Hub #1
        </Badge>

        <NotificationsDropdown />

        <div className="h-5 w-px bg-border mx-0.5" />

        <UserMenu />
      </div>
    </header>
  );
}
