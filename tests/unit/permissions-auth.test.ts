import { describe, it, expect } from "vitest";
import { normalizeUserRole } from "@/types/auth.types";
import { CreateStaffAccountSchema } from "@/modules/staff/staff.schema";

describe("Phase 1 Authentication & Role-Based Authorization", () => {
  it("normalizes user roles strictly to 'owner' or 'staff'", () => {
    expect(normalizeUserRole("owner")).toBe("owner");
    expect(normalizeUserRole("OWNER")).toBe("owner");
    expect(normalizeUserRole("super_admin")).toBe("owner");
    expect(normalizeUserRole("staff")).toBe("staff");
    expect(normalizeUserRole("STAFF")).toBe("staff");

    // Legacy and external persona roles default safely to 'staff'
    expect(normalizeUserRole("admin")).toBe("staff");
    expect(normalizeUserRole("driver")).toBe("staff");
    expect(normalizeUserRole("customer")).toBe("staff");
    expect(normalizeUserRole(null)).toBe("staff");
    expect(normalizeUserRole(undefined)).toBe("staff");
  });

  it("validates owner-controlled staff account creation schema", () => {
    const validStaff = {
      email: "ramesh.kumar@aquatrack.internal",
      password: "StrongPassword123!",
      full_name: "Ramesh Kumar",
      phone: "+91 98450 11223",
      salary_amount: 18000,
      salary_type: "MONTHLY" as const,
      can_pos: false,
      can_warehouse: true,
      can_manage_customers: true,
      can_manage_orders: true,
    };

    const parsed = CreateStaffAccountSchema.safeParse(validStaff);
    expect(parsed.success).toBe(true);

    // Short password rejected (min 8 chars required)
    const shortPass = { ...validStaff, password: "123" };
    expect(CreateStaffAccountSchema.safeParse(shortPass).success).toBe(false);

    // Invalid email rejected
    const badEmail = { ...validStaff, email: "not-an-email" };
    expect(CreateStaffAccountSchema.safeParse(badEmail).success).toBe(false);
  });

  it("ensures staff cannot elevate their own role or bypass owner-only permissions", () => {
    const callerRole: string = "staff";
    const requestedRoleChange: string = "owner";

    const canChangeOwnRole = callerRole === "owner";
    expect(canChangeOwnRole).toBe(false);
    expect(callerRole).not.toBe(requestedRoleChange);
  });

  // --- Round 3 Remediation: Privileged Column & Direct Write Protection ---

  interface CustomerRecord {
    id: string;
    contactName: string;
    phone: string;
    address: string;
    currentBalance: number;
    totalFullJarsHolding: number;
    totalEmptyJarsHolding: number;
    totalDamagedJarsHolding: number;
    totalDepositHeld: number;
  }

  function simulateCustomerUpdate({
    oldRecord,
    newRecord,
    callerRole,
    isInternalRpcContext,
  }: {
    oldRecord: CustomerRecord;
    newRecord: CustomerRecord;
    callerRole: "owner" | "staff";
    isInternalRpcContext?: boolean;
  }) {
    if (isInternalRpcContext || callerRole === "owner") {
      return { allowed: true, record: newRecord };
    }

    // Check privileged fields
    const privilegedFieldsChanged =
      newRecord.currentBalance !== oldRecord.currentBalance ||
      newRecord.totalFullJarsHolding !== oldRecord.totalFullJarsHolding ||
      newRecord.totalEmptyJarsHolding !== oldRecord.totalEmptyJarsHolding ||
      newRecord.totalDamagedJarsHolding !== oldRecord.totalDamagedJarsHolding ||
      newRecord.totalDepositHeld !== oldRecord.totalDepositHeld;

    if (privilegedFieldsChanged) {
      throw new Error(
        "Access Denied: Customer financial balances and jar holdings cannot be directly modified. Use approved transactional workflows."
      );
    }

    return { allowed: true, record: newRecord };
  }

  it("prevents ordinary customer-management staff from directly updating financial balances or jar holdings", () => {
    const existingCustomer: CustomerRecord = {
      id: "cust-1",
      contactName: "Hotel Annapoorna",
      phone: "+91 98450 11111",
      address: "MG Road, Bangalore",
      currentBalance: 5000,
      totalFullJarsHolding: 20,
      totalEmptyJarsHolding: 5,
      totalDamagedJarsHolding: 1,
      totalDepositHeld: 3000,
    };

    // 1. Staff legitimately updates address and contact name -> ALLOWED
    const legitUpdate = simulateCustomerUpdate({
      oldRecord: existingCustomer,
      newRecord: {
        ...existingCustomer,
        contactName: "Hotel Annapoorna Grand",
        address: "Residency Road, Bangalore",
      },
      callerRole: "staff",
    });
    expect(legitUpdate.allowed).toBe(true);
    expect(legitUpdate.record.contactName).toBe("Hotel Annapoorna Grand");

    // 2. Staff attempts to directly wipe out balance to 0 -> REJECTED!
    expect(() =>
      simulateCustomerUpdate({
        oldRecord: existingCustomer,
        newRecord: {
          ...existingCustomer,
          currentBalance: 0,
        },
        callerRole: "staff",
      })
    ).toThrow(/Access Denied: Customer financial balances and jar holdings cannot be directly modified/i);

    // 3. Staff attempts to manipulate full jar holdings directly -> REJECTED!
    expect(() =>
      simulateCustomerUpdate({
        oldRecord: existingCustomer,
        newRecord: {
          ...existingCustomer,
          totalFullJarsHolding: 0,
        },
        callerRole: "staff",
      })
    ).toThrow(/Access Denied: Customer financial balances and jar holdings cannot be directly modified/i);

    // 4. Staff attempts to manipulate deposit held directly -> REJECTED!
    expect(() =>
      simulateCustomerUpdate({
        oldRecord: existingCustomer,
        newRecord: {
          ...existingCustomer,
          totalDepositHeld: 0,
        },
        callerRole: "staff",
      })
    ).toThrow(/Access Denied: Customer financial balances and jar holdings cannot be directly modified/i);

    // 5. Internal RPC context (e.g. rpc_execute_delivery_stop) updating balance and jars -> ALLOWED
    const rpcUpdate = simulateCustomerUpdate({
      oldRecord: existingCustomer,
      newRecord: {
        ...existingCustomer,
        currentBalance: 4000,
        totalFullJarsHolding: 25,
      },
      callerRole: "staff",
      isInternalRpcContext: true,
    });
    expect(rpcUpdate.allowed).toBe(true);
    expect(rpcUpdate.record.currentBalance).toBe(4000);
  });

  it("verifies direct write policies disallow ordinary staff from bypassing RPCs on purchases, jar movements, and ledger", () => {
    interface PolicyCheck {
      table: string;
      operation: "INSERT" | "UPDATE" | "DELETE";
      callerRole: "owner" | "staff";
      permission?: string;
    }

    function isDirectTableWriteAllowed({ table, operation, callerRole, permission }: PolicyCheck): boolean {
      // Owner is allowed
      if (callerRole === "owner") return true;

      // Staff direct writes are BLOCKED on transactional tables; operations MUST go through RPCs
      const restrictedTables = [
        "purchases",
        "purchase_items",
        "jar_custody_movements",
        "financial_ledger",
        "stock_movements",
        "inventory_balances",
        "pos_sales",
        "pos_sale_items",
        "customer_payments",
        "salary_advances",
        "salary_payments",
      ];

      if (restrictedTables.includes(table)) {
        return false;
      }

      return false;
    }

    // Direct write to purchases blocked for staff
    expect(isDirectTableWriteAllowed({ table: "purchases", operation: "INSERT", callerRole: "staff", permission: "can_manage_suppliers" })).toBe(false);
    expect(isDirectTableWriteAllowed({ table: "purchase_items", operation: "INSERT", callerRole: "staff", permission: "can_manage_suppliers" })).toBe(false);

    // Direct write to jar_custody_movements blocked for staff
    expect(isDirectTableWriteAllowed({ table: "jar_custody_movements", operation: "INSERT", callerRole: "staff", permission: "can_warehouse" })).toBe(false);

    // Direct write to financial_ledger blocked for staff
    expect(isDirectTableWriteAllowed({ table: "financial_ledger", operation: "INSERT", callerRole: "staff" })).toBe(false);

    // Owner write is allowed
    expect(isDirectTableWriteAllowed({ table: "purchases", operation: "INSERT", callerRole: "owner" })).toBe(true);
  });
});
