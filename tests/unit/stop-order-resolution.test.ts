import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DeliveryExecutionSchema,
} from "@/modules/orders/order.schema";
import {
  getOrderForDeliveryStop,
  executeDeliveryStop,
} from "@/modules/orders/order.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

describe("Driver Stop vs Order Identification & Resolution", () => {
  const dummyStopId = "11111111-aaaa-bbbb-cccc-111111111111";
  const dummyOrderId = "22222222-aaaa-bbbb-cccc-222222222222";
  const dummyStaffId = "33333333-aaaa-bbbb-cccc-333333333333";
  const dummyProductId = "44444444-aaaa-bbbb-cccc-444444444444";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("DeliveryExecutionSchema Validations", () => {
    it("accepts valid delivery execution input with order_id and optional stop_id", () => {
      const valid = {
        order_id: dummyOrderId,
        stop_id: dummyStopId,
        actual_quantity_delivered: 2,
        empty_jars_collected: 2,
        damaged_jars_collected: 0,
        amount_collected: 160,
        payment_method: "CASH" as const,
        items: [
          {
            product_id: dummyProductId,
            quantity_delivered: 2,
          },
        ],
      };
      const result = DeliveryExecutionSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.order_id).toBe(dummyOrderId);
        expect(result.data.stop_id).toBe(dummyStopId);
      }
    });

    it("accepts delivery execution input with order_id when stop_id is omitted", () => {
      const valid = {
        order_id: dummyOrderId,
        actual_quantity_delivered: 1,
        empty_jars_collected: 1,
        damaged_jars_collected: 0,
        amount_collected: 80,
        payment_method: "UPI" as const,
      };
      const result = DeliveryExecutionSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.order_id).toBe(dummyOrderId);
        expect(result.data.stop_id).toBeUndefined();
      }
    });

    it("rejects invalid stop_id (non-UUID)", () => {
      const invalid = {
        order_id: dummyOrderId,
        stop_id: "not-a-uuid",
        actual_quantity_delivered: 1,
        empty_jars_collected: 1,
      };
      const result = DeliveryExecutionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("getOrderForDeliveryStop Service Disambiguation", () => {
    it("resolves order when given a true delivery stop ID (delivery_stops.id)", async () => {
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: (table: string) => {
          if (table === "delivery_stops") {
            return {
              select: () => ({
                eq: (col: string, val: string) => {
                  if (col === "id" && val === dummyStopId) {
                    return {
                      maybeSingle: async () => ({
                        data: {
                          id: dummyStopId,
                          order_id: dummyOrderId,
                          status: "EN_ROUTE",
                          sequence_number: 1,
                          assigned_staff_id: dummyStaffId,
                        },
                        error: null,
                      }),
                    };
                  }
                  return { maybeSingle: async () => ({ data: null, error: null }) };
                },
              }),
            };
          }
          if (table === "orders") {
            return {
              select: () => ({
                order: () => ({
                  eq: (col: string, val: string) => {
                    if (col === "id" && val === dummyOrderId) {
                      return Promise.resolve({
                        data: [
                          {
                            id: dummyOrderId,
                            order_number: "ORD-20261110-0001",
                            customer_id: "cust-1",
                            delivery_address: "123 Water St",
                            delivery_date: "2026-11-10",
                            status: "OUT_FOR_DELIVERY",
                            total_amount: 160,
                            customer: { contact_name: "Ramesh", phone: "9876543210" },
                            items: [{ product_id: dummyProductId, quantity: 2, is_reusable_jar: true }],
                            stop: { id: dummyStopId },
                          },
                        ],
                        error: null,
                      });
                    }
                    return Promise.resolve({ data: [], error: null });
                  },
                }),
              }),
            };
          }
          return {};
        },
      });

      const res = await getOrderForDeliveryStop(dummyStopId);

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.isStopId).toBe(true);
        expect(res.data.stopId).toBe(dummyStopId);
        expect(res.data.orderId).toBe(dummyOrderId);
        expect(res.data.order.id).toBe(dummyOrderId);
        expect(res.data.order.order_number).toBe("ORD-20261110-0001");
      }
    });

    it("resolves order when given an order ID directly (orders.id fallback)", async () => {
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: (table: string) => {
          if (table === "delivery_stops") {
            return {
              select: () => ({
                eq: (col: string, val: string) => {
                  if (col === "id") {
                    // Not found in delivery_stops
                    return { maybeSingle: async () => ({ data: null, error: null }) };
                  }
                  if (col === "order_id" && val === dummyOrderId) {
                    return {
                      order: () => ({
                        limit: () => ({
                          maybeSingle: async () => ({
                            data: { id: dummyStopId },
                            error: null,
                          }),
                        }),
                      }),
                    };
                  }
                  return { maybeSingle: async () => ({ data: null, error: null }) };
                },
              }),
            };
          }
          if (table === "orders") {
            return {
              select: () => ({
                eq: (col: string, val: string) => {
                  if (col === "id" && val === dummyOrderId) {
                    return {
                      maybeSingle: async () => ({
                        data: { id: dummyOrderId, status: "ASSIGNED" },
                        error: null,
                      }),
                    };
                  }
                  return { maybeSingle: async () => ({ data: null, error: null }) };
                },
                order: () => ({
                  eq: (col: string, val: string) => {
                    if (col === "id" && val === dummyOrderId) {
                      return Promise.resolve({
                        data: [
                          {
                            id: dummyOrderId,
                            order_number: "ORD-20261110-0002",
                            customer_id: "cust-2",
                            delivery_address: "456 Lake Rd",
                            delivery_date: "2026-11-10",
                            status: "ASSIGNED",
                            total_amount: 80,
                            customer: { contact_name: "Priya", phone: "9876543211" },
                            items: [{ product_id: dummyProductId, quantity: 1, is_reusable_jar: true }],
                            stop: { id: dummyStopId },
                          },
                        ],
                        error: null,
                      });
                    }
                    return Promise.resolve({ data: [], error: null });
                  },
                }),
              }),
            };
          }
          return {};
        },
      });

      const res = await getOrderForDeliveryStop(dummyOrderId);

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.isStopId).toBe(false);
        expect(res.data.orderId).toBe(dummyOrderId);
        expect(res.data.stopId).toBe(dummyStopId);
        expect(res.data.order.order_number).toBe("ORD-20261110-0002");
      }
    });

    it("returns error safely when identifier matches neither a stop nor an order", async () => {
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      });

      const res = await getOrderForDeliveryStop("00000000-0000-0000-0000-000000000000");

      expect(res.success).toBe(false);
      expect(res.error).toContain("not found");
    });

    it("returns error safely when identifier is empty string", async () => {
      const res = await getOrderForDeliveryStop("");
      expect(res.success).toBe(false);
      expect(res.error).toContain("Invalid delivery stop");
    });
  });
});
