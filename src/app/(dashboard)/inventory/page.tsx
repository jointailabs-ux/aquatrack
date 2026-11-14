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
  badgeBg: string;
  activeColor: string;
  inactiveColor: string;
}

const CATEGORY_TABS: CategoryTabConfig[] = [
  {
    id: "ALL",
    label: "All Items",
    labelBn: "সব পণ্য",
    icon: Layers,
    badgeBg: "bg-blue-950/80 text-blue-300 border border-blue-500/40",
    activeColor: "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/40 border-2 border-indigo-300",
    inactiveColor: "bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-2 border-slate-700/80 hover:border-slate-500",
  },
  {
    id: "REFILLABLE_WATER",
    label: "Refill Jars",
    labelBn: "রিফিল জার",
    icon: Droplets,
    badgeBg: "bg-teal-950/80 text-cyan-300 border border-cyan-500/40",
    activeColor: "bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-600 text-slate-950 font-black shadow-lg shadow-cyan-500/40 border-2 border-cyan-200",
    inactiveColor: "bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-2 border-slate-700/80 hover:border-cyan-500/60",
  },
  {
    id: "PACKAGED_WATER",
    label: "Bottled Cases",
    labelBn: "বোতল পানি",
    icon: Package,
    badgeBg: "bg-sky-950/80 text-sky-300 border border-sky-500/40",
    activeColor: "bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 text-white font-black shadow-lg shadow-sky-500/40 border-2 border-sky-200",
    inactiveColor: "bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-2 border-slate-700/80 hover:border-sky-500/60",
  },
  {
    id: "EMPTY_JAR_ASSET",
    label: "Empty Jars",
    labelBn: "খালি জার",
    icon: Boxes,
    badgeBg: "bg-amber-950/80 text-amber-300 border border-amber-500/40",
    activeColor: "bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 text-slate-950 font-black shadow-lg shadow-amber-500/40 border-2 border-amber-200",
    inactiveColor: "bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-2 border-slate-700/80 hover:border-amber-500/60",
  },
  {
    id: "DISPENSER_EQUIPMENT",
    label: "Dispensers",
    labelBn: "যন্ত্রপাতি",
    icon: ArrowUpDown,
    badgeBg: "bg-purple-950/80 text-fuchsia-300 border border-purple-500/40",
    activeColor: "bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 text-white font-black shadow-lg shadow-purple-500/40 border-2 border-fuchsia-200",
    inactiveColor: "bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-2 border-slate-700/80 hover:border-purple-500/60",
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

  const openAdjustStockModal = (product: InventoryItemRecord, mode: "add" | "remove") => {
    setSelectedProduct(product);
    setStockMode(mode);
    setQtyString("");
    setAdjustReason("");
    setAdjustType(mode === "add" ? "PURCHASE_RECEIPT" : "DAMAGE_WRITEOFF");
    setIsAdjustModalOpen(true);
  };

  const loadData = React.useCallback(async () => {
    try {
      if (!cachedInventoryState) {
        setIsLoading(true);
      }
      const [itemsRes, summaryRes] = await Promise.all([
        getInventoryStockLevels(),
        getInventoryValuationSummary(),
      ]);

      if (itemsRes.success && itemsRes.data) {
        setItems(itemsRes.data);
      }
      if (summaryRes.success && summaryRes.data) {
        setSummary(summaryRes.data);
      }

      if (itemsRes.success && itemsRes.data) {
        cachedInventoryState = {
          items: itemsRes.data,
          summary: summaryRes.success ? summaryRes.data : null,
        };
      }
    } catch {
      addToast({
        type: "error",
        title: "Error Loading Inventory",
        message: "Failed to fetch warehouse stock levels.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  const loadMovements = React.useCallback(async () => {
    try {
      setIsMovementsLoading(true);
      const res = await getStockMovements(undefined, 100);
      if (res.success && res.data) {
        setAllMovements(res.data);
      }
    } catch {
      addToast({
        type: "error",
        title: "Error",
        message: "Failed to load audit history movements.",
      });
    } finally {
      setIsMovementsLoading(false);
    }
  }, [addToast]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  React.useEffect(() => {
    if (activeTab === "history" && allMovements.length === 0) {
      loadMovements();
    }
  }, [activeTab, allMovements.length, loadMovements]);

  const openProductHistory = async (product: InventoryItemRecord) => {
    setHistoryProduct(product);
    setIsHistoryLoading(true);
    try {
      const res = await getStockMovements(product.product_id, 30);
      if (res.success && res.data) {
        setProductMovements(res.data);
      }
    } catch {
      addToast({
        type: "error",
        title: "Error",
        message: "Could not load history for this product.",
      });
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;

    const parsedQty = parseInt(qtyString, 10);
    if (isNaN(parsedQty) || parsedQty <= 0) {
      addToast({
        type: "error",
        title: "Invalid Quantity",
        message: "Please enter a valid positive quantity.",
      });
      return;
    }

    if (stockMode === "remove" && parsedQty > selectedProduct.available_stock) {
      addToast({
        type: "error",
        title: "Insufficient Stock",
        message: `Cannot deduct ${parsedQty} units. Only ${selectedProduct.available_stock} available in warehouse.`,
      });
      return;
    }

    const appliedQty = stockMode === "add" ? parsedQty : -parsedQty;
    const finalReason = adjustReason.trim()
      ? adjustReason.trim()
      : stockMode === "add"
      ? `Manual stock entry (+ ${parsedQty} units)`
      : `Manual stock deduction (- ${parsedQty} units)`;

    const productSnapshot = selectedProduct;

    // OPTIMISTIC LOCAL UPDATE (Under 50ms)
    setItems((prevItems) =>
      prevItems.map((item) => {
        if (item.product_id === productSnapshot.product_id) {
          const newCurrent = Math.max(0, item.current_stock + appliedQty);
          const newAvailable = Math.max(0, item.available_stock + appliedQty);
          const unitCost = item.current_stock > 0 ? item.valuation / item.current_stock : 0;
          return {
            ...item,
            current_stock: newCurrent,
            available_stock: newAvailable,
            valuation: Math.round(newCurrent * unitCost),
          };
        }
        return item;
      })
    );

    // INSTANT CLOSE MODAL & POPUP CONFIRMATION
    setIsAdjustModalOpen(false);
    setQtyString("");
    setAdjustReason("");

    addToast({
      type: "success",
      title: stockMode === "add" ? "Stock Added! / নতুন মাল যোগ হয়েছে" : "Stock Deducted! / মাল বাদ দেওয়া হয়েছে",
      message: `${Math.abs(appliedQty)} units ${appliedQty > 0 ? "added to" : "deducted from"} ${productSnapshot.name}. Balance updated.`,
    });

    setIsSubmitting(true);
    try {
      const res = await adjustStock({
        product_id: productSnapshot.product_id,
        quantity_delta: appliedQty,
        movement_type: adjustType,
        reason: finalReason,
      });

      if (!res.success) {
        addToast({
          type: "error",
          title: "Adjustment Failed",
          message: res.error || "Database error adjusting stock. Reverting changes...",
        });
        await loadData();
      } else {
        loadData();
      }
    } catch {
      addToast({
        type: "error",
        title: "Network Error",
        message: "An unexpected error occurred. Syncing latest data...",
      });
      await loadData();
    } finally {
      setIsSubmitting(false);
    }
  };

  const lowStockItems = React.useMemo(() => {
    return items.filter((i) => i.available_stock <= i.reorder_level);
  }, [items]);

  const filteredItems = React.useMemo(() => {
    return items.filter((item) => {
      if (categoryFilter !== "ALL" && item.category !== categoryFilter) {
        return false;
      }
      if (showLowStockOnly && item.available_stock > item.reorder_level) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = item.name.toLowerCase().includes(q);
        const matchSku = item.sku.toLowerCase().includes(q);
        const matchCat = item.category.toLowerCase().includes(q);
        return matchName || matchSku || matchCat;
      }
      return true;
    });
  }, [items, categoryFilter, showLowStockOnly, searchQuery]);

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
        return <Badge className="text-[10px] bg-emerald-500/20 text-emerald-300 border-emerald-500/40">Purchase Receipt (+)</Badge>;
      case "POS_SALE":
        return <Badge className="text-[10px] bg-purple-500/20 text-purple-300 border-purple-500/40">POS Sale (-)</Badge>;
      case "DELIVERY_DISPATCH":
        return <Badge className="text-[10px] bg-blue-500/20 text-blue-300 border-blue-500/40">Delivery Dispatch (-)</Badge>;
      case "DELIVERY_RETURN":
      case "ROUTE_RETURN":
        return <Badge className="text-[10px] border-cyan-400 text-cyan-300 bg-cyan-500/20">Route Return (+)</Badge>;
      case "ADJUSTMENT_IN":
      case "PHYSICAL_AUDIT_ADJUSTMENT":
        return <Badge className="text-[10px] bg-teal-500/20 text-teal-300 border-teal-500/40">Audit Surplus (+)</Badge>;
      case "ADJUSTMENT_OUT":
        return <Badge className="text-[10px] bg-amber-500/20 text-amber-300 border-amber-500/40">Audit Deduction (-)</Badge>;
      case "SCRAP_WRITEOFF":
      case "DAMAGE_WRITEOFF":
        return <Badge className="text-[10px] bg-rose-500/20 text-rose-300 border-rose-500/40">Scrap / Damage (-)</Badge>;
      default:
        return <Badge className="text-[10px] bg-slate-800 text-slate-300 border-slate-700">{type.replace(/_/g, " ")}</Badge>;
    }
  };

  const getProductTheme = (cat: string, isLowStock: boolean) => {
    if (isLowStock) {
      return {
        cardBg: "bg-gradient-to-br from-slate-950 via-rose-950/70 to-slate-900 border-2 border-rose-500 shadow-xl shadow-rose-950/60",
        topBar: "from-rose-500 via-orange-500 to-amber-500",
        badgeBg: "bg-rose-500/25 text-rose-300 border-rose-500/50",
        qtyBg: "bg-gradient-to-br from-rose-500 to-amber-500 text-white font-black shadow-lg shadow-rose-500/50",
        tag: "Low Stock Alert",
      };
    }
    switch (cat) {
      case "REFILLABLE_WATER":
        return {
          cardBg: "bg-gradient-to-br from-slate-950 via-cyan-950/50 to-slate-900 border-2 border-cyan-500/60 shadow-xl shadow-cyan-950/50",
          topBar: "from-cyan-400 via-teal-400 to-emerald-400",
          badgeBg: "bg-cyan-500/20 text-cyan-300 border-cyan-500/50",
          qtyBg: "bg-gradient-to-br from-cyan-400 to-teal-400 text-slate-950 font-black shadow-lg shadow-cyan-400/40",
          tag: "20L Refill Jar",
        };
      case "PACKAGED_WATER":
        return {
          cardBg: "bg-gradient-to-br from-slate-950 via-blue-950/50 to-slate-900 border-2 border-blue-500/60 shadow-xl shadow-blue-950/50",
          topBar: "from-sky-400 via-blue-500 to-indigo-500",
          badgeBg: "bg-blue-500/20 text-sky-300 border-blue-500/50",
          qtyBg: "bg-gradient-to-br from-sky-400 to-blue-500 text-slate-950 font-black shadow-lg shadow-sky-400/40",
          tag: "Packaged Bottle",
        };
      case "EMPTY_JAR_ASSET":
        return {
          cardBg: "bg-gradient-to-br from-slate-950 via-amber-950/50 to-slate-900 border-2 border-amber-500/60 shadow-xl shadow-amber-950/50",
          topBar: "from-amber-400 via-orange-400 to-yellow-400",
          badgeBg: "bg-amber-500/20 text-amber-300 border-amber-500/50",
          qtyBg: "bg-gradient-to-br from-amber-400 to-orange-400 text-slate-950 font-black shadow-lg shadow-amber-400/40",
          tag: "Empty Container",
        };
      case "DISPENSER_EQUIPMENT":
        return {
          cardBg: "bg-gradient-to-br from-slate-950 via-purple-950/50 to-slate-900 border-2 border-purple-500/60 shadow-xl shadow-purple-950/50",
          topBar: "from-purple-400 via-fuchsia-500 to-pink-500",
          badgeBg: "bg-purple-500/20 text-fuchsia-300 border-purple-500/50",
          qtyBg: "bg-gradient-to-br from-fuchsia-400 to-pink-500 text-slate-950 font-black shadow-lg shadow-fuchsia-400/40",
          tag: "Dispenser Gear",
        };
      default:
        return {
          cardBg: "bg-gradient-to-br from-slate-950 via-indigo-950/50 to-slate-900 border-2 border-indigo-500/60 shadow-xl shadow-indigo-950/50",
          topBar: "from-indigo-400 via-purple-400 to-pink-400",
          badgeBg: "bg-indigo-500/20 text-indigo-300 border-indigo-500/50",
          qtyBg: "bg-gradient-to-br from-indigo-400 to-purple-400 text-slate-950 font-black shadow-lg shadow-indigo-400/40",
          tag: "Warehouse SKU",
        };
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Top Header with Deep Indigo/Slate Gradient & Bright Accents */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-900 text-white border-2 border-indigo-500/40 shadow-xl shadow-indigo-950/50">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 text-slate-950 shadow-md shadow-emerald-400/30">
              <Warehouse className="h-5 w-5 stroke-[2.5]" />
            </div>
            <h1 className="text-lg sm:text-2xl font-black tracking-tight text-white">
              Stock & Inventory
            </h1>
            <Badge className="text-[10px] sm:text-xs font-black py-0.5 px-2 bg-emerald-400 text-slate-950 shadow-xs border-0">
              স্টক ব্যবস্থাপনা
            </Badge>
          </div>
          <p className="text-xs text-slate-300 mt-0.5 font-medium">
            Factory water jars, mineral water packs & dispensers live inventory
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={loadData}
            disabled={isLoading}
            className="gap-1.5 text-xs h-9 sm:h-10 px-3 rounded-xl border-slate-700 bg-slate-900/90 text-slate-200 hover:bg-slate-800 hover:text-white font-bold"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>

          <Button
            size="sm"
            onClick={() => openAddStockModal()}
            className="gap-2 bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-black shadow-lg shadow-emerald-400/30 text-xs sm:text-sm h-9 sm:h-10 px-4 rounded-xl active:scale-95 transition-all flex-1 sm:flex-none justify-center cursor-pointer"
          >
            <Plus className="h-4 w-4 stroke-[3]" />
            <span>+ Add Stock / নতুন মাল</span>
          </Button>
        </div>
      </div>

      {/* Colorful Deep-Saturated KPI Cards (Funky Neon Gradients) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {/* Card 1: Total Physical Units - Deep Sapphire / Cyan */}
        <div className="rounded-2xl p-3 sm:p-3.5 bg-gradient-to-br from-blue-950 via-slate-900 to-cyan-950 border-2 border-cyan-500/70 text-white shadow-lg shadow-cyan-950/50 space-y-1">
          <div className="flex items-center justify-between text-cyan-300">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider">Total Units (মোট)</span>
            <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-300">
              <Warehouse className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-cyan-300 tracking-tight drop-shadow-sm">
            {summary ? summary.total_units_in_warehouse.toLocaleString() : items.reduce((s, i) => s + i.current_stock, 0).toLocaleString()}
          </div>
          <p className="text-[10px] text-slate-300 font-medium">
            Depot physical stock
          </p>
        </div>

        {/* Card 2: Inventory Valuation - Deep Emerald / Lime */}
        <div className="rounded-2xl p-3 sm:p-3.5 bg-gradient-to-br from-emerald-950 via-slate-900 to-teal-950 border-2 border-emerald-500/70 text-white shadow-lg shadow-emerald-950/50 space-y-1">
          <div className="flex items-center justify-between text-emerald-300">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider">Asset Value (মূল্য)</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-300 tracking-tight drop-shadow-sm">
            {summary ? formatCurrency(summary.total_inventory_valuation) : formatCurrency(items.reduce((s, i) => s + i.valuation, 0))}
          </div>
          <p className="text-[10px] text-slate-300 font-medium">
            Total inventory valuation
          </p>
        </div>

        {/* Card 3: Reorder Alerts - Deep Flame Amber / Orange */}
        <div
          onClick={() => {
            setShowLowStockOnly((prev) => !prev);
            setActiveTab("stock");
          }}
          className={`rounded-2xl p-3 sm:p-3.5 bg-gradient-to-br from-amber-950 via-slate-900 to-orange-950 border-2 text-white shadow-lg shadow-amber-950/50 cursor-pointer transition-all space-y-1 ${
            showLowStockOnly
              ? "border-amber-400 ring-2 ring-amber-400/50 shadow-amber-500/40"
              : "border-amber-500/70 hover:border-amber-400"
          }`}
        >
          <div className="flex items-center justify-between text-amber-300">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider flex items-center gap-1">
              Low Stock (কম স্টক)
              {showLowStockOnly && (
                <Badge className="text-[9px] py-0 px-1 bg-amber-400 text-slate-950 font-black">Filtered</Badge>
              )}
            </span>
            <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-300 tracking-tight flex items-center gap-2 drop-shadow-sm">
            <span>{summary ? summary.low_stock_items_count : lowStockItems.length}</span>
            {lowStockItems.length > 0 && (
              <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded-md bg-amber-400 text-slate-950 animate-pulse">
                Needs Stock
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-300 font-medium">
            {showLowStockOnly ? "Filtered items active ✕" : "Tap to show alerts ➔"}
          </p>
        </div>

        {/* Card 4: Distinct SKUs - Deep Violet / Fuchsia */}
        <div className="rounded-2xl p-3 sm:p-3.5 bg-gradient-to-br from-purple-950 via-slate-900 to-fuchsia-950 border-2 border-fuchsia-500/70 text-white shadow-lg shadow-fuchsia-950/50 space-y-1">
          <div className="flex items-center justify-between text-fuchsia-300">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider">Catalog SKUs (পণ্য)</span>
            <div className="p-1.5 rounded-lg bg-fuchsia-500/20 text-fuchsia-300">
              <Boxes className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-fuchsia-300 tracking-tight drop-shadow-sm">
            {summary ? summary.total_distinct_products : items.length}
          </div>
          <p className="text-[10px] text-slate-300 font-medium">
            Active factory products
          </p>
        </div>
      </div>

      {/* Main Mode Switcher: Stock vs Movement History */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-900 border-2 border-slate-700/80 rounded-2xl max-w-md shadow-md">
        <button
          onClick={() => setActiveTab("stock")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-black transition-all touch-manipulation min-h-[38px] ${
            activeTab === "stock"
              ? "bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white shadow-md shadow-purple-500/30"
              : "text-slate-300 hover:text-white hover:bg-slate-800"
          }`}
        >
          <Warehouse className="h-4 w-4" />
          <span>Warehouse Stock (গুদাম স্টক)</span>
          {lowStockItems.length > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400 text-slate-950 font-black">
              {lowStockItems.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-black transition-all touch-manipulation min-h-[38px] ${
            activeTab === "history"
              ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-600 text-white shadow-md shadow-blue-500/30"
              : "text-slate-300 hover:text-white hover:bg-slate-800"
          }`}
        >
          <History className="h-4 w-4" />
          <span>Movement Trail (হিসেব)</span>
        </button>
      </div>

      {/* TAB 1: STOCK LEVELS & LOW STOCK ALERTS */}
      {activeTab === "stock" && (
        <div className="space-y-3">
          {/* SPACE-EFFICIENT CATEGORY FILTER RAIL (Single-Row Horizontal Scrollable Strip) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-300 px-1">
              <span className="flex items-center gap-1 text-slate-200">
                <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400" />
                Category / বিভাগ:
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                {filteredItems.length} of {items.length} items
              </span>
            </div>

            {/* Compact Single-Row Chip Rail: Height is only ~38px, zero wasted vertical space */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 touch-manipulation">
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
                    onClick={() => setCategoryFilter(tab.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black shrink-0 whitespace-nowrap cursor-pointer active:scale-95 transition-all shadow-xs ${
                      isSelected ? tab.activeColor : tab.inactiveColor
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{tab.label}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded-md ${
                        isSelected ? "bg-black/30 text-white" : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Compact Integrated Search Bar + Low Stock Quick Filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by bottle name, 20L jar, dispenser, SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9.5 text-xs sm:text-sm h-9 sm:h-10 rounded-xl bg-slate-900 border-2 border-slate-700 text-white placeholder:text-slate-400 focus:border-cyan-400 shadow-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-2 text-xs text-slate-300 hover:text-white bg-slate-800 px-2 py-0.5 rounded-md"
                >
                  Clear
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowLowStockOnly((prev) => !prev)}
              className={`flex items-center justify-center gap-2 px-3.5 h-9 sm:h-10 rounded-xl text-xs font-black border-2 transition-all touch-manipulation shrink-0 active:scale-95 ${
                showLowStockOnly
                  ? "bg-amber-400 text-slate-950 border-amber-300 shadow-md shadow-amber-400/30"
                  : "bg-slate-900 text-amber-300 hover:bg-slate-800 border-amber-500/60 shadow-xs"
              }`}
            >
              <AlertTriangle className={`h-4 w-4 ${showLowStockOnly ? "text-slate-950" : "text-amber-400"}`} />
              <span>Low Stock Alerts ({lowStockItems.length})</span>
            </button>
          </div>

          {/* Active Low Stock Banner Notice */}
          {showLowStockOnly && (
            <div className="flex items-center justify-between rounded-xl bg-amber-500/20 border-2 border-amber-500/60 px-3.5 py-2 text-xs text-amber-200">
              <span className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                Filtered: Showing <strong>{filteredItems.length}</strong> product(s) needing replenishment.
              </span>
              <button
                onClick={() => setShowLowStockOnly(false)}
                className="font-black underline text-amber-300 hover:text-white"
              >
                Show All Products
              </button>
            </div>
          )}

          {/* MOBILE VIEW: High-Contrast Deep-Colored Product Cards with Funky Neon Badges */}
          <div className="md:hidden space-y-3">
            {filteredItems.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-700 p-8 text-center text-xs text-slate-400 space-y-2 bg-slate-900/60">
                <Boxes className="h-8 w-8 mx-auto text-slate-500" />
                <p className="font-bold text-white text-sm">No Products Found</p>
                <p>Try clearing filters or search query.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setCategoryFilter("ALL");
                    setShowLowStockOnly(false);
                  }}
                  className="text-xs mt-2 border-slate-700 bg-slate-800 text-slate-200"
                >
                  Reset All Filters
                </Button>
              </div>
            ) : (
              filteredItems.map((item) => {
                const isLowStock = item.available_stock <= item.reorder_level;
                const theme = getProductTheme(item.category, isLowStock);

                return (
                  <div
                    key={item.product_id}
                    className={`rounded-2xl p-3.5 sm:p-4 transition-all relative overflow-hidden space-y-3 ${theme.cardBg}`}
                  >
                    {/* Top Vibrant Neon Accent Strip */}
                    <div className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${theme.topBar}`} />

                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-2 pt-0.5">
                      <div className="min-w-0">
                        <h3 className="text-base font-black text-white tracking-tight leading-snug">
                          {item.name}
                        </h3>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-slate-900/90 text-slate-300 border border-slate-700 font-bold">
                            SKU: {item.sku}
                          </span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${theme.badgeBg}`}>
                            {theme.tag}
                          </span>
                        </div>
                      </div>

                      {/* Status Badge */}
                      {isLowStock ? (
                        <div className="flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-xl bg-rose-500 text-white shadow-lg shadow-rose-500/50 shrink-0 animate-pulse">
                          <AlertTriangle className="h-3.5 w-3.5 stroke-[3]" />
                          <span>LOW STOCK</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shrink-0">
                          <Check className="h-3.5 w-3.5 stroke-[3]" />
                          <span>IN STOCK</span>
                        </div>
                      )}
                    </div>

                    {/* Prominent Square Metric Layout with Funky Glowing Available Box */}
                    <div className="grid grid-cols-3 gap-2">
                      {/* Box 1: Available (Big Glowing Hero Metric) */}
                      <div className={`rounded-xl p-2 text-center space-y-0.5 ${theme.qtyBg}`}>
                        <span className="text-[10px] font-extrabold uppercase tracking-wider block opacity-90">
                          Available (মজুত)
                        </span>
                        <div className="text-2xl font-black tracking-tight leading-none">
                          {item.available_stock}
                        </div>
                        <span className="text-[10px] font-bold opacity-80 block">
                          {item.unit_of_measure}
                        </span>
                      </div>

                      {/* Box 2: Physical Count (Depot Total) */}
                      <div className="rounded-xl p-2 text-center bg-slate-950/80 border border-slate-700/80 text-white space-y-0.5">
                        <span className="text-[10px] font-extrabold uppercase tracking-wider block text-slate-400">
                          Physical (মোট)
                        </span>
                        <div className="text-xl font-black text-cyan-300 leading-none">
                          {item.current_stock}
                        </div>
                        <span className="text-[10px] font-semibold text-slate-400 block">
                          {item.unit_of_measure}
                        </span>
                      </div>

                      {/* Box 3: Reserved / Orders */}
                      <div className="rounded-xl p-2 text-center bg-slate-950/80 border border-slate-700/80 text-white space-y-0.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider block text-slate-400">
                          Reserved (বুকিং)
                        </span>
                        <div className="text-xl font-bold text-slate-300 leading-none">
                          {item.reserved_stock}
                        </div>
                        <span className="text-[10px] font-semibold text-slate-400 block">
                          {item.unit_of_measure}
                        </span>
                      </div>
                    </div>

                    {/* Reorder Threshold & Valuation Info */}
                    <div className="flex items-center justify-between bg-slate-950/70 p-2.5 rounded-xl border border-slate-800 text-[11px] text-slate-300">
                      <div>
                        <span className="text-slate-400">Reorder Alert: </span>
                        <strong className="text-white font-bold">{item.reorder_level} {item.unit_of_measure}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Valuation: </span>
                        <strong className="text-emerald-300 font-black">{formatCurrency(item.valuation)}</strong>
                      </div>
                    </div>

                    {/* High-Impact Funky Action Buttons */}
                    <div className="flex items-center gap-2 pt-0.5">
                      <Button
                        size="sm"
                        onClick={() => openAdjustStockModal(item, "add")}
                        className="flex-1 h-11 bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-black rounded-xl shadow-lg shadow-emerald-400/30 text-xs sm:text-sm gap-1.5 active:scale-95 transition-all cursor-pointer"
                      >
                        <Plus className="h-4.5 w-4.5 stroke-[3]" />
                        <span>+ Add Stock / নতুন মাল যোগ</span>
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAdjustStockModal(item, "remove")}
                        className="h-11 px-3.5 text-xs font-black text-rose-300 border-2 border-rose-500/50 bg-rose-500/20 hover:bg-rose-500/30 rounded-xl active:scale-95 transition-all cursor-pointer"
                        title="Deduct broken or damaged bottle"
                      >
                        <Minus className="h-4.5 w-4.5 stroke-[3]" />
                        <span className="sr-only">Remove</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openProductHistory(item)}
                        className="h-11 px-3.5 text-xs font-bold text-slate-300 hover:text-white rounded-xl border-2 border-slate-700 bg-slate-900/80 hover:bg-slate-800 active:scale-95 transition-all cursor-pointer"
                        title="View stock history"
                      >
                        <History className="h-4.5 w-4.5" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* DESKTOP VIEW: Deep Slate High-Contrast Table */}
          <div className="hidden md:block rounded-2xl border-2 border-slate-700/80 bg-slate-900 text-white shadow-2xl overflow-hidden">
            <div className="overflow-x-auto relative">
              <table className="w-full text-left text-xs min-w-[850px]">
                <thead className="bg-slate-950 text-slate-300 border-b-2 border-slate-700 font-bold">
                  <tr>
                    <th className="py-3 px-4">Product Name / SKU</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-right">Physical Stock</th>
                    <th className="py-3 px-4 text-right">Committed</th>
                    <th className="py-3 px-4 text-right">Available</th>
                    <th className="py-3 px-4 text-right">Reorder Level</th>
                    <th className="py-3 px-4 text-right">Shortage</th>
                    <th className="py-3 px-4 text-right">Valuation</th>
                    <th className="py-3 px-4 text-right">Status</th>
                    <th className="py-3 px-4 text-right">Quick Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-400">
                        {isLoading ? "Loading inventory stock levels..." : "No products found matching filters."}
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const isLowStock = item.available_stock <= item.reorder_level;
                      const theme = getProductTheme(item.category, isLowStock);

                      return (
                        <tr
                          key={item.product_id}
                          className={`hover:bg-slate-800/80 transition-colors ${
                            isLowStock ? "bg-rose-950/30 hover:bg-rose-950/40 border-l-4 border-l-rose-500" : ""
                          }`}
                        >
                          <td className="py-3.5 px-4">
                            <div className="font-extrabold text-white text-xs">{item.name}</div>
                            <div className="font-mono text-[11px] text-slate-400">{item.sku}</div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${theme.badgeBg}`}>
                              {theme.tag}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right font-black text-cyan-300">
                            {item.current_stock} {item.unit_of_measure}
                          </td>
                          <td className="py-3.5 px-4 text-right text-slate-400 font-medium">
                            {item.reserved_stock} {item.unit_of_measure}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <span
                              className={`font-black text-sm px-2 py-0.5 rounded-lg ${
                                isLowStock ? "bg-rose-500 text-white font-black" : "text-emerald-300 font-black"
                              }`}
                            >
                              {item.available_stock} {item.unit_of_measure}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right text-slate-400 font-mono">
                            {item.reorder_level} {item.unit_of_measure}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {isLowStock ? (
                              <span className="font-black text-rose-400">
                                -{Math.max(0, item.reorder_level - item.available_stock)}
                              </span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right font-black text-emerald-300">
                            {formatCurrency(item.valuation)}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {isLowStock ? (
                              <Badge className="text-[10px] py-0.5 font-black bg-rose-500 text-white border-0 shadow-xs">
                                Low Stock
                              </Badge>
                            ) : (
                              <Badge className="text-[10px] py-0.5 font-black bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
                                In Stock
                              </Badge>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                onClick={() => openAdjustStockModal(item, "add")}
                                className="h-8 px-2.5 text-xs font-black gap-1 bg-gradient-to-r from-emerald-400 to-teal-400 hover:from-emerald-300 hover:to-teal-300 text-slate-950 rounded-lg shadow-xs"
                              >
                                <Plus className="h-3.5 w-3.5 stroke-[3]" /> + Add
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openAdjustStockModal(item, "remove")}
                                className="h-8 px-2 text-xs font-black text-rose-300 border-rose-500/50 bg-rose-500/20 hover:bg-rose-500/30 rounded-lg"
                                title="Deduct broken or damaged bottle"
                              >
                                <Minus className="h-3.5 w-3.5 stroke-[3]" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openProductHistory(item)}
                                className="h-8 px-2 text-xs text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"
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
          </div>
        </div>
      )}

      {/* TAB 2: AUDIT TRAIL */}
      {activeTab === "history" && (
        <div className="rounded-2xl border-2 border-slate-700/80 bg-slate-900 text-white shadow-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-black text-white">
                Complete Stock Movement Audit Trail
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Immutable record of receipts, dispatches, damages and adjustments.
              </p>
            </div>

            <div className="w-full sm:w-64">
              <Input
                placeholder="Filter by product, SKU, note..."
                value={movementSearch}
                onChange={(e) => setMovementSearch(e.target.value)}
                className="text-xs h-9 bg-slate-950 border border-slate-700 text-white placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="overflow-x-auto relative rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs min-w-[700px]">
              <thead className="bg-slate-950 text-slate-300 border-b border-slate-800 font-bold">
                <tr>
                  <th className="py-2.5 px-4">Date & Time</th>
                  <th className="py-2.5 px-4">Product</th>
                  <th className="py-2.5 px-4">Movement Type</th>
                  <th className="py-2.5 px-4 text-right">Quantity</th>
                  <th className="py-2.5 px-4">Reason / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {isMovementsLoading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      Loading stock movements...
                    </td>
                  </tr>
                ) : filteredAllMovements.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      No movement records found.
                    </td>
                  </tr>
                ) : (
                  filteredAllMovements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-800/50">
                      <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                        {new Date(m.created_at).toLocaleString("en-IN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="py-3 px-4 font-bold text-white">
                        {m.product_name || "Unknown SKU"}
                      </td>
                      <td className="py-3 px-4">{renderMovementBadge(m.movement_type)}</td>
                      <td className="py-3 px-4 text-right font-black">
                        <span
                          className={
                            m.quantity > 0
                              ? "text-emerald-400 font-black"
                              : "text-rose-400 font-black"
                          }
                        >
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400 max-w-xs truncate">
                        {m.notes || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PRODUCT HISTORY MODAL */}
      {historyProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-2xl rounded-3xl bg-slate-900 border-2 border-slate-700 p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto text-white">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-black text-base sm:text-lg text-white">
                  Movement History: {historyProduct.name}
                </h3>
                <p className="text-xs text-slate-400 font-mono">SKU: {historyProduct.sku}</p>
              </div>
              <button
                onClick={() => setHistoryProduct(null)}
                className="text-slate-400 hover:text-white text-sm font-bold p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950 p-3 rounded-2xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Physical Stock</span>
                  <strong className="text-lg text-white font-black">{historyProduct.current_stock} {historyProduct.unit_of_measure}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Available Delivery</span>
                  <strong className="text-lg text-emerald-300 font-black">{historyProduct.available_stock} {historyProduct.unit_of_measure}</strong>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-300 font-bold">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3 text-right">Quantity</th>
                      <th className="py-2 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {isHistoryLoading ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-400">Loading history...</td>
                      </tr>
                    ) : productMovements.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-400">No recent movements recorded.</td>
                      </tr>
                    ) : (
                      productMovements.map((mov) => (
                        <tr key={mov.id} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 text-slate-400 font-mono text-[10px]">
                            {new Date(mov.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 px-3">{renderMovementBadge(mov.movement_type)}</td>
                          <td className="py-2.5 px-3 text-right font-black">
                            <span className={mov.quantity > 0 ? "text-emerald-400" : "text-rose-400"}>
                              {mov.quantity > 0 ? `+${mov.quantity}` : mov.quantity}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 truncate max-w-xs">{mov.notes || "—"}</td>
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
                  className="text-xs border-slate-700 bg-slate-800 text-slate-200 hover:text-white"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-3xl bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border-2 border-slate-700 p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto text-white">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-2xl text-slate-950 shadow-lg ${
                    stockMode === "add"
                      ? "bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-400 shadow-emerald-400/30"
                      : "bg-gradient-to-br from-rose-500 via-red-500 to-amber-500 text-white shadow-rose-500/30"
                  }`}
                >
                  {stockMode === "add" ? (
                    <PackagePlus className="h-5 w-5 stroke-[2.5]" />
                  ) : (
                    <ArrowUpDown className="h-5 w-5 stroke-[2.5]" />
                  )}
                </div>
                <div>
                  <h3 className="font-black text-base sm:text-lg text-white leading-tight">
                    {stockMode === "add" ? "+ Add Stock / নতুন মাল যোগ" : "- Deduct / নষ্ট মাল বাদ"}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium">
                    Fast update for warehouse depot inventory
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold transition-colors cursor-pointer"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-950 rounded-2xl border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setStockMode("add");
                  setAdjustType("PURCHASE_RECEIPT");
                }}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-black transition-all min-h-[44px] touch-manipulation cursor-pointer ${
                  stockMode === "add"
                    ? "bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-slate-950 shadow-md shadow-emerald-400/30 ring-2 ring-emerald-300"
                    : "text-slate-400 hover:text-white hover:bg-slate-900"
                }`}
              >
                <Plus className="h-4 w-4 stroke-[3]" />
                <span>+ Add Stock (নতুন মাল)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStockMode("remove");
                  setAdjustType("DAMAGE_WRITEOFF");
                }}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-black transition-all min-h-[44px] touch-manipulation cursor-pointer ${
                  stockMode === "remove"
                    ? "bg-gradient-to-r from-rose-500 to-amber-500 text-white shadow-md shadow-rose-500/30 ring-2 ring-rose-300"
                    : "text-slate-400 hover:text-white hover:bg-slate-900"
                }`}
              >
                <Minus className="h-4 w-4 stroke-[3]" />
                <span>- Remove (নষ্ট / ভাঙা)</span>
              </button>
            </div>

            {/* Product Summary Card */}
            <div className="p-3.5 rounded-2xl bg-slate-950 border-2 border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Target Product</span>
                  <div className="font-black text-sm sm:text-base text-white">{selectedProduct.name}</div>
                  <div className="text-[11px] font-mono text-slate-400">{selectedProduct.sku}</div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Current Stock</span>
                  <div className="text-xl font-black text-cyan-300">
                    {selectedProduct.available_stock} <span className="text-xs font-normal text-slate-400">{selectedProduct.unit_of_measure}</span>
                  </div>
                </div>
              </div>

              {/* Product Picker Dropdown */}
              {items.length > 1 && (
                <div className="pt-1 border-t border-slate-800">
                  <label htmlFor="switch-sku-select" className="text-[11px] text-slate-400 block mb-1">
                    Or switch SKU / অন্য পণ্য নির্বাচন করুন:
                  </label>
                  <select
                    id="switch-sku-select"
                    value={selectedProduct.product_id}
                    onChange={(e) => {
                      const found = items.find((p) => p.product_id === e.target.value);
                      if (found) setSelectedProduct(found);
                    }}
                    className="w-full text-xs h-9 rounded-xl border border-slate-700 bg-slate-900 text-white px-2.5 focus:border-cyan-400 outline-none"
                  >
                    {items.map((prod) => (
                      <option key={prod.product_id} value={prod.product_id} className="bg-slate-900 text-white">
                        {prod.name} ({prod.sku}) — Available: {prod.available_stock} {prod.unit_of_measure}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Form Inputs */}
            <form onSubmit={handleAdjustSubmit} className="space-y-4">
              {/* Quantity Input with Tactile Quick-Add Buttons */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="quantity-input" className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                    Quantity to {stockMode === "add" ? "Add (+)" : "Remove (-)"} / সংখ্যা:
                  </label>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Unit: {selectedProduct.unit_of_measure}
                  </span>
                </div>

                <div className="relative">
                  <Input
                    id="quantity-input"
                    type="number"
                    min="1"
                    placeholder="Enter quantity (e.g. 50)"
                    value={qtyString}
                    onChange={(e) => setQtyString(e.target.value)}
                    className="text-base sm:text-lg font-black h-12 rounded-2xl bg-slate-950 border-2 border-slate-700 text-white focus:border-cyan-400 px-4"
                    autoFocus
                    required
                  />
                </div>

                {/* Funky Tactile Quick-Add Preset Pills */}
                <div className="flex items-center gap-1.5 pt-1 overflow-x-auto no-scrollbar">
                  {[10, 25, 50, 100, 200].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setQtyString(String(preset))}
                      className="px-3 py-1.5 rounded-xl text-xs font-black bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/40 active:scale-95 transition-all shrink-0 cursor-pointer"
                    >
                      +{preset}
                    </button>
                  ))}
                  {qtyString && (
                    <button
                      type="button"
                      onClick={() => setQtyString("")}
                      className="px-2 py-1.5 text-xs text-rose-400 hover:text-white underline cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Live Real-Time Projection Preview */}
                {parseInt(qtyString, 10) > 0 && (
                  <div className="p-2.5 rounded-xl bg-slate-950 border border-emerald-500/40 text-xs flex items-center justify-between text-slate-300">
                    <span>Resulting Stock Balance:</span>
                    <strong className="text-emerald-300 font-black text-sm">
                      {selectedProduct.available_stock} ➔{" "}
                      {stockMode === "add"
                        ? selectedProduct.available_stock + parseInt(qtyString, 10)
                        : Math.max(0, selectedProduct.available_stock - parseInt(qtyString, 10))}{" "}
                      {selectedProduct.unit_of_measure} ({stockMode === "add" ? "+" : "-"}
                      {parseInt(qtyString, 10)})
                    </strong>
                  </div>
                )}
              </div>

              {/* Movement Classification Reason */}
              <div className="space-y-1.5">
                <label htmlFor="adjust-type-select" className="text-xs font-bold text-white block">
                  Movement Reason / শ্রেণীবিভাগ:
                </label>
                <select
                  id="adjust-type-select"
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as StockMovementType)}
                  className="w-full text-xs h-10 rounded-xl border border-slate-700 bg-slate-950 text-white px-3 focus:border-cyan-400 outline-none"
                >
                  {stockMode === "add" ? (
                    <>
                      <option value="PURCHASE_RECEIPT">Supplier / Plant Purchase Receipt (+)</option>
                      <option value="ROUTE_RETURN">Route Over-Stock Return (+)</option>
                      <option value="PHYSICAL_AUDIT_ADJUSTMENT">Audit Reconciliation Surplus (+)</option>
                    </>
                  ) : (
                    <>
                      <option value="DAMAGE_WRITEOFF">Damaged / Leaking Bottle Writeoff (-)</option>
                      <option value="SCRAP_WRITEOFF">Old Bottle Scrapped / Decommissioned (-)</option>
                      <option value="ADJUSTMENT_OUT">Physical Audit Shortage Deduction (-)</option>
                    </>
                  )}
                </select>
              </div>

              {/* Notes / Reason */}
              <div className="space-y-1.5">
                <label htmlFor="adjust-reason-input" className="text-xs font-bold text-white block">
                  Optional Note / রিসিট বা চালান নম্বর:
                </label>
                <Input
                  id="adjust-reason-input"
                  placeholder="e.g. Batch #401, supplier bill, or audit notes"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="text-xs h-10 rounded-xl bg-slate-950 border border-slate-700 text-white placeholder:text-slate-400"
                />
              </div>

              {/* Modal Action Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="flex-1 h-11 text-xs border-slate-700 bg-slate-800 text-slate-300 hover:text-white"
                >
                  Cancel / বাতিল
                </Button>

                <Button
                  type="submit"
                  disabled={isSubmitting || !qtyString}
                  className={`flex-2 h-11 font-black text-xs sm:text-sm rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer ${
                    stockMode === "add"
                      ? "bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 shadow-emerald-400/30"
                      : "bg-gradient-to-r from-rose-500 via-red-500 to-amber-500 hover:from-rose-400 hover:to-amber-400 text-white shadow-rose-500/30"
                  }`}
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-1.5">
                      <RotateCcw className="h-4 w-4 animate-spin" /> Saving...
                    </span>
                  ) : stockMode === "add" ? (
                    <span className="flex items-center gap-1.5">
                      <Check className="h-4 w-4 stroke-[3]" /> Add to Stock (+{qtyString || "0"})
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Check className="h-4 w-4 stroke-[3]" /> Deduct from Stock (-{qtyString || "0"})
                    </span>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
