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
        title: "Dashboard",
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
        title: "POS Counter",
        href: "/dashboard/pos",
        icon: ShoppingCart,
        isImplemented: true,
        moduleNumber: 4,
        roles: ["owner", "staff"],
        requiredPermission: "canPos",
      },
      {
        title: "Jar Tracking",
        href: "/dashboard/jars",
        icon: RotateCcw,
        isImplemented: true,
        moduleNumber: 10,
        roles: ["owner", "staff"],
      },
      {
        title: "Orders & Dispatch",
        href: "/dashboard/orders",
        icon: Truck,
        isImplemented: true,
        moduleNumber: 8,
        roles: ["owner", "staff"],
        requiredPermission: "canManageOrders",
      },
      {
        title: "Products",
        href: "/dashboard/products",
        icon: Package,
        isImplemented: true,
        moduleNumber: 9,
        roles: ["owner", "staff"],
      },
      {
        title: "Inventory",
        href: "/dashboard/inventory",
        icon: Boxes,
        isImplemented: true,
        moduleNumber: 5,
        roles: ["owner", "staff"],
        requiredPermission: "canWarehouse",
      },
      {
        title: "Customers",
        href: "/dashboard/customers",
        icon: Users,
        isImplemented: true,
        moduleNumber: 2,
        roles: ["owner", "staff"],
        requiredPermission: "canManageCustomers",
      },
      {
        title: "Suppliers",
        href: "/dashboard/suppliers",
        icon: Building2,
        isImplemented: true,
        moduleNumber: 3,
        roles: ["owner"],
      },
      {
        title: "Purchases",
        href: "/dashboard/purchases",
        icon: ShoppingBag,
        isImplemented: true,
        moduleNumber: 7,
        roles: ["owner"],
      },
      {
        title: "Central Warehouse",
        href: "/dashboard/warehouses",
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
        title: "Staff Management",
        href: "/dashboard/staff",
        icon: UserCheck,
        isImplemented: true,
        moduleNumber: 11,
        roles: ["owner"],
      },
      {
        title: "Staff Salaries",
        href: "/dashboard/payroll",
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
        title: "Special Pricing",
        href: "/dashboard/pricing",
        icon: Tag,
        isImplemented: true,
        moduleNumber: 22,
        roles: ["owner"],
      },
      {
        title: "Expenses",
        href: "/dashboard/expenses",
        icon: FileSpreadsheet,
        isImplemented: true,
        moduleNumber: 13,
        roles: ["owner"],
      },
      {
        title: "Accounting & Ledger",
        href: "/dashboard/accounting",
        icon: BookOpen,
        isImplemented: true,
        moduleNumber: 12,
        roles: ["owner"],
      },
      {
        title: "Financial Reports",
        href: "/dashboard/reports",
        icon: BarChart3,
        isImplemented: true,
        moduleNumber: 18,
        roles: ["owner"],
      },
      {
        title: "Business Settings",
        href: "/dashboard/settings",
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
