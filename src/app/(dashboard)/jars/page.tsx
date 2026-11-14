"use client";

import * as React from "react";
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

type ActiveTab = "HOLDINGS" | "CUSTODY" | "MOVEMENTS";

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

  // Modal 1: Internal Plant Cycle Modal
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
        getJarCustodyMovements(50),
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

    // Step 2: Show confirmation before final commit
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

    // Step 2: Show confirmation before final commit
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
    const matchesSearch =
      h.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.phone.includes(searchQuery);
    return matchesSearch;
  });

  const totalWithStaff = summary ? summary.staff.reduce((s, x) => s + x.total, 0) : 0;
  const scrapLocationObj = locations.find((l) => l.id === scrapLocationId);
  const adjustLocationObj = locations.find((l) => l.id === adjustLocationId);
  const adjustDelta = adjustActualQty - adjustSystemQty;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Jar Custody & Condition Accounting
            </h1>
            <Badge variant="primary" className="text-xs">
              Single Depot Custody
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Strict tracking of reusable 20L jars across 5 physical conditions, 4 custodies, and owner audit adjustments.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => loadData(true)}
            disabled={refreshing || loading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsMoveModalOpen(true)}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Washing / Filling Cycle
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={openScrapModal}
            className="gap-1.5 text-xs border-rose-500/40 text-rose-600 hover:bg-rose-500/10 hover:text-rose-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Scrap / Disposal
          </Button>

          <Button
            size="sm"
            variant="primary"
            onClick={openAdjustModal}
            className="gap-1.5 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          >
            <Scale className="h-3.5 w-3.5" />
            Physical Stock Adjustment
          </Button>
        </div>
      </div>

      {/* SECTION 1: 9 CORE JAR DASHBOARD METRICS */}
      <div className="space-y-4">
        {/* Row 1: System Custody Locations (Customers, Drivers, Warehouse, Suppliers) */}
        <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {/* 1. Total Jars in Warehouse */}
          <Card className="border-border shadow-xs bg-card">
            <CardContent className="p-3.5 sm:p-4 space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-semibold">Total in Warehouse</span>
                <Warehouse className="h-4 w-4 text-blue-500 shrink-0" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400">
                {summary ? summary.warehouse.total_warehouse.toLocaleString() : 0}
              </div>
              <p className="text-[11px] text-muted-foreground">In central bottling depot</p>
            </CardContent>
          </Card>

          {/* 2. Total Jars with Customers */}
          <Card className="border-border shadow-xs bg-card">
            <CardContent className="p-3.5 sm:p-4 space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-semibold">Total with Customers</span>
                <Users className="h-4 w-4 text-emerald-500 shrink-0" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400">
                {summary ? summary.total_with_customers.total.toLocaleString() : 0}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Full: {summary ? summary.total_with_customers.full_jars : 0} • Empty: {summary ? summary.total_with_customers.empty_jars : 0}
              </p>
            </CardContent>
          </Card>

          {/* 3. Total Jars with Drivers */}
          <Card className="border-border shadow-xs bg-card">
            <CardContent className="p-3.5 sm:p-4 space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-semibold">Total with Drivers</span>
                <Truck className="h-4 w-4 text-amber-500 shrink-0" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400">
                {totalWithStaff.toLocaleString()}
              </div>
              <p className="text-[11px] text-muted-foreground">Onboard delivery vehicles</p>
            </CardContent>
          </Card>

          {/* 4. Total Jars with Suppliers / Plant */}
          <Card className="border-border shadow-xs bg-card">
            <CardContent className="p-3.5 sm:p-4 space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-semibold">Total with Suppliers / Plant</span>
                <Building2 className="h-4 w-4 text-purple-500 shrink-0" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400">
                {summary ? summary.total_with_suppliers.toLocaleString() : 0}
              </div>
              <p className="text-[11px] text-muted-foreground">At wholesale refilling partner</p>
            </CardContent>
          </Card>
        </div>

        {/* Row 2: 5 Warehouse Physical Conditions (Usable, Clean, Dirty, Repairable, Scrap) */}
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/80 pb-3">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <Warehouse className="h-5 w-5 text-primary" />
                Warehouse Custody — 5 Physical Conditions
              </h2>
              <p className="text-xs text-muted-foreground">
                Granular jar state accounting required for washing, filling, maintenance, and scrap write-offs.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Grand Total System Assets:
              </span>
              <Badge variant="outline" className="text-xs font-bold font-mono">
                {summary ? summary.grand_total_system_jars.toLocaleString() : 0} Jars
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-5 gap-2.5 sm:gap-3">
            {/* Condition 1: Full Usable */}
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 sm:p-3.5 space-y-1.5 sm:space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="success" className="text-[9px] sm:text-[10px] py-0 px-1">
                  1. FULL USABLE
                </Badge>
                <Droplets className="h-4 w-4 text-emerald-500 shrink-0" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400">
                {summary ? summary.warehouse.full_usable : 0}
              </div>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground">
                Filled & ready for route delivery
              </p>
            </div>

            {/* Condition 2: Empty Clean */}
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 sm:p-3.5 space-y-1.5 sm:space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="primary" className="text-[9px] sm:text-[10px] py-0 px-1">
                  2. EMPTY CLEAN
                </Badge>
                <Sparkles className="h-4 w-4 text-blue-500 shrink-0" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400">
                {summary ? summary.warehouse.empty_clean : 0}
              </div>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground">
                Sanitized & ready for filling
              </p>
            </div>

            {/* Condition 3: Empty Dirty */}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 sm:p-3.5 space-y-1.5 sm:space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="warning" className="text-[9px] sm:text-[10px] py-0 px-1">
                  3. EMPTY DIRTY
                </Badge>
                <RotateCcw className="h-4 w-4 text-amber-500 shrink-0" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-400">
                {summary ? summary.warehouse.empty_dirty : 0}
              </div>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground">
                Awaiting chemical wash cycle
              </p>
            </div>

            {/* Condition 4: Damaged Repairable */}
            <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3 sm:p-3.5 space-y-1.5 sm:space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="text-[9px] sm:text-[10px] py-0 px-1 bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30">
                  4. REPAIRABLE
                </Badge>
                <Wrench className="h-4 w-4 text-orange-500 shrink-0" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-orange-600 dark:text-orange-400">
                {summary ? summary.warehouse.damaged_repairable : 0}
              </div>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground">
                Minor valve/seal issues
              </p>
            </div>

            {/* Condition 5: Damaged Scrap */}
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 sm:p-3.5 space-y-1.5 sm:space-y-2 col-span-2 xs:col-span-1">
              <div className="flex items-center justify-between">
                <Badge variant="destructive" className="text-[9px] sm:text-[10px] py-0 px-1">
                  5. DAMAGED SCRAP
                </Badge>
                <Trash2 className="h-4 w-4 text-rose-500 shrink-0" />
              </div>
              <div className="text-xl sm:text-2xl font-black text-rose-600 dark:text-rose-400">
                {summary ? summary.warehouse.damaged_scrap : 0}
              </div>
              <p className="text-[10px] sm:text-[11px] text-muted-foreground">
                Unrepairable, written-off
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* TAB NAVIGATION */}
      <div className="flex items-center gap-2 sm:gap-4 border-b border-border overflow-x-auto scrollbar-none flex-nowrap">
        <button
          onClick={() => setActiveTab("HOLDINGS")}
          className={`pb-3 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-1.5 sm:gap-2 border-b-2 -mb-px shrink-0 touch-manipulation min-h-[42px] ${
            activeTab === "HOLDINGS"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          Customer Jar Holdings
          {holdings.length > 0 && (
            <Badge variant="outline" className="text-[10px] ml-1 px-1.5 py-0">
              {holdings.length}
            </Badge>
          )}
        </button>

        <button
          onClick={() => setActiveTab("CUSTODY")}
          className={`pb-3 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-1.5 sm:gap-2 border-b-2 -mb-px shrink-0 touch-manipulation min-h-[42px] ${
            activeTab === "CUSTODY"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Truck className="h-4 w-4" />
          Driver & Supplier Custody
        </button>

        <button
          onClick={() => setActiveTab("MOVEMENTS")}
          className={`pb-3 text-xs sm:text-sm font-semibold transition-colors flex items-center gap-1.5 sm:gap-2 border-b-2 -mb-px shrink-0 touch-manipulation min-h-[42px] ${
            activeTab === "MOVEMENTS"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="h-4 w-4" />
          Jar Movement & Audit History
          {movements.length > 0 && (
            <Badge variant="outline" className="text-[10px] ml-1 px-1.5 py-0">
              {movements.length}
            </Badge>
          )}
        </button>
      </div>

      {/* TAB 1: CUSTOMER JAR HOLDINGS */}
      {activeTab === "HOLDINGS" && (
        <Card className="border-border shadow-xs">
          <CardHeader className="p-5 pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Customer Jar Holdings & Collection Backlog
                </CardTitle>
                <CardDescription className="text-xs">
                  Real-time jar conservation balances per customer. Invariant: Dropped jars ≠ Returned empties.
                </CardDescription>
              </div>

              <div className="w-full sm:w-64">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search customer name or phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 text-xs h-9"
                  />
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {/* Mobile View: High-density Customer Holding Cards */}
            <div className="md:hidden divide-y divide-border/60">
              {filteredHoldings.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No customer holdings matched your search.
                </div>
              ) : (
                filteredHoldings.map((c) => (
                  <div key={c.customer_id} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-foreground">{c.customer_name}</h4>
                        <a
                          href={`tel:${c.phone}`}
                          className="text-[11px] text-primary hover:underline font-medium flex items-center gap-1 mt-0.5"
                        >
                          {c.phone}
                        </a>
                      </div>
                      {c.pending_empty_collections > 0 ? (
                        <Badge variant="warning" className="text-[9px] py-0 px-1.5 font-bold">
                          {c.pending_empty_collections} Empties Due
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] py-0 text-muted-foreground">
                          Clean
                        </Badge>
                      )}
                    </div>

                    {/* Jar Balances Grid */}
                    <div className="grid grid-cols-3 gap-2 bg-muted/30 p-2 rounded-lg border border-border/40 text-center">
                      <div>
                        <span className="text-[9px] text-muted-foreground block">Full Jars</span>
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                          {c.total_full_jars_holding}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-muted-foreground block">Empties</span>
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                          {c.total_empty_jars_holding}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-muted-foreground block">Total Holding</span>
                        <span className="text-xs font-extrabold text-foreground">
                          {c.total_holding} <span className="text-[9px] text-muted-foreground font-normal">/ {c.max_jar_limit}</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-0.5">
                      <span className="text-muted-foreground text-[10px]">
                        Deposit Held: <strong className="text-foreground">₹{c.total_deposit_held.toLocaleString()}</strong>
                      </span>
                      <a
                        href={`tel:${c.phone}`}
                        className="text-[11px] text-primary font-semibold hover:underline"
                      >
                        Call Customer &rarr;
                      </a>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Desktop View: Full Data Table */}
            <div className="hidden md:block overflow-x-auto relative">
              <table className="w-full text-left text-xs min-w-[750px]">
                <thead className="bg-muted/40 text-muted-foreground border-y border-border">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Customer</th>
                    <th className="py-3 px-4 font-semibold">Phone</th>
                    <th className="py-3 px-4 font-semibold text-right">Full Jars</th>
                    <th className="py-3 px-4 font-semibold text-right">Empty Jars</th>
                    <th className="py-3 px-4 font-semibold text-right">Total Holding</th>
                    <th className="py-3 px-4 font-semibold text-right">Holding Limit</th>
                    <th className="py-3 px-4 font-semibold text-right">Pending Pickups</th>
                    <th className="py-3 px-4 font-semibold text-right">Deposit Held</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredHoldings.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">
                        No customer holdings matched your search.
                      </td>
                    </tr>
                  ) : (
                    filteredHoldings.map((c) => (
                      <tr key={c.customer_id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 font-semibold text-foreground">
                          {c.customer_name}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">{c.phone}</td>
                        <td className="py-3 px-4 text-right font-medium text-blue-600 dark:text-blue-400">
                          {c.total_full_jars_holding}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-amber-600 dark:text-amber-400">
                          {c.total_empty_jars_holding}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-foreground">
                          {c.total_holding}
                        </td>
                        <td className="py-3 px-4 text-right text-muted-foreground">
                          {c.max_jar_limit}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {c.pending_empty_collections > 0 ? (
                            <Badge variant="warning" className="text-[10px] py-0 px-1.5">
                              {c.pending_empty_collections} Empties Due
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground">
                              Clean
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-foreground">
                          ₹{c.total_deposit_held.toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TAB 2: DRIVER & SUPPLIER CUSTODY */}
      {activeTab === "CUSTODY" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Driver Fleet Custody */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                Delivery Staff Float Custody
              </CardTitle>
              <CardDescription className="text-xs">
                Jars loaded on delivery vans currently in transit on routes.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              <div className="space-y-3">
                {(summary?.staff || []).map((s) => (
                  <div
                    key={s.staff_id}
                    className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20"
                  >
                    <div>
                      <h4 className="text-xs font-bold text-foreground">{s.staff_name}</h4>
                      <p className="text-[11px] text-muted-foreground">
                        Full: {s.full_jars} • Empties: {s.empty_jars} • Damaged: {s.damaged_jars}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant="secondary" className="font-bold text-xs">
                        {s.total} Jars
                      </Badge>
                    </div>
                  </div>
                ))}
                {(summary?.staff || []).length === 0 && (
                  <p className="text-xs text-center text-muted-foreground py-4">
                    No active staff route custody records found.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Supplier Plant Custody */}
          <Card className="border-border shadow-xs">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                Supplier / Bottling Plant Custody
              </CardTitle>
              <CardDescription className="text-xs">
                Empty jars returned to bottling partner for contract refilling.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">
                      Wholesale Bottling Partners
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      Authorized suppliers with jars in custody
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-bold text-foreground">
                      {summary ? summary.total_with_suppliers : 0} Jars
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground pt-1 border-t border-border/60">
                  Jars physically located at supplier plant awaiting return batch delivery.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 3: JAR MOVEMENT & AUDIT HISTORY */}
      {activeTab === "MOVEMENTS" && (
        <Card className="border-border shadow-xs">
          <CardHeader className="p-5 pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" />
                  Jar Custody Movement & Audit Trail
                </CardTitle>
                <CardDescription className="text-xs">
                  Permanent immutable transaction history from public.jar_custody_movements.
                </CardDescription>
              </div>
              <span className="text-xs text-muted-foreground">
                Showing last {movements.length} movements
              </span>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {/* Mobile View: High-density Jar Movement Cards */}
            <div className="md:hidden divide-y divide-border/60">
              {movements.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No jar custody movements recorded yet.
                </div>
              ) : (
                movements.map((m) => (
                  <div key={m.id} className="p-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
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
                          className="text-[9px] py-0"
                        >
                          {m.movement_type}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground block mt-0.5">
                          {formatDate(m.created_at)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-black font-mono text-foreground block">
                          {m.quantity} Jars
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {m.condition_from} &rarr; {m.condition_to}
                        </span>
                      </div>
                    </div>

                    {(m.source_location_name || m.destination_location_name) && (
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <span className="font-semibold text-foreground">{m.source_location_name || "—"}</span>
                        <span>&rarr;</span>
                        <span className="font-semibold text-foreground">{m.destination_location_name || "—"}</span>
                      </div>
                    )}

                    {m.notes && (
                      <p className="text-[11px] text-muted-foreground italic bg-muted/20 p-1.5 rounded-md">
                        {m.notes}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Desktop View: Full Data Table */}
            <div className="hidden md:block overflow-x-auto relative">
              <table className="w-full text-left text-xs min-w-[750px]">
                <thead className="bg-muted/40 text-muted-foreground border-y border-border">
                  <tr>
                    <th className="py-3 px-4 font-semibold">Date / Time</th>
                    <th className="py-3 px-4 font-semibold">Movement Type</th>
                    <th className="py-3 px-4 font-semibold">Condition Flow</th>
                    <th className="py-3 px-4 font-semibold text-right">Quantity</th>
                    <th className="py-3 px-4 font-semibold">Source $\to$ Destination</th>
                    <th className="py-3 px-4 font-semibold">Ref Type</th>
                    <th className="py-3 px-4 font-semibold">Notes / Reason</th>
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
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-mono text-[11px] font-semibold text-foreground">
                          {m.condition_from}
                        </span>
                        <span className="text-muted-foreground mx-1">$\to$</span>
                        <span className="font-mono text-[11px] font-semibold text-foreground">
                          {m.condition_to}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                        {m.quantity}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="text-foreground">{m.source_location_name}</span>
                        <span className="text-muted-foreground mx-1">$\to$</span>
                        <span className="text-foreground">{m.destination_location_name}</span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <Badge variant="outline" className="text-[10px] py-0">
                          {m.reference_type || "MANUAL"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground max-w-xs truncate" title={m.notes || ""}>
                        {m.notes || "—"}
                      </td>
                    </tr>
                  ))}
                  {movements.length === 0 && !loading && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-xs text-muted-foreground">
                        No jar custody movements recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* MODAL 1: INTERNAL PLANT CYCLE (WASHING / FILLING) */}
      {isMoveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-primary" />
                Record Washing / Filling Cycle
              </h3>
              <button
                onClick={() => setIsMoveModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Transition reusable jars between sanitization and water filling stages in the central warehouse depot.
            </p>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Source Jar Condition
                </label>
                <select
                  value={fromCondition}
                  onChange={(e) => {
                    const from = e.target.value as JarCondition;
                    setFromCondition(from);
                    if (from === "EMPTY_DIRTY") setToCondition("EMPTY_CLEAN");
                    else if (from === "EMPTY_CLEAN") setToCondition("FULL_USABLE");
                  }}
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="EMPTY_DIRTY">EMPTY_DIRTY (Returned from Customer Route)</option>
                  <option value="EMPTY_CLEAN">EMPTY_CLEAN (Sanitized Empties)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Target Jar Condition
                </label>
                <select
                  value={toCondition}
                  onChange={(e) => setToCondition(e.target.value as JarCondition)}
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {fromCondition === "EMPTY_DIRTY" ? (
                    <option value="EMPTY_CLEAN">EMPTY_CLEAN (Washing & Sanitization Complete)</option>
                  ) : (
                    <option value="FULL_USABLE">FULL_USABLE (Purified Water Filled & Sealed)</option>
                  )}
                </select>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    Batch Quantity (Jars) *
                  </label>
                  <div className="flex items-center gap-1">
                    {[10, 25, 50, 100, 200].map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        onClick={() => setMoveQuantity(qty)}
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
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
                  className="text-xs font-bold"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsMoveModalOpen(false)}
                disabled={isProcessingCycle}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleRecordCycle}
                disabled={isProcessingCycle || moveQuantity <= 0}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isProcessingCycle ? "Recording..." : "Confirm Cycle Entry"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: JAR SCRAP / DISPOSAL (OWNER ONLY) */}
      {isScrapModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-rose-500" />
                Jar Scrap / Disposal Write-Off
              </h3>
              <button
                onClick={() => setIsScrapModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Permanently mark damaged jars as scrapped when they cannot be repaired. Writes an immutable audit record.
            </p>

            <form onSubmit={handleScrapSubmit} className="space-y-3">
              {/* Custody Location */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Current Custody / Location
                </label>
                <select
                  value={scrapLocationId}
                  onChange={(e) => setScrapLocationId(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Damaged Condition */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Jar Condition to Scrap
                </label>
                <select
                  value={scrapCondition}
                  onChange={(e) =>
                    setScrapCondition(e.target.value as "DAMAGED_REPAIRABLE" | "DAMAGED_SCRAP")
                  }
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="DAMAGED_REPAIRABLE">
                    DAMAGED_REPAIRABLE (Severe damage, unrepairable)
                  </option>
                  <option value="DAMAGED_SCRAP">
                    DAMAGED_SCRAP (Already scrapped, physical recycling disposal)
                  </option>
                </select>
              </div>

              {/* Available Stock Indicator */}
              <div className="rounded-xl border border-border bg-muted/20 p-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Available Damaged Stock:</span>
                <span className="font-mono font-bold text-foreground">
                  {scrapAvailable} Jars
                </span>
              </div>

              {/* Quantity and Date */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Quantity to Scrap</label>
                  <Input
                    type="number"
                    min={1}
                    max={scrapAvailable}
                    value={scrapQuantity}
                    onChange={(e) => setScrapQuantity(Number(e.target.value))}
                    required
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Disposal Date</label>
                  <Input
                    type="date"
                    value={scrapDate}
                    onChange={(e) => setScrapDate(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Reason */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Reason for Disposal *</label>
                <Input
                  placeholder="e.g. Body puncture, neck hairline fracture, melted base"
                  value={scrapReason}
                  onChange={(e) => setScrapReason(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsScrapModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={scrapAvailable === 0 || scrapQuantity <= 0 || scrapQuantity > scrapAvailable}
                  className="bg-rose-600 hover:bg-rose-500 text-white font-semibold"
                >
                  Proceed to Confirm
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL: JAR SCRAP */}
      {isScrapConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-destructive/40 p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-rose-600">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <h4 className="font-bold text-sm">Confirm Irreversible Jar Scrap</h4>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Are you sure you want to scrap <strong className="text-foreground">{scrapQuantity} jars</strong> in condition{" "}
              <strong className="text-foreground">{scrapCondition}</strong> at{" "}
              <strong className="text-foreground">{scrapLocationObj?.name || "selected location"}</strong>?
            </p>

            <div className="rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground space-y-1">
              <div>Reason: <span className="text-foreground font-medium">{scrapReason}</span></div>
              <div>Date: <span className="text-foreground font-medium">{scrapDate}</span></div>
              <p className="text-rose-600 dark:text-rose-400 font-semibold pt-1 border-t border-border/50">
                This asset reduction cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsScrapConfirmOpen(false)}
                disabled={isScrapping}
              >
                Go Back
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmScrap}
                disabled={isScrapping}
                className="bg-rose-600 hover:bg-rose-500 text-white font-semibold"
              >
                {isScrapping ? "Writing Off..." : "Confirm Permanent Scrap"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: PHYSICAL STOCK ADJUSTMENT (OWNER ONLY) */}
      {isAdjustModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                Physical Stock Count Adjustment
              </h3>
              <button
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Reconcile physical stock audit counts with system balances. Never silently overwrites balances—records an audit movement.
            </p>

            <form onSubmit={handleAdjustSubmit} className="space-y-3">
              {/* Custody Location */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Custody Location
                </label>
                <select
                  value={adjustLocationId}
                  onChange={(e) => setAdjustLocationId(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Jar Condition */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Jar Condition
                </label>
                <select
                  value={adjustCondition}
                  onChange={(e) => setAdjustCondition(e.target.value as JarCondition)}
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="FULL_USABLE">1. FULL_USABLE (Filled Purified Water)</option>
                  <option value="EMPTY_CLEAN">2. EMPTY_CLEAN (Sanitized Empties)</option>
                  <option value="EMPTY_DIRTY">3. EMPTY_DIRTY (Dirty Empties from Route)</option>
                  <option value="DAMAGED_REPAIRABLE">4. DAMAGED_REPAIRABLE (Maintenance Pending)</option>
                  <option value="DAMAGED_SCRAP">5. DAMAGED_SCRAP (Scrap / Terminal)</option>
                </select>
              </div>

              {/* Quantity Comparison & Difference */}
              <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2 text-xs">
                <div className="flex justify-between items-center text-muted-foreground">
                  <span>Current System Count:</span>
                  <span className="font-mono font-bold text-foreground">{adjustSystemQty} Jars</span>
                </div>

                <div className="flex justify-between items-center gap-2 pt-1 border-t border-border/50">
                  <label className="font-semibold text-foreground">Actual Physical Count:</label>
                  <Input
                    type="number"
                    min={0}
                    value={adjustActualQty}
                    onChange={(e) => setAdjustActualQty(Math.max(0, Number(e.target.value)))}
                    required
                    className="w-28 text-xs h-7 text-right font-bold"
                  />
                </div>

                <div className="flex justify-between items-center pt-1 border-t border-border/50">
                  <span className="font-semibold text-foreground">Calculated Difference (Δ):</span>
                  {adjustDelta > 0 ? (
                    <Badge variant="success" className="text-[10px] py-0 font-mono">
                      Surplus: +{adjustDelta} Jars
                    </Badge>
                  ) : adjustDelta < 0 ? (
                    <Badge variant="warning" className="text-[10px] py-0 font-mono">
                      Shortage: {adjustDelta} Jars
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground font-mono">
                      Balanced (0)
                    </Badge>
                  )}
                </div>
              </div>

              {/* Adjustment Date */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Audit Date</label>
                <Input
                  type="date"
                  value={adjustDate}
                  onChange={(e) => setAdjustDate(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              {/* Reason */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Reason for Adjustment *
                </label>
                <Input
                  placeholder="e.g. Monthly physical inventory audit, broken jar write-off, count correction"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAdjustModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={adjustDelta === 0 || !adjustReason.trim()}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                >
                  Review & Confirm
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL: PHYSICAL STOCK ADJUSTMENT */}
      {isAdjustConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-primary/40 p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-primary">
              <Scale className="h-5 w-5 shrink-0" />
              <h4 className="font-bold text-sm">Confirm Stock Count Adjustment</h4>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Confirm adjusting <strong className="text-foreground">{adjustCondition}</strong> at{" "}
              <strong className="text-foreground">{adjustLocationObj?.name || "selected location"}</strong> from{" "}
              <strong className="text-foreground">{adjustSystemQty}</strong> to{" "}
              <strong className="text-foreground">{adjustActualQty}</strong> (
              <span className={adjustDelta > 0 ? "text-emerald-600 font-bold" : "text-amber-600 font-bold"}>
                Δ: {adjustDelta > 0 ? "+" : ""}{adjustDelta} Jars
              </span>
              ).
            </p>

            <div className="rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground space-y-1">
              <div>Reason: <span className="text-foreground font-medium">{adjustReason}</span></div>
              <div>Audit Date: <span className="text-foreground font-medium">{adjustDate}</span></div>
              <p className="text-primary font-medium pt-1 border-t border-border/50">
                An immutable AUDIT movement will be posted to jar history.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsAdjustConfirmOpen(false)}
                disabled={isAdjusting}
              >
                Go Back
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmAdjust}
                disabled={isAdjusting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isAdjusting ? "Committed..." : "Confirm & Save Adjustment"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
