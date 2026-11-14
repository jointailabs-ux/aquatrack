import { UserRole, UserPermissions } from "@/types/auth.types";
import {
  LayoutDashboard,
  Users,
  Building2,
  ShoppingCart,
  ShoppingBag,
  Package,
  Boxes,
  Warehouse,
  Truck,
  RotateCcw,
  UserCheck,
  CreditCard,
  FileSpreadsheet,
  BarChart3,
  Settings,
  Tag,
  BookOpen,
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
        title: "Shop Counter Sale",
        href: "/pos",
        icon: ShoppingCart,
        isImplemented: true,
        moduleNumber: 4,
        roles: ["owner", "staff"],
        requiredPermission: "canPos",
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
        title: "Orders & Delivery",
        href: "/orders",
        icon: Truck,
        isImplemented: true,
        moduleNumber: 8,
        roles: ["owner", "staff"],
        requiredPermission: "canManageOrders",
      },
      {
        title: "Products Catalog",
        href: "/products",
        icon: Package,
        isImplemented: true,
        moduleNumber: 9,
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
      {
        title: "Godown Warehouse",
        href: "/warehouses",
        icon: Warehouse,
        isImplemented: true,
        moduleNumber: 6,
        roles: ["owner", "staff"],
        requiredPermission: "canWarehouse",
      },
    ],
  },
  {
    label: "WORKFORCE",
    items: [
      {
        title: "Staff & Drivers",
        href: "/staff",
        icon: UserCheck,
        isImplemented: true,
        moduleNumber: 11,
        roles: ["owner"],
      },
      {
        title: "Staff Salaries",
        href: "/payroll",
        icon: CreditCard,
        isImplemented: true,
        moduleNumber: 15,
        roles: ["owner"],
      },
    ],
  },
  {
    label: "FINANCE & CONTROLS",
    items: [
      {
        title: "Customer Rates (দরের তালিকা)",
        href: "/pricing",
        icon: Tag,
        isImplemented: true,
        moduleNumber: 22,
        roles: ["owner"],
      },
      {
        title: "Daily Expenses (রোজকার খরচ)",
        href: "/expenses",
        icon: FileSpreadsheet,
        isImplemented: true,
        moduleNumber: 13,
        roles: ["owner"],
      },
      {
        title: "Accounts & Ledger",
        href: "/accounting",
        icon: BookOpen,
        isImplemented: true,
        moduleNumber: 12,
        roles: ["owner"],
      },
      {
        title: "Financial Reports",
        href: "/reports",
        icon: BarChart3,
        isImplemented: true,
        moduleNumber: 18,
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

export const DRIVER_NAVIGATION = [
  { title: "Today's Route", href: "/driver", icon: Truck },
];
