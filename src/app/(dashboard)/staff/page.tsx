"use client";

import * as React from "react";
import {
  ShieldCheck,
  Truck,
  Phone,
  CheckCircle2,
  XCircle,
  Key,
  CreditCard,
  Edit,
  Plus,
  UserPlus,
  Mail,
  Calendar,
  Droplets,
  RotateCcw,
  DollarSign,
  MapPin,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  UserCheck,
  AlertCircle,
} from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { StaffRecord, CreateStaffAccountInput } from "@/modules/staff/staff.schema";
import {
  getStaffMembers,
  createStaffAccount,
  updateStaffPermissions,
  updateStaffSalary,
  toggleStaffStatus,
  updateStaffPin,
} from "@/modules/staff/staff.service";
import { getOrders, executeDeliveryStop, assignOrderStaff } from "@/modules/orders/order.service";
import { OrderRecord } from "@/modules/orders/order.schema";
import { formatCurrency } from "@/lib/utils";

const STAFF_STORAGE_KEY = "aquatrack_staff_cache_v2";
const STAFF_CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL for zero-latency instant transitions

// Module-level client cache for instant staff view
let cachedStaffState: {
  staffList: StaffRecord[];
  dailyOrders: OrderRecord[];
  date: string;
  timestamp: number;
} | null = null;

function getInitialStaffData() {
  if (cachedStaffState && cachedStaffState.staffList.length > 0) {
    return cachedStaffState;
  }
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(STAFF_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed?.staffList) && parsed.staffList.length > 0) {
          cachedStaffState = parsed;
          return parsed;
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }
  return { staffList: [], dailyOrders: [], date: "" };
}

export default function StaffManagementPage() {
  const { addToast } = useToast();
  const initialData = React.useMemo(() => getInitialStaffData(), []);

  const [activeTab, setActiveTab] = React.useState<"deliveries" | "directory">("deliveries");
  const [staffList, setStaffList] = React.useState<StaffRecord[]>(() => initialData.staffList || []);
  const [isLoadingStaff, setIsLoadingStaff] = React.useState<boolean>(() => initialData.staffList.length === 0);
  const [selectedStaff, setSelectedStaff] = React.useState<StaffRecord | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);

  // Daily Deliveries Tracking State
  const [selectedDate, setSelectedDate] = React.useState<string>(() => new Date().toISOString().split("T")[0]);
  const [dailyOrders, setDailyOrders] = React.useState<OrderRecord[]>(() => initialData.dailyOrders || []);
  const [isLoadingOrders, setIsLoadingOrders] = React.useState<boolean>(() => initialData.dailyOrders.length === 0);
  const [expandedStaffIds, setExpandedStaffIds] = React.useState<Record<string, boolean>>({});

  // Direct Delivery Execution Modal State
  const [orderToDeliver, setOrderToDeliver] = React.useState<OrderRecord | null>(null);
  const [deliverStaffId, setDeliverStaffId] = React.useState<string>("");
  const [deliverQty, setDeliverQty] = React.useState<number>(1);
  const [emptyCollected, setEmptyCollected] = React.useState<number>(0);
  const [amountCollected, setAmountCollected] = React.useState<number>(0);
  const [paymentMethod, setPaymentMethod] = React.useState<"CASH" | "UPI" | "CREDIT">("CASH");
  const [deliveryNotes, setDeliveryNotes] = React.useState<string>("");
  const [isDelivering, setIsDelivering] = React.useState(false);

  // Edit Permissions & Salary form state
  const [canPos, setCanPos] = React.useState(false);
  const [canWarehouse, setCanWarehouse] = React.useState(false);
  const [canManageCustomers, setCanManageCustomers] = React.useState(false);
  const [canManageOrders, setCanManageOrders] = React.useState(false);
  const [salaryAmount, setSalaryAmount] = React.useState(18000);
  const [salaryType, setSalaryType] = React.useState<"MONTHLY" | "FIXED_PERIOD">("MONTHLY");

  // Create Staff Form state
  const [newFullName, setNewFullName] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [newPin, setNewPin] = React.useState("123456");
  const [newPhone, setNewPhone] = React.useState("");
  const [newSalary, setNewSalary] = React.useState("18000");
  const [newSalaryType, setNewSalaryType] = React.useState<"MONTHLY" | "FIXED_PERIOD">("MONTHLY");
  const [newCanPos, setNewCanPos] = React.useState(false);
  const [newCanWarehouse, setNewCanWarehouse] = React.useState(false);
  const [newCanCustomers, setNewCanCustomers] = React.useState(false);
  const [newCanOrders, setNewCanOrders] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Edit PIN Modal State
  const [editingPinStaff, setEditingPinStaff] = React.useState<StaffRecord | null>(null);
  const [editPinValue, setEditPinValue] = React.useState("");
  const [isUpdatingPin, setIsUpdatingPin] = React.useState(false);

  // Load Staff List
  const loadStaff = React.useCallback(async (forceRefresh = false) => {
    const now = Date.now();
    const hasFreshStaff =
      !forceRefresh &&
      cachedStaffState &&
      cachedStaffState.staffList.length > 0 &&
      now - (cachedStaffState.timestamp || 0) < STAFF_CACHE_TTL_MS;

    if (hasFreshStaff) {
      return;
    }

    if (!cachedStaffState || cachedStaffState.staffList.length === 0) {
      setIsLoadingStaff(true);
    }
    const res = await getStaffMembers();
    setIsLoadingStaff(false);
    if (res.success && res.data) {
      setStaffList(res.data);
      cachedStaffState = {
        staffList: res.data,
        dailyOrders: cachedStaffState?.dailyOrders || [],
        date: cachedStaffState?.date || "",
        timestamp: Date.now(),
      };
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(STAFF_STORAGE_KEY, JSON.stringify(cachedStaffState));
        } catch {}
      }
    } else {
      setStaffList([]);
    }
  }, []);

  // Load Daily Orders for Selected Date
  const loadOrdersForDate = React.useCallback(async (targetDate: string, forceRefresh = false) => {
    const now = Date.now();
    const hasFreshOrders =
      !forceRefresh &&
      cachedStaffState &&
      cachedStaffState.dailyOrders.length > 0 &&
      cachedStaffState.date === targetDate &&
      now - (cachedStaffState.timestamp || 0) < STAFF_CACHE_TTL_MS;

    if (hasFreshOrders) {
      return;
    }

    if (!cachedStaffState || cachedStaffState.dailyOrders.length === 0 || cachedStaffState.date !== targetDate) {
      setIsLoadingOrders(true);
    }
    try {
      const res = await getOrders();
      if (res.success && res.data) {
        // Match either delivery_date or created_at date
        const matched = res.data.filter(
          (o) => o.delivery_date === targetDate || (o.created_at && o.created_at.startsWith(targetDate))
        );
        setDailyOrders(matched);
        cachedStaffState = {
          staffList: cachedStaffState?.staffList || [],
          dailyOrders: matched,
          date: targetDate,
          timestamp: Date.now(),
        };
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(STAFF_STORAGE_KEY, JSON.stringify(cachedStaffState));
          } catch {}
        }
      } else {
        setDailyOrders([]);
      }
    } catch {
      setDailyOrders([]);
    } finally {
      setIsLoadingOrders(false);
    }
  }, []);

  React.useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  React.useEffect(() => {
    loadOrdersForDate(selectedDate);
  }, [selectedDate, loadOrdersForDate]);

  // Toggle expand/collapse for staff delivery history card
  const toggleStaffExpand = (staffId: string) => {
    setExpandedStaffIds((prev) => ({
      ...prev,
      [staffId]: !prev[staffId],
    }));
  };

  // Open Direct Delivery Modal
  const openDeliverModal = (order: OrderRecord, fallbackStaffId?: string) => {
    setOrderToDeliver(order);
    const assignedId = order.assigned_staff_id || fallbackStaffId || (staffList.length > 0 ? staffList[0].id : "");
    setDeliverStaffId(assignedId);
    const totalUnits = order.items && order.items.length > 0
      ? order.items.reduce((sum, i) => sum + i.quantity, 0)
      : 1;
    setDeliverQty(totalUnits);
    setEmptyCollected(totalUnits);
    setAmountCollected(Number(order.total_amount || 0));
    setPaymentMethod("CASH");
    setDeliveryNotes("");
  };

  // Confirm Direct Delivery Execution
  const handleConfirmDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderToDeliver) return;

    if (deliverQty < 0) {
      addToast({
        type: "error",
        title: "Invalid Quantity",
        message: "Delivered quantity cannot be negative.",
      });
      return;
    }

    if (emptyCollected < 0) {
      addToast({
        type: "error",
        title: "Invalid Quantity",
        message: "Collected empty jars count cannot be negative.",
      });
      return;
    }

    if (amountCollected < 0) {
      addToast({
        type: "error",
        title: "Invalid Amount",
        message: "Payment collection amount cannot be negative.",
      });
      return;
    }

    setIsDelivering(true);
    try {
      // Reassign staff if changed in delivery modal
      if (deliverStaffId && deliverStaffId !== orderToDeliver.assigned_staff_id) {
        await assignOrderStaff(orderToDeliver.id, deliverStaffId);
      }

      const res = await executeDeliveryStop({
        order_id: orderToDeliver.id,
        actual_quantity_delivered: deliverQty,
        empty_jars_collected: emptyCollected,
        damaged_jars_collected: 0,
        amount_collected: paymentMethod === "CREDIT" ? 0 : amountCollected,
        payment_method: paymentMethod,
        delivery_notes: deliveryNotes.trim() || undefined,
      });

      if (!res.success) {
        throw new Error(res.error || "Failed to mark order as delivered.");
      }

      addToast({
        type: "success",
        title: "Delivery Completed! / ডেলিভারি সম্পন্ন",
        message: `Order #${orderToDeliver.order_number} marked delivered. Customer jars & dues updated.`,
      });

      setOrderToDeliver(null);
      await loadOrdersForDate(selectedDate, true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record delivery.";
      addToast({
        type: "error",
        title: "Delivery Failed",
        message: msg,
      });
    } finally {
      setIsDelivering(false);
    }
  };

  // Staff Management Modal Openers
  const openEditModal = (staff: StaffRecord) => {
    setSelectedStaff(staff);
    setCanPos(staff.can_pos);
    setCanWarehouse(staff.can_warehouse);
    setCanManageCustomers(staff.can_manage_customers);
    setCanManageOrders(staff.can_manage_orders);
    setSalaryAmount(staff.salary_amount);
    setSalaryType(staff.salary_type);
    setIsEditModalOpen(true);
  };

  const handleSavePermissions = async () => {
    if (!selectedStaff) return;

    const permRes = await updateStaffPermissions(selectedStaff.id, {
      can_pos: canPos,
      can_warehouse: canWarehouse,
      can_manage_customers: canManageCustomers,
      can_manage_orders: canManageOrders,
    });

    const salRes = await updateStaffSalary(selectedStaff.id, salaryAmount, salaryType);

    if (permRes.success && salRes.success) {
      setStaffList((prev) =>
        prev.map((s) =>
          s.id === selectedStaff.id
            ? {
                ...s,
                can_pos: canPos,
                can_warehouse: canWarehouse,
                can_manage_customers: canManageCustomers,
                can_manage_orders: canManageOrders,
                salary_amount: salaryAmount,
                salary_type: salaryType,
              }
            : s
        )
      );

      addToast({
        type: "success",
        title: "Permissions Updated",
        message: `Updated modular access rights for ${selectedStaff.full_name}.`,
      });
      setIsEditModalOpen(false);
    } else {
      addToast({
        type: "error",
        title: "Update Failed",
        message: permRes.error || salRes.error || "Failed to update permissions.",
      });
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newFullName.trim()) {
      addToast({
        type: "error",
        title: "Name Required",
        message: "Please enter the staff member's full name.",
      });
      return;
    }

    if (newPhone.trim().length < 6) {
      addToast({
        type: "error",
        title: "Invalid Phone Number",
        message: "Phone number must be at least 6 digits (ফোন নম্বর কমপক্ষে ৬ ডিজিট হতে হবে).",
      });
      return;
    }

    if (!/^\d{6}$/.test(newPin.trim())) {
      addToast({
        type: "error",
        title: "Invalid PIN",
        message: "Staff login PIN must be exactly 6 numeric digits.",
      });
      return;
    }

    setIsSubmitting(true);

    const input: CreateStaffAccountInput = {
      full_name: newFullName.trim(),
      email: newEmail.trim() || undefined,
      password: newPassword.trim() || undefined,
      login_pin: newPin.trim(),
      phone: newPhone.trim(),
      salary_amount: Number(newSalary) || 0,
      salary_type: newSalaryType,
      can_pos: newCanPos,
      can_warehouse: newCanWarehouse,
      can_manage_customers: newCanCustomers,
      can_manage_orders: newCanOrders,
    };

    const res = await createStaffAccount(input);
    setIsSubmitting(false);

    if (res.success && res.data) {
      const created = res.data;
      setStaffList((prev) => [created, ...prev]);

      addToast({
        type: "success",
        title: "Staff Account Provisioned",
        message: `Account created for ${newFullName} with 6-digit PIN ${newPin}.`,
      });
      setIsCreateModalOpen(false);
      // Reset form
      setNewFullName("");
      setNewEmail("");
      setNewPassword("");
      setNewPin("123456");
      setNewPhone("");
      setNewSalary("18000");
      setNewCanPos(false);
      setNewCanWarehouse(false);
      setNewCanCustomers(false);
      setNewCanOrders(true);
      loadStaff(true);
    } else {
      addToast({
        type: "error",
        title: "Failed to Create Staff",
        message: res.error || "An error occurred while provisioning account.",
      });
    }
  };

  const handleUpdatePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPinStaff) return;
    if (!/^\d{6}$/.test(editPinValue.trim())) {
      addToast({
        type: "error",
        title: "Invalid PIN",
        message: "PIN must be exactly 6 numeric digits.",
      });
      return;
    }
    setIsUpdatingPin(true);
    const res = await updateStaffPin(editingPinStaff.id, editPinValue.trim());
    setIsUpdatingPin(false);
    if (res.success) {
      setStaffList((prev) =>
        prev.map((s) => (s.id === editingPinStaff.id ? { ...s, login_pin: editPinValue.trim() } : s))
      );
      addToast({
        type: "success",
        title: "PIN Updated",
        message: `6-digit login PIN for ${editingPinStaff.full_name} updated successfully.`,
      });
      setEditingPinStaff(null);
    } else {
      addToast({
        type: "error",
        title: "Failed to Update PIN",
        message: res.error || "Could not update PIN.",
      });
    }
  };

  const handleToggleActive = async (staff: StaffRecord) => {
    const nextState = !staff.is_active;
    const res = await toggleStaffStatus(staff.id, nextState);
    if (res.success) {
      setStaffList((prev) =>
        prev.map((s) => (s.id === staff.id ? { ...s, is_active: nextState } : s))
      );
      addToast({
        type: "info",
        title: nextState ? "Staff Activated" : "Staff Deactivated",
        message: `${staff.full_name} is now ${nextState ? "active" : "deactivated"}.`,
      });
    } else {
      addToast({
        type: "error",
        title: "Action Failed",
        message: res.error || "Could not toggle status.",
      });
    }
  };

  // Daily Deliveries Aggregation
  const activeStaffMembers = React.useMemo(() => {
    return staffList.filter((s) => s.is_active !== false);
  }, [staffList]);

  const dailyTotalOrders = dailyOrders.length;
  const dailyDeliveredOrders = dailyOrders.filter((o) => o.status === "DELIVERED");
  const dailyTotalJarsDelivered = dailyDeliveredOrders.reduce((sum, o) => {
    return sum + (o.actual_quantity_delivered || o.items.reduce((s, i) => s + i.quantity, 0));
  }, 0);
  const dailyTotalEmptyCollected = dailyDeliveredOrders.reduce((sum, o) => {
    return sum + (o.empty_jars_collected || 0);
  }, 0);
  const dailyTotalCashCollected = dailyDeliveredOrders.reduce((sum, o) => {
    return sum + Number(o.amount_paid || 0);
  }, 0);

  // Group daily orders by staff
  const staffOrdersMap = React.useMemo(() => {
    const map = new Map<string, OrderRecord[]>();
    // Initialize active staff with empty list
    activeStaffMembers.forEach((s) => map.set(s.id, []));
    map.set("unassigned", []);

    dailyOrders.forEach((o) => {
      const key = o.assigned_staff_id && map.has(o.assigned_staff_id) ? o.assigned_staff_id : "unassigned";
      const existing = map.get(key) || [];
      existing.push(o);
      map.set(key, existing);
    });

    return map;
  }, [activeStaffMembers, dailyOrders]);

  const unassignedOrders = staffOrdersMap.get("unassigned") || [];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
              Staff & Daily Deliveries (স্টাফ ও দৈনিক ডেলিভারি)
            </h1>
            <Badge variant="primary" className="text-xs font-bold">
              Fleet Delivery
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Track daily customer stops, jars delivered, empty containers collected, and money collected per staff member.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setIsCreateModalOpen(true)}
            className="gap-1.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-bold shadow-xs active:scale-95"
          >
            <UserPlus className="h-4 w-4" />
            <span>+ Add Staff Member</span>
          </Button>
        </div>
      </div>

      {/* Main Tab Switcher */}
      <div className="flex items-center gap-2 p-1 rounded-2xl bg-muted/50 border border-border w-fit select-none">
        <button
          type="button"
          onClick={() => setActiveTab("deliveries")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer active:scale-95 ${
            activeTab === "deliveries"
              ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/25"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Truck className="h-4 w-4" />
          <span>Daily Deliveries & Stops (দৈনিক ডেলিভারি)</span>
          {dailyOrders.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20 text-white font-mono">
              {dailyOrders.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("directory")}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer active:scale-95 ${
            activeTab === "directory"
              ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/25"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <UserCheck className="h-4 w-4" />
          <span>Staff Accounts & Access (স্টাফ তালিকা)</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground font-mono">
            {staffList.length}
          </span>
        </button>
      </div>

      {/* =========================================================================
          TAB 1: DAILY DELIVERIES & STOPS TRACKER
          ========================================================================= */}
      {activeTab === "deliveries" && (
        <div className="space-y-6">
          {/* Date Selector & Action Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-card border border-border shadow-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-primary" />
                Select Date (তারিখ):
              </span>

              <button
                type="button"
                onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                  selectedDate === new Date().toISOString().split("T")[0]
                    ? "bg-primary text-white border-primary shadow-xs"
                    : "bg-muted/40 text-foreground border-border hover:bg-muted"
                }`}
              >
                Today (আজ)
              </button>

              <button
                type="button"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 1);
                  setSelectedDate(d.toISOString().split("T")[0]);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                  selectedDate ===
                  new Date(Date.now() - 86400000).toISOString().split("T")[0]
                    ? "bg-primary text-white border-primary shadow-xs"
                    : "bg-muted/40 text-foreground border-border hover:bg-muted"
                }`}
              >
                Yesterday (গতকাল)
              </button>

              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-8 text-xs w-36 font-semibold"
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => loadOrdersForDate(selectedDate, true)}
              disabled={isLoadingOrders}
              className="gap-1.5 text-xs font-bold"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingOrders ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>

          {/* Daily Aggregate KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Tile 1: Total Completed Deliveries */}
            <div className="p-4 rounded-2xl border-2 border-sky-400 dark:border-sky-500/50 bg-gradient-to-br from-sky-500/15 via-blue-500/10 to-indigo-500/15 dark:from-sky-950/40 dark:via-blue-950/30 dark:to-indigo-950/40 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-sky-900 dark:text-sky-300">
                  ডেলিভারি সম্পন্ন (Done)
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500 text-white shadow-md shadow-sky-500/30">
                  <Truck className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-2.5">
                <span className="text-2xl sm:text-3xl font-black text-sky-800 dark:text-sky-200 block">
                  {dailyDeliveredOrders.length}{" "}
                  <span className="text-xs font-bold text-sky-700/80 dark:text-sky-400">/ {dailyTotalOrders} Orders</span>
                </span>
                <span className="text-[11px] text-sky-800 dark:text-sky-300 font-bold block mt-0.5">
                  {dailyTotalOrders > 0
                    ? `${Math.round((dailyDeliveredOrders.length / dailyTotalOrders) * 100)}% route completed`
                    : "No orders scheduled"}
                </span>
              </div>
            </div>

            {/* Tile 2: Full Jars Dropped */}
            <div className="p-4 rounded-2xl border-2 border-emerald-400 dark:border-emerald-500/50 bg-gradient-to-br from-emerald-500/15 via-teal-500/10 to-emerald-500/15 dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-emerald-950/40 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-emerald-900 dark:text-emerald-300">
                  ভরা জার দেওয়া হয়েছে (Full)
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-md shadow-emerald-500/30">
                  <Droplets className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-2.5">
                <span className="text-2xl sm:text-3xl font-black text-emerald-800 dark:text-emerald-200 block">
                  {dailyTotalJarsDelivered}{" "}
                  <span className="text-xs font-bold text-emerald-700/80 dark:text-emerald-400">Jars</span>
                </span>
                <span className="text-[11px] text-emerald-800 dark:text-emerald-300 font-bold block mt-0.5">
                  Customer custody added
                </span>
              </div>
            </div>

            {/* Tile 3: Empty Jars Collected */}
            <div className="p-4 rounded-2xl border-2 border-amber-400 dark:border-amber-500/50 bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-amber-500/15 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-amber-950/40 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-300">
                  খালি জার ফেরত (Empties)
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white shadow-md shadow-amber-500/30">
                  <RotateCcw className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-2.5">
                <span className="text-2xl sm:text-3xl font-black text-amber-800 dark:text-amber-200 block">
                  {dailyTotalEmptyCollected}{" "}
                  <span className="text-xs font-bold text-amber-700/80 dark:text-amber-400">Empties</span>
                </span>
                <span className="text-[11px] text-amber-800 dark:text-amber-300 font-bold block mt-0.5">
                  Collected for washing
                </span>
              </div>
            </div>

            {/* Tile 4: Total Payment Collected */}
            <div className="p-4 rounded-2xl border-2 border-purple-400 dark:border-purple-500/50 bg-gradient-to-br from-purple-500/15 via-violet-500/10 to-indigo-500/15 dark:from-purple-950/40 dark:via-violet-950/30 dark:to-indigo-950/40 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-purple-900 dark:text-purple-300">
                  মোট টাকা আদায় (Cash & UPI)
                </span>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500 text-white shadow-md shadow-purple-500/30">
                  <DollarSign className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-2.5">
                <span className="text-2xl sm:text-3xl font-black text-purple-800 dark:text-purple-200 block">
                  {formatCurrency(dailyTotalCashCollected)}
                </span>
                <span className="text-[11px] text-purple-800 dark:text-purple-300 font-bold block mt-0.5">
                  Driver settlement balance
                </span>
              </div>
            </div>
          </div>

          {/* Unassigned Orders Warning Banner (if any) */}
          {unassignedOrders.length > 0 && (
            <div className="p-4 rounded-2xl border-2 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs sm:text-sm font-extrabold text-amber-950 dark:text-amber-300">
                    {unassignedOrders.length} Order(s) Need Staff Assignment (স্টাফ দেওয়া বাকি আছে)
                  </span>
                </div>
                <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-800 dark:text-amber-300 font-bold bg-amber-100 dark:bg-amber-900/40">
                  Unassigned Pool
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {unassignedOrders.map((o) => (
                  <div key={o.id} className="p-3 rounded-xl bg-card border border-border text-xs space-y-1.5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-foreground">#{o.order_number}</span>
                      <span className="font-bold text-primary">{formatCurrency(o.total_amount)}</span>
                    </div>
                    <p className="font-bold text-foreground truncate">{o.customer_name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{o.delivery_address}</p>
                    <div className="pt-1 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground font-semibold">
                        {o.items.reduce((s, i) => s + i.quantity, 0)} Jars
                      </span>
                      <Button
                        size="sm"
                        onClick={() => openDeliverModal(o)}
                        className="h-6 px-2 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        Assign & Deliver ›
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Individual Staff Delivery Breakdown Cards */}
          {isLoadingOrders ? (
            <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
              <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              <span>Loading daily staff deliveries...</span>
            </div>
          ) : activeStaffMembers.length === 0 ? (
            <div className="p-8 text-center rounded-2xl border border-dashed border-border text-xs text-muted-foreground space-y-2">
              <p className="font-bold text-foreground text-sm">No Active Staff Members</p>
              <p>Add staff accounts to assign orders and track doorstep deliveries.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                  Active Delivery Staff Execution ({activeStaffMembers.length})
                </span>
                <span className="text-xs text-muted-foreground">
                  Date: {selectedDate}
                </span>
              </div>

              {activeStaffMembers.map((staff, idx) => {
                const staffOrders = staffOrdersMap.get(staff.id) || [];
                const deliveredCount = staffOrders.filter((o) => o.status === "DELIVERED").length;
                const totalJars = staffOrders.filter((o) => o.status === "DELIVERED").reduce((sum, o) => {
                  return sum + (o.actual_quantity_delivered || o.items.reduce((s, i) => s + i.quantity, 0));
                }, 0);
                const totalEmpties = staffOrders.filter((o) => o.status === "DELIVERED").reduce((sum, o) => {
                  return sum + (o.empty_jars_collected || 0);
                }, 0);
                const totalCollected = staffOrders.filter((o) => o.status === "DELIVERED").reduce((sum, o) => {
                  return sum + Number(o.amount_paid || 0);
                }, 0);

                const isExpanded = expandedStaffIds[staff.id] ?? (staffOrders.length > 0);

                return (
                  <Card
                    key={staff.id}
                    className="border-2 border-border shadow-xs overflow-hidden transition-all bg-card"
                  >
                    {/* Staff Summary Header */}
                    <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white font-black text-base shadow-sm shadow-sky-500/30">
                          {staff.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-extrabold text-base text-foreground">
                              {staff.full_name}
                            </h3>
                            <Badge variant="outline" className="text-[10px] font-bold border-sky-300 dark:border-sky-500/40 text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40">
                              Staff #{idx + 1}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                            <a href={`tel:${staff.phone}`} className="hover:text-primary flex items-center gap-1 font-mono">
                              <Phone className="h-3 w-3 text-primary" />
                              {staff.phone}
                            </a>
                            {staff.email && <span>• {staff.email}</span>}
                          </p>
                        </div>
                      </div>

                      {/* Staff Performance Tally Badges */}
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <div className="px-3.5 py-2 rounded-2xl bg-sky-500/15 dark:bg-sky-950/50 border-2 border-sky-400 dark:border-sky-500/50 text-center min-w-[78px] shadow-2xs">
                          <span className="text-[9px] uppercase font-black tracking-wider text-sky-800 dark:text-sky-300 block">ডেলিভারি</span>
                          <span className="text-xs sm:text-sm font-black text-sky-900 dark:text-sky-200">
                            {deliveredCount} / {staffOrders.length}
                          </span>
                        </div>

                        <div className="px-3.5 py-2 rounded-2xl bg-emerald-500/15 dark:bg-emerald-950/50 border-2 border-emerald-400 dark:border-emerald-500/50 text-center min-w-[78px] shadow-2xs">
                          <span className="text-[9px] uppercase font-black tracking-wider text-emerald-800 dark:text-emerald-300 block">ভরা জার</span>
                          <span className="text-xs sm:text-sm font-black text-emerald-900 dark:text-emerald-200">
                            {totalJars} 💧
                          </span>
                        </div>

                        <div className="px-3.5 py-2 rounded-2xl bg-amber-500/15 dark:bg-amber-950/50 border-2 border-amber-400 dark:border-amber-500/50 text-center min-w-[78px] shadow-2xs">
                          <span className="text-[9px] uppercase font-black tracking-wider text-amber-800 dark:text-amber-300 block">খালি জার</span>
                          <span className="text-xs sm:text-sm font-black text-amber-900 dark:text-amber-200">
                            {totalEmpties} 🔄
                          </span>
                        </div>

                        <div className="px-3.5 py-2 rounded-2xl bg-purple-500/15 dark:bg-purple-950/50 border-2 border-purple-400 dark:border-purple-500/50 text-center min-w-[90px] shadow-2xs">
                          <span className="text-[9px] uppercase font-black tracking-wider text-purple-800 dark:text-purple-300 block">মোট টাকা</span>
                          <span className="text-xs sm:text-sm font-black text-purple-900 dark:text-purple-200">
                            {formatCurrency(totalCollected)}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleStaffExpand(staff.id)}
                          className="h-10 w-10 flex items-center justify-center rounded-2xl bg-muted hover:bg-muted/80 text-foreground cursor-pointer transition-colors active:scale-95 border border-border"
                          title={isExpanded ? "Collapse stops" : "Expand stops"}
                        >
                          {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Stops Ledger for this Staff */}
                    {isExpanded && (
                      <div className="p-4 sm:p-5 bg-muted/30 space-y-3.5 animate-in fade-in-50 duration-150">
                        <div className="flex items-center justify-between">
                          <span className="text-xs sm:text-sm font-extrabold text-foreground flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-primary" />
                            {staff.full_name}-এর আজকের ডেলিভারি স্টপ ({staffOrders.length} Stops)
                          </span>
                          <Badge variant="outline" className="text-xs font-bold font-mono">
                            {deliveredCount} সম্পন্ন • {staffOrders.length - deliveredCount} বাকি
                          </Badge>
                        </div>

                        {staffOrders.length === 0 ? (
                          <div className="p-8 text-center rounded-2xl bg-card border-2 border-dashed border-border text-xs text-muted-foreground">
                            {selectedDate}-এ {staff.full_name}-কে কোন ডেলিভারি অর্ডার দেওয়া হয়নি।
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            {staffOrders.map((order, stopIdx) => {
                              const isDelivered = order.status === "DELIVERED";
                              const orderJars = order.items.reduce((sum, i) => sum + i.quantity, 0);

                              return (
                                <div
                                  key={order.id}
                                  className={`p-4 rounded-3xl border-2 transition-all space-y-3 shadow-xs ${
                                    isDelivered
                                      ? "bg-card border-emerald-400/80 dark:border-emerald-500/50 hover:border-emerald-500"
                                      : "bg-card border-amber-400 dark:border-amber-500/60 hover:border-amber-500 shadow-md"
                                  }`}
                                >
                                  {/* Stop Header */}
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground font-black text-xs">
                                        {stopIdx + 1}
                                      </span>
                                      <span className="font-mono font-black text-xs text-foreground">
                                        #{order.order_number}
                                      </span>
                                    </div>

                                    <Badge
                                      variant={isDelivered ? "success" : "warning"}
                                      className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5"
                                    >
                                      {isDelivered ? "ডেলিভারি সম্পন্ন ✓" : "বাকি আছে (Pending)"}
                                    </Badge>
                                  </div>

                                  {/* Customer Info Card */}
                                  <div className="space-y-1">
                                    <h4 className="font-black text-base text-foreground leading-snug">
                                      {order.customer_name}
                                    </h4>
                                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                      <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                                      <span className="line-clamp-1">{order.delivery_address}</span>
                                    </p>
                                    {order.customer_phone && (
                                      <div className="pt-1">
                                        <a
                                          href={`tel:${order.customer_phone}`}
                                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-xs font-bold hover:underline"
                                        >
                                          <Phone className="h-3 w-3" />
                                          কল করুন: {order.customer_phone}
                                        </a>
                                      </div>
                                    )}
                                  </div>

                                  {/* Order Items & Tally 3-Grid */}
                                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-2xl bg-muted/40 border border-border/60 text-center">
                                    <div className="p-1 rounded-xl bg-blue-500/10">
                                      <span className="text-[9px] uppercase font-bold text-blue-800 dark:text-blue-300 block">ভরা জার</span>
                                      <span className="text-xs sm:text-sm font-black text-blue-700 dark:text-blue-300">
                                        {orderJars} 💧
                                      </span>
                                    </div>
                                    <div className="p-1 rounded-xl bg-amber-500/10">
                                      <span className="text-[9px] uppercase font-bold text-amber-800 dark:text-amber-300 block">খালি জার</span>
                                      <span className="text-xs sm:text-sm font-black text-amber-700 dark:text-amber-300">
                                        {order.empty_jars_collected ?? 0} 🔄
                                      </span>
                                    </div>
                                    <div className="p-1 rounded-xl bg-emerald-500/10">
                                      <span className="text-[9px] uppercase font-bold text-emerald-800 dark:text-emerald-300 block">টাকা</span>
                                      <span className="text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-300">
                                        {formatCurrency(order.total_amount)}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Action button if pending */}
                                  {!isDelivered ? (
                                    <div className="pt-1">
                                      <Button
                                        size="sm"
                                        onClick={() => openDeliverModal(order, staff.id)}
                                        className="w-full h-9 text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl shadow-md active:scale-95"
                                      >
                                        <CheckCircle2 className="h-4 w-4 mr-1.5" />
                                        ডেলিভারি কনফার্ম করুন (Mark Delivered)
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="pt-1 flex items-center justify-between text-[11px] text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-500/10 px-3 py-1.5 rounded-xl">
                                      <span className="flex items-center gap-1">
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        ডেলিভারি দেওয়া হয়েছে
                                      </span>
                                      <span>আদায়: {formatCurrency(order.amount_paid || 0)}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 2: STAFF DIRECTORY, SALARY & PERMISSIONS
          ========================================================================= */}
      {activeTab === "directory" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              System Staff Accounts ({staffList.length})
            </span>
            <Button
              size="sm"
              onClick={() => setIsCreateModalOpen(true)}
              className="gap-1.5 text-xs font-bold"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Add Staff Member
            </Button>
          </div>

          {isLoadingStaff ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              Loading staff accounts...
            </div>
          ) : staffList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center space-y-3">
              <p className="text-sm font-semibold text-foreground">No Staff Accounts Provisioned Yet</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Click &ldquo;Add Staff Member&rdquo; to create Supabase login credentials for delivery drivers and counter staff.
              </p>
              <Button size="sm" onClick={() => setIsCreateModalOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Provision First Staff Account
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {staffList.map((staff) => {
                const isOwner = staff.role === "owner";

                return (
                  <Card
                    key={staff.id}
                    className={`border-border shadow-xs transition-all ${
                      isOwner ? "border-primary/40 bg-primary/5" : "bg-card"
                    } ${!staff.is_active ? "opacity-60" : ""}`}
                  >
                    <CardHeader className="p-5 pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={isOwner ? "primary" : "secondary"}
                              className="text-[10px] font-bold uppercase tracking-wider"
                            >
                              {isOwner ? "Full Owner" : "Operational Staff"}
                            </Badge>
                            {!staff.is_active && (
                              <Badge variant="destructive" className="text-[10px]">
                                Deactivated
                              </Badge>
                            )}
                          </div>
                          <h3 className="text-base font-bold text-foreground">
                            {staff.full_name}
                          </h3>
                        </div>

                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          {isOwner ? <ShieldCheck className="h-5 w-5 text-primary" /> : <Truck className="h-4 w-4" />}
                        </span>
                      </div>
                    </CardHeader>

                    <CardContent className="p-5 pt-0 space-y-4">
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p className="flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-primary" />
                          {staff.phone}
                        </p>
                        {staff.email && (
                          <p className="flex items-center gap-1.5 truncate">
                            <Mail className="h-3.5 w-3.5 text-primary" />
                            {staff.email}
                          </p>
                        )}
                        {!isOwner && (
                          <p className="flex items-center gap-1.5 text-foreground font-semibold">
                            <CreditCard className="h-3.5 w-3.5 text-emerald-500" />
                            Salary: {formatCurrency(staff.salary_amount)} / {staff.salary_type.toLowerCase()}
                          </p>
                        )}
                      </div>

                      {/* Staff Login PIN Card */}
                      {!isOwner && (
                        <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs">
                          <div className="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
                            <Key className="h-3.5 w-3.5" />
                            <span>Staff Login PIN:</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-xs sm:text-sm tracking-widest px-2 py-0.5 rounded-lg bg-card border border-border">
                              {staff.login_pin || "123456"}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPinStaff(staff);
                                setEditPinValue(staff.login_pin || "123456");
                              }}
                              className="text-[11px] font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400 cursor-pointer"
                            >
                              Change PIN
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Modular Permissions Matrix */}
                      <div className="space-y-2 pt-2 border-t border-border/60">
                        <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                          <span className="flex items-center gap-1.5">
                            <Key className="h-3.5 w-3.5 text-primary" />
                            Module Access Rights
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5">
                            {isOwner || staff.can_pos ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                            )}
                            <span className={isOwner || staff.can_pos ? "text-foreground font-medium" : "text-muted-foreground"}>
                              POS Counter
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isOwner || staff.can_warehouse ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                            )}
                            <span className={isOwner || staff.can_warehouse ? "text-foreground font-medium" : "text-muted-foreground"}>
                              Warehouse & Stock
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isOwner || staff.can_manage_customers ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                            )}
                            <span className={isOwner || staff.can_manage_customers ? "text-foreground font-medium" : "text-muted-foreground"}>
                              Customers
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isOwner || staff.can_manage_orders ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                            )}
                            <span className={isOwner || staff.can_manage_orders ? "text-foreground font-medium" : "text-muted-foreground"}>
                              Orders & Dispatch
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      {!isOwner && (
                        <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditModal(staff)}
                            className="h-8 text-xs gap-1.5"
                          >
                            <Edit className="h-3.5 w-3.5" />
                            Edit Access & Salary
                          </Button>

                          <Button
                            variant={staff.is_active ? "ghost" : "outline"}
                            size="sm"
                            onClick={() => handleToggleActive(staff)}
                            className={`h-8 text-xs ${
                              staff.is_active ? "text-rose-500 hover:text-rose-600" : "text-emerald-600"
                            }`}
                          >
                            {staff.is_active ? "Deactivate" : "Activate"}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* DIRECT DELIVERY CONFIRMATION MODAL */}
      <Dialog
        isOpen={Boolean(orderToDeliver)}
        onClose={() => !isDelivering && setOrderToDeliver(null)}
        className="max-w-md"
      >
        {orderToDeliver && (
          <form onSubmit={handleConfirmDelivery} className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  Mark Order Delivered (ডেলিভারি সম্পন্ন)
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Order #{orderToDeliver.order_number} • {orderToDeliver.customer_name}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-muted/40 border border-border text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="font-bold text-foreground">{orderToDeliver.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phone:</span>
                  <span className="font-mono text-foreground">{orderToDeliver.customer_phone || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Address:</span>
                  <span className="text-foreground text-right max-w-[200px] truncate">{orderToDeliver.delivery_address}</span>
                </div>
              </div>

              {/* Staff Selector */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Delivered by Staff *
                </label>
                <select
                  value={deliverStaffId}
                  onChange={(e) => setDeliverStaffId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground font-semibold"
                  required
                >
                  <option value="">-- Choose Staff Member --</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quantity Delivered & Empty Jars Collected with Large Steppers & Quick Chips */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Full Jars Delivered */}
                <div className="p-3 rounded-2xl bg-sky-50/50 dark:bg-sky-950/20 border-2 border-sky-200 dark:border-sky-800/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-foreground flex items-center gap-1.5">
                      <span className="text-base">💧</span>
                      <span>Full Jars Delivered *</span>
                    </label>
                    <span className="text-[10px] text-sky-700 dark:text-sky-300 font-bold">ভরা জার দিয়েছেন</span>
                  </div>

                  <div className="flex items-center justify-between bg-card dark:bg-slate-900 border border-sky-300 dark:border-sky-800 rounded-xl p-1 shadow-xs">
                    <button
                      type="button"
                      onClick={() => setDeliverQty(Math.max(0, deliverQty - 1))}
                      className="h-9 w-9 rounded-lg bg-muted hover:bg-muted/80 text-foreground flex items-center justify-center font-black text-lg active:scale-95 cursor-pointer"
                    >
                      -
                    </button>
                    <div className="text-center">
                      <span className="text-lg font-black text-foreground">{deliverQty}</span>
                      <span className="text-[10px] text-muted-foreground block -mt-1">Full Jars</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeliverQty(deliverQty + 1)}
                      className="h-9 w-9 rounded-lg bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center font-black text-lg shadow-xs active:scale-95 cursor-pointer"
                    >
                      +
                    </button>
                  </div>

                  <div className="flex items-center gap-1 flex-wrap pt-0.5">
                    {[1, 2, 5, 10, 15, 20].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDeliverQty(preset)}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all cursor-pointer active:scale-95 ${
                          deliverQty === preset
                            ? "bg-sky-500 text-white border-sky-400 shadow-xs"
                            : "bg-card text-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                    {Boolean(orderToDeliver.items && orderToDeliver.items.length > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          const totalQ = orderToDeliver.items.reduce((s, it) => s + (it.quantity || 0), 0);
                          setDeliverQty(totalQ);
                        }}
                        className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 cursor-pointer"
                      >
                        Full ({orderToDeliver.items.reduce((s, it) => s + (it.quantity || 0), 0)})
                      </button>
                    )}
                  </div>
                </div>

                {/* Empty Jars Collected */}
                <div className="p-3 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border-2 border-emerald-200 dark:border-emerald-800/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-foreground flex items-center gap-1.5">
                      <span className="text-base">🔄</span>
                      <span>Empty Jars Collected</span>
                    </label>
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold">খালি জার ফেরত</span>
                  </div>

                  <div className="flex items-center justify-between bg-card dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 rounded-xl p-1 shadow-xs">
                    <button
                      type="button"
                      onClick={() => setEmptyCollected(Math.max(0, emptyCollected - 1))}
                      className="h-9 w-9 rounded-lg bg-muted hover:bg-muted/80 text-foreground flex items-center justify-center font-black text-lg active:scale-95 cursor-pointer"
                    >
                      -
                    </button>
                    <div className="text-center">
                      <span className="text-lg font-black text-foreground">{emptyCollected}</span>
                      <span className="text-[10px] text-muted-foreground block -mt-1">Empty Jars</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEmptyCollected(emptyCollected + 1)}
                      className="h-9 w-9 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center font-black text-lg shadow-xs active:scale-95 cursor-pointer"
                    >
                      +
                    </button>
                  </div>

                  <div className="flex items-center gap-1 flex-wrap pt-0.5">
                    {[0, 1, 2, 5, 10, 15].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setEmptyCollected(preset)}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all cursor-pointer active:scale-95 ${
                          emptyCollected === preset
                            ? "bg-emerald-500 text-white border-emerald-400 shadow-xs"
                            : "bg-card text-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setEmptyCollected(deliverQty)}
                      className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/30 hover:bg-sky-500/20 cursor-pointer"
                    >
                      = Same ({deliverQty})
                    </button>
                  </div>
                </div>
              </div>

              {/* Payment Mode & Amount Collected */}
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-emerald-500" />
                  <span>Payment Collection (টাকা আদায়)</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["CASH", "UPI", "CREDIT"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setPaymentMethod(m);
                        if (m === "CASH" || m === "UPI") {
                          setAmountCollected(orderToDeliver.total_amount);
                        } else {
                          setAmountCollected(0);
                        }
                      }}
                      className={`p-2.5 rounded-xl text-xs font-black border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 ${
                        paymentMethod === m
                          ? m === "CASH"
                            ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-400 shadow-sm"
                            : m === "UPI"
                            ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white border-sky-400 shadow-sm"
                            : "bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-400 shadow-sm"
                          : "bg-card text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      <span className="text-base">{m === "CASH" ? "💵" : m === "UPI" ? "📱" : "⏳"}</span>
                      <span>{m === "CASH" ? "Cash (নগদ)" : m === "UPI" ? "Online UPI" : "Credit (বাকি)"}</span>
                    </button>
                  ))}
                </div>

                {paymentMethod !== "CREDIT" && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-2 text-xs font-bold text-muted-foreground">₹</span>
                        <Input
                          type="number"
                          min={0}
                          value={amountCollected}
                          onChange={(e) => setAmountCollected(parseFloat(e.target.value) || 0)}
                          placeholder={`Amount (₹${orderToDeliver.total_amount})`}
                          className="text-sm font-black pl-7"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setAmountCollected(orderToDeliver.total_amount)}
                        className="px-3 py-2 rounded-xl text-xs font-bold bg-muted hover:bg-muted/80 text-foreground border border-border cursor-pointer active:scale-95"
                      >
                        Exact ₹{orderToDeliver.total_amount}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Delivery Notes */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Notes (ঐচ্ছিক মন্তব্য)
                </label>
                <Input
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  placeholder="e.g. Delivered to reception, empty jars collected"
                  className="text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOrderToDeliver(null)}
                disabled={isDelivering}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isDelivering}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold"
              >
                {isDelivering ? "Recording..." : "Confirm Delivery (ডেলিভারি কনফার্ম)"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Modal 1: Create New Staff Member */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Provision New Staff Account
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Creates Supabase login credentials and initializes permissions.
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateStaff} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">Full Name *</label>
                    <span className="text-[10px] text-muted-foreground">Min. 2 characters</span>
                  </div>
                  <Input
                    placeholder="e.g. Ramesh Kumar"
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    required
                    className="text-xs"
                  />
                  {newFullName.trim().length > 0 && newFullName.trim().length < 2 && (
                    <span className="text-[10px] text-amber-500 font-medium block">
                      ⚠️ Name must be at least 2 characters
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">Phone Number *</label>
                    <span className="text-[10px] text-muted-foreground">Min. 6 digits</span>
                  </div>
                  <Input
                    placeholder="e.g. 9845012345 or 676878"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    required
                    className="text-xs"
                  />
                  {newPhone.trim().length > 0 && newPhone.trim().length < 6 && (
                    <span className="text-[10px] text-amber-500 font-medium block">
                      ⚠️ Needs at least 6 digits ({newPhone.trim().length}/6)
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-foreground flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 text-amber-500" />
                      <span>6-Digit Login PIN *</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const randomPin = Math.floor(100000 + Math.random() * 900000).toString();
                        setNewPin(randomPin);
                      }}
                      className="text-[10px] font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400 cursor-pointer"
                    >
                      🎲 Generate PIN
                    </button>
                  </div>
                  <Input
                    placeholder="e.g. 123456"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                    maxLength={6}
                    className="text-xs font-mono font-bold tracking-widest text-center"
                  />
                  {newPin.trim().length > 0 && newPin.trim().length < 6 ? (
                    <span className="text-[10px] text-amber-500 font-medium block">
                      ⚠️ PIN must be exactly 6 digits ({newPin.trim().length}/6)
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground block">
                      Staff logs in by selecting their name and this 6-digit PIN.
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Login Email (Optional)</label>
                  <div className="relative">
                    <Mail className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="Leave blank for auto-generated"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="pl-8 text-xs"
                    />
                  </div>
                  {newEmail.trim().length > 0 && !newEmail.includes("@") ? (
                    <span className="text-[10px] text-amber-500 font-medium block">
                      ⚠️ Please enter a valid email address (e.g. name@domain.com)
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground block">
                      Auto-defaults to phone if empty.
                    </span>
                  )}
                </div>
              </div>

              {/* Salary Configuration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/60">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Starting Monthly Salary (₹)</label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="18000"
                    value={newSalary}
                    onChange={(e) => setNewSalary(e.target.value)}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Salary Frequency</label>
                  <select
                    value={newSalaryType}
                    onChange={(e) => setNewSalaryType(e.target.value as "MONTHLY" | "FIXED_PERIOD")}
                    className="w-full rounded-md border border-border bg-background p-2 text-xs text-foreground"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="FIXED_PERIOD">Fixed Period</option>
                  </select>
                </div>
              </div>

              {/* Modular Permissions Assignment */}
              <div className="space-y-2 pt-2 border-t border-border/60">
                <label className="text-xs font-semibold text-foreground block">
                  Assign Module Permissions
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newCanOrders}
                      onChange={(e) => setNewCanOrders(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>Orders & Deliveries</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newCanPos}
                      onChange={(e) => setNewCanPos(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>POS Counter</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newCanCustomers}
                      onChange={(e) => setNewCanCustomers(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>Manage Customers</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newCanWarehouse}
                      onChange={(e) => setNewCanWarehouse(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>Warehouse Stock</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isSubmitting} className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  {isSubmitting ? "Provisioning..." : "Create Staff Account"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Edit Access Rights & Salary */}
      {isEditModalOpen && selectedStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Edit Access & Compensation
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Update rights and salary for {selectedStaff.full_name}
                </p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-2">
                <label className="font-semibold text-foreground block">
                  Permissions Matrix
                </label>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canManageOrders}
                      onChange={(e) => setCanManageOrders(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <div>
                      <span className="font-semibold block text-foreground">Orders & Deliveries</span>
                      <span className="text-[10px] text-muted-foreground">Deliver orders, collect empty jars</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canPos}
                      onChange={(e) => setCanPos(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <div>
                      <span className="font-semibold block text-foreground">POS Counter Sale</span>
                      <span className="text-[10px] text-muted-foreground">Cash/UPI sales at water shop</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canWarehouse}
                      onChange={(e) => setCanWarehouse(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <div>
                      <span className="font-semibold block text-foreground">Warehouse & Godown</span>
                      <span className="text-[10px] text-muted-foreground">Stock receipts, scrap & washing cycle</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canManageCustomers}
                      onChange={(e) => setCanManageCustomers(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <div>
                      <span className="font-semibold block text-foreground">Customers & Khata</span>
                      <span className="text-[10px] text-muted-foreground">Create accounts & edit special prices</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Salary Configuration */}
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="font-semibold text-foreground block">
                  Salary & Remuneration
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Amount (₹)</span>
                    <Input
                      type="number"
                      min="0"
                      value={salaryAmount}
                      onChange={(e) => setSalaryAmount(Number(e.target.value) || 0)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">Type</span>
                    <select
                      value={salaryType}
                      onChange={(e) => setSalaryType(e.target.value as "MONTHLY" | "FIXED_PERIOD")}
                      className="w-full rounded-md border border-border bg-background p-2 text-xs text-foreground"
                    >
                      <option value="MONTHLY">Monthly</option>
                      <option value="FIXED_PERIOD">Fixed Period</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditModalOpen(false)}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSavePermissions}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Edit 6-Digit Staff PIN */}
      {editingPinStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Key className="h-4 w-4 text-amber-500" />
                  <span>Update Staff Login PIN</span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Set 6-digit login PIN for {editingPinStaff.full_name}
                </p>
              </div>
              <button
                onClick={() => setEditingPinStaff(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdatePin} className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">6-Digit PIN *</label>
                  <button
                    type="button"
                    onClick={() => {
                      const randomPin = Math.floor(100000 + Math.random() * 900000).toString();
                      setEditPinValue(randomPin);
                    }}
                    className="text-[10px] font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400 cursor-pointer"
                  >
                    🎲 Generate PIN
                  </button>
                </div>
                <Input
                  type="text"
                  maxLength={6}
                  value={editPinValue}
                  onChange={(e) => setEditPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="e.g. 123456"
                  required
                  className="text-center font-mono font-black text-lg tracking-widest h-12"
                  autoFocus
                />
                {editPinValue.trim().length > 0 && editPinValue.trim().length < 6 ? (
                  <span className="text-[11px] text-amber-500 font-bold block text-center">
                    ⚠️ PIN must be exactly 6 digits ({editPinValue.trim().length}/6)
                  </span>
                ) : (
                  <p className="text-[11px] text-muted-foreground text-center">
                    Staff member will enter this 6-digit PIN on the Staff Login tab to sign in.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingPinStaff(null)}
                  disabled={isUpdatingPin}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isUpdatingPin || editPinValue.length !== 6}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
                >
                  {isUpdatingPin ? "Updating..." : "Save PIN"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
