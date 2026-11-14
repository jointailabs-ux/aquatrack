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
  Minus,
  CheckCircle2,
  Package,
  Layers,
  ShoppingBag,
  ExternalLink,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { getDirectInventoryJarSummary } from "@/modules/jars/jar.service";
import { adjustStock } from "@/modules/inventory/inventory.service";
import { DirectInventoryJarSummary } from "@/modules/jars/jar.schema";

export default function JarTrackingInventoryPage() {
  const { addToast } = useToast();
  const [summary, setSummary] = React.useState<DirectInventoryJarSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
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
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await getDirectInventoryJarSummary();
      if (res.success && res.data) {
        setSummary(res.data);
      } else {
        addToast({
          type: "error",
          title: "Failed to load jar data",
          message: res.error || "Could not retrieve jar stock from inventory.",
        });
      }
    } catch (err: unknown) {
      addToast({
        type: "error",
        title: "Connection Error",
        message: err instanceof Error ? err.message : "Failed to connect to database.",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  React.useEffect(() => {
    loadData();
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
  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) {
      addToast({ type: "error", title: "Select Product", message: "Please select a jar product to adjust." });
      return;
    }

    let delta = 0;
    const currentQty = selectedProduct ? selectedProduct.quantityOnHand : 0;

    if (adjustMode === "ADD") {
      if (adjustQty <= 0) {
        addToast({ type: "error", title: "Invalid Quantity", message: "Quantity to add must be greater than 0." });
        return;
      }
      delta = adjustQty;
    } else if (adjustMode === "SUBTRACT") {
      if (adjustQty <= 0) {
        addToast({ type: "error", title: "Invalid Quantity", message: "Quantity to subtract must be greater than 0." });
        return;
      }
      if (adjustQty > currentQty) {
        addToast({
          type: "error",
          title: "Cannot Subtract More Than Stock",
          message: `Current godown stock is ${currentQty}. Cannot reduce by ${adjustQty}.`,
        });
        return;
      }
      delta = -adjustQty;
    } else {
      // SET EXACT
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
    <div className="space-y-6 max-w-7xl mx-auto pb-16 px-3 sm:px-6">
      {/* 1. VISUAL PAGE HEADER */}
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-blue-700 via-indigo-700 to-cyan-600 p-5 sm:p-7 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-semibold text-white mb-2">
              <Droplets className="h-4 w-4 text-cyan-200 fill-cyan-200" />
              <span>জার ট্র্যাকিং ও স্টক (Jar Tracking & Inventory)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Jar Tracking & Live Custody
            </h1>
            <p className="text-xs sm:text-sm text-cyan-100/90 mt-1 max-w-2xl">
              Track live reusable jars in godown stock and at customer homes. Simple, direct inventory view.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadData(true)}
              disabled={refreshing || loading}
              className="bg-white/10 hover:bg-white/20 text-white border-white/25 text-xs font-semibold backdrop-blur-xs cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh (রিফ্রেশ)
            </Button>

            <Button
              size="sm"
              onClick={() => handleOpenAdjust()}
              className="bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs shadow-md shadow-amber-950/20 cursor-pointer"
            >
              <Scale className="h-3.5 w-3.5 mr-1.5" />
              Adjust Godown Stock (স্টক ঠিক করুন)
            </Button>
          </div>
        </div>
      </div>

      {/* 2. THREE ESSENTIAL KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Card 1: Godown Stock */}
        <div className="relative overflow-hidden rounded-2xl border-2 border-blue-500/30 bg-linear-to-br from-blue-950/30 via-background to-blue-900/10 p-5 shadow-sm transition-all hover:border-blue-500/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-400">
              Godown Stock (গুদামের স্টক)
            </span>
            <div className="p-2.5 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/30">
              <Warehouse className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">
            {loading ? "..." : summary?.godownStock.toLocaleString() ?? 0}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
            <span className="text-xs text-muted-foreground font-medium">Available in Godown</span>
            <Badge variant="outline" className="border-blue-500/40 text-blue-400 text-[10px] font-bold">
              গুদামে মজুদ
            </Badge>
          </div>
        </div>

        {/* Card 2: With Customers */}
        <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-500/30 bg-linear-to-br from-emerald-950/30 via-background to-emerald-900/10 p-5 shadow-sm transition-all hover:border-emerald-500/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              With Customers (গ্রাহকদের বাড়িতে)
            </span>
            <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <Users className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">
            {loading ? "..." : summary?.customerHolding.toLocaleString() ?? 0}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
            <span className="text-xs text-muted-foreground font-medium">Customer Houses / Shops</span>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px] font-bold">
              গ্রাহকের কাছে
            </Badge>
          </div>
        </div>

        {/* Card 3: Total Tracked Jars */}
        <div className="relative overflow-hidden rounded-2xl border-2 border-indigo-500/30 bg-linear-to-br from-indigo-950/30 via-background to-indigo-900/10 p-5 shadow-sm transition-all hover:border-indigo-500/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
              Total Jars Tracked (মোট জার)
            </span>
            <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
              <Layers className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black text-foreground tracking-tight">
            {loading ? "..." : summary?.totalJars.toLocaleString() ?? 0}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
            <span className="text-xs text-muted-foreground font-medium">Godown + Customers</span>
            <Badge variant="outline" className="border-indigo-500/40 text-indigo-400 text-[10px] font-bold">
              সর্বমোট জার
            </Badge>
          </div>
        </div>
      </div>

      {/* 3. DIRECT GODOWN STOCK BY PRODUCT */}
      <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-500" />
              <span>Godown Stock by Jar Type (জার আইটেম অনুযায়ী স্টক)</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live quantities tracked directly in {summary?.warehouseName || "Godown"} inventory.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => handleOpenAdjust()}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs self-start sm:self-auto cursor-pointer"
          >
            <Scale className="h-3.5 w-3.5 mr-1.5" />
            Update Stock (স্টক পরিবর্তন)
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {(summary?.jarProducts || []).map((p) => (
            <div
              key={p.id}
              className="rounded-2xl border border-border/70 bg-muted/20 p-4 transition-all hover:border-blue-500/40 hover:bg-muted/40 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Badge variant="outline" className="text-[10px] font-mono font-medium text-muted-foreground">
                    {p.sku || "JAR"}
                  </Badge>
                  <span className="text-[11px] font-bold text-blue-500">20L / Reusable</span>
                </div>
                <h3 className="font-bold text-sm text-foreground leading-snug line-clamp-2">
                  {p.name}
                </h3>
              </div>

              <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                    In Godown
                  </span>
                  <span className="text-2xl font-black text-foreground">
                    {p.quantityOnHand}
                  </span>
                  <span className="text-xs text-muted-foreground ml-1">pcs</span>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenAdjust(p.id)}
                  className="h-8 px-2.5 text-xs font-semibold border-border hover:bg-blue-500/10 hover:text-blue-500 cursor-pointer"
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

      {/* 4. CUSTOMERS HOLDING JARS (গ্রাহকদের কাছে থাকা জার) */}
      <div className="rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-500" />
              <h2 className="text-base sm:text-lg font-bold text-foreground">
                Customers Holding Jars (যেসব গ্রাহকের কাছে জার আছে)
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              List of customers who currently have jars at their home or shop to collect back.
            </p>
          </div>

          {/* Quick Search */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name or phone (নাম বা ফোন)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs rounded-xl bg-background"
            />
          </div>
        </div>

        {/* Customer List Table / Cards */}
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
            <span>Loading jar holdings from database...</span>
          </div>
        ) : filteredCustomers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-border/80 text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/30">
                  <th className="py-3 px-4 rounded-l-xl">Customer Name (গ্রাহকের নাম)</th>
                  <th className="py-3 px-4">Phone (ফোন)</th>
                  <th className="py-3 px-4 hidden md:table-cell">Address (ঠিকানা)</th>
                  <th className="py-3 px-4 text-center">Jars Held (জার সংখ্যা)</th>
                  <th className="py-3 px-4 text-right rounded-r-xl">Actions (অ্যাকশন)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-foreground">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold text-xs">
                          {c.customer_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span>{c.customer_name}</span>
                          <span className="block text-[11px] font-normal text-muted-foreground md:hidden mt-0.5">
                            {c.address || "No address"}
                          </span>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-medium text-muted-foreground">
                      {c.phone ? (
                        <a
                          href={`tel:${c.phone}`}
                          className="inline-flex items-center gap-1.5 text-blue-500 hover:text-blue-600 hover:underline"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          <span>{c.phone}</span>
                        </a>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 hidden md:table-cell text-muted-foreground max-w-xs truncate">
                      {c.address || "—"}
                    </td>

                    <td className="py-3.5 px-4 text-center">
                      <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-black px-2.5 py-0.5">
                        {c.total_jars} {c.total_jars === 1 ? "Jar" : "Jars"} ({c.total_jars}টি)
                      </Badge>
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/orders?customerId=${c.id}&create=true`}>
                          <Button
                            size="sm"
                            className="h-8 px-2.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer"
                          >
                            <ShoppingBag className="h-3.5 w-3.5 mr-1" />
                            Order (অর্ডার)
                          </Button>
                        </Link>

                        <Link href={`/customers?search=${encodeURIComponent(c.phone || c.customer_name)}`}>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center rounded-2xl border border-dashed border-border/80 bg-muted/10 p-6">
            <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
            <p className="text-sm font-semibold text-foreground">
              {searchQuery ? "No matching customers found." : "No customers are holding jars right now."}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              When jars are delivered to customers on routes or orders, they will appear here.
            </p>
          </div>
        )}
      </div>

      {/* 5. ADJUST GODOWN STOCK MODAL (গুদামের জার স্টক পরিবর্তন) */}
      {isAdjustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="relative w-full max-w-md rounded-3xl border border-border bg-card p-5 sm:p-6 shadow-2xl text-foreground">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-amber-500" />
                <h3 className="font-black text-base sm:text-lg">
                  Adjust Godown Stock (স্টক পরিবর্তন)
                </h3>
              </div>
              <button
                onClick={() => setIsAdjustOpen(false)}
                className="p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-4 mt-4">
              {/* Product Selector */}
              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">
                  Select Jar Product (জার আইটেম বেছে নিন) *
                </label>
                <select
                  value={selectedProductId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedProductId(id);
                    const prod = summary?.jarProducts.find((p) => p.id === id);
                    setExactQty(prod ? prod.quantityOnHand : 0);
                  }}
                  className="w-full h-10 px-3 rounded-xl border border-border bg-background text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {(summary?.jarProducts || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Current: {p.quantityOnHand} pcs)
                    </option>
                  ))}
                </select>
              </div>

              {/* Current Stock Banner */}
              <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">
                  Current Stock in Godown:
                </span>
                <span className="text-base font-black text-blue-400">
                  {selectedProduct?.quantityOnHand ?? 0} pcs
                </span>
              </div>

              {/* Adjustment Mode Selector */}
              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">
                  Action Type (কী করতে চান?)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustMode("ADD")}
                    className={`py-2 px-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      adjustMode === "ADD"
                        ? "bg-emerald-500/15 border-emerald-500 text-emerald-400 shadow-xs"
                        : "border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    + Add (যোগ)
                  </button>

                  <button
                    type="button"
                    onClick={() => setAdjustMode("SUBTRACT")}
                    className={`py-2 px-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      adjustMode === "SUBTRACT"
                        ? "bg-rose-500/15 border-rose-500 text-rose-400 shadow-xs"
                        : "border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    - Reduce (কমান)
                  </button>

                  <button
                    type="button"
                    onClick={() => setAdjustMode("SET")}
                    className={`py-2 px-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      adjustMode === "SET"
                        ? "bg-amber-500/15 border-amber-500 text-amber-400 shadow-xs"
                        : "border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    = Set Exact (সরাসরি)
                  </button>
                </div>
              </div>

              {/* Quantity Input */}
              {adjustMode === "SET" ? (
                <div>
                  <label className="text-xs font-bold text-foreground block mb-1.5">
                    Exact Physical Count in Godown (সরাসরি মোট সংখ্যা) *
                  </label>
                  <Input
                    type="number"
                    min="0"
                    value={exactQty}
                    onChange={(e) => setExactQty(Math.max(0, parseInt(e.target.value) || 0))}
                    className="h-10 text-sm font-bold text-center rounded-xl bg-background"
                  />
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1">
                    <span>Change:</span>
                    <span className="font-bold">
                      {(exactQty - (selectedProduct?.quantityOnHand ?? 0)) >= 0 ? "+" : ""}
                      {exactQty - (selectedProduct?.quantityOnHand ?? 0)} pcs
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold text-foreground block mb-1.5">
                    Quantity to {adjustMode === "ADD" ? "Add" : "Reduce"} (পরিমাণ) *
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setAdjustQty((q) => Math.max(1, q - 5))}
                      className="h-10 w-10 p-0 rounded-xl"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      type="number"
                      min="1"
                      value={adjustQty}
                      onChange={(e) => setAdjustQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="h-10 text-sm font-bold text-center rounded-xl bg-background"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setAdjustQty((q) => q + 5)}
                      className="h-10 w-10 p-0 rounded-xl"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Quick Preset Buttons */}
                  <div className="flex items-center gap-1.5 mt-2">
                    {[5, 10, 20, 50].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAdjustQty(preset)}
                        className="py-1 px-2.5 rounded-lg text-[11px] font-bold border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        +{preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="text-xs font-bold text-foreground block mb-1.5">
                  Reason for Adjustment (পরিবর্তনের কারণ)
                </label>
                <Input
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Stock audit, New jars purchased, Scrapped"
                  className="h-9 text-xs rounded-xl bg-background"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/60">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAdjustOpen(false)}
                  disabled={isSubmitting}
                  className="h-9 px-4 text-xs font-semibold cursor-pointer"
                >
                  Cancel (বাতিল)
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-9 px-5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                >
                  {isSubmitting ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Save Changes (সংরক্ষণ করুন)
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
