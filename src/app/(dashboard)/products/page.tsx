"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Package,
  Plus,
  Search,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Power,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency } from "@/lib/utils";
import {
  getProducts,
  createProduct,
  updateProduct,
  deactivateProduct,
  activateProduct,
} from "@/modules/products/product.service";
import {
  ProductRecord,
  ProductInput,
  ProductInputSchema,
} from "@/modules/products/product.schema";
import { getInventoryStockLevels } from "@/modules/inventory/inventory.service";
import { InventoryItemRecord } from "@/modules/inventory/inventory.schema";

const CATEGORY_OPTIONS = [
  { value: "ALL", label: "All Categories" },
  { value: "REFILLABLE_WATER", label: "Refillable Water (20L / 10L)" },
  { value: "EMPTY_JAR_ASSET", label: "Empty Jar Asset (Polycarbonate/PET)" },
  { value: "PACKAGED_WATER", label: "Packaged Bottled Water (500ml / 1L / 2L)" },
  { value: "BEVERAGE", label: "Beverages & Soft Drinks" },
  { value: "DISPENSER_EQUIPMENT", label: "Dispenser & Equipment" },
  { value: "CONSUMABLE", label: "Consumables (Caps, Seals, Taps)" },
  { value: "SERVICE", label: "Service & Delivery Charges" },
];

const CATEGORY_FORM_OPTIONS = CATEGORY_OPTIONS.filter((o) => o.value !== "ALL");

const GST_PRESETS = [
  { label: "0% GST (Exempt)", rate: 0 },
  { label: "5% GST (Packaged/Refill 20L Water)", rate: 5 },
  { label: "12% GST (Water Dispensers & Accessories)", rate: 12 },
  { label: "18% GST (Commercial Services / Containers)", rate: 18 },
  { label: "28% GST (Aerated Beverages / Luxury)", rate: 28 },
];

const UNIT_OPTIONS = [
  { value: "UNIT", label: "Unit (Standard)" },
  { value: "JAR", label: "20L Polycarbonate Jar" },
  { value: "BOTTLE", label: "Single Bottle" },
  { value: "CASE", label: "Case / Pack" },
  { value: "BOX", label: "Box" },
  { value: "PIECE", label: "Piece" },
];

const CATEGORY_BADGES: Record<string, { label: string; className: string }> = {
  REFILLABLE_WATER: {
    label: "Refillable Water",
    className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  EMPTY_JAR_ASSET: {
    label: "Empty Jar Asset",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  PACKAGED_WATER: {
    label: "Packaged Water",
    className: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
  },
  BEVERAGE: {
    label: "Beverage",
    className: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30",
  },
  DISPENSER_EQUIPMENT: {
    label: "Dispenser",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  CONSUMABLE: {
    label: "Consumable",
    className: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30",
  },
  SERVICE: {
    label: "Service",
    className: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  },
};

interface FormState {
  sku: string;
  name: string;
  category: ProductInput["category"];
  unit_of_measure: string;
  default_sale_price: string;
  cost_price: string;
  deposit_amount: string;
  hsn_code: string;
  gst_rate: number;
  cgst_rate: number;
  sgst_rate: number;
  igst_rate: number;
  is_reusable_jar: boolean;
  is_active: boolean;
}

const DEFAULT_FORM_STATE: FormState = {
  sku: "",
  name: "",
  category: "REFILLABLE_WATER",
  unit_of_measure: "JAR",
  default_sale_price: "90",
  cost_price: "45",
  deposit_amount: "150",
  hsn_code: "2201",
  gst_rate: 5,
  cgst_rate: 2.5,
  sgst_rate: 2.5,
  igst_rate: 5,
  is_reusable_jar: true,
  is_active: true,
};

export default function ProductsPage() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace("/inventory");
  }, [router]);

  const { addToast } = useToast();

  const [products, setProducts] = React.useState<ProductRecord[]>([]);
  const [stockMap, setStockMap] = React.useState<Map<string, InventoryItemRecord>>(new Map());
  const [isLoading, setIsLoading] = React.useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState("ALL");
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");

  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [currentProductId, setCurrentProductId] = React.useState<string | null>(null);
  const [formData, setFormData] = React.useState<FormState>(DEFAULT_FORM_STATE);
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Status toggle confirmation dialog
  const [confirmToggleTarget, setConfirmToggleTarget] = React.useState<ProductRecord | null>(null);
  const [isToggleLoading, setIsToggleLoading] = React.useState(false);

  // Load products and inventory balances
  const loadCatalogData = React.useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);

    try {
      const [prodRes, invRes] = await Promise.all([
        getProducts({ pageSize: 100 }),
        getInventoryStockLevels(),
      ]);

      if (!prodRes.success) {
        setFetchError(prodRes.error || "Failed to load product catalog.");
        setIsLoading(false);
        return;
      }

      setProducts(prodRes.data?.items || []);

      if (invRes.success && invRes.data) {
        const map = new Map<string, InventoryItemRecord>();
        invRes.data.forEach((item) => map.set(item.product_id, item));
        setStockMap(map);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error loading product catalog.";
      setFetchError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadCatalogData();
  }, [loadCatalogData]);

  // Open Add Product modal
  const handleOpenAddModal = () => {
    setIsEditing(false);
    setCurrentProductId(null);
    setFormData(DEFAULT_FORM_STATE);
    setFormErrors({});
    setIsFormModalOpen(true);
  };

  // Open Edit Product modal
  const handleOpenEditModal = (prod: ProductRecord) => {
    setIsEditing(true);
    setCurrentProductId(prod.id);
    setFormData({
      sku: prod.sku,
      name: prod.name,
      category: prod.category,
      unit_of_measure: prod.unit_of_measure || "UNIT",
      default_sale_price: prod.default_sale_price.toString(),
      cost_price: prod.cost_price.toString(),
      deposit_amount: prod.deposit_amount.toString(),
      hsn_code: prod.hsn_code,
      gst_rate: prod.gst_rate,
      cgst_rate: prod.cgst_rate,
      sgst_rate: prod.sgst_rate,
      igst_rate: prod.igst_rate,
      is_reusable_jar: prod.is_reusable_jar,
      is_active: prod.is_active,
    });
    setFormErrors({});
    setIsFormModalOpen(true);
  };

  // Handle GST selection with automatic CGST, SGST, IGST breakdown
  const handleGstPresetChange = (rate: number) => {
    const half = Number((rate / 2).toFixed(2));
    setFormData((prev) => ({
      ...prev,
      gst_rate: rate,
      cgst_rate: half,
      sgst_rate: half,
      igst_rate: rate,
    }));
  };

  // Form submit handler
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});
    setIsSubmitting(true);

    const salePrice = Number(formData.default_sale_price);
    const costPrice = Number(formData.cost_price);
    const depositAmt = formData.is_reusable_jar ? Number(formData.deposit_amount) : 0;

    const payload: ProductInput = {
      sku: formData.sku.trim(),
      name: formData.name.trim(),
      category: formData.category,
      unit_of_measure: formData.unit_of_measure.trim() || "UNIT",
      default_sale_price: isNaN(salePrice) ? 0 : salePrice,
      cost_price: isNaN(costPrice) ? 0 : costPrice,
      deposit_amount: isNaN(depositAmt) ? 0 : depositAmt,
      hsn_code: formData.hsn_code.trim(),
      gst_rate: formData.gst_rate,
      cgst_rate: formData.cgst_rate,
      sgst_rate: formData.sgst_rate,
      igst_rate: formData.igst_rate,
      cess_rate: 0,
      is_reusable_jar: formData.is_reusable_jar,
      is_active: formData.is_active,
    };

    // Client-side Zod validation
    const validation = ProductInputSchema.safeParse(payload);
    if (!validation.success) {
      const fieldErrors: Record<string, string> = {};
      validation.error.issues.forEach((err) => {
        const path = err.path.join(".");
        fieldErrors[path] = err.message;
      });
      setFormErrors(fieldErrors);
      setIsSubmitting(false);
      addToast({
        type: "error",
        title: "Validation Error",
        message: "Please correct the highlighted fields before saving.",
      });
      return;
    }

    try {
      if (isEditing && currentProductId) {
        const res = await updateProduct(currentProductId, payload);
        if (res.success && res.data) {
          addToast({
            type: "success",
            title: "Product Updated",
            message: `Updated details for "${res.data.name}".`,
          });
          setIsFormModalOpen(false);
          await loadCatalogData();
        } else {
          addToast({
            type: "error",
            title: "Update Failed",
            message: res.error || "Failed to update product.",
          });
        }
      } else {
        const res = await createProduct(payload);
        if (res.success && res.data) {
          addToast({
            type: "success",
            title: "Product Created",
            message: `Successfully created "${res.data.name}" in catalog.`,
          });
          setIsFormModalOpen(false);
          await loadCatalogData();
        } else {
          addToast({
            type: "error",
            title: "Creation Failed",
            message: res.error || "Failed to create product.",
          });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unexpected error saving product.";
      addToast({
        type: "error",
        title: "Server Error",
        message: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle active/inactive status
  const handleToggleStatusConfirm = async () => {
    if (!confirmToggleTarget) return;
    setIsToggleLoading(true);

    try {
      if (confirmToggleTarget.is_active) {
        const res = await deactivateProduct(confirmToggleTarget.id);
        if (res.success) {
          addToast({
            type: "success",
            title: "Product Deactivated",
            message: `"${confirmToggleTarget.name}" is now inactive and hidden from active sales.`,
          });
          await loadCatalogData();
        } else {
          addToast({
            type: "error",
            title: "Deactivation Failed",
            message: res.error || "Failed to deactivate product.",
          });
        }
      } else {
        const res = await activateProduct(confirmToggleTarget.id);
        if (res.success) {
          addToast({
            type: "success",
            title: "Product Activated",
            message: `"${confirmToggleTarget.name}" is now active and available for orders.`,
          });
          await loadCatalogData();
        } else {
          addToast({
            type: "error",
            title: "Activation Failed",
            message: res.error || "Failed to activate product.",
          });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unexpected error toggling status.";
      addToast({
        type: "error",
        title: "Action Failed",
        message: msg,
      });
    } finally {
      setIsToggleLoading(false);
      setConfirmToggleTarget(null);
    }
  };

  // Filtered and searched product list
  const filteredProducts = React.useMemo(() => {
    return products.filter((prod) => {
      const matchesSearch =
        prod.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prod.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        prod.hsn_code.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory =
        categoryFilter === "ALL" || prod.category === categoryFilter;

      const matchesStatus =
        statusFilter === "ALL"
          ? true
          : statusFilter === "ACTIVE"
          ? prod.is_active
          : !prod.is_active;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [products, searchQuery, categoryFilter, statusFilter]);

  // Summary Metrics
  const metrics = React.useMemo(() => {
    const total = products.length;
    const active = products.filter((p) => p.is_active).length;
    const reusable = products.filter((p) => p.is_reusable_jar).length;
    const lowStock = products.filter((p) => {
      const stk = stockMap.get(p.id);
      return stk ? stk.available_stock <= (stk.reorder_level || 10) : false;
    }).length;
    return { total, active, reusable, lowStock };
  }, [products, stockMap]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Product Master Catalog
            </h1>
            <Badge variant="primary" className="text-xs">
              Item Registry & Pricing
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Configure refillable 20L jars, packaged waters, dispensers, GST tax rates, and base sale prices.
          </p>
        </div>

        <Button onClick={handleOpenAddModal} className="gap-2 shadow-xs">
          <Plus className="h-4 w-4" />
          Add Product
        </Button>
      </div>

      {/* 4 Summary KPI Cards */}
      <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-border shadow-xs">
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Total Catalog Items</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                <Package className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              {metrics.total}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Master SKU definitions</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Active For Sale</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 shrink-0">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {metrics.active}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Available on POS & Delivery</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Reusable Containers</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 shrink-0">
                <RotateCcw className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
              {metrics.reusable}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Strict empty/full jar tracking</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardContent className="p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Reorder Alerts</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 shrink-0">
                <AlertCircle className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {metrics.lowStock}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Below threshold stock</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Search Toolbar */}
      <Card className="border-border shadow-xs">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products by name, SKU, or HSN code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>

            {/* Category Filter */}
            <div className="w-full md:w-56">
              <Select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                options={CATEGORY_OPTIONS}
                className="h-9 text-xs"
              />
            </div>

            {/* Status Filter */}
            <div className="w-full md:w-40">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "ALL" | "ACTIVE" | "INACTIVE")}
                options={[
                  { value: "ALL", label: "All Status" },
                  { value: "ACTIVE", label: "Active Only" },
                  { value: "INACTIVE", label: "Inactive Only" },
                ]}
                className="h-9 text-xs"
              />
            </div>

            {/* Clear Filters Button */}
            {(searchQuery || categoryFilter !== "ALL" || statusFilter !== "ALL") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setCategoryFilter("ALL");
                  setStatusFilter("ALL");
                }}
                className="text-xs text-muted-foreground hover:text-foreground h-9"
              >
                Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Products Table */}
      <Card className="border-border shadow-xs overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
              <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span>Loading product master catalog...</span>
            </div>
          ) : fetchError ? (
            <div className="py-12 text-center text-xs space-y-3">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
              <p className="font-semibold text-destructive">{fetchError}</p>
              <Button size="sm" variant="outline" onClick={loadCatalogData}>
                Retry Connection
              </Button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <Package className="h-10 w-10 text-muted-foreground/40 mx-auto" />
              <h3 className="text-sm font-bold text-foreground">No Products Found</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {products.length === 0
                  ? "Your catalog is empty. Click 'Add Product' above to configure your first water SKU or jar asset."
                  : "No products matched your search or filter criteria. Try clearing your filters."}
              </p>
              {products.length === 0 && (
                <Button size="sm" onClick={handleOpenAddModal} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add First Product
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto relative">
              <div className="sm:hidden text-[10px] text-muted-foreground px-4 py-1.5 bg-muted/40 border-b border-border flex items-center justify-between">
                <span>Swipe horizontally to view full product catalog</span>
                <span>&rarr;</span>
              </div>
              <table className="w-full text-left text-xs min-w-[750px]">
                <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                  <tr>
                    <th className="py-3 px-4 font-semibold">SKU & Item Name</th>
                    <th className="py-3 px-4 font-semibold">Category</th>
                    <th className="py-3 px-4 font-semibold text-right">Selling Price</th>
                    <th className="py-3 px-4 font-semibold text-right">Cost Price</th>
                    <th className="py-3 px-4 font-semibold text-right">GST Rate</th>
                    <th className="py-3 px-4 font-semibold text-right">Warehouse Stock</th>
                    <th className="py-3 px-4 font-semibold text-center">Status</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredProducts.map((prod) => {
                    const stock = stockMap.get(prod.id);
                    const categoryMeta =
                      CATEGORY_BADGES[prod.category] || {
                        label: prod.category,
                        className: "bg-muted text-foreground border-border",
                      };

                    return (
                      <tr
                        key={prod.id}
                        className={`hover:bg-muted/20 transition-colors ${
                          !prod.is_active ? "opacity-60 bg-muted/10" : ""
                        }`}
                      >
                        {/* Name & SKU */}
                        <td className="py-3.5 px-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-foreground text-sm">
                                {prod.name}
                              </span>
                              {prod.is_reusable_jar && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] py-0 px-1 border-blue-500/40 text-blue-500 bg-blue-500/5 font-mono"
                                  title={`Refundable Jar Deposit: ₹${prod.deposit_amount}`}
                                >
                                  Reusable Jar (₹{prod.deposit_amount} Dep)
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="font-mono bg-muted/50 px-1.5 py-0.5 rounded border border-border/50">
                                {prod.sku}
                              </span>
                              <span>•</span>
                              <span>HSN: {prod.hsn_code}</span>
                              <span>•</span>
                              <span>Unit: {prod.unit_of_measure}</span>
                            </div>
                          </div>
                        </td>

                        {/* Category */}
                        <td className="py-3.5 px-4">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-medium ${categoryMeta.className}`}
                          >
                            {categoryMeta.label}
                          </Badge>
                        </td>

                        {/* Selling Price */}
                        <td className="py-3.5 px-4 text-right">
                          <span className="font-extrabold text-foreground text-sm">
                            {formatCurrency(prod.default_sale_price)}
                          </span>
                          <span className="text-[10px] text-muted-foreground block">
                            per {prod.unit_of_measure.toLowerCase()}
                          </span>
                        </td>

                        {/* Cost Price */}
                        <td className="py-3.5 px-4 text-right">
                          <span className="font-medium text-muted-foreground">
                            {formatCurrency(prod.cost_price)}
                          </span>
                          <span className="text-[10px] text-muted-foreground block">procurement</span>
                        </td>

                        {/* GST Rate */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="space-y-0.5">
                            <span className="font-bold text-foreground">
                              {prod.gst_rate}% GST
                            </span>
                            <span className="text-[10px] text-muted-foreground block font-mono">
                              ({prod.cgst_rate}% + {prod.sgst_rate}%)
                            </span>
                          </div>
                        </td>

                        {/* Warehouse Stock */}
                        <td className="py-3.5 px-4 text-right">
                          {stock ? (
                            <div className="space-y-0.5">
                              <span
                                className={`font-bold block ${
                                  stock.available_stock <= (stock.reorder_level || 10)
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-foreground"
                                }`}
                              >
                                {stock.available_stock} Avail
                              </span>
                              <span className="text-[10px] text-muted-foreground block">
                                {stock.current_stock} On-Hand ({stock.reserved_stock} res)
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">0 in stock</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4 text-center">
                          {prod.is_active ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
                            >
                              Active
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 text-muted-foreground border-border bg-muted/40"
                            >
                              Inactive
                            </Badge>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleOpenEditModal(prod)}
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                              title="Edit Product Details & Pricing"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmToggleTarget(prod)}
                              className={`h-8 w-8 p-0 ${
                                prod.is_active
                                  ? "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  : "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10"
                              }`}
                              title={prod.is_active ? "Deactivate Product" : "Reactivate Product"}
                            >
                              <Power className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Product Modal */}
      <Dialog
        isOpen={isFormModalOpen}
        onClose={() => !isSubmitting && setIsFormModalOpen(false)}
        title={isEditing ? "Edit Product Details & Pricing" : "Add New Product to Catalog"}
        description={
          isEditing
            ? "Update selling price, procurement cost, GST tax rates, and category details."
            : "Define a new consumable SKU, refillable water bottle, or dispensing equipment."
        }
        className="max-w-2xl"
      >
        <form onSubmit={handleFormSubmit} className="space-y-4 pt-2">
          {/* Row 1: Name and SKU */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Input
                label="Product Name *"
                placeholder="e.g. 20L Purified Water Jar"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                error={formErrors.name}
                required
              />
            </div>
            <div>
              <Input
                label="SKU / Unique Item Code *"
                placeholder="e.g. WAT-20L-REFILL"
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value.toUpperCase() })}
                error={formErrors.sku}
                required
              />
            </div>
          </div>

          {/* Row 2: Category and Unit of Measure */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Select
                label="Category *"
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value as ProductInput["category"] })
                }
                options={CATEGORY_FORM_OPTIONS}
              />
            </div>
            <div>
              <Select
                label="Unit of Measure *"
                value={formData.unit_of_measure}
                onChange={(e) => setFormData({ ...formData, unit_of_measure: e.target.value })}
                options={UNIT_OPTIONS}
              />
            </div>
          </div>

          {/* Row 3: Pricing (Sale & Cost) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Input
                label="Default Selling Price (₹) *"
                type="number"
                step="0.01"
                min="0"
                placeholder="90.00"
                value={formData.default_sale_price}
                onChange={(e) => setFormData({ ...formData, default_sale_price: e.target.value })}
                error={formErrors.default_sale_price}
                required
              />
            </div>
            <div>
              <Input
                label="Procurement / Cost Price (₹) *"
                type="number"
                step="0.01"
                min="0"
                placeholder="45.00"
                value={formData.cost_price}
                onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                error={formErrors.cost_price}
                required
              />
            </div>
          </div>

          {/* Row 4: HSN Code & GST Preset */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Input
                label="HSN Code *"
                placeholder="e.g. 2201 (Water)"
                value={formData.hsn_code}
                onChange={(e) => setFormData({ ...formData, hsn_code: e.target.value })}
                error={formErrors.hsn_code}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                GST Tax Rate Preset *
              </label>
              <select
                value={formData.gst_rate}
                onChange={(e) => handleGstPresetChange(Number(e.target.value))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors shadow-xs"
              >
                {GST_PRESETS.map((p) => (
                  <option key={p.rate} value={p.rate}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* GST Breakdown Preview Box */}
          <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs space-y-1">
            <span className="font-semibold text-foreground">Tax Integrity Check:</span>
            <div className="flex items-center gap-4 text-muted-foreground">
              <span>Total GST: <strong className="text-foreground">{formData.gst_rate}%</strong></span>
              <span>CGST: <strong className="text-foreground">{formData.cgst_rate}%</strong></span>
              <span>SGST: <strong className="text-foreground">{formData.sgst_rate}%</strong></span>
              <span>IGST: <strong className="text-foreground">{formData.igst_rate}%</strong></span>
            </div>
          </div>

          {/* Row 5: Reusable Jar Asset & Deposit Amount */}
          <div className="rounded-xl border border-border p-3.5 space-y-3 bg-card/60">
            <Checkbox
              label="Is this a reusable container / jar asset?"
              description="Check this for 20L or 10L polycarbonate bottles with strict empty vs full custody tracking."
              checked={formData.is_reusable_jar}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  is_reusable_jar: e.target.checked,
                  deposit_amount: e.target.checked && formData.deposit_amount === "0" ? "150" : formData.deposit_amount,
                })
              }
            />

            {formData.is_reusable_jar && (
              <div className="pt-2 border-t border-border/60">
                <Input
                  label="Refundable Customer Jar Deposit (₹)"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="150.00"
                  value={formData.deposit_amount}
                  onChange={(e) => setFormData({ ...formData, deposit_amount: e.target.value })}
                  error={formErrors.deposit_amount}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Standard deposit charged when customer custody increases without returning an empty jar.
                </p>
              </div>
            )}
          </div>

          {/* Row 6: Active Status Toggle */}
          <div className="pt-1">
            <Checkbox
              label="Product Active for Sales & Route Delivery"
              description="Uncheck to hide this SKU from POS sales screens and new order creation forms."
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsFormModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving..."
                : isEditing
                ? "Save Changes"
                : "Create Product"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Deactivate / Reactivate Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!confirmToggleTarget}
        onClose={() => setConfirmToggleTarget(null)}
        onConfirm={handleToggleStatusConfirm}
        title={
          confirmToggleTarget?.is_active
            ? `Deactivate "${confirmToggleTarget?.name}"?`
            : `Reactivate "${confirmToggleTarget?.name}"?`
        }
        description={
          confirmToggleTarget?.is_active
            ? "Deactivating this product will hide it from POS counter selection and new delivery order creation. All historical orders, invoices, and stock movements are permanently preserved."
            : "Reactivating this product will make it available again across POS counter sales and delivery route dispatch."
        }
        confirmLabel={
          confirmToggleTarget?.is_active ? "Deactivate Product" : "Reactivate Product"
        }
        variant={confirmToggleTarget?.is_active ? "destructive" : "primary"}
        isLoading={isToggleLoading}
      />
    </div>
  );
}
