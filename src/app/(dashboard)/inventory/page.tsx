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

export default function SingleWarehouseInventoryPage() {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = React.useState<"stock" | "history">("stock");
  const [items, setItems] = React.useState<InventoryItemRecord[]>([]);
  const [summary, setSummary] = React.useState<InventoryValuationSummary | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
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

  // Adjustment Modal
  const [isAdjustModalOpen, setIsAdjustModalOpen] = React.useState(false);
  const [selectedProduct, setSelectedProduct] = React.useState<InventoryItemRecord | null>(null);
  const [adjustQty, setAdjustQty] = React.useState<number>(0);
  const [adjustReason, setAdjustReason] = React.useState("");
  const [adjustType, setAdjustType] = React.useState<StockMovementType>("PHYSICAL_AUDIT_ADJUSTMENT");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    const stockRes = await getInventoryStockLevels();
    if (stockRes.success && stockRes.data) {
      setItems(stockRes.data);
    }
    const valRes = await getInventoryValuationSummary();
    if (valRes.success && valRes.data) {
      setSummary(valRes.data);
    }
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
    if (!selectedProduct) return;

    setIsSubmitting(true);
    const res = await adjustStock({
      product_id: selectedProduct.product_id,
      quantity_delta: adjustQty,
      reason: adjustReason,
      movement_type: adjustType,
    });
    setIsSubmitting(false);

    if (res.success) {
      addToast({
        type: "success",
        title: "Stock Adjusted",
        message: `Adjusted ${selectedProduct.name} by ${adjustQty > 0 ? `+${adjustQty}` : adjustQty} units.`,
      });

      // Reload authoritative stock and summary from database
      await loadData();

      // If history modal is currently open for this product, refresh its movements
      if (historyProduct?.product_id === selectedProduct.product_id) {
        await openProductHistory(selectedProduct);
      }

      setIsAdjustModalOpen(false);
      setAdjustQty(0);
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
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Central Warehouse Inventory
            </h1>
            <Badge variant="primary" className="text-xs">
              Single Depot
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Real-time stock of reusable water jars and packaged beverages with dual-entry valuation and audit history.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={loadData}
            disabled={isLoading}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => {
              if (items.length > 0) {
                setSelectedProduct(items[0]);
                setIsAdjustModalOpen(true);
              }
            }}
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs text-xs"
          >
            <ArrowUpDown className="h-4 w-4" />
            Audit Stock Adjustment
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
                            onClick={() => {
                              setSelectedProduct(item);
                              setIsAdjustModalOpen(true);
                            }}
                            className="h-7 text-[11px] gap-1 text-primary border-primary/30 hover:bg-primary/10"
                          >
                            <ArrowUpDown className="h-3 w-3" />
                            Adjust
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

          {/* Products Stock Table */}
          <Card className="border-border shadow-xs">
            <CardContent className="p-0">
              <div className="overflow-x-auto relative">
                <div className="sm:hidden text-[10px] text-muted-foreground px-4 py-1.5 bg-muted/40 border-b border-border flex items-center justify-between">
                  <span>Swipe horizontally to view full stock data</span>
                  <span>&rarr;</span>
                </div>
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
                              <div className="flex items-center justify-end gap-1">
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
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedProduct(item);
                                    setIsAdjustModalOpen(true);
                                  }}
                                  className="h-7 px-2 text-xs text-primary gap-1"
                                  title="Audit Stock Adjustment"
                                >
                                  <ArrowUpDown className="h-3.5 w-3.5" />
                                  <span>Adjust</span>
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
              <div className="overflow-x-auto relative">
                <div className="sm:hidden text-[10px] text-muted-foreground px-4 py-1.5 bg-muted/40 border-b border-border flex items-center justify-between">
                  <span>Swipe horizontally to view audit trail details</span>
                  <span>&rarr;</span>
                </div>
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
                  variant="outline"
                  onClick={() => {
                    setSelectedProduct(historyProduct);
                    setIsAdjustModalOpen(true);
                  }}
                  className="gap-1.5 text-xs text-primary"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  Adjust Stock
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

      {/* ADJUST STOCK MODAL (Requirement 3 — Preserved & Enhanced) */}
      {isAdjustModalOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-4 sm:p-6 shadow-2xl space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <ArrowUpDown className="h-5 w-5 text-primary" />
                Adjust Stock — {selectedProduct.name}
              </h3>
              <button
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="rounded-lg bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">SKU:</span>
                <span className="font-mono font-semibold">{selectedProduct.sku}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Warehouse Stock:</span>
                <strong>
                  {selectedProduct.current_stock} {selectedProduct.unit_of_measure}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Safety Reorder Level:</span>
                <span>{selectedProduct.reorder_level} {selectedProduct.unit_of_measure}</span>
              </div>
              {selectedProduct.available_stock <= selectedProduct.reorder_level && (
                <div className="flex justify-between text-amber-600 dark:text-amber-400 font-semibold pt-1 border-t border-border/40">
                  <span>Current Shortage:</span>
                  <span>
                    {Math.max(0, selectedProduct.reorder_level - selectedProduct.available_stock)} {selectedProduct.unit_of_measure}
                  </span>
                </div>
              )}
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Movement Reason / Type
                </label>
                <select
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as StockMovementType)}
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground"
                >
                  <option value="PHYSICAL_AUDIT_ADJUSTMENT">Physical Count Audit Adjustment</option>
                  <option value="DAMAGE_WRITEOFF">Damaged / Leakage Write-off</option>
                  <option value="OPENING_BALANCE">Opening Stock Adjustment</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Quantity Delta (+ to add, - to deduct) *
                </label>
                <Input
                  type="number"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(Number(e.target.value))}
                  placeholder="e.g. -5 or +10"
                  className="text-xs font-mono"
                  required
                />
                {adjustQty !== 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Projected stock:{" "}
                    <strong>
                      {Math.max(0, selectedProduct.current_stock + adjustQty)} {selectedProduct.unit_of_measure}
                    </strong>{" "}
                    ({adjustQty > 0 ? `+${adjustQty}` : adjustQty})
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Audit Notes / Justification *
                </label>
                <Input
                  placeholder="e.g. Broken during unloading or recount variance"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="text-xs"
                  required
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
                  disabled={isSubmitting || adjustQty === 0 || !adjustReason.trim()}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                >
                  {isSubmitting ? "Posting..." : "Confirm Adjustment"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
