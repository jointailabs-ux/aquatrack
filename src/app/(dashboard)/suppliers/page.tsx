"use client";

import * as React from "react";
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
  ShoppingBag,
  CreditCard,
  RefreshCw,
  Pencil,
} from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
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

export default function SuppliersPage() {
  const { addToast } = useToast();
  const [suppliers, setSuppliers] = React.useState<SupplierRecord[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(true);
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

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await getSuppliers({ pageSize: 100 });
      if (!res.success) {
        throw new Error(res.error || "Failed to retrieve suppliers.");
      }
      setSuppliers(res.data?.items || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load suppliers.";
      setLoadError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
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

      setSuppliers((prev) => [res.data!, ...prev]);
      addToast({
        type: "success",
        title: "Supplier Created",
        message: `Registered ${res.data.name} with parent plant custody location.`,
      });

      setIsAddModalOpen(false);
      setName("");
      setContactPerson("");
      setPhone("");
      setEmail("");
      setAddress("");
      setGstin("");
      setPaymentTermsDays("15");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Creation failed.";
      addToast({
        type: "error",
        title: "Supplier Registration Failed",
        message: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEdit = (supplier: SupplierRecord) => {
    setEditingSupplier(supplier);
    setEditName(supplier.name);
    setEditContactPerson(supplier.contact_person);
    setEditPhone(supplier.phone);
    setEditEmail(supplier.email || "");
    setEditAddress(supplier.address || "");
    setEditGstin(supplier.gstin || "");
    setEditPaymentTermsDays(String(supplier.payment_terms_days ?? 15));
    setEditIsActive(supplier.is_active ?? true);
    setIsEditModalOpen(true);
  };

  const handleUpdateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupplier) return;

    if (!editName.trim() || editName.trim().length < 2) {
      addToast({
        type: "error",
        title: "Name Required",
        message: "Supplier / Plant name must be at least 2 characters.",
      });
      return;
    }
    if (!editContactPerson.trim() || editContactPerson.trim().length < 2) {
      addToast({
        type: "error",
        title: "Contact Person Required",
        message: "Contact person name must be at least 2 characters.",
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

      if (!res.success || !res.data) {
        throw new Error(res.error || "Failed to update supplier.");
      }

      setSuppliers((prev) =>
        prev.map((s) => (s.id === res.data!.id ? res.data! : s))
      );

      addToast({
        type: "success",
        title: "Supplier Updated",
        message: `Updated profile and location for ${res.data.name}.`,
      });

      setIsEditModalOpen(false);
      setEditingSupplier(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Update failed.";
      addToast({
        type: "error",
        title: "Supplier Update Failed",
        message: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenHistory = async (supplier: SupplierRecord) => {
    setSelectedSupplierForHistory(supplier);
    setIsLoadingHistory(true);
    try {
      const [purchasesRes, paymentsRes] = await Promise.all([
        getPurchases({ supplierId: supplier.id }),
        getSupplierPayments({ supplierId: supplier.id }),
      ]);

      setHistoryPurchases(purchasesRes.success && purchasesRes.data ? purchasesRes.data : []);
      setHistoryPayments(paymentsRes.success && paymentsRes.data ? paymentsRes.data : []);
    } catch {
      setHistoryPurchases([]);
      setHistoryPayments([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const filtered = React.useMemo(() => {
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.contact_person.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.phone.includes(searchQuery)
    );
  }, [suppliers, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Supplier & Bottling Plant Directory
            </h1>
            <Badge variant="primary" className="text-xs">
              Procurement Vendors
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Manage wholesale water purification plants, packaging vendors, payables, and empty jar custody.
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
            onClick={() => setIsAddModalOpen(true)}
            className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
          >
            <Plus className="h-4 w-4" />
            Add Supplier
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="w-full sm:w-72">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search suppliers by name, contact, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs h-9"
          />
        </div>
      </div>

      {/* Supplier Cards List */}
      {isLoading ? (
        <LoadingState message="Loading supplier directory..." />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={loadData} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No suppliers found"
          description={
            searchQuery
              ? "No vendors matched your search term."
              : "No procurement suppliers registered yet. Click 'Add Supplier' to add wholesale vendors."
          }
          actionLabel={searchQuery ? "Clear Search" : "Add Supplier"}
          onAction={() => {
            if (searchQuery) setSearchQuery("");
            else setIsAddModalOpen(true);
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map((s) => (
            <Card key={s.id} className="border-border shadow-xs bg-card">
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-foreground">{s.name}</h3>
                      <Badge
                        variant={s.is_active ? "success" : "secondary"}
                        className="text-[10px] py-0 px-1.5"
                      >
                        {s.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Contact: <strong>{s.contact_person}</strong>
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    Net {s.payment_terms_days} Days
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-0 space-y-4">
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-primary" />
                    {s.phone}
                  </p>
                  {s.email && (
                    <p className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-primary" />
                      {s.email}
                    </p>
                  )}
                  {s.address && (
                    <p className="flex items-start gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      {s.address}
                    </p>
                  )}
                  {s.gstin && (
                    <p className="text-[11px] font-mono text-muted-foreground pt-1">
                      GSTIN: {s.gstin}
                    </p>
                  )}
                </div>

                {/* Custody & Financial Balance Indicators */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
                  <div className="rounded-xl border border-border bg-muted/20 p-2.5 space-y-1">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                      <RotateCcw className="h-3 w-3 text-primary" />
                      Jars at Plant
                    </span>
                    <p className="text-base font-bold text-foreground">
                      {s.jars_in_custody || 0} Jars
                    </p>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 p-2.5 space-y-1">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                      <Receipt className="h-3 w-3 text-rose-500" />
                      Current Payable
                    </span>
                    <p className="text-base font-bold text-rose-600 dark:text-rose-400">
                      {formatCurrency(s.current_payable || 0)}
                    </p>
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenEdit(s)}
                    className="h-7 text-xs gap-1.5"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenHistory(s)}
                    className="h-7 text-xs gap-1.5"
                  >
                    <History className="h-3.5 w-3.5 text-primary" />
                    View History & Payables
                  </Button>
                </div>
              </CardContent>
            </Card>
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
              <Building2 className="h-5 w-5 text-primary" />
              Register Wholesale Supplier / Bottling Plant
            </h3>
          </div>

          <form onSubmit={handleCreateSupplier} className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">
                  Supplier / Company Name *
                </label>
                <span className="text-[10px] text-muted-foreground">Min. 2 chars</span>
              </div>
              <Input
                placeholder="e.g. Ganga Water Bottling & Purifiers"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="text-xs"
              />
              {name.trim().length > 0 && name.trim().length < 2 && (
                <span className="text-[10px] text-amber-500 font-medium block">
                  ⚠️ Name must be at least 2 characters
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    Contact Person *
                  </label>
                  <span className="text-[10px] text-muted-foreground">Min. 2 chars</span>
                </div>
                <Input
                  placeholder="e.g. Ramesh Kumar"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  required
                  className="text-xs"
                />
                {contactPerson.trim().length > 0 && contactPerson.trim().length < 2 && (
                  <span className="text-[10px] text-amber-500 font-medium block">
                    ⚠️ Contact person must be at least 2 characters
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
                  placeholder="e.g. 9876543210 or 676878"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="text-xs"
                />
                {phone.trim().length > 0 && phone.trim().length < 6 && (
                  <span className="text-[10px] text-amber-500 font-medium block">
                    ⚠️ Needs at least 6 digits ({phone.trim().length}/6)
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Email</label>
                <Input
                  type="email"
                  placeholder="billing@gangawater.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Payment Terms (Days)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={paymentTermsDays}
                  onChange={(e) => setPaymentTermsDays(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Plant Address</label>
              <Input
                placeholder="Plot 12, Industrial Area, Bangalore"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">GSTIN (Optional)</label>
              <Input
                placeholder="29AABCB1234D1ZX"
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                className="text-xs font-mono uppercase"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isSubmitting ? "Registering..." : "Create Supplier"}
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
              <Pencil className="h-5 w-5 text-primary" />
              Edit Supplier / Plant Details
            </h3>
          </div>

          <form onSubmit={handleUpdateSupplier} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">
                Supplier / Company Name *
              </label>
              <Input
                placeholder="e.g. Ganga Water Bottling & Purifiers"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Contact Person *
                </label>
                <Input
                  placeholder="e.g. Ramesh Kumar"
                  value={editContactPerson}
                  onChange={(e) => setEditContactPerson(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Phone Number *
                </label>
                <Input
                  placeholder="e.g. +91 98765 43210"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  required
                  className="text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Email</label>
                <Input
                  type="email"
                  placeholder="billing@gangawater.in"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">
                  Payment Terms (Days)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={editPaymentTermsDays}
                  onChange={(e) => setEditPaymentTermsDays(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Plant Address</label>
              <Input
                placeholder="Plot 12, Industrial Area, Bangalore"
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">GSTIN (Optional)</label>
              <Input
                placeholder="29AABCB1234D1ZX"
                value={editGstin}
                onChange={(e) => setEditGstin(e.target.value)}
                className="text-xs font-mono uppercase"
              />
            </div>

            <div className="flex items-center justify-between p-3 border border-border rounded-lg bg-muted/20">
              <div>
                <span className="text-xs font-semibold text-foreground block">Active Status</span>
                <span className="text-[11px] text-muted-foreground">
                  Inactive suppliers cannot receive new purchase orders
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </div>
      </Dialog>

      {/* Supplier History & Payables Dialog */}
      <Dialog
        isOpen={Boolean(selectedSupplierForHistory)}
        onClose={() => setSelectedSupplierForHistory(null)}
        className="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h3 className="font-bold text-base text-foreground flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              Procurement & Payables History: {selectedSupplierForHistory?.name}
            </h3>
          </div>

          {selectedSupplierForHistory && (
            <div className="space-y-4 text-xs">
              {/* Financial KPI bar */}
              <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-muted/30 border border-border">
                <div>
                  <span className="text-muted-foreground text-[11px] block">Total Invoiced:</span>
                  <strong className="text-foreground text-sm">
                    {formatCurrency(historyPurchases.reduce((s, p) => s + p.total_amount, 0))}
                  </strong>
                  <span className="text-[10px] text-muted-foreground block">
                    {historyPurchases.length} Purchase Orders
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground text-[11px] block">Total Paid:</span>
                  <strong className="text-emerald-600 dark:text-emerald-400 text-sm">
                    {formatCurrency(historyPayments.reduce((s, p) => s + p.amount, 0))}
                  </strong>
                  <span className="text-[10px] text-muted-foreground block">
                    {historyPayments.length} Payments Posted
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground text-[11px] block">Outstanding Liability:</span>
                  <strong className="text-rose-600 dark:text-rose-400 text-sm">
                    {formatCurrency(selectedSupplierForHistory.current_payable || 0)}
                  </strong>
                  <span className="text-[10px] text-muted-foreground block">Current A/P</span>
                </div>
              </div>

              {isLoadingHistory ? (
                <LoadingState message="Loading vendor procurement history..." />
              ) : (
                <>
                  {/* Purchase Orders */}
                  <div className="space-y-1">
                    <h4 className="font-bold text-foreground uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <ShoppingBag className="h-3.5 w-3.5 text-primary" />
                      Purchase Orders ({historyPurchases.length})
                    </h4>
                    {historyPurchases.length === 0 ? (
                      <p className="text-muted-foreground italic text-center py-2 border border-dashed border-border rounded-lg">
                        No purchase orders recorded for this vendor.
                      </p>
                    ) : (
                      <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-muted/50 text-muted-foreground border-b border-border sticky top-0">
                            <tr>
                              <th className="p-2 font-semibold">PO #</th>
                              <th className="p-2 font-semibold">Date</th>
                              <th className="p-2 font-semibold">Status</th>
                              <th className="p-2 font-semibold text-right">Total</th>
                              <th className="p-2 font-semibold text-right">Balance Due</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {historyPurchases.map((p) => (
                              <tr key={p.id}>
                                <td className="p-2 font-mono font-bold text-foreground">
                                  {p.po_number}
                                </td>
                                <td className="p-2 text-muted-foreground">{p.purchase_date}</td>
                                <td className="p-2">
                                  <Badge variant="outline" className="text-[10px] py-0">
                                    {p.status}
                                  </Badge>
                                </td>
                                <td className="p-2 text-right font-semibold text-foreground">
                                  {formatCurrency(p.total_amount)}
                                </td>
                                <td className="p-2 text-right font-bold text-rose-600 dark:text-rose-400">
                                  {formatCurrency(p.balance_due)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Payment History */}
                  <div className="space-y-1">
                    <h4 className="font-bold text-foreground uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <CreditCard className="h-3.5 w-3.5 text-emerald-600" />
                      Disbursements & Payments ({historyPayments.length})
                    </h4>
                    {historyPayments.length === 0 ? (
                      <p className="text-muted-foreground italic text-center py-2 border border-dashed border-border rounded-lg">
                        No payments posted to this supplier yet.
                      </p>
                    ) : (
                      <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-muted/50 text-muted-foreground border-b border-border sticky top-0">
                            <tr>
                              <th className="p-2 font-semibold">Payment #</th>
                              <th className="p-2 font-semibold">Date</th>
                              <th className="p-2 font-semibold">Method</th>
                              <th className="p-2 font-semibold">Reference</th>
                              <th className="p-2 font-semibold text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {historyPayments.map((pmt) => (
                              <tr key={pmt.id}>
                                <td className="p-2 font-mono font-bold text-foreground">
                                  {pmt.payment_number}
                                </td>
                                <td className="p-2 text-muted-foreground">{pmt.payment_date}</td>
                                <td className="p-2 text-muted-foreground">{pmt.payment_method}</td>
                                <td className="p-2 text-muted-foreground font-mono">
                                  {pmt.reference_number || "—"}
                                </td>
                                <td className="p-2 text-right font-bold text-emerald-600 dark:text-emerald-400">
                                  {formatCurrency(pmt.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="flex justify-end pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedSupplierForHistory(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
