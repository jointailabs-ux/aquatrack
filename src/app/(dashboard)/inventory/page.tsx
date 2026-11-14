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
  Filter,
  RotateCcw,
  X,
  Plus,
  Minus,
  PackagePlus,
  Check,
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
    const res = await adjustStock({
      product_id: selectedProduct.product_id,
      quantity_delta: signedQty,
      reason: finalReason,
      movement_type: adjustType,
    });
    setIsSubmitting(false);

    if (res.success) {
      addToast({
        type: "success",
        title: stockMode === "add" ? "🎉 Stock Added Successfully" : "Stock Updated",
        message: `${stockMode === "add" ? "Added" : "Deducted"} ${numericQty} ${selectedProduct.unit_of_measure} for ${selectedProduct.name}.`,
      });

      // Reload authoritative stock and summary from database
      await loadData();

      // If history modal is currently open for this product, refresh its movements
      if (historyProduct?.product_id === selectedProduct.product_id) {
        await openProductHistory(selectedProduct);
      }

      setIsAdjustModalOpen(false);
      setQtyString("");
      setAdjustReason("");
    } else {
      addToast({
        type: "error",
        title: "Adjustment Failed",
        message: res.error || "Failed to adjust stock balance.",
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
        return <Badge variant="success" className="text-[10px]">Purchase Receipt (+)</Badge>;
      case "POS_SALE":
        return <Badge variant="secondary" className="text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">POS Sale (-)</Badge>;
      case "DELIVERY_DISPATCH":
        return <Badge variant="primary" className="text-[10px]">Delivery Dispatch (-)</Badge>;
      case "DELIVERY_RETURN":
      case "ROUTE_RETURN":
        return <Badge variant="outline" className="text-[10px] border-blue-500 text-blue-600">Route Return (+)</Badge>;
      case "ADJUSTMENT_IN":
      case "PHYSICAL_AUDIT_ADJUSTMENT":
        return <Badge variant="success" className="text-[10px]">Audit Surplus (+)</Badge>;
      case "ADJUSTMENT_OUT":
        return <Badge variant="warning" className="text-[10px]">Audit Deduction (-)</Badge>;
      case "SCRAP_WRITEOFF":
      case "DAMAGE_WRITEOFF":
        return <Badge variant="destructive" className="text-[10px]">Scrap / Damage (-)</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">{type.replace(/_/g, " ")}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
              <Warehouse className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              Warehouse & Stock Manager
            </h1>
            <Badge variant="success" className="text-[10px] sm:text-xs font-bold py-0.5 px-2 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
              স্টক ও গুদাম
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Real-time stock of water jars, bottles & beverages. Easily add incoming plant stock or report damaged items.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={loadData}
            disabled={isLoading}
            className="gap-1.5 text-xs h-10 px-3 rounded-xl border-border"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => openAddStockModal()}
            className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold shadow-md shadow-emerald-600/25 text-xs sm:text-sm h-10 px-4 rounded-xl active:scale-95 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>+ Add Stock / স্টক যোগ করুন</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Distinct SKUs</span>
              <Boxes className="h-4 w-4 text-primary shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-foreground">
              {summary ? summary.total_distinct_products : items.length}
            </div>
            <p className="text-[11px] text-muted-foreground">Active products cataloged</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Total Physical Units</span>
              <Warehouse className="h-4 w-4 text-blue-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-blue-600 dark:text-blue-400">
              {summary ? summary.total_units_in_warehouse.toLocaleString() : "0"}
            </div>
            <p className="text-[11px] text-muted-foreground">In central warehouse depot</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Inventory Asset Value</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {summary ? formatCurrency(summary.total_inventory_valuation) : "₹0"}
            </div>
            <p className="text-[11px] text-muted-foreground">Cost valuation (Asset)</p>
          </CardContent>
        </Card>

        <Card
          onClick={() => {
            setShowLowStockOnly((prev) => !prev);
            setActiveTab("stock");
          }}
          className={`border-border shadow-xs bg-card cursor-pointer transition-all hover:border-amber-400 ${
            showLowStockOnly ? "ring-2 ring-amber-500 bg-amber-500/5" : ""
          }`}
        >
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium flex items-center gap-1.5">
                Reorder Alerts
                {showLowStockOnly && (
                  <Badge variant="warning" className="text-[9px] py-0 px-1">Filtered</Badge>
                )}
              </span>
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-amber-600 dark:text-amber-400">
              {summary ? summary.low_stock_items_count : lowStockItems.length}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Click to {showLowStockOnly ? "view all products" : "filter low stock"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-border pb-2 overflow-x-auto scrollbar-none flex-nowrap">
        <button
          onClick={() => setActiveTab("stock")}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold transition-all shrink-0 touch-manipulation min-h-[38px] ${
            activeTab === "stock"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <Warehouse className="h-4 w-4" />
          Warehouse Stock & Reorder Alerts
          {lowStockItems.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500 text-white font-black">
              {lowStockItems.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold transition-all shrink-0 touch-manipulation min-h-[38px] ${
            activeTab === "history"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          <History className="h-4 w-4" />
          Stock Movement Audit Trail
        </button>
      </div>

      {/* TAB 1: STOCK LEVELS & LOW STOCK ALERTS */}
      {activeTab === "stock" && (
        <div className="space-y-6">
          {/* Low Stock Alert Banner (Requirement 1) */}
          {lowStockItems.length > 0 && (
            <Card className="border-amber-300 dark:border-amber-800 bg-amber-500/10 shadow-xs">
              <CardHeader className="p-4 pb-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold text-foreground">
                        Low Stock Reorder Alert ({lowStockItems.length} Product{lowStockItems.length > 1 ? "s" : ""} Below Safety Threshold)
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        The following items are at or below their configured safety reorder level. Procure stock promptly to avoid route or counter shortages.
                      </p>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant={showLowStockOnly ? "primary" : "outline"}
                    onClick={() => setShowLowStockOnly((prev) => !prev)}
                    className="text-xs font-semibold self-start sm:self-auto gap-1.5"
                  >
                    <Filter className="h-3.5 w-3.5" />
                    {showLowStockOnly ? "Show All Products" : "Filter Table Below"}
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-4 pt-2">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {lowStockItems.map((item) => {
                    const shortage = item.shortage ?? Math.max(0, item.reorder_level - item.available_stock);

                    return (
                      <div
                        key={item.product_id}
                        className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-card p-3 shadow-2xs space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="font-bold text-xs text-foreground block line-clamp-1">
                              {item.name}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              SKU: {item.sku}
                            </span>
                          </div>
                          <Badge variant="destructive" className="text-[10px] py-0 px-1.5 shrink-0">
                            Short by {shortage} {item.unit_of_measure}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px] bg-muted/30 p-2 rounded-lg">
                          <div>
                            <span className="text-muted-foreground block text-[10px]">Available</span>
                            <span className="font-bold text-amber-600 dark:text-amber-400">
                              {item.available_stock} {item.unit_of_measure}
                            </span>
                            {item.overcommitted_stock && item.overcommitted_stock > 0 ? (
                              <span className="text-[10px] text-rose-600 dark:text-rose-400 block font-semibold">
                                Short by {item.overcommitted_stock} (Committed)
                              </span>
                            ) : null}
                          </div>
                          <div>
                            <span className="text-muted-foreground block text-[10px]">Standard Reorder Threshold</span>
                            <span className="font-bold text-foreground">
                              {item.reorder_level} {item.unit_of_measure}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-1.5 pt-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openProductHistory(item)}
                            className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                          >
                            <History className="h-3 w-3" />
                            History
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openAdjustStockModal(item, "add")}
                            className="h-7 text-[11px] gap-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 font-bold"
                          >
                            <Plus className="h-3 w-3" />
                            + Add Stock
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Filters & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-nowrap pb-1 w-full sm:w-auto">
              {["ALL", "REFILLABLE_WATER", "PACKAGED_WATER", "BEVERAGE", "DISPENSER_EQUIPMENT"].map(
                (cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 touch-manipulation min-h-[34px] ${
                      categoryFilter === cat
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {cat.replace(/_/g, " ")}
                  </button>
                )
              )}

              {/* Quick toggle for Low Stock Filter (Requirement 1) */}
              <button
                onClick={() => setShowLowStockOnly((prev) => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border shrink-0 touch-manipulation min-h-[34px] ${
                  showLowStockOnly
                    ? "bg-amber-500 text-white border-amber-600 shadow-xs"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                Low Stock Only ({lowStockItems.length})
              </button>
            </div>

            <div className="w-full sm:w-64">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search product or SKU..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 text-xs h-9"
                />
              </div>
            </div>
          </div>

          {/* Active Filter Notice */}
          {showLowStockOnly && (
            <div className="flex items-center justify-between rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Showing only <strong>{filteredItems.length}</strong> product(s) at or below reorder threshold.
              </span>
              <button
                onClick={() => setShowLowStockOnly(false)}
                className="font-bold underline hover:opacity-80"
              >
                Clear Filter
              </button>
            </div>
          )}

          {/* Products Stock Cards (Mobile) & Table (Desktop) */}
          <Card className="border-border shadow-xs">
            <CardContent className="p-0">
              {/* Mobile View: High-density Product Cards */}
              <div className="md:hidden divide-y divide-border/60">
                {filteredItems.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    {isLoading ? "Loading inventory stock balances..." : "No products matching current filters."}
                  </div>
                ) : (
                  filteredItems.map((item) => {
                    const isLowStock = item.available_stock <= item.reorder_level;
                    return (
                      <div key={item.product_id} className="p-3.5 space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h3 className="text-xs font-bold text-foreground">{item.name}</h3>
                              <Badge variant="outline" className="text-[9px] font-mono py-0">{item.sku}</Badge>
                            </div>
                            <span className="text-[10px] text-muted-foreground">{item.category.replace(/_/g, " ")}</span>
                          </div>
                          {isLowStock ? (
                            <Badge variant="warning" className="text-[9px] py-0 font-bold shrink-0">Low Stock</Badge>
                          ) : (
                            <Badge variant="success" className="text-[9px] py-0 shrink-0">In Stock</Badge>
                          )}
                        </div>

                        {/* Metric Grid */}
                        <div className="grid grid-cols-3 gap-2 bg-muted/30 p-2 rounded-lg border border-border/40 text-center">
                          <div>
                            <span className="text-[9px] text-muted-foreground block">Physical</span>
                            <span className="text-xs font-bold text-foreground">{item.current_stock}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-muted-foreground block">Reserved</span>
                            <span className="text-xs font-bold text-amber-600 dark:text-amber-400">{item.reserved_stock}</span>
                          </div>
                          <div>
                            <span className="text-[9px] text-muted-foreground block">Available</span>
                            <span className={`text-xs font-extrabold ${isLowStock ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                              {item.available_stock}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[11px] pt-1">
                          <span className="text-muted-foreground text-[10px]">
                            Val: <strong className="text-foreground">{formatCurrency(item.valuation)}</strong>
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openProductHistory(item)}
                              className="h-8 px-2 text-[11px] text-muted-foreground"
                            >
                              <History className="h-3.5 w-3.5 mr-1" /> History
                            </Button>
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
                              className="h-8 px-2 text-xs text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-950/30"
                              title="Deduct damaged or lost"
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Desktop View: Full Data Table */}
              <div className="hidden md:block overflow-x-auto relative">
                <table className="w-full text-left text-xs min-w-[850px]">
                  <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Product Name / SKU</th>
                      <th className="py-3 px-4 font-semibold">Category</th>
                      <th className="py-3 px-4 font-semibold text-right">Physical Stock</th>
                      <th className="py-3 px-4 font-semibold text-right">Committed</th>
                      <th className="py-3 px-4 font-semibold text-right">Available</th>
                      <th className="py-3 px-4 font-semibold text-right">Reorder Level</th>
                      <th className="py-3 px-4 font-semibold text-right">Shortage</th>
                      <th className="py-3 px-4 font-semibold text-right">Unit Cost</th>
                      <th className="py-3 px-4 font-semibold text-right">Valuation</th>
                      <th className="py-3 px-4 font-semibold text-right">Status</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredItems.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-8 text-center text-muted-foreground">
                          {isLoading ? "Loading inventory stock balances..." : "No products matching current filters."}
                        </td>
                      </tr>
                    ) : (
                      filteredItems.map((item) => {
                        const isLowStock = item.available_stock <= item.reorder_level;
                        const shortage = item.shortage ?? Math.max(0, item.reorder_level - item.available_stock);

                        return (
                          <tr key={item.product_id} className="hover:bg-muted/20 transition-colors">
                            <td className="py-3 px-4">
                              <span className="font-bold text-foreground block">{item.name}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {item.sku}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant="outline" className="text-[10px] py-0">
                                {item.category.replace(/_/g, " ")}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-right font-extrabold text-foreground">
                              {item.current_stock} {item.unit_of_measure}
                            </td>
                            <td className="py-3 px-4 text-right text-muted-foreground">
                              {item.reserved_stock}
                            </td>
                            <td className="py-3 px-4 text-right font-bold">
                              {item.overcommitted_stock && item.overcommitted_stock > 0 ? (
                                <div className="flex flex-col items-end">
                                  <span className="text-rose-600 dark:text-rose-400 font-extrabold">
                                    0 {item.unit_of_measure}
                                  </span>
                                  <span className="text-[9px] font-mono text-rose-500 font-semibold">
                                    Deficit: -{item.overcommitted_stock}
                                  </span>
                                </div>
                              ) : (
                                <span className={isLowStock ? "text-amber-600 dark:text-amber-400" : "text-blue-600 dark:text-blue-400"}>
                                  {item.available_stock}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-medium text-muted-foreground">
                              {item.reorder_level} {item.unit_of_measure}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {item.overcommitted_stock && item.overcommitted_stock > 0 ? (
                                <Badge variant="destructive" className="text-[10px] py-0 px-1.5 font-mono">
                                  Over-committed
                                </Badge>
                              ) : isLowStock && shortage > 0 ? (
                                <Badge variant="destructive" className="text-[10px] py-0 px-1.5 font-mono">
                                  -{shortage}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right text-muted-foreground">
                              {formatCurrency(item.cost_price)}
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(item.valuation)}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {item.overcommitted_stock && item.overcommitted_stock > 0 ? (
                                <Badge variant="destructive" className="text-[10px] py-0">
                                  Deficit
                                </Badge>
                              ) : isLowStock ? (
                                <Badge variant="warning" className="text-[10px] py-0">
                                  Low Stock
                                </Badge>
                              ) : (
                                <Badge variant="success" className="text-[10px] py-0">
                                  Optimal
                                </Badge>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openProductHistory(item)}
                                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                                  title="View Stock Movement History"
                                >
                                  <History className="h-3.5 w-3.5" />
                                  <span className="hidden md:inline">History</span>
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => openAdjustStockModal(item, "add")}
                                  className="h-7 px-2.5 text-xs font-bold gap-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md shadow-2xs"
                                  title="Add incoming stock"
                                >
                                  <Plus className="h-3 w-3" />
                                  <span>+ Add</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openAdjustStockModal(item, "remove")}
                                  className="h-7 px-2 text-xs text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/30 gap-1 rounded-md"
                                  title="Deduct damaged or lost stock"
                                >
                                  <Minus className="h-3 w-3" />
                                  <span>Deduct</span>
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

      {/* TAB 2: GLOBAL STOCK MOVEMENT AUDIT TRAIL */}
      {activeTab === "history" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">
                Stock Movement Audit Trail
              </h2>
              <p className="text-xs text-muted-foreground">
                Permanent dual-entry ledger of all stock changes across purchases, POS counter sales, delivery dispatches and audit adjustments.
              </p>
            </div>

            <div className="w-full sm:w-72">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by product, note, or reference..."
                  value={movementSearch}
                  onChange={(e) => setMovementSearch(e.target.value)}
                  className="pl-9 text-xs h-9"
                />
              </div>
            </div>
          </div>

          <Card className="border-border shadow-xs">
            <CardContent className="p-0">
              {/* Mobile View: High-density Audit Cards */}
              <div className="md:hidden divide-y divide-border/60">
                {filteredAllMovements.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    {isMovementsLoading ? "Loading stock movement audit records..." : "No stock movement records found."}
                  </div>
                ) : (
                  filteredAllMovements.map((m) => (
                    <div key={m.id} className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h4 className="text-xs font-bold text-foreground">{m.product_name}</h4>
                            <Badge variant="outline" className="text-[9px] font-mono py-0">{m.product_sku}</Badge>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {new Date(m.created_at).toLocaleString("en-IN", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <span className={`text-xs font-black font-mono shrink-0 ${
                          m.quantity > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                        }`}>
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity} {m.unit_of_measure}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {renderMovementBadge(m.movement_type)}
                          {m.reference_type && (
                            <Badge variant="outline" className="text-[9px] py-0 font-mono">
                              {m.reference_type}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {m.creator_name || "System"}
                        </span>
                      </div>

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
                <table className="w-full text-left text-xs min-w-[700px]">
                  <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Date & Time</th>
                      <th className="py-3 px-4 font-semibold">Product</th>
                      <th className="py-3 px-4 font-semibold">Movement Type</th>
                      <th className="py-3 px-4 font-semibold text-right">Quantity Delta</th>
                      <th className="py-3 px-4 font-semibold">Reference Type</th>
                      <th className="py-3 px-4 font-semibold">Reason / Audit Justification</th>
                      <th className="py-3 px-4 font-semibold">Logged By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredAllMovements.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-muted-foreground">
                          {isMovementsLoading ? "Loading stock movement audit records..." : "No stock movement records found."}
                        </td>
                      </tr>
                    ) : (
                      filteredAllMovements.map((m) => (
                        <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                          <td className="py-3 px-4 text-muted-foreground whitespace-nowrap font-mono text-[11px]">
                            {new Date(m.created_at).toLocaleString("en-IN", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-foreground block">{m.product_name}</span>
                            <span className="text-[10px] text-muted-foreground font-mono">{m.product_sku}</span>
                          </td>
                          <td className="py-3 px-4">
                            {renderMovementBadge(m.movement_type)}
                          </td>
                          <td className={`py-3 px-4 text-right font-extrabold font-mono ${
                            m.quantity > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                          }`}>
                            {m.quantity > 0 ? `+${m.quantity}` : m.quantity} {m.unit_of_measure}
                          </td>
                          <td className="py-3 px-4">
                            {m.reference_type ? (
                              <Badge variant="outline" className="text-[10px] py-0 font-mono">
                                {m.reference_type}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-foreground max-w-xs truncate" title={m.notes || ""}>
                            {m.notes || <span className="text-muted-foreground italic">Standard movement</span>}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground text-[11px]">
                            {m.creator_name || "System"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* PRODUCT-SPECIFIC STOCK MOVEMENT HISTORY MODAL (Requirement 2) */}
      {historyProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-3xl rounded-2xl bg-card border border-border p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] flex flex-col">
            <div className="flex items-start justify-between border-b border-border pb-3 shrink-0">
              <div>
                <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" />
                  Stock Movement History — {historyProduct.name}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  SKU: <span className="font-mono font-semibold">{historyProduct.sku}</span> | Physical Stock:{" "}
                  <strong>{historyProduct.current_stock} {historyProduct.unit_of_measure}</strong> | Committed:{" "}
                  <strong>{historyProduct.reserved_stock} {historyProduct.unit_of_measure}</strong> | Available:{" "}
                  <strong>{historyProduct.available_stock} {historyProduct.unit_of_measure}</strong>
                  {historyProduct.overcommitted_stock && historyProduct.overcommitted_stock > 0 ? (
                    <span className="text-rose-600 dark:text-rose-400 font-bold ml-1.5">
                      (⚠️ Over-committed by {historyProduct.overcommitted_stock} {historyProduct.unit_of_measure})
                    </span>
                  ) : null}
                </p>
              </div>
              <button
                onClick={() => setHistoryProduct(null)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content Table */}
            <div className="overflow-y-auto overflow-x-auto flex-1 -mx-2 px-2 relative">
              <table className="w-full text-left text-xs min-w-[600px]">
                <thead className="bg-muted/40 text-muted-foreground sticky top-0 border-b border-border">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">Date & Time</th>
                    <th className="py-2.5 px-3 font-semibold">Movement Type</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Movement Quantity</th>
                    <th className="py-2.5 px-3 font-semibold">Reference</th>
                    <th className="py-2.5 px-3 font-semibold">Why Stock Changed</th>
                    <th className="py-2.5 px-3 font-semibold">Logged By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {isHistoryLoading ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        Loading product movement history...
                      </td>
                    </tr>
                  ) : productMovements.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        No movement records found for this product.
                      </td>
                    </tr>
                  ) : (
                    productMovements.map((m) => (
                      <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap font-mono text-[11px]">
                          {new Date(m.created_at).toLocaleString("en-IN", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-2.5 px-3">
                          {renderMovementBadge(m.movement_type)}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-extrabold font-mono ${
                          m.quantity > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                        }`}>
                          {m.quantity > 0 ? `+${m.quantity}` : m.quantity} {m.unit_of_measure}
                        </td>
                        <td className="py-2.5 px-3">
                          {m.reference_type ? (
                            <Badge variant="outline" className="text-[10px] py-0 font-mono">
                              {m.reference_type}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-foreground max-w-xs truncate" title={m.notes || ""}>
                          {m.notes || <span className="text-muted-foreground italic">Standard movement</span>}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground text-[11px]">
                          {m.creator_name || "System"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-border shrink-0">
              <span className="text-[11px] text-muted-foreground">
                Showing last {productMovements.length} movements
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    if (historyProduct) {
                      openAdjustStockModal(historyProduct, "add");
                    }
                  }}
                  className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  <Plus className="h-3.5 w-3.5" />
                  + Add Stock
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
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

      {/* ADD / ADJUST STOCK MODAL */}
      {isAdjustModalOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`p-2 rounded-xl text-white ${
                    stockMode === "add"
                      ? "bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm shadow-emerald-500/30"
                      : "bg-gradient-to-br from-rose-500 to-amber-600 shadow-sm shadow-rose-500/30"
                  }`}
                >
                  {stockMode === "add" ? (
                    <PackagePlus className="h-5 w-5" />
                  ) : (
                    <ArrowUpDown className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-foreground leading-tight">
                    {stockMode === "add" ? "Add Stock / নতুন মাল যোগ করুন" : "Deduct / নষ্ট বা ভাঙা মাল বাদ দিন"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Fast update for bottles and jars in warehouse
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-xl hover:bg-muted min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold transition-colors"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-muted/60 rounded-xl border border-border/50">
              <button
                type="button"
                onClick={() => {
                  setStockMode("add");
                  setAdjustType("PURCHASE_RECEIPT");
                }}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all min-h-[42px] touch-manipulation ${
                  stockMode === "add"
                    ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/25"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/60"
                }`}
              >
                <Plus className="h-4 w-4" />
                <span>+ Add Stock (নতুন মাল এলো)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStockMode("remove");
                  setAdjustType("DAMAGE_WRITEOFF");
                }}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold transition-all min-h-[42px] touch-manipulation ${
                  stockMode === "remove"
                    ? "bg-gradient-to-r from-rose-600 to-amber-600 text-white shadow-md shadow-rose-600/25"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/60"
                }`}
              >
                <Minus className="h-4 w-4" />
                <span>- Remove (নষ্ট / ভাঙা)</span>
              </button>
            </div>

            {/* Product Selector Dropdown */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-foreground flex items-center justify-between">
                <span>Select Item / মাল বা পণ্য বাছুন *</span>
                <span className="text-[11px] text-muted-foreground font-normal">
                  {items.length} products available
                </span>
              </label>
              <select
                value={selectedProduct.product_id}
                onChange={(e) => {
                  const prod = items.find((p) => p.product_id === e.target.value);
                  if (prod) setSelectedProduct(prod);
                }}
                className="w-full h-11 px-3 text-xs sm:text-sm font-semibold rounded-xl border border-border bg-card text-foreground shadow-xs focus:ring-2 focus:ring-primary focus:outline-hidden"
              >
                {items.map((prod) => (
                  <option key={prod.product_id} value={prod.product_id}>
                    {prod.name} ({prod.sku}) — {prod.current_stock} {prod.unit_of_measure} in stock
                  </option>
                ))}
              </select>
            </div>

            {/* Current Stock Snapshot Card */}
            <div className="rounded-xl bg-muted/40 border border-border/60 p-3 space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Current Warehouse Stock:</span>
                <strong className="text-sm font-bold text-foreground">
                  {selectedProduct.current_stock} {selectedProduct.unit_of_measure}
                </strong>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Available for Orders:</span>
                <span className="font-semibold text-foreground">
                  {selectedProduct.available_stock} {selectedProduct.unit_of_measure}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Minimum Safety Alert Level:</span>
                <span className="font-mono text-muted-foreground">
                  {selectedProduct.reorder_level} {selectedProduct.unit_of_measure}
                </span>
              </div>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-4">
              {/* Quantity Input with Quick Tap Buttons */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-foreground flex items-center justify-between">
                  <span>Quantity / কয়টি সংখ্যা? *</span>
                  {selectedProduct && (
                    <span className="text-[11px] text-muted-foreground font-normal">
                      Unit: {selectedProduct.unit_of_measure}
                    </span>
                  )}
                </label>

                <div className="relative">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={qtyString}
                    onChange={(e) => setQtyString(e.target.value)}
                    placeholder="Enter number (e.g. 50)"
                    className="h-12 text-lg sm:text-xl font-bold font-mono tracking-wide px-3 rounded-xl border-2 focus:border-primary"
                    required
                    autoFocus
                  />
                  {qtyString && (
                    <button
                      type="button"
                      onClick={() => setQtyString("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground bg-muted px-2 py-1 rounded-md"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Quick Add Tap Buttons */}
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  <span className="text-[11px] font-semibold text-muted-foreground mr-1">Quick tap:</span>
                  {[10, 25, 50, 100, 200].map((inc) => (
                    <button
                      key={inc}
                      type="button"
                      onClick={() => {
                        const current = parseInt(qtyString, 10) || 0;
                        setQtyString(String(current + inc));
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-muted hover:bg-muted/80 text-foreground border border-border shadow-2xs touch-manipulation active:scale-95 transition-all"
                    >
                      +{inc}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setQtyString("")}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted touch-manipulation"
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
                      <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200 text-xs flex items-center justify-between">
                        <span>New Projected Stock:</span>
                        <strong className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                          {projected} {selectedProduct.unit_of_measure} (+{num})
                        </strong>
                      </div>
                    );
                  } else {
                    const projected = selectedProduct.current_stock - num;
                    const isOver = projected < 0;
                    return (
                      <div
                        className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${
                          isOver
                            ? "bg-rose-500/10 border-rose-500/40 text-rose-800 dark:text-rose-200"
                            : "bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-200"
                        }`}
                      >
                        <span>{isOver ? "⚠️ Cannot deduct more than available!" : "New Projected Stock:"}</span>
                        <strong
                          className={`text-sm font-extrabold ${
                            isOver
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-amber-600 dark:text-amber-400"
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
                        { label: "🏭 Factory Delivery (ফ্যাক্টরি থেকে এলো)", val: "Factory Plant Arrival" },
                        { label: "🔄 Refilled (রিফিল বোতল)", val: "Refilled Bottles" },
                        { label: "🚛 Route Return (গাড়ি থেকে ফেরত)", val: "Returned from Delivery Route" },
                        { label: "🔍 Recount Surplus (গণনা সংশোধন)", val: "Physical Stock Count Adjustment" },
                      ]
                    : [
                        { label: "💥 Damaged / Broken (ভাঙা বা নষ্ট)", val: "Broken or Damaged Bottle" },
                        { label: "💧 Leaking Bottle (লিক হওয়া বোতল)", val: "Water Leakage Write-off" },
                        { label: "🏭 Sent to Factory (ফ্যাক্টরিতে পাঠানো)", val: "Returned to Factory for Recycling" },
                        { label: "🔍 Recount Shortage (গণনায় কম)", val: "Physical Audit Variance" },
                      ]
                  ).map((chip) => (
                    <button
                      key={chip.val}
                      type="button"
                      onClick={() => setAdjustReason(chip.val)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors touch-manipulation border ${
                        adjustReason === chip.val
                          ? "bg-primary text-primary-foreground border-primary font-bold shadow-2xs"
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
                      ? "Optional notes (e.g. Truck #12 or Plant Invoice)..."
                      : "Optional notes (e.g. Cracked during transit)..."
                  }
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="text-xs h-9 mt-1"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="h-11 px-4 text-xs font-semibold rounded-xl"
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
                      className={`h-11 flex-1 font-bold text-xs sm:text-sm rounded-xl transition-all shadow-md ${
                        stockMode === "add"
                          ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-500/25"
                          : "bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white shadow-rose-500/25"
                      } ${!canSubmit ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      {isSubmitting ? (
                        <span className="flex items-center gap-2">
                          <RotateCcw className="h-4 w-4 animate-spin" />
                          Saving to Warehouse...
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-1.5">
                          <Check className="h-4 w-4" />
                          {stockMode === "add"
                            ? `Confirm Add ${isValidQty ? `+${num}` : ""} ${selectedProduct.unit_of_measure} (স্টকে যোগ করুন)`
                            : `Confirm Deduct ${isValidQty ? `-${num}` : ""} ${selectedProduct.unit_of_measure} (স্টক থেকে কমান)`}
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
