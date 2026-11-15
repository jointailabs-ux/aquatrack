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
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import {
  getInventoryStockLevels,
  getStockMovements,
  adjustStock,
} from "@/modules/inventory/inventory.service";
import {
  InventoryItemRecord,
  InventoryMovementRecord,
  InventoryValuationSummary,
  StockMovementType,
  calculateInventoryValuationFromItems,
} from "@/modules/inventory/inventory.schema";
import { formatCurrency } from "@/lib/utils";

const STOCK_STORAGE_KEY = "aquatrack_inventory_cache_v2";
const STOCK_CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL for zero-latency instant transitions

// Module-level client cache for instant zero-latency inventory transitions
let cachedInventoryState: {
  items: InventoryItemRecord[];
  summary: InventoryValuationSummary | null;
  timestamp: number;
} | null = null;

function getInitialStock(): { items: InventoryItemRecord[]; summary: InventoryValuationSummary | null } {
  if (cachedInventoryState && cachedInventoryState.items.length > 0) {
    return cachedInventoryState;
  }
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(STOCK_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
          cachedInventoryState = parsed;
          return parsed;
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }
  return { items: [], summary: null };
}

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
    badgeBg: "bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-300 dark:border-blue-500/40",
    activeColor: "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-600/30 border-2 border-indigo-300 dark:border-indigo-400 font-bold",
    inactiveColor: "bg-card hover:bg-muted text-foreground border-2 border-border hover:border-indigo-400 dark:bg-slate-900/80 dark:hover:bg-slate-800 dark:text-slate-200 dark:border-slate-800",
  },
  {
    id: "REFILLABLE_WATER",
    label: "Refill Jars",
    labelBn: "রিফিল জার",
    icon: Droplets,
    badgeBg: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/80 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-500/40",
    activeColor: "bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-600 text-white font-bold shadow-md shadow-cyan-500/30 border-2 border-cyan-300",
    inactiveColor: "bg-card hover:bg-muted text-foreground border-2 border-border hover:border-cyan-400 dark:bg-slate-900/80 dark:hover:bg-slate-800 dark:text-slate-200 dark:border-slate-800",
  },
  {
    id: "PACKAGED_WATER",
    label: "Bottled Cases",
    labelBn: "বোতল পানি",
    icon: Package,
    badgeBg: "bg-sky-100 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300 border border-sky-300 dark:border-sky-500/40",
    activeColor: "bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 text-white font-bold shadow-md shadow-sky-500/30 border-2 border-sky-300",
    inactiveColor: "bg-card hover:bg-muted text-foreground border-2 border-border hover:border-sky-400 dark:bg-slate-900/80 dark:hover:bg-slate-800 dark:text-slate-200 dark:border-slate-800",
  },
  {
    id: "EMPTY_JAR_ASSET",
    label: "Empty Jars",
    labelBn: "খালি জার",
    icon: Boxes,
    badgeBg: "bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40",
    activeColor: "bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 text-white font-bold shadow-md shadow-amber-500/30 border-2 border-amber-300",
    inactiveColor: "bg-card hover:bg-muted text-foreground border-2 border-border hover:border-amber-400 dark:bg-slate-900/80 dark:hover:bg-slate-800 dark:text-slate-200 dark:border-slate-800",
  },
  {
    id: "DISPENSER_EQUIPMENT",
    label: "Dispensers",
    labelBn: "যন্ত্রপাতি",
    icon: ArrowUpDown,
    badgeBg: "bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-300 dark:border-purple-500/40",
    activeColor: "bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 text-white font-bold shadow-md shadow-purple-500/30 border-2 border-purple-300",
    inactiveColor: "bg-card hover:bg-muted text-foreground border-2 border-border hover:border-purple-400 dark:bg-slate-900/80 dark:hover:bg-slate-800 dark:text-slate-200 dark:border-slate-800",
  },
];

export default function SingleWarehouseInventoryPage() {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = React.useState<"stock" | "history">("stock");
  
  // Instant persistent hydration from cache (zero white flicker)
  const initial = React.useMemo(() => getInitialStock(), []);
  const [items, setItems] = React.useState<InventoryItemRecord[]>(initial.items);
  const [summary, setSummary] = React.useState<InventoryValuationSummary | null>(initial.summary);
  const [isLoading, setIsLoading] = React.useState<boolean>(initial.items.length === 0);
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

  const loadData = React.useCallback(async (forceRefresh = false) => {
    const now = Date.now();
    const hasFreshCache =
      !forceRefresh &&
      cachedInventoryState &&
      cachedInventoryState.items.length > 0 &&
      now - (cachedInventoryState.timestamp || 0) < STOCK_CACHE_TTL_MS;

    if (hasFreshCache) {
      return;
    }

    try {
      // Single server action: fetch stock items and compute summary locally in-memory
      const itemsRes = await getInventoryStockLevels();

      if (itemsRes.success && itemsRes.data) {
        const freshItems = itemsRes.data;
        const freshSummary = calculateInventoryValuationFromItems(freshItems);
        
        setItems(freshItems);
        setSummary(freshSummary);

        cachedInventoryState = {
          items: freshItems,
          summary: freshSummary,
          timestamp: Date.now(),
        };

        try {
          localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(cachedInventoryState));
        } catch {
          // Ignore quota errors
        }
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
        await loadData(true);
      } else {
        loadData(true);
      }
    } catch {
      addToast({
        type: "error",
        title: "Network Error",
        message: "An unexpected error occurred. Syncing latest data...",
      });
      await loadData(true);
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
        cardBg: "bg-card border-2 border-rose-300 hover:border-rose-500 dark:bg-slate-900/90 dark:border-rose-500/70 shadow-xs hover:shadow-md",
        topBar: "from-rose-500 via-orange-500 to-amber-500",
        badgeBg: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-500/50",
        qtyBg: "bg-rose-50 text-rose-800 border-2 border-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/50",
        tag: "Low Stock Alert",
      };
    }
    switch (cat) {
      case "REFILLABLE_WATER":
        return {
          cardBg: "bg-card border-2 border-border hover:border-cyan-400 dark:bg-slate-900/90 dark:border-slate-800 dark:hover:border-cyan-500/60 shadow-xs hover:shadow-md",
          topBar: "from-cyan-400 via-teal-400 to-emerald-400",
          badgeBg: "bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950/80 dark:text-cyan-300 dark:border-cyan-500/50",
          qtyBg: "bg-cyan-50 text-cyan-900 border-2 border-cyan-200 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/40",
          tag: "20L Refill Jar",
        };
      case "PACKAGED_WATER":
        return {
          cardBg: "bg-card border-2 border-border hover:border-sky-400 dark:bg-slate-900/90 dark:border-slate-800 dark:hover:border-blue-500/60 shadow-xs hover:shadow-md",
          topBar: "from-sky-400 via-blue-500 to-indigo-500",
          badgeBg: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-blue-950/80 dark:text-sky-300 dark:border-blue-500/50",
          qtyBg: "bg-sky-50 text-sky-900 border-2 border-sky-200 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/40",
          tag: "Packaged Bottle",
        };
      case "EMPTY_JAR_ASSET":
        return {
          cardBg: "bg-card border-2 border-border hover:border-amber-400 dark:bg-slate-900/90 dark:border-slate-800 dark:hover:border-amber-500/60 shadow-xs hover:shadow-md",
          topBar: "from-amber-400 via-orange-400 to-yellow-400",
          badgeBg: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-500/50",
          qtyBg: "bg-amber-50 text-amber-900 border-2 border-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40",
          tag: "Empty Container",
        };
      case "DISPENSER_EQUIPMENT":
        return {
          cardBg: "bg-card border-2 border-border hover:border-purple-400 dark:bg-slate-900/90 dark:border-slate-800 dark:hover:border-purple-500/60 shadow-xs hover:shadow-md",
          topBar: "from-purple-400 via-fuchsia-500 to-pink-500",
          badgeBg: "bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/80 dark:text-fuchsia-300 dark:border-purple-500/50",
          qtyBg: "bg-purple-50 text-purple-900 border-2 border-purple-200 dark:bg-purple-500/20 dark:text-fuchsia-300 dark:border-purple-500/40",
          tag: "Dispenser Gear",
        };
      default:
        return {
          cardBg: "bg-card border-2 border-border hover:border-indigo-400 dark:bg-slate-900/90 dark:border-slate-800 dark:hover:border-indigo-500/60 shadow-xs hover:shadow-md",
          topBar: "from-indigo-400 via-purple-400 to-pink-400",
          badgeBg: "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/80 dark:text-indigo-300 dark:border-indigo-500/50",
          qtyBg: "bg-indigo-50 text-indigo-900 border-2 border-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/40",
          tag: "Warehouse SKU",
        };
    }
  };

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Top Header with Dual-Mode Gradient & Bright Accents */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 dark:from-slate-950 dark:via-indigo-950 dark:to-slate-900 text-white border-2 border-sky-400/40 dark:border-indigo-500/40 shadow-md dark:shadow-xl">
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
          <p className="text-xs text-sky-100 dark:text-slate-300 mt-0.5 font-medium">
            Factory water jars, mineral water packs & dispensers live inventory
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => loadData(true)}
            disabled={isLoading}
            className="gap-1.5 text-xs h-9 sm:h-10 px-3 rounded-xl border-white/20 dark:border-slate-700 bg-white/10 dark:bg-slate-900/90 text-white dark:text-slate-200 hover:bg-white/20 dark:hover:bg-slate-800 hover:text-white font-bold"
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

      {/* Colorful Dual-Mode KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {/* Card 1: Total Available Units */}
        <div className="rounded-2xl p-3 sm:p-3.5 bg-gradient-to-br from-sky-50 via-blue-50/50 to-white dark:from-blue-950/80 dark:via-slate-900 dark:to-cyan-950/80 border-2 border-sky-200 dark:border-cyan-500/70 text-foreground dark:text-white shadow-xs dark:shadow-lg space-y-1">
          <div className="flex items-center justify-between text-sky-800 dark:text-cyan-300">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider">Available Stock (মজুত)</span>
            <div className="p-1.5 rounded-lg bg-sky-100 text-sky-700 dark:bg-cyan-500/20 dark:text-cyan-300">
              <Warehouse className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-sky-700 dark:text-cyan-300 tracking-tight drop-shadow-xs">
            {summary ? summary.total_units_in_warehouse.toLocaleString() : items.reduce((s, i) => s + i.available_stock, 0).toLocaleString()}
          </div>
          <p className="text-[10px] text-muted-foreground dark:text-slate-300 font-medium">
            Ready in warehouse depot
          </p>
        </div>

        {/* Card 2: Inventory Valuation */}
        <div className="rounded-2xl p-3 sm:p-3.5 bg-gradient-to-br from-emerald-50 via-teal-50/50 to-white dark:from-emerald-950/80 dark:via-slate-900 dark:to-teal-950/80 border-2 border-emerald-200 dark:border-emerald-500/70 text-foreground dark:text-white shadow-xs dark:shadow-lg space-y-1">
          <div className="flex items-center justify-between text-emerald-800 dark:text-emerald-300">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider">Asset Value (মূল্য)</span>
            <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-700 dark:text-emerald-300 tracking-tight drop-shadow-xs">
            {summary ? formatCurrency(summary.total_inventory_valuation) : formatCurrency(items.reduce((s, i) => s + i.valuation, 0))}
          </div>
          <p className="text-[10px] text-muted-foreground dark:text-slate-300 font-medium">
            Total inventory valuation
          </p>
        </div>

        {/* Card 3: Reorder Alerts */}
        <div
          onClick={() => {
            setShowLowStockOnly((prev) => !prev);
            setActiveTab("stock");
          }}
          className={`rounded-2xl p-3 sm:p-3.5 bg-gradient-to-br from-amber-50 via-orange-50/50 to-white dark:from-amber-950/80 dark:via-slate-900 dark:to-orange-950/80 border-2 text-foreground dark:text-white shadow-xs dark:shadow-lg cursor-pointer transition-all space-y-1 ${
            showLowStockOnly
              ? "border-amber-400 ring-2 ring-amber-400/50"
              : "border-amber-200 dark:border-amber-500/70 hover:border-amber-400"
          }`}
        >
          <div className="flex items-center justify-between text-amber-800 dark:text-amber-300">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider flex items-center gap-1">
              Low Stock (কম স্টক)
              {showLowStockOnly && (
                <Badge className="text-[9px] py-0 px-1 bg-amber-400 text-slate-950 font-black">Filtered</Badge>
              )}
            </span>
            <div className="p-1.5 rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-amber-700 dark:text-amber-300 tracking-tight flex items-center gap-2 drop-shadow-xs">
            <span>{summary ? summary.low_stock_items_count : lowStockItems.length}</span>
            {lowStockItems.length > 0 && (
              <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded-md bg-amber-400 text-slate-950 animate-pulse">
                Needs Stock
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground dark:text-slate-300 font-medium">
            {showLowStockOnly ? "Filtered items active ✕" : "Tap to show alerts ➔"}
          </p>
        </div>

        {/* Card 4: Distinct SKUs */}
        <div className="rounded-2xl p-3 sm:p-3.5 bg-gradient-to-br from-purple-50 via-fuchsia-50/50 to-white dark:from-purple-950/80 dark:via-slate-900 dark:to-fuchsia-950/80 border-2 border-purple-200 dark:border-fuchsia-500/70 text-foreground dark:text-white shadow-xs dark:shadow-lg space-y-1">
          <div className="flex items-center justify-between text-purple-800 dark:text-fuchsia-300">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider">Catalog SKUs (পণ্য)</span>
            <div className="p-1.5 rounded-lg bg-purple-100 text-purple-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300">
              <Boxes className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-purple-700 dark:text-fuchsia-300 tracking-tight drop-shadow-xs">
            {summary ? summary.total_distinct_products : items.length}
          </div>
          <p className="text-[10px] text-muted-foreground dark:text-slate-300 font-medium">
            Active factory products
          </p>
        </div>
      </div>

      {/* Main Mode Switcher: Stock vs Movement History */}
      <div className="flex items-center gap-1.5 p-1 bg-card dark:bg-slate-900 border-2 border-border dark:border-slate-700/80 rounded-2xl max-w-md shadow-xs dark:shadow-md">
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
            <div className="flex items-center justify-between text-xs font-bold text-foreground px-1">
              <span className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                Category Filter (বিভাগ):
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">
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
                        isSelected ? "bg-black/25 text-white" : "bg-muted text-muted-foreground dark:bg-slate-800 dark:text-slate-400"
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
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by bottle name, 20L jar, dispenser, SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9.5 text-xs sm:text-sm h-9 sm:h-10 rounded-xl bg-card border-2 border-border text-foreground placeholder:text-muted-foreground focus:border-primary dark:bg-slate-900 dark:border-slate-700 dark:text-white dark:placeholder:text-slate-400 shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-2 text-xs text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 rounded-md cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowLowStockOnly((prev) => !prev)}
              className={`flex items-center justify-center gap-2 px-3.5 h-9 sm:h-10 rounded-xl text-xs font-black border-2 transition-all touch-manipulation shrink-0 active:scale-95 cursor-pointer ${
                showLowStockOnly
                  ? "bg-amber-400 text-slate-950 border-amber-300 shadow-md shadow-amber-400/30"
                  : "bg-card text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-slate-800 border-amber-300 dark:border-amber-500/60 shadow-2xs"
              }`}
            >
              <AlertTriangle className={`h-4 w-4 ${showLowStockOnly ? "text-slate-950" : "text-amber-500"}`} />
              <span>Low Stock Alerts ({lowStockItems.length})</span>
            </button>
          </div>

          {/* Active Low Stock Banner Notice */}
          {showLowStockOnly && (
            <div className="flex items-center justify-between rounded-xl bg-amber-500/15 border-2 border-amber-500/40 px-3.5 py-2 text-xs text-amber-900 dark:text-amber-200">
              <span className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                Filtered: Showing <strong>{filteredItems.length}</strong> product(s) needing replenishment.
              </span>
              <button
                onClick={() => setShowLowStockOnly(false)}
                className="font-black underline text-amber-700 dark:text-amber-300 hover:text-foreground cursor-pointer"
              >
                Show All Products
              </button>
            </div>
          )}

          {/* MOBILE VIEW: Dual-Mode Product Cards with Vibrant Accents */}
          <div className="md:hidden space-y-3">
            {filteredItems.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-border dark:border-slate-700 p-8 text-center text-xs text-muted-foreground dark:text-slate-400 space-y-2 bg-card/60 dark:bg-slate-900/60">
                <Boxes className="h-8 w-8 mx-auto text-muted-foreground/60" />
                <p className="font-bold text-foreground dark:text-white text-sm">No Products Found</p>
                <p>Try clearing filters or search query.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setCategoryFilter("ALL");
                    setShowLowStockOnly(false);
                  }}
                  className="text-xs mt-2 border-border"
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
                        <h3 className="text-base font-black text-foreground dark:text-white tracking-tight leading-snug">
                          {item.name}
                        </h3>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border dark:bg-slate-900/90 dark:text-slate-300 dark:border-slate-700 font-bold">
                            SKU: {item.sku}
                          </span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${theme.badgeBg}`}>
                            {theme.tag}
                          </span>
                        </div>
                      </div>

                      {/* Status Badge */}
                      {isLowStock ? (
                        <div className="flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-xl bg-rose-500 text-white shadow-md shadow-rose-500/40 shrink-0 animate-pulse">
                          <AlertTriangle className="h-3.5 w-3.5 stroke-[3]" />
                          <span>LOW STOCK</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-xl bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/40 shrink-0">
                          <Check className="h-3.5 w-3.5 stroke-[3]" />
                          <span>IN STOCK</span>
                        </div>
                      )}
                    </div>

                    {/* Metric Display: Available for all; With Customers for 20L jars (Physical and Reserved removed) */}
                    {Boolean(
                      item.is_reusable_jar ||
                      item.category === "REFILLABLE_WATER" ||
                      item.name.toLowerCase().includes("20l") ||
                      item.name.toLowerCase().includes("jar")
                    ) ? (
                      /* 2-Box Layout for 20L Reusable Jars */
                      <div className="grid grid-cols-2 gap-2.5">
                        {/* Box 1: Available in Stock (মজুত) */}
                        <div className={`rounded-xl p-3 text-center space-y-1 ${theme.qtyBg}`}>
                          <span className="text-[10px] font-extrabold uppercase tracking-wider block opacity-90">
                            Available (মজুত)
                          </span>
                          <div className="text-3xl font-black tracking-tight leading-none">
                            {item.available_stock}
                          </div>
                          <span className="text-[10px] font-bold opacity-80 block">
                            {item.unit_of_measure} (In Godown)
                          </span>
                        </div>

                        {/* Box 2: Present with Customers (কাস্টমারের বাড়িতে) */}
                        <div className="rounded-xl p-3 text-center bg-emerald-500/15 border-2 border-emerald-500/40 text-foreground dark:bg-emerald-950/60 dark:border-emerald-500/50 dark:text-white space-y-1">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider block text-emerald-700 dark:text-emerald-300 flex items-center justify-center gap-1">
                            <Users className="h-3 w-3" />
                            With Customers (কাস্টমারের কাছে)
                          </span>
                          <div className="text-3xl font-black text-emerald-700 dark:text-emerald-300 leading-none">
                            {item.customer_holding_jars ?? 0}
                          </div>
                          <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-200 block">
                            {item.unit_of_measure} (At Houses/Shops)
                          </span>
                        </div>
                      </div>
                    ) : (
                      /* Single Clean Hero Box for Packaged Water Bottles & Other Items */
                      <div className={`rounded-xl p-3 text-center space-y-1 ${theme.qtyBg}`}>
                        <div className="flex items-center justify-between px-2">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider opacity-90">
                            Available in Stock (মজুত)
                          </span>
                          <span className="text-[10px] font-bold opacity-80">
                            Ready for Sale / Delivery
                          </span>
                        </div>
                        <div className="text-3xl font-black tracking-tight leading-none py-1">
                          {item.available_stock}{" "}
                          <span className="text-sm font-bold opacity-80">{item.unit_of_measure}</span>
                        </div>
                      </div>
                    )}

                    {/* Reorder Threshold & Valuation Info */}
                    <div className="flex items-center justify-between bg-muted/30 p-2.5 rounded-xl border border-border text-[11px] text-muted-foreground dark:bg-slate-950/70 dark:border-slate-800 dark:text-slate-300">
                      <div>
                        <span>Reorder Alert: </span>
                        <strong className="text-foreground dark:text-white font-bold">{item.reorder_level} {item.unit_of_measure}</strong>
                      </div>
                      <div>
                        <span>Valuation: </span>
                        <strong className="text-emerald-700 dark:text-emerald-300 font-black">{formatCurrency(item.valuation)}</strong>
                      </div>
                    </div>

                    {/* High-Impact Action Buttons */}
                    <div className="flex items-center gap-2 pt-0.5">
                      <Button
                        size="sm"
                        onClick={() => openAdjustStockModal(item, "add")}
                        className="flex-1 h-11 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:from-emerald-600 hover:to-cyan-700 text-white font-black rounded-xl shadow-md shadow-emerald-500/25 text-xs sm:text-sm gap-1.5 active:scale-95 transition-all cursor-pointer"
                      >
                        <Plus className="h-4.5 w-4.5 stroke-[3]" />
                        <span>+ Add Stock / নতুন মাল যোগ</span>
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAdjustStockModal(item, "remove")}
                        className="h-11 px-3.5 text-xs font-black text-rose-700 dark:text-rose-300 border-2 border-rose-300 dark:border-rose-500/50 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/20 dark:hover:bg-rose-500/30 rounded-xl active:scale-95 transition-all cursor-pointer"
                        title="Deduct broken or damaged bottle"
                      >
                        <Minus className="h-4.5 w-4.5 stroke-[3]" />
                        <span className="sr-only">Remove</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openProductHistory(item)}
                        className="h-11 px-3.5 text-xs font-bold text-muted-foreground hover:text-foreground rounded-xl border-2 border-border bg-card hover:bg-muted dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:text-white active:scale-95 transition-all cursor-pointer"
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

          {/* DESKTOP VIEW: Dual-Mode High-Contrast Table (Zero Confusing Physical/Reserved Columns) */}
          <div className="hidden md:block rounded-2xl border-2 border-border dark:border-slate-700/80 bg-card dark:bg-slate-900 text-foreground dark:text-white shadow-xs dark:shadow-2xl overflow-hidden">
            <div className="overflow-x-auto relative">
              <table className="w-full text-left text-xs min-w-[850px]">
                <thead className="bg-muted/70 text-muted-foreground border-b-2 border-border dark:bg-slate-950 dark:text-slate-300 dark:border-slate-700 font-bold">
                  <tr>
                    <th className="py-3 px-4">Product Name / SKU</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-right">Available in Stock (মজুত)</th>
                    <th className="py-3 px-4 text-right">With Customers (কাস্টমারের কাছে)</th>
                    <th className="py-3 px-4 text-right">Reorder Level</th>
                    <th className="py-3 px-4 text-right">Shortage</th>
                    <th className="py-3 px-4 text-right">Valuation</th>
                    <th className="py-3 px-4 text-right">Status</th>
                    <th className="py-3 px-4 text-right">Quick Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 dark:divide-slate-800">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-muted-foreground dark:text-slate-400">
                        {isLoading ? "Loading inventory stock levels..." : "No products found matching filters."}
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const isLowStock = item.available_stock <= item.reorder_level;
                      const theme = getProductTheme(item.category, isLowStock);
                      const isJarProduct = Boolean(
                        item.is_reusable_jar ||
                        item.category === "REFILLABLE_WATER" ||
                        item.name.toLowerCase().includes("20l") ||
                        item.name.toLowerCase().includes("jar")
                      );

                      return (
                        <tr
                          key={item.product_id}
                          className={`hover:bg-muted/40 dark:hover:bg-slate-800/80 transition-colors ${
                            isLowStock ? "bg-rose-500/10 dark:bg-rose-950/30 border-l-4 border-l-rose-500" : ""
                          }`}
                        >
                          <td className="py-3.5 px-4">
                            <div className="font-extrabold text-foreground dark:text-white text-xs">{item.name}</div>
                            <div className="font-mono text-[11px] text-muted-foreground dark:text-slate-400">{item.sku}</div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${theme.badgeBg}`}>
                              {theme.tag}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <span
                              className={`font-black text-sm px-2.5 py-1 rounded-lg ${
                                isLowStock
                                  ? "bg-rose-500 text-white font-black"
                                  : "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 font-black"
                              }`}
                            >
                              {item.available_stock} {item.unit_of_measure}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {isJarProduct ? (
                              <span className="font-black text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md inline-flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {item.customer_holding_jars ?? 0} {item.unit_of_measure}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40 text-xs">—</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right text-muted-foreground dark:text-slate-400 font-mono">
                            {item.reorder_level} {item.unit_of_measure}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {isLowStock ? (
                              <span className="font-black text-rose-600 dark:text-rose-400">
                                -{Math.max(0, item.reorder_level - item.available_stock)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right font-black text-emerald-700 dark:text-emerald-300">
                            {formatCurrency(item.valuation)}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {isLowStock ? (
                              <Badge className="text-[10px] py-0.5 font-black bg-rose-500 text-white border-0 shadow-xs">
                                Low Stock
                              </Badge>
                            ) : (
                              <Badge className="text-[10px] py-0.5 font-black bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40">
                                In Stock
                              </Badge>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                onClick={() => openAdjustStockModal(item, "add")}
                                className="h-8 px-2.5 text-xs font-black gap-1 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-lg shadow-xs"
                              >
                                <Plus className="h-3.5 w-3.5 stroke-[3]" /> + Add
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openAdjustStockModal(item, "remove")}
                                className="h-8 px-2 text-xs font-black text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/50 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/20 dark:hover:bg-rose-500/30 rounded-lg"
                                title="Deduct broken or damaged bottle"
                              >
                                <Minus className="h-3.5 w-3.5 stroke-[3]" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openProductHistory(item)}
                                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 rounded-lg"
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
        <div className="rounded-2xl border-2 border-border dark:border-slate-700/80 bg-card dark:bg-slate-900 text-foreground dark:text-white shadow-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-black text-foreground dark:text-white">
                Complete Stock Movement Audit Trail
              </h2>
              <p className="text-xs text-muted-foreground dark:text-slate-400 mt-0.5">
                Immutable record of receipts, dispatches, damages and adjustments.
              </p>
            </div>

            <div className="w-full sm:w-64">
              <Input
                placeholder="Filter by product, SKU, note..."
                value={movementSearch}
                onChange={(e) => setMovementSearch(e.target.value)}
                className="text-xs h-9 bg-card dark:bg-slate-950 border border-border dark:border-slate-700 text-foreground dark:text-white placeholder:text-muted-foreground dark:placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="overflow-x-auto relative rounded-xl border border-border dark:border-slate-800">
            <table className="w-full text-left text-xs min-w-[700px]">
              <thead className="bg-muted/70 text-muted-foreground dark:bg-slate-950 dark:text-slate-300 border-b border-border dark:border-slate-800 font-bold">
                <tr>
                  <th className="py-2.5 px-4">Date & Time</th>
                  <th className="py-2.5 px-4">Product</th>
                  <th className="py-2.5 px-4">Movement Type</th>
                  <th className="py-2.5 px-4 text-right">Quantity</th>
                  <th className="py-2.5 px-4">Reason / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-slate-800">
                {isMovementsLoading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground dark:text-slate-400">
                      Loading stock movements...
                    </td>
                  </tr>
                ) : filteredAllMovements.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground dark:text-slate-400">
                      No movement records found.
                    </td>
                  </tr>
                ) : (
                  filteredAllMovements.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/40 dark:hover:bg-slate-800/50">
                      <td className="py-3 px-4 text-muted-foreground dark:text-slate-400 font-mono text-[11px]">
                        {new Date(m.created_at).toLocaleString("en-IN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="py-3 px-4 font-bold text-foreground dark:text-white">
                        {m.product_name || "Unknown SKU"}
                      </td>
                      <td className="py-3 px-4">{renderMovementBadge(m.movement_type)}</td>
                      <td className="py-3 px-4 text-right font-black">
                        <span
                          className={
                            m.quantity > 0
                              ? "text-emerald-600 dark:text-emerald-400 font-black"
                              : "text-rose-600 dark:text-rose-400 font-black"
                          }
                        >
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground dark:text-slate-400 max-w-xs truncate">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 dark:bg-black/80 p-3 sm:p-4 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-2xl rounded-3xl bg-card dark:bg-slate-900 border-2 border-border dark:border-slate-700 p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto text-foreground dark:text-white">
            <div className="flex items-center justify-between border-b border-border dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-black text-base sm:text-lg text-foreground dark:text-white">
                  Movement History: {historyProduct.name}
                </h3>
                <p className="text-xs text-muted-foreground dark:text-slate-400 font-mono">SKU: {historyProduct.sku}</p>
              </div>
              <button
                onClick={() => setHistoryProduct(null)}
                className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 dark:bg-slate-950 p-3 rounded-2xl border border-border dark:border-slate-800">
                <div>
                  <span className="text-muted-foreground dark:text-slate-400 block text-[10px] uppercase font-bold">Physical Stock</span>
                  <strong className="text-lg text-foreground dark:text-white font-black">{historyProduct.current_stock} {historyProduct.unit_of_measure}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground dark:text-slate-400 block text-[10px] uppercase font-bold">Available Delivery</span>
                  <strong className="text-lg text-emerald-700 dark:text-emerald-300 font-black">{historyProduct.available_stock} {historyProduct.unit_of_measure}</strong>
                </div>
              </div>

              <div className="rounded-xl border border-border dark:border-slate-800 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/70 text-muted-foreground dark:bg-slate-950 dark:text-slate-300 font-bold border-b border-border dark:border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3 text-right">Quantity</th>
                      <th className="py-2 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 dark:divide-slate-800">
                    {isHistoryLoading ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-muted-foreground dark:text-slate-400">Loading history...</td>
                      </tr>
                    ) : productMovements.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-muted-foreground dark:text-slate-400">No recent movements recorded.</td>
                      </tr>
                    ) : (
                      productMovements.map((mov) => (
                        <tr key={mov.id} className="hover:bg-muted/30 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 text-muted-foreground dark:text-slate-400 font-mono text-[10px]">
                            {new Date(mov.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 px-3">{renderMovementBadge(mov.movement_type)}</td>
                          <td className="py-2.5 px-3 text-right font-black">
                            <span className={mov.quantity > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                              {mov.quantity > 0 ? `+${mov.quantity}` : mov.quantity}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-muted-foreground dark:text-slate-400 truncate max-w-xs">{mov.notes || "—"}</td>
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

      {/* DUAL-MODE ADD / ADJUST STOCK MODAL */}
      {isAdjustModalOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 dark:bg-black/85 p-3 sm:p-4 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-3xl bg-card dark:bg-slate-900 border-2 border-border dark:border-slate-700 p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto text-foreground dark:text-white">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border dark:border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-2xl shadow-md ${
                    stockMode === "add"
                      ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-500/25"
                      : "bg-gradient-to-br from-rose-500 to-amber-500 text-white shadow-rose-500/25"
                  }`}
                >
                  {stockMode === "add" ? (
                    <PackagePlus className="h-5 w-5 stroke-[2.5]" />
                  ) : (
                    <ArrowUpDown className="h-5 w-5 stroke-[2.5]" />
                  )}
                </div>
                <div>
                  <h3 className="font-black text-base sm:text-lg text-foreground dark:text-white leading-tight">
                    {stockMode === "add" ? "+ Add Stock / নতুন মাল যোগ" : "- Deduct / নষ্ট মাল বাদ"}
                  </h3>
                  <p className="text-xs text-muted-foreground dark:text-slate-400 font-medium">
                    Fast update for warehouse depot inventory
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-xl hover:bg-muted dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800 min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold transition-colors cursor-pointer"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1.5 bg-muted/60 dark:bg-slate-950 rounded-2xl border border-border dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setStockMode("add");
                  setAdjustType("PURCHASE_RECEIPT");
                }}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-black transition-all min-h-[44px] touch-manipulation cursor-pointer ${
                  stockMode === "add"
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md ring-2 ring-emerald-300"
                    : "text-muted-foreground hover:text-foreground dark:text-slate-400 dark:hover:text-white hover:bg-card/60 dark:hover:bg-slate-900"
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
                    ? "bg-gradient-to-r from-rose-500 to-amber-500 text-white shadow-md ring-2 ring-rose-300"
                    : "text-muted-foreground hover:text-foreground dark:text-slate-400 dark:hover:text-white hover:bg-card/60 dark:hover:bg-slate-900"
                }`}
              >
                <Minus className="h-4 w-4 stroke-[3]" />
                <span>- Remove (নষ্ট / ভাঙা)</span>
              </button>
            </div>

            {/* Product Summary Card */}
            <div className="p-3.5 rounded-2xl bg-muted/40 dark:bg-slate-950 border-2 border-border dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground dark:text-slate-400 uppercase tracking-wider block">Target Product</span>
                  <div className="font-black text-sm sm:text-base text-foreground dark:text-white">{selectedProduct.name}</div>
                  <div className="text-[11px] font-mono text-muted-foreground dark:text-slate-400">{selectedProduct.sku}</div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-muted-foreground dark:text-slate-400 uppercase tracking-wider block">Current Stock</span>
                  <div className="text-xl font-black text-primary dark:text-cyan-300">
                    {selectedProduct.available_stock} <span className="text-xs font-normal text-muted-foreground dark:text-slate-400">{selectedProduct.unit_of_measure}</span>
                  </div>
                </div>
              </div>

              {/* Product Picker Dropdown */}
              {items.length > 1 && (
                <div className="pt-2 border-t border-border dark:border-slate-800">
                  <label htmlFor="switch-sku-select" className="text-[11px] font-semibold text-muted-foreground dark:text-slate-400 block mb-1">
                    Or switch SKU / অন্য পণ্য নির্বাচন করুন:
                  </label>
                  <select
                    id="switch-sku-select"
                    value={selectedProduct.product_id}
                    onChange={(e) => {
                      const found = items.find((p) => p.product_id === e.target.value);
                      if (found) setSelectedProduct(found);
                    }}
                    className="w-full text-xs h-9 rounded-xl border border-input bg-background text-foreground px-2.5 focus:ring-1 focus:ring-primary outline-hidden"
                  >
                    {items.map((prod) => (
                      <option key={prod.product_id} value={prod.product_id} className="bg-card text-foreground">
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
                  <label htmlFor="quantity-input" className="text-xs font-bold text-foreground dark:text-white flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Quantity to {stockMode === "add" ? "Add (+)" : "Remove (-)"} / সংখ্যা:
                  </label>
                  <span className="text-[11px] text-muted-foreground font-mono">
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
                    className="text-base sm:text-lg font-black h-12 rounded-2xl bg-background border-2 border-input text-foreground px-4"
                    autoFocus
                    required
                  />
                </div>

                {/* Tactile Quick-Add Preset Pills */}
                <div className="flex items-center gap-1.5 pt-1 overflow-x-auto no-scrollbar">
                  {[10, 25, 50, 100, 200].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setQtyString(String(preset))}
                      className="px-3 py-1.5 rounded-xl text-xs font-black bg-card hover:bg-muted text-foreground border-2 border-border dark:border-slate-700 active:scale-95 transition-all shrink-0 cursor-pointer shadow-2xs"
                    >
                      +{preset}
                    </button>
                  ))}
                  {qtyString && (
                    <button
                      type="button"
                      onClick={() => setQtyString("")}
                      className="px-2 py-1.5 text-xs text-rose-500 hover:text-rose-600 underline cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Live Real-Time Projection Preview */}
                {parseInt(qtyString, 10) > 0 && (
                  <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-slate-950 border border-emerald-300 dark:border-emerald-500/40 text-xs flex items-center justify-between text-foreground dark:text-slate-300">
                    <span>Resulting Stock Balance:</span>
                    <strong className="text-emerald-700 dark:text-emerald-300 font-black text-sm">
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
                <label htmlFor="adjust-type-select" className="text-xs font-bold text-foreground dark:text-white block">
                  Movement Reason / শ্রেণীবিভাগ:
                </label>
                <select
                  id="adjust-type-select"
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as StockMovementType)}
                  className="w-full text-xs h-10 rounded-xl border border-input bg-background text-foreground px-3 focus:ring-1 focus:ring-primary outline-hidden"
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
                <label htmlFor="adjust-reason-input" className="text-xs font-bold text-foreground dark:text-white block">
                  Optional Note / রিসিট বা চালান নম্বর:
                </label>
                <Input
                  id="adjust-reason-input"
                  placeholder="e.g. Batch #401, supplier bill, or audit notes"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="text-xs h-10 rounded-xl"
                />
              </div>

              {/* Modal Action Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="flex-1 h-11 text-xs"
                >
                  Cancel / বাতিল
                </Button>

                <Button
                  type="submit"
                  disabled={isSubmitting || !qtyString}
                  className={`flex-2 h-11 font-black text-xs sm:text-sm rounded-xl shadow-md transition-all active:scale-95 cursor-pointer ${
                    stockMode === "add"
                      ? "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-emerald-500/25"
                      : "bg-gradient-to-r from-rose-500 to-amber-600 hover:from-rose-600 hover:to-amber-700 text-white shadow-rose-500/25"
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
