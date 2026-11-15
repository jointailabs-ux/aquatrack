"use client";

import * as React from "react";
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  MapPin,
  AlertCircle,
  Building,
  DollarSign,
  Package,
  RefreshCw,
  Ban,
  Edit3,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Zap,
  Droplets,
  Calendar,
  CalendarDays,
  UserCheck,
  CheckCircle2,
} from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  toggleCustomerActive,
  getCustomerPayments,
  getCustomerInvoices,
  getCustomerJarMovements,
  recordDirectCustomerPayment,
  returnCustomerJars,
} from "@/modules/customers/customer.service";
import { getOrders } from "@/modules/orders/order.service";
import {
  CustomerRecord,
  CustomerInput,
  CustomerUpdateInput,
  CustomerPaymentRecord,
  CustomerInvoiceRecord,
  CustomerJarMovementRecord,
} from "@/modules/customers/customer.schema";
import { OrderRecord } from "@/modules/orders/order.schema";
import { formatCurrency } from "@/lib/utils";

const CUSTOMERS_STORAGE_KEY = "aquatrack_customers_cache_v2";
const CUSTOMERS_CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL for zero-latency instant transitions

// Module-level client cache for instant zero-latency customer navigation
let cachedCustomersState: {
  key: string;
  items: CustomerRecord[];
  total: number;
  totalPages: number;
  timestamp: number;
} | null = null;

function getInitialCustomersData() {
  if (cachedCustomersState && cachedCustomersState.items.length > 0) {
    return cachedCustomersState;
  }
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(CUSTOMERS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
          cachedCustomersState = parsed;
          return parsed;
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }
  return { key: "", items: [], total: 0, totalPages: 1 };
}

export default function CustomersPage() {
  const { addToast } = useToast();
  const initialData = React.useMemo(() => getInitialCustomersData(), []);

  // Directory Data with instant cache initialization
  const [customers, setCustomers] = React.useState<CustomerRecord[]>(() => {
    return initialData.items || [];
  });
  const [selectedCustomer, setSelectedCustomer] = React.useState<CustomerRecord | null>(() => {
    return initialData.items?.[0] || null;
  });
  const [isLoading, setIsLoading] = React.useState<boolean>(() => initialData.items.length === 0);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<"ALL" | "B2C" | "B2B">("ALL");
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE");
  const [hasBalanceFilter, setHasBalanceFilter] = React.useState(false);
  const [mobileView, setMobileView] = React.useState<"list" | "detail">("list");
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(() => initialData.totalPages || 1);
  const [totalCount, setTotalCount] = React.useState(() => initialData.total || 0);

  // Tabs in Details Panel
  const [activeTab, setActiveTab] = React.useState<"orders" | "payments" | "jars" | "invoices">("orders");
  const [isTabLoading, setIsTabLoading] = React.useState(false);
  const [customerOrders, setCustomerOrders] = React.useState<OrderRecord[]>([]);
  const [customerPayments, setCustomerPayments] = React.useState<CustomerPaymentRecord[]>([]);
  const [customerInvoices, setCustomerInvoices] = React.useState<CustomerInvoiceRecord[]>([]);
  const [customerJarMovements, setCustomerJarMovements] = React.useState<CustomerJarMovementRecord[]>([]);

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = React.useState(false);
  const [isToggleActiveOpen, setIsToggleActiveOpen] = React.useState(false);

  // Customer Orders Filters
  const [orderFromDate, setOrderFromDate] = React.useState("");
  const [orderToDate, setOrderToDate] = React.useState("");
  const [orderStatusFilter, setOrderStatusFilter] = React.useState<"ALL" | "DELIVERED" | "PENDING" | "CANCELLED">("ALL");
  const [orderDatePreset, setOrderDatePreset] = React.useState<"ALL" | "TODAY" | "7DAYS" | "MONTH" | "CUSTOM">("ALL");
  const [orderPaymentFilter, setOrderPaymentFilter] = React.useState<"ALL" | "PAID" | "DUE">("ALL");

  // Add Customer Form States
  const [addCustomerType, setAddCustomerType] = React.useState<"B2C" | "B2B">("B2C");
  const [addContactName, setAddContactName] = React.useState("");
  const [addBusinessName, setAddBusinessName] = React.useState("");
  const [addPhone, setAddPhone] = React.useState("");
  const [addEmail, setAddEmail] = React.useState("");
  const [addAddress, setAddAddress] = React.useState("");
  const [addDeliveryInstructions, setAddDeliveryInstructions] = React.useState("");
  const [addGstin, setAddGstin] = React.useState("");
  const [addCreditLimit, setAddCreditLimit] = React.useState("5000");
  const [addMaxJarLimit, setAddMaxJarLimit] = React.useState("5");
  const [addPaymentTerms, setAddPaymentTerms] = React.useState("15");
  const [addNotes, setAddNotes] = React.useState("");
  const [showAddAdvanced, setShowAddAdvanced] = React.useState(false);

  // Check URL query parameter to auto-open add customer modal
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("new") === "true") {
        setIsAddModalOpen(true);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, []);

  const applyQuickCustomerTemplate = (type: "B2C" | "B2B") => {
    if (type === "B2C") {
      setAddCustomerType("B2C");
      setAddContactName("Sunita Rao");
      setAddPhone("9845" + Math.floor(100000 + Math.random() * 900000));
      setAddAddress("Flat 302, Lake View Apts, 2nd Cross, Indira Nagar");
      setAddMaxJarLimit("5");
      setAddCreditLimit("1000");
      setAddPaymentTerms("0");
    } else {
      setAddCustomerType("B2B");
      setAddBusinessName("Apex Technologies Corp");
      setAddContactName("Manoj Sharma");
      setAddPhone("9880" + Math.floor(100000 + Math.random() * 900000));
      setAddAddress("Tower B, 4th Floor, Global IT Village");
      setAddGstin("29ABCDE1234F1Z5");
      setAddMaxJarLimit("30");
      setAddCreditLimit("15000");
      setAddPaymentTerms("30");
    }
    addToast({
      type: "success",
      title: "Fast Template Loaded",
      message: `${type === "B2C" ? "Residential" : "Corporate"} profile prefilled in 1 click!`,
    });
  };

  // Edit Customer Form States
  const [editContactName, setEditContactName] = React.useState("");
  const [editBusinessName, setEditBusinessName] = React.useState("");
  const [editPhone, setEditPhone] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [editAddress, setEditAddress] = React.useState("");
  const [editDeliveryInstructions, setEditDeliveryInstructions] = React.useState("");
  const [editGstin, setEditGstin] = React.useState("");
  const [editCreditLimit, setEditCreditLimit] = React.useState("0");
  const [editMaxJarLimit, setEditMaxJarLimit] = React.useState("5");
  const [editPaymentTerms, setEditPaymentTerms] = React.useState("0");
  const [editNotes, setEditNotes] = React.useState("");

  // Payment Form States
  const [paymentAmount, setPaymentAmount] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState<"CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE">("UPI");
  const [paymentDate, setPaymentDate] = React.useState(() => new Date().toISOString().split("T")[0]);
  const [paymentReference, setPaymentReference] = React.useState("");
  const [paymentInvoiceId, setPaymentInvoiceId] = React.useState<string>("");
  const [paymentNotes, setPaymentNotes] = React.useState("");

  // Collect Returned Jars Modal States
  const [isReturnJarsOpen, setIsReturnJarsOpen] = React.useState(false);
  const [customerForReturn, setCustomerForReturn] = React.useState<CustomerRecord | null>(null);
  const [returnQty, setReturnQty] = React.useState<number>(1);
  const [returnNotes, setReturnNotes] = React.useState<string>("");
  const [isSubmittingReturn, setIsSubmittingReturn] = React.useState(false);

  const openCollectJarsModal = (customer: CustomerRecord) => {
    setCustomerForReturn(customer);
    const totalJars = (Number(customer.total_full_jars_holding || 0) + Number(customer.total_empty_jars_holding || 0));
    setReturnQty(totalJars > 0 ? (totalJars >= 2 ? 2 : 1) : 0);
    setReturnNotes("");
    setIsReturnJarsOpen(true);
  };

  const handleConfirmJarReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerForReturn) return;

    const totalJars = (Number(customerForReturn.total_full_jars_holding || 0) + Number(customerForReturn.total_empty_jars_holding || 0));
    if (returnQty <= 0) {
      addToast({
        type: "error",
        title: "Invalid Quantity",
        message: "Return quantity must be at least 1 jar.",
      });
      return;
    }

    if (returnQty > totalJars) {
      addToast({
        type: "error",
        title: "Exceeds Jars at House",
        message: `Customer only has ${totalJars} jars at house. Cannot collect ${returnQty} jars.`,
      });
      return;
    }

    setIsSubmittingReturn(true);
    try {
      const res = await returnCustomerJars({
        customer_id: customerForReturn.id,
        quantity: returnQty,
        notes: returnNotes.trim() || undefined,
      });

      if (!res.success || !res.data) {
        throw new Error(res.error || "Failed to return jars.");
      }

      addToast({
        type: "success",
        title: "Jars Returned & Stock Updated (জার গুদামে জমা হয়েছে)",
        message: `${returnQty} jars collected from ${customerForReturn.contact_name}. Customer balance is now ${res.data.remaining_jars} jars. Stock updated in warehouse!`,
      });

      // Update in-memory customer and directory
      setSelectedCustomer((prev) => {
        if (!prev || prev.id !== customerForReturn.id) return prev;
        let remDeduct = returnQty;
        let newEmpty = prev.total_empty_jars_holding || 0;
        let newFull = prev.total_full_jars_holding || 0;
        if (newEmpty >= remDeduct) {
          newEmpty -= remDeduct;
        } else {
          remDeduct -= newEmpty;
          newEmpty = 0;
          newFull = Math.max(0, newFull - remDeduct);
        }
        return {
          ...prev,
          total_empty_jars_holding: newEmpty,
          total_full_jars_holding: newFull,
        };
      });

      setCustomers((prev) =>
        prev.map((c) => {
          if (c.id !== customerForReturn.id) return c;
          let remDeduct = returnQty;
          let newEmpty = c.total_empty_jars_holding || 0;
          let newFull = c.total_full_jars_holding || 0;
          if (newEmpty >= remDeduct) {
            newEmpty -= remDeduct;
          } else {
            remDeduct -= newEmpty;
            newEmpty = 0;
            newFull = Math.max(0, newFull - remDeduct);
          }
          return {
            ...c,
            total_empty_jars_holding: newEmpty,
            total_full_jars_holding: newFull,
          };
        })
      );

      setIsReturnJarsOpen(false);
      await loadCustomers(page, true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to return jars.";
      addToast({
        type: "error",
        title: "Jar Return Failed",
        message: msg,
      });
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  // Load Customers
  const loadCustomers = React.useCallback(async (targetPage = page, forceRefresh = false) => {
    const cacheKey = `${searchQuery}-${typeFilter}-${statusFilter}-${hasBalanceFilter}-${targetPage}`;
    const now = Date.now();
    const hasFreshCache =
      !forceRefresh &&
      cachedCustomersState &&
      cachedCustomersState.key === cacheKey &&
      now - (cachedCustomersState.timestamp || 0) < CUSTOMERS_CACHE_TTL_MS;

    if (hasFreshCache) {
      return;
    }

    const hasMatchingCache = cachedCustomersState && cachedCustomersState.key === cacheKey;

    if (!hasMatchingCache) {
      setIsLoading(true);
    }
    try {
      const res = await getCustomers({
        search: searchQuery.trim() || undefined,
        customerType: typeFilter === "ALL" ? undefined : typeFilter,
        status: statusFilter,
        hasOutstandingBalance: hasBalanceFilter ? true : undefined,
        page: targetPage,
        pageSize: 15,
      });

      if (res.success && res.data) {
        setCustomers(res.data.items);
        setTotalPages(res.data.totalPages || 1);
        setTotalCount(res.data.total || 0);

        const freshState = {
          key: cacheKey,
          items: res.data.items,
          total: res.data.total || 0,
          totalPages: res.data.totalPages || 1,
          timestamp: Date.now(),
        };
        cachedCustomersState = freshState;

        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(CUSTOMERS_STORAGE_KEY, JSON.stringify(freshState));
          } catch {
            // Ignore quota errors
          }
        }

        // Keep current selected customer or pick first
        if (selectedCustomer) {
          const fresh = res.data.items.find((c) => c.id === selectedCustomer.id);
          if (fresh) {
            setSelectedCustomer(fresh);
          } else if (res.data.items.length > 0) {
            setSelectedCustomer(res.data.items[0]);
          } else {
            setSelectedCustomer(null);
          }
        } else if (res.data.items.length > 0) {
          setSelectedCustomer(res.data.items[0]);
        } else {
          setSelectedCustomer(null);
        }
      } else {
        setCustomers([]);
        setSelectedCustomer(null);
        if (res.error) {
          addToast({ type: "error", title: "Error Loading Customers", message: res.error });
        }
      }
    } catch {
      addToast({ type: "error", title: "Error", message: "Failed to connect to database." });
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, typeFilter, statusFilter, hasBalanceFilter, page, selectedCustomer, addToast]);

  React.useEffect(() => {
    loadCustomers(1);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, typeFilter, statusFilter, hasBalanceFilter]);

  // Load Tab Data for Selected Customer
  const loadCustomerTabData = React.useCallback(async (customerId: string, tab: string) => {
    setIsTabLoading(true);
    try {
      if (tab === "orders") {
        const res = await getOrders({ customerId });
        if (res.success && res.data) {
          setCustomerOrders(res.data);
        } else {
          setCustomerOrders([]);
        }
      } else if (tab === "payments") {
        const res = await getCustomerPayments(customerId);
        if (res.success && res.data) {
          setCustomerPayments(res.data);
        } else {
          setCustomerPayments([]);
        }
      } else if (tab === "invoices") {
        const res = await getCustomerInvoices(customerId);
        if (res.success && res.data) {
          setCustomerInvoices(res.data);
        } else {
          setCustomerInvoices([]);
        }
      } else if (tab === "jars") {
        const res = await getCustomerJarMovements(customerId);
        if (res.success && res.data) {
          setCustomerJarMovements(res.data);
        } else {
          setCustomerJarMovements([]);
        }
      }
    } catch {
      // Tab load error handled gracefully
    } finally {
      setIsTabLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (selectedCustomer) {
      loadCustomerTabData(selectedCustomer.id, activeTab);
    }
  }, [selectedCustomer, activeTab, loadCustomerTabData]);

  // Handle Add Customer
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!addContactName.trim() || addContactName.trim().length < 2) {
      addToast({
        type: "error",
        title: "Name Required",
        message: "Customer contact name must be at least 2 characters.",
      });
      return;
    }

    if (addCustomerType === "B2B" && !addBusinessName.trim()) {
      addToast({
        type: "error",
        title: "Business Name Required",
        message: "Company / Business name is required for B2B accounts.",
      });
      return;
    }

    if (addPhone.trim().length < 6) {
      addToast({
        type: "error",
        title: "Invalid Phone Number",
        message: "Phone number must be at least 6 digits (e.g. 9845011223 or 676878).",
      });
      return;
    }

    if (!addAddress.trim() || addAddress.trim().length < 3) {
      addToast({
        type: "error",
        title: "Address Required",
        message: "Delivery address must be at least 3 characters.",
      });
      return;
    }

    setIsSubmitting(true);

    const input: CustomerInput = {
      customer_type: addCustomerType,
      contact_name: addContactName.trim(),
      business_name: addCustomerType === "B2B" ? addBusinessName.trim() : null,
      phone: addPhone.trim(),
      email: addEmail.trim() || null,
      address: addAddress.trim(),
      delivery_instructions: addDeliveryInstructions.trim() || null,
      gstin: addCustomerType === "B2B" && addGstin.trim() ? addGstin.trim().toUpperCase() : null,
      credit_limit: Number(addCreditLimit) || 0,
      max_jar_limit: Number(addMaxJarLimit) || 5,
      payment_terms_days: addCustomerType === "B2B" ? Number(addPaymentTerms) || 15 : 0,
      notes: addNotes.trim() || null,
    };

    const res = await createCustomer(input);
    setIsSubmitting(false);

    if (res.success && res.data) {
      const createdCustomer = res.data;
      setCustomers((prev) => [createdCustomer, ...prev]);
      setSelectedCustomer(createdCustomer);
      if (cachedCustomersState) {
        cachedCustomersState.items = [createdCustomer, ...cachedCustomersState.items];
        cachedCustomersState.total += 1;
      }

      addToast({
        type: "success",
        title: "Customer Registered",
        message: `Registered ${createdCustomer.contact_name} successfully.`,
      });
      setIsAddModalOpen(false);
      // Reset form
      setAddContactName("");
      setAddBusinessName("");
      setAddPhone("");
      setAddEmail("");
      setAddAddress("");
      setAddDeliveryInstructions("");
      setAddGstin("");
      setAddNotes("");
      loadCustomers(1, true);
    } else {
      addToast({
        type: "error",
        title: "Registration Failed",
        message: res.error || "Could not register customer.",
      });
    }
  };

  // Open Edit Modal
  const openEditModal = (cust: CustomerRecord) => {
    setEditContactName(cust.contact_name);
    setEditBusinessName(cust.business_name || "");
    setEditPhone(cust.phone);
    setEditEmail(cust.email || "");
    setEditAddress(cust.address);
    setEditDeliveryInstructions(cust.delivery_instructions || "");
    setEditGstin(cust.gstin || "");
    setEditCreditLimit(String(cust.credit_limit || 0));
    setEditMaxJarLimit(String(cust.max_jar_limit || 5));
    setEditPaymentTerms(String(cust.payment_terms_days || 0));
    setEditNotes(cust.notes || "");
    setIsEditModalOpen(true);
  };

  // Handle Edit Submit
  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    if (!editContactName.trim() || editContactName.trim().length < 2) {
      addToast({
        type: "error",
        title: "Name Required",
        message: "Customer contact name must be at least 2 characters.",
      });
      return;
    }

    if (selectedCustomer.customer_type === "B2B" && !editBusinessName.trim()) {
      addToast({
        type: "error",
        title: "Business Name Required",
        message: "Company / Business name is required for B2B accounts.",
      });
      return;
    }

    if (editPhone.trim().length < 6) {
      addToast({
        type: "error",
        title: "Invalid Phone Number",
        message: "Phone number must be at least 6 digits (e.g. 9845011223 or 676878).",
      });
      return;
    }

    if (!editAddress.trim() || editAddress.trim().length < 3) {
      addToast({
        type: "error",
        title: "Address Required",
        message: "Delivery address must be at least 3 characters.",
      });
      return;
    }

    setIsSubmitting(true);
    const updatePayload: CustomerUpdateInput = {
      contact_name: editContactName.trim(),
      business_name: selectedCustomer.customer_type === "B2B" ? editBusinessName.trim() : null,
      phone: editPhone.trim(),
      email: editEmail.trim() || null,
      address: editAddress.trim(),
      delivery_instructions: editDeliveryInstructions.trim() || null,
      gstin: selectedCustomer.customer_type === "B2B" && editGstin.trim() ? editGstin.trim().toUpperCase() : null,
      credit_limit: Number(editCreditLimit) || 0,
      max_jar_limit: Number(editMaxJarLimit) || 5,
      payment_terms_days: Number(editPaymentTerms) || 0,
      notes: editNotes.trim() || null,
    };

    const res = await updateCustomer(selectedCustomer.id, updatePayload);
    setIsSubmitting(false);

    if (res.success && res.data) {
      addToast({
        type: "success",
        title: "Customer Updated",
        message: `Updated profile for ${res.data.contact_name}.`,
      });
      setIsEditModalOpen(false);
      setSelectedCustomer(res.data);
      setCustomers((prev) => prev.map((c) => (c.id === res.data!.id ? res.data! : c)));
    } else {
      addToast({
        type: "error",
        title: "Update Failed",
        message: res.error || "Could not update customer.",
      });
    }
  };

  // Handle Toggle Active
  const handleToggleActive = async () => {
    if (!selectedCustomer) return;

    setIsSubmitting(true);
    const targetStatus = !selectedCustomer.is_active;
    const res = await toggleCustomerActive(selectedCustomer.id, targetStatus);
    setIsSubmitting(false);
    setIsToggleActiveOpen(false);

    if (res.success && res.data) {
      addToast({
        type: "success",
        title: targetStatus ? "Customer Activated" : "Customer Deactivated",
        message: `${res.data.contact_name} is now ${targetStatus ? "active" : "inactive"}. History preserved.`,
      });
      setSelectedCustomer(res.data);
      setCustomers((prev) => prev.map((c) => (c.id === res.data!.id ? res.data! : c)));
    } else {
      addToast({
        type: "error",
        title: "Status Update Failed",
        message: res.error || "Could not change status.",
      });
    }
  };

  // Open Direct Payment Modal
  const openDirectPaymentModal = async (cust: CustomerRecord, invoiceId?: string, invoiceBalance?: number) => {
    setSelectedCustomer(cust);
    // Load customer invoices to show in dropdown
    const invRes = await getCustomerInvoices(cust.id);
    if (invRes.success && invRes.data) {
      setCustomerInvoices(invRes.data);
    }

    if (invoiceId && invoiceBalance !== undefined) {
      setPaymentInvoiceId(invoiceId);
      setPaymentAmount(invoiceBalance > 0 ? String(invoiceBalance) : "");
    } else {
      setPaymentInvoiceId("");
      setPaymentAmount(cust.current_balance > 0 ? String(cust.current_balance) : "");
    }

    setPaymentMethod("UPI");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPaymentReference("");
    setPaymentNotes("");
    setIsPaymentModalOpen(true);
  };

  // Handle Direct Payment Submit
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      addToast({
        type: "error",
        title: "Invalid Amount",
        message: "Payment amount must be greater than zero.",
      });
      return;
    }

    setIsSubmitting(true);
    const res = await recordDirectCustomerPayment({
      customer_id: selectedCustomer.id,
      invoice_id: paymentInvoiceId || null,
      amount: amt,
      payment_method: paymentMethod,
      payment_date: paymentDate,
      reference_number: paymentReference.trim() || null,
      notes: paymentNotes.trim() || null,
    });
    setIsSubmitting(false);

    if (res.success && res.data) {
      addToast({
        type: "success",
        title: "Payment Recorded",
        message: `Recorded ${formatCurrency(amt)} via ${paymentMethod} (Ref: ${res.data.payment_number}).`,
      });
      setIsPaymentModalOpen(false);

      // Refresh customer list & active tab
      await loadCustomers(page, true);
      loadCustomerTabData(selectedCustomer.id, activeTab);
    } else {
      addToast({
        type: "error",
        title: "Payment Failed",
        message: res.error || "Failed to record payment.",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
              Customers & Khata Book (কাস্টমার ও খাতা)
            </h1>
            <Badge variant="primary" className="text-xs font-bold">
              {totalCount} Customers
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Customer details, empty bottle balance, pending udhaari, and receive payments.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={() => {
              if (selectedCustomer) {
                openDirectPaymentModal(selectedCustomer);
              } else if (customers.length > 0) {
                openDirectPaymentModal(customers[0]);
              } else {
                setIsAddModalOpen(true);
              }
            }}
            className="gap-1.5 text-xs font-black bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white shadow-md shadow-emerald-950/20 active:scale-95 transition-all cursor-pointer"
          >
            <DollarSign className="h-4 w-4 stroke-[2.5]" />
            Receive Money (টাকা জমা নিন)
          </Button>

          <Button
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
            className="gap-2 bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white font-black shadow-md shadow-sky-500/25 active:scale-95 transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4 stroke-[3]" />
            + New Customer (নতুন কাস্টমার)
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card className="border-border shadow-xs">
        <CardContent className="p-3.5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            {/* Search Input */}
            <div className="sm:col-span-4 relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, phone, or shop..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs h-9"
              />
            </div>

            {/* Type Filter */}
            <div className="sm:col-span-3 flex rounded-lg bg-muted p-1 border border-border">
              <button
                type="button"
                onClick={() => setTypeFilter("ALL")}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
                  typeFilter === "ALL"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("B2C")}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
                  typeFilter === "B2C"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Home (B2C)
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("B2B")}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
                  typeFilter === "B2B"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Shop (B2B)
              </button>
            </div>

            {/* Status Filter */}
            <div className="sm:col-span-3 flex rounded-lg bg-muted p-1 border border-border">
              <button
                type="button"
                onClick={() => setStatusFilter("ACTIVE")}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
                  statusFilter === "ACTIVE"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("INACTIVE")}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
                  statusFilter === "INACTIVE"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Stopped
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("ALL")}
                className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
                  statusFilter === "ALL"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
            </div>

            {/* Outstanding Balance Toggle */}
            <div className="sm:col-span-2 flex items-center justify-end">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground select-none">
                <input
                  type="checkbox"
                  checked={hasBalanceFilter}
                  onChange={(e) => setHasBalanceFilter(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                />
                <span className={hasBalanceFilter ? "font-bold text-rose-600 dark:text-rose-400" : ""}>
                  Pending Due Only (বাকি টাকা)
                </span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Two-Column Master-Detail Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Customer Cards Directory */}
        <div className={`lg:col-span-5 space-y-3 ${mobileView === "detail" ? "hidden lg:block" : "block"}`}>
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-xs font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <Users className="h-4 w-4 text-sky-500" />
                Customer Cards Directory ({totalCount})
              </span>
            </div>
            <button
              onClick={() => loadCustomers(page, true)}
              className="text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1 p-1 cursor-pointer"
              title="Refresh list"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>

          <div className="space-y-3 max-h-[720px] overflow-y-auto pr-1">
            {isLoading ? (
              <div className="p-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2 bg-card rounded-2xl border border-border">
                <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                <span className="font-semibold">Loading customer cards...</span>
              </div>
            ) : customers.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground space-y-3 bg-card rounded-2xl border border-border">
                <Users className="h-10 w-10 mx-auto text-muted-foreground/40" />
                <p className="font-bold text-foreground text-sm">No customers found</p>
                <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">
                  {searchQuery || typeFilter !== "ALL" || hasBalanceFilter
                    ? "Try clearing or modifying your search and filter criteria."
                    : "Click '+ New Customer' above to register your first client account."}
                </p>
              </div>
            ) : (
              customers.map((cust) => {
                const isSelected = selectedCustomer?.id === cust.id;
                const totalCustody =
                  (cust.total_full_jars_holding || 0) +
                  (cust.total_empty_jars_holding || 0) +
                  (cust.total_damaged_jars_holding || 0);

                return (
                  <div
                    key={cust.id}
                    onClick={() => {
                      setSelectedCustomer(cust);
                      setMobileView("detail");
                    }}
                    className={`rounded-2xl p-4 transition-all duration-200 cursor-pointer space-y-3 relative overflow-hidden border-2 ${
                      isSelected
                        ? "bg-gradient-to-br from-card via-sky-500/10 to-card border-sky-500 shadow-md shadow-sky-500/15"
                        : "bg-card border-border/80 hover:border-sky-400/60 hover:shadow-xs active:scale-[0.99]"
                    }`}
                  >
                    {/* Top Accent Strip */}
                    <div
                      className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${
                        isSelected
                          ? "from-sky-400 via-blue-500 to-indigo-500"
                          : Number(cust.current_balance) > 0
                          ? "from-rose-500 via-amber-500 to-rose-400"
                          : "from-emerald-400 via-teal-500 to-emerald-600"
                      }`}
                    />

                    {/* Card Header: Name, Type Badge, Active Indicator */}
                    <div className="flex items-start justify-between gap-2 pt-0.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-black text-foreground tracking-tight truncate">
                            {cust.contact_name}
                          </h3>
                          <Badge
                            variant={cust.customer_type === "B2B" ? "primary" : "secondary"}
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md ${
                              cust.customer_type === "B2B"
                                ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                                : "bg-sky-500/20 text-sky-400 border border-sky-500/30"
                            }`}
                          >
                            {cust.customer_type === "B2B" ? "Shop (B2B)" : "Home (B2C)"}
                          </Badge>
                          {cust.is_active ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.2 rounded-full">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/30 px-2 py-0.2 rounded-full">
                              Stopped
                            </span>
                          )}
                        </div>

                        {cust.business_name && (
                          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mt-1 truncate">
                            <Building className="h-3.5 w-3.5 text-primary shrink-0" />
                            {cust.business_name}
                          </p>
                        )}
                      </div>

                      {/* Quick View Pill */}
                      <div className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-sky-500 dark:text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 px-2.5 py-1 rounded-xl transition-colors">
                        <span>Khata ›</span>
                      </div>
                    </div>

                    {/* Visual 2-Box Metric Row: Jars at House & Outstanding Due */}
                    <div className="grid grid-cols-2 gap-2.5">
                      {/* Box 1: Jars in Custody */}
                      <div
                        onClick={(e) => {
                          if (totalCustody > 0) {
                            e.stopPropagation();
                            openCollectJarsModal(cust);
                          }
                        }}
                        className={`rounded-xl p-2.5 bg-sky-500/10 border border-sky-500/25 flex flex-col justify-between transition-colors ${
                          totalCustody > 0
                            ? "hover:bg-sky-500/20 hover:border-sky-500/50 cursor-pointer"
                            : ""
                        }`}
                        title={totalCustody > 0 ? "Click to collect returned jars back into stock" : undefined}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300 flex items-center gap-1">
                            <Droplets className="h-3 w-3 text-sky-500" /> Jars at House
                          </span>
                          {totalCustody > 0 && (
                            <span className="text-[9px] font-bold text-sky-600 dark:text-sky-400 bg-sky-500/15 px-1.5 py-0.2 rounded-md">
                              Return ↵
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-baseline gap-1">
                          <span className="text-xl font-black text-sky-600 dark:text-sky-400 leading-none">
                            {totalCustody}
                          </span>
                          <span className="text-[11px] font-bold text-sky-700/80 dark:text-sky-300/80">Jars</span>
                        </div>
                        <span className="text-[9px] text-muted-foreground mt-0.5 block truncate">
                          {totalCustody > 0 ? "Click to collect to stock" : "No jars currently"}
                        </span>
                      </div>

                      {/* Box 2: Pending Udhaari / Balance */}
                      <div
                        className={`rounded-xl p-2.5 flex flex-col justify-between border ${
                          Number(cust.current_balance) > 0
                            ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
                            : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          {Number(cust.current_balance) > 0 ? "Pending Due (বাকি)" : "Balance Status"}
                        </span>
                        <div className="mt-1 flex items-baseline gap-1">
                          <span className="text-xl font-black leading-none">
                            {Number(cust.current_balance) > 0
                              ? formatCurrency(cust.current_balance)
                              : "₹0"}
                          </span>
                        </div>
                        <span className="text-[9px] font-medium opacity-80 mt-0.5 block truncate">
                          {Number(cust.current_balance) > 0 ? "To collect from customer" : "All payments cleared"}
                        </span>
                      </div>
                    </div>

                    {/* Contact & Address Details */}
                    <div className="text-xs space-y-1 pt-1 border-t border-border/40">
                      <div className="flex items-center justify-between flex-wrap gap-1">
                        <a
                          href={`tel:${cust.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1.5"
                        >
                          <Phone className="h-3 w-3 text-sky-500" />
                          {cust.phone}
                        </a>

                        {cust.address && (
                          <span className="text-[11px] text-muted-foreground truncate max-w-[200px] flex items-center gap-1">
                            <MapPin className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                            {cust.address}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons Toolbar on Card */}
                    <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                      <a
                        href={`tel:${cust.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 py-1.5 px-2 rounded-xl text-xs font-bold bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 inline-flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        <span>Call</span>
                      </a>

                      {totalCustody > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openCollectJarsModal(cust);
                          }}
                          className="py-1.5 px-2.5 rounded-xl text-xs font-black bg-cyan-600 hover:bg-cyan-500 text-white shadow-xs inline-flex items-center justify-center gap-1 transition-colors cursor-pointer"
                          title="Collect jars back to stock"
                        >
                          <Droplets className="h-3.5 w-3.5" />
                          <span>Return ({totalCustody})</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDirectPaymentModal(cust);
                        }}
                        className="flex-1 py-1.5 px-2 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs inline-flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      >
                        <DollarSign className="h-3.5 w-3.5" />
                        <span>Collect ₹</span>
                      </button>

                      <a
                        href={`/orders?new=true`}
                        onClick={(e) => e.stopPropagation()}
                        className="py-1.5 px-2.5 rounded-xl text-xs font-bold bg-sky-600/15 hover:bg-sky-600/25 text-sky-600 dark:text-sky-400 border border-sky-500/30 inline-flex items-center justify-center gap-1 transition-colors cursor-pointer"
                        title="Create new order"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>+ Order</span>
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="p-3 bg-card border border-border rounded-2xl flex items-center justify-between text-xs text-muted-foreground shadow-2xs">
              <span className="font-medium">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || isLoading}
                  onClick={() => {
                    const newPage = page - 1;
                    setPage(newPage);
                    loadCustomers(newPage);
                  }}
                  className="h-7 w-7 p-0 rounded-lg cursor-pointer"
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
                    loadCustomers(newPage);
                  }}
                  className="h-7 w-7 p-0 rounded-lg cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Customer Detailed Screen & History Tabs */}
        <div className={`lg:col-span-7 space-y-4 ${mobileView === "list" ? "hidden lg:block" : "block"}`}>
          {mobileView === "detail" && (
            <div className="lg:hidden flex items-center justify-between pb-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMobileView("list")}
                className="gap-1.5 text-xs font-semibold"
              >
                <ChevronLeft className="h-4 w-4" />
                Back to Directory
              </Button>
              {selectedCustomer && (
                <Badge variant="primary" className="text-xs">
                  {selectedCustomer.contact_name}
                </Badge>
              )}
            </div>
          )}

          {selectedCustomer ? (
            <div className="space-y-4">
              {/* Customer Header Profile Card */}
              <Card className="border-border shadow-xs">
                <CardHeader className="p-5 pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-foreground">
                          {selectedCustomer.contact_name}
                        </h2>
                        <Badge
                          variant={selectedCustomer.customer_type === "B2B" ? "primary" : "secondary"}
                          className="text-[10px] font-bold"
                        >
                          {selectedCustomer.customer_type === "B2B" ? "Shop / Business" : "Home Customer"}
                        </Badge>
                        <Badge
                          variant={selectedCustomer.is_active ? "outline" : "destructive"}
                          className={`text-[10px] font-bold ${
                            selectedCustomer.is_active
                              ? "text-emerald-700 bg-emerald-50 border-emerald-300"
                              : ""
                          }`}
                        >
                          {selectedCustomer.is_active ? "Active" : "Stopped / Inactive"}
                        </Badge>
                      </div>

                      {selectedCustomer.business_name && (
                        <p className="text-xs text-muted-foreground font-medium mt-1 flex items-center gap-1.5">
                          <Building className="h-3.5 w-3.5 text-primary" />
                          {selectedCustomer.business_name}
                          {selectedCustomer.gstin && (
                            <span className="text-[10px] text-muted-foreground">
                              (GSTIN: {selectedCustomer.gstin})
                            </span>
                          )}
                        </p>
                      )}
                    </div>

                    {/* Action Buttons Toolbar */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {((selectedCustomer.total_full_jars_holding || 0) +
                        (selectedCustomer.total_empty_jars_holding || 0)) > 0 && (
                        <Button
                          size="sm"
                          onClick={() => openCollectJarsModal(selectedCustomer)}
                          className="h-8 gap-1.5 text-xs bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-black active:scale-95 transition-all shadow-md shadow-cyan-600/20 cursor-pointer"
                        >
                          <Droplets className="h-3.5 w-3.5" />
                          Collect Jars (জার ফেরত নিন)
                        </Button>
                      )}

                      <Button
                        size="sm"
                        onClick={() => openDirectPaymentModal(selectedCustomer)}
                        className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold active:scale-95 transition-all shadow-xs"
                      >
                        <DollarSign className="h-3.5 w-3.5" />
                        Receive Money (টাকা জমা নিন)
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditModal(selectedCustomer)}
                        className="h-8 gap-1.5 text-xs border-border hover:bg-muted text-foreground font-medium"
                      >
                        <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                        Edit Details
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsToggleActiveOpen(true)}
                        className={`h-8 gap-1.5 text-xs border-border hover:bg-muted font-medium ${
                          selectedCustomer.is_active ? "text-rose-600 hover:text-rose-700" : "text-emerald-600"
                        }`}
                      >
                        {selectedCustomer.is_active ? (
                          <>
                            <Ban className="h-3.5 w-3.5" />
                            Stop Customer
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Start Again
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-5 pt-0 space-y-4">
                  {/* Address, Phone, Email & Delivery Instructions */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div className="rounded-2xl border-2 border-border/80 bg-card p-3.5 text-xs space-y-2 shadow-xs">
                      <div className="flex items-start gap-2.5">
                        <div className="h-8 w-8 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0 mt-0.5">
                          <MapPin className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="font-bold text-foreground text-xs uppercase tracking-wide block">ডেলিভারি ঠিকানা (Delivery Address):</span>
                          <p className="text-foreground/90 font-medium text-xs mt-0.5 break-words">{selectedCustomer.address}</p>
                        </div>
                      </div>

                      {selectedCustomer.delivery_instructions && (
                        <div className="flex items-start gap-2 pt-2 border-t border-border/60">
                          <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <span className="font-bold text-foreground text-[11px]">Instructions:</span>
                            <p className="text-muted-foreground text-[11px] mt-0.5 break-words">
                              {selectedCustomer.delivery_instructions}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border-2 border-border/80 bg-card p-3.5 text-xs space-y-2.5 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                          <div className="h-6 w-6 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                            <Phone className="h-3.5 w-3.5" />
                          </div>
                          ফোন নম্বর (Phone):
                        </span>
                        <a
                          href={`tel:${selectedCustomer.phone}`}
                          className="font-extrabold text-xs sm:text-sm text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                        >
                          {selectedCustomer.phone}
                        </a>
                      </div>

                      {selectedCustomer.email && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground font-semibold flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5 text-primary" />
                            Email:
                          </span>
                          <a
                            href={`mailto:${selectedCustomer.email}`}
                            className="font-medium text-foreground hover:text-primary transition-colors truncate max-w-[180px]"
                          >
                            {selectedCustomer.email}
                          </a>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1.5 border-t border-border/60">
                        <span className="text-muted-foreground font-medium">সর্বোচ্চ ধার (Max Udhaari):</span>
                        <span className="font-extrabold text-foreground">
                          {formatCurrency(selectedCustomer.credit_limit)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground font-medium">সর্বোচ্চ খালি জার (Max Empties):</span>
                        <span className="font-extrabold text-foreground">
                          {selectedCustomer.max_jar_limit} Bottles
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 2 VIBRANT HIGH-IMPACT CARDS (Physical Jars Held & Outstanding Udhaari) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* 1. Jars Held at Customer House */}
                    <div className="rounded-2xl border-2 border-cyan-400 dark:border-cyan-500/50 bg-gradient-to-br from-cyan-500/15 via-sky-500/10 to-blue-500/15 dark:from-cyan-950/40 dark:via-sky-950/30 dark:to-blue-950/40 p-4 space-y-2 shadow-sm transition-all">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-wider text-cyan-900 dark:text-cyan-300 flex items-center gap-1.5">
                          <Droplets className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                          গ্রাহকের কাছে মোট জার (Jars with Customer)
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-800 dark:text-cyan-200 font-extrabold">
                          বাড়িতে বর্তমান
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 flex-wrap">
                        <div className="flex items-baseline gap-2">
                          <p className="text-3xl sm:text-4xl font-black text-cyan-700 dark:text-cyan-300">
                            {(selectedCustomer.total_full_jars_holding || 0) + (selectedCustomer.total_empty_jars_holding || 0)}
                          </p>
                          <span className="text-xs font-bold text-cyan-800/80 dark:text-cyan-400/80">
                            টি জার (Jars)
                          </span>
                        </div>
                        {((selectedCustomer.total_full_jars_holding || 0) + (selectedCustomer.total_empty_jars_holding || 0)) > 0 && (
                          <button
                            type="button"
                            onClick={() => openCollectJarsModal(selectedCustomer)}
                            className="px-3 py-1.5 rounded-xl text-xs font-black bg-cyan-600 hover:bg-cyan-500 text-white shadow-xs cursor-pointer active:scale-95 transition-all flex items-center gap-1.5"
                          >
                            <Droplets className="h-3.5 w-3.5" />
                            জার ফেরত নিন (Return)
                          </button>
                        )}
                      </div>
                      <span className="text-[11px] text-cyan-800/80 dark:text-cyan-400/80 font-bold block">
                        পরের ডেলিভারিতে বা আজই ফেরত নিয়ে গুদামে জমা করা যাবে (Collect jars back to stock)
                      </span>
                    </div>

                    {/* 2. Pending Udhaari */}
                    <div
                      className={`rounded-2xl border-2 p-4 space-y-1.5 shadow-sm transition-all ${
                        Number(selectedCustomer.current_balance) > 0
                          ? "border-rose-500 dark:border-rose-500/60 bg-gradient-to-br from-rose-500/20 via-red-500/15 to-rose-500/25 dark:from-rose-950/50 dark:via-red-950/40 dark:to-rose-950/50"
                          : "border-emerald-400 dark:border-emerald-500/50 bg-gradient-to-br from-emerald-500/15 via-teal-500/10 to-emerald-500/15 dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-emerald-950/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs font-black uppercase tracking-wider flex items-center gap-1.5 ${
                            Number(selectedCustomer.current_balance) > 0
                              ? "text-rose-900 dark:text-rose-300"
                              : "text-emerald-900 dark:text-emerald-300"
                          }`}
                        >
                          <DollarSign className="h-4 w-4" />
                          বাকি ধারের টাকা (Pending Udhaari)
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-extrabold ${
                            Number(selectedCustomer.current_balance) > 0
                              ? "bg-rose-500/25 text-rose-800 dark:text-rose-200"
                              : "bg-emerald-500/25 text-emerald-800 dark:text-emerald-200"
                          }`}
                        >
                          {Number(selectedCustomer.current_balance) > 0 ? "পাওনা বাকি আছে" : "সব শোধ"}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <p
                          className={`text-3xl sm:text-4xl font-black ${
                            Number(selectedCustomer.current_balance) > 0
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-emerald-700 dark:text-emerald-300"
                          }`}
                        >
                          {formatCurrency(selectedCustomer.current_balance)}
                        </p>
                        {Number(selectedCustomer.current_balance) > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentAmount(selectedCustomer.current_balance.toString());
                              setIsPaymentModalOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer active:scale-95"
                          >
                            টাকা জমা নিন
                          </button>
                        )}
                      </div>
                      <span
                        className={`text-[11px] font-bold block ${
                          Number(selectedCustomer.current_balance) > 0
                            ? "text-rose-700/90 dark:text-rose-400/90"
                            : "text-emerald-700/90 dark:text-emerald-400/90"
                        }`}
                      >
                        {Number(selectedCustomer.current_balance) > 0 ? "Outstanding balance to collect" : "All dues settled"}
                      </span>
                    </div>
                  </div>

                  {/* Dual History Ledgers & Activity Tabs */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between border-b border-border pb-2 gap-2">
                      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-nowrap pb-1">
                        <button
                          type="button"
                          onClick={() => setActiveTab("orders")}
                          className={`text-xs font-bold pb-2 -mb-2 border-b-2 transition-all shrink-0 whitespace-nowrap touch-manipulation ${
                            activeTab === "orders"
                              ? "border-primary text-primary"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Orders & Deliveries (অর্ডার ও ডেলিভারি)
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab("payments")}
                          className={`text-xs font-bold pb-2 -mb-2 border-b-2 transition-all shrink-0 whitespace-nowrap touch-manipulation ${
                            activeTab === "payments"
                              ? "border-primary text-primary"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Payments Received (টাকা জমা)
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab("invoices")}
                          className={`text-xs font-bold pb-2 -mb-2 border-b-2 transition-all shrink-0 whitespace-nowrap touch-manipulation ${
                            activeTab === "invoices"
                              ? "border-primary text-primary"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Bills & Invoices (বিল ও রসিদ)
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab("jars")}
                          className={`text-xs font-bold pb-2 -mb-2 border-b-2 transition-all shrink-0 whitespace-nowrap touch-manipulation ${
                            activeTab === "jars"
                              ? "border-primary text-primary"
                              : "border-transparent text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          Jar Custody History (জারের হিসাব)
                        </button>
                      </div>

                      <button
                        onClick={() => loadCustomerTabData(selectedCustomer.id, activeTab)}
                        className="text-muted-foreground hover:text-foreground text-xs p-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md shrink-0 touch-manipulation"
                        title="Reload tab records"
                        aria-label="Reload tab records"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isTabLoading ? "animate-spin" : ""}`} />
                      </button>
                    </div>

                    {/* Tab 1: Orders History */}
                    {activeTab === "orders" && (
                      <div className="space-y-3.5">
                        {/* Modern High-Clarity Filter Toolbar */}
                        <div className="rounded-2xl border border-border bg-card p-3 shadow-sm space-y-2.5">
                          {/* Row 1: Quick Date Pills */}
                          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
                            <span className="text-[11px] font-bold text-muted-foreground mr-1 flex items-center gap-1 shrink-0">
                              <CalendarDays className="h-3.5 w-3.5" /> Date:
                            </span>
                            {[
                              { id: "ALL", label: "All Time (সব)" },
                              { id: "TODAY", label: "Today (আজ)" },
                              { id: "7DAYS", label: "Last 7 Days (৭ দিন)" },
                              { id: "MONTH", label: "This Month (এই মাস)" },
                              { id: "CUSTOM", label: "Custom (তারিখ)" },
                            ].map((d) => (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => setOrderDatePreset(d.id as "ALL" | "TODAY" | "7DAYS" | "MONTH" | "CUSTOM")}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                                  orderDatePreset === d.id
                                    ? "bg-blue-600 text-white shadow-xs"
                                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                                }`}
                              >
                                {d.label}
                              </button>
                            ))}
                          </div>

                          {/* Custom Date Pickers (if CUSTOM selected) */}
                          {orderDatePreset === "CUSTOM" && (
                            <div className="p-2 rounded-xl bg-muted/30 border border-border/60 flex flex-wrap items-center gap-2 text-xs">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-muted-foreground">From:</span>
                                <input
                                  type="date"
                                  value={orderFromDate}
                                  onChange={(e) => setOrderFromDate(e.target.value)}
                                  className="px-2 py-1 rounded-lg border border-border bg-background text-xs font-semibold text-foreground"
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-muted-foreground">To:</span>
                                <input
                                  type="date"
                                  value={orderToDate}
                                  onChange={(e) => setOrderToDate(e.target.value)}
                                  className="px-2 py-1 rounded-lg border border-border bg-background text-xs font-semibold text-foreground"
                                />
                              </div>
                            </div>
                          )}

                          {/* Row 2: Payment and Status Filters */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50">
                            {/* Payment Filters */}
                            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                              <span className="text-[11px] font-bold text-muted-foreground mr-1 shrink-0">
                                Payment:
                              </span>
                              {[
                                { id: "ALL", label: "All (সব)" },
                                { id: "PAID", label: "✓ Paid (পরিশোধিত)" },
                                { id: "DUE", label: "⚠️ Due (বাকি)" },
                              ].map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => setOrderPaymentFilter(p.id as "ALL" | "PAID" | "DUE")}
                                  className={`px-2 py-0.5 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                                    orderPaymentFilter === p.id
                                      ? p.id === "PAID"
                                        ? "bg-emerald-600 text-white shadow-xs"
                                        : p.id === "DUE"
                                        ? "bg-amber-600 text-white shadow-xs"
                                        : "bg-blue-600 text-white shadow-xs"
                                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                                  }`}
                                >
                                  {p.label}
                                </button>
                              ))}
                            </div>

                            {/* Status Dropdown */}
                            <div className="flex items-center gap-1.5">
                              <select
                                value={orderStatusFilter}
                                onChange={(e) => setOrderStatusFilter(e.target.value as "ALL" | "DELIVERED" | "PENDING" | "CANCELLED")}
                                className="px-2.5 py-1 rounded-lg border border-border bg-background text-xs font-semibold text-foreground"
                              >
                                <option value="ALL">All Status / সব</option>
                                <option value="DELIVERED">Delivered (সম্পন্ন)</option>
                                <option value="PENDING">Pending (বাকি)</option>
                                <option value="CANCELLED">Cancelled (বাতিল)</option>
                              </select>

                              {/* Reset Button */}
                              {(orderDatePreset !== "ALL" || orderPaymentFilter !== "ALL" || orderStatusFilter !== "ALL" || orderFromDate || orderToDate) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOrderDatePreset("ALL");
                                    setOrderPaymentFilter("ALL");
                                    setOrderStatusFilter("ALL");
                                    setOrderFromDate("");
                                    setOrderToDate("");
                                  }}
                                  className="text-xs font-bold text-rose-400 hover:text-rose-300 px-2 py-1 rounded-lg border border-rose-500/30 bg-rose-500/10 cursor-pointer"
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {(() => {
                          const today = new Date().toISOString().split("T")[0];
                          const weekAgoDate = new Date();
                          weekAgoDate.setDate(weekAgoDate.getDate() - 7);
                          const weekAgo = weekAgoDate.toISOString().split("T")[0];
                          const monthStartDate = new Date();
                          const monthStart = new Date(monthStartDate.getFullYear(), monthStartDate.getMonth(), 1).toISOString().split("T")[0];

                          const displayedOrders = customerOrders.filter((o) => {
                            if (orderStatusFilter === "DELIVERED" && o.status !== "DELIVERED") return false;
                            if (orderStatusFilter === "PENDING" && (o.status === "DELIVERED" || o.status === "CANCELLED")) return false;
                            if (orderStatusFilter === "CANCELLED" && o.status !== "CANCELLED") return false;

                            if (orderPaymentFilter === "PAID" && o.payment_status !== "PAID") return false;
                            if (orderPaymentFilter === "DUE" && o.payment_status === "PAID") return false;

                            const dDate = o.delivery_date || (o.created_at ? o.created_at.split("T")[0] : "");
                            if (orderDatePreset === "TODAY" && dDate !== today) return false;
                            if (orderDatePreset === "7DAYS" && (dDate < weekAgo || dDate > today)) return false;
                            if (orderDatePreset === "MONTH" && dDate < monthStart) return false;
                            if (orderDatePreset === "CUSTOM") {
                              if (orderFromDate && dDate < orderFromDate) return false;
                              if (orderToDate && dDate > orderToDate) return false;
                            }
                            return true;
                          });

                          if (isTabLoading) {
                            return (
                              <div className="p-8 text-center text-xs text-muted-foreground bg-muted/20 rounded-xl border border-border">
                                <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                                Loading customer orders...
                              </div>
                            );
                          }

                          if (displayedOrders.length === 0) {
                            return (
                              <div className="p-8 text-center text-xs text-muted-foreground bg-muted/20 rounded-2xl border border-dashed border-border space-y-1">
                                <Package className="h-7 w-7 mx-auto text-muted-foreground/50 mb-1" />
                                <p className="font-bold text-foreground">No matching orders found</p>
                                <p>Try clearing your date or status filters, or place an order from the Orders page.</p>
                              </div>
                            );
                          }

                          return (
                            <div className="space-y-3">
                              {displayedOrders.map((o) => {
                                const totalUnits = o.items ? o.items.reduce((s, it) => s + it.quantity, 0) : 0;
                                const jarUnits = o.items ? o.items.filter((it) => it.is_reusable_jar).reduce((s, it) => s + it.quantity, 0) : 0;
                                const isDelivered = o.status === "DELIVERED";
                                const isCancelled = o.status === "CANCELLED";
                                const formattedTime = o.created_at
                                  ? new Date(o.created_at).toLocaleString("en-IN", {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    })
                                  : o.delivery_date;

                                return (
                                  <div
                                    key={o.id}
                                    className="rounded-2xl border-2 border-border/80 bg-card p-4 shadow-sm hover:border-blue-500/50 transition-all space-y-3"
                                  >
                                    {/* Order Top Bar: Number + Date + Price */}
                                    <div className="flex items-start justify-between gap-2">
                                      <div>
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="font-mono font-bold text-xs bg-muted/60 px-2 py-0.5 rounded-md border border-border text-foreground">
                                            {o.order_number}
                                          </span>
                                          <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            {formattedTime}
                                          </span>
                                        </div>
                                      </div>

                                      <div className="text-right shrink-0">
                                        <div className="text-base sm:text-lg font-black text-sky-400">
                                          {formatCurrency(o.total_amount)}
                                        </div>
                                        <Badge
                                          variant="outline"
                                          className={`text-[10px] font-bold mt-0.5 ${
                                            o.payment_status === "PAID"
                                              ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                                              : "border-amber-500/40 text-amber-400 bg-amber-500/10"
                                          }`}
                                        >
                                          {o.payment_status === "PAID" ? "✓ Paid (পরিশোধিত)" : "⚠️ Due (বাকি)"}
                                        </Badge>
                                      </div>
                                    </div>

                                    {/* Products Ordered (High-Visibility Pills) */}
                                    <div className="rounded-xl bg-muted/30 border border-border/50 p-2.5 space-y-1.5">
                                      <div className="flex items-center justify-between text-[11px] text-muted-foreground font-semibold">
                                        <span>Items Ordered ({totalUnits} pcs):</span>
                                        {jarUnits > 0 && (
                                          <span className="text-cyan-400 font-bold flex items-center gap-1">
                                            <Droplets className="h-3 w-3" /> {jarUnits} Jars
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap gap-1.5">
                                        {o.items && o.items.length > 0 ? (
                                          o.items.map((it, idx) => (
                                            <span
                                              key={idx}
                                              className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg border ${
                                                it.is_reusable_jar
                                                  ? "bg-blue-500/15 border-blue-500/30 text-blue-300"
                                                  : "bg-muted/60 border-border text-foreground"
                                              }`}
                                            >
                                              <span>{it.is_reusable_jar ? "💧" : "📦"}</span>
                                              <span>{it.quantity} × {it.product_name}</span>
                                            </span>
                                          ))
                                        ) : (
                                          <span className="text-xs text-muted-foreground italic">No items detailed</span>
                                        )}
                                      </div>
                                    </div>

                                    {/* Footer: Driver & Delivery Status */}
                                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
                                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                                        {o.assigned_staff_name ? (
                                          <span className="inline-flex items-center gap-1 text-cyan-400 font-bold">
                                            <UserCheck className="h-3.5 w-3.5" />
                                            <span>Driver: {o.assigned_staff_name}</span>
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground italic">No driver assigned</span>
                                        )}
                                      </div>

                                      <Badge
                                        className={`text-xs font-bold py-1 px-2.5 ${
                                          isDelivered
                                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                            : isCancelled
                                            ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                                            : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                                        }`}
                                      >
                                        {isDelivered ? "✓ Delivered" : o.status.replace(/_/g, " ")}
                                      </Badge>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Tab 2: Payments Receipts */}
                    {activeTab === "payments" && (
                      <div className="rounded-xl border border-border overflow-hidden">
                        {isTabLoading ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1 text-primary" />
                            Loading payment records...
                          </div>
                        ) : customerPayments.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            No payment transactions recorded for this customer.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                                <tr>
                                  <th className="py-2.5 px-3">Receipt #</th>
                                  <th className="py-2.5 px-3">Date</th>
                                  <th className="py-2.5 px-3">Method</th>
                                  <th className="py-2.5 px-3">Ref / UTR</th>
                                  <th className="py-2.5 px-3 text-right">Amount</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/60">
                                {customerPayments.map((p) => (
                                  <tr key={p.id} className="hover:bg-muted/20">
                                    <td className="py-2.5 px-3 font-semibold text-foreground">
                                      {p.payment_number}
                                    </td>
                                    <td className="py-2.5 px-3 text-muted-foreground">
                                      {p.payment_date}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <Badge variant="outline" className="text-[9px] py-0">
                                        {p.payment_method}
                                      </Badge>
                                    </td>
                                    <td className="py-2.5 px-3 text-muted-foreground truncate max-w-[120px]">
                                      {p.reference_number || "—"}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-extrabold text-emerald-600 dark:text-emerald-400">
                                      +{formatCurrency(p.amount)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab 3: Invoices & A/R */}
                    {activeTab === "invoices" && (
                      <div className="rounded-xl border border-border overflow-hidden">
                        {isTabLoading ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1 text-primary" />
                            Loading invoices...
                          </div>
                        ) : customerInvoices.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            No billing invoices found for this customer.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                                <tr>
                                  <th className="py-2.5 px-3">Invoice #</th>
                                  <th className="py-2.5 px-3">Date</th>
                                  <th className="py-2.5 px-3 text-right">Total</th>
                                  <th className="py-2.5 px-3 text-right">Balance Due</th>
                                  <th className="py-2.5 px-3 text-center">Status</th>
                                  <th className="py-2.5 px-3 text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/60">
                                {customerInvoices.map((inv) => (
                                  <tr key={inv.id} className="hover:bg-muted/20">
                                    <td className="py-2.5 px-3 font-semibold text-foreground">
                                      {inv.invoice_number}
                                    </td>
                                    <td className="py-2.5 px-3 text-muted-foreground">
                                      {inv.invoice_date}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-medium text-foreground">
                                      {formatCurrency(inv.total_amount)}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-bold text-rose-600 dark:text-rose-400">
                                      {formatCurrency(inv.balance_due)}
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <Badge
                                        variant={
                                          inv.status === "PAID"
                                            ? "success"
                                            : inv.status === "PARTIALLY_PAID"
                                            ? "secondary"
                                            : inv.status === "CANCELLED"
                                            ? "outline"
                                            : "destructive"
                                        }
                                        className="text-[9px] py-0"
                                      >
                                        {inv.status}
                                      </Badge>
                                    </td>
                                    <td className="py-2.5 px-3 text-right">
                                      {Number(inv.balance_due) > 0 && (
                                        <button
                                          onClick={() =>
                                            openDirectPaymentModal(selectedCustomer, inv.id, Number(inv.balance_due))
                                          }
                                          className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 underline"
                                        >
                                          Pay Invoice
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab 4: Jar Custody Movements */}
                    {activeTab === "jars" && (
                      <div className="rounded-xl border border-border overflow-hidden">
                        {isTabLoading ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1 text-primary" />
                            Loading jar movements...
                          </div>
                        ) : customerJarMovements.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            No physical jar custody movements logged for this customer location.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                                <tr>
                                  <th className="py-2.5 px-3">Date</th>
                                  <th className="py-2.5 px-3">Movement Type</th>
                                  <th className="py-2.5 px-3">Condition</th>
                                  <th className="py-2.5 px-3 text-right">Qty</th>
                                  <th className="py-2.5 px-3">Notes</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/60">
                                {customerJarMovements.map((m) => (
                                  <tr key={m.id} className="hover:bg-muted/20">
                                    <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                                      {m.created_at.slice(0, 10)}
                                    </td>
                                    <td className="py-2.5 px-3 font-medium text-foreground">
                                      {m.movement_type}
                                    </td>
                                    <td className="py-2.5 px-3 text-muted-foreground text-[11px]">
                                      {m.condition_from} → {m.condition_to}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-extrabold text-blue-600 dark:text-blue-400">
                                      {m.quantity}
                                    </td>
                                    <td className="py-2.5 px-3 text-muted-foreground text-[11px] truncate max-w-[140px]">
                                      {m.notes || "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground space-y-3">
              <Users className="h-10 w-10 mx-auto text-muted-foreground/30" />
              <p className="font-semibold text-foreground">No Customer Selected</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Select a client account from the directory to review their detailed jar custody, order history, billing invoices, and collect payments.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add Customer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Register Customer Account
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Speed Presets Bar */}
            <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/20 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-sky-950 dark:text-sky-200 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-sky-600 fill-sky-500/30" />
                  1-Click Fast Fill Templates
                </span>
                <span className="text-[10px] text-sky-700 dark:text-sky-300">Prefills standard limits & info</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => applyQuickCustomerTemplate("B2C")}
                  className="flex-1 py-1.5 px-2 rounded-lg text-xs font-bold bg-card text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-800 hover:bg-primary hover:text-white shadow-xs active:scale-95 transition-all cursor-pointer"
                >
                  🏠 Quick Home B2C
                </button>
                <button
                  type="button"
                  onClick={() => applyQuickCustomerTemplate("B2B")}
                  className="flex-1 py-1.5 px-2 rounded-lg text-xs font-bold bg-card text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-800 hover:bg-primary hover:text-white shadow-xs active:scale-95 transition-all cursor-pointer"
                >
                  🏢 Quick Corporate B2B
                </button>
              </div>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-4">
              {/* Type toggle */}
              <div className="flex rounded-xl bg-muted p-1 border border-border">
                <button
                  type="button"
                  onClick={() => {
                    setAddCustomerType("B2C");
                    setAddMaxJarLimit("5");
                    setAddCreditLimit("1000");
                    setAddPaymentTerms("0");
                  }}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    addCustomerType === "B2C"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Residential (B2C)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddCustomerType("B2B");
                    setAddMaxJarLimit("25");
                    setAddCreditLimit("10000");
                    setAddPaymentTerms("30");
                  }}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    addCustomerType === "B2B"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Commercial / Corporate (B2B)
                </button>
              </div>

              {addCustomerType === "B2B" && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">
                      Business / Institution Name *
                    </label>
                    <span className="text-[10px] text-muted-foreground">Required for B2B</span>
                  </div>
                  <Input
                    placeholder="e.g. Apex Tech Park Pvt Ltd"
                    value={addBusinessName}
                    onChange={(e) => setAddBusinessName(e.target.value)}
                    required
                    className="text-xs"
                  />
                  {addBusinessName.trim().length === 0 && (
                    <span className="text-[10px] text-amber-500 font-medium block">
                      ⚠️ Business name is required for corporate customers
                    </span>
                  )}
                </div>
              )}

              {/* Essential Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">
                      Contact Person Name *
                    </label>
                    <span className="text-[10px] text-muted-foreground">Min. 2 chars</span>
                  </div>
                  <Input
                    placeholder="e.g. Rajesh Varma"
                    value={addContactName}
                    onChange={(e) => setAddContactName(e.target.value)}
                    required
                    className="text-xs"
                  />
                  {addContactName.trim().length > 0 && addContactName.trim().length < 2 && (
                    <span className="text-[10px] text-amber-500 font-medium block">
                      ⚠️ Name must be at least 2 characters
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">
                      Phone Number *
                    </label>
                    <span className="text-[10px] text-muted-foreground">Min. 6 digits</span>
                  </div>
                  <Input
                    placeholder="e.g. 9845011223 or 676878"
                    value={addPhone}
                    onChange={(e) => setAddPhone(e.target.value)}
                    required
                    className="text-xs"
                  />
                  {addPhone.trim().length > 0 && addPhone.trim().length < 6 && (
                    <span className="text-[10px] text-amber-500 font-medium block">
                      ⚠️ Needs at least 6 digits ({addPhone.trim().length}/6)
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    Delivery Physical Address *
                  </label>
                  <span className="text-[10px] text-muted-foreground">Min. 3 chars</span>
                </div>
                <Input
                  placeholder="Street address, building, floor, flat/unit #"
                  value={addAddress}
                  onChange={(e) => setAddAddress(e.target.value)}
                  required
                  className="text-xs"
                />
                {addAddress.trim().length > 0 && addAddress.trim().length < 3 && (
                  <span className="text-[10px] text-amber-500 font-medium block">
                    ⚠️ Address must be at least 3 characters
                  </span>
                )}
              </div>

              {/* Progressive Disclosure: Collapsible Advanced Fields */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddAdvanced((prev) => !prev)}
                  className="text-xs font-semibold text-primary hover:text-primary/80 flex items-center gap-1.5 py-1 cursor-pointer select-none"
                >
                  {showAddAdvanced ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  {showAddAdvanced ? "Hide Extra Details" : "+ More Options (GST, Jar & Credit Limits, Email)"}
                </button>

                {showAddAdvanced && (
                  <div className="mt-2.5 p-3 rounded-xl bg-muted/30 border border-border space-y-3 animate-in fade-in-50 duration-200">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-foreground">
                          Email Address (Optional)
                        </label>
                        <Input
                          type="email"
                          placeholder="e.g. admin@example.com"
                          value={addEmail}
                          onChange={(e) => setAddEmail(e.target.value)}
                          className="text-xs"
                        />
                      </div>

                      {addCustomerType === "B2B" && (
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-foreground">
                            GSTIN (Optional)
                          </label>
                          <Input
                            placeholder="e.g. 29AABCU9603R1ZX"
                            value={addGstin}
                            onChange={(e) => setAddGstin(e.target.value)}
                            className="text-xs"
                          />
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground">
                        Delivery Instructions (Optional)
                      </label>
                      <Input
                        placeholder="e.g. Security check at gate 2, call before arrival"
                        value={addDeliveryInstructions}
                        onChange={(e) => setAddDeliveryInstructions(e.target.value)}
                        className="text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-foreground">
                          Max Jar Limit
                        </label>
                        <Input
                          type="number"
                          value={addMaxJarLimit}
                          onChange={(e) => setAddMaxJarLimit(e.target.value)}
                          min={1}
                          className="text-xs"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-foreground">
                          Credit Limit (₹)
                        </label>
                        <Input
                          type="number"
                          value={addCreditLimit}
                          onChange={(e) => setAddCreditLimit(e.target.value)}
                          min={0}
                          className="text-xs"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-foreground">
                          Payment Terms
                        </label>
                        <Input
                          type="number"
                          value={addPaymentTerms}
                          onChange={(e) => setAddPaymentTerms(e.target.value)}
                          min={0}
                          placeholder="Days"
                          className="text-xs"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground">
                        Internal Notes (Optional)
                      </label>
                      <Input
                        placeholder="e.g. Preferred delivery schedule"
                        value={addNotes}
                        onChange={(e) => setAddNotes(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                  </div>
                )}
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
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-4"
                >
                  {isSubmitting ? "Registering..." : "Save Customer"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {isEditModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-primary" />
                Edit Customer Account ({selectedCustomer.customer_type})
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateCustomer} className="space-y-4">
              {selectedCustomer.customer_type === "B2B" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">
                      Business / Institution Name *
                    </label>
                    <Input
                      value={editBusinessName}
                      onChange={(e) => setEditBusinessName(e.target.value)}
                      required
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">
                      GSTIN (Optional)
                    </label>
                    <Input
                      value={editGstin}
                      onChange={(e) => setEditGstin(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Contact Person Name *
                  </label>
                  <Input
                    value={editContactName}
                    onChange={(e) => setEditContactName(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Phone Number *
                  </label>
                  <Input
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Email Address
                </label>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Delivery Address *
                </label>
                <Input
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Delivery Instructions
                </label>
                <Input
                  value={editDeliveryInstructions}
                  onChange={(e) => setEditDeliveryInstructions(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Max Jar Limit
                  </label>
                  <Input
                    type="number"
                    value={editMaxJarLimit}
                    onChange={(e) => setEditMaxJarLimit(e.target.value)}
                    min={1}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Credit Limit (₹)
                  </label>
                  <Input
                    type="number"
                    value={editCreditLimit}
                    onChange={(e) => setEditCreditLimit(e.target.value)}
                    min={0}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Payment Terms
                  </label>
                  <Input
                    type="number"
                    value={editPaymentTerms}
                    onChange={(e) => setEditPaymentTerms(e.target.value)}
                    min={0}
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Internal Notes
                </label>
                <Input
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="text-xs"
                />
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
                  {isSubmitting ? "Saving..." : "Update Customer"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Collect Direct Payment Modal */}
      {isPaymentModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-emerald-600" />
                Collect Customer Payment
              </h3>
              <button
                onClick={() => setIsPaymentModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Customer Summary Banner */}
            <div className="rounded-xl bg-muted/40 p-3 border border-border text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-muted-foreground">Customer:</span>
                <span className="font-bold text-foreground">{selectedCustomer.contact_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium text-muted-foreground">Outstanding Balance (A/R):</span>
                <span
                  className={`font-extrabold ${
                    Number(selectedCustomer.current_balance) > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600"
                  }`}
                >
                  {formatCurrency(selectedCustomer.current_balance)}
                </span>
              </div>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-4">
              {/* Optional Invoice Allocation */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Allocate to Invoice (Optional)
                </label>
                <select
                  value={paymentInvoiceId}
                  onChange={(e) => {
                    const invId = e.target.value;
                    setPaymentInvoiceId(invId);
                    if (invId) {
                      const found = customerInvoices.find((i) => i.id === invId);
                      if (found && Number(found.balance_due) > 0) {
                        setPaymentAmount(String(found.balance_due));
                      }
                    }
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                >
                  <option value="">-- General Account Settlement (Auto A/R) --</option>
                  {customerInvoices
                    .filter((inv) => Number(inv.balance_due) > 0)
                    .map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number} ({inv.invoice_date}) — Due: {formatCurrency(inv.balance_due)}
                      </option>
                    ))}
                </select>
              </div>

              {/* Amount */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Payment Amount (₹) *
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 500"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  required
                  className="text-xs font-bold"
                />
              </div>

              {/* Payment Method */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Payment Method *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(["UPI", "CASH", "BANK_TRANSFER", "CHEQUE"] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all text-center ${
                        paymentMethod === method
                          ? "border-primary bg-primary/10 text-primary font-bold"
                          : "border-border bg-card text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {method.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Payment Date & Reference */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Collection Date
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
                    Reference / UTR #
                  </label>
                  <Input
                    placeholder="e.g. UPI-9283741"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Receipt Notes (Optional)
                </label>
                <Input
                  placeholder="e.g. Office cash collection by owner"
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
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                >
                  {isSubmitting ? "Processing..." : "Confirm & Post Ledger"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Collect Returned Jars Modal (Direct to Inventory Stock) */}
      {isReturnJarsOpen && customerForReturn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-card border-2 border-cyan-500/40 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center shadow-md shadow-cyan-500/25">
                  <Droplets className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-foreground leading-tight">
                    Collect Returned Jars
                  </h3>
                  <p className="text-[11px] font-semibold text-cyan-600 dark:text-cyan-400">
                    জার ফেরত গ্রহণ ও সরাসরি গুদামে জমা
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsReturnJarsOpen(false)}
                className="text-muted-foreground hover:text-foreground h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center font-bold text-base transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Customer Summary & Current Holding Card */}
            <div className="rounded-2xl bg-cyan-500/10 border border-cyan-500/25 p-3.5 text-xs space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-800 dark:text-cyan-300">
                    Customer Account
                  </span>
                  <p className="font-black text-sm text-foreground mt-0.5">
                    {customerForReturn.contact_name}
                  </p>
                  {customerForReturn.business_name && (
                    <p className="text-[11px] text-muted-foreground font-semibold">
                      {customerForReturn.business_name}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-800 dark:text-cyan-300">
                    Jars at House
                  </span>
                  <div className="flex items-baseline justify-end gap-1 mt-0.5">
                    <span className="text-2xl font-black text-cyan-600 dark:text-cyan-400">
                      {(Number(customerForReturn.total_full_jars_holding || 0) + Number(customerForReturn.total_empty_jars_holding || 0))}
                    </span>
                    <span className="text-xs font-bold text-cyan-700 dark:text-cyan-300">Jars</span>
                  </div>
                </div>
              </div>

              {customerForReturn.address && (
                <p className="text-[11px] text-muted-foreground truncate border-t border-cyan-500/15 pt-1.5 flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0 text-cyan-500" />
                  {customerForReturn.address}
                </p>
              )}
            </div>

            <form onSubmit={handleConfirmJarReturn} className="space-y-4">
              {/* Return Quantity Selector with Stepper & Presets */}
              {(() => {
                const totalCustJars =
                  Number(customerForReturn.total_full_jars_holding || 0) +
                  Number(customerForReturn.total_empty_jars_holding || 0);

                return (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-foreground">
                        Number of Jars Collected (কয়টি জার ফেরত নিলেন) *
                      </label>
                      <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400">
                        Max available: {totalCustJars}
                      </span>
                    </div>

                    {/* Stepper Input */}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setReturnQty((prev) => Math.max(1, prev - 1))}
                        disabled={returnQty <= 1}
                        className="h-12 w-12 rounded-2xl bg-muted border border-border text-foreground font-black text-lg flex items-center justify-center hover:bg-muted/80 disabled:opacity-40 active:scale-95 transition-all cursor-pointer"
                      >
                        -
                      </button>

                      <div className="flex-1 relative">
                        <Input
                          type="number"
                          min={1}
                          max={Math.max(1, totalCustJars)}
                          value={returnQty}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (isNaN(val)) setReturnQty(1);
                            else setReturnQty(Math.min(totalCustJars, Math.max(1, val)));
                          }}
                          className="h-12 text-center text-xl font-black text-foreground rounded-2xl border-2 border-cyan-500/40 focus:border-cyan-500"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground pointer-events-none">
                          JARS
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => setReturnQty((prev) => Math.min(totalCustJars, prev + 1))}
                        disabled={returnQty >= totalCustJars}
                        className="h-12 w-12 rounded-2xl bg-muted border border-border text-foreground font-black text-lg flex items-center justify-center hover:bg-muted/80 disabled:opacity-40 active:scale-95 transition-all cursor-pointer"
                      >
                        +
                      </button>
                    </div>

                    {/* Fast Preset Chips */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold text-muted-foreground mr-1">Quick:</span>
                      {[1, 2, 3, 5].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          disabled={preset > totalCustJars}
                          onClick={() => setReturnQty(preset)}
                          className={`px-3 py-1 text-xs font-bold rounded-xl border transition-all cursor-pointer active:scale-95 ${
                            returnQty === preset
                              ? "bg-cyan-500 text-white border-cyan-500 shadow-sm shadow-cyan-500/25"
                              : "bg-muted/60 hover:bg-muted border-border text-foreground disabled:opacity-30 disabled:pointer-events-none"
                          }`}
                        >
                          {preset}
                        </button>
                      ))}

                      {totalCustJars > 0 && (
                        <button
                          type="button"
                          onClick={() => setReturnQty(totalCustJars)}
                          className={`ml-auto px-3 py-1 text-xs font-black rounded-xl border transition-all cursor-pointer active:scale-95 ${
                            returnQty === totalCustJars
                              ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white border-cyan-500 shadow-sm"
                              : "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/20"
                          }`}
                        >
                          All ({totalCustJars} Jars)
                        </button>
                      )}
                    </div>

                    {/* Real-Time Custody Calculation */}
                    <div className="p-3 rounded-2xl bg-muted/50 border border-border space-y-1.5 text-xs">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Current Jars at Customer House:</span>
                        <span className="font-bold text-foreground">{totalCustJars} Jars</span>
                      </div>
                      <div className="flex items-center justify-between text-rose-600 dark:text-rose-400 font-semibold">
                        <span>Minus Collected Jars:</span>
                        <span className="font-bold">-{returnQty} Jars</span>
                      </div>
                      <div className="flex items-center justify-between pt-1.5 border-t border-border font-black text-sm">
                        <span className="text-foreground">Remaining Customer Balance:</span>
                        <span className="text-cyan-600 dark:text-cyan-400">
                          {Math.max(0, totalCustJars - returnQty)} Jars
                        </span>
                      </div>
                    </div>

                    {/* Automatic Warehouse Deposit Banner */}
                    <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-start gap-2.5 text-xs">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="font-bold text-emerald-800 dark:text-emerald-300">
                          Automatic Warehouse Stock Deposit
                        </p>
                        <p className="text-[11px] text-emerald-700/90 dark:text-emerald-400/90 font-medium leading-relaxed">
                          These <span className="font-black text-emerald-600 dark:text-emerald-300">+{returnQty} jars</span> will be automatically added into your warehouse inventory stock balance immediately upon confirmation.
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Optional Notes */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Collection Notes (ঐচ্ছিক মন্তব্য)
                </label>
                <Input
                  placeholder="e.g. Returned directly to delivery staff / drop off at store"
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  className="text-xs"
                />
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsReturnJarsOpen(false)}
                  disabled={isSubmittingReturn}
                  className="rounded-xl text-xs cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmittingReturn || returnQty <= 0}
                  className="bg-gradient-to-r from-cyan-600 via-teal-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-black rounded-xl shadow-md shadow-cyan-600/20 active:scale-95 transition-all cursor-pointer"
                >
                  {isSubmittingReturn ? "Depositing..." : `Confirm Return (+${returnQty} to Stock)`}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Deactivation / Reactivation Dialog */}
      {selectedCustomer && (
        <ConfirmDialog
          isOpen={isToggleActiveOpen}
          onClose={() => setIsToggleActiveOpen(false)}
          onConfirm={handleToggleActive}
          title={
            selectedCustomer.is_active
              ? `Deactivate ${selectedCustomer.contact_name}?`
              : `Reactivate ${selectedCustomer.contact_name}?`
          }
          description={
            selectedCustomer.is_active
              ? "Deactivating will prevent new delivery dispatches to this account. Historical orders, payments, invoices, and jar custody balances are strictly preserved."
              : "Reactivating will restore this client account for active route delivery dispatches and orders."
          }
          confirmLabel={selectedCustomer.is_active ? "Deactivate Account" : "Reactivate Account"}
          variant={selectedCustomer.is_active ? "destructive" : "primary"}
          isLoading={isSubmitting}
        />
      )}
    </div>
  );
}
