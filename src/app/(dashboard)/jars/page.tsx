"use client";

import * as React from "react";
import Link from "next/link";
import {
  Warehouse,
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
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { getDirectInventoryJarSummary } from "@/modules/jars/jar.service";
import { adjustStock } from "@/modules/inventory/inventory.service";
import { DirectInventoryJarSummary } from "@/modules/jars/jar.schema";

const JARS_STORAGE_KEY = "aquatrack_jars_cache_v2";

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

  // Stock Adjustment Modal
  const [isAdjustOpen, setIsAdjustOpen] = React.useState(false);
  const [selectedProductId, setSelectedProductId] = React.useState<string>("");
  const [adjustMode, setAdjustMode] = React.useState<"ADD" | "SUBTRACT" | "SET">("ADD");
  const [adjustQty, setAdjustQty] = React.useState<number>(10);
  const [exactQty, setExactQty] = React.useState<number>(0);
  const [adjustReason, setAdjustReason] = React.useState<string>("Physical stock count verification");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

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
    // If cache is fresh (< 60s), render instantly and revalidate in background
    loadData(false);
  }, [loadData]);

  // Open adjustment modal for a specific product
  const handleOpenAdjust = (productId?: string) => {
    const targetId = productId || summary?.jarProducts[0]?.id || "";
    setSelectedProductId(targetId);
    const prod = summary?.jarProducts.find((p) => p.id === targetId);
    setExactQty(prod ? prod.quantityOnHand : 0);
    setAdjustQty(10);
    setAdjustMode("ADD");
    setAdjustReason("Stock verified & updated in godown");
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
          message: `Cannot remove ${adjustQty} jars. Only ${currentQty} are in godown stock.`,
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
        reason: adjustReason.trim() || "Godown stock adjustment",
      });

      if (res.success) {
        addToast({
          type: "success",
          title: "Stock Updated Successfully (স্টক আপডেট সম্পন্ন)",
          message: `${selectedProduct?.name || "Jar"}: ${delta > 0 ? "+" : ""}${delta} updated in Godown.`,
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

  // Filter customers by name or phone
  const filteredCustomers = (summary?.customersHoldingJars || []).filter((c) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return c.customer_name.toLowerCase().includes(q) || c.phone.includes(q) || c.address.toLowerCase().includes(q);
  });

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
              Jar Tracking & Custody
            </h1>
            <p className="text-xs sm:text-sm text-cyan-100 font-medium mt-1 max-w-2xl">
              Real-time jar accounting: Know exactly how many jars are available in your godown and how many are with customers.
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
              Adjust Godown Stock (স্টক ঠিক করুন)
            </Button>
          </div>
        </div>
      </div>

      {/* 2. THREE ESSENTIAL KPI CARDS (Balanced, clear, high-contrast) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Card 1: Godown Stock */}
        <div className="rounded-2xl border-2 border-cyan-500/40 bg-gradient-to-br from-cyan-500/10 via-sky-500/5 to-cyan-500/10 dark:from-cyan-950/30 dark:via-sky-950/20 dark:to-cyan-950/30 p-5 shadow-xs transition-all hover:border-cyan-500/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
              Godown Stock (গুদামের মজুদ)
            </span>
            <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-700 dark:text-cyan-300">
              <Warehouse className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black text-cyan-900 dark:text-cyan-100 tracking-tight">
            {loading && !summary ? "..." : summary?.godownStock.toLocaleString() ?? 0}
            <span className="text-sm font-bold text-cyan-700 dark:text-cyan-400 ml-1.5">Jars</span>
          </div>
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-cyan-500/20">
            <span className="text-xs text-muted-foreground font-semibold">Available for Delivery</span>
            <Badge className="bg-cyan-500/20 text-cyan-800 dark:text-cyan-200 border-0 text-[10px] font-black">
              গুদামে উপস্থিত
            </Badge>
          </div>
        </div>

        {/* Card 2: With Customers */}
        <div className="rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-emerald-500/10 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-emerald-950/30 p-5 shadow-xs transition-all hover:border-emerald-500/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              With Customers (গ্রাহকের কাছে)
            </span>
            <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              <Users className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black text-emerald-900 dark:text-emerald-100 tracking-tight">
            {loading && !summary ? "..." : summary?.customerHolding.toLocaleString() ?? 0}
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 ml-1.5">Jars</span>
          </div>
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-emerald-500/20">
            <span className="text-xs text-muted-foreground font-semibold">In Customer Houses/Shops</span>
            <Badge className="bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 border-0 text-[10px] font-black">
              ফেরতযোগ্য জার
            </Badge>
          </div>
        </div>

        {/* Card 3: Total Tracked Jars */}
        <div className="rounded-2xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-indigo-500/10 dark:from-indigo-950/30 dark:via-purple-950/20 dark:to-indigo-950/30 p-5 shadow-xs transition-all hover:border-indigo-500/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
              Total Jars Tracked (সর্বমোট জার)
            </span>
            <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">
              <Layers className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black text-indigo-900 dark:text-indigo-100 tracking-tight">
            {loading && !summary ? "..." : summary?.totalJars.toLocaleString() ?? 0}
            <span className="text-sm font-bold text-indigo-700 dark:text-indigo-400 ml-1.5">Jars</span>
          </div>
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-indigo-500/20">
            <span className="text-xs text-muted-foreground font-semibold">Godown + Customers</span>
            <Badge className="bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 border-0 text-[10px] font-black">
              মোট সম্পদ
            </Badge>
          </div>
        </div>
      </div>

      {/* 3. DIRECT GODOWN STOCK BY PRODUCT */}
      <div className="rounded-3xl border-2 border-border/80 bg-card p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
              <Package className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              <span>Godown Stock by Jar Item (গুদামে জার আইটেম)</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live quantities recorded in {summary?.warehouseName || "Godown"} inventory.
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
                    {p.sku || "JAR"}
                  </Badge>
                  <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400">Reusable Jar Asset</span>
                </div>
                <h3 className="font-extrabold text-sm text-foreground leading-snug line-clamp-2">
                  {p.name}
                </h3>
              </div>

              <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                    In Godown
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
              No reusable jar products configured in inventory.
            </div>
          )}
        </div>
      </div>

      {/* 4. CARD-WISE CUSTOMERS HOLDING JARS (Redesigned like Customer Profile Cards) */}
      <div className="rounded-3xl border-2 border-border/80 bg-card p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-base sm:text-lg font-bold text-foreground">
                Customers Holding Jars (যেসব গ্রাহকের কাছে জার আছে)
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Customers who currently hold jars at their home or shop to be collected on route deliveries.
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

                {/* 1-Tap Action Buttons */}
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/60">
                  <Link href={`/orders?customerId=${c.id}&create=true`} className="flex-1">
                    <Button
                      size="sm"
                      className="w-full h-8 text-xs bg-cyan-600 hover:bg-cyan-700 text-white font-bold cursor-pointer active:scale-95 transition-all gap-1 shadow-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      + New Order
                    </Button>
                  </Link>

                  <Link href={`/customers?customerId=${c.id}`}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 text-xs font-bold border-border hover:bg-muted text-foreground cursor-pointer gap-1"
                    >
                      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      Khata (খাতা)
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
              {searchQuery ? "No matching customers found" : "All Jars Reconciled in Godown!"}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              {searchQuery
                ? "Try searching with a different name or phone number."
                : "No customer currently has outstanding uncollected jars."}
            </p>
          </div>
        )}
      </div>

      {/* 5. STOCK ADJUSTMENT MODAL */}
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
                    Adjust Godown Stock (স্টক ঠিক করুন)
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Direct physical reconciliation for godown inventory
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
                  Select Jar Product (জার আইটেম):
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
                      {p.name} (In Godown: {p.quantityOnHand})
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
                    Actual Physical Count in Godown (সঠিক মোট সংখ্যা):
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
                  {/* Preset quick buttons */}
                  <div className="flex gap-2 mt-2">
                    {[5, 10, 20, 50].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setAdjustQty(num)}
                        className="flex-1 py-1 rounded-lg bg-muted/60 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground"
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
                  placeholder="e.g. Physical count reconciliation, new jars brought from plant"
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
                  className="text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white shadow-xs"
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
