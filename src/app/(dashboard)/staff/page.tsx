"use client";

import * as React from "react";
import {
  ShieldCheck,
  Truck,
  Phone,
  CheckCircle2,
  XCircle,
  Key,
  CreditCard,
  Edit,
  Plus,
  UserPlus,
  Mail,
  Lock,
} from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { StaffRecord, CreateStaffAccountInput } from "@/modules/staff/staff.schema";
import {
  getStaffMembers,
  createStaffAccount,
  updateStaffPermissions,
  updateStaffSalary,
  toggleStaffStatus,
} from "@/modules/staff/staff.service";
import { formatCurrency } from "@/lib/utils";

export default function StaffManagementPage() {
  const { addToast } = useToast();
  const [staffList, setStaffList] = React.useState<StaffRecord[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [selectedStaff, setSelectedStaff] = React.useState<StaffRecord | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);

  // Edit Permissions & Salary form state
  const [canPos, setCanPos] = React.useState(false);
  const [canWarehouse, setCanWarehouse] = React.useState(false);
  const [canManageCustomers, setCanManageCustomers] = React.useState(false);
  const [canManageOrders, setCanManageOrders] = React.useState(false);
  const [salaryAmount, setSalaryAmount] = React.useState(18000);
  const [salaryType, setSalaryType] = React.useState<"MONTHLY" | "FIXED_PERIOD">("MONTHLY");

  // Create Staff Form state
  const [newFullName, setNewFullName] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [newPhone, setNewPhone] = React.useState("");
  const [newSalary, setNewSalary] = React.useState("18000");
  const [newSalaryType, setNewSalaryType] = React.useState<"MONTHLY" | "FIXED_PERIOD">("MONTHLY");
  const [newCanPos, setNewCanPos] = React.useState(false);
  const [newCanWarehouse, setNewCanWarehouse] = React.useState(false);
  const [newCanCustomers, setNewCanCustomers] = React.useState(false);
  const [newCanOrders, setNewCanOrders] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  async function loadStaff() {
    setIsLoading(true);
    const res = await getStaffMembers();
    setIsLoading(false);
    if (res.success && res.data) {
      setStaffList(res.data);
    } else {
      setStaffList([]);
    }
  }

  React.useEffect(() => {
    loadStaff();
  }, []);

  const openEditModal = (staff: StaffRecord) => {
    setSelectedStaff(staff);
    setCanPos(staff.can_pos);
    setCanWarehouse(staff.can_warehouse);
    setCanManageCustomers(staff.can_manage_customers);
    setCanManageOrders(staff.can_manage_orders);
    setSalaryAmount(staff.salary_amount);
    setSalaryType(staff.salary_type);
    setIsEditModalOpen(true);
  };

  const handleSavePermissions = async () => {
    if (!selectedStaff) return;

    const permRes = await updateStaffPermissions(selectedStaff.id, {
      can_pos: canPos,
      can_warehouse: canWarehouse,
      can_manage_customers: canManageCustomers,
      can_manage_orders: canManageOrders,
    });

    const salRes = await updateStaffSalary(selectedStaff.id, salaryAmount, salaryType);

    if (permRes.success && salRes.success) {
      setStaffList((prev) =>
        prev.map((s) =>
          s.id === selectedStaff.id
            ? {
                ...s,
                can_pos: canPos,
                can_warehouse: canWarehouse,
                can_manage_customers: canManageCustomers,
                can_manage_orders: canManageOrders,
                salary_amount: salaryAmount,
                salary_type: salaryType,
              }
            : s
        )
      );

      addToast({
        type: "success",
        title: "Permissions Updated",
        message: `Updated modular access rights for ${selectedStaff.full_name}.`,
      });
      setIsEditModalOpen(false);
    } else {
      addToast({
        type: "error",
        title: "Update Failed",
        message: permRes.error || salRes.error || "Failed to update permissions.",
      });
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const input: CreateStaffAccountInput = {
      full_name: newFullName.trim(),
      email: newEmail.trim(),
      password: newPassword,
      phone: newPhone.trim(),
      salary_amount: Number(newSalary) || 0,
      salary_type: newSalaryType,
      can_pos: newCanPos,
      can_warehouse: newCanWarehouse,
      can_manage_customers: newCanCustomers,
      can_manage_orders: newCanOrders,
    };

    const res = await createStaffAccount(input);
    setIsSubmitting(false);

    if (res.success && res.data) {
      addToast({
        type: "success",
        title: "Staff Account Created",
        message: `Account created for ${res.data.full_name} (${res.data.email}).`,
      });
      setStaffList((prev) => [res.data!, ...prev]);
      setIsCreateModalOpen(false);
      // Reset form
      setNewFullName("");
      setNewEmail("");
      setNewPassword("");
      setNewPhone("");
      setNewSalary("18000");
    } else {
      addToast({
        type: "error",
        title: "Provisioning Error",
        message: res.error || "Failed to create staff account.",
      });
    }
  };

  const handleToggleActive = async (staff: StaffRecord) => {
    if (staff.role === "owner") return;
    const nextState = !staff.is_active;
    const res = await toggleStaffStatus(staff.id, nextState);
    if (res.success) {
      setStaffList((prev) =>
        prev.map((s) => (s.id === staff.id ? { ...s, is_active: nextState } : s))
      );
      addToast({
        type: "info",
        title: nextState ? "Staff Activated" : "Staff Deactivated",
        message: `${staff.full_name} is now ${nextState ? "active" : "deactivated"}.`,
      });
    } else {
      addToast({
        type: "error",
        title: "Action Failed",
        message: res.error || "Could not toggle status.",
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
              Staff Management & Modular RBAC
            </h1>
            <Badge variant="primary" className="text-xs">
              Owner + Staff Model
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Provision staff login credentials, configure mobile delivery routes, and assign modular permissions.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => setIsCreateModalOpen(true)}
          className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs"
        >
          <UserPlus className="h-4 w-4" />
          Add Staff Member
        </Button>
      </div>

      {/* Staff Roster Cards */}
      {isLoading ? (
        <div className="py-12 text-center text-xs text-muted-foreground">
          Loading staff accounts...
        </div>
      ) : staffList.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center space-y-3">
          <p className="text-sm font-semibold text-foreground">No Staff Accounts Provisioned Yet</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Click &ldquo;Add Staff Member&rdquo; to create Supabase login credentials for delivery drivers and counter staff.
          </p>
          <Button size="sm" onClick={() => setIsCreateModalOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Provision First Staff Account
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {staffList.map((staff) => {
            const isOwner = staff.role === "owner";

            return (
              <Card
                key={staff.id}
                className={`border-border shadow-xs transition-all ${
                  isOwner ? "border-primary/40 bg-primary/5" : "bg-card"
                } ${!staff.is_active ? "opacity-60" : ""}`}
              >
                <CardHeader className="p-5 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={isOwner ? "primary" : "secondary"}
                          className="text-[10px] font-bold uppercase tracking-wider"
                        >
                          {isOwner ? "Full Owner" : "Operational Staff"}
                        </Badge>
                        {!staff.is_active && (
                          <Badge variant="destructive" className="text-[10px]">
                            Deactivated
                          </Badge>
                        )}
                      </div>
                      <h3 className="text-base font-bold text-foreground">
                        {staff.full_name}
                      </h3>
                    </div>

                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      {isOwner ? <ShieldCheck className="h-5 w-5 text-primary" /> : <Truck className="h-4 w-4" />}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="p-5 pt-0 space-y-4">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-primary" />
                      {staff.phone}
                    </p>
                    {staff.email && (
                      <p className="flex items-center gap-1.5 truncate">
                        <Mail className="h-3.5 w-3.5 text-primary" />
                        {staff.email}
                      </p>
                    )}
                    {!isOwner && (
                      <p className="flex items-center gap-1.5 text-foreground font-semibold">
                        <CreditCard className="h-3.5 w-3.5 text-emerald-500" />
                        Salary: {formatCurrency(staff.salary_amount)} / {staff.salary_type.toLowerCase()}
                      </p>
                    )}
                  </div>

                  {/* Modular Permissions Matrix */}
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                      <span className="flex items-center gap-1.5">
                        <Key className="h-3.5 w-3.5 text-primary" />
                        Module Access Rights
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        {isOwner || staff.can_pos ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className={isOwner || staff.can_pos ? "text-foreground font-medium" : "text-muted-foreground"}>
                          POS Counter
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isOwner || staff.can_warehouse ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className={isOwner || staff.can_warehouse ? "text-foreground font-medium" : "text-muted-foreground"}>
                          Warehouse & Stock
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isOwner || staff.can_manage_customers ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className={isOwner || staff.can_manage_customers ? "text-foreground font-medium" : "text-muted-foreground"}>
                          Customers
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isOwner || staff.can_manage_orders ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                        )}
                        <span className={isOwner || staff.can_manage_orders ? "text-foreground font-medium" : "text-muted-foreground"}>
                          Orders & Dispatch
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  {!isOwner && (
                    <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditModal(staff)}
                        className="h-8 text-xs gap-1.5"
                      >
                        <Edit className="h-3.5 w-3.5" />
                        Edit Access & Salary
                      </Button>

                      <Button
                        variant={staff.is_active ? "ghost" : "outline"}
                        size="sm"
                        onClick={() => handleToggleActive(staff)}
                        className={`h-8 text-xs ${
                          staff.is_active ? "text-rose-500 hover:text-rose-600" : "text-emerald-600"
                        }`}
                      >
                        {staff.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal 1: Create New Staff Member */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Provision New Staff Account
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Creates Supabase login credentials and initializes permissions.
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateStaff} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Full Name *</label>
                  <Input
                    placeholder="e.g. Ramesh Kumar"
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Phone Number *</label>
                  <Input
                    placeholder="+91 98450 12345"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Login Email *</label>
                  <div className="relative">
                    <Mail className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="ramesh@aquatrack.com"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      required
                      className="pl-8 text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Initial Password *</label>
                  <div className="relative">
                    <Lock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="password"
                      placeholder="Min 8 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      className="pl-8 text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Salary Configuration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Base Salary (₹)</label>
                  <Input
                    type="number"
                    value={newSalary}
                    onChange={(e) => setNewSalary(e.target.value)}
                    min={0}
                    className="text-xs font-bold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Salary Period</label>
                  <select
                    value={newSalaryType}
                    onChange={(e) => setNewSalaryType(e.target.value as "MONTHLY" | "FIXED_PERIOD")}
                    className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="FIXED_PERIOD">Fixed Period</option>
                  </select>
                </div>
              </div>

              {/* Modular Operational Permissions */}
              <div className="space-y-2 pt-2 border-t border-border">
                <h4 className="text-xs font-bold text-foreground">Modular Permissions</h4>
                <div className="space-y-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newCanPos}
                      onChange={(e) => setNewCanPos(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>POS Counter Sales (Walk-in Billing)</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newCanWarehouse}
                      onChange={(e) => setNewCanWarehouse(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>Warehouse Depot Operations & Inventory Audit</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newCanCustomers}
                      onChange={(e) => setNewCanCustomers(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>Customer Account Management</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newCanOrders}
                      onChange={(e) => setNewCanOrders(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>Order Creation & Delivery Dispatch</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                >
                  {isSubmitting ? "Provisioning..." : "Create Account"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Edit Access & Salary */}
      {isEditModalOpen && selectedStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Edit Modular Permissions & Salary
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Modifying {selectedStaff.full_name} ({selectedStaff.phone})
                </p>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Permissions */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-foreground">Module Access Rights</h4>
                <div className="space-y-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canPos}
                      onChange={(e) => setCanPos(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>POS Counter Sales</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canWarehouse}
                      onChange={(e) => setCanWarehouse(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>Warehouse Depot Operations & Inventory Audit</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canManageCustomers}
                      onChange={(e) => setCanManageCustomers(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>Customer Account Management</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canManageOrders}
                      onChange={(e) => setCanManageOrders(e.target.checked)}
                      className="rounded border-border text-primary"
                    />
                    <span>Order Creation & Delivery Dispatch</span>
                  </label>
                </div>
              </div>

              {/* Salary */}
              <div className="space-y-2 pt-2 border-t border-border">
                <h4 className="text-xs font-bold text-foreground">Agreed Base Compensation</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">Amount (₹)</label>
                    <Input
                      type="number"
                      value={salaryAmount}
                      onChange={(e) => setSalaryAmount(Number(e.target.value))}
                      min={0}
                      className="text-xs font-bold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground">Period</label>
                    <select
                      value={salaryType}
                      onChange={(e) => setSalaryType(e.target.value as "MONTHLY" | "FIXED_PERIOD")}
                      className="w-full rounded-lg border border-border bg-background p-2 text-xs text-foreground"
                    >
                      <option value="MONTHLY">Monthly</option>
                      <option value="FIXED_PERIOD">Fixed Period</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSavePermissions}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                >
                  Save Access Rights
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
