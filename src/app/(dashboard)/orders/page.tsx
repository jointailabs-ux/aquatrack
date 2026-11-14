"use client";

import * as React from "react";
import Link from "next/link";
import {
  Plus,
  Minus,
  Search,
  Truck,
  ShoppingCart,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Ban,
  Package,
  Zap,
  Sparkles,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { getOrders, createOrder, cancelCustomerOrder } from "@/modules/orders/order.service";
import { OrderRecord, CreateOrderInput, OrderStatus } from "@/modules/orders/order.schema";
import { getStaffMembers } from "@/modules/staff/staff.service";
import { getCustomers, getCustomerSpecialPrices } from "@/modules/customers/customer.service";
import { getProducts } from "@/modules/products/product.service";
import { CustomerRecord } from "@/modules/customers/customer.schema";
import { StaffRecord } from "@/modules/staff/staff.schema";
import { ProductRecord } from "@/modules/products/product.schema";
import { formatCurrency } from "@/lib/utils";

interface OrderItemFormRow {
  product_id: string;
  quantity: number;
  unit_price: number;
  gst_rate: number;
}

// Module-level client cache for instant zero-latency transitions
let cachedOrdersState: {
  orders: OrderRecord[];
  customers: CustomerRecord[];
  staffList: StaffRecord[];
  products: ProductRecord[];
} | null = null;

export default function OrdersPage() {
  const { addToast } = useToast();

  // State with instant cache initialization
  const [orders, setOrders] = React.useState<OrderRecord[]>(() => cachedOrdersState?.orders || []);
  const [customers, setCustomers] = React.useState<CustomerRecord[]>(() => cachedOrdersState?.customers || []);
  const [staffList, setStaffList] = React.useState<StaffRecord[]>(() => cachedOrdersState?.staffList || []);
  const [products, setProducts] = React.useState<ProductRecord[]>(() => cachedOrdersState?.products || []);
  const [customerSpecialPrices, setCustomerSpecialPrices] = React.useState<Record<string, number>>({});

  const [isLoading, setIsLoading] = React.useState<boolean>(() => !cachedOrdersState);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");
  const [searchQuery, setSearchQuery] = React.useState("");

  // Create Order Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = React.useState("");
  const [assignedStaffId, setAssignedStaffId] = React.useState("");
  const [deliveryDate, setDeliveryDate] = React.useState(new Date().toISOString().split("T")[0]);
  const [deliveryAddress, setDeliveryAddress] = React.useState("");
  const [orderNotes, setOrderNotes] = React.useState("");
  const [itemRows, setItemRows] = React.useState<OrderItemFormRow[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Cancellation Modal State
  const [orderToCancel, setOrderToCancel] = React.useState<OrderRecord | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [isCancelling, setIsCancelling] = React.useState(false);

  // Load initial data
  const loadData = React.useCallback(async () => {
    if (!cachedOrdersState) {
      setIsLoading(true);
    }
    setLoadError(null);
    try {
      const [ordersRes, custRes, staffRes, prodRes] = await Promise.all([
        getOrders(),
        getCustomers({ pageSize: 100 }),
        getStaffMembers(),
        getProducts({ isActive: true, pageSize: 100 }),
      ]);

      if (!ordersRes.success) {
        throw new Error(ordersRes.error || "Failed to load orders.");
      }

      const freshOrders = ordersRes.data || [];
      const freshCustomers = custRes.success && custRes.data ? custRes.data.items : [];
      const freshStaff = staffRes.success && staffRes.data ? staffRes.data.filter((s) => s.role === "staff") : [];
      const freshProducts = prodRes.success && prodRes.data?.items ? prodRes.data.items.filter((p) => p.is_active) : [];

      setOrders(freshOrders);
      setCustomers(freshCustomers);
      setStaffList(freshStaff);
      setProducts(freshProducts);

      cachedOrdersState = {
        orders: freshOrders,
        customers: freshCustomers,
        staffList: freshStaff,
        products: freshProducts,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load dashboard data.";
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Customer Selection in Create Modal
  const handleCustomerChange = async (customerId: string) => {
    setSelectedCustomerId(customerId);
    const cust = customers.find((c) => c.id === customerId);
    if (cust) {
      setDeliveryAddress(cust.address || "");
    } else {
      setDeliveryAddress("");
    }

    if (customerId) {
      const priceRes = await getCustomerSpecialPrices(customerId);
      const specialMap = priceRes.success && priceRes.data ? priceRes.data : {};
      setCustomerSpecialPrices(specialMap);

      // Re-evaluate unit prices for existing item rows if customer has special pricing
      setItemRows((prev) =>
        prev.map((row) => {
          const prod = products.find((p) => p.id === row.product_id);
          const effectivePrice = specialMap[row.product_id] ?? (prod ? Number(prod.default_sale_price) : row.unit_price);
          return {
            ...row,
            unit_price: effectivePrice,
          };
        })
      );
    } else {
      setCustomerSpecialPrices({});
    }
  };

  // Open Create Order Modal with initial product row
  const openCreateModal = () => {
    setSelectedCustomerId("");
    setAssignedStaffId("");
    setDeliveryDate(new Date().toISOString().split("T")[0]);
    setDeliveryAddress("");
    setOrderNotes("");
    setCustomerSpecialPrices({});

    // Start with default reusable jar or first active product
    const defaultProd = products.find((p) => p.is_reusable_jar) || products[0];
    if (defaultProd) {
      setItemRows([
        {
          product_id: defaultProd.id,
          quantity: 2,
          unit_price: Number(defaultProd.default_sale_price),
          gst_rate: Number(defaultProd.gst_rate || 0),
        },
      ]);
    } else {
      setItemRows([]);
    }

    setIsCreateModalOpen(true);
  };

  // Check URL query parameter to auto-open create modal if navigated from Quick Action
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("new") === "true") {
        openCreateModal();
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length, customers.length]);

  // Apply quick jar bundle preset
  const applyJarBundle = (targetQty: number) => {
    const jarProd = products.find((p) => p.is_reusable_jar) || products[0];
    if (!jarProd) return;

    const price = customerSpecialPrices[jarProd.id] ?? Number(jarProd.default_sale_price);

    setItemRows([
      {
        product_id: jarProd.id,
        quantity: targetQty,
        unit_price: price,
        gst_rate: Number(jarProd.gst_rate || 0),
      },
    ]);
  };

  // Quick-add product chip
  const handleQuickAddProduct = (prod: ProductRecord) => {
    const existingIndex = itemRows.findIndex((r) => r.product_id === prod.id);
    if (existingIndex >= 0) {
      setItemRows((prev) =>
        prev.map((r, idx) =>
          idx === existingIndex ? { ...r, quantity: r.quantity + 1 } : r
        )
      );
    } else {
      const price = customerSpecialPrices[prod.id] ?? Number(prod.default_sale_price);
      setItemRows((prev) => [
        ...prev,
        {
          product_id: prod.id,
          quantity: 1,
          unit_price: price,
          gst_rate: Number(prod.gst_rate || 0),
        },
      ]);
    }
  };

  // Instant 1-tap template fill for rapid demo or daily regular orders
  const handleInstantSampleFill = () => {
    if (customers.length > 0) {
      handleCustomerChange(customers[0].id);
    }
    if (staffList.length > 0) {
      setAssignedStaffId(staffList[0].id);
    }
    setDeliveryDate(new Date().toISOString().split("T")[0]);
    applyJarBundle(10);
    addToast({
      type: "success",
      title: "Fast Template Applied",
      message: "Customer, driver, today's date, and 10 jars prefilled!",
    });
  };

  // Add a new product row
  const handleAddProductRow = () => {
    // Find first active product not already selected
    const selectedIds = new Set(itemRows.map((r) => r.product_id));
    const availableProd = products.find((p) => !selectedIds.has(p.id)) || products[0];

    if (!availableProd) {
      addToast({
        type: "info",
        title: "No More Products",
        message: "All active products have already been added to this order.",
      });
      return;
    }

    const price = customerSpecialPrices[availableProd.id] ?? Number(availableProd.default_sale_price);

    setItemRows((prev) => [
      ...prev,
      {
        product_id: availableProd.id,
        quantity: 1,
        unit_price: price,
        gst_rate: Number(availableProd.gst_rate || 0),
      },
    ]);
  };

  // Remove a product row
  const handleRemoveProductRow = (index: number) => {
    if (itemRows.length <= 1) {
      addToast({
        type: "info",
        title: "Minimum Product Required",
        message: "An order must contain at least one product item.",
      });
      return;
    }
    setItemRows((prev) => prev.filter((_, idx) => idx !== index));
  };

  // Change product in a row
  const handleRowProductChange = (index: number, newProductId: string) => {
    // Check if new product is already in another row
    const isDuplicate = itemRows.some((row, idx) => idx !== index && row.product_id === newProductId);
    if (isDuplicate) {
      addToast({
        type: "info",
        title: "Duplicate Product",
        message: "This product is already added. Please update its quantity instead.",
      });
      return;
    }

    const prod = products.find((p) => p.id === newProductId);
    if (!prod) return;

    const price = customerSpecialPrices[prod.id] ?? Number(prod.default_sale_price);

    setItemRows((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) return row;
        return {
          product_id: prod.id,
          quantity: row.quantity,
          unit_price: price,
          gst_rate: Number(prod.gst_rate || 0),
        };
      })
    );
  };

  // Change quantity in a row
  const handleRowQuantityChange = (index: number, qty: number) => {
    const validQty = Math.max(1, Math.floor(qty || 1));
    setItemRows((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, quantity: validQty } : row))
    );
  };

  // Change unit price in a row
  const handleRowPriceChange = (index: number, price: number) => {
    const validPrice = Math.max(0, price || 0);
    setItemRows((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, unit_price: validPrice } : row))
    );
  };

  // Calculated Order Totals
  const orderSummary = React.useMemo(() => {
    let subtotal = 0;
    let taxTotal = 0;
    let totalUnits = 0;

    itemRows.forEach((row) => {
      const lineSubtotal = row.quantity * row.unit_price;
      const lineTax = (lineSubtotal * row.gst_rate) / 100;
      subtotal += lineSubtotal;
      taxTotal += lineTax;
      totalUnits += row.quantity;
    });

    const totalAmount = subtotal + taxTotal;

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
      totalUnits,
    };
  }, [itemRows]);

  // Submit Order Creation
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) {
      addToast({
        type: "error",
        title: "Validation Error",
        message: "Please select a customer for this order.",
      });
      return;
    }

    if (itemRows.length === 0) {
      addToast({
        type: "error",
        title: "Validation Error",
        message: "Please add at least one product line item.",
      });
      return;
    }

    // Verify no zero or negative quantities or duplicate products
    const productSet = new Set<string>();
    for (const row of itemRows) {
      if (!row.product_id) {
        addToast({
          type: "error",
          title: "Validation Error",
          message: "All items must have a selected product.",
        });
        return;
      }
      if (row.quantity <= 0) {
        addToast({
          type: "error",
          title: "Validation Error",
          message: "Item quantity must be greater than zero.",
        });
        return;
      }
      if (row.unit_price < 0) {
        addToast({
          type: "error",
          title: "Validation Error",
          message: "Unit price cannot be negative.",
        });
        return;
      }
      if (productSet.has(row.product_id)) {
        addToast({
          type: "error",
          title: "Validation Error",
          message: "Duplicate product line detected. Combine quantities into a single row.",
        });
        return;
      }
      productSet.add(row.product_id);
    }

    setIsSubmitting(true);
    try {
      const cust = customers.find((c) => c.id === selectedCustomerId);

      const payloadItems = itemRows.map((row) => {
        const prod = products.find((p) => p.id === row.product_id);
        const lineSubtotal = row.quantity * row.unit_price;
        const lineTax = Math.round(((lineSubtotal * row.gst_rate) / 100) * 100) / 100;
        const lineTotal = Math.round((lineSubtotal + lineTax) * 100) / 100;

        return {
          product_id: row.product_id,
          product_name: prod?.name || "Product",
          quantity: row.quantity,
          unit_price: row.unit_price,
          gst_rate: row.gst_rate,
          tax_amount: lineTax,
          total_amount: lineTotal,
          is_reusable_jar: Boolean(prod?.is_reusable_jar),
        };
      });

      const input: CreateOrderInput = {
        customer_id: selectedCustomerId,
        assigned_staff_id: assignedStaffId || null,
        order_date: new Date().toISOString().split("T")[0],
        delivery_date: deliveryDate,
        delivery_address: deliveryAddress.trim() || cust?.address || "Customer Address",
        notes: orderNotes.trim() || null,
        items: payloadItems,
      };

      const res = await createOrder(input);

      if (!res.success || !res.data) {
        throw new Error(res.error || "Failed to create order.");
      }

      const createdOrder = res.data;
      if (cust) {
        createdOrder.customer_name = cust.business_name || cust.contact_name;
        createdOrder.customer_phone = cust.phone;
      }
      const staff = staffList.find((s) => s.id === assignedStaffId);
      if (staff) {
        createdOrder.assigned_staff_name = staff.full_name;
      }

      // Optimistic update: display new order immediately without blocking
      setOrders((prev) => [createdOrder, ...prev]);
      if (cachedOrdersState) {
        cachedOrdersState.orders = [createdOrder, ...cachedOrdersState.orders];
      }

      setIsCreateModalOpen(false);
      setIsSubmitting(false);

      addToast({
        type: "success",
        title: "Order Dispatched",
        message: `Order #${createdOrder.order_number} created successfully with ${payloadItems.length} line items.`,
      });

      // Background silent revalidation of orders list
      getOrders().then((freshRes) => {
        if (freshRes.success && freshRes.data) {
          setOrders(freshRes.data);
          if (cachedOrdersState) cachedOrdersState.orders = freshRes.data;
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Order creation failed.";
      addToast({
        type: "error",
        title: "Order Creation Failed",
        message: msg,
      });
      setIsSubmitting(false);
    }
  };

  // Handle Order Cancellation
  const handleConfirmCancelOrder = async () => {
    if (!orderToCancel) return;
    setIsCancelling(true);
    try {
      const res = await cancelCustomerOrder({
        order_id: orderToCancel.id,
        reason: cancelReason.trim() || "Cancelled via operations dashboard",
      });

      if (!res.success) {
        throw new Error(res.error || "Failed to cancel order.");
      }

      addToast({
        type: "success",
        title: "Order Cancelled",
        message: `Order #${orderToCancel.order_number} has been cancelled. Reserved inventory was released and accounting reversed.`,
      });

      setOrderToCancel(null);
      setCancelReason("");
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to cancel order.";
      addToast({
        type: "error",
        title: "Cancellation Failed",
        message: msg,
      });
    } finally {
      setIsCancelling(false);
    }
  };

  // Filtered Orders
  const filteredOrders = React.useMemo(() => {
    return orders.filter((o) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        o.order_number.toLowerCase().includes(q) ||
        (o.customer_name && o.customer_name.toLowerCase().includes(q)) ||
        (o.customer_phone && o.customer_phone.includes(q)) ||
        (o.delivery_address && o.delivery_address.toLowerCase().includes(q));

      const matchesStatus = statusFilter === "ALL" || o.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [orders, searchQuery, statusFilter]);

  // Status Tab Counts
  const statusCounts = React.useMemo(() => {
    const counts: Record<string, number> = { ALL: orders.length };
    orders.forEach((o) => {
      counts[o.status] = (counts[o.status] || 0) + 1;
    });
    return counts;
  }, [orders]);

  const canCancelOrder = (status: OrderStatus) => {
    return status !== "DELIVERED" && status !== "CANCELLED";
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Customer Orders & Route Dispatch
            </h1>
            <Badge variant="primary" className="text-xs">
              Delivery Operations
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Create multi-product refill orders, manage fleet dispatch, and monitor delivery reconciliation.
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
            onClick={openCreateModal}
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
          >
            <Plus className="h-4 w-4" />
            Create Order
          </Button>
        </div>
      </div>

      {/* Orders Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-nowrap sm:flex-wrap pb-1 sm:pb-0">
          {[
            "ALL",
            "PENDING",
            "ASSIGNED",
            "OUT_FOR_DELIVERY",
            "PARTIALLY_DELIVERED",
            "DELIVERED",
            "CANCELLED",
          ].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 touch-manipulation ${
                statusFilter === st
                  ? "bg-primary text-primary-foreground shadow-xs font-bold"
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
              placeholder="Search order #, customer, address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs h-9"
            />
          </div>
        </div>
      </div>

      {/* Orders List Content: Mobile Cards + Desktop Table */}
      {isLoading ? (
        <LoadingState message="Loading live orders and route dispatch status..." />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={loadData} />
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="No orders found"
          description={
            searchQuery || statusFilter !== "ALL"
              ? "No customer orders matched your search or status filter."
              : "No orders have been dispatched yet. Click 'Create Order' to start delivering."
          }
          actionLabel={searchQuery || statusFilter !== "ALL" ? "Clear Filters" : "Create Order"}
          onAction={() => {
            if (searchQuery || statusFilter !== "ALL") {
              setSearchQuery("");
              setStatusFilter("ALL");
            } else {
              openCreateModal();
            }
          }}
        />
      ) : (
        <>
          {/* Mobile Card View (md:hidden) */}
          <div className="space-y-3 md:hidden">
            {filteredOrders.map((o) => {
              const totalItems = o.items ? o.items.reduce((sum, it) => sum + it.quantity, 0) : 0;
              const isDelivered = o.status === "DELIVERED";
              const isCancelled = o.status === "CANCELLED";

              return (
                <div
                  key={o.id}
                  className="rounded-2xl border border-border/80 bg-card p-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] space-y-3 touch-manipulation"
                >
                  {/* Top Bar: Identifier + Status Badges + Price */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono font-bold text-xs text-foreground">
                        {o.order_number}
                      </span>
                      <Badge
                        variant={
                          isDelivered
                            ? "success"
                            : isCancelled
                            ? "destructive"
                            : o.status === "PENDING"
                            ? "warning"
                            : "secondary"
                        }
                        className="text-[9px] py-0 px-1.5"
                      >
                        {o.status.replace(/_/g, " ")}
                      </Badge>
                      <Badge
                        variant={o.payment_status === "PAID" ? "success" : "outline"}
                        className="text-[9px] py-0 px-1.5"
                      >
                        {o.payment_status}
                      </Badge>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="font-black text-sm text-primary block">
                        {formatCurrency(o.total_amount)}
                      </span>
                    </div>
                  </div>

                  {/* Customer & Route */}
                  <div>
                    <h4 className="font-bold text-sm text-foreground leading-snug">
                      {o.customer_name || "Customer"}
                    </h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {o.delivery_date} • {o.delivery_address}
                    </p>
                  </div>

                  {/* Operational Summary Grid */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/50 text-xs">
                    <div>
                      <span className="text-[10px] text-muted-foreground font-medium block">
                        Assigned Driver
                      </span>
                      <span className="font-semibold text-foreground truncate block">
                        {o.assigned_staff_name ? (
                          <span className="inline-flex items-center gap-1">
                            <Truck className="h-3 w-3 text-primary shrink-0" />
                            {o.assigned_staff_name}
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 font-medium">
                            Unassigned
                          </span>
                        )}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-muted-foreground font-medium block">
                        Products ({totalItems} units)
                      </span>
                      <span className="font-semibold text-foreground truncate block">
                        {o.items && o.items.length > 0
                          ? o.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")
                          : "No items"}
                      </span>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      Tel: {o.customer_phone || "N/A"}
                    </span>

                    <div className="flex items-center gap-2">
                      {canCancelOrder(o.status) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setOrderToCancel(o);
                            setCancelReason("");
                          }}
                          className="h-7 text-[11px] px-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                        >
                          <Ban className="h-3 w-3 mr-1" />
                          Cancel
                        </Button>
                      )}
                      <Link href="/deliveries">
                        <Button
                          variant="primary"
                          size="sm"
                          className="h-7 text-[11px] px-2.5 font-semibold"
                        >
                          Route Stop
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table View (hidden md:block) */}
          <Card className="border-border shadow-xs hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Order #</th>
                      <th className="py-3 px-4 font-semibold">Customer</th>
                      <th className="py-3 px-4 font-semibold">Delivery Date & Route</th>
                      <th className="py-3 px-4 font-semibold">Assigned Staff</th>
                      <th className="py-3 px-4 font-semibold">Products Ordered</th>
                      <th className="py-3 px-4 font-semibold text-right">Invoiced Total</th>
                      <th className="py-3 px-4 font-semibold text-center">Delivery Status</th>
                      <th className="py-3 px-4 font-semibold text-center">Payment</th>
                      <th className="py-3 px-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-foreground whitespace-nowrap">
                          {o.order_number}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-bold text-foreground block">
                            {o.customer_name || "Customer"}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{o.customer_phone}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-semibold text-foreground block">{o.delivery_date}</span>
                          <span
                            className="text-[11px] text-muted-foreground truncate block max-w-xs"
                            title={o.delivery_address}
                          >
                            {o.delivery_address}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {o.assigned_staff_name ? (
                            <span className="font-medium text-foreground flex items-center gap-1.5">
                              <Truck className="h-3.5 w-3.5 text-primary" />
                              {o.assigned_staff_name}
                            </span>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 text-amber-500 border-amber-500/30"
                            >
                              Unassigned
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 max-w-xs">
                          <div className="space-y-0.5">
                            {o.items && o.items.length > 0 ? (
                              o.items.map((i, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center gap-1.5 text-[11px] text-foreground font-medium"
                                >
                                  <span className="inline-block w-6 text-right font-bold text-primary">
                                    {i.quantity}×
                                  </span>
                                  <span className="truncate">{i.product_name}</span>
                                </div>
                              ))
                            ) : (
                              <span className="text-muted-foreground italic">No item details</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-extrabold text-foreground whitespace-nowrap">
                          {formatCurrency(o.total_amount)}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {o.status === "DELIVERED" ? (
                            <Badge variant="success" className="text-[10px] py-0">
                              Delivered
                            </Badge>
                          ) : o.status === "PARTIALLY_DELIVERED" ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 text-amber-500 border-amber-500/30"
                            >
                              Partially Delivered
                            </Badge>
                          ) : o.status === "OUT_FOR_DELIVERY" ? (
                            <Badge variant="primary" className="text-[10px] py-0">
                              Out on Route
                            </Badge>
                          ) : o.status === "ASSIGNED" ? (
                            <Badge variant="secondary" className="text-[10px] py-0">
                              Assigned
                            </Badge>
                          ) : o.status === "CANCELLED" ? (
                            <Badge variant="destructive" className="text-[10px] py-0">
                              Cancelled
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] py-0">
                              Pending
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {o.payment_status === "PAID" ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] py-0 text-emerald-500 border-emerald-500/30 font-semibold"
                            >
                              Paid
                            </Badge>
                          ) : o.payment_status === "PARTIALLY_PAID" ? (
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
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {canCancelOrder(o.status) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setOrderToCancel(o);
                                setCancelReason("");
                              }}
                              className="h-7 px-2 text-[11px] gap-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 border-rose-200 dark:border-rose-900/40"
                            >
                              <Ban className="h-3 w-3" />
                              Cancel
                            </Button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Multi-Product Create Order Dialog */}
      <Dialog
        isOpen={isCreateModalOpen}
        onClose={() => !isSubmitting && setIsCreateModalOpen(false)}
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-bold text-base text-foreground flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" />
              Place Multi-Product Customer Order
            </h3>
            <button
              type="button"
              onClick={handleInstantSampleFill}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 active:scale-95 transition-all cursor-pointer"
              title="Prepopulates customer, driver, today's date, and 10 jars instantly"
            >
              <Zap className="h-3.5 w-3.5 text-amber-600 fill-amber-500" />
              <span>⚡ 1-Click Fast Fill</span>
            </button>
          </div>

          <form onSubmit={handleCreateOrder} className="space-y-4">
            {/* Customer Quick Select Chips */}
            {customers.length > 0 && (
              <div className="p-2.5 rounded-xl bg-muted/40 border border-border/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    Frequent Customers (Tap to Select)
                  </span>
                  <span className="text-[10px] text-muted-foreground">Auto-fills address & contract prices</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {customers.slice(0, 5).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleCustomerChange(c.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all active:scale-95 cursor-pointer ${
                        selectedCustomerId === c.id
                          ? "bg-primary text-primary-foreground border-primary shadow-xs"
                          : "bg-background text-foreground border-border hover:border-primary/50 hover:bg-primary/5"
                      }`}
                    >
                      {c.contact_name} {c.business_name ? `(${c.business_name})` : ""}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Customer & Route Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Select Customer Account *
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => handleCustomerChange(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="">-- Choose Customer Account --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contact_name} {c.business_name ? `(${c.business_name})` : ""} — {c.phone}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Assign Delivery Staff (Optional)
                </label>
                <select
                  value={assignedStaffId}
                  onChange={(e) => setAssignedStaffId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="">-- Unassigned (Fleet Pool) --</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    Delivery Target Date *
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setDeliveryDate(new Date().toISOString().split("T")[0])}
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground cursor-pointer"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        setDeliveryDate(d.toISOString().split("T")[0]);
                      }}
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground cursor-pointer"
                    >
                      Tomorrow
                    </button>
                  </div>
                </div>
                <Input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Delivery Address *
                </label>
                <Input
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  required
                  placeholder="Street address, floor, flat/unit #"
                  className="text-xs"
                />
              </div>
            </div>

            {/* 1-Click Speed Bundles & Quick Products */}
            <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-sky-950 dark:text-sky-200 flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-sky-600 dark:text-sky-400 fill-sky-500/30" />
                  1-Click Speed Bundles (Zero Typing)
                </span>
                <span className="text-[10px] text-sky-700 dark:text-sky-300">Click to set quantity</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {[5, 10, 25, 50, 100].map((qty) => (
                  <button
                    key={qty}
                    type="button"
                    onClick={() => applyJarBundle(qty)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-card text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-800 hover:border-primary hover:bg-primary hover:text-white shadow-xs active:scale-95 transition-all cursor-pointer"
                  >
                    💧 {qty} Jars
                  </button>
                ))}
              </div>

              {/* Quick-Add Product Chips */}
              {products.length > 1 && (
                <div className="pt-2 border-t border-sky-500/20 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-bold text-sky-800 dark:text-sky-300 uppercase">
                    Add Items:
                  </span>
                  {products.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleQuickAddProduct(p)}
                      className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-card hover:bg-primary hover:text-white text-foreground border border-border transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Line Items Section */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Package className="h-4 w-4 text-primary" />
                    Product Line Items ({itemRows.length})
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    Products and jar quantities for this route delivery.
                  </p>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddProductRow}
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
                      <th className="py-2 px-3 font-semibold w-4/12">Product</th>
                      <th className="py-2 px-3 font-semibold text-center w-3/12">Qty & Quick Add</th>
                      <th className="py-2 px-3 font-semibold text-right w-2/12">Unit Price</th>
                      <th className="py-2 px-3 font-semibold text-right w-2/12">Subtotal</th>
                      <th className="py-2 px-2 text-center w-1/12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {itemRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-muted-foreground italic">
                          No products added. Click &quot;Add Product&quot; to begin.
                        </td>
                      </tr>
                    ) : (
                      itemRows.map((row, idx) => {
                        const lineSubtotal = row.quantity * row.unit_price;
                        const lineTax = (lineSubtotal * row.gst_rate) / 100;
                        const hasSpecialPrice = Boolean(customerSpecialPrices[row.product_id]);

                        return (
                          <tr key={idx} className="hover:bg-muted/10">
                            <td className="p-2">
                              <select
                                value={row.product_id}
                                onChange={(e) => handleRowProductChange(idx, e.target.value)}
                                className="w-full rounded-md border border-border bg-background p-1.5 text-xs text-foreground"
                              >
                                {products.map((p) => {
                                  const isPickedElsewhere = itemRows.some(
                                    (r, rIdx) => rIdx !== idx && r.product_id === p.id
                                  );
                                  return (
                                    <option key={p.id} value={p.id} disabled={isPickedElsewhere}>
                                      {p.name} ({p.sku}) {p.is_reusable_jar ? "— [20L Jar]" : ""}
                                    </option>
                                  );
                                })}
                              </select>
                              {hasSpecialPrice && (
                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium block mt-0.5">
                                  ★ Special customer contract price applied
                                </span>
                              )}
                            </td>

                            <td className="p-2 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleRowQuantityChange(idx, Math.max(1, row.quantity - 1))}
                                    disabled={row.quantity <= 1}
                                    className="h-7 w-7 rounded bg-muted hover:bg-muted/80 text-foreground flex items-center justify-center font-bold text-xs disabled:opacity-30 cursor-pointer"
                                  >
                                    -
                                  </button>
                                  <Input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={row.quantity}
                                    onChange={(e) =>
                                      handleRowQuantityChange(idx, parseInt(e.target.value, 10))
                                    }
                                    className="h-7 text-xs text-center w-14 font-bold"
                                    required
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleRowQuantityChange(idx, row.quantity + 1)}
                                    className="h-7 w-7 rounded bg-muted hover:bg-muted/80 text-foreground flex items-center justify-center font-bold text-xs cursor-pointer"
                                  >
                                    +
                                  </button>
                                </div>
                                <div className="flex items-center gap-1">
                                  {[5, 10, 25].map((add) => (
                                    <button
                                      key={add}
                                      type="button"
                                      onClick={() => handleRowQuantityChange(idx, row.quantity + add)}
                                      className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted/70 hover:bg-primary hover:text-white text-muted-foreground transition-colors cursor-pointer"
                                    >
                                      +{add}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </td>

                            <td className="p-2 text-right">
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={row.unit_price}
                                onChange={(e) =>
                                  handleRowPriceChange(idx, parseFloat(e.target.value))
                                }
                                className="h-8 text-xs text-right w-20 ml-auto"
                                required
                              />
                              <span className="text-[10px] text-muted-foreground block mt-0.5">
                                GST: {row.gst_rate}%
                              </span>
                            </td>

                            <td className="p-2 text-right">
                              <span className="font-bold text-foreground block">
                                {formatCurrency(lineSubtotal)}
                              </span>
                              <span className="text-[10px] text-muted-foreground block">
                                +{formatCurrency(lineTax)} tax
                              </span>
                            </td>

                            <td className="p-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveProductRow(idx)}
                                disabled={itemRows.length <= 1}
                                className={`p-1 rounded-md transition-colors ${
                                  itemRows.length <= 1
                                    ? "text-muted-foreground/30 cursor-not-allowed"
                                    : "text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                                }`}
                                title="Remove line item"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Order / Delivery Instructions */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">
                Delivery Instructions / Gate Notes
              </label>
              <Input
                placeholder="e.g. Ring bell at 2nd floor, empty jars kept near gate"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                className="text-xs"
              />
            </div>

            {/* Order Totals Summary Card */}
            <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Total Ordered Units:</span>
                <span className="font-bold text-foreground">{orderSummary.totalUnits} units</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Subtotal (Net):</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(orderSummary.subtotal)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>GST / Tax Total:</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(orderSummary.taxTotal)}
                </span>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-foreground pt-1.5 border-t border-border/80">
                <span>Grand Total (Invoiced):</span>
                <span className="text-primary">{formatCurrency(orderSummary.totalAmount)}</span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting || !selectedCustomerId || itemRows.length === 0}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isSubmitting ? "Dispatching..." : "Confirm & Dispatch Order"}
              </Button>
            </div>
          </form>
        </div>
      </Dialog>

      {/* Cancellation Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(orderToCancel)}
        onClose={() => !isCancelling && setOrderToCancel(null)}
        onConfirm={handleConfirmCancelOrder}
        title="Cancel Customer Order"
        description=""
        confirmLabel={isCancelling ? "Cancelling..." : "Confirm Order Cancellation"}
        cancelLabel="Keep Order"
        variant="destructive"
        isLoading={isCancelling}
      >
        {orderToCancel && (
          <div className="space-y-3 mt-2 text-xs">
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-foreground space-y-1">
              <div className="font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Inventory & Accounting Impact Notice
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Cancelling order <strong className="text-foreground">#{orderToCancel.order_number}</strong> for{" "}
                <strong className="text-foreground">{orderToCancel.customer_name}</strong> will:
              </p>
              <ul className="list-disc pl-4 text-muted-foreground text-[11px] space-y-0.5">
                <li>
                  Atomically release all undelivered reserved inventory items back to active warehouse
                  stock.
                </li>
                <li>
                  Cancel unexecuted delivery stops and invalidate associated route manifests.
                </li>
                <li>
                  Generate audited double-entry General Ledger reversals for uncollected A/R balance.
                </li>
              </ul>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">
                Cancellation Reason (Optional)
              </label>
              <Input
                placeholder="e.g. Customer cancelled via phone call, wrong address"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
