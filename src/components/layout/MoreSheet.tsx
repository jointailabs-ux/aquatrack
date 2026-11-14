"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  X,
  Search,
  ShoppingCart,
  RotateCcw,
  Truck,
  Package,
  Building2,
  ShoppingBag,
  Warehouse,
  UserCheck,
  CreditCard,
  Tag,
  FileSpreadsheet,
  BookOpen,
  BarChart3,
  Settings,
  ShieldAlert,
  LogOut,
  CalendarCheck,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useAppSession } from "@/components/providers/AppSessionProvider";

interface MoreSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DestinationItem {
  title: string;
  href: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
  requiredPermission?: "canPos" | "canWarehouse" | "canManageCustomers" | "canManageOrders";
  badge?: string;
  category: "operations" | "procurement" | "workforce" | "finance" | "system";
}

const DESTINATIONS: DestinationItem[] = [
  // Operations
  {
    title: "POS Counter",
    href: "/pos",
    description: "Counter sales & instant receipts",
    icon: ShoppingCart,
    requiredPermission: "canPos",
    badge: "Fast Sale",
    category: "operations",
  },
  {
    title: "Jar Tracking",
    href: "/jars",
    description: "Custody, damaged & scrap jars",
    icon: RotateCcw,
    badge: "Assets",
    category: "operations",
  },
  {
    title: "Delivery Trips",
    href: "/deliveries",
    description: "Daily routes & driver stops",
    icon: Truck,
    badge: "Fleet",
    category: "operations",
  },
  {
    title: "Driver App Mode",
    href: "/driver",
    description: "Mobile execution shell for drivers",
    icon: Truck,
    badge: "Driver",
    category: "operations",
  },
  {
    title: "Central Warehouse",
    href: "/warehouses",
    description: "Depot locations & balances",
    icon: Warehouse,
    requiredPermission: "canWarehouse",
    category: "operations",
  },

  // Procurement & Catalog
  {
    title: "Products Catalog",
    href: "/products",
    description: "SKUs, pricing, GST & units",
    icon: Package,
    category: "procurement",
  },
  {
    title: "Suppliers",
    href: "/suppliers",
    description: "Water plants & vendors",
    icon: Building2,
    ownerOnly: true,
    category: "procurement",
  },
  {
    title: "Purchase Orders",
    href: "/purchases",
    description: "Inbound stock receipts & POs",
    icon: ShoppingBag,
    ownerOnly: true,
    category: "procurement",
  },
  {
    title: "Special Pricing",
    href: "/pricing",
    description: "Customer-specific rates",
    icon: Tag,
    ownerOnly: true,
    category: "procurement",
  },

  // Workforce
  {
    title: "Staff Members",
    href: "/staff",
    description: "Employees & access permissions",
    icon: UserCheck,
    ownerOnly: true,
    category: "workforce",
  },
  {
    title: "Salaries & Payroll",
    href: "/payroll",
    description: "Salary payments & advances",
    icon: CreditCard,
    ownerOnly: true,
    category: "workforce",
  },
  {
    title: "Staff Attendance",
    href: "/attendance",
    description: "Daily shifts & clock-ins",
    icon: CalendarCheck,
    ownerOnly: true,
    category: "workforce",
  },

  // Finance
  {
    title: "Accounting & Ledger",
    href: "/accounting",
    description: "Double-entry financial journal",
    icon: BookOpen,
    ownerOnly: true,
    category: "finance",
  },
  {
    title: "Operating Expenses",
    href: "/expenses",
    description: "Fuel, vehicle repairs & bills",
    icon: FileSpreadsheet,
    ownerOnly: true,
    category: "finance",
  },
  {
    title: "Financial Reports",
    href: "/reports",
    description: "P&L, balance sheet & analytics",
    icon: BarChart3,
    ownerOnly: true,
    category: "finance",
  },

  // System
  {
    title: "Business Settings",
    href: "/settings",
    description: "Company details, tax & logo",
    icon: Settings,
    ownerOnly: true,
    category: "system",
  },
  {
    title: "Audit Trail",
    href: "/audit-logs",
    description: "Security & activity logs",
    icon: ShieldAlert,
    ownerOnly: true,
    category: "system",
  },
];

const CATEGORY_LABELS = {
  operations: "Operations & Logistics",
  procurement: "Procurement & Catalog",
  workforce: "Team & Payroll",
  finance: "Finance & Accounting",
  system: "Settings & System",
};

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  operations: { bg: "bg-sky-500/10", text: "text-sky-600" },
  procurement: { bg: "bg-emerald-500/10", text: "text-emerald-600" },
  workforce: { bg: "bg-purple-500/10", text: "text-purple-600" },
  finance: { bg: "bg-amber-500/10", text: "text-amber-600" },
  system: { bg: "bg-cyan-500/10", text: "text-cyan-700" },
};

export function MoreSheet({ isOpen, onClose }: MoreSheetProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { addToast } = useToast();
  const { user, permissions: sessionPermissions } = useAppSession();

  const [search, setSearch] = React.useState("");
  const userRole = user.role;
  const userName = user.name;
  const permissions = sessionPermissions;

  // Close when pathname changes
  const prevPathname = React.useRef(pathname);
  React.useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      onClose();
    }
  }, [pathname, onClose]);

  // Lock background scroll when sheet is open
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

  // Filter items based on search and permissions
  const filteredItems = React.useMemo(() => {
    return DESTINATIONS.filter((item) => {
      // Role check
      if (item.ownerOnly && userRole !== "owner") {
        return false;
      }
      // Permission check for staff
      if (userRole === "staff" && item.requiredPermission) {
        if (!permissions[item.requiredPermission]) {
          return false;
        }
      }
      // Search check
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          CATEGORY_LABELS[item.category].toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [search, userRole, permissions]);

  // Group filtered items by category
  const groupedItems = React.useMemo(() => {
    const groups: Partial<Record<keyof typeof CATEGORY_LABELS, DestinationItem[]>> = {};
    for (const item of filteredItems) {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category]!.push(item);
    }
    return groups;
  }, [filteredItems]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="All Modules & Features"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet Container */}
      <div className="relative z-10 flex flex-col w-full max-h-[85vh] bg-card rounded-t-3xl border-t border-border shadow-2xl animate-in slide-in-from-bottom duration-250 safe-area-bottom overflow-hidden">
        {/* Drag handle */}
        <div className="pt-2 pb-1 flex justify-center">
          <div className="h-1.5 w-12 bg-muted-foreground/25 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs border border-primary/20">
              <User className="h-4 w-4" />
            </div>
            <div className="truncate">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-foreground truncate">{userName}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary">
                  {userRole}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">All Modules & Tools</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 transition-all touch-manipulation cursor-pointer"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* In-sheet Quick Filter */}
        <div className="px-4 py-2.5 border-b border-border/60 bg-muted/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search features, POS, jars, reports..."
              className="w-full h-9 pl-9 pr-8 rounded-xl bg-muted/40 border border-input text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
          {Object.entries(groupedItems).length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              No matching modules found for &ldquo;{search}&rdquo;.
            </div>
          ) : (
            Object.entries(groupedItems).map(([category, items]) => (
              <div key={category} className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                  {CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]}
                </h3>
                <div className="grid grid-cols-1 gap-1.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onClose}
                        className={cn(
                          "flex items-center justify-between p-2.5 rounded-xl border transition-all touch-manipulation cursor-pointer active:scale-[0.99]",
                          isActive
                            ? "bg-primary/10 border-primary/40 text-primary shadow-xs font-semibold"
                            : "bg-card hover:bg-accent/60 border-border text-foreground hover:border-border/80"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={cn(
                              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                              isActive
                                ? "bg-primary text-primary-foreground shadow-xs"
                                : `${CATEGORY_COLORS[item.category]?.bg || "bg-muted"} ${CATEGORY_COLORS[item.category]?.text || "text-muted-foreground"}`
                            )}
                          >
                            <Icon className="h-4.5 w-4.5" />
                          </div>
                          <div className="truncate">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold truncate">{item.title}</span>
                              {item.badge && (
                                <span className={cn(
                                  "text-[9px] px-1.5 py-0.5 rounded-sm font-semibold",
                                  CATEGORY_COLORS[item.category]?.bg || "bg-muted",
                                  CATEGORY_COLORS[item.category]?.text || "text-muted-foreground"
                                )}>
                                  {item.badge}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {item.description}
                            </p>
                          </div>
                        </div>

                        <span className="text-muted-foreground text-xs pl-2">›</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer with Sign Out */}
        <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-between">
          <Link
            href="/settings"
            onClick={onClose}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground py-1 px-2 rounded-lg"
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </Link>

          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 py-1.5 px-3 rounded-lg transition-colors touch-manipulation cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}

