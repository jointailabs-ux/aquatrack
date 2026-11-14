"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Truck,
  Droplets,
  RotateCcw,
  DollarSign,
  Phone,
  MapPin,
  CheckCircle2,
  Calendar,
  RefreshCw,
  LogOut,
  Clock,
  CreditCard,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { getStaffAssignedDeliveries, executeDeliveryStop } from "@/modules/orders/order.service";
import { getCurrentUserProfile } from "@/modules/staff/staff.service";
import { OrderRecord } from "@/modules/orders/order.schema";
import { StaffRecord } from "@/modules/staff/staff.schema";
import { formatCurrency } from "@/lib/utils";

export default function StaffPortalPage() {
  const router = useRouter();
  const { addToast } = useToast();

  const [staffProfile, setStaffProfile] = React.useState<StaffRecord | null>(null);
  const [selectedDate, setSelectedDate] = React.useState<string>(() =>
    new Date().toISOString().split("T")[0]
  );
  const [orders, setOrders] = React.useState<OrderRecord[]>([]);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);
  const [activeSection, setActiveSection] = React.useState<"deliveries" | "salary">("deliveries");

  // Delivery Modal State
  const [orderToDeliver, setOrderToDeliver] = React.useState<OrderRecord | null>(null);
  const [deliverQty, setDeliverQty] = React.useState<number>(1);
  const [emptyCollected, setEmptyCollected] = React.useState<number>(0);
  const [amountCollected, setAmountCollected] = React.useState<number>(0);
  const [paymentMethod, setPaymentMethod] = React.useState<"CASH" | "UPI" | "CREDIT">("CASH");
  const [deliveryNotes, setDeliveryNotes] = React.useState<string>("");
  const [isDelivering, setIsDelivering] = React.useState(false);

  // Load staff profile and daily deliveries
  const loadData = React.useCallback(async (targetDate: string) => {
    setIsLoading(true);
    try {
      const [profRes, ordRes] = await Promise.all([
        getCurrentUserProfile(),
        getStaffAssignedDeliveries(targetDate),
      ]);

      if (profRes.success && profRes.data) {
        setStaffProfile(profRes.data);
      }
      if (ordRes.success && ordRes.data) {
        setOrders(ordRes.data);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData(selectedDate);
  }, [loadData, selectedDate]);

  // Open delivery execution modal
  const openDeliveryModal = (order: OrderRecord) => {
    setOrderToDeliver(order);
    const totalOrderQty = order.items?.reduce((s, it) => s + (it.quantity || 0), 0) || 1;
    setDeliverQty(totalOrderQty);
    setEmptyCollected(totalOrderQty);
    setAmountCollected(order.total_amount);
    setPaymentMethod("CASH");
    setDeliveryNotes("");
  };

  // Submit delivery
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
        throw new Error(res.error || "Failed to record delivery.");
      }

      // Optimistic update
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderToDeliver.id
            ? {
                ...o,
                status: "DELIVERED",
                actual_quantity_delivered: deliverQty,
                empty_jars_collected: emptyCollected,
                amount_paid: paymentMethod === "CREDIT" ? o.amount_paid : amountCollected,
                payment_status: paymentMethod === "CREDIT" ? "PENDING" : amountCollected >= o.total_amount ? "PAID" : "PARTIALLY_PAID",
                delivered_at: new Date().toISOString(),
              }
            : o
        )
      );

      addToast({
        type: "success",
        title: "Delivery Done! / ডেলিভারি সম্পন্ন",
        message: `Order #${orderToDeliver.order_number} marked delivered successfully.`,
      });

      setOrderToDeliver(null);
      loadData(selectedDate);
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

  // Handle Log Out
  const handleSignOut = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } catch {
      router.push("/login");
    }
  };

  // Metrics calculations for the day
  const metrics = React.useMemo(() => {
    const total = orders.length;
    const delivered = orders.filter((o) => o.status === "DELIVERED");
    const deliveredCount = delivered.length;
    const pendingCount = total - deliveredCount;

    let fullJars = 0;
    let emptyJars = 0;
    let collectedAmount = 0;

    delivered.forEach((o) => {
      fullJars += o.actual_quantity_delivered ?? (o.items?.reduce((s, it) => s + (it.quantity || 0), 0) || 0);
      emptyJars += o.empty_jars_collected ?? 0;
      collectedAmount += Number(o.amount_paid || 0);
    });

    return {
      total,
      deliveredCount,
      pendingCount,
      fullJars,
      emptyJars,
      collectedAmount,
    };
  }, [orders]);

  const pendingOrders = orders.filter((o) => o.status !== "DELIVERED" && o.status !== "CANCELLED");
  const completedOrders = orders.filter((o) => o.status === "DELIVERED");

  return (
    <div className="min-h-screen bg-muted/20 pb-16">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-card/95 backdrop-blur-md border-b border-border shadow-xs">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 font-black text-sm shrink-0">
              {staffProfile?.full_name ? staffProfile.full_name.charAt(0).toUpperCase() : <Truck className="h-5 w-5" />}
            </div>
            <div>
              <div className="font-black text-sm sm:text-base text-foreground leading-snug">
                {staffProfile?.full_name || "Delivery Staff"}
              </div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold">
                  Fleet Staff
                </Badge>
                {staffProfile?.phone && <span>• {staffProfile.phone}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadData(selectedDate)}
              disabled={isLoading}
              className="h-8 px-2.5 text-xs gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="h-8 px-2.5 text-xs gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Day-Wise Filter Bar */}
        <div className="p-3.5 rounded-2xl bg-card border-2 border-border shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs font-black text-foreground uppercase tracking-wider">
                Delivery Date (ডেলিভারি তারিখ)
              </span>
            </div>

            {/* Quick Date Presets */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              <button
                type="button"
                onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 ${
                  selectedDate === new Date().toISOString().split("T")[0]
                    ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-xs"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
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
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 ${
                  (() => {
                    const d = new Date();
                    d.setDate(d.getDate() - 1);
                    return selectedDate === d.toISOString().split("T")[0];
                  })()
                    ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-xs"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Yesterday (গতকাল)
              </button>
              <button
                type="button"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 1);
                  setSelectedDate(d.toISOString().split("T")[0]);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 ${
                  (() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 1);
                    return selectedDate === d.toISOString().split("T")[0];
                  })()
                    ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-xs"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Tomorrow (আগামীকাল)
              </button>
              <div className="w-36 shrink-0">
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-8 text-xs font-bold"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section Tabs: Deliveries vs Salary */}
        <div className="grid grid-cols-2 p-1 rounded-2xl bg-muted border border-border">
          <button
            type="button"
            onClick={() => setActiveSection("deliveries")}
            className={`py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeSection === "deliveries"
                ? "bg-card text-foreground shadow-xs border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Truck className="h-4 w-4 text-emerald-500" />
            <span>My Deliveries (আমার ডেলিভারি — {orders.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("salary")}
            className={`py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeSection === "salary"
                ? "bg-card text-foreground shadow-xs border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CreditCard className="h-4 w-4 text-sky-500" />
            <span>Salary & Payout (আমার বেতন)</span>
          </button>
        </div>

        {activeSection === "deliveries" ? (
          <>
            {/* Daily KPI Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Deliveries Done */}
              <Card className="border-border shadow-xs bg-card">
                <CardContent className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="text-[10px] font-black uppercase tracking-wider">Completed</span>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-foreground">
                    {metrics.deliveredCount} <span className="text-xs font-normal text-muted-foreground">/ {metrics.total}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {metrics.pendingCount} pending deliveries
                  </div>
                </CardContent>
              </Card>

              {/* Full Jars Delivered */}
              <Card className="border-border shadow-xs bg-sky-50/40 dark:bg-sky-950/20 border-sky-200 dark:border-sky-800/60">
                <CardContent className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-sky-700 dark:text-sky-300">
                    <span className="text-[10px] font-black uppercase tracking-wider">Full Jars Given</span>
                    <Droplets className="h-4 w-4" />
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-sky-950 dark:text-sky-100">
                    {metrics.fullJars} <span className="text-xs font-normal text-sky-700 dark:text-sky-300">jars</span>
                  </div>
                  <div className="text-[10px] text-sky-700 dark:text-sky-400 font-semibold">ভরা জার দিয়েছেন</div>
                </CardContent>
              </Card>

              {/* Empty Jars Collected */}
              <Card className="border-border shadow-xs bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60">
                <CardContent className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300">
                    <span className="text-[10px] font-black uppercase tracking-wider">Empty Returned</span>
                    <RotateCcw className="h-4 w-4" />
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-emerald-950 dark:text-emerald-100">
                    {metrics.emptyJars} <span className="text-xs font-normal text-emerald-700 dark:text-emerald-300">jars</span>
                  </div>
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">খালি জার ফেরত</div>
                </CardContent>
              </Card>

              {/* Total Money Collected */}
              <Card className="border-border shadow-xs bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60">
                <CardContent className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-amber-700 dark:text-amber-300">
                    <span className="text-[10px] font-black uppercase tracking-wider">Collections</span>
                    <DollarSign className="h-4 w-4" />
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-amber-950 dark:text-amber-100">
                    {formatCurrency(metrics.collectedAmount)}
                  </div>
                  <div className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold">নগদ/ইউপিআই আদায়</div>
                </CardContent>
              </Card>
            </div>

            {/* Deliveries List */}
            {isLoading ? (
              <div className="p-12 text-center text-xs text-muted-foreground bg-card rounded-2xl border border-border">
                Loading assigned deliveries for {selectedDate}...
              </div>
            ) : orders.length === 0 ? (
              <div className="p-10 text-center rounded-2xl bg-card border border-dashed border-border space-y-2">
                <Truck className="h-8 w-8 text-muted-foreground mx-auto" />
                <h3 className="font-black text-sm text-foreground">No Deliveries Assigned</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  You have no delivery stops assigned on {selectedDate}. Check with the admin or choose another date above.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 1. Pending Deliveries */}
                {pendingOrders.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-black uppercase tracking-wider text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-amber-500" />
                        <span>Pending Deliveries (বাকি আছে — {pendingOrders.length})</span>
                      </h3>
                      <span className="text-[11px] text-muted-foreground">Tap button to complete stop</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {pendingOrders.map((order, idx) => {
                        const orderJars = order.items?.reduce((s, it) => s + (it.quantity || 0), 0) || 1;

                        return (
                          <div
                            key={order.id}
                            className="p-4 rounded-2xl border-2 border-amber-300/80 dark:border-amber-500/40 bg-card hover:border-amber-500 shadow-sm transition-all space-y-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="text-[10px] font-mono font-bold text-muted-foreground block">
                                  Stop #{idx + 1} • {order.order_number}
                                </span>
                                <h4 className="font-black text-sm text-foreground mt-0.5">
                                  {order.customer_name}
                                </h4>
                              </div>
                              <Badge variant="warning" className="text-[10px] font-black shrink-0">
                                Pending
                              </Badge>
                            </div>

                            <div className="space-y-1 text-xs">
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <MapPin className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                                <span className="truncate">{order.delivery_address}</span>
                              </div>
                              {order.customer_phone && (
                                <div className="flex items-center gap-1.5">
                                  <Phone className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                  <a href={`tel:${order.customer_phone}`} className="font-mono text-primary font-bold hover:underline">
                                    {order.customer_phone}
                                  </a>
                                </div>
                              )}
                            </div>

                            {/* Order Items & Amount Pills */}
                            <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/50 border border-border text-xs">
                              <div className="flex items-center gap-2">
                                <span className="font-black text-sky-600 dark:text-sky-400 flex items-center gap-1">
                                  💧 {orderJars} Jars
                                </span>
                              </div>
                              <div className="font-black text-foreground">
                                Bill: {formatCurrency(order.total_amount)}
                              </div>
                            </div>

                            {/* Action Button: Mark Delivered */}
                            <Button
                              type="button"
                              onClick={() => openDeliveryModal(order)}
                              className="w-full h-10 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs sm:text-sm shadow-md shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer"
                            >
                              🚀 Mark Delivered (ডেলিভারি সম্পন্ন করুন)
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 2. Completed Deliveries */}
                {completedOrders.length > 0 && (
                  <div className="space-y-3 pt-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span>Completed Today (সম্পন্ন হয়েছে — {completedOrders.length})</span>
                      </h3>
                      <span className="text-[11px] text-muted-foreground">All items delivered</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {completedOrders.map((order) => {
                        const actualDelivered = order.actual_quantity_delivered ?? order.items?.reduce((s, it) => s + (it.quantity || 0), 0);
                        const emptyReturned = order.empty_jars_collected ?? 0;

                        return (
                          <div
                            key={order.id}
                            className="p-3.5 rounded-2xl border border-border bg-card/60 space-y-2 text-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  #{order.order_number}
                                </span>
                                <h4 className="font-bold text-sm text-foreground">
                                  {order.customer_name}
                                </h4>
                              </div>
                              <Badge variant="success" className="text-[9px] font-bold">
                                ✓ Done
                              </Badge>
                            </div>

                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate">{order.delivery_address}</span>
                            </div>

                            <div className="flex items-center justify-between pt-1 border-t border-border/60 text-[11px]">
                              <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                                💧 {actualDelivered} Jars • 🔄 {emptyReturned} Empty
                              </span>
                              <span className="font-black text-foreground">
                                Collected: {formatCurrency(order.amount_paid || 0)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          /* ============================================================ */
          /* SECTION 2: MY SALARY & COMPENSATION CARD                     */
          /* ============================================================ */
          <div className="space-y-4">
            <Card className="border-border shadow-xs bg-card">
              <CardContent className="p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-10 w-10 rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center font-bold">
                      <CreditCard className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-black text-base text-foreground">My Compensation & Salary</h3>
                      <p className="text-xs text-muted-foreground">Monthly salary agreement & payout terms</p>
                    </div>
                  </div>
                  <Badge variant="primary" className="text-xs font-bold">
                    Active Staff
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl bg-muted/40 border border-border space-y-1">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                      Base Salary ({staffProfile?.salary_type?.toLowerCase() || "monthly"})
                    </span>
                    <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(staffProfile?.salary_amount || 0)}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-muted/40 border border-border space-y-1">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                      Payout Cycle
                    </span>
                    <span className="text-sm font-black text-foreground">
                      {staffProfile?.salary_type === "MONTHLY" ? "Monthly (মাসিক)" : "Fixed Period"}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-1">
                    <span className="text-[10px] uppercase font-bold text-amber-800 dark:text-amber-300 block">
                      My 6-Digit Login PIN
                    </span>
                    <span className="text-lg font-mono font-black text-amber-950 dark:text-amber-200 tracking-widest">
                      {staffProfile?.login_pin || "123456"}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-muted/20 border border-border text-xs text-muted-foreground space-y-1">
                  <div className="font-bold text-foreground">Salary Disbursement Information:</div>
                  <p>
                    Monthly payouts and mid-month advances are processed directly by the business accountant. For any advance requests or payroll questions, please contact management.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* TACTILE DELIVERY COMPLETION MODAL */}
      <Dialog
        isOpen={Boolean(orderToDeliver)}
        onClose={() => !isDelivering && setOrderToDeliver(null)}
        className="max-w-md"
      >
        {orderToDeliver && (
          <form onSubmit={handleConfirmDelivery} className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-black text-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <span>Confirm Delivery (ডেলিভারি সম্পন্ন)</span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Order #{orderToDeliver.order_number} • {orderToDeliver.customer_name}
                </p>
              </div>
            </div>

            <div className="space-y-3.5">
              {/* Customer & Address Details */}
              <div className="p-3 rounded-xl bg-muted/40 border border-border text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="font-bold text-foreground">{orderToDeliver.customer_name}</span>
                </div>
                {orderToDeliver.customer_phone && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone:</span>
                    <span className="font-mono text-foreground">{orderToDeliver.customer_phone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Address:</span>
                  <span className="text-foreground text-right max-w-[200px] truncate">{orderToDeliver.delivery_address}</span>
                </div>
              </div>

              {/* Steppers: Full Delivered & Empty Collected */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Full Jars Delivered */}
                <div className="p-3 rounded-2xl bg-sky-50/50 dark:bg-sky-950/20 border-2 border-sky-200 dark:border-sky-800/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-foreground flex items-center gap-1.5">
                      <span>💧 Full Delivered *</span>
                    </label>
                    <span className="text-[10px] text-sky-700 dark:text-sky-300 font-bold">ভরা জার</span>
                  </div>

                  <div className="flex items-center justify-between bg-card dark:bg-slate-900 border border-sky-300 dark:border-sky-800 rounded-xl p-1">
                    <button
                      type="button"
                      onClick={() => setDeliverQty(Math.max(0, deliverQty - 1))}
                      className="h-9 w-9 rounded-lg bg-muted hover:bg-muted/80 text-foreground flex items-center justify-center font-black text-lg active:scale-95 cursor-pointer"
                    >
                      -
                    </button>
                    <div className="text-center font-black text-base text-foreground">
                      {deliverQty} <span className="text-[10px] font-normal text-muted-foreground">jars</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeliverQty(deliverQty + 1)}
                      className="h-9 w-9 rounded-lg bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center font-black text-lg active:scale-95 cursor-pointer shadow-xs"
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
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all cursor-pointer ${
                          deliverQty === preset ? "bg-sky-500 text-white border-sky-400" : "bg-card text-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Empty Jars Collected */}
                <div className="p-3 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border-2 border-emerald-200 dark:border-emerald-800/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-black text-foreground flex items-center gap-1.5">
                      <span>🔄 Empty Collected</span>
                    </label>
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold">খালি জার</span>
                  </div>

                  <div className="flex items-center justify-between bg-card dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 rounded-xl p-1">
                    <button
                      type="button"
                      onClick={() => setEmptyCollected(Math.max(0, emptyCollected - 1))}
                      className="h-9 w-9 rounded-lg bg-muted hover:bg-muted/80 text-foreground flex items-center justify-center font-black text-lg active:scale-95 cursor-pointer"
                    >
                      -
                    </button>
                    <div className="text-center font-black text-base text-foreground">
                      {emptyCollected} <span className="text-[10px] font-normal text-muted-foreground">jars</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEmptyCollected(emptyCollected + 1)}
                      className="h-9 w-9 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center font-black text-lg active:scale-95 cursor-pointer shadow-xs"
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
                        className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all cursor-pointer ${
                          emptyCollected === preset ? "bg-emerald-500 text-white border-emerald-400" : "bg-card text-foreground border-border hover:bg-muted"
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
                <label className="text-xs font-semibold text-foreground">Notes (ঐচ্ছিক মন্তব্য)</label>
                <Input
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  placeholder="e.g. Delivered to reception, empty jar seal checked"
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
    </div>
  );
}

