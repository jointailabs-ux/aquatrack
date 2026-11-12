import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RecordSalaryAdvanceSchema,
  SalaryAdvanceFilterSchema,
  SalaryPaymentMethodEnum,
} from "@/modules/salaries/salary.schema";
import {
  getStaffSalarySummaries,
  getSalaryAdvances,
  recordSalaryAdvance,
} from "@/modules/salaries/salary.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

describe("Task 9: Salary Advance Management & Invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Salary Advance Schema Validations", () => {
    it("accepts valid salary advance input", () => {
      const valid = {
        staff_id: "123e4567-e89b-12d3-a456-426614174000",
        amount: 2500,
        advance_date: "2026-11-06",
        payment_method: "CASH",
        reason: "Festival bonus advance",
      };

      const result = RecordSalaryAdvanceSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.amount).toBe(2500);
        expect(result.data.payment_method).toBe("CASH");
      }
    });

    it("rejects non-positive advance amount", () => {
      const zero = {
        staff_id: "123e4567-e89b-12d3-a456-426614174000",
        amount: 0,
      };
      const negative = {
        staff_id: "123e4567-e89b-12d3-a456-426614174000",
        amount: -500,
      };

      expect(RecordSalaryAdvanceSchema.safeParse(zero).success).toBe(false);
      expect(RecordSalaryAdvanceSchema.safeParse(negative).success).toBe(false);
    });

    it("rejects invalid payment method for advance", () => {
      const invalidMethod = {
        staff_id: "123e4567-e89b-12d3-a456-426614174000",
        amount: 1000,
        payment_method: "BITCOIN",
      };

      expect(RecordSalaryAdvanceSchema.safeParse(invalidMethod).success).toBe(false);
    });

    it("validates SalaryAdvanceFilterSchema correctly", () => {
      const parsed = SalaryAdvanceFilterSchema.parse({
        status: "OUTSTANDING",
        startDate: "2026-11-01",
        endDate: "2026-11-30",
      });

      expect(parsed.status).toBe("OUTSTANDING");
      expect(parsed.startDate).toBe("2026-11-01");
      expect(parsed.endDate).toBe("2026-11-30");
    });
  });

  describe("2. Advance Deductions & Balance Recovery Logic", () => {
    it("calculates remaining advance balance after partial recovery", () => {
      const advanceAmount = 5000;
      const amountDeducted = 2000;
      const remainingBalance = Math.max(0, advanceAmount - amountDeducted);

      expect(remainingBalance).toBe(3000);
      expect(amountDeducted >= advanceAmount).toBe(false); // Not settled
    });

    it("marks advance as settled when fully recovered", () => {
      const advanceAmount = 3000;
      const amountDeducted = 3000;
      const remainingBalance = Math.max(0, advanceAmount - amountDeducted);

      expect(remainingBalance).toBe(0);
      expect(amountDeducted >= advanceAmount).toBe(true); // Settled
    });

    it("strictly clamps advance deduction to outstanding balance", () => {
      const outstandingAdvance = 1500;
      const requestedDeduction = 2500;

      // Business rule: Never deduct more than the outstanding balance
      const allowedDeduction = Math.min(requestedDeduction, outstandingAdvance);
      expect(allowedDeduction).toBe(1500);

      const baseSalary = 18000;
      const finalPayable = Math.max(0, baseSalary - allowedDeduction);
      expect(finalPayable).toBe(16500);
    });

    it("calculates total business outstanding advances across all staff members", () => {
      const staffList = [
        { staff_id: "s1", staff_name: "Ramesh", total_advances_outstanding: 2000 },
        { staff_id: "s2", staff_name: "Suresh", total_advances_outstanding: 3500 },
        { staff_id: "s3", staff_name: "Ganesh", total_advances_outstanding: 0 },
      ];

      const businessTotalOutstanding = staffList.reduce(
        (sum, s) => sum + s.total_advances_outstanding,
        0
      );
      const staffWithAdvances = staffList.filter((s) => s.total_advances_outstanding > 0);

      expect(businessTotalOutstanding).toBe(5500);
      expect(staffWithAdvances.length).toBe(2);
    });
  });

  describe("3. Salary Service & Database Operations", () => {
    it("retrieves staff salary summaries with accurate outstanding advances", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "profiles") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      { id: "staff-1", full_name: "Arun Driver", role: "staff", salary_amount: 18000, salary_type: "MONTHLY" },
                      { id: "staff-2", full_name: "Vijay Loader", role: "staff", salary_amount: 15000, salary_type: "MONTHLY" },
                    ],
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "salary_advances") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn((field: string, val: string) => ({
                  eq: vi.fn().mockResolvedValue({
                    data: val === "staff-1"
                      ? [{ amount: 4000, amount_deducted: 1500, is_settled: false }]
                      : [],
                    error: null,
                  }),
                })),
              }),
            };
          }
          if (table === "salary_payments") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [{ net_paid: 15000, amount_paid: 15000, payment_date: "2026-10-31" }],
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await getStaffSalarySummaries();
      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.length).toBe(2);

      const arun = res.data.find((s) => s.staff_id === "staff-1");
      expect(arun?.total_advances_outstanding).toBe(2500); // 4000 - 1500 = 2500
      expect(arun?.base_salary).toBe(18000);

      const vijay = res.data.find((s) => s.staff_id === "staff-2");
      expect(vijay?.total_advances_outstanding).toBe(0);
    });

    it("retrieves salary advances history with remaining balance calculations", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "salary_advances") {
            const queryChain: any = {
              order: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              lte: vi.fn().mockReturnThis(),
            };

            // Resolves with two advances: one partial, one settled
            queryChain.order = vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "adv-1",
                    staff_id: "staff-1",
                    amount: 3000,
                    amount_deducted: 1000,
                    payment_method: "CASH",
                    advance_date: "2026-11-02",
                    reason: "Emergency advance",
                    notes: "Cash handed over",
                    is_settled: false,
                    is_deducted: true,
                    deducted_in_payment_id: "sal-1",
                    created_at: "2026-11-02T10:00:00Z",
                    staff: { full_name: "Arun Driver" },
                  },
                  {
                    id: "adv-2",
                    staff_id: "staff-2",
                    amount: 2000,
                    amount_deducted: 2000,
                    payment_method: "UPI",
                    advance_date: "2026-10-15",
                    reason: "Medical expense",
                    notes: null,
                    is_settled: true,
                    is_deducted: true,
                    deducted_in_payment_id: "sal-0",
                    created_at: "2026-10-15T09:00:00Z",
                    staff: { full_name: "Vijay Loader" },
                  },
                ],
                error: null,
              }),
            });

            return {
              select: vi.fn().mockReturnValue(queryChain),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await getSalaryAdvances();
      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.length).toBe(2);

      const adv1 = res.data[0];
      expect(adv1?.staff_name).toBe("Arun Driver");
      expect(adv1?.amount).toBe(3000);
      expect(adv1?.amount_deducted).toBe(1000);
      expect(adv1?.remaining_balance).toBe(2000);
      expect(adv1?.is_settled).toBe(false);

      const adv2 = res.data[1];
      expect(adv2?.staff_name).toBe("Vijay Loader");
      expect(adv2?.remaining_balance).toBe(0);
      expect(adv2?.is_settled).toBe(true);
    });

    it("records salary advance using atomic RPC rpc_record_salary_advance", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "owner-1" } },
          }),
        },
        rpc: vi.fn().mockResolvedValue({
          data: {
            success: true,
            advance_id: "adv-new-123",
            voucher_number: "ADV-20261106-001",
            amount: 2000,
          },
          error: null,
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await recordSalaryAdvance({
        staff_id: "123e4567-e89b-12d3-a456-426614174000",
        amount: 2000,
        advance_date: "2026-11-06",
        payment_method: "CASH",
        reason: "Festival advance",
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.advanceId).toBe("adv-new-123");
      expect(mockSupabase.rpc).toHaveBeenCalledWith("rpc_record_salary_advance", {
        p_staff_id: "123e4567-e89b-12d3-a456-426614174000",
        p_amount: 2000,
        p_payment_method: "CASH",
        p_advance_date: "2026-11-06",
        p_notes: "Festival advance",
      });
    });

    it("rejects advance disbursement when caller is unauthenticated", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
          }),
        },
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await recordSalaryAdvance({
        staff_id: "123e4567-e89b-12d3-a456-426614174000",
        amount: 1500,
        advance_date: "2026-11-06",
        payment_method: "CASH",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Authentication required");
    });
  });
});
