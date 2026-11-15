"use client";

import * as React from "react";
import Link from "next/link";
import {
  Users,
  Droplets,
  Search,
  RefreshCw,
  Scale,
  Phone,
  Plus,
  CheckCircle2,
  Package,
  Layers,
  X,
  MapPin,
  BookOpen,
  Truck,
  ArrowDownLeft,
  Store,
  History,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { getDirectInventoryJarSummary } from "@/modules/jars/jar.service";
import { adjustStock } from "@/modules/inventory/inventory.service";
import { returnCustomerJars } from "@/modules/customers/customer.service";
import { DirectInventoryJarSummary } from "@/modules/jars/jar.schema";

const JARS_STORAGE_KEY = "aquatrack_jars_cache_v3";

let cachedJarsState: {
  data: DirectInventoryJarSummary;
  timestamp: number;
} | null = null;

function getInitialJarsData(): DirectInventoryJarSummary | null {
  if (cachedJarsState && cachedJarsState.data) {
    return cachedJarsState.data;
  }
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(JARS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.data) {
          cachedJarsState = parsed;
          return parsed.data;
        }
      }
    } catch {
      // Ignore cache errors
    }
  }
  return null;
}

export default function JarTrackingInventoryPage() {
  const { addToast } = useToast();
  const initialCache = React.useMemo(() => getInitialJarsData(), []);
  const [summary, setSummary] = React.useState<DirectInventoryJarSummary | null>(initialCache);
  const [loading, setLoading] = React.useState(!initialCache);
  const [refreshing, setRefreshing] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [auditFilter, setAuditFilter] = React.useState<"ALL" | "DELIVERY" | "COLLECTION" | "ADJUSTMENT">("ALL");

  // Stock Adjustment Modal
  const [isAdjustOpen, setIsAdjustOpen] = React.useState(false);
  const [selectedProductId, setSelectedProductId] = React.useState<string>("");
  const [adjustMode, setAdjustMode] = React.useState<"ADD" | "SUBTRACT" | "SET">("ADD");
  const [adjustQty, setAdjustQty] = React.useState<number>(10);
  const [exactQty, setExactQty] = React.useState<number>(0);
  const [adjustReason, setAdjustReason] = React.useState<string>("Physical inventory count verification");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Quick Customer Jar Return Modal
  const [isReturnOpen, setIsReturnOpen] = React.useState(false);
  const [customerForReturn, setCustomerForReturn] = React.useState<{ id: string; customer_name: string; total_jars: number; address?: string } | null>(null);
  const [returnQty, setReturnQty] = React.useState<number>(1);
  const [returnNotes, setReturnNotes] = React.useState<string>("");
  const [isSubmittingReturn, setIsSubmittingReturn] = React.useState(false);

  // Load live data directly from inventory and customer holdings
  const loadData = React.useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else if (!cachedJarsState) {
      setLoading(true);
    }

    try {
      const res = await getDirectInventoryJarSummary();
      if (res.success && res.data) {
        setSummary(res.data);
        const freshCache = { data: res.data, timestamp: Date.now() };
        cachedJarsState = freshCache;
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(JARS_STORAGE_KEY, JSON.stringify(freshCache));
          } catch {
            // Ignore
          }
        }
      } else if (!cachedJarsState) {
        addToast({
          type: "error",
          title: "Failed to load jar data",
          message: res.error || "Could not retrieve jar stock from inventory.",
        });
      }
    } catch (err: unknown) {
      if (!cachedJarsState) {
        addToast({
          type: "error",
          title: "Connection Error",
          message: err instanceof Error ? err.message : "Failed to connect to database.",
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  React.useEffect(() => {
    loadData(false);
  }, [loadData]);

  // Open adjustment modal for 20L Jar
  const handleOpenAdjust = (productId?: string) => {
    const targetId = productId || summary?.jarProducts[0]?.id || "";
    setSelectedProductId(targetId);
    const prod = summary?.jarProducts.find((p) => p.id === targetId);
    setExactQty(prod ? prod.quantityOnHand : 0);
    setAdjustQty(10);
    setAdjustMode("ADD");
    setAdjustReason("20L jar physical inventory count verified in store");
    setIsAdjustOpen(true);
  };

  const selectedProduct = summary?.jarProducts.find((p) => p.id === selectedProductId);

  // Submit stock adjustment
  const handleApplyAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) return;

    const currentQty = selectedProduct?.quantityOnHand ?? 0;
    let delta = 0;

    if (adjustMode === "ADD") {
      if (adjustQty <= 0) {
        addToast({ type: "error", title: "Invalid Quantity", message: "Quantity to add must be greater than zero." });
        return;
      }
      delta = adjustQty;
    } else if (adjustMode === "SUBTRACT") {
      if (adjustQty <= 0) {
        addToast({ type: "error", title: "Invalid Quantity", message: "Quantity to remove must be greater than zero." });
        return;
      }
      if (adjustQty > currentQty) {
        addToast({
          type: "error",
          title: "Cannot Exceed Stock",
          message: `Cannot remove ${adjustQty} jars. Only ${currentQty} are present in store inventory.`,
        });
        return;
      }
      delta = -adjustQty;
    } else {
      if (exactQty < 0) {
        addToast({ type: "error", title: "Invalid Count", message: "Exact count cannot be negative." });
        return;
      }
      delta = exactQty - currentQty;
    }

    if (delta === 0) {
      addToast({ type: "info", title: "No Change", message: "The stock count is already at this number." });
      setIsAdjustOpen(false);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await adjustStock({
        product_id: selectedProductId,
        quantity_delta: delta,
        reason: adjustReason.trim() || "Store inventory stock adjustment",
      });

      if (res.success) {
        addToast({
          type: "success",
          title: "Store Stock Updated (স্টক আপডেট সম্পন্ন)",
          message: `${selectedProduct?.name || "20L Jar"}: ${delta > 0 ? "+" : ""}${delta} updated in Store Inventory.`,
        });
        setIsAdjustOpen(false);
        loadData(true);
      } else {
        addToast({
          type: "error",
          title: "Adjustment Failed",
          message: res.error || "Failed to adjust inventory stock.",
        });
      }
    } catch (err: unknown) {
      addToast({
        type: "error",
        title: "Error",
        message: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Quick Return Modal
  const openReturnModal = (c: { id: string; customer_name: string; total_jars: number; address?: string }) => {
    setCustomerForReturn(c);
    setReturnQty(c.total_jars > 0 ? (c.total_jars >= 2 ? 2 : 1) : 1);
    setReturnNotes("");
    setIsReturnOpen(true);
  };

  // Submit Quick Customer Jar Return
  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerForReturn) return;

    if (returnQty <= 0 || returnQty > customerForReturn.total_jars) {
      addToast({
        type: "error",
        title: "Invalid Quantity",
        message: `Quantity must be between 1 and ${customerForReturn.total_jars} jars.`,
      });
      return;
    }

    setIsSubmittingReturn(true);
    try {
      const res = await returnCustomerJars({
        customer_id: customerForReturn.id,
        quantity: returnQty,
        notes: returnNotes.trim() || undefined,
      });

      if (!res.success || !res.data) {
        throw new Error(res.error || "Failed to return jars.");
      }

      addToast({
        type: "success",
        title: "Jars Returned to Store (জার দোকানে জমা হয়েছে)",
        message: `${returnQty} jars collected from ${customerForReturn.customer_name}. Customer balance is now ${res.data.remaining_jars} jars. Added to Store Inventory!`,
      });

      setIsReturnOpen(false);
      loadData(true);
    } catch (err: unknown) {
      addToast({
        type: "error",
        title: "Jar Return Failed",
        message: err instanceof Error ? err.message : "Could not return jars.",
      });
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  // Filter customers by name or phone
  const filteredCustomers = (summary?.customersHoldingJars || []).filter((c) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return c.customer_name.toLowerCase().includes(q) || c.phone.includes(q) || c.address.toLowerCase().includes(q);
  });

  // Filter audit trail records
  const filteredAuditTrail = (summary?.auditTrail || []).filter((item) => {
    if (auditFilter === "DELIVERY") return item.eventType === "DELIVERY";
    if (auditFilter === "COLLECTION") return item.eventType === "EMPTY_COLLECTION" || item.eventType === "DIRECT_RETURN";
    if (auditFilter === "ADJUSTMENT") return item.eventType === "STOCK_ADJUSTMENT" || item.eventType === "PURCHASE_RECEIPT" || item.eventType === "STAFF_RETURN";
    return true;
  });

  const storeStock = summary?.storeInventoryStock ?? summary?.godownStock ?? 0;
  const customerStock = summary?.customerHolding ?? 0;
  const totalTrackedStock = summary?.totalJars ?? (storeStock + customerStock);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16 px-2 sm:px-4">
      {/* 1. VISUAL PAGE HEADER */}
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-cyan-600 via-sky-600 to-blue-700 p-5 sm:p-7 text-white shadow-lg">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-bold text-white mb-2">
              <Droplets className="h-4 w-4 text-cyan-200 fill-cyan-200" />
              <span>জার ট্র্যাকিং ও হিসাব (Jar Tracking & Live Custody)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              20L Jar Tracking & Live Custody
            </h1>
            <p className="text-xs sm:text-sm text-cyan-100 font-medium mt-1 max-w-2xl">
              Live accounting calculated directly from Store Inventory: Exactly how many 20L jars are in store, how many are with customers, and full audit trail of every movement.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadData(true)}
              disabled={refreshing || loading}
              className="bg-white/10 hover:bg-white/20 text-white border-white/30 text-xs font-bold backdrop-blur-xs cursor-pointer shadow-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh (রিফ্রেশ)
            </Button>

            <Button
              size="sm"
              onClick={() => handleOpenAdjust()}
              className="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs shadow-md shadow-amber-950/20 cursor-pointer active:scale-95 transition-all"
            >
              <Scale className="h-3.5 w-3.5 mr-1.5" />
              Update Inventory Stock (ইনভেন্টরি পরিবর্তন)
            </Button>
          </div>
        </div>
      </div>

      {/* 2. THREE ESSENTIAL KPI CARDS (Store Inventory, Customers, and Total 20L Jars) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Card 1: Store Inventory Stock */}
        <div className="rounded-2xl border-2 border-cyan-500/40 bg-gradient-to-br from-cyan-500/10 via-sky-500/5 to-cyan-500/10 dark:from-cyan-950/30 dark:via-sky-950/20 dark:to-cyan-950/30 p-5 shadow-xs transition-all hover:border-cyan-500/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5">
              <Store className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              In Store / Inventory (দোকানে বর্তমান)
            </span>
            <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-700 dark:text-cyan-300">
              <Package className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black text-cyan-900 dark:text-cyan-100 tracking-tight">
            {loading && !summary ? "..." : storeStock.toLocaleString()}
            <span className="text-sm font-bold text-cyan-700 dark:text-cyan-400 ml-1.5">Jars</span>
          </div>
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-cyan-500/20">
            <span className="text-xs text-muted-foreground font-semibold">Available in Store Inventory</span>
            <Badge className="bg-cyan-500/20 text-cyan-800 dark:text-cyan-200 border-0 text-[10px] font-black">
              ইনভেন্টরিতে প্রস্তুত
            </Badge>
          </div>
        </div>

        {/* Card 2: With Customers */}
        <div className="rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-emerald-500/10 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-emerald-950/30 p-5 shadow-xs transition-all hover:border-emerald-500/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
              <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              With Customers (গ্রাহকদের কাছে)
            </span>
            <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              <Users className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black text-emerald-900 dark:text-emerald-100 tracking-tight">
            {loading && !summary ? "..." : customerStock.toLocaleString()}
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 ml-1.5">Jars</span>
          </div>
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-emerald-500/20">
            <span className="text-xs text-muted-foreground font-semibold">In Customer Houses / Shops</span>
            <Badge className="bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-0 text-[10px] font-black">
              ফেরতযোগ্য জার
            </Badge>
          </div>
        </div>

        {/* Card 3: Total 20L Jars */}
        <div className="rounded-2xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-indigo-500/10 dark:from-indigo-950/30 dark:via-purple-950/20 dark:to-indigo-950/30 p-5 shadow-xs transition-all hover:border-indigo-500/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              Total 20L Jars Tracked (সর্বমোট ২০L জার)
            </span>
            <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
              <Droplets className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black text-indigo-900 dark:text-indigo-100 tracking-tight">
            {loading && !summary ? "..." : totalTrackedStock.toLocaleString()}
            <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400 ml-1.5">Jars</span>
          </div>
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-indigo-500/20">
            <span className="text-xs text-muted-foreground font-semibold">Store Stock + Customers</span>
            <Badge className="bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 border-0 text-[10px] font-black">
              মোট ২০L জার হিসাব
            </Badge>
          </div>
        </div>
      </div>

      {/* 3. DIRECT STORE INVENTORY (20L JAR ONLY) */}
      <div className="rounded-3xl border-2 border-border/80 bg-card p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
              <Store className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              <span>Live 20L Jar Inventory (ইনভেন্টরি স্টক)</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Calculated directly from {summary?.warehouseName || "Store Inventory"}. Small water bottles (500ml, 1L) are excluded.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => handleOpenAdjust()}
            className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-xs self-start sm:self-auto cursor-pointer shadow-xs active:scale-95 transition-all"
          >
            <Scale className="h-3.5 w-3.5 mr-1.5" />
            Update Stock (স্টক পরিবর্তন)
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {(summary?.jarProducts || []).map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border-2 border-border/80 bg-muted/20 p-4 transition-all hover:border-cyan-500/50 hover:bg-muted/30 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <Badge variant="outline" className="text-[10px] font-mono font-semibold text-muted-foreground">
                    {p.sku || "JAR-20L"}
                  </Badge>
                  <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400">Reusable 20L Jar Asset</span>
                </div>
                <h3 className="font-extrabold text-sm text-foreground leading-snug line-clamp-2">
                  {p.name}
                </h3>
              </div>

              <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                    In Store Stock
                  </span>
                  <span className="text-2xl font-black text-foreground">
                    {p.quantityOnHand}
                  </span>
                  <span className="text-xs font-bold text-muted-foreground ml-1">Jars (টি)</span>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenAdjust(p.id)}
                  className="h-8 px-3 text-xs font-bold border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/10 cursor-pointer"
                >
                  Adjust (ঠিক করুন)
                </Button>
              </div>
            </div>
          ))}

          {(!summary?.jarProducts || summary.jarProducts.length === 0) && !loading && (
            <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
              No 20L jar products found in inventory.
            </div>
          )}
        </div>
      </div>

      {/* 4. CARD-WISE CUSTOMERS HOLDING JARS (With 1-Tap Return Action) */}
      <div className="rounded-3xl border-2 border-border/80 bg-card p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-base sm:text-lg font-bold text-foreground">
                Customers Holding 20L Jars (যেসব গ্রাহকের কাছে জার আছে)
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Customers who currently hold 20L jars at their home or shop to be collected.
            </p>
          </div>

          {/* Quick Search */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, phone, area (নাম বা ফোন)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs rounded-xl bg-background border-border"
            />
          </div>
        </div>

        {/* Customer List Card Grid */}
        {loading && !summary ? (
          <div className="py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-cyan-600" />
            <span>Loading jar holdings from database...</span>
          </div>
        ) : filteredCustomers.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredCustomers.map((c) => (
              <div
                key={c.id}
                className="rounded-2xl border-2 border-border/80 bg-background/50 hover:bg-muted/20 p-4 transition-all hover:border-cyan-500/50 shadow-xs flex flex-col justify-between"
              >
                <div>
                  {/* Top Customer Info Row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="h-10 w-10 rounded-xl bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 flex items-center justify-center font-black text-sm shrink-0">
                        {c.customer_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="font-extrabold text-sm text-foreground leading-snug">
                          {c.customer_name}
                        </h4>
                        {c.phone ? (
                          <a
                            href={`tel:${c.phone}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline mt-0.5"
                          >
                            <Phone className="h-3 w-3" />
                            <span>{c.phone}</span>
                          </a>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">No Phone</span>
                        )}
                      </div>
                    </div>

                    {/* Jar Count Highlight Badge */}
                    <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-1 text-center shrink-0">
                      <span className="text-[10px] font-bold text-cyan-800 dark:text-cyan-300 block uppercase tracking-wider">
                        At House
                      </span>
                      <span className="text-base font-black text-cyan-700 dark:text-cyan-300">
                        {c.total_jars} {c.total_jars === 1 ? "Jar" : "Jars"}
                      </span>
                    </div>
                  </div>

                  {/* Delivery Address */}
                  {c.address && (
                    <div className="flex items-start gap-1.5 mt-3 pt-2.5 border-t border-border/50 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <p className="line-clamp-2 leading-tight">{c.address}</p>
                    </div>
                  )}
                </div>

                {/* 1-Tap Action Buttons (New Order, Return to Store, Khata) */}
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/60">
                  <Link href={`/orders?customerId=${c.id}&create=true`} className="flex-1">
                    <Button
                      size="sm"
                      className="w-full h-8 text-xs bg-cyan-600 hover:bg-cyan-700 text-white font-bold cursor-pointer active:scale-95 transition-all gap-1 shadow-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      + Order
                    </Button>
                  </Link>

                  <Button
                    size="sm"
                    onClick={() => openReturnModal(c)}
                    className="h-8 px-2.5 text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer active:scale-95 transition-all gap-1 shadow-xs rounded-xl"
                    title="Collect jars back to store inventory"
                  >
                    <Droplets className="h-3 w-3" />
                    Return (ফেরত)
                  </Button>

                  <Link href={`/customers?customerId=${c.id}`}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 text-xs font-bold border-border hover:bg-muted text-foreground cursor-pointer gap-1"
                    >
                      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      Khata
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center rounded-2xl border border-dashed border-border p-6 bg-muted/10">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-foreground">
              {searchQuery ? "No matching customers found" : "All Jars Reconciled in Store!"}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              {searchQuery
                ? "Try searching with a different name or phone number."
                : "No customer currently has outstanding uncollected jars."}
            </p>
          </div>
        )}
      </div>

      {/* 5. LIVE JAR CUSTODY & DELIVERY AUDIT TRAIL (Which Jar Goes to Whom) */}
      <div className="rounded-3xl border-2 border-border/80 bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-base sm:text-lg font-bold text-foreground">
                Jar Movement & Custody Audit Trail (কার কাছে জার গেছে বা এসেছে)
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live chronological audit log: Delivered to customer, empty jars collected, direct returns to store, and inventory updates.
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex rounded-xl bg-muted p-1 border border-border self-start sm:self-auto overflow-x-auto scrollbar-none">
            {[
              { id: "ALL", label: "All Movements (সব)" },
              { id: "DELIVERY", label: "Delivered (দেওয়া)" },
              { id: "COLLECTION", label: "Returned (ফেরত)" },
              { id: "ADJUSTMENT", label: "Stock Updates (মজুদ)" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setAuditFilter(f.id as typeof auditFilter)}
                className={`py-1 px-2.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  auditFilter === f.id
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Audit Trail List */}
        {loading && !summary ? (
          <div className="py-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            <span>Loading audit trail...</span>
          </div>
        ) : filteredAuditTrail.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground rounded-2xl border border-dashed border-border p-6">
            No movements recorded for this filter.
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
            {filteredAuditTrail.map((item) => {
              const isDelivery = item.eventType === "DELIVERY";
              const isCollection = item.eventType === "EMPTY_COLLECTION" || item.eventType === "DIRECT_RETURN";
              const isPurchase = item.eventType === "PURCHASE_RECEIPT";
              const isStaffReturn = item.eventType === "STAFF_RETURN";

              const badgeColor = isDelivery
                ? "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30"
                : isCollection
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                : isPurchase
                ? "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30"
                : isStaffReturn
                ? "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";

              const badgeLabel = isDelivery
                ? "Delivered to Customer (গ্রাহককে দেওয়া)"
                : item.eventType === "DIRECT_RETURN"
                ? "Direct Customer Return (সরাসরি ফেরত)"
                : isCollection
                ? "Empty Jars Collected (খালি জার ফেরত)"
                : isPurchase
                ? "Purchase Receipt (+Store Stock)"
                : isStaffReturn
                ? "Staff Returned to Store"
                : "Inventory Stock Adjustment";

              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-border/80 bg-background/60 hover:bg-muted/30 p-3.5 transition-all text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black border ${badgeColor}`}>
                        {isDelivery ? (
                          <Truck className="h-3 w-3" />
                        ) : isCollection ? (
                          <ArrowDownLeft className="h-3 w-3" />
                        ) : isPurchase ? (
                          <Package className="h-3 w-3" />
                        ) : isStaffReturn ? (
                          <Store className="h-3 w-3" />
                        ) : (
                          <Scale className="h-3 w-3" />
                        )}
                        {badgeLabel}
                      </span>

                      {item.orderNumber && (
                        <span className="text-[11px] font-mono font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-md border border-border">
                          {item.orderNumber}
                        </span>
                      )}

                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(item.timestamp).toLocaleString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    {/* Customer & Staff Details */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {item.customerName && (
                        <span className="font-extrabold text-foreground text-xs flex items-center gap-1">
                          <Users className="h-3.5 w-3.5 text-primary" />
                          {item.customerName}
                        </span>
                      )}

                      {item.staffName && (
                        <span className="text-muted-foreground font-semibold flex items-center gap-1 text-[11px]">
                          Driver/Staff: <strong className="text-foreground">{item.staffName}</strong>
                        </span>
                      )}

                      {item.notes && (
                        <span className="text-muted-foreground italic text-[11px] truncate max-w-sm">
                          &ldquo;{item.notes}&rdquo;
                        </span>
                      )}
                    </div>

                    {item.address && (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                        {item.address}
                      </p>
                    )}
                  </div>

                  {/* Quantity Impact Box */}
                  <div className="sm:text-right shrink-0">
                    <div
                      className={`inline-flex items-baseline gap-1 px-3 py-1.5 rounded-xl font-black text-sm border ${
                        isDelivery
                          ? "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25"
                          : isCollection || isPurchase || isStaffReturn
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25"
                          : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25"
                      }`}
                    >
                      <span className="text-base font-black">
                        {isDelivery ? `-${item.quantity}` : `+${item.quantity}`}
                      </span>
                      <span className="text-[11px] font-bold">20L Jars</span>
                    </div>
                    <span className="block text-[9px] text-muted-foreground mt-0.5">
                      {isDelivery ? "Now with Customer" : "Added to Store Stock"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 6. QUICK CUSTOMER RETURN MODAL */}
      {isReturnOpen && customerForReturn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl bg-card border-2 border-cyan-500/40 p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2.5 rounded-2xl bg-cyan-500/20 text-cyan-600 dark:text-cyan-400">
                  <Droplets className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-foreground">
                    Collect Returned Jars (জার ফেরত নিন)
                  </h3>
                  <p className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-400">
                    Directly deposited back into Store Inventory
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsReturnOpen(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-cyan-500/10 border border-cyan-500/20 p-3 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-muted-foreground">Customer:</span>
                <span className="font-black text-foreground">{customerForReturn.customer_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-muted-foreground">Current Jars at House:</span>
                <span className="font-black text-cyan-600 dark:text-cyan-400 text-sm">
                  {customerForReturn.total_jars} Jars
                </span>
              </div>
            </div>

            <form onSubmit={handleConfirmReturn} className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground">
                    Quantity Collected (কয়টি জার ফেরত নিলেন) *
                  </label>
                  <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400">
                    Max: {customerForReturn.total_jars}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setReturnQty((q) => Math.max(1, q - 1))}
                    disabled={returnQty <= 1}
                    className="h-11 w-11 rounded-2xl bg-muted border border-border text-foreground font-black text-base flex items-center justify-center hover:bg-muted/80 disabled:opacity-40 cursor-pointer"
                  >
                    -
                  </button>
                  <Input
                    type="number"
                    min={1}
                    max={customerForReturn.total_jars}
                    value={returnQty}
                    onChange={(e) => setReturnQty(Math.min(customerForReturn.total_jars, Math.max(1, Number(e.target.value))))}
                    className="h-11 text-center text-lg font-black"
                  />
                  <button
                    type="button"
                    onClick={() => setReturnQty((q) => Math.min(customerForReturn.total_jars, q + 1))}
                    disabled={returnQty >= customerForReturn.total_jars}
                    className="h-11 w-11 rounded-2xl bg-muted border border-border text-foreground font-black text-base flex items-center justify-center hover:bg-muted/80 disabled:opacity-40 cursor-pointer"
                  >
                    +
                  </button>
                </div>

                {/* Quick Presets */}
                <div className="flex gap-2">
                  {[1, 2, 3, 5].filter((n) => n <= customerForReturn.total_jars).map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setReturnQty(num)}
                      className={`flex-1 py-1 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        returnQty === num ? "bg-cyan-500 text-white border-cyan-500" : "bg-muted/60 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setReturnQty(customerForReturn.total_jars)}
                    className="flex-1 py-1 rounded-xl text-xs font-black bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 cursor-pointer"
                  >
                    All ({customerForReturn.total_jars})
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-start gap-2 text-xs">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300 font-medium">
                  These <strong>+{returnQty} jars</strong> will be automatically added to your Store Inventory stock immediately.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Notes (ঐচ্ছিক মন্তব্য)
                </label>
                <Input
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="e.g. Returned to store / collected by staff"
                  className="text-xs h-9"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsReturnOpen(false)}
                  disabled={isSubmittingReturn}
                  className="rounded-xl text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmittingReturn || returnQty <= 0}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white font-black rounded-xl shadow-xs cursor-pointer"
                >
                  {isSubmittingReturn ? "Depositing..." : `Confirm Return (+${returnQty} to Stock)`}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. STOCK ADJUSTMENT MODAL */}
      {isAdjustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl bg-card border border-border p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-400/20 text-amber-500">
                  <Scale className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-foreground">
                    Update Store Inventory (ইনভেন্টরি স্টক পরিবর্তন)
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Direct physical reconciliation for 20L jar store inventory
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAdjustOpen(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleApplyAdjustment} className="space-y-4">
              {/* Product Selector */}
              <div>
                <label className="text-xs font-bold text-foreground mb-1 block">
                  Select 20L Jar Product:
                </label>
                <select
                  value={selectedProductId}
                  onChange={(e) => {
                    setSelectedProductId(e.target.value);
                    const prod = summary?.jarProducts.find((p) => p.id === e.target.value);
                    setExactQty(prod ? prod.quantityOnHand : 0);
                  }}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground focus:ring-2 focus:ring-cyan-500"
                >
                  {(summary?.jarProducts || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (In Store: {p.quantityOnHand})
                    </option>
                  ))}
                </select>
              </div>

              {/* Adjustment Mode Selector */}
              <div>
                <label className="text-xs font-bold text-foreground mb-1.5 block">
                  Adjustment Type (কী পরিবর্তন করতে চান?):
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustMode("ADD")}
                    className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      adjustMode === "ADD"
                        ? "bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    + Add (যোগ)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustMode("SUBTRACT")}
                    className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      adjustMode === "SUBTRACT"
                        ? "bg-rose-500/15 border-rose-500 text-rose-700 dark:text-rose-300"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    - Remove (বাদ)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustMode("SET")}
                    className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      adjustMode === "SET"
                        ? "bg-cyan-500/15 border-cyan-500 text-cyan-700 dark:text-cyan-300"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    = Set Exact (নির্দিষ্ট)
                  </button>
                </div>
              </div>

              {/* Quantity Input */}
              {adjustMode === "SET" ? (
                <div>
                  <label className="text-xs font-bold text-foreground mb-1 block">
                    Actual Physical Count in Store (সঠিক মোট সংখ্যা):
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={exactQty}
                    onChange={(e) => setExactQty(Number(e.target.value))}
                    className="h-10 text-sm font-bold"
                  />
                  <span className="text-[11px] text-muted-foreground mt-1 block">
                    Current system count: <strong>{selectedProduct?.quantityOnHand ?? 0}</strong>. Difference will be auto-calculated.
                  </span>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold text-foreground mb-1 block">
                    Quantity to {adjustMode === "ADD" ? "Add" : "Remove"} (সংখ্যা):
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setAdjustQty((q) => Math.max(1, q - 5))}
                      className="h-10 w-10 text-xs font-bold"
                    >
                      -5
                    </Button>
                    <Input
                      type="number"
                      min={1}
                      value={adjustQty}
                      onChange={(e) => setAdjustQty(Number(e.target.value))}
                      className="h-10 text-sm font-bold text-center"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setAdjustQty((q) => q + 5)}
                      className="h-10 w-10 text-xs font-bold"
                    >
                      +5
                    </Button>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {[5, 10, 20, 50].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setAdjustQty(num)}
                        className="flex-1 py-1 rounded-lg bg-muted/60 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                      >
                        +{num}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Reason Input */}
              <div>
                <label className="text-xs font-bold text-foreground mb-1 block">
                  Adjustment Reason (কারণ):
                </label>
                <Input
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Physical count reconciliation in store"
                  className="text-xs h-9"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAdjustOpen(false)}
                  disabled={isSubmitting}
                  className="text-xs"
                >
                  Cancel (বাতিল)
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white shadow-xs cursor-pointer"
                >
                  {isSubmitting ? "Updating..." : "Save Stock Adjustment"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
