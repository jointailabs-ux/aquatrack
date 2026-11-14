"use client";

import * as React from "react";
import Link from "next/link";
import {
  RotateCcw,
  Warehouse,
  Truck,
  Users,
  Building2,
  Sparkles,
  Wrench,
  Trash2,
  Droplets,
  Search,
  RefreshCw,
  Scale,
  History,
  AlertCircle,
  Phone,
  PackageCheck,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import {
  getJarSystemSummary,
  getCustomerJarHoldings,
  recordJarMovement,
  getJarLocations,
  getLocationJarCount,
  recordJarScrap,
  recordPhysicalStockAdjustment,
  getJarCustodyMovements,
} from "@/modules/jars/jar.service";
import { getDefaultWarehouse } from "@/modules/warehouses/warehouse.service";
import {
  ComprehensiveJarSystemSummary,
  CustomerJarHoldingSummary,
  JarCondition,
  JarCustodyLocation,
  JarMovementRecord,
} from "@/modules/jars/jar.schema";
import { formatDate } from "@/lib/utils";

type ActiveTab = "HOLDINGS" | "WAREHOUSE" | "DRIVERS" | "HISTORY";

export default function JarCustodyTrackingPage() {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = React.useState<ActiveTab>("HOLDINGS");
  const [summary, setSummary] = React.useState<ComprehensiveJarSystemSummary | null>(null);
  const [holdings, setHoldings] = React.useState<CustomerJarHoldingSummary[]>([]);
  const [movements, setMovements] = React.useState<JarMovementRecord[]>([]);
  const [locations, setLocations] = React.useState<JarCustodyLocation[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [warehouseLocationId, setWarehouseLocationId] = React.useState<string | null>(null);

  // Modal 1: Internal Plant Cycle Modal (Wash / Refill)
  const [isMoveModalOpen, setIsMoveModalOpen] = React.useState(false);
  const [moveQuantity, setMoveQuantity] = React.useState(10);
  const [fromCondition, setFromCondition] = React.useState<JarCondition>("EMPTY_DIRTY");
  const [toCondition, setToCondition] = React.useState<JarCondition>("EMPTY_CLEAN");
  const [isProcessingCycle, setIsProcessingCycle] = React.useState(false);

  // Modal 2: Jar Scrap / Disposal Modal
  const [isScrapModalOpen, setIsScrapModalOpen] = React.useState(false);
  const [scrapLocationId, setScrapLocationId] = React.useState<string>("");
  const [scrapCondition, setScrapCondition] = React.useState<"DAMAGED_REPAIRABLE" | "DAMAGED_SCRAP">("DAMAGED_REPAIRABLE");
  const [scrapQuantity, setScrapQuantity] = React.useState<number>(1);
  const [scrapDate, setScrapDate] = React.useState<string>(() => new Date().toISOString().split("T")[0]);
  const [scrapReason, setScrapReason] = React.useState<string>("");
  const [scrapAvailable, setScrapAvailable] = React.useState<number>(0);
  const [isScrapConfirmOpen, setIsScrapConfirmOpen] = React.useState(false);
  const [isScrapping, setIsScrapping] = React.useState(false);

  // Modal 3: Physical Stock Adjustment Modal
  const [isAdjustModalOpen, setIsAdjustModalOpen] = React.useState(false);
  const [adjustLocationId, setAdjustLocationId] = React.useState<string>("");
  const [adjustCondition, setAdjustCondition] = React.useState<JarCondition>("FULL_USABLE");
  const [adjustSystemQty, setAdjustSystemQty] = React.useState<number>(0);
  const [adjustActualQty, setAdjustActualQty] = React.useState<number>(0);
  const [adjustReason, setAdjustReason] = React.useState<string>("");
  const [adjustDate, setAdjustDate] = React.useState<string>(() => new Date().toISOString().split("T")[0]);
  const [isAdjustConfirmOpen, setIsAdjustConfirmOpen] = React.useState(false);
  const [isAdjusting, setIsAdjusting] = React.useState(false);

  // Load All Core Data
  const loadData = React.useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [sumRes, holdingsRes, whRes, locsRes, movRes] = await Promise.all([
        getJarSystemSummary(),
        getCustomerJarHoldings(),
        getDefaultWarehouse(),
        getJarLocations(),
        getJarCustodyMovements(60),
      ]);

      if (sumRes.success && sumRes.data) {
        setSummary(sumRes.data);
      }
      if (holdingsRes.success && holdingsRes.data) {
        setHoldings(holdingsRes.data);
      }
      if (whRes.success && whRes.data?.location_id) {
        setWarehouseLocationId(whRes.data.location_id);
      }
      if (locsRes.success && locsRes.data) {
        setLocations(locsRes.data);
      }
      if (movRes.success && movRes.data) {
        setMovements(movRes.data);
      }
    } catch (err: unknown) {
      console.error("Failed to load jar custody data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // Update Scrap Available Count when location or condition changes
  React.useEffect(() => {
    async function updateScrapAvailable() {
      if (!scrapLocationId) return;
      const count = await getLocationJarCount(scrapLocationId, scrapCondition);
      setScrapAvailable(count);
      if (scrapQuantity > count && count > 0) {
        setScrapQuantity(count);
      }
    }
    if (isScrapModalOpen && scrapLocationId) {
      updateScrapAvailable();
    }
  }, [isScrapModalOpen, scrapLocationId, scrapCondition, scrapQuantity]);

  // Update Adjust System Count when location or condition changes
  React.useEffect(() => {
    async function updateAdjustSystemQty() {
      if (!adjustLocationId) return;
      const count = await getLocationJarCount(adjustLocationId, adjustCondition);
      setAdjustSystemQty(count);
      setAdjustActualQty(count);
    }
    if (isAdjustModalOpen && adjustLocationId) {
      updateAdjustSystemQty();
    }
  }, [isAdjustModalOpen, adjustLocationId, adjustCondition]);

  // Open Scrap Modal
  const openScrapModal = () => {
    const defaultLoc = warehouseLocationId || (locations.length > 0 ? locations[0].id : "");
    setScrapLocationId(defaultLoc);
    setScrapCondition("DAMAGED_REPAIRABLE");
    setScrapQuantity(1);
    setScrapDate(new Date().toISOString().split("T")[0]);
    setScrapReason("");
    setIsScrapConfirmOpen(false);
    setIsScrapModalOpen(true);
  };

  // Open Adjustment Modal
  const openAdjustModal = () => {
    const defaultLoc = warehouseLocationId || (locations.length > 0 ? locations[0].id : "");
    setAdjustLocationId(defaultLoc);
    setAdjustCondition("FULL_USABLE");
    setAdjustReason("");
    setAdjustDate(new Date().toISOString().split("T")[0]);
    setIsAdjustConfirmOpen(false);
    setIsAdjustModalOpen(true);
  };

  // Handle Plant Cycle Submit (Washing/Filling)
  const handleRecordCycle = async () => {
    if (!warehouseLocationId) {
      addToast({
        type: "error",
        title: "Warehouse Missing",
        message: "Central warehouse depot location could not be determined.",
      });
      return;
    }

    setIsProcessingCycle(true);
    try {
      const movementRes = await recordJarMovement({
        source_location_id: warehouseLocationId,
        destination_location_id: warehouseLocationId,
        condition_from: fromCondition,
        condition_to: toCondition,
        quantity: moveQuantity,
        movement_type:
          fromCondition === "EMPTY_DIRTY"
            ? "WASHING_CYCLE_DIRTY_TO_CLEAN"
            : "FILLING_CYCLE_CLEAN_TO_FULL",
        notes: "Internal warehouse sanitization & processing cycle",
      });

      if (movementRes.success) {
        addToast({
          type: "success",
          title: "Processing Cycle Recorded",
          message: `Processed ${moveQuantity} jars from ${fromCondition} to ${toCondition}.`,
        });
        setIsMoveModalOpen(false);
        loadData(true);
      } else {
        addToast({
          type: "error",
          title: "Operation Failed",
          message: movementRes.error || "Failed to record jar movement.",
        });
      }
    } finally {
      setIsProcessingCycle(false);
    }
  };

  // Handle Scrap Submit
  const handleScrapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (scrapQuantity <= 0) {
      addToast({ type: "error", title: "Invalid Quantity", message: "Disposal quantity must be greater than zero." });
      return;
    }
    if (scrapQuantity > scrapAvailable) {
      addToast({
        type: "error",
        title: "Insufficient Stock",
        message: `Cannot dispose ${scrapQuantity} jars: only ${scrapAvailable} damaged jars available at this location.`,
      });
      return;
    }
    if (!scrapReason.trim()) {
      addToast({ type: "error", title: "Reason Required", message: "Please provide a reason for scrapping." });
      return;
    }
    setIsScrapConfirmOpen(true);
  };

  const handleConfirmScrap = async () => {
    setIsScrapping(true);
    try {
      const res = await recordJarScrap({
        source_location_id: scrapLocationId,
        condition_from: scrapCondition,
        quantity: scrapQuantity,
        disposal_date: scrapDate,
        reason: scrapReason.trim(),
      });

      if (res.success) {
        addToast({
          type: "success",
          title: "Jars Scrapped Successfully",
          message: `Recorded scrap write-off of ${scrapQuantity} jars. Audit record created.`,
        });
        setIsScrapConfirmOpen(false);
        setIsScrapModalOpen(false);
        loadData(true);
      } else {
        addToast({
          type: "error",
          title: "Scrap Failed",
          message: res.error || "Failed to mark jars as scrapped.",
        });
      }
    } catch (err: unknown) {
      addToast({
        type: "error",
        title: "Error",
        message: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    } finally {
      setIsScrapping(false);
    }
  };

  // Handle Physical Stock Adjustment Submit
  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adjustActualQty < 0) {
      addToast({ type: "error", title: "Invalid Quantity", message: "Physical count cannot be negative." });
      return;
    }
    if (!adjustReason.trim()) {
      addToast({ type: "error", title: "Reason Required", message: "Please provide a reason for the adjustment." });
      return;
    }

    const delta = adjustActualQty - adjustSystemQty;
    if (delta === 0) {
      addToast({
        type: "info",
        title: "No Adjustment Needed",
        message: "Physical quantity matches current system quantity.",
      });
      setIsAdjustModalOpen(false);
      return;
    }

    setIsAdjustConfirmOpen(true);
  };

  const handleConfirmAdjust = async () => {
    setIsAdjusting(true);
    try {
      const res = await recordPhysicalStockAdjustment({
        location_id: adjustLocationId,
        condition: adjustCondition,
        actual_quantity: adjustActualQty,
        reason: adjustReason.trim(),
        adjustment_date: adjustDate,
      });

      if (res.success && res.data) {
        const diff = res.data.difference;
        addToast({
          type: "success",
          title: "Physical Adjustment Committed",
          message: `Adjusted ${adjustCondition} from ${res.data.previousQuantity} to ${res.data.newQuantity} (Δ: ${diff > 0 ? "+" : ""}${diff}).`,
        });
        setIsAdjustConfirmOpen(false);
        setIsAdjustModalOpen(false);
        loadData(true);
      } else {
        addToast({
          type: "error",
          title: "Adjustment Failed",
          message: res.error || "Failed to adjust stock.",
        });
      }
    } catch (err: unknown) {
      addToast({
        type: "error",
        title: "Error",
        message: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    } finally {
      setIsAdjusting(false);
    }
  };

  const filteredHoldings = holdings.filter((h) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      h.customer_name.toLowerCase().includes(q) ||
      h.phone.includes(q)
    );
  });

  const totalWithStaff = summary ? summary.staff.reduce((s, x) => s + x.total, 0) : 0;
  const scrapLocationObj = locations.find((l) => l.id === scrapLocationId);
  const adjustLocationObj = locations.find((l) => l.id === adjustLocationId);
  const adjustDelta = adjustActualQty - adjustSystemQty;

  const totalCustomerJars = summary ? summary.total_with_customers.total : 0;
  const totalWarehouseJars = summary ? summary.warehouse.total_warehouse : 0;
  const totalSupplierJars = summary ? summary.total_with_suppliers : 0;
  const totalScrapJars = summary ? summary.warehouse.damaged_scrap : 0;
  const grandTotal = summary ? summary.grand_total_system_jars : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. VISUAL PAGE HEADER */}
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-cyan-600 via-blue-600 to-indigo-700 p-5 sm:p-7 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-xs font-semibold text-white/95 mb-2">
              <Droplets className="h-4 w-4 text-cyan-200 fill-cyan-200" />
              <span>জার ট্র্যাকিং ও হিসাব (Jar Asset Accounting)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Jar Tracking & Live Custody
            </h1>
            <p className="text-xs sm:text-sm text-cyan-100/90 mt-1 max-w-2xl">
              Easy visual view of all reusable 20L water jars: in warehouse, with customers, on delivery vans, or damaged.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadData(true)}
              disabled={refreshing || loading}
              className="bg-white/10 hover:bg-white/20 text-white border-white/25 text-xs font-semibold backdrop-blur-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            <Button
              size="sm"
              onClick={() => setIsMoveModalOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs shadow-md shadow-emerald-950/20"
            >
              <Droplets className="h-3.5 w-3.5 mr-1.5" />
              ওয়াশ / রিফিল (Wash/Refill)
            </Button>

            <Button
              size="sm"
              onClick={openScrapModal}
              className="bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs shadow-md shadow-rose-950/20"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              ভাঙা জার (Scrap)
            </Button>

            <Button
              size="sm"
              onClick={openAdjustModal}
              className="bg-amber-500 hover:bg-amber-600 text-black font-extrabold text-xs shadow-md shadow-amber-950/20"
            >
              <Scale className="h-3.5 w-3.5 mr-1.5" />
              গণনা ঠিক করুন (Audit)
            </Button>
          </div>
        </div>
      </div>

      {/* 2. BIG VISUAL CUSTODY CARDS (Where are all the jars right now?) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <span>বর্তমানে সব জার কোথায় আছে?</span>
            <span className="text-xs font-normal text-muted-foreground">(Live Jar Locations)</span>
          </h2>
          <Badge variant="outline" className="text-xs font-mono font-bold">
            Total Assets: {grandTotal.toLocaleString()} Jars
          </Badge>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          {/* 1. Warehouse */}
          <div className="rounded-2xl border-2 border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20 p-4 transition-all hover:shadow-md flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-700 dark:text-blue-300">🏭 গুদামে জার</span>
              <div className="h-8 w-8 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <Warehouse className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl sm:text-3xl font-black text-blue-700 dark:text-blue-300">
                {totalWarehouseJars.toLocaleString()}
              </div>
              <p className="text-[11px] font-medium text-blue-600/80 dark:text-blue-400/80 mt-0.5">
                In Warehouse Depot
              </p>
            </div>
          </div>

          {/* 2. With Customers */}
          <div className="rounded-2xl border-2 border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 transition-all hover:shadow-md flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">👥 গ্রাহকদের বাড়িতে</span>
              <div className="h-8 w-8 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <Users className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl sm:text-3xl font-black text-emerald-700 dark:text-emerald-300">
                {totalCustomerJars.toLocaleString()}
              </div>
              <p className="text-[11px] font-medium text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                Holding at Houses/Shops
              </p>
            </div>
          </div>

          {/* 3. With Delivery Drivers */}
          <div className="rounded-2xl border-2 border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 p-4 transition-all hover:shadow-md flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-700 dark:text-amber-300">🚚 গাড়িতে / ডেলিভারিতে</span>
              <div className="h-8 w-8 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
                <Truck className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl sm:text-3xl font-black text-amber-700 dark:text-amber-300">
                {totalWithStaff.toLocaleString()}
              </div>
              <p className="text-[11px] font-medium text-amber-600/80 dark:text-amber-400/80 mt-0.5">
                On Delivery Vans
              </p>
            </div>
          </div>

          {/* 4. With Suppliers/Plant */}
          <div className="rounded-2xl border-2 border-purple-500/30 bg-purple-50/50 dark:bg-purple-950/20 p-4 transition-all hover:shadow-md flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-purple-700 dark:text-purple-300">🏢 প্ল্যান্টে / সাপ্লায়ারের কাছে</span>
              <div className="h-8 w-8 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
                <Building2 className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl sm:text-3xl font-black text-purple-700 dark:text-purple-300">
                {totalSupplierJars.toLocaleString()}
              </div>
              <p className="text-[11px] font-medium text-purple-600/80 dark:text-purple-400/80 mt-0.5">
                Sent for Refilling
              </p>
            </div>
          </div>

          {/* 5. Damaged / Scrap */}
          <div className="rounded-2xl border-2 border-rose-500/30 bg-rose-50/50 dark:bg-rose-950/20 p-4 transition-all hover:shadow-md flex flex-col justify-between col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-rose-700 dark:text-rose-300">⚠️ ভাঙা / নষ্ট জার</span>
              <div className="h-8 w-8 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-400">
                <Trash2 className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2">
              <div className="text-2xl sm:text-3xl font-black text-rose-700 dark:text-rose-300">
                {totalScrapJars.toLocaleString()}
              </div>
              <p className="text-[11px] font-medium text-rose-600/80 dark:text-rose-400/80 mt-0.5">
                Damaged / Scrapped
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 3. VISUAL WAREHOUSE PROCESSING PIPELINE */}
      <div className="rounded-3xl border border-border bg-card p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/80 pb-3 mb-4">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-primary" />
              গুদামের জার চক্র (Warehouse Cycle Pipeline)
            </h3>
            <p className="text-xs text-muted-foreground">
              Jars in central warehouse by physical status. Tap button above to record washing or filling.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsMoveModalOpen(true)}
            className="text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10 self-start sm:self-auto"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            নতুন সাইকেল চালান (Run Cycle)
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {/* Step 1: Ready Full Jars */}
          <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/10 p-4 space-y-2 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-emerald-800 dark:text-emerald-300">
                💧 ১. ভরা জার (Full Jars)
              </span>
              <Droplets className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="text-3xl font-black text-emerald-700 dark:text-emerald-300">
              {summary ? summary.warehouse.full_usable : 0}
            </div>
            <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80 font-medium">
              Ready for immediate delivery
            </p>
          </div>

          {/* Step 2: Sanitized Clean Empties */}
          <div className="rounded-2xl border-2 border-blue-500/40 bg-blue-500/10 p-4 space-y-2 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-blue-800 dark:text-blue-300">
                ✨ ২. পরিষ্কার খালি (Clean Empty)
              </span>
              <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="text-3xl font-black text-blue-700 dark:text-blue-300">
              {summary ? summary.warehouse.empty_clean : 0}
            </div>
            <p className="text-[11px] text-blue-800/80 dark:text-blue-200/80 font-medium">
              Washed & ready to refill
            </p>
          </div>

          {/* Step 3: Dirty Empties Returned */}
          <div className="rounded-2xl border-2 border-amber-500/40 bg-amber-500/10 p-4 space-y-2 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-amber-800 dark:text-amber-300">
                🔄 ৩. ধোয়ার জন্য খালি (Dirty)
              </span>
              <RotateCcw className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="text-3xl font-black text-amber-700 dark:text-amber-300">
              {summary ? summary.warehouse.empty_dirty : 0}
            </div>
            <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80 font-medium">
              Needs sanitization wash
            </p>
          </div>

          {/* Step 4: Damaged / Repairable */}
          <div className="rounded-2xl border-2 border-orange-500/40 bg-orange-500/10 p-4 space-y-2 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-orange-800 dark:text-orange-300">
                ⚠️ ৪. মেরামত / ভাঙা (Damaged)
              </span>
              <Wrench className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="text-3xl font-black text-orange-700 dark:text-orange-300">
              {summary ? summary.warehouse.damaged_repairable : 0}
            </div>
            <p className="text-[11px] text-orange-800/80 dark:text-orange-200/80 font-medium">
              Requires repair or disposal
            </p>
          </div>
        </div>
      </div>

      {/* 4. TABS NAVIGATION */}
      <div className="flex items-center gap-2 border-b border-border overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => setActiveTab("HOLDINGS")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "HOLDINGS"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          গ্রাহকদের কাছে জার ({holdings.length})
        </button>

        <button
          onClick={() => setActiveTab("DRIVERS")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "DRIVERS"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Truck className="h-4 w-4" />
          ডেলিভারি স্টাফ ও গাড়ি ({summary?.staff.length || 0})
        </button>

        <button
          onClick={() => setActiveTab("HISTORY")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "HISTORY"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <History className="h-4 w-4" />
          জার লেনদেনের হিসাব ({movements.length})
        </button>
      </div>

      {/* TAB 1: VISUAL CUSTOMER JAR CARDS (Simple, colorful, easy for anyone to see) */}
      {activeTab === "HOLDINGS" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/40 p-4 rounded-2xl border border-border/70">
            <div>
              <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                কোন গ্রাহকের কাছে কয়টি জার আছে? (Customer Jar Holdings)
              </h3>
              <p className="text-xs text-muted-foreground">
                When Sunita had 5 jars, delivered 3 and collected 5, her holding is 3 jars. Accurate physical balance.
              </p>
            </div>

            <div className="w-full sm:w-72 relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="গ্রাহকের নাম বা ফোন নম্বর খুঁজুন..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs h-9 bg-background rounded-xl"
              />
            </div>
          </div>

          {filteredHoldings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground text-xs">
              কোন গ্রাহক পাওয়া যায়নি (No customers match search).
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
              {filteredHoldings.map((c) => {
                const totalHolding = c.total_holding;
                const hasEmptiesDue = c.pending_empty_collections > 0;

                return (
                  <div
                    key={c.customer_id}
                    className="group rounded-3xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs hover:shadow-md transition-all space-y-3.5 relative overflow-hidden"
                  >
                    {/* Top Row: Customer Name & 1-Tap Call */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="font-bold text-sm sm:text-base text-foreground truncate group-hover:text-primary transition-colors">
                          {c.customer_name}
                        </h4>
                        <div className="flex items-center gap-2 mt-0.5">
                          <a
                            href={`tel:${c.phone}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                            title="Call customer directly"
                          >
                            <Phone className="h-3 w-3" />
                            {c.phone}
                          </a>
                        </div>
                      </div>

                      {/* Prominent Jar Badge */}
                      <div className="shrink-0 text-right">
                        <div className={`px-3 py-1.5 rounded-2xl font-black text-center ${
                          totalHolding > 0
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          <span className="text-lg sm:text-xl leading-none block">{totalHolding}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider block">জার (Jars)</span>
                        </div>
                      </div>
                    </div>

                    {/* Visual Jar Breakdown Bar */}
                    <div className="bg-muted/30 p-2.5 rounded-2xl border border-border/50 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1">
                          <Droplets className="h-3.5 w-3.5" />
                          ভরা জার: <strong>{c.total_full_jars_holding}</strong>
                        </span>
                        <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <RotateCcw className="h-3.5 w-3.5" />
                          খালি বোতল: <strong>{c.total_empty_jars_holding}</strong>
                        </span>
                      </div>

                      {hasEmptiesDue && (
                        <div className="text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/15 px-2 py-1 rounded-lg flex items-center justify-between">
                          <span>ফেরত দেওয়ার কথা:</span>
                          <span>{c.pending_empty_collections} টি খালি জার</span>
                        </div>
                      )}
                    </div>

                    {/* Bottom Action Footer */}
                    <div className="flex items-center justify-between pt-1 border-t border-border/60 text-xs">
                      <span className="text-muted-foreground text-[11px]">
                        জমা রাখা টাকা: <strong className="text-foreground">₹{c.total_deposit_held.toLocaleString()}</strong>
                      </span>

                      <Link
                        href={`/orders?customer=${c.customer_id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground font-bold text-xs transition-colors"
                      >
                        <PackageCheck className="h-3.5 w-3.5" />
                        <span>অর্ডার দিন</span>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: DELIVERY DRIVERS & VEHICLES (ডেলিভারি স্টাফ ও গাড়ি) */}
      {activeTab === "DRIVERS" && (
        <div className="space-y-4">
          <div className="bg-muted/40 p-4 rounded-2xl border border-border/70">
            <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" />
              ডেলিভারি ভ্যানে থাকা জারের হিসাব (Delivery Fleet Jar Stock)
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live custody of water jars currently loaded on delivery vehicles out on delivery routes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(summary?.staff || []).map((s) => (
              <div
                key={s.staff_id}
                className="rounded-3xl border border-border bg-card p-5 shadow-xs space-y-3.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                      <Truck className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-foreground">{s.staff_name}</h4>
                      <span className="text-[11px] text-muted-foreground">Delivery Route Van</span>
                    </div>
                  </div>

                  <Badge className="bg-amber-500 hover:bg-amber-600 text-black font-extrabold text-xs px-2.5 py-1">
                    {s.total} টি জার
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-muted/30 p-2.5 rounded-2xl border border-border/40 text-center">
                  <div>
                    <span className="text-[10px] text-muted-foreground block">ভরা জার</span>
                    <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                      {s.full_jars}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground block">খালি জার</span>
                    <span className="text-sm font-black text-amber-600 dark:text-amber-400">
                      {s.empty_jars}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground block">ভাঙা</span>
                    <span className="text-sm font-black text-rose-600 dark:text-rose-400">
                      {s.damaged_jars}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {(summary?.staff || []).length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground text-xs">
                কোন ডেলিভারি স্টাফ বা গাড়িতে জার নেই (No jars currently on vehicles).
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: IMMUTABLE JAR MOVEMENT HISTORY (সহজ লেনদেনের ইতিহাস) */}
      {activeTab === "HISTORY" && (
        <Card className="border-border shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="p-5 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" />
                  জার লেনদেনের হিসাব ও প্রমাণ (Jar Movement History)
                </CardTitle>
                <CardDescription className="text-xs">
                  Every jar movement is recorded permanently with timestamp and quantity.
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-xs">
                Last {movements.length} records
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {/* Mobile View: High Density Colorful Cards */}
            <div className="md:hidden divide-y divide-border/60">
              {movements.map((m) => (
                <div key={m.id} className="p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant={
                        m.movement_type === "SCRAP_WRITEOFF"
                          ? "destructive"
                          : m.movement_type === "INTERNAL_ADJUSTMENT"
                          ? "warning"
                          : m.movement_type === "CUSTOMER_DELIVERY"
                          ? "success"
                          : "outline"
                      }
                      className="text-[10px] py-0"
                    >
                      {m.movement_type}
                    </Badge>
                    <span className="text-xs font-black text-foreground">
                      {m.quantity} টি জার
                    </span>
                  </div>

                  <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                    <span>{m.source_location_name || "—"} &rarr; {m.destination_location_name || "—"}</span>
                    <span>{formatDate(m.created_at)}</span>
                  </div>

                  {m.notes && (
                    <p className="text-[11px] text-muted-foreground italic bg-muted/20 p-1.5 rounded-lg">
                      {m.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop View Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/40 text-muted-foreground border-y border-border">
                  <tr>
                    <th className="py-3 px-4 font-semibold">তারিখ (Date)</th>
                    <th className="py-3 px-4 font-semibold">ধরণ (Type)</th>
                    <th className="py-3 px-4 font-semibold">কৈফিয়ত (Flow)</th>
                    <th className="py-3 px-4 font-semibold text-right">সংখ্যা (Qty)</th>
                    <th className="py-3 px-4 font-semibold">কোথা থেকে &rarr; কোথায়</th>
                    <th className="py-3 px-4 font-semibold">মন্তব্য (Notes)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {movements.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                        {formatDate(m.created_at)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <Badge
                          variant={
                            m.movement_type === "SCRAP_WRITEOFF"
                              ? "destructive"
                              : m.movement_type === "INTERNAL_ADJUSTMENT"
                              ? "warning"
                              : m.movement_type === "CUSTOMER_DELIVERY"
                              ? "success"
                              : "outline"
                          }
                          className="text-[10px] py-0"
                        >
                          {m.movement_type}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] font-semibold text-foreground">
                        {m.condition_from} &rarr; {m.condition_to}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-black text-foreground">
                        {m.quantity}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-semibold text-foreground">{m.source_location_name || "Depot"}</span>
                        <span className="text-muted-foreground mx-1">&rarr;</span>
                        <span className="font-semibold text-foreground">{m.destination_location_name || "Customer"}</span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground max-w-xs truncate" title={m.notes || ""}>
                        {m.notes || "—"}
                      </td>
                    </tr>
                  ))}
                  {movements.length === 0 && !loading && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-xs text-muted-foreground">
                        কোন জার রেকর্ড নেই (No jar movements recorded yet).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* MODAL 1: WASHING / FILLING CYCLE MODAL */}
      {isMoveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-card border border-border p-5 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-emerald-500" />
                ওয়াশ / রিফিল রেকর্ড করুন (Washing / Filling)
              </h3>
              <button
                onClick={() => setIsMoveModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-xl text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Move returned empty jars to clean sanitized state, or filled ready water jars.
            </p>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  বর্তমান অবস্থা (Source Condition)
                </label>
                <select
                  value={fromCondition}
                  onChange={(e) => {
                    const from = e.target.value as JarCondition;
                    setFromCondition(from);
                    if (from === "EMPTY_DIRTY") setToCondition("EMPTY_CLEAN");
                    else if (from === "EMPTY_CLEAN") setToCondition("FULL_USABLE");
                  }}
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="EMPTY_DIRTY">🔄 EMPTY_DIRTY (নোংরা খালি জার - ধোয়ার জন্য)</option>
                  <option value="EMPTY_CLEAN">✨ EMPTY_CLEAN (পরিষ্কার খালি জার - ভরার জন্য)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  পরবর্তী অবস্থা (Target Condition)
                </label>
                <select
                  value={toCondition}
                  onChange={(e) => setToCondition(e.target.value as JarCondition)}
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {fromCondition === "EMPTY_DIRTY" ? (
                    <option value="EMPTY_CLEAN">✨ EMPTY_CLEAN (ধোয়া ও পরিষ্কার শেষ)</option>
                  ) : (
                    <option value="FULL_USABLE">💧 FULL_USABLE (জল ভরা ও সিল করা শেষ)</option>
                  )}
                </select>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    জারের সংখ্যা (Quantity) *
                  </label>
                  <div className="flex items-center gap-1">
                    {[10, 25, 50, 100, 200].map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        onClick={() => setMoveQuantity(qty)}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-lg transition-colors cursor-pointer ${
                          moveQuantity === qty
                            ? "bg-primary text-white"
                            : "bg-muted hover:bg-muted/80 text-foreground"
                        }`}
                      >
                        {qty}
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  type="number"
                  value={moveQuantity}
                  onChange={(e) => setMoveQuantity(Number(e.target.value))}
                  min={1}
                  className="text-xs font-bold rounded-xl"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsMoveModalOpen(false)}
                disabled={isProcessingCycle}
                className="rounded-xl"
              >
                বাতিল (Cancel)
              </Button>
              <Button
                size="sm"
                onClick={handleRecordCycle}
                disabled={isProcessingCycle || moveQuantity <= 0}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl"
              >
                {isProcessingCycle ? "রেকর্ড হচ্ছে..." : "কনফার্ম করুন (Confirm)"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: JAR SCRAP MODAL */}
      {isScrapModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-card border border-border p-5 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-rose-500" />
                ভাঙা বা নষ্ট জার স্ক্র্যাপ করুন (Scrap Disposal)
              </h3>
              <button
                onClick={() => setIsScrapModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-xl text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleScrapSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  স্থান / লোকেশন (Location)
                </label>
                <select
                  value={scrapLocationId}
                  onChange={(e) => setScrapLocationId(e.target.value)}
                  required
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  অবস্থা (Condition to Scrap)
                </label>
                <select
                  value={scrapCondition}
                  onChange={(e) =>
                    setScrapCondition(e.target.value as "DAMAGED_REPAIRABLE" | "DAMAGED_SCRAP")
                  }
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="DAMAGED_REPAIRABLE">
                    ⚠️ DAMAGED_REPAIRABLE (বেশি ভাঙা, মেরামত অসম্ভব)
                  </option>
                  <option value="DAMAGED_SCRAP">
                    🗑️ DAMAGED_SCRAP (সম্পূর্ণ নষ্ট, বাতিল)
                  </option>
                </select>
              </div>

              <div className="rounded-2xl border border-border bg-muted/20 p-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">ভাঙা জার মজুদ আছে:</span>
                <span className="font-mono font-bold text-foreground">
                  {scrapAvailable} টি জার
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">কয়টি জার বাতিল করবেন</label>
                  <Input
                    type="number"
                    min={1}
                    max={scrapAvailable}
                    value={scrapQuantity}
                    onChange={(e) => setScrapQuantity(Number(e.target.value))}
                    required
                    className="text-xs rounded-xl"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">তারিখ</label>
                  <Input
                    type="date"
                    value={scrapDate}
                    onChange={(e) => setScrapDate(e.target.value)}
                    required
                    className="text-xs rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">বাতিলের কারণ (Reason) *</label>
                <Input
                  placeholder="যেমন: তলা ফেটে গেছে, মুখের সিল নষ্ট ইত্যাদি"
                  value={scrapReason}
                  onChange={(e) => setScrapReason(e.target.value)}
                  required
                  className="text-xs rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsScrapModalOpen(false)}
                  className="rounded-xl"
                >
                  বাতিল (Cancel)
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={scrapAvailable === 0 || scrapQuantity <= 0 || scrapQuantity > scrapAvailable}
                  className="bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl"
                >
                  কনফার্ম করুন
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL: JAR SCRAP */}
      {isScrapConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-3xl bg-card border border-destructive/40 p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-rose-600">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <h4 className="font-bold text-sm">স্থায়ীভাবে বাতিল কনফার্ম করুন</h4>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              আপনি কি নিশ্চিত যে <strong className="text-foreground">{scrapLocationObj?.name || "নির্বাচিত স্থান"}</strong> থেকে <strong className="text-foreground">{scrapQuantity} টি জার</strong> স্ক্র্যাপ হিসেবে সিস্টেম থেকে স্থায়ীভাবে বাতিল করতে চান?
            </p>

            <div className="rounded-xl bg-muted/40 p-2.5 text-[11px] text-muted-foreground space-y-1">
              <div>কারণ: <span className="text-foreground font-medium">{scrapReason}</span></div>
              <p className="text-rose-600 dark:text-rose-400 font-semibold pt-1 border-t border-border/50">
                এই প্রক্রিয়াটি স্থায়ী এবং ফেরত আনা সম্ভব নয়।
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsScrapConfirmOpen(false)}
                disabled={isScrapping}
                className="rounded-xl"
              >
                ফিরে যান
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmScrap}
                disabled={isScrapping}
                className="bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl"
              >
                {isScrapping ? "বাতিল হচ্ছে..." : "হ্যাঁ, স্থায়ীভাবে বাতিল করুন"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: PHYSICAL AUDIT ADJUSTMENT */}
      {isAdjustModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-card border border-border p-5 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Scale className="h-5 w-5 text-amber-500" />
                সরাসরি স্টক গণনা ঠিক করুন (Stock Audit)
              </h3>
              <button
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-xl text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              If physical count in warehouse differs from computer balance, enter actual count here.
            </p>

            <form onSubmit={handleAdjustSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  লোকেশন (Location)
                </label>
                <select
                  value={adjustLocationId}
                  onChange={(e) => setAdjustLocationId(e.target.value)}
                  required
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  জারের অবস্থা (Condition)
                </label>
                <select
                  value={adjustCondition}
                  onChange={(e) => setAdjustCondition(e.target.value as JarCondition)}
                  className="w-full rounded-xl border border-border bg-background p-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="FULL_USABLE">💧 ১. FULL_USABLE (ভরা জল জার)</option>
                  <option value="EMPTY_CLEAN">✨ ২. EMPTY_CLEAN (পরিষ্কার খালি)</option>
                  <option value="EMPTY_DIRTY">🔄 ৩. EMPTY_DIRTY (নোংরা খালি)</option>
                  <option value="DAMAGED_REPAIRABLE">⚠️ ৪. DAMAGED_REPAIRABLE (ভাঙা/মেরামত)</option>
                  <option value="DAMAGED_SCRAP">🗑️ ৫. DAMAGED_SCRAP (স্ক্র্যাপ)</option>
                </select>
              </div>

              <div className="rounded-2xl border border-border bg-muted/20 p-3 space-y-2 text-xs">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>কম্পিউটারে বর্তমান সংখ্যা:</span>
                  <span className="font-mono font-bold text-foreground">{adjustSystemQty} টি জার</span>
                </div>

                <div className="flex justify-between items-center gap-2 pt-1 border-t border-border/50">
                  <label className="font-semibold text-foreground">গুদামে গুনে কয়টি পেলেন?</label>
                  <Input
                    type="number"
                    min={0}
                    value={adjustActualQty}
                    onChange={(e) => setAdjustActualQty(Math.max(0, Number(e.target.value)))}
                    required
                    className="w-28 text-xs h-8 text-right font-bold rounded-xl"
                  />
                </div>

                <div className="flex justify-between items-center pt-1 border-t border-border/50">
                  <span className="font-semibold text-foreground">পার্থক্য (Difference):</span>
                  {adjustDelta > 0 ? (
                    <Badge variant="success" className="text-[10px] py-0 font-mono">
                      বেশি: +{adjustDelta} Jars
                    </Badge>
                  ) : adjustDelta < 0 ? (
                    <Badge variant="warning" className="text-[10px] py-0 font-mono">
                      কম: {adjustDelta} Jars
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground font-mono">
                      সমান (0)
                    </Badge>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  কারণ (Reason) *
                </label>
                <Input
                  placeholder="যেমন: সাপ্তাহিক অডিট বা গণনা সংশোধন"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  required
                  className="text-xs rounded-xl"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="rounded-xl"
                >
                  বাতিল
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={adjustDelta === 0 || !adjustReason.trim()}
                  className="bg-amber-500 hover:bg-amber-600 text-black font-extrabold rounded-xl"
                >
                  যাচাই করে সেভ করুন
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL: PHYSICAL STOCK ADJUSTMENT */}
      {isAdjustConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-3xl bg-card border border-primary/40 p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-primary">
              <Scale className="h-5 w-5 shrink-0" />
              <h4 className="font-bold text-sm">গণনা সংশোধন নিশ্চিত করুন</h4>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">{adjustLocationObj?.name || "নির্বাচিত স্থান"}</strong>-এ সিস্টেম স্টক <strong className="text-foreground">{adjustSystemQty}</strong> থেকে পরিবর্তন করে{" "}
              <strong className="text-foreground">{adjustActualQty}</strong> করা হচ্ছে (
              <span className={adjustDelta > 0 ? "text-emerald-600 font-bold" : "text-amber-600 font-bold"}>
                পার্থক্য: {adjustDelta > 0 ? "+" : ""}{adjustDelta} টি জার
              </span>
              )।
            </p>

            <div className="rounded-xl bg-muted/40 p-2.5 text-[11px] text-muted-foreground space-y-1">
              <div>কারণ: <span className="text-foreground font-medium">{adjustReason}</span></div>
              <p className="text-primary font-medium pt-1 border-t border-border/50">
                এই অডিট হিস্টোরি স্থায়ীভাবে ট্রানজ্যাকশনে রেকর্ড থাকবে।
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsAdjustConfirmOpen(false)}
                disabled={isAdjusting}
                className="rounded-xl"
              >
                ফিরে যান
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmAdjust}
                disabled={isAdjusting}
                className="bg-amber-500 hover:bg-amber-600 text-black font-extrabold rounded-xl"
              >
                {isAdjusting ? "সেভ হচ্ছে..." : "হ্যাঁ, সেভ করুন"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
