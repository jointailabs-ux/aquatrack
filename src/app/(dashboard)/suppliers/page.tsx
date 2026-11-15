"use client";

import * as React from "react";
import Link from "next/link";
import {
  Building2,
  Plus,
  Search,
  Phone,
  Mail,
  MapPin,
  RotateCcw,
  Receipt,
  History,
  RefreshCw,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Dialog } from "@/components/ui/Dialog";
import { LoadingState } from "@/components/ui/LoadingState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { getSuppliers, createSupplier, updateSupplier } from "@/modules/suppliers/supplier.service";
import {
  SupplierRecord,
  SupplierInput,
  UpdateSupplierInput,
} from "@/modules/suppliers/supplier.schema";
import { getPurchases, getSupplierPayments } from "@/modules/purchases/purchase.service";
import { PurchaseRecord, SupplierPaymentRecord } from "@/modules/purchases/purchase.schema";
import { formatCurrency } from "@/lib/utils";

const SUPPLIERS_STORAGE_KEY = "aquatrack_suppliers_cache_v2";

let cachedSuppliersState: {
  items: SupplierRecord[];
  timestamp: number;
} | null = null;

function getInitialSuppliers(): SupplierRecord[] {
  if (cachedSuppliersState && cachedSuppliersState.items.length > 0) {
    return cachedSuppliersState.items;
  }
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem(SUPPLIERS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed?.items)) {
          cachedSuppliersState = parsed;
          return parsed.items;
        }
      }
    } catch {
      // Ignore cache error
    }
  }
  return [];
}

export default function SuppliersPage() {
  const { addToast } = useToast();
  const initialData = React.useMemo(() => getInitialSuppliers(), []);
  const [suppliers, setSuppliers] = React.useState<SupplierRecord[]>(initialData);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(initialData.length === 0);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // Add Supplier Modal
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [name, setName] = React.useState("");
  const [contactPerson, setContactPerson] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [gstin, setGstin] = React.useState("");
  const [paymentTermsDays, setPaymentTermsDays] = React.useState("15");

  // Edit Supplier Modal
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [editingSupplier, setEditingSupplier] = React.useState<SupplierRecord | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editContactPerson, setEditContactPerson] = React.useState("");
  const [editPhone, setEditPhone] = React.useState("");
  const [editEmail, setEditEmail] = React.useState("");
  const [editAddress, setEditAddress] = React.useState("");
  const [editGstin, setEditGstin] = React.useState("");
  const [editPaymentTermsDays, setEditPaymentTermsDays] = React.useState("15");
  const [editIsActive, setEditIsActive] = React.useState(true);

  // Supplier History Modal
  const [selectedSupplierForHistory, setSelectedSupplierForHistory] =
    React.useState<SupplierRecord | null>(null);
  const [historyPurchases, setHistoryPurchases] = React.useState<PurchaseRecord[]>([]);
  const [historyPayments, setHistoryPayments] = React.useState<SupplierPaymentRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false);

  const loadData = React.useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setIsRefreshing(true);
    else if (!cachedSuppliersState || cachedSuppliersState.items.length === 0) setIsLoading(true);
    setLoadError(null);

    try {
      const res = await getSuppliers({ pageSize: 100 });
      if (!res.success) {
        throw new Error(res.error || "Failed to retrieve suppliers.");
      }
      const items = res.data?.items || [];
      setSuppliers(items);
      const freshCache = { items, timestamp: Date.now() };
      cachedSuppliersState = freshCache;
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(SUPPLIERS_STORAGE_KEY, JSON.stringify(freshCache));
        } catch {
          // Ignore
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load suppliers.";
      if (!cachedSuppliersState || cachedSuppliersState.items.length === 0) {
        setLoadError(msg);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    loadData(false);
  }, [loadData]);

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || name.trim().length < 2) {
      addToast({
        type: "error",
        title: "Name Required",
        message: "Supplier / Plant name must be at least 2 characters.",
      });
      return;
    }
    if (!contactPerson.trim() || contactPerson.trim().length < 2) {
      addToast({
        type: "error",
        title: "Contact Person Required",
        message: "Contact person name must be at least 2 characters.",
      });
      return;
    }
    if (phone.trim().length < 6) {
      addToast({
        type: "error",
        title: "Invalid Phone Number",
        message: "Phone number must be at least 6 digits (e.g. 9845011223 or 676878).",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const input: SupplierInput = {
        name: name.trim(),
        contact_person: contactPerson.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        address: address.trim() || null,
        gstin: gstin.trim() || null,
        payment_terms_days: Number(paymentTermsDays) || 15,
      };

      const res = await createSupplier(input);

      if (!res.success || !res.data) {
        throw new Error(res.error || "Failed to create supplier.");
      }

      addToast({
        type: "success",
        title: "Supplier Registered",
        message: `${res.data.name} added to suppliers directory.`,
      });

      // Reset and close
      setName("");
      setContactPerson("");
      setPhone("");
      setEmail("");
      setAddress("");
      setGstin("");
      setPaymentTermsDays("15");
      setIsAddModalOpen(false);

      await loadData(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create supplier.";
      addToast({
        type: "error",
        title: "Registration Failed",
        message: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEdit = (s: SupplierRecord) => {
    setEditingSupplier(s);
    setEditName(s.name);
    setEditContactPerson(s.contact_person);
    setEditPhone(s.phone);
    setEditEmail(s.email || "");
    setEditAddress(s.address || "");
    setEditGstin(s.gstin || "");
    setEditPaymentTermsDays(String(s.payment_terms_days));
    setEditIsActive(s.is_active);
    setIsEditModalOpen(true);
  };

  const handleUpdateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupplier) return;

    if (!editName.trim() || editName.trim().length < 2) {
      addToast({
        type: "error",
        title: "Name Required",
        message: "Supplier name must be at least 2 characters.",
      });
      return;
    }
    if (!editContactPerson.trim() || editContactPerson.trim().length < 2) {
      addToast({
        type: "error",
        title: "Contact Person Required",
        message: "Contact person must be at least 2 characters.",
      });
      return;
    }
    if (editPhone.trim().length < 6) {
      addToast({
        type: "error",
        title: "Invalid Phone Number",
        message: "Phone number must be at least 6 digits.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const input: UpdateSupplierInput = {
        id: editingSupplier.id,
        name: editName.trim(),
        contact_person: editContactPerson.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim() || null,
        address: editAddress.trim() || null,
        gstin: editGstin.trim() || null,
        payment_terms_days: Number(editPaymentTermsDays) || 15,
        is_active: editIsActive,
      };

      const res = await updateSupplier(input);

      if (!res.success) {
        throw new Error(res.error || "Failed to update supplier.");
      }

      addToast({
        type: "success",
        title: "Supplier Updated",
        message: `${editName} profile updated successfully.`,
      });

      setIsEditModalOpen(false);
      await loadData(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update supplier.";
      addToast({
        type: "error",
        title: "Update Failed",
        message: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenHistory = async (s: SupplierRecord) => {
    setSelectedSupplierForHistory(s);
    setIsLoadingHistory(true);
    try {
      const [purchasesRes, paymentsRes] = await Promise.all([
        getPurchases({ supplierId: s.id }),
        getSupplierPayments({ supplierId: s.id }),
      ]);

      if (purchasesRes.success && purchasesRes.data) {
        setHistoryPurchases(purchasesRes.data);
      } else {
        setHistoryPurchases([]);
      }

      if (paymentsRes.success && paymentsRes.data) {
        setHistoryPayments(paymentsRes.data);
      } else {
        setHistoryPayments([]);
      }
    } catch {
      setHistoryPurchases([]);
      setHistoryPayments([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const filtered = suppliers.filter((s) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.contact_person.toLowerCase().includes(q) ||
      s.phone.toLowerCase().includes(q) ||
      (s.address && s.address.toLowerCase().includes(q)) ||
      (s.gstin && s.gstin.toLowerCase().includes(q))
    );
  });

  const totalPayables = suppliers.reduce((sum, s) => sum + (s.current_payable || 0), 0);
  const totalPlantJars = suppliers.reduce((sum, s) => sum + (s.jars_in_custody || 0), 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16 px-2 sm:px-4">
      {/* 1. VISUAL HEADER BANNER */}
      <div className="relative overflow-hidden rounded-3xl bg-linear-to-r from-blue-700 via-indigo-700 to-cyan-600 p-5 sm:p-7 text-white shadow-lg">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-bold text-white mb-2">
              <Building2 className="h-4 w-4 text-cyan-200" />
              <span>সাপ্লায়ার ও প্ল্যান্ট ডিরেক্টরি (Suppliers & Bottling Plants)</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Suppliers & Procurement
            </h1>
            <p className="text-xs sm:text-sm text-cyan-100 font-medium mt-1 max-w-2xl">
              Manage wholesale water suppliers, bottling plants, jar accounts, and outstanding payables.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadData(true)}
              disabled={isRefreshing}
              className="bg-white/10 hover:bg-white/20 text-white border-white/30 text-xs font-bold backdrop-blur-xs cursor-pointer shadow-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh (রিফ্রেশ)
            </Button>

            <Link href="/purchases?new=true">
              <Button
                size="sm"
                className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs shadow-md shadow-cyan-950/20 cursor-pointer active:scale-95 transition-all"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Place Purchase Order (নতুন অর্ডার)
              </Button>
            </Link>

            <Button
              size="sm"
              onClick={() => setIsAddModalOpen(true)}
              className="bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs shadow-md shadow-emerald-950/20 cursor-pointer active:scale-95 transition-all"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              + Add Supplier (নতুন সাপ্লায়ার)
            </Button>
          </div>
        </div>
      </div>

      {/* 2. SUMMARY METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="rounded-2xl border-2 border-blue-500/30 bg-gradient-to-br from-blue-500/10 via-indigo-500/5 to-blue-500/10 dark:from-blue-950/30 dark:via-indigo-950/20 dark:to-blue-950/30 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-blue-700 dark:text-blue-300">
              Total Suppliers (মোট সাপ্লায়ার)
            </span>
            <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-700 dark:text-blue-300">
              <Building2 className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl font-black text-blue-900 dark:text-blue-100">
            {suppliers.length}
            <span className="text-xs font-bold text-blue-700 dark:text-blue-400 ml-1.5">Vendors</span>
          </div>
          <span className="text-xs text-muted-foreground font-semibold mt-2 block">
            {suppliers.filter((s) => s.is_active).length} Active Procurement Partners
          </span>
        </div>

        <div className="rounded-2xl border-2 border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-yellow-500/5 to-amber-500/10 dark:from-amber-950/30 dark:via-yellow-950/20 dark:to-amber-950/30 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">
              Jars at Suppliers (প্ল্যান্টে জার)
            </span>
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300">
              <RotateCcw className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl font-black text-amber-900 dark:text-amber-100">
            {totalPlantJars}
            <span className="text-xs font-bold text-amber-700 dark:text-amber-400 ml-1.5">Jars</span>
          </div>
          <span className="text-xs text-muted-foreground font-semibold mt-2 block">
            In refilling cycle or vendor custody
          </span>
        </div>

        <div className="rounded-2xl border-2 border-rose-500/30 bg-gradient-to-br from-rose-500/10 via-red-500/5 to-rose-500/10 dark:from-rose-950/30 dark:via-red-950/20 dark:to-rose-950/30 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-rose-700 dark:text-rose-300">
              Total Payables Due (বাকি দেনা)
            </span>
            <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-700 dark:text-rose-300">
              <Receipt className="h-5 w-5" />
            </div>
          </div>
          <div className="text-3xl font-black text-rose-900 dark:text-rose-100">
            {formatCurrency(totalPayables)}
          </div>
          <span className="text-xs text-muted-foreground font-semibold mt-2 block">
            Outstanding liability to wholesale suppliers
          </span>
        </div>
      </div>

      {/* 3. SEARCH & DIRECTORY HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
          <span>Supplier Directory (সাপ্লায়ারদের তালিকা)</span>
          <Badge variant="outline" className="text-xs font-mono">
            {filtered.length}
          </Badge>
        </h2>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search supplier, contact, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs rounded-xl bg-background border-border"
          />
        </div>
      </div>

      {/* 4. CARD-WISE SUPPLIER GRID */}
      {isLoading && suppliers.length === 0 ? (
        <LoadingState message="Loading suppliers directory..." />
      ) : loadError && suppliers.length === 0 ? (
        <ErrorState message={loadError} onRetry={() => loadData(true)} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No Suppliers Found"
          description={
            searchQuery
              ? "No vendors matched your search query."
              : "No procurement suppliers registered yet. Click 'Add Supplier' to register vendors."
          }
          actionLabel={searchQuery ? "Clear Search" : "Add Supplier"}
          onAction={() => {
            if (searchQuery) setSearchQuery("");
            else setIsAddModalOpen(true);
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <div
              key={s.id}
              className="rounded-2xl border-2 border-border/80 bg-card hover:bg-muted/10 p-4 transition-all hover:border-cyan-500/50 shadow-xs flex flex-col justify-between"
            >
              <div>
                {/* Header Row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-10 w-10 rounded-xl bg-blue-500/15 text-blue-700 dark:text-blue-300 flex items-center justify-center font-black text-sm shrink-0">
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm text-foreground leading-snug">
                        {s.name}
                      </h3>
                      <p className="text-xs text-muted-foreground font-semibold">
                        Contact: <span className="text-foreground">{s.contact_person}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <Badge
                      variant={s.is_active ? "success" : "secondary"}
                      className="text-[10px] py-0 px-2 font-bold"
                    >
                      {s.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Net {s.payment_terms_days}d
                    </span>
                  </div>
                </div>

                {/* Contact & Address */}
                <div className="space-y-1.5 mt-3 pt-2.5 border-t border-border/60 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      Phone:
                    </span>
                    <a
                      href={`tel:${s.phone}`}
                      className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                    >
                      {s.phone}
                    </a>
                  </div>

                  {s.email && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 text-blue-500" />
                        Email:
                      </span>
                      <a
                        href={`mailto:${s.email}`}
                        className="font-medium text-foreground hover:underline truncate max-w-[180px]"
                      >
                        {s.email}
                      </a>
                    </div>
                  )}

                  {s.address && (
                    <div className="flex items-start gap-1.5 pt-1 text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <p className="line-clamp-1">{s.address}</p>
                    </div>
                  )}

                  {s.gstin && (
                    <div className="pt-1">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                        GSTIN: {s.gstin}
                      </span>
                    </div>
                  )}
                </div>

                {/* Financial & Jar Custody Tiles */}
                <div className="grid grid-cols-2 gap-2 mt-3 pt-2.5 border-t border-border/60">
                  <div className="rounded-xl border border-border/80 bg-muted/20 p-2 text-center">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                      Jars at Plant
                    </span>
                    <span className="text-sm font-black text-foreground">
                      {s.jars_in_custody || 0} Jars
                    </span>
                  </div>

                  <div className={`rounded-xl border p-2 text-center ${
                    (s.current_payable || 0) > 0
                      ? "border-rose-500/30 bg-rose-500/10"
                      : "border-emerald-500/30 bg-emerald-500/10"
                  }`}>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                      Payable Due
                    </span>
                    <span className={`text-sm font-black ${
                      (s.current_payable || 0) > 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}>
                      {(s.current_payable || 0) > 0 ? formatCurrency(s.current_payable || 0) : "Paid Up"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons Toolbar */}
              <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-border/60">
                <Link href={`/purchases?new=true&supplierId=${s.id}`} className="flex-1">
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs bg-cyan-600 hover:bg-cyan-700 text-white font-bold cursor-pointer active:scale-95 transition-all gap-1 shadow-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    + PO (অর্ডার)
                  </Button>
                </Link>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenHistory(s)}
                  className="h-8 px-2 text-xs font-bold border-border hover:bg-muted text-foreground cursor-pointer gap-1"
                >
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  History
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleOpenEdit(s)}
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Supplier Modal */}
      <Dialog
        isOpen={isAddModalOpen}
        onClose={() => !isSubmitting && setIsAddModalOpen(false)}
        className="max-w-md"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-bold text-base text-foreground flex items-center gap-2">
              <Building2 className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
              Register Supplier / Plant (সাপ্লায়ার যোগ করুন)
            </h3>
          </div>

          <form onSubmit={handleCreateSupplier} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-foreground">
                Supplier / Company Name *
              </label>
              <Input
                placeholder="e.g. Ganga Water Bottling & Purifiers"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">
                  Contact Person *
                </label>
                <Input
                  placeholder="e.g. Ramesh Kumar"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">
                  Phone Number *
                </label>
                <Input
                  placeholder="e.g. 9845011223"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">Email</label>
                <Input
                  type="email"
                  placeholder="vendor@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">Payment Terms (Days)</label>
                <Input
                  type="number"
                  min="0"
                  max="180"
                  placeholder="15"
                  value={paymentTermsDays}
                  onChange={(e) => setPaymentTermsDays(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-foreground">Address / Bottling Location</label>
              <Input
                placeholder="e.g. Plot 42, Industrial Area, Phase 2"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-foreground">GSTIN (Optional)</label>
              <Input
                placeholder="29AAAAA0000A1Z5"
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                className="text-xs font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddModalOpen(false)}
                disabled={isSubmitting}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-xs"
              >
                {isSubmitting ? "Registering..." : "Save Supplier"}
              </Button>
            </div>
          </form>
        </div>
      </Dialog>

      {/* Edit Supplier Modal */}
      <Dialog
        isOpen={isEditModalOpen}
        onClose={() => !isSubmitting && setIsEditModalOpen(false)}
        className="max-w-md"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-bold text-base text-foreground flex items-center gap-2">
              <Pencil className="h-4 w-4 text-cyan-600" />
              Edit Supplier Details
            </h3>
          </div>

          <form onSubmit={handleUpdateSupplier} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-foreground">Company Name *</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">Contact Person *</label>
                <Input
                  value={editContactPerson}
                  onChange={(e) => setEditContactPerson(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">Phone *</label>
                <Input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">Email</label>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-foreground">Payment Terms (Days)</label>
                <Input
                  type="number"
                  min="0"
                  max="180"
                  value={editPaymentTermsDays}
                  onChange={(e) => setEditPaymentTermsDays(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-foreground">Address</label>
              <Input
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-foreground">GSTIN</label>
              <Input
                value={editGstin}
                onChange={(e) => setEditGstin(e.target.value)}
                className="text-xs font-mono"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="editIsActive"
                checked={editIsActive}
                onChange={(e) => setEditIsActive(e.target.checked)}
                className="rounded border-border text-cyan-600 focus:ring-cyan-500"
              />
              <label htmlFor="editIsActive" className="text-xs font-bold text-foreground cursor-pointer">
                Active Procurement Partner
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditModalOpen(false)}
                disabled={isSubmitting}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-xs"
              >
                {isSubmitting ? "Saving..." : "Update Supplier"}
              </Button>
            </div>
          </form>
        </div>
      </Dialog>

      {/* Supplier History & Payables Dialog */}
      <Dialog
        isOpen={!!selectedSupplierForHistory}
        onClose={() => setSelectedSupplierForHistory(null)}
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h3 className="font-black text-base text-foreground flex items-center gap-2">
                <History className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                {selectedSupplierForHistory?.name} — Procurement History
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Wholesale purchase orders, goods receipts, and payments recorded with this supplier.
              </p>
            </div>
          </div>

          {isLoadingHistory ? (
            <LoadingState message="Loading supplier financial ledger..." />
          ) : (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              {/* Financial Snapshot */}
              <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-muted/30 border border-border">
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                    Outstanding Payable
                  </span>
                  <span className="text-lg font-black text-rose-600 dark:text-rose-400">
                    {formatCurrency(selectedSupplierForHistory?.current_payable || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground block">
                    Jars with Vendor
                  </span>
                  <span className="text-lg font-black text-foreground">
                    {selectedSupplierForHistory?.jars_in_custody || 0} Jars
                  </span>
                </div>
              </div>

              {/* Purchase Orders List */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Purchase Orders ({historyPurchases.length})
                </h4>
                {historyPurchases.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No purchase orders found.</p>
                ) : (
                  <div className="space-y-2">
                    {historyPurchases.map((p) => (
                      <div
                        key={p.id}
                        className="p-3 rounded-xl border border-border bg-card flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-foreground">{p.po_number}</span>
                            <Badge variant={p.status === "RECEIVED" ? "success" : "outline"} className="text-[9px]">
                              {p.status}
                            </Badge>
                          </div>
                          <span className="text-[11px] text-muted-foreground block mt-0.5">
                            {p.purchase_date} • {p.items.length} items
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="font-black text-foreground block">
                            {formatCurrency(p.total_amount)}
                          </span>
                          {p.balance_due > 0 ? (
                            <span className="text-[10px] text-rose-600 font-bold block">
                              Due: {formatCurrency(p.balance_due)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-600 font-bold block">Paid</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Payments List */}
              <div className="space-y-2 pt-2 border-t border-border">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Recorded Payments ({historyPayments.length})
                </h4>
                {historyPayments.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No payments recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {historyPayments.map((pay) => (
                      <div
                        key={pay.id}
                        className="p-3 rounded-xl border border-border bg-card flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-bold text-foreground">
                            {pay.payment_method}
                          </span>
                          {pay.reference_number && (
                            <span className="text-[11px] text-muted-foreground font-mono ml-2">
                              Ref: {pay.reference_number}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground block mt-0.5">
                            {pay.payment_date}
                          </span>
                        </div>
                        <span className="font-black text-emerald-600 dark:text-emerald-400 text-sm">
                          {formatCurrency(pay.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-3 border-t border-border">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedSupplierForHistory(null)}
              className="text-xs"
            >
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
