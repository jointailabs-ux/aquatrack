"use client";

import * as React from "react";
import {
  Tag,
  Search,
  Plus,
  Users,
  Package,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Edit3,
  Ban,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  Building,
} from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  getAllSpecialPrices,
  getPricingDashboardKPIs,
  createSpecialPrice,
  updateSpecialPrice,
  deactivateSpecialPrice,
  deleteSpecialPrice,
} from "@/modules/pricing/special-price.service";
import { getCustomers } from "@/modules/customers/customer.service";
import { getProducts } from "@/modules/products/product.service";
import {
  SpecialPriceWithDetails,
  PricingKPIs,
  SpecialPriceInput,
  SpecialPriceUpdateInput,
} from "@/modules/pricing/special-price.schema";
import { CustomerRecord } from "@/modules/customers/customer.schema";
import { ProductRecord } from "@/modules/products/product.schema";
import { formatCurrency } from "@/lib/utils";

// Module-level client cache for instant pricing navigation
let cachedPricingState: {
  key: string;
  kpis: PricingKPIs;
  items: SpecialPriceWithDetails[];
  total: number;
  totalPages: number;
  customers: CustomerRecord[];
  products: ProductRecord[];
} | null = null;

export default function PricingPage() {
  const { addToast } = useToast();

  // Data with instant cache initialization
  const [agreements, setAgreements] = React.useState<SpecialPriceWithDetails[]>(() => cachedPricingState?.items || []);
  const [kpis, setKpis] = React.useState<PricingKPIs>(() => cachedPricingState?.kpis || {
    totalActive: 0,
    totalCustomers: 0,
    totalProducts: 0,
    totalExpired: 0,
    totalUpcomingExpirations: 0,
  });
  const [customers, setCustomers] = React.useState<CustomerRecord[]>(() => cachedPricingState?.customers || []);
  const [products, setProducts] = React.useState<ProductRecord[]>(() => cachedPricingState?.products || []);

  // UI States
  const [isLoading, setIsLoading] = React.useState<boolean>(() => !cachedPricingState);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedCustomerId, setSelectedCustomerId] = React.useState<string>("");
  const [selectedProductId, setSelectedProductId] = React.useState<string>("");
  const [statusFilter, setStatusFilter] = React.useState<
    "ALL" | "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "UPCOMING"
  >("ALL");
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(() => cachedPricingState?.totalPages || 1);
  const [totalCount, setTotalCount] = React.useState(() => cachedPricingState?.total || 0);

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = React.useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false);
  const [activeAgreement, setActiveAgreement] = React.useState<SpecialPriceWithDetails | null>(null);

  // Create Form State
  const [addCustomerId, setAddCustomerId] = React.useState("");
  const [addProductId, setAddProductId] = React.useState("");
  const [addSpecialPrice, setAddSpecialPrice] = React.useState("");
  const [addEffectiveFrom, setAddEffectiveFrom] = React.useState(
    () => new Date().toISOString().split("T")[0]
  );
  const [addEffectiveTo, setAddEffectiveTo] = React.useState("");

  // Edit Form State
  const [editSpecialPrice, setEditSpecialPrice] = React.useState("");
  const [editEffectiveFrom, setEditEffectiveFrom] = React.useState("");
  const [editEffectiveTo, setEditEffectiveTo] = React.useState("");

  // Load KPI metrics and agreements
  const loadData = React.useCallback(
    async (targetPage = page) => {
      const cacheKey = `${selectedCustomerId}-${selectedProductId}-${statusFilter}-${searchQuery}-${targetPage}`;
      const hasMatchingCache = cachedPricingState && cachedPricingState.key === cacheKey;

      if (!hasMatchingCache) {
        setIsLoading(true);
      }
      try {
        const [kpiRes, listRes] = await Promise.all([
          getPricingDashboardKPIs(),
          getAllSpecialPrices({
            customerId: selectedCustomerId || undefined,
            productId: selectedProductId || undefined,
            status: statusFilter,
            search: searchQuery.trim() || undefined,
            page: targetPage,
            pageSize: 15,
          }),
        ]);

        let freshKPIs = kpis;
        let freshItems: SpecialPriceWithDetails[] = [];
        let freshTotal = 0;
        let freshPages = 1;

        if (kpiRes.success && kpiRes.data) {
          freshKPIs = kpiRes.data;
          setKpis(kpiRes.data);
        }
        if (listRes.success && listRes.data) {
          freshItems = listRes.data.items;
          freshTotal = listRes.data.total || 0;
          freshPages = listRes.data.totalPages || 1;
          setAgreements(listRes.data.items);
          setTotalPages(freshPages);
          setTotalCount(freshTotal);
        } else {
          setAgreements([]);
          setTotalPages(1);
          setTotalCount(0);
        }

        cachedPricingState = {
          key: cacheKey,
          kpis: freshKPIs,
          items: freshItems,
          total: freshTotal,
          totalPages: freshPages,
          customers: cachedPricingState?.customers || customers,
          products: cachedPricingState?.products || products,
        };
      } catch {
        addToast({ type: "error", title: "Error", message: "Failed to connect to database." });
      } finally {
        setIsLoading(false);
      }
    },
    [selectedCustomerId, selectedProductId, statusFilter, searchQuery, page, addToast, kpis, customers, products]
  );

  // Load Customers & Products for dropdowns
  React.useEffect(() => {
    async function initSelectors() {
      const [custRes, prodRes] = await Promise.all([
        getCustomers({ pageSize: 150 }),
        getProducts({ pageSize: 150 }),
      ]);
      if (custRes.success && custRes.data) {
        setCustomers(custRes.data.items);
      }
      if (prodRes.success && prodRes.data) {
        setProducts(prodRes.data.items);
      }
    }
    initSelectors();
  }, []);

  React.useEffect(() => {
    loadData(1);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerId, selectedProductId, statusFilter, searchQuery]);

  // Selected product in Create Modal for comparison
  const selectedProductForAdd = React.useMemo(() => {
    return products.find((p) => p.id === addProductId);
  }, [products, addProductId]);

  // Handle Create Agreement
  const handleCreateAgreement = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(addSpecialPrice);

    if (!addCustomerId) {
      addToast({ type: "error", title: "Validation Error", message: "Customer is required." });
      return;
    }
    if (!addProductId) {
      addToast({ type: "error", title: "Validation Error", message: "Product is required." });
      return;
    }
    if (isNaN(priceNum) || priceNum < 0) {
      addToast({ type: "error", title: "Validation Error", message: "Special price cannot be negative." });
      return;
    }
    if (addEffectiveTo && addEffectiveTo < addEffectiveFrom) {
      addToast({
        type: "error",
        title: "Validation Error",
        message: "Expiry date cannot precede start date.",
      });
      return;
    }

    setIsSubmitting(true);
    const input: SpecialPriceInput = {
      customer_id: addCustomerId,
      product_id: addProductId,
      special_price: priceNum,
      effective_from: addEffectiveFrom,
      effective_to: addEffectiveTo || null,
    };

    const res = await createSpecialPrice(input);
    setIsSubmitting(false);

    if (res.success && res.data) {
      addToast({
        type: "success",
        title: "Special Price Created",
        message: "Agreed special price contract has been registered.",
      });
      setIsAddModalOpen(false);
      // Reset form
      setAddCustomerId("");
      setAddProductId("");
      setAddSpecialPrice("");
      setAddEffectiveFrom(new Date().toISOString().split("T")[0]);
      setAddEffectiveTo("");
      loadData(1);
    } else {
      addToast({
        type: "error",
        title: "Failed to Create Agreement",
        message: res.error || "Could not register price contract.",
      });
    }
  };

  // Open Edit Modal
  const openEditModal = (agreement: SpecialPriceWithDetails) => {
    setActiveAgreement(agreement);
    setEditSpecialPrice(String(agreement.special_price));
    setEditEffectiveFrom(agreement.effective_from);
    setEditEffectiveTo(agreement.effective_to || "");
    setIsEditModalOpen(true);
  };

  // Handle Update Agreement
  const handleUpdateAgreement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAgreement) return;

    const priceNum = parseFloat(editSpecialPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      addToast({ type: "error", title: "Validation Error", message: "Special price cannot be negative." });
      return;
    }
    if (editEffectiveTo && editEffectiveTo < editEffectiveFrom) {
      addToast({
        type: "error",
        title: "Validation Error",
        message: "Expiry date cannot precede start date.",
      });
      return;
    }

    setIsSubmitting(true);
    const updateInput: SpecialPriceUpdateInput = {
      special_price: priceNum,
      effective_from: editEffectiveFrom,
      effective_to: editEffectiveTo || null,
    };

    const res = await updateSpecialPrice(activeAgreement.id, updateInput);
    setIsSubmitting(false);

    if (res.success && res.data) {
      addToast({
        type: "success",
        title: "Agreement Updated",
        message: "Contract pricing updated without altering historical transactions.",
      });
      setIsEditModalOpen(false);
      loadData(page);
    } else {
      addToast({
        type: "error",
        title: "Update Failed",
        message: res.error || "Could not update agreement.",
      });
    }
  };

  // Handle Deactivate
  const handleDeactivate = async () => {
    if (!activeAgreement) return;
    setIsSubmitting(true);
    const res = await deactivateSpecialPrice(activeAgreement.id);
    setIsSubmitting(false);
    setIsDeactivateOpen(false);

    if (res.success) {
      addToast({
        type: "success",
        title: "Agreement Deactivated",
        message: "Special pricing contract has been expired. Historical orders are preserved.",
      });
      loadData(page);
    } else {
      addToast({
        type: "error",
        title: "Deactivation Failed",
        message: res.error || "Could not deactivate agreement.",
      });
    }
  };

  // Handle Delete
  const handleDelete = async () => {
    if (!activeAgreement) return;
    setIsSubmitting(true);
    const res = await deleteSpecialPrice(activeAgreement.id);
    setIsSubmitting(false);
    setIsDeleteOpen(false);

    if (res.success) {
      addToast({
        type: "success",
        title: "Agreement Deleted",
        message: "Special price record removed.",
      });
      loadData(page);
    } else {
      addToast({
        type: "error",
        title: "Deletion Failed",
        message: res.error || "Could not delete agreement.",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Special Pricing & Contract Agreements
            </h1>
            <Badge variant="primary" className="text-xs">
              {kpis.totalActive} Active Contracts
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Customer-specific negotiated product prices, tiered volume rates, and date-range contracts.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => setIsAddModalOpen(true)}
          className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
        >
          <Plus className="h-4 w-4" />
          New Price Agreement
        </Button>
      </div>

      {/* 5 KPI Summary Cards */}
      <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-5 gap-2.5 sm:gap-3">
        <Card className="border-border shadow-2xs">
          <CardContent className="p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Active Contracts
              </span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-xl font-extrabold text-foreground">{kpis.totalActive}</p>
            <p className="text-[11px] text-muted-foreground">Currently applied</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-2xs">
          <CardContent className="p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Clients Covered
              </span>
              <Users className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-xl font-extrabold text-foreground">{kpis.totalCustomers}</p>
            <p className="text-[11px] text-muted-foreground">Distinct accounts</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-2xs">
          <CardContent className="p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Products Covered
              </span>
              <Package className="h-4 w-4 text-primary" />
            </div>
            <p className="text-xl font-extrabold text-foreground">{kpis.totalProducts}</p>
            <p className="text-[11px] text-muted-foreground">Negotiated SKUs</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-2xs">
          <CardContent className="p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Expiring Soon (30d)
              </span>
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-xl font-extrabold text-amber-600 dark:text-amber-400">
              {kpis.totalUpcomingExpirations}
            </p>
            <p className="text-[11px] text-muted-foreground">Action needed</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-2xs">
          <CardContent className="p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Expired Contracts
              </span>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-xl font-extrabold text-muted-foreground">{kpis.totalExpired}</p>
            <p className="text-[11px] text-muted-foreground">Historical records</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Toolbar */}
      <Card className="border-border shadow-xs">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            {/* Search */}
            <div className="sm:col-span-4 relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search customer, product name, or SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs h-9"
              />
            </div>

            {/* Customer Dropdown Filter */}
            <div className="sm:col-span-3">
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary h-9"
              >
                <option value="">All Customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contact_name} {c.business_name ? `(${c.business_name})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Product Dropdown Filter */}
            <div className="sm:col-span-3">
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary h-9"
              >
                <option value="">All Products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>

            {/* Reset Button */}
            <div className="sm:col-span-2 flex items-center justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCustomerId("");
                  setSelectedProductId("");
                  setStatusFilter("ALL");
                }}
                className="text-xs h-9 w-full sm:w-auto"
              >
                Reset
              </Button>
            </div>
          </div>

          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-border/60">
            <span className="text-[11px] font-semibold text-muted-foreground mr-1">Status:</span>
            {[
              { id: "ALL", label: "All Agreements" },
              { id: "ACTIVE", label: `Active (${kpis.totalActive})` },
              { id: "EXPIRING_SOON", label: `Expiring Soon (${kpis.totalUpcomingExpirations})` },
              { id: "EXPIRED", label: `Expired (${kpis.totalExpired})` },
              { id: "UPCOMING", label: "Upcoming" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as typeof statusFilter)}
                className={`py-1 px-2.5 rounded-lg text-xs font-medium transition-all ${
                  statusFilter === tab.id
                    ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Main Agreements Directory Table */}
      <Card className="border-border shadow-xs">
        <CardHeader className="p-4 pb-3 border-b border-border flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider">
              Special Pricing Agreements ({totalCount})
            </h2>
          </div>
          <button
            onClick={() => loadData(page)}
            className="text-muted-foreground hover:text-foreground text-xs p-1"
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </CardHeader>

        <CardContent className="p-0">
          {/* Mobile View: High-density Special Price Agreement Cards */}
          <div className="md:hidden divide-y divide-border/60">
            {isLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                Loading special price contracts...
              </div>
            ) : agreements.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground space-y-2">
                <Tag className="h-8 w-8 mx-auto text-muted-foreground/30" />
                <p className="font-semibold text-foreground">No price agreements found</p>
                <p className="text-[11px] text-muted-foreground">
                  {searchQuery || selectedCustomerId || selectedProductId || statusFilter !== "ALL"
                    ? "Try clearing or modifying your filter criteria."
                    : "Click 'New Price Agreement' above."}
                </p>
              </div>
            ) : (
              agreements.map((agr) => {
                const stdPrice = agr.product?.default_sale_price || 0;
                const discountAmt = agr.discount_amount || 0;
                return (
                  <div key={agr.id} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-xs font-bold text-foreground">
                            {agr.customer?.contact_name || "Unknown Customer"}
                          </h4>
                          <Badge
                            variant={agr.customer?.customer_type === "B2B" ? "primary" : "secondary"}
                            className="text-[9px] py-0 px-1 font-semibold"
                          >
                            {agr.customer?.customer_type || "Client"}
                          </Badge>
                        </div>
                        {agr.customer?.business_name && (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Building className="h-3 w-3 shrink-0" />
                            {agr.customer.business_name}
                          </p>
                        )}
                        <p className="text-xs font-medium text-foreground mt-1">
                          {agr.product?.name || "Product"}
                          <span className="text-[10px] text-muted-foreground font-mono ml-1.5">
                            ({agr.product?.sku})
                          </span>
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 block">
                          {formatCurrency(agr.special_price)}
                        </span>
                        <span className="text-[10px] text-muted-foreground line-through block">
                          {formatCurrency(stdPrice)}
                        </span>
                        {discountAmt > 0 && (
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 block">
                            -{agr.discount_percent}% off
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        Valid: {agr.effective_from} {agr.effective_to ? `to ${agr.effective_to}` : "(Permanent)"}
                      </span>
                      {agr.status === "ACTIVE" ? (
                        <Badge variant="success" className="text-[9px] py-0">Active</Badge>
                      ) : agr.status === "EXPIRED" ? (
                        <Badge variant="outline" className="text-[9px] py-0 text-muted-foreground">Expired</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[9px] py-0 text-blue-600">Upcoming</Badge>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/40">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditModal(agr)}
                        className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <Edit3 className="h-3 w-3" /> Edit
                      </Button>
                      {agr.status === "ACTIVE" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setActiveAgreement(agr);
                            setIsDeactivateOpen(true);
                          }}
                          className="h-7 px-2 text-[11px] gap-1 text-amber-600 border-amber-500/30"
                        >
                          <Ban className="h-3 w-3" /> Deactivate
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setActiveAgreement(agr);
                          setIsDeleteOpen(true);
                        }}
                        className="h-7 px-2 text-[11px] gap-1 text-rose-600 border-rose-500/30 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop View: Full Data Table */}
          <div className="hidden md:block overflow-x-auto relative">
            <table className="w-full text-left text-xs min-w-[750px]">
              <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-3 px-4 font-semibold">Customer Account</th>
                  <th className="py-3 px-4 font-semibold">Product SKU</th>
                  <th className="py-3 px-4 text-right font-semibold">Catalog Price</th>
                  <th className="py-3 px-4 text-right font-semibold">Agreed Price</th>
                  <th className="py-3 px-4 text-right font-semibold">Discount</th>
                  <th className="py-3 px-4 font-semibold">Validity Period</th>
                  <th className="py-3 px-4 text-center font-semibold">Status</th>
                  <th className="py-3 px-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                      Loading price agreements...
                    </td>
                  </tr>
                ) : agreements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-muted-foreground space-y-2">
                      <Tag className="h-8 w-8 mx-auto text-muted-foreground/30" />
                      <p className="font-semibold text-foreground">No price agreements found</p>
                      <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                        {searchQuery || selectedCustomerId || selectedProductId || statusFilter !== "ALL"
                          ? "Try clearing or modifying your filter criteria."
                          : "Click 'New Price Agreement' to create special pricing for a customer."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  agreements.map((agr) => {
                    const stdPrice = agr.product?.default_sale_price || 0;
                    const discountAmt = (agr.discount_amount || 0);

                    return (
                      <tr key={agr.id} className="hover:bg-muted/20 transition-colors">
                        {/* Customer */}
                        <td className="py-3 px-4">
                          <div className="font-bold text-foreground">
                            {agr.customer?.contact_name || "Unknown Customer"}
                          </div>
                          {agr.customer?.business_name && (
                            <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Building className="h-3 w-3 shrink-0" />
                              {agr.customer.business_name}
                            </p>
                          )}
                          <div className="mt-1">
                            <Badge
                              variant={agr.customer?.customer_type === "B2B" ? "primary" : "secondary"}
                              className="text-[9px] py-0 px-1 font-semibold"
                            >
                              {agr.customer?.customer_type || "Client"}
                            </Badge>
                          </div>
                        </td>

                        {/* Product */}
                        <td className="py-3 px-4">
                          <div className="font-semibold text-foreground">
                            {agr.product?.name || "Product"}
                          </div>
                          <span className="text-[11px] text-muted-foreground block font-mono">
                            {agr.product?.sku || "SKU"}
                          </span>
                        </td>

                        {/* Standard Catalog Price */}
                        <td className="py-3 px-4 text-right text-muted-foreground font-medium">
                          {formatCurrency(stdPrice)}
                        </td>

                        {/* Special Price */}
                        <td className="py-3 px-4 text-right">
                          <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(agr.special_price)}
                          </span>
                        </td>

                        {/* Discount */}
                        <td className="py-3 px-4 text-right">
                          {discountAmt > 0 ? (
                            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              <TrendingDown className="h-3.5 w-3.5" />
                              -{formatCurrency(discountAmt)} ({agr.discount_percent}%)
                            </span>
                          ) : discountAmt === 0 ? (
                            <span className="text-[11px] text-muted-foreground">Standard</span>
                          ) : (
                            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                              Premium
                            </span>
                          )}
                        </td>

                        {/* Validity Period */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span>
                              {agr.effective_from} → {agr.effective_to || "Indefinite"}
                            </span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3 px-4 text-center">
                          {agr.status === "ACTIVE" ? (
                            <Badge variant="success" className="text-[10px] py-0 font-semibold">
                              Active
                            </Badge>
                          ) : agr.status === "EXPIRED" ? (
                            <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground border-muted-foreground/30">
                              Expired
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] py-0 text-blue-600 font-semibold">
                              Upcoming
                            </Badge>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditModal(agr)}
                              className="h-7 px-2 text-xs gap-1 border-border text-foreground hover:bg-muted"
                              title="Edit contract price or validity"
                            >
                              <Edit3 className="h-3 w-3" />
                              Edit
                            </Button>

                            {agr.status === "ACTIVE" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setActiveAgreement(agr);
                                  setIsDeactivateOpen(true);
                                }}
                                className="h-7 px-2 text-xs gap-1 text-amber-600 hover:text-amber-700 border-amber-500/20 hover:bg-amber-500/10"
                                title="Deactivate and expire this agreement"
                              >
                                <Ban className="h-3 w-3" />
                                Deactivate
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setActiveAgreement(agr);
                                setIsDeleteOpen(true);
                              }}
                              className="h-7 px-2 text-xs text-rose-600 hover:text-rose-700 border-rose-500/20 hover:bg-rose-500/10"
                              title="Delete agreement"
                            >
                              <Trash2 className="h-3 w-3" />
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-3.5 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Page {page} of {totalPages} ({totalCount} agreements)
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || isLoading}
                  onClick={() => {
                    const newPage = page - 1;
                    setPage(newPage);
                    loadData(newPage);
                  }}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages || isLoading}
                  onClick={() => {
                    const newPage = page + 1;
                    setPage(newPage);
                    loadData(newPage);
                  }}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Special Price Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Tag className="h-5 w-5 text-primary" />
                Create Special Customer Price Contract
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAgreement} className="space-y-4">
              {/* Customer Selector */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Select Customer *
                </label>
                <select
                  value={addCustomerId}
                  onChange={(e) => setAddCustomerId(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="">-- Choose Customer --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contact_name} {c.business_name ? `(${c.business_name})` : ""} — {c.customer_type}
                    </option>
                  ))}
                </select>
              </div>

              {/* Product Selector */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Select Product *
                </label>
                <select
                  value={addProductId}
                  onChange={(e) => {
                    setAddProductId(e.target.value);
                    const prod = products.find((p) => p.id === e.target.value);
                    if (prod && !addSpecialPrice) {
                      setAddSpecialPrice(String(prod.default_sale_price));
                    }
                  }}
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="">-- Choose Product --</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) — Standard: {formatCurrency(p.default_sale_price)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Live Price Comparison Banner */}
              {selectedProductForAdd && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-medium">Standard Catalog Price:</span>
                    <span className="font-bold text-foreground">
                      {formatCurrency(selectedProductForAdd.default_sale_price)}
                    </span>
                  </div>

                  {addSpecialPrice && !isNaN(parseFloat(addSpecialPrice)) && (
                    <div className="flex items-center justify-between pt-1 border-t border-primary/20">
                      <span className="text-muted-foreground font-medium">Calculated Discount:</span>
                      {Number(selectedProductForAdd.default_sale_price) - parseFloat(addSpecialPrice) > 0 ? (
                        <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                          Save {formatCurrency(Number(selectedProductForAdd.default_sale_price) - parseFloat(addSpecialPrice))} (
                          {(
                            ((Number(selectedProductForAdd.default_sale_price) - parseFloat(addSpecialPrice)) /
                              Number(selectedProductForAdd.default_sale_price)) *
                            100
                          ).toFixed(1)}
                          % off)
                        </span>
                      ) : Number(selectedProductForAdd.default_sale_price) === parseFloat(addSpecialPrice) ? (
                        <span className="text-muted-foreground font-medium">Equal to catalog price</span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-semibold">
                          Above catalog price (+{formatCurrency(parseFloat(addSpecialPrice) - Number(selectedProductForAdd.default_sale_price))})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Special Unit Price */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Agreed Special Unit Price (₹) *
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 75"
                  value={addSpecialPrice}
                  onChange={(e) => setAddSpecialPrice(e.target.value)}
                  required
                  className="text-xs font-bold"
                />
              </div>

              {/* Date Ranges */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Effective From *
                  </label>
                  <Input
                    type="date"
                    value={addEffectiveFrom}
                    onChange={(e) => setAddEffectiveFrom(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Effective To (Optional)
                  </label>
                  <Input
                    type="date"
                    value={addEffectiveTo}
                    onChange={(e) => setAddEffectiveTo(e.target.value)}
                    placeholder="Leave empty for ongoing"
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                >
                  {isSubmitting ? "Creating..." : "Save Agreement"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Special Price Modal */}
      {isEditModalOpen && activeAgreement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-primary" />
                Edit Price Agreement
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Read-only details banner */}
            <div className="rounded-xl bg-muted/40 p-3 border border-border text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Customer:</span>
                <span className="font-bold text-foreground">
                  {activeAgreement.customer?.contact_name} {activeAgreement.customer?.business_name ? `(${activeAgreement.customer.business_name})` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground font-medium">Product:</span>
                <span className="font-semibold text-foreground">
                  {activeAgreement.product?.name} ({activeAgreement.product?.sku})
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/60">
                <span className="text-muted-foreground font-medium">Catalog Standard Price:</span>
                <span className="font-bold text-foreground">
                  {formatCurrency(activeAgreement.product?.default_sale_price || 0)}
                </span>
              </div>
            </div>

            <form onSubmit={handleUpdateAgreement} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Agreed Special Unit Price (₹) *
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editSpecialPrice}
                  onChange={(e) => setEditSpecialPrice(e.target.value)}
                  required
                  className="text-xs font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Effective From *
                  </label>
                  <Input
                    type="date"
                    value={editEffectiveFrom}
                    onChange={(e) => setEditEffectiveFrom(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Effective To (Optional)
                  </label>
                  <Input
                    type="date"
                    value={editEffectiveTo}
                    onChange={(e) => setEditEffectiveTo(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                >
                  {isSubmitting ? "Saving..." : "Update Agreement"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deactivate Confirm Dialog */}
      {activeAgreement && (
        <ConfirmDialog
          isOpen={isDeactivateOpen}
          onClose={() => setIsDeactivateOpen(false)}
          onConfirm={handleDeactivate}
          title="Deactivate Special Price Agreement?"
          description={`Expiring this agreement will revert ${activeAgreement.customer?.contact_name} to the standard catalog price (${formatCurrency(activeAgreement.product?.default_sale_price || 0)}) on future orders. Previously fulfilled orders and generated invoices remain immutable.`}
          confirmLabel="Deactivate Contract"
          variant="destructive"
          isLoading={isSubmitting}
        />
      )}

      {/* Delete Confirm Dialog */}
      {activeAgreement && (
        <ConfirmDialog
          isOpen={isDeleteOpen}
          onClose={() => setIsDeleteOpen(false)}
          onConfirm={handleDelete}
          title="Delete Price Agreement?"
          description={`Permanently delete the special price agreement for ${activeAgreement.customer?.contact_name} on ${activeAgreement.product?.name}?`}
          confirmLabel="Delete Agreement"
          variant="destructive"
          isLoading={isSubmitting}
        />
      )}
    </div>
  );
}

