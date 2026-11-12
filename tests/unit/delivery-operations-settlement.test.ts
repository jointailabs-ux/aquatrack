import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SettleDriverCashSchema,
  AssignOrderToDriverSchema,
} from "@/modules/delivery/delivery.schema";
import {
  getAdminDeliveriesOverview,
  assignOrderToDriver,
  startDriverTrip,
  getDriverDailyManifest,
  getDriverCollectionsReconciliation,
  settleDriverDailyCash,
} from "@/modules/delivery/delivery.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { createClient, createAdminClient } from "@/lib/supabase/server";

describe("Task 7: Delivery Operations & Driver Payment Settlement", () => {
  const dummyDriverId = "11111111-1111-1111-1111-111111111111";
  const dummyOwnerId = "00000000-0000-0000-0000-000000000000";
  const dummyOrderId = "22222222-2222-2222-2222-222222222222";
  const dummyCustomerId = "33333333-3333-3333-3333-333333333333";
  const dummyStopId = "44444444-4444-4444-4444-444444444444";
  const targetDate = "2026-11-06";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Schema Validations & Constraints", () => {
    it("validates valid driver cash settlement input", () => {
      const validInput = {
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 1000,
        cash_handed_over: 4500,
        on_route_expenses: 500,
      };

      const result = SettleDriverCashSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("rejects negative cash amounts in settlement input", () => {
      const invalidInput = {
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: -500,
        cash_handed_over: 4500,
      };

      const result = SettleDriverCashSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    it("validates order assignment input schema", () => {
      const validAssignment = {
        order_id: dummyOrderId,
        driver_id: dummyDriverId,
      };

      const result = AssignOrderToDriverSchema.safeParse(validAssignment);
      expect(result.success).toBe(true);
    });
  });

  describe("2. Admin Deliveries Overview & Trip Aggregations", () => {
    it("aggregates stops, jar counts, and collections correctly by driver", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "profiles") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({
                data: [
                  { id: dummyDriverId, full_name: "Ramesh Kumar", phone: "9845012345", role: "staff", is_active: true },
                ],
                error: null,
              }),
            };
          }
          if (table === "delivery_stops") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: dummyStopId,
                    order_id: dummyOrderId,
                    assigned_staff_id: dummyDriverId,
                    sequence_number: 1,
                    status: "COMPLETED",
                    actual_delivered_quantity: 4,
                    empty_jars_collected: 3,
                    damaged_jars_collected: 1,
                    payment_collected: 360,
                    payment_method: "CASH",
                    assigned_staff: { id: dummyDriverId, full_name: "Ramesh Kumar", phone: "9845012345" },
                    order: {
                      id: dummyOrderId,
                      order_number: "ORD-101",
                      customer_id: dummyCustomerId,
                      delivery_address: "123 Tech Park, Indiranagar",
                      delivery_date: targetDate,
                      total_amount: 360,
                      status: "DELIVERED",
                      customer: { id: dummyCustomerId, contact_name: "Dr. Arvind Rao", phone: "9845054321" },
                      items: [{ product_id: "p1", quantity: 4, delivered_quantity: 4, product: { name: "20L Jar", is_reusable_jar: true } }],
                    },
                  },
                ],
                error: null,
              }),
            };
          }
          if (table === "orders") {
            return {
              select: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }

          return {
            select: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await getAdminDeliveriesOverview({ date: targetDate });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");

      expect(res.data.trips).toHaveLength(1);
      const trip = res.data.trips[0];
      expect(trip.driver_name).toBe("Ramesh Kumar");
      expect(trip.total_stops).toBe(1);
      expect(trip.completed_stops).toBe(1);
      expect(trip.pending_stops).toBe(0);
      expect(trip.full_jars_delivered).toBe(4);
      expect(trip.empty_jars_collected).toBe(3);
      expect(trip.damaged_jars_collected).toBe(1);
      expect(trip.cash_collected).toBe(360);
      expect(trip.trip_status).toBe("COMPLETED");
    });
  });

  describe("3. Driver Trip Dispatch & Route Execution", () => {
    it("starts driver trip and transitions stops to EN_ROUTE and orders to OUT_FOR_DELIVERY", async () => {
      const mockUpdate = vi.fn().mockReturnThis();
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: dummyDriverId } },
          }),
        },
        from: vi.fn((table: string) => {
          if (table === "delivery_stops") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn((col, val) => {
                if (col === "assigned_staff_id") return mockSupabase.from("delivery_stops");
                if (col === "status") {
                  return Promise.resolve({
                    data: [
                      {
                        id: dummyStopId,
                        order_id: dummyOrderId,
                        order: { id: dummyOrderId, status: "ASSIGNED", delivery_date: targetDate },
                      },
                    ],
                    error: null,
                  });
                }
                return mockSupabase.from("delivery_stops");
              }),
              update: mockUpdate.mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null }),
              }),
            };
          }
          if (table === "orders") {
            return {
              update: mockUpdate.mockReturnValue({
                in: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ error: null }),
                }),
              }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
          };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await startDriverTrip(dummyDriverId, targetDate);

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.started).toBe(true);
      expect(res.data.count).toBe(1);
    });

    it("assigns unassigned order to driver and creates assigned stop", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: dummyOwnerId } },
          }),
        },
        from: vi.fn((table: string) => {
          if (table === "orders") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { id: dummyOrderId, status: "CONFIRMED", delivery_date: targetDate },
                error: null,
              }),
              update: vi.fn().mockReturnThis(),
            };
          }
          if (table === "delivery_stops") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              insert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await assignOrderToDriver({
        order_id: dummyOrderId,
        driver_id: dummyDriverId,
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.assigned).toBe(true);
    });

    it("prevents assigning already delivered or cancelled orders", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: dummyOwnerId } },
          }),
        },
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: dummyOrderId, status: "DELIVERED", delivery_date: targetDate },
            error: null,
          }),
        })),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await assignOrderToDriver({
        order_id: dummyOrderId,
        driver_id: dummyDriverId,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("DELIVERED");
    });
  });

  describe("4. Driver Daily Manifest Data Access", () => {
    it("returns driver manifest with customer instructions and items", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: dummyDriverId } },
          }),
        },
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: dummyStopId,
                order_id: dummyOrderId,
                sequence_number: 1,
                status: "ASSIGNED",
                order: {
                  id: dummyOrderId,
                  order_number: "ORD-001",
                  customer_id: dummyCustomerId,
                  delivery_address: "Flat 402, Sunrise Towers",
                  total_amount: 500,
                  customer: {
                    contact_name: "Anita Sharma",
                    phone: "9876543210",
                    delivery_instructions: "Leave with security at gate",
                  },
                  items: [
                    {
                      product_id: "prod-1",
                      quantity: 2,
                      delivered_quantity: 0,
                      product: { name: "20L Water Jar", is_reusable_jar: true },
                    },
                  ],
                },
              },
            ],
            error: null,
          }),
        })),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await getDriverDailyManifest(dummyDriverId);

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data).toHaveLength(1);
      expect(res.data[0].customer_name).toBe("Anita Sharma");
      expect(res.data[0].delivery_instructions).toBe("Leave with security at gate");
      expect(res.data[0].items).toHaveLength(1);
    });
  });

  describe("5. Driver Cash Float Settlement & Atomic RPC Integration", () => {
    it("delegates to public.rpc_settle_driver_cash and succeeds on exact match", async () => {
      // Opening Float: ₹1,000, Route Collections: ₹5,000, Approved Expenses: ₹600 -> Expected: ₹5,400
      // Handed Over: ₹5,400 -> Variance: 0 -> SETTLED
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: {
            success: true,
            handover_id: "handover-uuid-exact-1",
            expected_cash: 5400,
            cash_handed_over: 5400,
            route_cash_collected: 5000,
            upi_collected: 1500,
            on_route_expenses: 600,
            variance: 0,
            status: "SETTLED",
          },
          error: null,
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 1000,
        cash_handed_over: 5400,
        on_route_expenses: 600,
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.handover_id).toBe("handover-uuid-exact-1");
      expect(res.data.expected_cash).toBe(5400);
      expect(res.data.cash_handed_over).toBe(5400);
      expect(res.data.variance).toBe(0);
      expect(res.data.status).toBe("SETTLED");

      // Verify RPC invocation arguments
      expect(mockSupabase.rpc).toHaveBeenCalledWith("rpc_settle_driver_cash", {
        p_driver_id: dummyDriverId,
        p_handover_date: targetDate,
        p_opening_float: 1000,
        p_cash_handed_over: 5400,
        p_on_route_expenses: 600,
        p_notes: null,
      });
    });

    it("flags DISCREPANCY when driver surrenders less than expected cash (shortage)", async () => {
      // Expected: ₹5,000, Handed Over: ₹4,800 -> Variance: -200 -> DISCREPANCY
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: {
            success: true,
            handover_id: "handover-uuid-shortage-2",
            expected_cash: 5000,
            cash_handed_over: 4800,
            route_cash_collected: 4000,
            upi_collected: 0,
            on_route_expenses: 0,
            variance: -200,
            status: "DISCREPANCY",
          },
          error: null,
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 1000,
        cash_handed_over: 4800,
        on_route_expenses: 0,
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.expected_cash).toBe(5000);
      expect(res.data.cash_handed_over).toBe(4800);
      expect(res.data.variance).toBe(-200);
      expect(res.data.status).toBe("DISCREPANCY");
    });

    it("flags DISCREPANCY when driver surrenders more than expected cash (overage)", async () => {
      // Expected: ₹5,000, Handed Over: ₹5,200 -> Variance: +200 -> DISCREPANCY
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: {
            success: true,
            handover_id: "handover-uuid-overage-3",
            expected_cash: 5000,
            cash_handed_over: 5200,
            route_cash_collected: 4000,
            upi_collected: 0,
            on_route_expenses: 0,
            variance: 200,
            status: "DISCREPANCY",
          },
          error: null,
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 1000,
        cash_handed_over: 5200,
        on_route_expenses: 0,
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.expected_cash).toBe(5000);
      expect(res.data.cash_handed_over).toBe(5200);
      expect(res.data.variance).toBe(200);
      expect(res.data.status).toBe("DISCREPANCY");
    });

    it("propagates owner-only authorization error when invoked by unauthorized role", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Access denied: Only business owners can settle driver cash handovers." },
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 500,
        cash_handed_over: 500,
        on_route_expenses: 0,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Access denied: Only business owners");
    });

    it("propagates unauthenticated error when caller session is missing", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Access denied: unauthenticated caller." },
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 500,
        cash_handed_over: 500,
        on_route_expenses: 0,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Access denied: unauthenticated caller");
    });

    it("propagates invalid driver error when target staff ID does not exist or lacks staff role", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message: `Invalid driver: Target profile ${dummyDriverId} does not exist, is not active, or does not have role staff.`,
          },
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 500,
        cash_handed_over: 500,
        on_route_expenses: 0,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("does not exist, is not active, or does not have role staff");
    });

    it("prevents re-settling an already SETTLED handover (immutability guarantee)", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message: `Cash handover for driver ${dummyDriverId} on date ${targetDate} has already been settled and is immutable.`,
          },
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 500,
        cash_handed_over: 500,
        on_route_expenses: 0,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("has already been settled and is immutable");
    });

    it("prevents duplicate ledger vouchers on repeated discrepancy submission", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message: `Cash handover for driver ${dummyDriverId} on date ${targetDate} was already posted with a DISCREPANCY. Corrections must be made via explicit journal adjustment vouchers or reversal.`,
          },
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 500,
        cash_handed_over: 400,
        on_route_expenses: 0,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Corrections must be made via explicit journal adjustment vouchers or reversal");
    });

    it("propagates concurrent settlement race condition rejection (unique constraint)", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message: `Concurrent settlement attempt detected for driver ${dummyDriverId} on date ${targetDate}.`,
          },
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 500,
        cash_handed_over: 2500,
        on_route_expenses: 0,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Concurrent settlement attempt detected");
    });

    it("propagates on-route expenses validation error when exceeding verified driver expense vouchers", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message: `Approved on-route expenses (₹800) exceeds total driver cash expenses recorded in system (₹200) for date ${targetDate}. Owner must verify against recorded expense vouchers.`,
          },
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 500,
        cash_handed_over: 2500,
        on_route_expenses: 800,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("exceeds total driver cash expenses recorded in system");
    });

    it("propagates negative expected cash rejection from RPC", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message: "Expected cash cannot be negative (Calculated: ₹-300). Review opening float, cash collections, or on-route expenses.",
          },
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 0,
        cash_handed_over: 0,
        on_route_expenses: 300,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Expected cash cannot be negative");
    });

    it("handles unexpected network or database client exception gracefully", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockRejectedValue(new Error("Database connection pool exhausted")),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await settleDriverDailyCash({
        driver_id: dummyDriverId,
        handover_date: targetDate,
        opening_float: 500,
        cash_handed_over: 500,
        on_route_expenses: 0,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("Database connection pool exhausted");
    });
  });

  describe("6. Driver Collections Reconciliation View", () => {
    it("returns granular customer payment records joined with driver", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "profiles") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({
                data: [{ id: dummyDriverId, full_name: "Ramesh Kumar", phone: "9845012345", is_active: true }],
                error: null,
              }),
            };
          }
          if (table === "customer_payments") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "pay-1",
                    payment_number: "PAY-20261106-001",
                    payment_date: targetDate,
                    collected_by_staff_id: dummyDriverId,
                    customer_id: dummyCustomerId,
                    order_id: dummyOrderId,
                    amount: 800,
                    payment_method: "CASH",
                    reference_number: "STOP-1",
                    customer: { contact_name: "Ravi Kumar" },
                    order: { order_number: "ORD-999" },
                  },
                ],
                error: null,
              }),
            };
          }
          if (table === "cash_handovers") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }
          if (table === "expenses") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await getDriverCollectionsReconciliation({ date: targetDate });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data).toHaveLength(1);
      const summary = res.data[0];
      expect(summary.driver_name).toBe("Ramesh Kumar");
      expect(summary.route_cash_collected).toBe(800);
      expect(summary.payments).toHaveLength(1);
      expect(summary.payments[0].payment_number).toBe("PAY-20261106-001");
    });
  });
});

