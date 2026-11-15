"use client";

import * as React from "react";
import {
  ShoppingBag,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  AlertCircle,
  Plus,
  Search,
  RefreshCw,
  Eye,
  Package,
  Trash2,
  Boxes,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import {
  getPurchases,
  createPurchase,
  markPurchaseReceived,
  recordSupplierPayment,
  getSupplierPayments,
} from "@/modules/purchases/purchase.service";
import {
  PurchaseRecord,
  CreatePurchaseInput,
  SupplierPaymentRecord,
} from "@/modules/purchases/purchase.schema";
import { getSuppliers } from "@/modules/suppliers/supplier.service";
import { getProducts } from "@/modules/products/product.service";
import { SupplierRecord } from "@/modules/suppliers/supplier.schema";
import { ProductRecord } from "@/modules/products/product.schema";
import { formatCurrency } from "@/lib/utils";

interface PurchaseItemFormRow {
  product_id: string;
  quantity_ordered: number;
  unit_cost: number;
  gst_rate: number;
}

interface ReceiveItemFormRow {
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  quantity_already_received: number;
  quantity_outstanding: number;
  quantity_to_receive: number;
}

// Module-level client cache for instant purchases navigation
let cachedPurchasesState: {
  purchases: PurchaseRecord[];
  suppliers: SupplierRecord[];
  products: ProductRecord[];
} | null = null;

export default function PurchasesPage() {
  const { addToast } = useToast();

  // Primary Data with instant cache initialization
  const [purchases, setPurchases] = React.useState<PurchaseRecord[]>(() => cachedPurchasesState?.purchases || []);
  const [suppliers, setSuppliers] = React.useState<SupplierRecord[]>(() => cachedPurchasesState?.suppliers || []);
  const [products, setProducts] = React.useState<ProductRecord[]>(() => cachedPurchasesState?.products || []);

  // State
  const [isLoading, setIsLoading] = React.useState<boolean>(() => !cachedPurchasesState);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");

  // Create Purchase Order Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const [autoReceiveStock, setAutoReceiveStock] = React.useState(true);
  const [selectedSupplierId, setSelectedSupplierId] = React.useState("");
  const [poNumber, setPoNumber] = React.useState("");
  const [invoiceNumber, setInvoiceNumber] = React.useState("");
  const [purchaseDate, setPurchaseDate] = React.useState(new Date().toISOString().split("T")[0]);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = React.useState("");
  const [poNotes, setPoNotes] = React.useState("");
  const [createItemRows, setCreateItemRows] = React.useState<PurchaseItemFormRow[]>([]);
  const [isSubmittingPO, setIsSubmittingPO] = React.useState(false);

  // Goods Receipt Modal
  const [isReceiveModalOpen, setIsReceiveModalOpen] = React.useState(false);
  const [purchaseToReceive, setPurchaseToReceive] = React.useState<PurchaseRecord | null>(null);
  const [receiveRows, setReceiveRows] = React.useState<ReceiveItemFormRow[]>([]);
  const [isSubmittingReceipt, setIsSubmittingReceipt] = React.useState(false);

  // Supplier Payment Modal
  const [isPaymentModalOpen, setIsPaymentModalOpen] = React.useState(false);
  const [purchaseToPay, setPurchaseToPay] = React.useState<PurchaseRecord | null>(null);
  const [paymentAmount, setPaymentAmount] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState<"BANK_TRANSFER" | "UPI" | "CASH">("BANK_TRANSFER");
  const [paymentReference, setPaymentReference] = React.useState("");
  const [paymentDate, setPaymentDate] = React.useState(new Date().toISOString().split("T")[0]);
  const [paymentNotes, setPaymentNotes] = React.useState("");
  const [isSubmittingPayment, setIsSubmittingPayment] = React.useState(false);

  // Purchase Details Modal
  const [isDetailsModalOpen, setIsDetailsModalOpen] = React.useState(false);
  const [activePurchaseDetails, setActivePurchaseDetails] = React.useState<PurchaseRecord | null>(null);
  const [purchasePayments, setPurchasePayments] = React.useState<SupplierPaymentRecord[]>([]);
  const [isLoadingPayments, setIsLoadingPayments] = React.useState(false);

  // Load Data
  const loadData = React.useCallback(async () => {
    if (!cachedPurchasesState) {
      setIsLoading(true);
    }
    setLoadError(null);
    try {
      const [purchasesRes, suppliersRes, productsRes] = await Promise.all([
        getPurchases(),
        getSuppliers({ pageSize: 100 }),
        getProducts({ isActive: true, pageSize: 100 }),
      ]);

      if (!purchasesRes.success) {
        throw new Error(purchasesRes.error || "Failed to load purchases.");
      }

      const freshPurchases = purchasesRes.data || [];
      const freshSuppliers = suppliersRes.success && suppliersRes.data?.items ? suppliersRes.data.items : [];
      const freshProducts = productsRes.success && productsRes.data?.items ? productsRes.data.items : [];

      setPurchases(freshPurchases);
      setSuppliers(freshSuppliers);
      setProducts(freshProducts);

      cachedPurchasesState = {
        purchases: freshPurchases,
        suppliers: freshSuppliers,
        products: freshProducts,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load purchase data.";
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("new") === "true" && suppliers.length > 0) {
        handleOpenCreateModal();
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers.length, products.length]);

  // Open Create PO Modal
  const handleOpenCreateModal = () => {
    setSelectedSupplierId(suppliers[0]?.id || "");
    const generatedPo = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    setPoNumber(generatedPo);
    setInvoiceNumber("");
    setPurchaseDate(new Date().toISOString().split("T")[0]);
    setExpectedDeliveryDate("");
    setPoNotes("");
    setAutoReceiveStock(true);

    // Initialize with first product or reusable jar
    const defaultProduct = products.find((p) => p.is_reusable_jar) || products[0];
    if (defaultProduct) {
      setCreateItemRows([
        {
          product_id: defaultProduct.id,
          quantity_ordered: 50,
          unit_cost: Number(defaultProduct.cost_price || defaultProduct.default_sale_price || 100),
          gst_rate: Number(defaultProduct.gst_rate || 0),
        },
      ]);
    } else {
      setCreateItemRows([]);
    }

    setIsCreateModalOpen(true);
  };

  // Add line item to Create PO
  const handleAddCreateRow = () => {
    const selectedIds = new Set(createItemRows.map((r) => r.product_id));
    const nextProd = products.find((p) => !selectedIds.has(p.id)) || products[0];

    if (!nextProd) {
      addToast({
        type: "info",
        title: "All Products Added",
        message: "All active products have already been added as line items.",
      });
      return;
    }

    setCreateItemRows((prev) => [
      ...prev,
      {
        product_id: nextProd.id,
        quantity_ordered: 10,
        unit_cost: Number(nextProd.cost_price || nextProd.default_sale_price || 100),
        gst_rate: Number(nextProd.gst_rate || 0),
      },
    ]);
  };

  // Remove line item from Create PO
  const handleRemoveCreateRow = (index: number) => {
    if (createItemRows.length <= 1) {
      addToast({
        type: "info",
        title: "Minimum Item Required",
        message: "A purchase order must contain at least one line item.",
      });
      return;
    }
    setCreateItemRows((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Update line item product
  const handleCreateRowProductChange = (index: number, newProductId: string) => {
    const isDuplicate = createItemRows.some(
      (r, idx) => idx !== index && r.product_id === newProductId
    );
    if (isDuplicate) {
      addToast({
        type: "info",
        title: "Duplicate Product",
        message: "This product is already in the purchase order. Update its quantity instead.",
      });
      return;
    }

    const prod = products.find((p) => p.id === newProductId);
    if (!prod) return;

    setCreateItemRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== index) return r;
        return {
          ...r,
          product_id: prod.id,
          unit_cost: Number(prod.cost_price || prod.default_sale_price || 100),
          gst_rate: Number(prod.gst_rate || 0),
        };
      })
    );
  };

  // Live Totals for Create PO Modal
  const createSummary = React.useMemo(() => {
    let subtotal = 0;
    let taxTotal = 0;
    let totalUnits = 0;

    createItemRows.forEach((row) => {
      const lineSubtotal = row.quantity_ordered * row.unit_cost;
      const lineTax = (lineSubtotal * row.gst_rate) / 100;
      subtotal += lineSubtotal;
      taxTotal += lineTax;
      totalUnits += row.quantity_ordered;
    });

    const totalAmount = subtotal + taxTotal;

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
      totalUnits,
    };
  }, [createItemRows]);

  // Submit Create PO
  const handleSubmitCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId) {
      addToast({
        type: "error",
        title: "Validation Error",
        message: "Please select a supplier.",
      });
      return;
    }

    if (createItemRows.length === 0) {
      addToast({
        type: "error",
        title: "Validation Error",
        message: "Purchase order must contain at least one line item.",
      });
      return;
    }

    // Validation checks
    const productSet = new Set<string>();
    for (const row of createItemRows) {
      if (!row.product_id) {
        addToast({
          type: "error",
          title: "Validation Error",
          message: "All rows must have a valid product selected.",
        });
        return;
      }
      if (row.quantity_ordered <= 0) {
        addToast({
          type: "error",
          title: "Validation Error",
          message: "Quantity ordered must be greater than zero.",
        });
        return;
      }
      if (row.unit_cost < 0) {
        addToast({
          type: "error",
          title: "Validation Error",
          message: "Unit cost cannot be negative.",
        });
        return;
      }
      if (productSet.has(row.product_id)) {
        addToast({
          type: "error",
          title: "Validation Error",
          message: "Duplicate product line detected.",
        });
        return;
      }
      productSet.add(row.product_id);
    }

    setIsSubmittingPO(true);
    try {
      const itemsPayload = createItemRows.map((row) => {
        const prod = products.find((p) => p.id === row.product_id);
        const lineSubtotal = row.quantity_ordered * row.unit_cost;
        const lineTax = Math.round(((lineSubtotal * row.gst_rate) / 100) * 100) / 100;
        const lineTotal = Math.round((lineSubtotal + lineTax) * 100) / 100;

        return {
          product_id: row.product_id,
          product_name: prod?.name || "Product",
          quantity_ordered: row.quantity_ordered,
          quantity_received: 0,
          unit_cost: row.unit_cost,
          gst_rate: row.gst_rate,
          tax_rate: row.gst_rate,
          tax_amount: lineTax,
          total_cost: lineTotal,
          total_amount: lineTotal,
        };
      });

      const input: CreatePurchaseInput = {
        supplier_id: selectedSupplierId,
        po_number: poNumber.trim() || undefined,
        invoice_number: invoiceNumber.trim() || undefined,
        status: "ORDERED",
        auto_receive: autoReceiveStock,
        purchase_date: purchaseDate,
        expected_delivery_date: expectedDeliveryDate || undefined,
        notes: poNotes.trim() || undefined,
        items: itemsPayload,
      };

      const res = await createPurchase(input);

      if (!res.success || !res.data) {
        throw new Error(res.error || "Failed to create purchase order.");
      }

      addToast({
        type: "success",
        title: autoReceiveStock ? "Stock Added to Inventory (গুদামে স্টক জমা হয়েছে)" : "Purchase Order Created",
        message: autoReceiveStock
          ? `PO #${res.data.po_number} placed & ${createSummary.totalUnits} items directly added to warehouse stock!`
          : `PO #${res.data.po_number} successfully placed in ORDERED status.`,
      });

      setIsCreateModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "PO creation failed.";
      addToast({
        type: "error",
        title: "Purchase Order Failed",
        message: msg,
      });
    } finally {
      setIsSubmittingPO(false);
    }
  };

  // Open Receive Goods Modal
  const handleOpenReceiveModal = (p: PurchaseRecord) => {
    setPurchaseToReceive(p);
    const rows: ReceiveItemFormRow[] = p.items.map((item) => {
      const ordered = item.quantity_ordered;
      const alreadyReceived = item.quantity_received || 0;
      const outstanding = Math.max(0, ordered - alreadyReceived);
      return {
        product_id: item.product_id,
        product_name: item.product_name || "Product",
        quantity_ordered: ordered,
        quantity_already_received: alreadyReceived,
        quantity_outstanding: outstanding,
        quantity_to_receive: outstanding, // default to receive all remaining
      };
    });
    setReceiveRows(rows);
    setIsReceiveModalOpen(true);
  };

  // Submit Goods Receipt
  const handleSubmitReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseToReceive) return;

    // Filter items with quantity_to_receive > 0
    const itemsToReceive = receiveRows
      .filter((r) => r.quantity_to_receive > 0)
      .map((r) => ({
        product_id: r.product_id,
        quantity_received: r.quantity_to_receive,
      }));

    if (itemsToReceive.length === 0) {
      addToast({
        type: "error",
        title: "No Quantities Entered",
        message: "Please enter at least one positive quantity to receive.",
      });
      return;
    }

    // Ensure no quantity exceeds outstanding
    for (const r of receiveRows) {
      if (r.quantity_to_receive > r.quantity_outstanding) {
        addToast({
          type: "error",
          title: "Over-Receipt Exceeded",
          message: `Received quantity for ${r.product_name} exceeds remaining ordered quantity (${r.quantity_outstanding}).`,
        });
        return;
      }
    }

    setIsSubmittingReceipt(true);
    try {
      const res = await markPurchaseReceived({
        purchase_id: purchaseToReceive.id,
        items: itemsToReceive,
      });

      if (!res.success) {
        throw new Error(res.error || "Failed to receive goods.");
      }

      addToast({
        type: "success",
        title: "Goods Received & Stock Updated",
        message: `Recorded receipt of goods. Warehouse inventory and supplier payable liability updated.`,
      });

      setIsReceiveModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Goods receipt failed.";
      addToast({
        type: "error",
        title: "Receipt Failed",
        message: msg,
      });
    } finally {
      setIsSubmittingReceipt(false);
    }
  };

  // Open Pay Supplier Modal
  const handleOpenPaymentModal = (p: PurchaseRecord) => {
    setPurchaseToPay(p);
    setPaymentAmount(String(p.balance_due));
    setPaymentMethod("BANK_TRANSFER");
    setPaymentReference("");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPaymentNotes("");
    setIsPaymentModalOpen(true);
  };

  // Submit Supplier Payment
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseToPay) return;

    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      addToast({
        type: "error",
        title: "Invalid Amount",
        message: "Payment amount must be greater than zero.",
      });
      return;
    }

    if (amount > purchaseToPay.balance_due) {
      addToast({
        type: "error",
        title: "Amount Exceeds Payable",
        message: `Payment amount (${formatCurrency(amount)}) cannot exceed outstanding balance due (${formatCurrency(purchaseToPay.balance_due)}).`,
      });
      return;
    }

    setIsSubmittingPayment(true);
    try {
      const res = await recordSupplierPayment({
        supplier_id: purchaseToPay.supplier_id,
        purchase_id: purchaseToPay.id,
        amount,
        payment_method: paymentMethod,
        payment_date: paymentDate,
        reference_number: paymentReference.trim() || undefined,
        notes: paymentNotes.trim() || undefined,
      });

      if (!res.success) {
        throw new Error(res.error || "Failed to record payment.");
      }

      addToast({
        type: "success",
        title: "Supplier Payment Settled",
        message: `Recorded payment of ${formatCurrency(amount)} via ${paymentMethod}. Accounts payable balance reduced.`,
      });

      setIsPaymentModalOpen(false);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Payment submission failed.";
      addToast({
        type: "error",
        title: "Payment Failed",
        message: msg,
      });
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  // Open Details Modal
  const handleOpenDetailsModal = async (p: PurchaseRecord) => {
    setActivePurchaseDetails(p);
    setIsDetailsModalOpen(true);
    setIsLoadingPayments(true);
    try {
      const res = await getSupplierPayments({ purchaseId: p.id });
      if (res.success && res.data) {
        setPurchasePayments(res.data);
      } else {
        setPurchasePayments([]);
      }
    } catch {
      setPurchasePayments([]);
    } finally {
      setIsLoadingPayments(false);
    }
  };

  // Filtered Purchases
  const filteredPurchases = React.useMemo(() => {
    return purchases.filter((p) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        p.po_number.toLowerCase().includes(q) ||
        (p.invoice_number && p.invoice_number.toLowerCase().includes(q)) ||
        (p.supplier_name && p.supplier_name.toLowerCase().includes(q)) ||
        (p.notes && p.notes.toLowerCase().includes(q));

      const matchesStatus = statusFilter === "ALL" || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [purchases, searchQuery, statusFilter]);

  // Status Tab Counts
  const statusCounts = React.useMemo(() => {
    const counts: Record<string, number> = { ALL: purchases.length };
    purchases.forEach((p) => {
      counts[p.status] = (counts[p.status] || 0) + 1;
    });
    return counts;
  }, [purchases]);

  // Overall Financial KPIs
  const kpis = React.useMemo(() => {
    const totalProcurement = purchases.reduce((sum, p) => sum + p.total_amount, 0);
    const totalPaid = purchases.reduce((sum, p) => sum + p.amount_paid, 0);
    const totalPayables = purchases.reduce((sum, p) => sum + p.balance_due, 0);
    const pendingReceiptCount = purchases.filter(
      (p) => p.status === "ORDERED" || p.status === "PARTIALLY_RECEIVED"
    ).length;

    return {
      totalProcurement,
      totalPaid,
      totalPayables,
      pendingReceiptCount,
    };
  }, [purchases]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Supplier Procurement & Purchase Orders
            </h1>
            <Badge variant="primary" className="text-xs">
              Procurement & Inward Stock
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Procure wholesale water, jar assets, and accessories. Inventory increments strictly upon confirmed goods receipt.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={isLoading}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={handleOpenCreateModal}
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
          >
            <Plus className="h-4 w-4" />
            Create Purchase Order
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Total Procurement</span>
              <ShoppingBag className="h-4 w-4 text-primary shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-foreground">
              {formatCurrency(kpis.totalProcurement)}
            </div>
            <p className="text-[11px] text-muted-foreground">Invoiced purchases to date</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Payments Settled</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(kpis.totalPaid)}
            </div>
            <p className="text-[11px] text-muted-foreground">Cash, bank & UPI disbursements</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Supplier Payables (A/P)</span>
              <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-rose-600 dark:text-rose-400">
              {formatCurrency(kpis.totalPayables)}
            </div>
            <p className="text-[11px] text-muted-foreground">Outstanding liability balance</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs bg-card">
          <CardContent className="p-3.5 sm:p-4 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Pending Unloading</span>
              <Clock className="h-4 w-4 text-amber-500 shrink-0" />
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-amber-600 dark:text-amber-400">
              {kpis.pendingReceiptCount} Orders
            </div>
            <p className="text-[11px] text-muted-foreground">Awaiting warehouse receipt</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-nowrap pb-1 w-full sm:w-auto">
          {["ALL", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "DRAFT", "CANCELLED"].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 touch-manipulation min-h-[34px] ${
                statusFilter === st
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <span>{st.replace(/_/g, " ")}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  statusFilter === st
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-background text-muted-foreground"
                }`}
              >
                {statusCounts[st] || 0}
              </span>
            </button>
          ))}
        </div>

        <div className="w-full sm:w-72">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search PO #, supplier, invoice..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs h-9"
            />
          </div>
        </div>
      </div>

      {/* Purchases Data Table */}
      <Card className="border-border shadow-xs">
        <CardHeader className="p-5 pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Procurement Ledger & Inward Verification
          </CardTitle>
          <CardDescription className="text-xs">
            Purchase orders track commercial commitments. Inventory and Accounts Payable are recognized upon warehouse receipt.
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <LoadingState message="Loading procurement records and inward receipts..." />
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={loadData} />
          ) : filteredPurchases.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="No purchases found"
              description={
                searchQuery || statusFilter !== "ALL"
                  ? "No purchase orders matched your search or status filter."
                  : "No purchase orders recorded yet. Click 'Create Purchase Order' to begin."
              }
              actionLabel={searchQuery || statusFilter !== "ALL" ? "Clear Filters" : "Create Purchase Order"}
              onAction={() => {
                if (searchQuery || statusFilter !== "ALL") {
                  setSearchQuery("");
                  setStatusFilter("ALL");
                } else {
                  handleOpenCreateModal();
                }
              }}
            />
          ) : (
            <>
              {/* Mobile View: High-density Purchase Order Cards */}
              <div className="md:hidden divide-y divide-border/60">
                {filteredPurchases.map((p) => (
                  <div key={p.id} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-xs font-bold text-foreground">{p.po_number}</span>
                          {p.invoice_number && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              ({p.invoice_number})
                            </span>
                          )}
                        </div>
                        <h4 className="text-xs font-semibold text-foreground mt-0.5">{p.supplier_name || "Supplier"}</h4>
                        <span className="text-[10px] text-muted-foreground">{p.purchase_date}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-extrabold text-foreground block">
                          {formatCurrency(p.total_amount)}
                        </span>
                        {p.balance_due > 0 ? (
                          <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 block">
                            Due: {formatCurrency(p.balance_due)}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 block">
                            Paid in Full
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status Badges */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {p.status === "RECEIVED" ? (
                        <Badge variant="success" className="text-[9px] py-0">Stock Added</Badge>
                      ) : p.status === "PARTIALLY_RECEIVED" ? (
                        <Badge variant="primary" className="text-[9px] py-0">Partial Receipt</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] py-0 text-amber-500 border-amber-500/30">Pending Receipt</Badge>
                      )}
                      {p.balance_due <= 0 ? (
                        <Badge variant="outline" className="text-[9px] py-0 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">Settled</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] py-0 text-rose-500 border-rose-500/30">Unpaid</Badge>
                      )}
                    </div>

                    {/* Items Summary */}
                    <div className="bg-muted/30 p-2 rounded-lg text-[11px] space-y-0.5">
                      {p.items.map((i, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <span className="text-foreground">{i.product_name || "Product"}</span>
                          <span className="font-mono text-muted-foreground">
                            <strong className="text-primary">{i.quantity_received || 0}</strong>/{i.quantity_ordered}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/40">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpenDetailsModal(p)}
                        className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <Eye className="h-3 w-3" /> Details
                      </Button>
                      {(p.status === "ORDERED" || p.status === "PARTIALLY_RECEIVED") && (
                        <Button
                          size="sm"
                          onClick={() => handleOpenReceiveModal(p)}
                          className="h-7 px-2.5 text-[11px] gap-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                        >
                          <Boxes className="h-3 w-3" /> Receive
                        </Button>
                      )}
                      {p.balance_due > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenPaymentModal(p)}
                          className="h-7 px-2.5 text-[11px] gap-1 text-primary border-primary/30"
                        >
                          <CreditCard className="h-3 w-3" /> Pay
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop View: Full Data Table */}
              <div className="hidden md:block overflow-x-auto relative">
                <table className="w-full text-left text-xs min-w-[850px]">
                <thead className="bg-muted/40 text-muted-foreground border-y border-border">
                  <tr>
                    <th className="py-3 px-4 font-semibold">PO / Invoice #</th>
                    <th className="py-3 px-4 font-semibold">Supplier Name</th>
                    <th className="py-3 px-4 font-semibold">Purchase Date</th>
                    <th className="py-3 px-4 font-semibold text-right">Items & Receipt</th>
                    <th className="py-3 px-4 font-semibold text-right">Total Invoiced</th>
                    <th className="py-3 px-4 font-semibold text-right">Paid</th>
                    <th className="py-3 px-4 font-semibold text-right">Balance Due</th>
                    <th className="py-3 px-4 font-semibold text-center">Stock Status</th>
                    <th className="py-3 px-4 font-semibold text-center">Payment</th>
                    <th className="py-3 px-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredPurchases.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-mono font-bold text-foreground block">
                          {p.po_number}
                        </span>
                        {p.invoice_number && (
                          <span className="text-[10px] text-muted-foreground block">
                            Inv: {p.invoice_number}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-semibold text-foreground whitespace-nowrap">
                        {p.supplier_name || "Supplier"}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                        {p.purchase_date}
                      </td>
                      <td className="py-3 px-4 text-right max-w-xs">
                        <div className="space-y-0.5">
                          {p.items.map((i, idx) => (
                            <div key={idx} className="text-foreground text-[11px] font-medium">
                              <span className="text-primary font-bold">
                                {i.quantity_received || 0}/{i.quantity_ordered}
                              </span>{" "}
                              <span className="truncate">{i.product_name || "Product"}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-extrabold text-foreground whitespace-nowrap">
                        {formatCurrency(p.total_amount)}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {formatCurrency(p.amount_paid)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap">
                        {formatCurrency(p.balance_due)}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {p.status === "RECEIVED" ? (
                          <Badge variant="success" className="text-[10px] py-0">
                            Stock Added
                          </Badge>
                        ) : p.status === "PARTIALLY_RECEIVED" ? (
                          <Badge variant="primary" className="text-[10px] py-0">
                            Partial Receipt
                          </Badge>
                        ) : p.status === "ORDERED" ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 text-amber-500 border-amber-500/30"
                          >
                            Pending Receipt
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] py-0">
                            {p.status}
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        {p.payment_status === "PAID" ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 text-emerald-500 border-emerald-500/30 font-semibold"
                          >
                            Paid
                          </Badge>
                        ) : p.payment_status === "PARTIALLY_PAID" ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 text-amber-500 border-amber-500/30 font-semibold"
                          >
                            Partially Paid
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 text-rose-500 border-rose-500/30 font-semibold"
                          >
                            Unpaid
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenDetailsModal(p)}
                          className="h-7 px-2 text-[11px] gap-1"
                          title="View purchase details and payment history"
                        >
                          <Eye className="h-3 w-3" />
                          Details
                        </Button>

                        {(p.status === "ORDERED" || p.status === "PARTIALLY_RECEIVED") && (
                          <Button
                            size="sm"
                            onClick={() => handleOpenReceiveModal(p)}
                            className="h-7 px-2 text-[11px] gap-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                            title="Receive goods into warehouse inventory"
                          >
                            <Boxes className="h-3 w-3" />
                            Receive Goods
                          </Button>
                        )}

                        {p.balance_due > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenPaymentModal(p)}
                            className="h-7 px-2 text-[11px] gap-1 text-primary border-primary/30 hover:bg-primary/10"
                            title="Record supplier payment"
                          >
                            <CreditCard className="h-3 w-3" />
                            Pay
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL 1: Create Purchase Order Dialog                              */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        isOpen={isCreateModalOpen}
        onClose={() => !isSubmittingPO && setIsCreateModalOpen(false)}
        className="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-bold text-base text-foreground flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-primary" />
              Create Supplier Purchase Order
            </h3>
          </div>

          <form onSubmit={handleSubmitCreatePO} className="space-y-4">
            {/* Header Form Elements */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Select Supplier *
                </label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="">-- Choose Supplier --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.contact_person})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Purchase Date *
                </label>
                <Input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Expected Delivery Date
                </label>
                <Input
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  PO Number
                </label>
                <Input
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder="PO-YYYYMMDD-XXXX"
                  className="text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Supplier Invoice / Ref #
                </label>
                <Input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="e.g. INV-98214"
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Procurement Notes
                </label>
                <Input
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                  placeholder="e.g. Batch purity certification required"
                  className="text-xs"
                />
              </div>
            </div>

            {/* Line Items Section */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Package className="h-4 w-4 text-primary" />
                    Purchase Line Items ({createItemRows.length})
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    Specify wholesale products, water refills, jars, or accessories to procure.
                  </p>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddCreateRow}
                  className="h-7 text-xs gap-1 border-dashed"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Product
                </Button>
              </div>

              {/* Items Table */}
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-2 px-3 font-semibold w-5/12">Product</th>
                      <th className="py-2 px-3 font-semibold text-center w-2/12">Quantity</th>
                      <th className="py-2 px-3 font-semibold text-right w-2/12">Unit Cost (₹)</th>
                      <th className="py-2 px-3 font-semibold text-right w-2/12">Line Total</th>
                      <th className="py-2 px-2 text-center w-1/12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {createItemRows.map((row, idx) => {
                      const lineSubtotal = row.quantity_ordered * row.unit_cost;
                      const lineTax = (lineSubtotal * row.gst_rate) / 100;
                      const lineTotal = lineSubtotal + lineTax;

                      return (
                        <tr key={idx} className="hover:bg-muted/10">
                          <td className="p-2">
                            <select
                              value={row.product_id}
                              onChange={(e) => handleCreateRowProductChange(idx, e.target.value)}
                              className="w-full rounded-md border border-border bg-background p-1.5 text-xs text-foreground"
                            >
                              {products.map((p) => {
                                const isPickedElsewhere = createItemRows.some(
                                  (r, rIdx) => rIdx !== idx && r.product_id === p.id
                                );
                                return (
                                  <option key={p.id} value={p.id} disabled={isPickedElsewhere}>
                                    {p.name} ({p.sku}) {p.is_reusable_jar ? "— [20L Jar Asset]" : ""}
                                  </option>
                                );
                              })}
                            </select>
                          </td>

                          <td className="p-2 text-center">
                            <Input
                              type="number"
                              min={1}
                              step={1}
                              value={row.quantity_ordered}
                              onChange={(e) => {
                                const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                                setCreateItemRows((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, quantity_ordered: val } : r))
                                );
                              }}
                              className="h-8 text-xs text-center w-20 mx-auto"
                              required
                            />
                          </td>

                          <td className="p-2 text-right">
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={row.unit_cost}
                              onChange={(e) => {
                                const val = Math.max(0, parseFloat(e.target.value) || 0);
                                setCreateItemRows((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, unit_cost: val } : r))
                                );
                              }}
                              className="h-8 text-xs text-right w-24 ml-auto"
                              required
                            />
                            <span className="text-[10px] text-muted-foreground block mt-0.5">
                              GST: {row.gst_rate}%
                            </span>
                          </td>

                          <td className="p-2 text-right">
                            <span className="font-bold text-foreground block">
                              {formatCurrency(lineTotal)}
                            </span>
                            <span className="text-[10px] text-muted-foreground block">
                              Net: {formatCurrency(lineSubtotal)}
                            </span>
                          </td>

                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveCreateRow(idx)}
                              disabled={createItemRows.length <= 1}
                              className={`p-1 rounded-md transition-colors ${
                                createItemRows.length <= 1
                                  ? "text-muted-foreground/30 cursor-not-allowed"
                                  : "text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                              }`}
                              title="Remove item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Financial Totals Card */}
            <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Total Units Ordered:</span>
                <span className="font-bold text-foreground">{createSummary.totalUnits} units</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Subtotal (Net):</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(createSummary.subtotal)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>GST / Input Tax Credit:</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(createSummary.taxTotal)}
                </span>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-foreground pt-1.5 border-t border-border/80">
                <span>Grand Total (Payable Liability):</span>
                <span className="text-primary">{formatCurrency(createSummary.totalAmount)}</span>
              </div>
            </div>

            {/* Direct Inventory Stock Linkage Checkbox */}
            <label className="flex items-start gap-2.5 cursor-pointer p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs font-bold text-emerald-800 dark:text-emerald-300 transition-all hover:bg-emerald-500/15">
              <input
                type="checkbox"
                checked={autoReceiveStock}
                onChange={(e) => setAutoReceiveStock(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <div className="flex flex-col">
                <span className="font-bold">Add Directly to Warehouse Stock (সরাসরি গুদামে মাল জমা নিন)</span>
                <span className="text-[11px] font-normal text-emerald-700/90 dark:text-emerald-400/90 mt-0.5">
                  Purchased items (jars or packaged bottles) will immediately update available inventory without secondary receiving steps.
                </span>
              </div>
            </label>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={isSubmittingPO}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmittingPO || !selectedSupplierId || createItemRows.length === 0}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isSubmittingPO ? "Submitting..." : "Place Purchase Order"}
              </Button>
            </div>
          </form>
        </div>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL 2: Receive Goods Dialog                                      */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        isOpen={isReceiveModalOpen}
        onClose={() => !isSubmittingReceipt && setIsReceiveModalOpen(false)}
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-bold text-base text-foreground flex items-center gap-2">
              <Boxes className="h-5 w-5 text-blue-600" />
              Warehouse Goods Receipt & Inventory Inward
            </h3>
          </div>

          {purchaseToReceive && (
            <form onSubmit={handleSubmitReceipt} className="space-y-4">
              <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between text-foreground">
                  <span>
                    PO: <strong className="font-mono">{purchaseToReceive.po_number}</strong>
                  </span>
                  <span>
                    Supplier: <strong>{purchaseToReceive.supplier_name}</strong>
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed pt-1 border-t border-blue-500/10">
                  Inventory on hand is incremented <strong>only for the quantities confirmed below</strong>.
                  Incremental Accounts Payable liability will be posted for received goods.
                </p>
              </div>

              {/* Receipt Table */}
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-2 px-3 font-semibold w-5/12">Product</th>
                      <th className="py-2 px-2 font-semibold text-center w-2/12">Ordered</th>
                      <th className="py-2 px-2 font-semibold text-center w-2/12">Received</th>
                      <th className="py-2 px-2 font-semibold text-center w-3/12">Receive Now</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {receiveRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-muted/10">
                        <td className="p-2 font-medium text-foreground">
                          {row.product_name}
                        </td>
                        <td className="p-2 text-center text-muted-foreground">
                          {row.quantity_ordered}
                        </td>
                        <td className="p-2 text-center text-emerald-600 dark:text-emerald-400 font-semibold">
                          {row.quantity_already_received}
                        </td>
                        <td className="p-2 text-center">
                          <Input
                            type="number"
                            min={0}
                            max={row.quantity_outstanding}
                            step={1}
                            value={row.quantity_to_receive}
                            onChange={(e) => {
                              const val = Math.min(
                                row.quantity_outstanding,
                                Math.max(0, parseInt(e.target.value, 10) || 0)
                              );
                              setReceiveRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, quantity_to_receive: val } : r
                                )
                              );
                            }}
                            className="h-8 text-xs text-center w-24 mx-auto font-bold text-primary"
                          />
                          <span className="text-[10px] text-muted-foreground block mt-0.5">
                            Max: {row.quantity_outstanding} left
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-xs pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setReceiveRows((prev) =>
                      prev.map((r) => ({ ...r, quantity_to_receive: r.quantity_outstanding }))
                    );
                  }}
                  className="text-xs"
                >
                  Receive All Outstanding
                </Button>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsReceiveModalOpen(false)}
                    disabled={isSubmittingReceipt}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isSubmittingReceipt}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                  >
                    {isSubmittingReceipt ? "Receiving..." : "Confirm Goods Receipt"}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </div>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL 3: Pay Supplier Dialog                                       */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        isOpen={isPaymentModalOpen}
        onClose={() => !isSubmittingPayment && setIsPaymentModalOpen(false)}
        className="max-w-md"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-bold text-base text-foreground flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-emerald-600" />
              Record Supplier Payment
            </h3>
          </div>

          {purchaseToPay && (
            <form onSubmit={handleSubmitPayment} className="space-y-3">
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs space-y-1">
                <div className="flex justify-between text-foreground">
                  <span>Vendor:</span>
                  <strong>{purchaseToPay.supplier_name}</strong>
                </div>
                <div className="flex justify-between text-foreground">
                  <span>PO Number:</span>
                  <strong className="font-mono">{purchaseToPay.po_number}</strong>
                </div>
                <div className="flex justify-between text-foreground pt-1 border-t border-emerald-500/10">
                  <span>Outstanding Balance Due:</span>
                  <strong className="text-rose-600 dark:text-rose-400">
                    {formatCurrency(purchaseToPay.balance_due)}
                  </strong>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Payment Method *
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(e.target.value as "BANK_TRANSFER" | "UPI" | "CASH")
                  }
                  required
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="BANK_TRANSFER">Bank Transfer (NEFT / RTGS / IMPS)</option>
                  <option value="UPI">UPI / Digital Payment</option>
                  <option value="CASH">Cash Payment</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Payment Amount (₹) *
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min={1}
                  max={purchaseToPay.balance_due}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  required
                  className="text-xs font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Payment Date *
                  </label>
                  <Input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    UTR / Ref Number
                  </label>
                  <Input
                    placeholder="e.g. UTR-9823412"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Payment Notes
                </label>
                <Input
                  placeholder="e.g. Advance payment for batch delivery"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsPaymentModalOpen(false)}
                  disabled={isSubmittingPayment}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmittingPayment || !paymentAmount}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                >
                  {isSubmittingPayment ? "Posting..." : "Post Payment & Reduce Payable"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL 4: Purchase Details & Payment History Dialog                 */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        className="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-bold text-base text-foreground flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Purchase Order Details: {activePurchaseDetails?.po_number}
            </h3>
          </div>

          {activePurchaseDetails && (
            <div className="space-y-4 text-xs">
              {/* Header Details */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-muted/30 border border-border">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Supplier:</span>
                  <strong className="text-foreground">{activePurchaseDetails.supplier_name}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Purchase Date:</span>
                  <strong className="text-foreground">{activePurchaseDetails.purchase_date}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Stock Status:</span>
                  <Badge variant="outline" className="text-[10px] py-0 mt-0.5">
                    {activePurchaseDetails.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Payment Status:</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] py-0 mt-0.5 ${
                      activePurchaseDetails.payment_status === "PAID"
                        ? "text-emerald-500 border-emerald-500/30"
                        : "text-rose-500 border-rose-500/30"
                    }`}
                  >
                    {activePurchaseDetails.payment_status}
                  </Badge>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-1">
                <h4 className="font-bold text-foreground uppercase tracking-wider text-[11px]">
                  Ordered Line Items ({activePurchaseDetails.items.length})
                </h4>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                      <tr>
                        <th className="p-2 font-semibold">Product</th>
                        <th className="p-2 font-semibold text-center">Ordered</th>
                        <th className="p-2 font-semibold text-center">Received</th>
                        <th className="p-2 font-semibold text-right">Unit Cost</th>
                        <th className="p-2 font-semibold text-right">GST Rate</th>
                        <th className="p-2 font-semibold text-right">Line Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {activePurchaseDetails.items.map((i, idx) => (
                        <tr key={idx}>
                          <td className="p-2 font-medium text-foreground">
                            {i.product_name || "Product"}
                          </td>
                          <td className="p-2 text-center text-foreground font-bold">
                            {i.quantity_ordered}
                          </td>
                          <td className="p-2 text-center text-emerald-600 font-bold">
                            {i.quantity_received || 0}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {formatCurrency(i.unit_cost)}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {i.gst_rate || i.tax_rate || 0}%
                          </td>
                          <td className="p-2 text-right font-extrabold text-foreground">
                            {formatCurrency(i.total_cost || i.total_amount || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Summary */}
              <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal:</span>
                  <span className="font-semibold text-foreground">
                    {formatCurrency(activePurchaseDetails.subtotal)}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>GST / Tax:</span>
                  <span className="font-semibold text-foreground">
                    {formatCurrency(activePurchaseDetails.tax_total)}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Total Invoiced:</span>
                  <span className="font-bold text-foreground">
                    {formatCurrency(activePurchaseDetails.total_amount)}
                  </span>
                </div>
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Amount Settled:</span>
                  <span className="font-bold">{formatCurrency(activePurchaseDetails.amount_paid)}</span>
                </div>
                <div className="flex justify-between text-rose-600 dark:text-rose-400 font-extrabold pt-1 border-t border-border/60">
                  <span>Balance Due (A/P):</span>
                  <span>{formatCurrency(activePurchaseDetails.balance_due)}</span>
                </div>
              </div>

              {/* Payment History Section */}
              <div className="space-y-1 pt-1">
                <h4 className="font-bold text-foreground uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5 text-emerald-600" />
                  Supplier Payment History
                </h4>
                {isLoadingPayments ? (
                  <p className="text-muted-foreground text-center py-2">Loading payments...</p>
                ) : purchasePayments.length === 0 ? (
                  <p className="text-muted-foreground italic text-center py-2 border border-dashed border-border rounded-lg">
                    No payments posted against this purchase order yet.
                  </p>
                ) : (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                        <tr>
                          <th className="p-2 font-semibold">Payment #</th>
                          <th className="p-2 font-semibold">Date</th>
                          <th className="p-2 font-semibold">Method</th>
                          <th className="p-2 font-semibold">Reference</th>
                          <th className="p-2 font-semibold text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {purchasePayments.map((pmt) => (
                          <tr key={pmt.id}>
                            <td className="p-2 font-mono font-bold text-foreground">
                              {pmt.payment_number}
                            </td>
                            <td className="p-2 text-muted-foreground">{pmt.payment_date}</td>
                            <td className="p-2 text-muted-foreground">{pmt.payment_method}</td>
                            <td className="p-2 text-muted-foreground font-mono">
                              {pmt.reference_number || "—"}
                            </td>
                            <td className="p-2 text-right font-extrabold text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(pmt.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Details Actions */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDetailsModalOpen(false)}
                >
                  Close
                </Button>
                {(activePurchaseDetails.status === "ORDERED" ||
                  activePurchaseDetails.status === "PARTIALLY_RECEIVED") && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setIsDetailsModalOpen(false);
                      handleOpenReceiveModal(activePurchaseDetails);
                    }}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                  >
                    Receive Goods
                  </Button>
                )}
                {activePurchaseDetails.balance_due > 0 && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setIsDetailsModalOpen(false);
                      handleOpenPaymentModal(activePurchaseDetails);
                    }}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                  >
                    Record Payment
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
