"use client";

import * as React from "react";
import {
  Boxes,
  Search,
  AlertTriangle,
  ArrowUpDown,
  Warehouse,
  CheckCircle2,
  History,
  RotateCcw,
  Plus,
  Minus,
  PackagePlus,
  Check,
  Droplets,
  Package,
  Layers,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import {
  getInventoryStockLevels,
  getInventoryValuationSummary,
  getStockMovements,
  adjustStock,
} from "@/modules/inventory/inventory.service";
import {
  InventoryItemRecord,
  InventoryMovementRecord,
  InventoryValuationSummary,
  StockMovementType,
} from "@/modules/inventory/inventory.schema";
import { formatCurrency } from "@/lib/utils";

// Module-level client cache for instant zero-latency inventory transitions
let cachedInventoryState: {
  items: InventoryItemRecord[];
  summary: InventoryValuationSummary | null;
} | null = null;

interface CategoryTabConfig {
  id: string;
  label: string;
  labelBn: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "teal" | "sky" | "indigo" | "purple";
  badgeBg: string;
  activeColor: string;
}

const CATEGORY_TABS: CategoryTabConfig[] = [
  {
    id: "ALL",
    label: "All Items",
    labelBn: "সব পণ্য",
    icon: Layers,
    color: "blue",
    badgeBg: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    activeColor: "from-blue-600 to-indigo-600 text-white shadow-blue-500/30",
  },
  {
    id: "REFILLABLE_WATER",
    label: "Refill Jars",
    labelBn: "রিফিল জার",
    icon: Droplets,
    color: "teal",
    badgeBg: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
    activeColor: "from-teal-600 to-emerald-600 text-white shadow-teal-500/30",
  },
  {
    id: "PACKAGED_WATER",
    label: "Bottled Cases",
    labelBn: "বোতল পানি",
    icon: Package,
    color: "sky",
    badgeBg: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    activeColor: "from-sky-600 to-blue-600 text-white shadow-sky-500/30",
  },
  {
    id: "EMPTY_JAR_ASSET",
    label: "Empty Jars",
    labelBn: "খালি জার",
    icon: Boxes,
    color: "indigo",
    badgeBg: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    activeColor: "from-indigo-600 to-purple-600 text-white shadow-indigo-500/30",
  },
  {
    id: "DISPENSER_EQUIPMENT",
    label: "Dispensers",
    labelBn: "যন্ত্রপাতি",
    icon: ArrowUpDown,
    color: "purple",
    badgeBg: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
    activeColor: "from-purple-600 to-pink-600 text-white shadow-purple-500/30",
  },
];

export default function SingleWarehouseInventoryPage() {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = React.useState<"stock" | "history">("stock");
  const [items, setItems] = React.useState<InventoryItemRecord[]>(() => cachedInventoryState?.items || []);
  const [summary, setSummary] = React.useState<InventoryValuationSummary | null>(() => cachedInventoryState?.summary || null);
  const [isLoading, setIsLoading] = React.useState<boolean>(() => !cachedInventoryState);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState("ALL");
  const [showLowStockOnly, setShowLowStockOnly] = React.useState(false);

  // Stock Movement History Modal (Product-specific)
  const [historyProduct, setHistoryProduct] = React.useState<InventoryItemRecord | null>(null);
  const [productMovements, setProductMovements] = React.useState<InventoryMovementRecord[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = React.useState(false);

  // Global Movement Ledger (Tab 2)
  const [allMovements, setAllMovements] = React.useState<InventoryMovementRecord[]>([]);
  const [isMovementsLoading, setIsMovementsLoading] = React.useState(false);
  const [movementSearch, setMovementSearch] = React.useState("");

  // Stock Adjustment / Addition Modal
  const [isAdjustModalOpen, setIsAdjustModalOpen] = React.useState(false);
  const [selectedProduct, setSelectedProduct] = React.useState<InventoryItemRecord | null>(null);
  const [stockMode, setStockMode] = React.useState<"add" | "remove">("add");
  const [qtyString, setQtyString] = React.useState<string>("");
  const [adjustReason, setAdjustReason] = React.useState("");
  const [adjustType, setAdjustType] = React.useState<StockMovementType>("PURCHASE_RECEIPT");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const openAddStockModal = (product?: InventoryItemRecord) => {
    const targetProduct = product || selectedProduct || (items.length > 0 ? items[0] : null);
    if (!targetProduct && items.length === 0) {
      addToast({
        type: "info",
        title: "No Products",
        message: "No products exist in warehouse catalog to add stock.",
      });
      return;
    }
    setSelectedProduct(targetProduct);
    setStockMode("add");
    setQtyString("");
    setAdjustReason("");
    setAdjustType("PURCHASE_RECEIPT");
    setIsAdjustModalOpen(true);
  };

  const openAdjustStockModal = (product: InventoryItemRecord, mode: "add" | "remove" = "add") => {
    setSelectedProduct(product);
    setStockMode(mode);
    setQtyString("");
    setAdjustReason("");
    setAdjustType(mode === "add" ? "PURCHASE_RECEIPT" : "DAMAGE_WRITEOFF");
    setIsAdjustModalOpen(true);
  };

  const loadData = React.useCallback(async () => {
    if (!cachedInventoryState) {
      setIsLoading(true);
    }
    const [stockRes, valRes] = await Promise.all([
      getInventoryStockLevels(),
      getInventoryValuationSummary(),
    ]);

    let freshItems: InventoryItemRecord[] = [];
    let freshSummary: InventoryValuationSummary | null = null;

    if (stockRes.success && stockRes.data) {
      freshItems = stockRes.data;
      setItems(stockRes.data);
    }
    if (valRes.success && valRes.data) {
      freshSummary = valRes.data;
      setSummary(valRes.data);
    }

    cachedInventoryState = {
      items: freshItems,
      summary: freshSummary,
    };
    setIsLoading(false);
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // Load product-specific history when history modal opens
  const openProductHistory = async (product: InventoryItemRecord) => {
    setHistoryProduct(product);
    setIsHistoryLoading(true);
    const res = await getStockMovements(product.product_id, 50);
    if (res.success && res.data) {
      setProductMovements(res.data);
    } else {
      setProductMovements([]);
    }
    setIsHistoryLoading(false);
  };

  // Load depot-wide movement history when switching to history tab
  React.useEffect(() => {
    if (activeTab === "history") {
      const loadAllMovements = async () => {
        setIsMovementsLoading(true);
        const res = await getStockMovements(undefined, 100);
        if (res.success && res.data) {
          setAllMovements(res.data);
        }
        setIsMovementsLoading(false);
      };
      loadAllMovements();
    }
  }, [activeTab]);

  // Fast optimistic stock adjustment submit
  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) {
      addToast({
        type: "error",
        title: "No Product Selected",
        message: "Please choose a product to update stock.",
      });
      return;
    }

    const numericQty = parseInt(qtyString, 10);
    if (isNaN(numericQty) || numericQty <= 0) {
      addToast({
        type: "error",
        title: "Enter Valid Quantity",
        message: "Please enter a quantity greater than 0.",
      });
      return;
    }

    if (stockMode === "remove" && numericQty > selectedProduct.current_stock) {
      addToast({
        type: "error",
        title: "Insufficient Stock",
        message: `Cannot deduct ${numericQty} ${selectedProduct.unit_of_measure}. Only ${selectedProduct.current_stock} currently in warehouse.`,
      });
      return;
    }

    const signedQty = stockMode === "add" ? numericQty : -numericQty;
    const finalReason = adjustReason.trim() || (stockMode === "add" ? "New stock received and added" : "Stock removed or damaged");

    setIsSubmitting(true);

    try {
      const res = await adjustStock({
        product_id: selectedProduct.product_id,
        quantity_delta: signedQty,
        reason: finalReason,
        movement_type: adjustType,
      });

      if (res.success) {
        const updatedNewStock = res.data?.newStock ?? Math.max(0, selectedProduct.current_stock + signedQty);

        // Instant optimistic update on the current screen
        setItems((prev) =>
          prev.map((it) => {
            if (it.product_id !== selectedProduct.product_id) return it;
            const newAvail = Math.max(0, updatedNewStock - (it.reserved_stock || 0));
            return {
              ...it,
              current_stock: updatedNewStock,
              available_stock: newAvail,
              valuation: updatedNewStock * (it.cost_price || 0),
            };
          })
        );

        if (cachedInventoryState) {
          cachedInventoryState.items = cachedInventoryState.items.map((it) => {
            if (it.product_id !== selectedProduct.product_id) return it;
            const newAvail = Math.max(0, updatedNewStock - (it.reserved_stock || 0));
            return {
              ...it,
              current_stock: updatedNewStock,
              available_stock: newAvail,
              valuation: updatedNewStock * (it.cost_price || 0),
            };
          });
        }

        // IMMEDIATELY CLOSE MODAL & RETURN TO THE STOCK OVERVIEW
        setIsAdjustModalOpen(false);
        setQtyString("");
        setAdjustReason("");
        setIsSubmitting(false);

        // Prominent celebratory toast notification
        addToast({
          type: "success",
          title: stockMode === "add" ? "🎉 Stock Added Successfully!" : "✅ Stock Deducted!",
          message: `${stockMode === "add" ? "Added" : "Deducted"} ${numericQty} ${selectedProduct.unit_of_measure} for "${selectedProduct.name}". Current Stock: ${updatedNewStock} ${selectedProduct.unit_of_measure}.`,
        });

        // Silent background sync with database without blocking the UI
        loadData();
      } else {
        setIsSubmitting(false);
        addToast({
          type: "error",
          title: "Adjustment Failed",
          message: res.error || "Failed to adjust stock balance.",
        });
      }
    } catch (err: unknown) {
      setIsSubmitting(false);
      const msg = err instanceof Error ? err.message : "Failed to adjust stock.";
      addToast({
        type: "error",
        title: "Adjustment Failed",
        message: msg,
      });
    }
  };

  // Low stock products
  const lowStockItems = React.useMemo(() => {
    return items.filter((item) => item.available_stock <= item.reorder_level);
  }, [items]);

  // Filtered products list
  const filteredItems = React.useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory =
        categoryFilter === "ALL" || item.category === categoryFilter;
      const matchesLowStock = !showLowStockOnly || item.available_stock <= item.reorder_level;
      return matchesSearch && matchesCategory && matchesLowStock;
    });
  }, [items, searchQuery, categoryFilter, showLowStockOnly]);

  // Filtered movements for tab 2
  const filteredAllMovements = React.useMemo(() => {
    if (!movementSearch) return allMovements;
    const q = movementSearch.toLowerCase();
    return allMovements.filter(
      (m) =>
        (m.product_name && m.product_name.toLowerCase().includes(q)) ||
        (m.product_sku && m.product_sku.toLowerCase().includes(q)) ||
        (m.notes && m.notes.toLowerCase().includes(q)) ||
        (m.movement_type && m.movement_type.toLowerCase().includes(q)) ||
        (m.reference_type && m.reference_type.toLowerCase().includes(q))
    );
  }, [allMovements, movementSearch]);

  const renderMovementBadge = (type: string) => {
    switch (type) {
      case "PURCHASE_RECEIPT":
        return <Badge variant="success" className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Purchase Receipt (+)</Badge>;
      case "POS_SALE":
        return <Badge variant="secondary" className="text-[10px] bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30">POS Sale (-)</Badge>;
      case "DELIVERY_DISPATCH":
        return <Badge variant="primary" className="text-[10px] bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30">Delivery Dispatch (-)</Badge>;
      case "DELIVERY_RETURN":
      case "ROUTE_RETURN":
        return <Badge variant="outline" className="text-[10px] border-cyan-500 text-cyan-700 dark:text-cyan-300 bg-cyan-500/10">Route Return (+)</Badge>;
      case "ADJUSTMENT_IN":
      case "PHYSICAL_AUDIT_ADJUSTMENT":
        return <Badge variant="success" className="text-[10px] bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30">Audit Surplus (+)</Badge>;
      case "ADJUSTMENT_OUT":
        return <Badge variant="warning" className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">Audit Deduction (-)</Badge>;
      case "SCRAP_WRITEOFF":
      case "DAMAGE_WRITEOFF":
        return <Badge variant="destructive" className="text-[10px] bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30">Scrap / Damage (-)</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">{type.replace(/_/g, " ")}</Badge>;
    }
  };

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case "REFILLABLE_WATER":
        return {
          bg: "bg-teal-500/10 dark:bg-teal-950/40",
          border: "border-teal-500/30",
          text: "text-teal-700 dark:text-teal-300",
          accent: "from-teal-500 to-emerald-500",
          tag: "Refill Jar",
        };
      case "PACKAGED_WATER":
        return {
          bg: "bg-sky-500/10 dark:bg-sky-950/40",
          border: "border-sky-500/30",
          text: "text-sky-700 dark:text-sky-300",
          accent: "from-sky-500 to-blue-500",
          tag: "Packaged Bottle",
        };
      case "EMPTY_JAR_ASSET":
        return {
          bg: "bg-indigo-500/10 dark:bg-indigo-950/40",
          border: "border-indigo-500/30",
          text: "text-indigo-700 dark:text-indigo-300",
          accent: "from-indigo-500 to-purple-500",
          tag: "Empty Container",
        };
      case "DISPENSER_EQUIPMENT":
        return {
          bg: "bg-purple-500/10 dark:bg-purple-950/40",
          border: "border-purple-500/30",
          text: "text-purple-700 dark:text-purple-300",
          accent: "from-purple-500 to-pink-500",
          tag: "Dispenser Gear",
        };
      default:
        return {
          bg: "bg-blue-500/10 dark:bg-blue-950/40",
          border: "border-blue-500/30",
          text: "text-blue-700 dark:text-blue-300",
          accent: "from-blue-500 to-teal-500",
          tag: "Warehouse SKU",
        };
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Header with Vibrant Gradient Styling */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-blue-900/10 via-teal-900/10 to-emerald-900/10 border border-blue-500/20 shadow-xs">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/25">
              <Warehouse className="h-5 w-5" />
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
              Stock & Inventory
            </h1>
            <Badge className="text-[10px] sm:text-xs font-black py-0.5 px-2 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40">
              স্টক ব্যবস্থাপনা
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 font-medium">
            Manage factory jars, mineral water packs & dispensers with real-time stock levels.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 pt-1 sm:pt-0">
          <Button
            size="sm"
            variant="outline"
            onClick={loadData}
            disabled={isLoading}
            className="gap-1.5 text-xs h-10 px-3.5 rounded-xl border-border bg-card/80 hover:bg-card shadow-2xs font-semibold"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>

          <Button
            size="sm"
            onClick={() => openAddStockModal()}
            className="gap-2 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-black shadow-lg shadow-emerald-600/30 text-xs sm:text-sm h-10 px-4 rounded-xl active:scale-95 transition-all flex-1 sm:flex-none justify-center cursor-pointer"
          >
            <Plus className="h-4.5 w-4.5 stroke-[3]" />
            <span>+ Add Stock / নতুন মাল যোগ</span>
          </Button>
        </div>
      </div>

      {/* Colorful High-Contrast KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* Card 1: Total Physical Units */}
        <div className="rounded-2xl p-3.5 sm:p-4 bg-gradient-to-br from-blue-500/15 via-cyan-500/10 to-card border border-blue-500/30 shadow-xs relative overflow-hidden space-y-1">
          <div className="flex items-center justify-between text-blue-900 dark:text-blue-200">
            <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider">Total Units (মোট মাল)</span>
            <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-300">
              <Warehouse className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-blue-700 dark:text-blue-300 tracking-tight">
            {summary ? summary.total_units_in_warehouse.toLocaleString() : items.reduce((s, i) => s + i.current_stock, 0).toLocaleString()}
          </div>
          <p className="text-[10px] sm:text-[11px] text-blue-800/80 dark:text-blue-300/80 font-medium">
            Active in factory depot
          </p>
        </div>

        {/* Card 2: Inventory Valuation */}
        <div className="rounded-2xl p-3.5 sm:p-4 bg-gradient-to-br from-emerald-500/15 via-teal-500/10 to-card border border-emerald-500/30 shadow-xs relative overflow-hidden space-y-1">
          <div className="flex items-center justify-between text-emerald-900 dark:text-emerald-200">
            <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider">Asset Value (মূল্য)</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-700 dark:text-emerald-300 tracking-tight">
            {summary ? formatCurrency(summary.total_inventory_valuation) : formatCurrency(items.reduce((s, i) => s + i.valuation, 0))}
          </div>
          <p className="text-[10px] sm:text-[11px] text-emerald-800/80 dark:text-emerald-300/80 font-medium">
            Cost valuation (সম্পদ)
          </p>
        </div>

        {/* Card 3: Reorder Alerts */}
        <div
          onClick={() => {
            setShowLowStockOnly((prev) => !prev);
            setActiveTab("stock");
          }}
          className={`rounded-2xl p-3.5 sm:p-4 bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-card border cursor-pointer transition-all space-y-1 ${
            showLowStockOnly
              ? "border-amber-500 ring-2 ring-amber-500/40 shadow-md shadow-amber-500/20"
              : "border-amber-500/30 hover:border-amber-500/60 shadow-xs"
          }`}
        >
          <div className="flex items-center justify-between text-amber-900 dark:text-amber-200">
            <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider flex items-center gap-1">
              Low Stock (কম স্টক)
              {showLowStockOnly && (
                <Badge className="text-[9px] py-0 px-1 bg-amber-500 text-white font-bold">Active</Badge>
              )}
            </span>
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-600 dark:text-amber-400 tracking-tight flex items-center gap-2">
            <span>{summary ? summary.low_stock_items_count : lowStockItems.length}</span>
            {lowStockItems.length > 0 && (
              <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded-md bg-amber-500 text-white animate-pulse">
                Needs Stock
              </span>
            )}
          </div>
          <p className="text-[10px] sm:text-[11px] text-amber-800/80 dark:text-amber-300/80 font-medium">
            {showLowStockOnly ? "Showing filtered items ✕" : "Tap to filter alerts ➔"}
          </p>
        </div>

        {/* Card 4: Distinct SKUs */}
        <div className="rounded-2xl p-3.5 sm:p-4 bg-gradient-to-br from-purple-500/15 via-indigo-500/10 to-card border border-purple-500/30 shadow-xs relative overflow-hidden space-y-1">
          <div className="flex items-center justify-between text-purple-900 dark:text-purple-200">
            <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider">Catalog SKUs (পণ্য)</span>
            <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-300">
              <Boxes className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-purple-700 dark:text-purple-300 tracking-tight">
            {summary ? summary.total_distinct_products : items.length}
          </div>
          <p className="text-[10px] sm:text-[11px] text-purple-800/80 dark:text-purple-300/80 font-medium">
            Configured active SKUs
          </p>
        </div>
      </div>

      {/* Main Mode Switcher: Stock vs Audit History */}
      <div className="flex items-center gap-2 p-1 bg-muted/60 rounded-xl border border-border/60 max-w-md">
        <button
          onClick={() => setActiveTab("stock")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all touch-manipulation min-h-[38px] ${
            activeTab === "stock"
              ? "bg-gradient-to-r from-blue-600 to-teal-600 text-white shadow-md shadow-blue-600/25"
              : "text-muted-foreground hover:text-foreground hover:bg-card/60"
          }`}
        >
          <Warehouse className="h-4 w-4" />
          <span>Warehouse Stock (গুদাম স্টক)</span>
          {lowStockItems.length > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-white font-black">
              {lowStockItems.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all touch-manipulation min-h-[38px] ${
            activeTab === "history"
              ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-600/25"
              : "text-muted-foreground hover:text-foreground hover:bg-card/60"
          }`}
        >
          <History className="h-4 w-4" />
          <span>Movement Trail (লেনদেন হিসেব)</span>
        </button>
      </div>

      {/* TAB 1: STOCK LEVELS & LOW STOCK ALERTS */}
      {activeTab === "stock" && (
        <div className="space-y-4 sm:space-y-6">
          {/* Square Category Action Tabs (Requirement: "You can make square tabs and like that") */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-foreground px-1">
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                Category Filters / পণ্যের বিভাগ বাছুন:
              </span>
              <span className="text-[11px] text-muted-foreground font-normal">
                {filteredItems.length} shown of {items.length} total
              </span>
            </div>

            {/* Tactile Square Buttons Grid / Carousel */}
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-5 gap-2">
              {CATEGORY_TABS.map((tab) => {
                const Icon = tab.icon;
                const isSelected = categoryFilter === tab.id;
                const count = tab.id === "ALL"
                  ? items.length
                  : items.filter((i) => i.category === tab.id).length;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setCategoryFilter(tab.id);
                    }}
                    className={`flex flex-col items-center justify-center p-2.5 sm:p-3 rounded-2xl border text-center transition-all touch-manipulation min-h-[76px] cursor-pointer active:scale-95 relative overflow-hidden ${
                      isSelected
                        ? `bg-gradient-to-br ${tab.activeColor} border-transparent shadow-md ring-2 ring-primary/40`
                        : "bg-card hover:bg-muted/50 border-border/80 text-muted-foreground hover:text-foreground shadow-2xs"
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-xl mb-1 flex items-center justify-center ${
                        isSelected ? "bg-white/20 text-white" : tab.badgeBg
                      }`}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <span className={`text-xs font-bold leading-tight ${isSelected ? "text-white" : "text-foreground"}`}>
                      {tab.label}
                    </span>
                    <span className={`text-[10px] mt-0.5 ${isSelected ? "text-white/80" : "text-muted-foreground font-medium"}`}>
                      {tab.labelBn} ({count})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search Bar + Low Stock Quick Filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by bottle name, 20L jar, dispenser, SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9.5 text-xs sm:text-sm h-10 rounded-xl bg-card border-border/80 shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-2.5 text-xs text-muted-foreground hover:text-foreground bg-muted px-2 py-0.5 rounded-md"
                >
                  Clear
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowLowStockOnly((prev) => !prev)}
              className={`flex items-center justify-center gap-2 px-3.5 h-10 rounded-xl text-xs font-bold border transition-all touch-manipulation shrink-0 active:scale-95 ${
                showLowStockOnly
                  ? "bg-amber-500 text-white border-amber-600 shadow-md shadow-amber-500/25"
                  : "bg-card hover:bg-muted text-muted-foreground hover:text-foreground border-border/80 shadow-2xs"
              }`}
            >
              <AlertTriangle className={`h-4 w-4 ${showLowStockOnly ? "text-white" : "text-amber-500"}`} />
              <span>Low Stock Alert Only ({lowStockItems.length})</span>
            </button>
          </div>

          {/* Active Low Stock Banner Notice */}
          {showLowStockOnly && (
            <div className="flex items-center justify-between rounded-xl bg-amber-500/15 border border-amber-500/30 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200">
              <span className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                Filtered: Showing <strong>{filteredItems.length}</strong> product(s) needing replenishment.
              </span>
              <button
                onClick={() => setShowLowStockOnly(false)}
                className="font-bold underline text-amber-700 dark:text-amber-300 hover:opacity-80"
              >
                Show All
              </button>
            </div>
          )}

          {/* MOBILE VIEW: Vibrant High-Contrast Product Tiles */}
          <div className="md:hidden space-y-3">
            {filteredItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground space-y-2 bg-muted/10">
                <Boxes className="h-8 w-8 mx-auto text-muted-foreground/50" />
                <p className="font-bold text-foreground">No Products Found</p>
                <p>Try clearing filters or search query.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setCategoryFilter("ALL");
                    setShowLowStockOnly(false);
                  }}
                  className="text-xs mt-2"
                >
                  Reset All Filters
                </Button>
              </div>
            ) : (
              filteredItems.map((item) => {
                const isLowStock = item.available_stock <= item.reorder_level;
                const catStyle = getCategoryColor(item.category);

                return (
                  <div
                    key={item.product_id}
                    className={`rounded-2xl border bg-card p-3.5 shadow-sm transition-all relative overflow-hidden space-y-3 ${
                      isLowStock
                        ? "border-amber-400 dark:border-amber-700/80 bg-gradient-to-b from-amber-500/[0.04] to-card"
                        : "border-border/90 hover:border-border"
                    }`}
                  >
                    {/* Top Color Accent Strip */}
                    <div
                      className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${
                        isLowStock ? "from-amber-500 via-orange-500 to-rose-500" : catStyle.accent
                      }`}
                    />

                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-2 pt-0.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-extrabold text-foreground tracking-tight leading-snug">
                            {item.name}
                          </h3>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-semibold">
                            SKU: {item.sku}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${catStyle.bg} ${catStyle.text} border ${catStyle.border}`}>
                            {catStyle.tag}
                          </span>
                        </div>
                      </div>

                      {/* Stock Status Pill */}
                      {isLowStock ? (
                        <div className="flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-xl bg-amber-500 text-white shadow-xs shrink-0 animate-pulse">
                          <AlertTriangle className="h-3 w-3 stroke-[3]" />
                          <span>LOW STOCK</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shrink-0">
                          <Check className="h-3 w-3 stroke-[3]" />
                          <span>IN STOCK</span>
                        </div>
                      )}
                    </div>

                    {/* Prominent High-Contrast Square Metric Box */}
                    <div className="grid grid-cols-3 gap-2">
                      {/* Box 1: Available (Big Number) */}
                      <div
                        className={`rounded-xl p-2.5 text-center border space-y-0.5 ${
                          isLowStock
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200"
                            : "bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200"
                        }`}
                      >
                        <span className="text-[10px] font-extrabold uppercase tracking-wider block opacity-80">
                          Available (মজুত)
                        </span>
                        <div
                          className={`text-2xl font-black ${
                            isLowStock
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {item.available_stock}
                        </div>
                        <span className="text-[10px] font-semibold opacity-70 block">
                          {item.unit_of_measure}
                        </span>
                      </div>

                      {/* Box 2: Physical Count */}
                      <div className="rounded-xl p-2.5 text-center bg-blue-500/10 border border-blue-500/20 text-blue-900 dark:text-blue-200 space-y-0.5">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider block opacity-80">
                          Physical (মোট)
                        </span>
                        <div className="text-xl font-black text-blue-700 dark:text-blue-300">
                          {item.current_stock}
                        </div>
                        <span className="text-[10px] font-semibold opacity-70 block">
                          {item.unit_of_measure}
                        </span>
                      </div>

                      {/* Box 3: Reserved for Orders */}
                      <div className="rounded-xl p-2.5 text-center bg-muted/50 border border-border/60 text-foreground space-y-0.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider block text-muted-foreground">
                          Reserved (বুকিং)
                        </span>
                        <div className="text-xl font-bold text-muted-foreground">
                          {item.reserved_stock}
                        </div>
                        <span className="text-[10px] font-semibold text-muted-foreground/80 block">
                          {item.unit_of_measure}
                        </span>
                      </div>
                    </div>

                    {/* Reorder Threshold Bar */}
                    <div className="space-y-1 bg-muted/30 p-2 rounded-xl border border-border/40 text-[11px]">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Reorder Threshold (সতর্কতা সীমা):</span>
                        <strong className="text-foreground">{item.reorder_level} {item.unit_of_measure}</strong>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Total Asset Valuation:</span>
                        <strong className="text-emerald-700 dark:text-emerald-300 font-bold">{formatCurrency(item.valuation)}</strong>
                      </div>
                    </div>

                    {/* High-Visibility Action Buttons */}
                    <div className="flex items-center gap-2 pt-0.5">
                      <Button
                        size="sm"
                        onClick={() => openAdjustStockModal(item, "add")}
                        className="flex-1 h-11 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-extrabold rounded-xl shadow-md shadow-emerald-600/25 text-xs sm:text-sm gap-1.5 active:scale-95 transition-all cursor-pointer"
                      >
                        <Plus className="h-4 w-4 stroke-[3]" />
                        <span>+ Add Stock / স্টক বাড়ান</span>
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAdjustStockModal(item, "remove")}
                        className="h-11 px-3 text-xs font-bold text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-900 bg-rose-500/10 hover:bg-rose-500/20 rounded-xl"
                        title="Deduct broken or damaged bottle"
                      >
                        <Minus className="h-4 w-4 stroke-[3]" />
                        <span className="sr-only">Remove</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openProductHistory(item)}
                        className="h-11 px-3 text-xs font-semibold text-muted-foreground hover:text-foreground rounded-xl border border-border/60 hover:bg-muted"
                        title="View stock history"
                      >
                        <History className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* DESKTOP VIEW: Full Structured Table */}
          <Card className="hidden md:block border-border shadow-xs overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto relative">
                <table className="w-full text-left text-xs min-w-[850px]">
                  <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Product Name / SKU</th>
                      <th className="py-3 px-4 font-semibold">Category</th>
                      <th className="py-3 px-4 font-semibold text-right">Physical Stock</th>
                      <th className="py-3 px-4 font-semibold text-right">Committed</th>
                      <th className="py-3 px-4 font-semibold text-right">Available</th>
                      <th className="py-3 px-4 font-semibold text-right">Reorder Level</th>
                      <th className="py-3 px-4 font-semibold text-right">Shortage</th>
                      <th className="py-3 px-4 font-semibold text-right">Valuation</th>
                      <th className="py-3 px-4 font-semibold text-right">Status</th>
                      <th className="py-3 px-4 font-semibold text-right">Quick Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredItems.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-12 text-center text-muted-foreground">
                          {isLoading ? "Loading inventory stock levels..." : "No products found matching filters."}
                        </td>
                      </tr>
                    ) : (
                      filteredItems.map((item) => {
                        const isLowStock = item.available_stock <= item.reorder_level;
                        const catStyle = getCategoryColor(item.category);

                        return (
                          <tr
                            key={item.product_id}
                            className={`hover:bg-muted/40 transition-colors ${
                              isLowStock ? "bg-amber-500/5 hover:bg-amber-500/10" : ""
                            }`}
                          >
                            <td className="py-3.5 px-4">
                              <div className="font-bold text-foreground text-xs">{item.name}</div>
                              <div className="font-mono text-[11px] text-muted-foreground">{item.sku}</div>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${catStyle.bg} ${catStyle.text} border ${catStyle.border}`}>
                                {catStyle.tag}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right font-bold text-foreground">
                              {item.current_stock} {item.unit_of_measure}
                            </td>
                            <td className="py-3.5 px-4 text-right text-muted-foreground font-medium">
                              {item.reserved_stock} {item.unit_of_measure}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <span
                                className={`font-black text-sm ${
                                  isLowStock ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
                                }`}
                              >
                                {item.available_stock} {item.unit_of_measure}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right text-muted-foreground font-mono">
                              {item.reorder_level} {item.unit_of_measure}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              {isLowStock ? (
                                <span className="font-bold text-rose-600 dark:text-rose-400">
                                  -{Math.max(0, item.reorder_level - item.available_stock)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/60">—</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right font-bold text-emerald-700 dark:text-emerald-300">
                              {formatCurrency(item.valuation)}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              {isLowStock ? (
                                <Badge variant="warning" className="text-[10px] py-0 font-bold bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40">
                                  Low Stock
                                </Badge>
                              ) : (
                                <Badge variant="success" className="text-[10px] py-0 font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40">
                                  In Stock
                                </Badge>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  size="sm"
                                  onClick={() => openAdjustStockModal(item, "add")}
                                  className="h-8 px-2.5 text-xs font-bold gap-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg shadow-xs"
                                >
                                  <Plus className="h-3.5 w-3.5" /> + Add Stock
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openAdjustStockModal(item, "remove")}
                                  className="h-8 px-2 text-xs text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                  title="Deduct broken or damaged bottle"
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openProductHistory(item)}
                                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                                  title="View audit history"
                                >
                                  <History className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* TAB 2: AUDIT TRAIL */}
      {activeTab === "history" && (
        <Card className="border-border shadow-xs">
          <CardHeader className="p-4 pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-bold text-foreground">
                  Complete Stock Movement Audit Trail
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Immutable record of receipts, dispatches, damages and adjustments.
                </p>
              </div>

              <div className="w-full sm:w-64">
                <Input
                  placeholder="Filter by product, SKU, note..."
                  value={movementSearch}
                  onChange={(e) => setMovementSearch(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto relative">
              <table className="w-full text-left text-xs min-w-[700px]">
                <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Date & Time</th>
                    <th className="py-2.5 px-4 font-semibold">Product</th>
                    <th className="py-2.5 px-4 font-semibold">Movement Type</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Quantity</th>
                    <th className="py-2.5 px-4 font-semibold">Reason / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {isMovementsLoading ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">
                        Loading stock movements...
                      </td>
                    </tr>
                  ) : filteredAllMovements.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">
                        No movement records found.
                      </td>
                    </tr>
                  ) : (
                    filteredAllMovements.map((m) => (
                      <tr key={m.id} className="hover:bg-muted/20">
                        <td className="py-3 px-4 text-muted-foreground font-mono text-[11px]">
                          {new Date(m.created_at).toLocaleString("en-IN", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}
                        </td>
                        <td className="py-3 px-4 font-bold text-foreground">
                          {m.product_name || "Unknown SKU"}
                        </td>
                        <td className="py-3 px-4">{renderMovementBadge(m.movement_type)}</td>
                        <td className="py-3 px-4 text-right font-black">
                          <span
                            className={
                              m.quantity > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            }
                          >
                            {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground max-w-xs truncate">
                          {m.notes || "—"}
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

      {/* PRODUCT HISTORY MODAL */}
      {historyProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl bg-card border border-border p-4 sm:p-6 shadow-xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-bold text-sm sm:text-base text-foreground">
                  Movement History: {historyProduct.name}
                </h3>
                <p className="text-xs text-muted-foreground">SKU: {historyProduct.sku}</p>
              </div>
              <button
                onClick={() => setHistoryProduct(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 p-3 rounded-xl border border-border/60">
                <div>
                  <span className="text-muted-foreground block text-[10px]">Current Physical Stock</span>
                  <strong className="text-base text-foreground">{historyProduct.current_stock} {historyProduct.unit_of_measure}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px]">Available for Delivery</span>
                  <strong className="text-base text-emerald-600 dark:text-emerald-400">{historyProduct.available_stock} {historyProduct.unit_of_measure}</strong>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3 text-right">Quantity</th>
                      <th className="py-2 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {isHistoryLoading ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-muted-foreground">Loading history...</td>
                      </tr>
                    ) : productMovements.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-muted-foreground">No recent movements recorded.</td>
                      </tr>
                    ) : (
                      productMovements.map((mov) => (
                        <tr key={mov.id}>
                          <td className="py-2.5 px-3 text-muted-foreground font-mono text-[10px]">
                            {new Date(mov.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 px-3">{renderMovementBadge(mov.movement_type)}</td>
                          <td className="py-2.5 px-3 text-right font-black">
                            <span className={mov.quantity > 0 ? "text-emerald-600" : "text-rose-600"}>
                              {mov.quantity > 0 ? `+${mov.quantity}` : mov.quantity}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-muted-foreground truncate max-w-xs">{mov.notes || "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setHistoryProduct(null)}
                  className="text-xs"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIBRANT, HIGH-CONTRAST ADD / ADJUST STOCK MODAL */}
      {isAdjustModalOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-3xl bg-card border-2 border-border p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-2xl text-white shadow-md ${
                    stockMode === "add"
                      ? "bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 shadow-emerald-500/30"
                      : "bg-gradient-to-br from-rose-500 via-red-500 to-amber-600 shadow-rose-500/30"
                  }`}
                >
                  {stockMode === "add" ? (
                    <PackagePlus className="h-5 w-5 stroke-[2.5]" />
                  ) : (
                    <ArrowUpDown className="h-5 w-5 stroke-[2.5]" />
                  )}
                </div>
                <div>
                  <h3 className="font-black text-base sm:text-lg text-foreground leading-tight">
                    {stockMode === "add" ? "+ Add Stock / নতুন মাল যোগ" : "- Deduct / নষ্ট মাল বাদ"}
                  </h3>
                  <p className="text-xs text-muted-foreground font-medium">
                    Fast update for warehouse depot inventory
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-xl hover:bg-muted min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold transition-colors cursor-pointer"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1.5 bg-muted/80 rounded-2xl border border-border/70">
              <button
                type="button"
                onClick={() => {
                  setStockMode("add");
                  setAdjustType("PURCHASE_RECEIPT");
                }}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-black transition-all min-h-[44px] touch-manipulation cursor-pointer ${
                  stockMode === "add"
                    ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/30 ring-2 ring-emerald-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/70"
                }`}
              >
                <Plus className="h-4 w-4 stroke-[3]" />
                <span>+ Add Stock (নতুন মাল এলো)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStockMode("remove");
                  setAdjustType("DAMAGE_WRITEOFF");
                }}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-black transition-all min-h-[44px] touch-manipulation cursor-pointer ${
                  stockMode === "remove"
                    ? "bg-gradient-to-r from-rose-600 to-amber-600 text-white shadow-md shadow-rose-600/30 ring-2 ring-rose-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/70"
                }`}
              >
                <Minus className="h-4 w-4 stroke-[3]" />
                <span>- Remove (নষ্ট / ভাঙা)</span>
              </button>
            </div>

            {/* Product Selector Dropdown */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground flex items-center justify-between">
                <span>Select Product / মাল বাছুন *</span>
                <span className="text-[11px] text-muted-foreground font-normal">
                  {items.length} items cataloged
                </span>
              </label>
              <select
                value={selectedProduct.product_id}
                onChange={(e) => {
                  const prod = items.find((p) => p.product_id === e.target.value);
                  if (prod) setSelectedProduct(prod);
                }}
                className="w-full h-11 px-3 text-xs sm:text-sm font-bold rounded-xl border-2 border-border bg-card text-foreground shadow-xs focus:ring-2 focus:ring-primary focus:border-primary focus:outline-hidden"
              >
                {items.map((prod) => (
                  <option key={prod.product_id} value={prod.product_id}>
                    {prod.name} ({prod.sku}) — {prod.current_stock} {prod.unit_of_measure} currently
                  </option>
                ))}
              </select>
            </div>

            {/* Current Stock Snapshot Card */}
            <div className="rounded-2xl bg-gradient-to-r from-blue-500/10 via-teal-500/10 to-emerald-500/10 border border-blue-500/20 p-3.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="font-semibold">Current Physical Stock:</span>
                <strong className="text-base font-black text-foreground">
                  {selectedProduct.current_stock} {selectedProduct.unit_of_measure}
                </strong>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="font-semibold">Available to Deliver:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {selectedProduct.available_stock} {selectedProduct.unit_of_measure}
                </span>
              </div>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-4">
              {/* Quantity Input with Tactile Quick Increment Square Buttons */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-foreground flex items-center justify-between">
                  <span>Enter Quantity / কয়টি সংখ্যা? *</span>
                  <span className="text-[11px] text-muted-foreground font-normal">
                    Unit: <strong>{selectedProduct.unit_of_measure}</strong>
                  </span>
                </label>

                <div className="relative">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={qtyString}
                    onChange={(e) => setQtyString(e.target.value)}
                    placeholder="Enter number (e.g. 50)"
                    className="h-13 text-xl sm:text-2xl font-black font-mono tracking-wider px-3.5 rounded-2xl border-2 border-primary/50 focus:border-primary shadow-xs"
                    required
                    autoFocus
                  />
                  {qtyString && (
                    <button
                      type="button"
                      onClick={() => setQtyString("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground hover:text-foreground bg-muted px-2.5 py-1 rounded-lg"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Tactile Quick Add Square Buttons */}
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  <span className="text-[11px] font-bold text-muted-foreground mr-1">Quick tap:</span>
                  {[10, 25, 50, 100, 200].map((inc) => (
                    <button
                      key={inc}
                      type="button"
                      onClick={() => {
                        const current = parseInt(qtyString, 10) || 0;
                        setQtyString(String(current + inc));
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-black bg-gradient-to-b from-card to-muted hover:to-muted/80 text-foreground border-2 border-border shadow-xs touch-manipulation active:scale-95 transition-all cursor-pointer"
                    >
                      +{inc}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setQtyString("")}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground bg-muted/60 touch-manipulation"
                  >
                    Reset
                  </button>
                </div>

                {/* Live Stock Projection Preview */}
                {(() => {
                  const num = parseInt(qtyString, 10);
                  if (isNaN(num) || num <= 0) return null;

                  if (stockMode === "add") {
                    const projected = selectedProduct.current_stock + num;
                    return (
                      <div className="p-3 rounded-2xl bg-emerald-500/15 border-2 border-emerald-500/40 text-emerald-900 dark:text-emerald-100 text-xs flex items-center justify-between shadow-xs">
                        <span className="font-bold flex items-center gap-1.5">
                          <Sparkles className="h-4 w-4 text-emerald-600 shrink-0" />
                          New Projected Stock:
                        </span>
                        <strong className="text-base font-black text-emerald-700 dark:text-emerald-300">
                          {projected} {selectedProduct.unit_of_measure} (+{num})
                        </strong>
                      </div>
                    );
                  } else {
                    const projected = selectedProduct.current_stock - num;
                    const isOver = projected < 0;
                    return (
                      <div
                        className={`p-3 rounded-2xl border-2 text-xs flex items-center justify-between shadow-xs ${
                          isOver
                            ? "bg-rose-500/15 border-rose-500/40 text-rose-900 dark:text-rose-100"
                            : "bg-amber-500/15 border-amber-500/40 text-amber-900 dark:text-amber-100"
                        }`}
                      >
                        <span className="font-bold">
                          {isOver ? "⚠️ Cannot deduct more than available!" : "New Projected Stock:"}
                        </span>
                        <strong
                          className={`text-base font-black ${
                            isOver ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {isOver ? `Max: ${selectedProduct.current_stock}` : `${projected} ${selectedProduct.unit_of_measure} (-${num})`}
                        </strong>
                      </div>
                    );
                  }
                })()}
              </div>

              {/* Quick Reason Chips & Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground flex items-center justify-between">
                  <span>Reason / কারণ (ঐচ্ছিক)</span>
                  <span className="text-[11px] text-muted-foreground font-normal">Tap to pick</span>
                </label>

                {/* Preset Chips */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(stockMode === "add"
                    ? [
                        { label: "🏭 Plant Arrival (ফ্যাক্টরি থেকে এলো)", val: "Factory Plant Arrival" },
                        { label: "🔄 Refilled (রিফিল বোতল)", val: "Refilled Bottles" },
                        { label: "🚛 Route Return (গাড়ি থেকে ফেরত)", val: "Returned from Delivery Route" },
                        { label: "🔍 Audit Surplus (গণনা সংশোধন)", val: "Physical Stock Count Adjustment" },
                      ]
                    : [
                        { label: "💥 Broken / Damaged (ভাঙা বা নষ্ট)", val: "Broken or Damaged Bottle" },
                        { label: "💧 Water Leakage (লিক হওয়া বোতল)", val: "Water Leakage Write-off" },
                        { label: "🏭 Scrap Return (ফ্যাক্টরিতে ফেরত)", val: "Returned to Factory for Recycling" },
                        { label: "🔍 Count Variance (গণনায় কম)", val: "Physical Audit Variance" },
                      ]
                  ).map((chip) => (
                    <button
                      key={chip.val}
                      type="button"
                      onClick={() => setAdjustReason(chip.val)}
                      className={`px-2.5 py-1.5 rounded-xl text-xs transition-all touch-manipulation border-2 cursor-pointer font-medium ${
                        adjustReason === chip.val
                          ? "bg-primary text-primary-foreground border-primary font-bold shadow-xs scale-102"
                          : "bg-muted/50 hover:bg-muted text-muted-foreground border-border/60"
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>

                <Input
                  placeholder={
                    stockMode === "add"
                      ? "Optional notes (e.g. Truck #WB-12 or Invoice #104)..."
                      : "Optional notes (e.g. Cracked during unloading)..."
                  }
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="text-xs h-9.5 mt-1 rounded-xl"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="h-12 px-4 text-xs sm:text-sm font-bold rounded-2xl"
                >
                  Cancel
                </Button>

                {(() => {
                  const num = parseInt(qtyString, 10);
                  const isValidQty = !isNaN(num) && num > 0;
                  const isOverDeduct = stockMode === "remove" && num > selectedProduct.current_stock;
                  const canSubmit = !isSubmitting && isValidQty && !isOverDeduct;

                  return (
                    <Button
                      type="submit"
                      disabled={!canSubmit}
                      className={`h-12 flex-1 font-black text-xs sm:text-sm rounded-2xl transition-all shadow-lg cursor-pointer ${
                        stockMode === "add"
                          ? "bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white shadow-emerald-500/30"
                          : "bg-gradient-to-r from-rose-600 via-red-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white shadow-rose-500/30"
                      } ${!canSubmit ? "opacity-50 cursor-not-allowed" : "active:scale-98"}`}
                    >
                      {isSubmitting ? (
                        <span className="flex items-center gap-2">
                          <RotateCcw className="h-4 w-4 animate-spin" />
                          Saving Stock...
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          <Check className="h-4.5 w-4.5 stroke-[3]" />
                          {stockMode === "add"
                            ? `Confirm Add ${isValidQty ? `+${num}` : ""} ${selectedProduct.unit_of_measure} (স্টকে যোগ করুন)`
                            : `Confirm Deduct ${isValidQty ? `-${num}` : ""} ${selectedProduct.unit_of_measure} (স্টক কমান)`}
                        </span>
                      )}
                    </Button>
                  );
                })()}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Extra bottom padding spacer for mobile navbar */}
      <div className="h-16 md:hidden" />
    </div>
  );
}
