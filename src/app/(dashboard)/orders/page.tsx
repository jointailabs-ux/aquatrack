"use client";

import * as React from "react";
import {
  Plus,
  Minus,
  Search,
  ShoppingCart,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Ban,
  Package,
  Zap,
  CheckCircle2,
  UserCheck,
  Truck,
  Store,
  Receipt,
  Users,
  MapPin,
  DollarSign,
  X,
  Droplets,
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
import {
  getOrders,
  createOrder,
  cancelCustomerOrder,
  executeDeliveryStop,
  assignOrderStaff,
} from "@/modules/orders/order.service";
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

const ORDERS_STORAGE_KEY = "aquatrack_orders_cache_v2";
const ORDERS_CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL for zero-latency instant transitions

// Module-level client cache for instant zero-latency transitions
let cachedOrdersState: {
  orders: OrderRecord[];
  customers: CustomerRecord[];
  staffList: StaffRecord[];
  products: ProductRecord[];
  timestamp: number;
} | null = null;

function getInitialOrdersData() {
  if (cachedOrdersState && cachedOrdersState.orders.length > 0) {
    return cachedOrdersState;
  }
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(ORDERS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed?.orders)) {
          cachedOrdersState = parsed;
          return parsed;
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }
  return { orders: [], customers: [], staffList: [], products: [] };
}

export default function OrdersPage() {
  const { addToast } = useToast();

  const initialData = React.useMemo(() => getInitialOrdersData(), []);

  // State with instant cache initialization
  const [orders, setOrders] = React.useState<OrderRecord[]>(() => initialData.orders || []);
  const [customers, setCustomers] = React.useState<CustomerRecord[]>(() => initialData.customers || []);
  const [staffList, setStaffList] = React.useState<StaffRecord[]>(() => initialData.staffList || []);
  const [products, setProducts] = React.useState<ProductRecord[]>(() => initialData.products || []);
  const [customerSpecialPrices, setCustomerSpecialPrices] = React.useState<Record<string, number>>({});

  const [isLoading, setIsLoading] = React.useState<boolean>(() => initialData.orders.length === 0);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");
  const [searchQuery, setSearchQuery] = React.useState("");

  // Create Order Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = React.useState("");
  const [assignedStaffId, setAssignedStaffId] = React.useState("");
  const [isSelfPickup, setIsSelfPickup] = React.useState(false);
  const [deliveryDate, setDeliveryDate] = React.useState(new Date().toISOString().split("T")[0]);
  const [deliveryAddress, setDeliveryAddress] = React.useState("");
  const [orderNotes, setOrderNotes] = React.useState("");
  const [itemRows, setItemRows] = React.useState<OrderItemFormRow[]>([]);
  const [orderCatalogCategory, setOrderCatalogCategory] = React.useState<string>("ALL");
  const [orderCatalogSearch, setOrderCatalogSearch] = React.useState<string>("");
  const [customerSearch, setCustomerSearch] = React.useState<string>("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Cancellation Modal State
  const [orderToCancel, setOrderToCancel] = React.useState<OrderRecord | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const [isCancelling, setIsCancelling] = React.useState(false);

  // Direct Delivery Modal State
  const [orderToDeliver, setOrderToDeliver] = React.useState<OrderRecord | null>(null);
  const [deliverStaffId, setDeliverStaffId] = React.useState<string>("");
  const [deliverQty, setDeliverQty] = React.useState<number>(1);
  const [emptyCollected, setEmptyCollected] = React.useState<number>(0);
  const [amountCollected, setAmountCollected] = React.useState<number>(0);
  const [paymentMethod, setPaymentMethod] = React.useState<"CASH" | "UPI" | "CREDIT">("CASH");
  const [deliveryNotes, setDeliveryNotes] = React.useState<string>("");
  const [isDelivering, setIsDelivering] = React.useState(false);

  // Quick Staff Reassignment Modal State
  const [orderToReassign, setOrderToReassign] = React.useState<OrderRecord | null>(null);
  const [isReassigning, setIsReassigning] = React.useState(false);

  // Load initial data
  const loadData = React.useCallback(async (forceRefresh = false) => {
    const now = Date.now();
    const hasFreshCache =
      !forceRefresh &&
      cachedOrdersState &&
      cachedOrdersState.orders.length > 0 &&
      now - (cachedOrdersState.timestamp || 0) < ORDERS_CACHE_TTL_MS;

    if (hasFreshCache) {
      return;
    }

    if (!cachedOrdersState || cachedOrdersState.orders.length === 0) {
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
      const freshStaff = staffRes.success && staffRes.data ? staffRes.data.filter((s) => s.is_active !== false) : [];
      const freshProducts = prodRes.success && prodRes.data?.items ? prodRes.data.items.filter((p) => p.is_active) : [];

      setOrders(freshOrders);
      setCustomers(freshCustomers);
      setStaffList(freshStaff);
      setProducts(freshProducts);

      const freshState = {
        orders: freshOrders,
        customers: freshCustomers,
        staffList: freshStaff,
        products: freshProducts,
        timestamp: Date.now(),
      };
      cachedOrdersState = freshState;

      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(freshState));
        } catch {
          // Ignore quota errors
        }
      }
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
    setIsSelfPickup(false);
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

  // Apply quick jar bundle preset (1, 2, 5, 10, 15, 20, 25, 50 jars)
  const applyJarBundle = (targetQty: number) => {
    const jarProd = products.find((p) => p.is_reusable_jar) || products[0];
    if (!jarProd) return;

    const price = customerSpecialPrices[jarProd.id] ?? Number(jarProd.default_sale_price);

    setItemRows((prev) => {
      const idx = prev.findIndex((r) => r.product_id === jarProd.id);
      if (idx >= 0) {
        return prev.map((r, i) => (i === idx ? { ...r, quantity: targetQty, unit_price: price } : r));
      }
      return [
        ...prev,
        {
          product_id: jarProd.id,
          quantity: targetQty,
          unit_price: price,
          gst_rate: Number(jarProd.gst_rate || 0),
        },
      ];
    });
  };


  // POS Stepper & Cart helpers
  const getProductQty = (productId: string): number => {
    const row = itemRows.find((r) => r.product_id === productId);
    return row ? row.quantity : 0;
  };

  const updateProductQty = (prod: ProductRecord, newQty: number) => {
    const price = customerSpecialPrices[prod.id] ?? Number(prod.default_sale_price);
    if (newQty <= 0) {
      setItemRows((prev) => prev.filter((r) => r.product_id !== prod.id));
    } else {
      setItemRows((prev) => {
        const idx = prev.findIndex((r) => r.product_id === prod.id);
        if (idx >= 0) {
          return prev.map((r, i) => (i === idx ? { ...r, quantity: newQty, unit_price: price } : r));
        }
        return [
          ...prev,
          {
            product_id: prod.id,
            quantity: newQty,
            unit_price: price,
            gst_rate: Number(prod.gst_rate || 0),
          },
        ];
      });
    }
  };

  const addProductQtyDelta = (prod: ProductRecord, delta: number) => {
    const current = getProductQty(prod.id);
    updateProductQty(prod, Math.max(0, current + delta));
  };

  const selectedCustomer = React.useMemo(
    () => customers.find((c) => c.id === selectedCustomerId),
    [customers, selectedCustomerId]
  );

  const filteredCustomers = React.useMemo(() => {
    if (!customerSearch.trim()) return customers;
    const q = customerSearch.toLowerCase().trim();
    return customers.filter(
      (c) =>
        c.contact_name.toLowerCase().includes(q) ||
        (c.business_name && c.business_name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q))
    );
  }, [customers, customerSearch]);

  const filteredCatalogProducts = React.useMemo(() => {
    return products.filter((p) => {
      const matchesCategory =
        orderCatalogCategory === "ALL" ||
        (orderCatalogCategory === "JARS" && p.is_reusable_jar) ||
        (orderCatalogCategory === "BOTTLES" &&
          !p.is_reusable_jar &&
          (p.category === "PACKAGED_WATER" || p.name.toLowerCase().includes("bottle"))) ||
        (orderCatalogCategory === "DISPENSERS" &&
          (p.category === "DISPENSER_EQUIPMENT" || p.name.toLowerCase().includes("dispenser"))) ||
        (orderCatalogCategory === "ACCESSORIES" &&
          (p.category === "CONSUMABLE" || (!p.is_reusable_jar && p.category !== "PACKAGED_WATER")));

      const q = orderCatalogSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q));

      return matchesCategory && matchesSearch;
    });
  }, [products, orderCatalogCategory, orderCatalogSearch]);

  const getProductEmoji = (p: ProductRecord) => {
    if (p.is_reusable_jar) return "💧";
    const name = p.name.toLowerCase();
    const cat = (p.category || "").toUpperCase();
    if (cat === "PACKAGED_WATER" || name.includes("bottle")) return "🍾";
    if (cat === "DISPENSERS" || name.includes("dispenser") || name.includes("tap")) return "🚰";
    return "📦";
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

  // Remove a product row from cart
  const handleRemoveProductRow = (index: number) => {
    setItemRows((prev) => prev.filter((_, idx) => idx !== index));
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
        assigned_staff_id: isSelfPickup ? null : (assignedStaffId || null),
        order_date: new Date().toISOString().split("T")[0],
        delivery_date: deliveryDate,
        delivery_address: isSelfPickup
          ? "Store Counter Pickup (গ্রাহক নিজে সংগ্রহ করবেন)"
          : (deliveryAddress.trim() || cust?.address || "Customer Address"),
        notes: (isSelfPickup ? "[SELF-PICKUP] " : "") + (orderNotes.trim() || ""),
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
      await loadData(true);
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

  // Direct Delivery Modal Handlers
  const openDeliverModal = (order: OrderRecord) => {
    setOrderToDeliver(order);
    setDeliverStaffId(order.assigned_staff_id || (staffList.length > 0 ? staffList[0].id : ""));

    const hasReusableJars = Boolean(order.items && order.items.some((i) => i.is_reusable_jar));
    const jarQty = order.items
      ? order.items.filter((i) => i.is_reusable_jar).reduce((sum, i) => sum + i.quantity, 0)
      : 0;
    const totalUnits = order.items && order.items.length > 0
      ? order.items.reduce((sum, i) => sum + i.quantity, 0)
      : 1;

    setDeliverQty(hasReusableJars ? jarQty : totalUnits);
    setEmptyCollected(hasReusableJars ? jarQty : 0);
    setAmountCollected(Number(order.total_amount || 0));
    setPaymentMethod("CASH");
    setDeliveryNotes("");
  };

  const handleConfirmDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderToDeliver) return;

    const hasReusableJars = Boolean(orderToDeliver.items && orderToDeliver.items.some((i) => i.is_reusable_jar));
    const jarsDelivered = hasReusableJars ? deliverQty : 0;
    const customerHolding = orderToDeliver.customer_jars_holding ?? 0;
    const jarsCollected = hasReusableJars || customerHolding > 0 ? emptyCollected : 0;

    if (hasReusableJars && deliverQty < 0) {
      addToast({
        type: "error",
        title: "Invalid Quantity",
        message: "Delivered jars quantity cannot be negative.",
      });
      return;
    }

    if (emptyCollected < 0) {
      addToast({
        type: "error",
        title: "Invalid Quantity",
        message: "Collected empty jars count cannot be negative.",
      });
      return;
    }

    if (amountCollected < 0) {
      addToast({
        type: "error",
        title: "Invalid Amount",
        message: "Payment collection amount cannot be negative.",
      });
      return;
    }

    setIsDelivering(true);
    try {
      // Reassign staff if changed in delivery modal
      if (deliverStaffId && deliverStaffId !== orderToDeliver.assigned_staff_id) {
        await assignOrderStaff(orderToDeliver.id, deliverStaffId);
      }

      const res = await executeDeliveryStop({
        order_id: orderToDeliver.id,
        actual_quantity_delivered: jarsDelivered,
        empty_jars_collected: jarsCollected,
        damaged_jars_collected: 0,
        amount_collected: paymentMethod === "CREDIT" ? 0 : amountCollected,
        payment_method: paymentMethod,
        delivery_notes: deliveryNotes.trim() || undefined,
      });

      if (!res.success) {
        throw new Error(res.error || "Failed to mark order as delivered.");
      }

      // Optimistic local update
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderToDeliver.id
            ? {
                ...o,
                status: "DELIVERED",
                payment_status: paymentMethod === "CREDIT" ? "PENDING" : amountCollected >= o.total_amount ? "PAID" : "PARTIALLY_PAID",
                amount_paid: paymentMethod === "CREDIT" ? o.amount_paid : amountCollected,
                actual_quantity_delivered: deliverQty,
                empty_jars_collected: emptyCollected,
                delivered_at: new Date().toISOString(),
              }
            : o
        )
      );

      addToast({
        type: "success",
        title: "Delivery Completed! / ডেলিভারি সম্পন্ন",
        message: `Order #${orderToDeliver.order_number} marked delivered. Customer jars & dues updated.`,
      });

      setOrderToDeliver(null);
      loadData(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record delivery.";
      addToast({
        type: "error",
        title: "Delivery Failed",
        message: msg,
      });
    } finally {
      setIsDelivering(false);
    }
  };

  // Staff Reassignment Handlers
  const openReassignModal = (order: OrderRecord) => {
    setOrderToReassign(order);
  };

  const handleExecuteReassign = async (staffId: string | null) => {
    if (!orderToReassign) return;
    setIsReassigning(true);
    try {
      const res = await assignOrderStaff(orderToReassign.id, staffId);
      if (!res.success) {
        throw new Error(res.error || "Failed to assign staff.");
      }

      const assignedStaff = staffList.find((s) => s.id === staffId);
      const staffName = assignedStaff ? assignedStaff.full_name : null;

      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderToReassign.id
            ? {
                ...o,
                assigned_staff_id: staffId,
                assigned_staff_name: staffName,
                status: staffId ? "ASSIGNED" : "PENDING",
              }
            : o
        )
      );

      addToast({
        type: "success",
        title: staffId ? "Staff Assigned" : "Order Unassigned",
        message: staffId
          ? `Order #${orderToReassign.order_number} assigned to ${staffName}.`
          : `Order #${orderToReassign.order_number} returned to unassigned pool.`,
      });

      setOrderToReassign(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Staff assignment failed.";
      addToast({
        type: "error",
        title: "Assignment Failed",
        message: msg,
      });
    } finally {
      setIsReassigning(false);
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
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
              Orders & Delivery (অর্ডার ও ডেলিভারি)
            </h1>
            <Badge variant="primary" className="text-xs font-bold">
              Deliveries
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Create water jar orders, assign drivers, and check delivery status.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={isLoading}
            className="gap-1.5 text-xs font-medium"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={openCreateModal}
            className="gap-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-bold shadow-sm shadow-sky-500/25 active:scale-95 transition-all"
          >
            <Plus className="h-4 w-4" />
            + New Order (নতুন অর্ডার)
          </Button>
        </div>
      </div>

      {/* Orders Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-nowrap sm:flex-wrap pb-1 sm:pb-0">
          {[
            { id: "ALL", label: "All (সবগুলো)" },
            { id: "PENDING", label: "Pending (বাকি আছে)" },
            { id: "ASSIGNED", label: "With Driver (ড্রাইভারের কাছে)" },
            { id: "OUT_FOR_DELIVERY", label: "On the Way (পথে আছে)" },
            { id: "PARTIALLY_DELIVERED", label: "Half Done (অর্ধেক সম্পন্ন)" },
            { id: "DELIVERED", label: "Delivered (ডেলিভারি সম্পন্ন)" },
            { id: "CANCELLED", label: "Cancelled (বাতিল)" },
          ].map((st) => (
            <button
              key={st.id}
              onClick={() => setStatusFilter(st.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 touch-manipulation ${
                statusFilter === st.id
                  ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-xs font-bold"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <span>{st.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                  statusFilter === st.id
                    ? "bg-white/20 text-white font-bold"
                    : "bg-background text-muted-foreground"
                }`}
              >
                {statusCounts[st.id] || 0}
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
          {/* Compact Responsive Card View */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:hidden">
            {filteredOrders.map((o) => {
              const totalItems = o.items ? o.items.reduce((sum, it) => sum + it.quantity, 0) : 0;
              const isDelivered = o.status === "DELIVERED";
              const isCancelled = o.status === "CANCELLED";

              return (
                <div
                  key={o.id}
                  className="rounded-xl border border-border/80 bg-card p-3 shadow-xs space-y-2.5 touch-manipulation hover:border-primary/40 transition-colors flex flex-col justify-between"
                >
                  {/* Top Bar: Identifier + Status Badges + Price */}
                  <div>
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1 flex-wrap">
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
                          className="text-[9px] py-0 px-1"
                        >
                          {o.status.replace(/_/g, " ")}
                        </Badge>
                      </div>

                      <span className="font-black text-xs text-primary shrink-0">
                        {formatCurrency(o.total_amount)}
                      </span>
                    </div>

                    {/* Customer & Route */}
                    <div className="mt-1">
                      <h4 className="font-bold text-xs text-foreground leading-tight truncate">
                        {o.customer_name || "Customer"}
                      </h4>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {o.delivery_date} • {o.delivery_address || "No address"}
                      </p>
                    </div>
                  </div>

                  {/* Operational Summary Grid */}
                  <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-border/40 text-[11px]">
                    <div>
                      <span className="text-[9px] text-muted-foreground font-medium block">
                        Assigned Staff
                      </span>
                      <button
                        type="button"
                        onClick={() => openReassignModal(o)}
                        className="font-semibold text-foreground truncate block hover:underline text-left cursor-pointer text-[11px]"
                        title="Click to assign or change staff"
                      >
                        {o.assigned_staff_name ? (
                          <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 font-bold truncate">
                            <UserCheck className="h-2.5 w-2.5 shrink-0" />
                            {o.assigned_staff_name}
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 font-bold">
                            + Assign
                          </span>
                        )}
                      </button>
                    </div>

                    <div>
                      <span className="text-[9px] text-muted-foreground font-medium block">
                        Items ({totalItems})
                      </span>
                      <span className="font-semibold text-foreground truncate block text-[11px]" title={o.items?.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}>
                        {o.items && o.items.length > 0
                          ? o.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")
                          : "No items"}
                      </span>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-1">
                    <span className="text-[10px] text-muted-foreground truncate">
                      {o.customer_phone || "No Phone"}
                    </span>

                    <div className="flex items-center gap-1 shrink-0">
                      {canCancelOrder(o.status) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setOrderToCancel(o);
                            setCancelReason("");
                          }}
                          className="h-6 text-[10px] px-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                        >
                          <Ban className="h-2.5 w-2.5 mr-0.5" />
                          Cancel
                        </Button>
                      )}
                      {o.status !== "DELIVERED" && o.status !== "CANCELLED" ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => openDeliverModal(o)}
                          className="h-6 text-[10px] px-2 font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-xs"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-0.5" />
                          Deliver
                        </Button>
                      ) : o.status === "DELIVERED" ? (
                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                          <CheckCircle2 className="h-3 w-3" />
                          Done
                        </span>
                      ) : null}
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
                          <button
                            type="button"
                            onClick={() => openReassignModal(o)}
                            className="text-xs hover:underline flex items-center gap-1.5 cursor-pointer text-left"
                            title="Click to assign or change staff"
                          >
                            {o.assigned_staff_name ? (
                              <span className="font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1">
                                <UserCheck className="h-3.5 w-3.5" />
                                {o.assigned_staff_name}
                              </span>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[10px] py-0 text-amber-600 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20"
                              >
                                + Assign Staff
                              </Badge>
                            )}
                          </button>
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
                          <div className="flex items-center justify-end gap-1.5">
                            {o.status !== "DELIVERED" && o.status !== "CANCELLED" && (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => openDeliverModal(o)}
                                className="h-7 px-2.5 text-[11px] font-bold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-xs"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Deliver
                              </Button>
                            )}
                            {canCancelOrder(o.status) && (
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
                            )}
                            {o.status === "DELIVERED" && (
                              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Done
                              </span>
                            )}
                          </div>
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

      {/* Rapid POS-Style Order Creator Modal */}
      <Dialog
        isOpen={isCreateModalOpen}
        onClose={() => !isSubmitting && setIsCreateModalOpen(false)}
        className="max-w-4xl max-h-[92vh] flex flex-col p-0 overflow-hidden"
      >
        <div className="flex flex-col h-full max-h-[92vh]">
          {/* Modal Header */}
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border bg-gradient-to-r from-sky-500/10 via-blue-500/10 to-indigo-500/10 dark:from-sky-950/40 dark:via-blue-950/30 dark:to-indigo-950/40 shrink-0">
            <div>
              <h3 className="font-black text-base sm:text-lg text-foreground flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-sky-500" />
                <span>New Customer Order (নতুন অর্ডার তৈরি করুন)</span>
              </h3>
              <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
                POS-Style Rapid Order Creator • Zero Typing Required
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleInstantSampleFill}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black bg-amber-500 text-slate-950 hover:bg-amber-400 active:scale-95 transition-all shadow-xs cursor-pointer"
                title="Prepopulates customer, driver, today's date, and 10 jars instantly"
              >
                <Zap className="h-3.5 w-3.5 fill-slate-950" />
                <span>⚡ 1-Tap Fast Fill</span>
              </button>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={isSubmitting}
                className="h-8 w-8 rounded-lg bg-card hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center border border-border cursor-pointer transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <form onSubmit={handleCreateOrder} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
            {/* 1. CUSTOMER & DISPATCH ROUTE SECTION */}
            <div className="p-4 rounded-2xl bg-card border-2 border-border space-y-3.5 shadow-xs">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-sky-500" />
                  <span>1. Select Customer (কাস্টমার নির্বাচন করুন) *</span>
                </label>
                {selectedCustomer && (
                  <button
                    type="button"
                    onClick={() => handleCustomerChange("")}
                    className="text-[11px] font-bold text-rose-600 hover:text-rose-700 dark:text-rose-400 cursor-pointer"
                  >
                    Change Customer
                  </button>
                )}
              </div>

              {selectedCustomer ? (
                /* Selected Customer Banner */
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-sky-500/10 to-blue-500/10 border-2 border-sky-400/40 dark:border-sky-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm text-foreground">{selectedCustomer.contact_name}</span>
                      {selectedCustomer.customer_type === "B2B" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-extrabold border border-indigo-500/30">
                          B2B Business
                        </span>
                      )}
                      <span className="text-xs font-mono text-muted-foreground">• {selectedCustomer.phone}</span>
                    </div>
                    {selectedCustomer.business_name && (
                      <div className="text-xs font-semibold text-muted-foreground">{selectedCustomer.business_name}</div>
                    )}
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0 text-sky-500" />
                      <span className="truncate max-w-sm">{selectedCustomer.address || "No address on file"}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="p-2.5 rounded-xl bg-card border border-border text-center min-w-[120px] shadow-xs">
                      <span className="text-[10px] text-sky-600 dark:text-sky-400 uppercase block font-black flex items-center justify-center gap-1">
                        <Droplets className="h-3 w-3" />
                        Jars at House
                      </span>
                      <span className="text-base font-black text-foreground">
                        {(selectedCustomer.total_full_jars_holding || 0) + (selectedCustomer.total_empty_jars_holding || 0)} jars
                      </span>
                      <span className="text-[9px] text-muted-foreground font-semibold block">
                        {selectedCustomer.total_full_jars_holding || 0} full • {selectedCustomer.total_empty_jars_holding || 0} empty
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-card border border-border text-center min-w-[100px] shadow-xs">
                      <span className="text-[10px] text-muted-foreground uppercase block font-semibold">Current Due</span>
                      <span className={`text-base font-black ${Number(selectedCustomer.current_balance) > 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>
                        ₹{selectedCustomer.current_balance || 0}
                      </span>
                      <span className="text-[9px] text-muted-foreground font-semibold block">
                        {Number(selectedCustomer.current_balance) > 0 ? "Pending Due" : "All Clear"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                /* Customer Picker: Search + Frequent Chips + Dropdown */
                <div className="space-y-2.5">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Type customer name, phone, or shop name..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="pl-9 text-xs h-9"
                    />
                  </div>

                  {/* Frequent 1-Tap Customer Chips */}
                  {customers.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                        Tap Frequent Customer (১-ট্যাপে নির্বাচন):
                      </span>
                      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                        {filteredCustomers.slice(0, 10).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handleCustomerChange(c.id)}
                            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-muted/60 hover:bg-sky-500 hover:text-white dark:bg-slate-800 dark:hover:bg-sky-600 text-foreground border border-border transition-all shrink-0 active:scale-95 cursor-pointer text-left"
                          >
                            <div>{c.contact_name}</div>
                            <div className="text-[10px] opacity-80 font-normal">
                              {c.phone} • {((c.total_full_jars_holding || 0) + (c.total_empty_jars_holding || 0))} jars at house {Number(c.current_balance) > 0 ? `• Due ₹${c.current_balance}` : ""}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Dropdown fallback */}
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => handleCustomerChange(e.target.value)}
                    required
                    className="w-full rounded-xl border border-border bg-background p-2 text-xs text-foreground font-semibold"
                  >
                    <option value="">-- Or Choose From Full Customer Directory --</option>
                    {filteredCustomers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.contact_name} {c.business_name ? `(${c.business_name})` : ""} — {c.phone} [Holds {((c.total_full_jars_holding || 0) + (c.total_empty_jars_holding || 0))} jars at house]
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Delivery Mode & Staff Assignment */}
              <div className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Mode Selector */}
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold text-foreground">
                    Delivery Mode (ডেলিভারি মাধ্যম):
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsSelfPickup(false);
                        if (selectedCustomer) {
                          setDeliveryAddress(selectedCustomer.address || "");
                        }
                      }}
                      className={`p-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                        !isSelfPickup
                          ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white border-sky-400 shadow-sm"
                          : "bg-card text-muted-foreground border-border hover:bg-muted"
                      }`}
                    >
                      <Truck className="h-4 w-4" />
                      <span>🚚 Route Delivery (ডেলিভারি)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsSelfPickup(true);
                        setAssignedStaffId("");
                        setDeliveryAddress("Store Counter Pickup (গ্রাহক নিজে সংগ্রহ করবেন)");
                      }}
                      className={`p-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                        isSelfPickup
                          ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-400 shadow-sm"
                          : "bg-card text-muted-foreground border-border hover:bg-muted"
                      }`}
                    >
                      <Store className="h-4 w-4" />
                      <span>🏪 Counter Self-Pickup (নিজে নিবেন)</span>
                    </button>
                  </div>
                </div>

                {!isSelfPickup ? (
                  <>
                    {/* Staff Assignment */}
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-xs font-semibold text-foreground">
                        Assign Staff / Driver (ডেলিভারি স্টাফ):
                      </label>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setAssignedStaffId("")}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                            !assignedStaffId
                              ? "bg-slate-800 text-white border-slate-700 shadow-xs"
                              : "bg-card text-muted-foreground border-border hover:bg-muted"
                          }`}
                        >
                          👤 Unassigned / Later (পরে দিবে)
                        </button>
                        {staffList.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setAssignedStaffId(s.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all cursor-pointer ${
                              assignedStaffId === s.id
                                ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white border-sky-400 shadow-sm"
                                : "bg-card text-foreground border-border hover:bg-sky-50 dark:hover:bg-slate-800"
                            }`}
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            <span>{s.full_name}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Delivery Target Date */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-foreground">
                          Delivery Date (তারিখ) *
                        </label>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDeliveryDate(new Date().toISOString().split("T")[0])}
                            className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-muted hover:bg-muted/80 text-foreground cursor-pointer"
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
                            className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-muted hover:bg-muted/80 text-foreground cursor-pointer"
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
                        className="text-xs font-semibold"
                      />
                    </div>

                    {/* Delivery Address */}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground">
                        Delivery Address (ঠিকানা) *
                      </label>
                      <Input
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        required
                        placeholder="Street, floor, unit # or landmark"
                        className="text-xs"
                      />
                    </div>
                  </>
                ) : (
                  <div className="sm:col-span-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs font-medium flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                    <span>Customer will self-collect directly from the godown/store counter. No staff or delivery vehicle assigned.</span>
                  </div>
                )}
              </div>
            </div>

            {/* 2. POS PRODUCT CATALOG (Big Visual Cards Grid) */}
            <div className="p-4 rounded-2xl bg-card border-2 border-border space-y-3.5 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
                    <Package className="h-4 w-4 text-sky-500" />
                    <span>2. Select Products (পণ্য নির্বাচন করুন)</span>
                  </h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Tap product cards or preset buttons to add items instantly
                  </p>
                </div>

                {/* Search in Catalog */}
                <div className="w-full sm:w-56">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Filter products..."
                      value={orderCatalogSearch}
                      onChange={(e) => setOrderCatalogSearch(e.target.value)}
                      className="pl-8 text-xs h-7.5"
                    />
                  </div>
                </div>
              </div>

              {/* Category Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {[
                  { id: "ALL", label: "🌟 All Items" },
                  { id: "JARS", label: "💧 20L Water Jars" },
                  { id: "BOTTLES", label: "🍾 Packaged Bottles" },
                  { id: "DISPENSERS", label: "🚰 Dispensers" },
                  { id: "ACCESSORIES", label: "📦 Accessories" },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setOrderCatalogCategory(cat.id)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                      orderCatalogCategory === cat.id
                        ? "bg-sky-500 text-white shadow-xs"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Product Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {filteredCatalogProducts.map((p) => {
                  const qty = getProductQty(p.id);
                  const isSelected = qty > 0;
                  const specialPrice = customerSpecialPrices[p.id];
                  const effectivePrice = specialPrice ?? Number(p.default_sale_price);

                  return (
                    <div
                      key={p.id}
                      className={`p-3.5 rounded-2xl border-2 transition-all flex flex-col justify-between ${
                        isSelected
                          ? "bg-sky-500/10 dark:bg-sky-950/30 border-sky-500 shadow-md ring-2 ring-sky-500/20"
                          : "bg-muted/30 dark:bg-slate-900 border-border hover:border-sky-300 dark:hover:border-slate-700"
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{getProductEmoji(p)}</span>
                            <div>
                              <div className="font-black text-xs sm:text-sm text-foreground line-clamp-1">{p.name}</div>
                              <div className="text-[10px] font-mono text-muted-foreground">{p.sku}</div>
                            </div>
                          </div>
                          {p.is_reusable_jar && (
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/30 shrink-0">
                              20L Jar
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex items-baseline gap-1.5">
                          <span className="text-lg font-black text-foreground">₹{effectivePrice}</span>
                          <span className="text-[10px] text-muted-foreground">/ unit</span>
                          {specialPrice !== undefined && (
                            <span className="text-[9px] font-extrabold text-emerald-600 dark:text-emerald-400">
                              ★ Contract Rate
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Stepper or Add Button */}
                      <div className="mt-3 pt-2 border-t border-border/60">
                        {isSelected ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between bg-card dark:bg-slate-950 border border-border rounded-xl p-1">
                              <button
                                type="button"
                                onClick={() => addProductQtyDelta(p, -1)}
                                className="h-8 w-8 rounded-lg bg-muted hover:bg-muted/80 text-foreground flex items-center justify-center font-black active:scale-95 cursor-pointer"
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <div className="text-center font-black text-sm text-foreground">
                                {qty} <span className="text-[10px] font-normal text-muted-foreground">units</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => addProductQtyDelta(p, 1)}
                                className="h-8 w-8 rounded-lg bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center font-black shadow-xs active:scale-95 cursor-pointer"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>

                            {/* Fast Presets on Card */}
                            <div className="flex items-center gap-1 justify-center flex-wrap">
                              {[1, 5, 10, 20].map((delta) => (
                                <button
                                  key={delta}
                                  type="button"
                                  onClick={() => addProductQtyDelta(p, delta)}
                                  className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-muted hover:bg-sky-500 hover:text-white text-muted-foreground transition-all cursor-pointer active:scale-95"
                                >
                                  +{delta}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <button
                              type="button"
                              onClick={() => addProductQtyDelta(p, 1)}
                              className="w-full py-2 px-3 rounded-xl text-xs font-bold bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white flex items-center justify-center gap-1.5 shadow-xs active:scale-95 transition-all cursor-pointer"
                            >
                              <Plus className="h-4 w-4" />
                              <span>+ Add to Order</span>
                            </button>

                            {/* Direct Set Presets */}
                            <div className="flex items-center gap-1 justify-center flex-wrap">
                              {[1, 5, 10, 20].map((val) => (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => updateProductQty(p, val)}
                                  className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-muted/80 hover:bg-sky-500 hover:text-white text-muted-foreground transition-all cursor-pointer active:scale-95"
                                >
                                  {val}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. ORDER CART SUMMARY & LINE ITEMS */}
            <div className="p-4 rounded-2xl bg-card border-2 border-border space-y-3.5 shadow-xs">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  <Receipt className="h-4 w-4 text-emerald-500" />
                  <span>3. Order Items Cart (নির্বাচিত পণ্যের তালিকা — {itemRows.length})</span>
                </h4>
                {itemRows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setItemRows([])}
                    className="text-[11px] font-bold text-rose-600 hover:text-rose-700 dark:text-rose-400 cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {itemRows.length === 0 ? (
                <div className="p-6 rounded-xl border border-dashed border-border text-center text-muted-foreground text-xs italic">
                  No items in cart yet. Tap on any product card above to add items.
                </div>
              ) : (
                <div className="space-y-2">
                  {itemRows.map((row, idx) => {
                    const prod = products.find((p) => p.id === row.product_id);
                    const lineSubtotal = row.quantity * row.unit_price;
                    const lineTax = (lineSubtotal * row.gst_rate) / 100;
                    const lineTotal = lineSubtotal + lineTax;

                    return (
                      <div
                        key={row.product_id}
                        className="p-3 rounded-xl bg-muted/40 dark:bg-slate-900 border border-border flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-xl shrink-0">{prod ? getProductEmoji(prod) : "📦"}</span>
                          <div className="min-w-0">
                            <div className="font-black text-xs sm:text-sm text-foreground truncate">
                              {prod?.name || "Product"}
                            </div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                              <span>₹{row.unit_price} / unit</span>
                              {row.gst_rate > 0 && <span>• GST {row.gst_rate}%</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {/* Stepper */}
                          <div className="flex items-center gap-1 bg-card dark:bg-slate-950 border border-border rounded-lg p-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (prod) addProductQtyDelta(prod, -1);
                              }}
                              className="h-7 w-7 rounded bg-muted hover:bg-muted/80 text-foreground flex items-center justify-center font-bold text-xs active:scale-95 cursor-pointer"
                            >
                              -
                            </button>
                            <span className="w-8 text-center font-black text-xs text-foreground">
                              {row.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (prod) addProductQtyDelta(prod, 1);
                              }}
                              className="h-7 w-7 rounded bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center font-bold text-xs active:scale-95 cursor-pointer"
                            >
                              +
                            </button>
                          </div>

                          {/* Line Total */}
                          <div className="text-right min-w-[70px]">
                            <span className="font-black text-xs sm:text-sm text-foreground block">
                              ₹{Math.round(lineTotal * 100) / 100}
                            </span>
                          </div>

                          {/* Remove */}
                          <button
                            type="button"
                            onClick={() => handleRemoveProductRow(idx)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Delivery Notes */}
              <div className="space-y-1.5 pt-2 border-t border-border">
                <label className="text-xs font-semibold text-foreground">
                  Gate / Delivery Notes (ঐচ্ছিক মন্তব্য)
                </label>
                <Input
                  placeholder="e.g. Ring bell at 2nd floor, empty jars kept near gate"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  className="text-xs"
                />
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  {[
                    "Empty jars ready at gate",
                    "Call before delivery",
                    "Leave at reception",
                    "Collect cash on delivery",
                  ].map((presetNote) => (
                    <button
                      key={presetNote}
                      type="button"
                      onClick={() => setOrderNotes(presetNote)}
                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-muted hover:bg-muted/80 text-muted-foreground cursor-pointer"
                    >
                      + {presetNote}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 4. BILL SUMMARY CARD */}
            <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 text-white p-4 space-y-2 border border-slate-800 shadow-md">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Total Items:</span>
                <span className="font-bold text-white">{orderSummary.totalUnits} units</span>
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>Subtotal (Net):</span>
                <span className="font-medium text-white">{formatCurrency(orderSummary.subtotal)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>GST Tax:</span>
                <span className="font-medium text-white">{formatCurrency(orderSummary.taxTotal)}</span>
              </div>
              <div className="flex justify-between text-base sm:text-lg font-black text-white pt-2 border-t border-slate-800">
                <span>Grand Total:</span>
                <span className="text-emerald-400">{formatCurrency(orderSummary.totalAmount)}</span>
              </div>
            </div>

            {/* Modal Bottom Sticky Bar */}
            <div className="sticky bottom-0 bg-background/95 backdrop-blur-md pt-3 pb-1 border-t border-border flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateModalOpen(false)}
                disabled={isSubmitting}
                className="font-bold"
              >
                Cancel
              </Button>

              <Button
                type="submit"
                size="lg"
                disabled={isSubmitting || !selectedCustomerId || itemRows.length === 0}
                className="flex-1 sm:flex-initial bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs sm:text-sm shadow-md shadow-emerald-500/20 active:scale-95 transition-all"
              >
                {isSubmitting
                  ? "Dispatching Order..."
                  : `🚀 Confirm & Dispatch Order (অর্ডার নিশ্চিত করুন) — ${formatCurrency(orderSummary.totalAmount)}`}
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

      {/* DIRECT DELIVERY EXECUTION MODAL */}
      <Dialog
        isOpen={Boolean(orderToDeliver)}
        onClose={() => !isDelivering && setOrderToDeliver(null)}
        className="max-w-md"
      >
        {orderToDeliver && (
          <form onSubmit={handleConfirmDelivery} className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  Mark Order Delivered (ডেলিভারি সম্পন্ন)
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Order #{orderToDeliver.order_number} • {orderToDeliver.customer_name}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Customer & Address Details */}
              <div className="p-3 rounded-xl bg-muted/40 border border-border text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="font-bold text-foreground">{orderToDeliver.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phone:</span>
                  <span className="font-mono text-foreground">{orderToDeliver.customer_phone || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Address:</span>
                  <span className="text-foreground text-right max-w-[200px] truncate">{orderToDeliver.delivery_address}</span>
                </div>
              </div>

              {/* Staff Who Delivered */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Delivered by Staff *
                </label>
                <select
                  value={deliverStaffId}
                  onChange={(e) => setDeliverStaffId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground font-semibold"
                  required
                >
                  <option value="">-- Choose Staff Member --</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Conditional Jar Steppers */}
              {(() => {
                const hasReusableJars = Boolean(
                  orderToDeliver.items && orderToDeliver.items.some((it) => it.is_reusable_jar)
                );
                const customerHolding = orderToDeliver.customer_jars_holding ?? 0;
                const canCollectJars = hasReusableJars || customerHolding > 0;

                if (!hasReusableJars && !canCollectJars) {
                  return (
                    <div className="p-3 rounded-xl bg-muted/40 border border-border text-center text-xs text-muted-foreground font-semibold">
                      📦 Non-reusable order (প্যাকেজ সামগ্রী) • No jar custody involved
                    </div>
                  );
                }

                return (
                  <div className={`grid gap-3.5 ${hasReusableJars ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
                    {/* Jars Delivered */}
                    {hasReusableJars && (
                      <div className="p-3 rounded-2xl bg-sky-50/50 dark:bg-sky-950/20 border-2 border-sky-200 dark:border-sky-800/60 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-black text-foreground flex items-center gap-1.5">
                            <span className="text-base">💧</span>
                            <span>Jars Delivered *</span>
                          </label>
                          <span className="text-[10px] text-sky-700 dark:text-sky-300 font-bold">জার দিয়েছেন</span>
                        </div>

                        <div className="flex items-center justify-between bg-card dark:bg-slate-900 border border-sky-300 dark:border-sky-800 rounded-xl p-1 shadow-xs">
                          <button
                            type="button"
                            onClick={() => setDeliverQty(Math.max(0, deliverQty - 1))}
                            className="h-9 w-9 rounded-lg bg-muted hover:bg-muted/80 text-foreground flex items-center justify-center font-black text-lg active:scale-95 cursor-pointer"
                          >
                            -
                          </button>
                          <div className="text-center">
                            <span className="text-lg font-black text-foreground">{deliverQty}</span>
                            <span className="text-[10px] text-muted-foreground block -mt-1">Jars (জার)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDeliverQty(deliverQty + 1)}
                            className="h-9 w-9 rounded-lg bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center font-black text-lg shadow-xs active:scale-95 cursor-pointer"
                          >
                            +
                          </button>
                        </div>

                        <div className="flex items-center gap-1 flex-wrap pt-0.5">
                          {[1, 2, 5, 10, 15, 20].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setDeliverQty(preset)}
                              className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all cursor-pointer active:scale-95 ${
                                deliverQty === preset
                                  ? "bg-sky-500 text-white border-sky-400 shadow-xs"
                                  : "bg-card text-foreground border-border hover:bg-muted"
                              }`}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Jars Collected / Returned */}
                    {canCollectJars && (
                      <div className="p-3 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border-2 border-emerald-200 dark:border-emerald-800/60 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-black text-foreground flex items-center gap-1.5">
                            <span className="text-base">🔄</span>
                            <span>Jars Collected</span>
                          </label>
                          <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold">জার ফেরত</span>
                        </div>

                        <div className="flex items-center justify-between bg-card dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 rounded-xl p-1 shadow-xs">
                          <button
                            type="button"
                            onClick={() => setEmptyCollected(Math.max(0, emptyCollected - 1))}
                            className="h-9 w-9 rounded-lg bg-muted hover:bg-muted/80 text-foreground flex items-center justify-center font-black text-lg active:scale-95 cursor-pointer"
                          >
                            -
                          </button>
                          <div className="text-center">
                            <span className="text-lg font-black text-foreground">{emptyCollected}</span>
                            <span className="text-[10px] text-muted-foreground block -mt-1">
                              {customerHolding > 0 ? `House has ${customerHolding}` : "Jars (জার)"}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEmptyCollected(emptyCollected + 1)}
                            className="h-9 w-9 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center font-black text-lg shadow-xs active:scale-95 cursor-pointer"
                          >
                            +
                          </button>
                        </div>

                        <div className="flex items-center gap-1 flex-wrap pt-0.5">
                          {[0, 1, 2, 5, 10].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setEmptyCollected(preset)}
                              className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all cursor-pointer active:scale-95 ${
                                emptyCollected === preset
                                  ? "bg-emerald-500 text-white border-emerald-400 shadow-xs"
                                  : "bg-card text-foreground border-border hover:bg-muted"
                              }`}
                            >
                              {preset}
                            </button>
                          ))}
                          {hasReusableJars && (
                            <button
                              type="button"
                              onClick={() => setEmptyCollected(deliverQty)}
                              className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/30 hover:bg-sky-500/20 cursor-pointer"
                            >
                              = Same ({deliverQty})
                            </button>
                          )}
                          {customerHolding > 0 && customerHolding !== deliverQty && (
                            <button
                              type="button"
                              onClick={() => setEmptyCollected(customerHolding)}
                              className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 cursor-pointer"
                            >
                              All ({customerHolding})
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Payment Mode & Amount Collected */}
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-emerald-500" />
                  <span>Payment Collection (টাকা আদায়)</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(["CASH", "UPI", "CREDIT"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setPaymentMethod(m);
                        if (m === "CASH" || m === "UPI") {
                          setAmountCollected(orderToDeliver.total_amount);
                        } else {
                          setAmountCollected(0);
                        }
                      }}
                      className={`p-2.5 rounded-xl text-xs font-black border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 ${
                        paymentMethod === m
                          ? m === "CASH"
                            ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-400 shadow-sm"
                            : m === "UPI"
                            ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white border-sky-400 shadow-sm"
                            : "bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-400 shadow-sm"
                          : "bg-card text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      <span className="text-base">{m === "CASH" ? "💵" : m === "UPI" ? "📱" : "⏳"}</span>
                      <span>{m === "CASH" ? "Cash (নগদ)" : m === "UPI" ? "Online UPI" : "Credit (বাকি)"}</span>
                    </button>
                  ))}
                </div>

                {paymentMethod !== "CREDIT" && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-2 text-xs font-bold text-muted-foreground">₹</span>
                        <Input
                          type="number"
                          min={0}
                          value={amountCollected}
                          onChange={(e) => setAmountCollected(parseFloat(e.target.value) || 0)}
                          placeholder={`Amount (₹${orderToDeliver.total_amount})`}
                          className="text-sm font-black pl-7"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setAmountCollected(orderToDeliver.total_amount)}
                        className="px-3 py-2 rounded-xl text-xs font-bold bg-muted hover:bg-muted/80 text-foreground border border-border cursor-pointer active:scale-95"
                      >
                        Exact ₹{orderToDeliver.total_amount}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Delivery Notes */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Notes (ঐচ্ছিক মন্তব্য)
                </label>
                <Input
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  placeholder="e.g. Delivered to reception, empty jar seal checked"
                  className="text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOrderToDeliver(null)}
                disabled={isDelivering}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isDelivering}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold"
              >
                {isDelivering ? "Recording..." : "Confirm Delivery (ডেলিভারি কনফার্ম)"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* QUICK REASSIGN STAFF DIALOG */}
      <Dialog
        isOpen={Boolean(orderToReassign)}
        onClose={() => !isReassigning && setOrderToReassign(null)}
        className="max-w-sm"
      >
        {orderToReassign && (
          <div className="p-4 sm:p-5 space-y-4">
            <div>
              <h3 className="text-base font-bold text-foreground">
                Assign Delivery Staff
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Order #{orderToReassign.order_number} • {orderToReassign.customer_name}
              </p>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleExecuteReassign(null)}
                disabled={isReassigning}
                className="w-full p-2.5 rounded-xl border border-border bg-card hover:bg-muted text-xs font-bold text-left flex items-center justify-between transition-all cursor-pointer"
              >
                <span>-- Unassigned (ফ্লিট পুল) --</span>
                {!orderToReassign.assigned_staff_id && <CheckCircle2 className="h-4 w-4 text-primary" />}
              </button>

              {staffList.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleExecuteReassign(s.id)}
                  disabled={isReassigning}
                  className="w-full p-2.5 rounded-xl border border-border bg-card hover:bg-muted text-xs font-bold text-left flex items-center justify-between transition-all cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-sky-600" />
                    {s.full_name}
                  </span>
                  {orderToReassign.assigned_staff_id === s.id && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOrderToReassign(null)}
                disabled={isReassigning}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
