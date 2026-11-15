import { UserRole, UserPermissions } from "@/types/auth.types";
import {
  LayoutDashboard,
  Users,
  Building2,
  ShoppingBag,
  Boxes,
  Truck,
  RotateCcw,
  UserCheck,
  FileSpreadsheet,
  Settings,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isImplemented: boolean;
  moduleNumber: number;
  roles: UserRole[];
  requiredPermission?: keyof UserPermissions;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAVIGATION_GROUPS: NavGroup[] = [
  {
    label: "OVERVIEW",
    items: [
      {
        title: "Home Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        isImplemented: true,
        moduleNumber: 1,
        roles: ["owner", "staff"],
      },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      {
        title: "Orders & Delivery",
        href: "/orders",
        icon: Truck,
        isImplemented: true,
        moduleNumber: 8,
        roles: ["owner", "staff"],
        requiredPermission: "canManageOrders",
      },
      {
        title: "Bottle Tracking (Jars)",
        href: "/jars",
        icon: RotateCcw,
        isImplemented: true,
        moduleNumber: 10,
        roles: ["owner", "staff"],
      },
      {
        title: "Stock in Godown",
        href: "/inventory",
        icon: Boxes,
        isImplemented: true,
        moduleNumber: 5,
        roles: ["owner", "staff"],
        requiredPermission: "canWarehouse",
      },
      {
        title: "Customers & Khata",
        href: "/customers",
        icon: Users,
        isImplemented: true,
        moduleNumber: 2,
        roles: ["owner", "staff"],
        requiredPermission: "canManageCustomers",
      },
      {
        title: "Suppliers (মহাজন / সাপ্লায়ার)",
        href: "/suppliers",
        icon: Building2,
        isImplemented: true,
        moduleNumber: 3,
        roles: ["owner"],
      },
      {
        title: "Purchases (মাল কেনা)",
        href: "/purchases",
        icon: ShoppingBag,
        isImplemented: true,
        moduleNumber: 7,
        roles: ["owner"],
      },
    ],
  },
  {
    label: "WORKFORCE",
    items: [
      {
        title: "Staff & Deliveries",
        href: "/staff",
        icon: UserCheck,
        isImplemented: true,
        moduleNumber: 11,
        roles: ["owner", "staff"],
      },
    ],
  },
  {
    label: "FINANCE & EXPENSES",
    items: [
      {
        title: "Expenses & Money Spent (খরচ ও হিসাব)",
        href: "/expenses",
        icon: FileSpreadsheet,
        isImplemented: true,
        moduleNumber: 13,
        roles: ["owner"],
      },
      {
        title: "Business Settings",
        href: "/settings",
        icon: Settings,
        isImplemented: true,
        moduleNumber: 21,
        roles: ["owner"],
      },
    ],
  },
];
