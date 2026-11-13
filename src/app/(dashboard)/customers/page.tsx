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
  ShieldCheck,
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

// Module-level client cache for instant zero-latency customer navigation
let cachedCustomersState: {
  key: string;
  items: CustomerRecord[];
  total: number;
  totalPages: number;
} | null = null;

export default function CustomersPage() {
  const { addToast } = useToast();

  // Directory Data with instant cache initialization
  const [customers, setCustomers] = React.useState<CustomerRecord[]>(() => {
    return cachedCustomersState?.items || [];
  });
  const [selectedCustomer, setSelectedCustomer] = React.useState<CustomerRecord | null>(() => {
    return cachedCustomersState?.items?.[0] || null;
  });
  const [isLoading, setIsLoading] = React.useState<boolean>(() => !cachedCustomersState);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<"ALL" | "B2C" | "B2B">("ALL");
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE");
  const [hasBalanceFilter, setHasBalanceFilter] = React.useState(false);
  const [mobileView, setMobileView] = React.useState<"list" | "detail">("list");
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(() => cachedCustomersState?.totalPages || 1);
  const [totalCount, setTotalCount] = React.useState(() => cachedCustomersState?.total || 0);

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

  // Load Customers
  const loadCustomers = React.useCallback(async (targetPage = page) => {
    const cacheKey = `${searchQuery}-${typeFilter}-${statusFilter}-${hasBalanceFilter}-${targetPage}`;
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

        cachedCustomersState = {
          key: cacheKey,
          items: res.data.items,
          total: res.data.total || 0,
          totalPages: res.data.totalPages || 1,
        };

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
      addToast({
        type: "success",
        title: "Customer Registered",
        message: `Registered ${res.data.contact_name} successfully.`,
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
      loadCustomers(1);
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
      await loadCustomers(page);
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
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Customer Accounts & Directory
            </h1>
            <Badge variant="primary" className="text-xs">
              {totalCount} Total Accounts
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Internal customer master registry, empty jar reconciliation, outstanding A/R, and direct payment collection.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedCustomer && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDirectPaymentModal(selectedCustomer)}
              className="gap-1.5 text-xs font-semibold border-border hover:bg-muted text-foreground"
            >
              <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Collect Payment
            </Button>
          )}

          <Button
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
          >
            <Plus className="h-4 w-4" />
            Add Customer
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
                placeholder="Search by name, company, or phone..."
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
                All Types
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
                B2C
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
                B2B
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
                Inactive
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
                  Unpaid A/R Only
                </span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Two-Column Master-Detail Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Customer Directory List */}
        <div className={`lg:col-span-5 space-y-3 ${mobileView === "detail" ? "hidden lg:block" : "block"}`}>
          <Card className="border-border shadow-xs">
            <CardHeader className="p-3.5 border-b border-border flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                  Customer Directory ({totalCount})
                </span>
              </div>
              <button
                onClick={() => loadCustomers(page)}
                className="text-muted-foreground hover:text-foreground text-xs p-1"
                title="Refresh list"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            </CardHeader>

            <CardContent className="p-0">
              <div className="divide-y divide-border/60 max-h-[640px] overflow-y-auto">
                {isLoading ? (
                  <div className="p-8 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                    <span>Loading customer accounts...</span>
                  </div>
                ) : customers.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground space-y-3">
                    <Users className="h-8 w-8 mx-auto text-muted-foreground/40" />
                    <p className="font-semibold text-foreground">No customers found</p>
                    <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">
                      {searchQuery || typeFilter !== "ALL" || hasBalanceFilter
                        ? "Try clearing or modifying your search and filter criteria."
                        : "Click 'Add Customer' above to register your first client account."}
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
                        className={`p-3.5 cursor-pointer transition-all ${
                          isSelected
                            ? "bg-primary/10 border-l-4 border-primary"
                            : "hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h3 className="text-xs font-bold text-foreground truncate">
                                {cust.contact_name}
                              </h3>
                              <Badge
                                variant={cust.customer_type === "B2B" ? "primary" : "secondary"}
                                className="text-[9px] py-0 px-1 font-semibold"
                              >
                                {cust.customer_type}
                              </Badge>
                              {!cust.is_active && (
                                <Badge variant="outline" className="text-[9px] py-0 text-muted-foreground border-muted-foreground/30">
                                  Inactive
                                </Badge>
                              )}
                            </div>

                            {cust.business_name && (
                              <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                                <Building className="h-3 w-3 shrink-0" />
                                {cust.business_name}
                              </p>
                            )}

                            <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1 truncate">
                              <Phone className="h-3 w-3 shrink-0 text-muted-foreground" />
                              {cust.phone}
                            </p>

                            {/* Mobile Quick Actions */}
                            <div className="flex items-center gap-2 mt-2 pt-1 border-t border-border/40 sm:hidden">
                              <a
                                href={`tel:${cust.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 px-2 py-1 rounded-md"
                              >
                                <Phone className="h-3 w-3" />
                                Call
                              </a>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDirectPaymentModal(cust);
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-md"
                              >
                                <DollarSign className="h-3 w-3" />
                                Collect ₹
                              </button>
                              <span className="ml-auto text-[10px] font-bold text-muted-foreground flex items-center gap-0.5">
                                View <ChevronRight className="h-3 w-3" />
                              </span>
                            </div>
                          </div>

                          <div className="text-right shrink-0 space-y-1">
                            <span className="text-xs font-extrabold text-foreground block">
                              {totalCustody} Jars
                            </span>
                            {Number(cust.current_balance) > 0 ? (
                              <Badge variant="destructive" className="text-[9px] py-0 font-bold">
                                Due: {formatCurrency(cust.current_balance)}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-[9px] py-0 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                              >
                                Paid Up
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                  <span>
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
                        loadCustomers(newPage);
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
                          className="text-[10px]"
                        >
                          {selectedCustomer.customer_type} Account
                        </Badge>
                        <Badge
                          variant={selectedCustomer.is_active ? "outline" : "destructive"}
                          className={`text-[10px] ${
                            selectedCustomer.is_active
                              ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                              : ""
                          }`}
                        >
                          {selectedCustomer.is_active ? "Active Client" : "Deactivated"}
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
                      <Button
                        size="sm"
                        onClick={() => openDirectPaymentModal(selectedCustomer)}
                        className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                      >
                        <DollarSign className="h-3.5 w-3.5" />
                        Collect Payment
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditModal(selectedCustomer)}
                        className="h-8 gap-1.5 text-xs border-border hover:bg-muted text-foreground"
                      >
                        <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                        Edit
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsToggleActiveOpen(true)}
                        className={`h-8 gap-1.5 text-xs border-border hover:bg-muted ${
                          selectedCustomer.is_active ? "text-rose-600 hover:text-rose-700" : "text-emerald-600"
                        }`}
                      >
                        {selectedCustomer.is_active ? (
                          <>
                            <Ban className="h-3.5 w-3.5" />
                            Deactivate
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Reactivate
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-5 pt-0 space-y-4">
                  {/* Address, Phone, Email & Delivery Instructions */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs space-y-1.5">
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <span className="font-semibold text-foreground">Delivery Address:</span>
                          <p className="text-muted-foreground mt-0.5 break-words">{selectedCustomer.address}</p>
                        </div>
                      </div>

                      {selectedCustomer.delivery_instructions && (
                        <div className="flex items-start gap-2 pt-2 border-t border-border/60">
                          <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <span className="font-semibold text-foreground">Instructions:</span>
                            <p className="text-muted-foreground mt-0.5 break-words">
                              {selectedCustomer.delivery_instructions}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 text-primary" />
                          Phone:
                        </span>
                        <a
                          href={`tel:${selectedCustomer.phone}`}
                          className="font-semibold text-foreground hover:text-primary transition-colors"
                        >
                          {selectedCustomer.phone}
                        </a>
                      </div>

                      {selectedCustomer.email && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground flex items-center gap-1.5">
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

                      <div className="flex items-center justify-between pt-1 border-t border-border/60">
                        <span className="text-muted-foreground">Credit Limit:</span>
                        <span className="font-semibold text-foreground">
                          {formatCurrency(selectedCustomer.credit_limit)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Max Allowed Jars:</span>
                        <span className="font-semibold text-foreground">
                          {selectedCustomer.max_jar_limit} Jars
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 4 KPI Summary Cards: Full, Empty, Damaged, Outstanding A/R */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-border bg-card p-3 space-y-1 shadow-2xs">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                        <Package className="h-3 w-3 text-blue-500" />
                        Full Jars Held
                      </span>
                      <p className="text-lg font-extrabold text-blue-600 dark:text-blue-400">
                        {selectedCustomer.total_full_jars_holding}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-3 space-y-1 shadow-2xs">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                        <Package className="h-3 w-3 text-amber-500" />
                        Empty Jars Held
                      </span>
                      <p className="text-lg font-extrabold text-amber-600 dark:text-amber-400">
                        {selectedCustomer.total_empty_jars_holding}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-3 space-y-1 shadow-2xs">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                        <AlertCircle className="h-3 w-3 text-rose-500" />
                        Damaged Jars
                      </span>
                      <p className="text-lg font-extrabold text-rose-600 dark:text-rose-400">
                        {selectedCustomer.total_damaged_jars_holding || 0}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-card p-3 space-y-1 shadow-2xs">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                        <DollarSign className="h-3 w-3 text-emerald-500" />
                        Unpaid Invoices (A/R)
                      </span>
                      <p
                        className={`text-lg font-extrabold ${
                          Number(selectedCustomer.current_balance) > 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {formatCurrency(selectedCustomer.current_balance)}
                      </p>
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
                          Order History
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
                          Payment Receipts
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
                          Invoices & A/R
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
                          Jar Custody Movements
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
                      <div className="rounded-xl border border-border overflow-hidden">
                        {isTabLoading ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-1 text-primary" />
                            Loading customer orders...
                          </div>
                        ) : customerOrders.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground">
                            No orders recorded for this customer.
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-muted/40 text-muted-foreground border-b border-border">
                                <tr>
                                  <th className="py-2.5 px-3">Order #</th>
                                  <th className="py-2.5 px-3">Date</th>
                                  <th className="py-2.5 px-3 text-right">Amount</th>
                                  <th className="py-2.5 px-3 text-center">Delivery</th>
                                  <th className="py-2.5 px-3 text-center">Payment</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/60">
                                {customerOrders.map((o) => (
                                  <tr key={o.id} className="hover:bg-muted/20">
                                    <td className="py-2.5 px-3 font-semibold text-foreground">
                                      {o.order_number}
                                    </td>
                                    <td className="py-2.5 px-3 text-muted-foreground">
                                      {o.order_date}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-semibold text-foreground">
                                      {formatCurrency(o.total_amount)}
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <Badge
                                        variant={
                                          o.status === "DELIVERED"
                                            ? "success"
                                            : o.status === "CANCELLED"
                                            ? "destructive"
                                            : "outline"
                                        }
                                        className="text-[9px] py-0"
                                      >
                                        {o.status}
                                      </Badge>
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <Badge
                                        variant={
                                          o.payment_status === "PAID"
                                            ? "success"
                                            : o.payment_status === "PARTIALLY_PAID"
                                            ? "secondary"
                                            : "destructive"
                                        }
                                        className="text-[9px] py-0"
                                      >
                                        {o.payment_status}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
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
                Register Internal Customer Account
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-4">
              {/* Type toggle */}
              <div className="flex rounded-xl bg-muted p-1 border border-border">
                <button
                  type="button"
                  onClick={() => setAddCustomerType("B2C")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    addCustomerType === "B2C"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Residential (B2C)
                </button>
                <button
                  type="button"
                  onClick={() => setAddCustomerType("B2B")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                    addCustomerType === "B2B"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Commercial / Corporate (B2B)
                </button>
              </div>

              {addCustomerType === "B2B" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">
                      Business / Institution Name *
                    </label>
                    <Input
                      placeholder="e.g. Apex Tech Park Pvt Ltd"
                      value={addBusinessName}
                      onChange={(e) => setAddBusinessName(e.target.value)}
                      required
                      className="text-xs"
                    />
                  </div>

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
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Contact Person Name *
                  </label>
                  <Input
                    placeholder="e.g. Rajesh Varma"
                    value={addContactName}
                    onChange={(e) => setAddContactName(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">
                    Phone Number *
                  </label>
                  <Input
                    placeholder="e.g. 9845011223"
                    value={addPhone}
                    onChange={(e) => setAddPhone(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>
              </div>

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

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Delivery Physical Address *
                </label>
                <Input
                  placeholder="Street address, building, floor, landmark"
                  value={addAddress}
                  onChange={(e) => setAddAddress(e.target.value)}
                  required
                  className="text-xs"
                />
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
