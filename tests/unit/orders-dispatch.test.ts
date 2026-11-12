import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CreateOrderSchema,
  CancelOrderSchema,
  OrderItemSchema,
  CreateOrderInput,
} from "@/modules/orders/order.schema";
import { createOrder, cancelCustomerOrder, cancelOrder } from "@/modules/orders/order.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

describe("Orders & Dispatch Management Module", () => {
  const dummyCustomerId = "11111111-1111-4111-a111-111111111111";
  const productA = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const productB = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const productC = "cccccccc-cccc-4ccc-cccc-cccccccccccc";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Multi-Product Order Schema Validation", () => {
    it("validates and accepts an order with multiple distinct products", () => {
      const input: CreateOrderInput = {
        customer_id: dummyCustomerId,
        order_date: "2026-11-10",
        delivery_date: "2026-11-10",
        delivery_address: "Flat 402, Green Heights, Bangalore",
        items: [
          {
            product_id: productA,
            product_name: "20L Natural Spring Water Jar",
            quantity: 5,
            unit_price: 90.0,
            gst_rate: 18.0,
            tax_amount: 81.0,
            total_amount: 531.0,
            is_reusable_jar: true,
          },
          {
            product_id: productB,
            product_name: "Manual Water Dispenser Pump",
            quantity: 2,
            unit_price: 250.0,
            gst_rate: 18.0,
            tax_amount: 90.0,
            total_amount: 590.0,
            is_reusable_jar: false,
          },
          {
            product_id: productC,
            product_name: "Plastic Jar Bottom Cradle",
            quantity: 1,
            unit_price: 150.0,
            gst_rate: 12.0,
            tax_amount: 18.0,
            total_amount: 168.0,
            is_reusable_jar: false,
          },
        ],
      };

      const parsed = CreateOrderSchema.parse(input);
      expect(parsed.items).toHaveLength(3);
      expect(parsed.customer_id).toBe(dummyCustomerId);
    });

    it("calculates correct subtotals, GST, and totals for multiple line items", () => {
      const items = [
        {
          product_id: productA,
          product_name: "20L Water Jar",
          quantity: 10,
          unit_price: 100,
          gst_rate: 18,
          tax_amount: 180,
          total_amount: 1180,
          is_reusable_jar: true,
        },
        {
          product_id: productB,
          product_name: "Countertop Dispenser",
          quantity: 2,
          unit_price: 500,
          gst_rate: 18,
          tax_amount: 180,
          total_amount: 1180,
          is_reusable_jar: false,
        },
      ];

      const subtotal = items.reduce((acc, i) => acc + i.quantity * i.unit_price, 0);
      const taxTotal = items.reduce((acc, i) => acc + i.tax_amount, 0);
      const grandTotal = subtotal + taxTotal;

      expect(subtotal).toBe(2000);
      expect(taxTotal).toBe(360);
      expect(grandTotal).toBe(2360);
    });

    it("rejects an order with empty items array", () => {
      const input = {
        customer_id: dummyCustomerId,
        delivery_date: "2026-11-10",
        delivery_address: "42 Market Road",
        items: [],
      };

      expect(() => CreateOrderSchema.parse(input)).toThrow(
        "At least one product item is required"
      );
    });

    it("rejects zero or negative quantities in line items", () => {
      const zeroQtyItem = {
        product_id: productA,
        product_name: "20L Jar",
        quantity: 0,
        unit_price: 100,
        gst_rate: 18,
        tax_amount: 0,
        total_amount: 0,
        is_reusable_jar: true,
      };

      expect(() => OrderItemSchema.parse(zeroQtyItem)).toThrow(
        "Quantity must be positive"
      );

      const negativeQtyItem = {
        ...zeroQtyItem,
        quantity: -5,
      };

      expect(() => OrderItemSchema.parse(negativeQtyItem)).toThrow(
        "Quantity must be positive"
      );
    });

    it("rejects non-integer quantities in line items", () => {
      const floatQtyItem = {
        product_id: productA,
        product_name: "20L Jar",
        quantity: 2.5,
        unit_price: 100,
        gst_rate: 18,
        tax_amount: 45,
        total_amount: 295,
        is_reusable_jar: true,
      };

      expect(() => OrderItemSchema.parse(floatQtyItem)).toThrow();
    });

    it("rejects negative unit prices in line items", () => {
      const negativePriceItem = {
        product_id: productA,
        product_name: "20L Jar",
        quantity: 2,
        unit_price: -50,
        gst_rate: 18,
        tax_amount: 0,
        total_amount: 0,
        is_reusable_jar: true,
      };

      expect(() => OrderItemSchema.parse(negativePriceItem)).toThrow(
        "Unit price must be non-negative"
      );
    });

    it("requires a valid delivery address with minimum length", () => {
      const input = {
        customer_id: dummyCustomerId,
        delivery_date: "2026-11-10",
        delivery_address: "Hi", // too short
        items: [
          {
            product_id: productA,
            product_name: "20L Jar",
            quantity: 1,
            unit_price: 100,
            gst_rate: 18,
            tax_amount: 18,
            total_amount: 118,
            is_reusable_jar: true,
          },
        ],
      };

      expect(() => CreateOrderSchema.parse(input)).toThrow(
        "Delivery address required"
      );
    });
  });

  describe("Order Cancellation Schema Validation", () => {
    it("accepts valid UUID order_id with optional reason", () => {
      const valid = {
        order_id: "22222222-2222-4222-a222-222222222222",
        reason: "Customer cancelled delivery",
      };

      const parsed = CancelOrderSchema.parse(valid);
      expect(parsed.order_id).toBe("22222222-2222-4222-a222-222222222222");
      expect(parsed.reason).toBe("Customer cancelled delivery");
    });

    it("rejects invalid UUID for order_id", () => {
      const invalid = {
        order_id: "not-a-uuid",
        reason: "wrong id",
      };

      expect(() => CancelOrderSchema.parse(invalid)).toThrow(
        "Order ID must be a valid UUID"
      );
    });

    it("rejects excessively long cancellation reasons", () => {
      const tooLong = {
        order_id: "22222222-2222-4222-a222-222222222222",
        reason: "a".repeat(501),
      };

      expect(() => CancelOrderSchema.parse(tooLong)).toThrow(
        "Cancellation reason must not exceed 500 characters"
      );
    });
  });

  describe("Order Service Integration (Mocked RPC)", () => {
    it("calls rpc_create_customer_order with multi-product payload", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          order_id: "33333333-3333-4333-a333-333333333333",
          order_number: "ORD-20261110-001",
          subtotal: 1000,
          tax_total: 180,
          total_amount: 1180,
        },
        error: null,
      });

      const mockGetUser = vi.fn().mockResolvedValue({
        data: { user: { id: "user-123", email: "staff@aquatrack.com" } },
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: mockGetUser },
        rpc: mockRpc,
      });

      const res = await createOrder({
        customer_id: dummyCustomerId,
        order_date: "2026-11-10",
        delivery_date: "2026-11-10",
        delivery_address: "123 Water Works Road, Industrial Area",
        items: [
          {
            product_id: productA,
            product_name: "20L Jar",
            quantity: 8,
            unit_price: 100,
            gst_rate: 18,
            tax_amount: 144,
            total_amount: 944,
            is_reusable_jar: true,
          },
          {
            product_id: productB,
            product_name: "500ml Pack",
            quantity: 2,
            unit_price: 100,
            gst_rate: 18,
            tax_amount: 36,
            total_amount: 236,
            is_reusable_jar: false,
          },
        ],
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.order_number).toBe("ORD-20261110-001");
      }
      expect(mockRpc).toHaveBeenCalledWith("rpc_create_customer_order", expect.objectContaining({
        p_customer_id: dummyCustomerId,
        p_items: [
          { product_id: productA, quantity: 8, unit_price: 100, gst_rate: 18 },
          { product_id: productB, quantity: 2, unit_price: 100, gst_rate: 18 },
        ],
      }));
    });

    it("requires authentication to create orders", async () => {
      const mockGetUser = vi.fn().mockResolvedValue({
        data: { user: null },
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: mockGetUser },
      });

      const res = await createOrder({
        customer_id: dummyCustomerId,
        order_date: "2026-11-10",
        delivery_date: "2026-11-10",
        delivery_address: "123 Water Works Road",
        items: [
          {
            product_id: productA,
            product_name: "20L Jar",
            quantity: 1,
            unit_price: 100,
            gst_rate: 18,
            tax_amount: 18,
            total_amount: 118,
            is_reusable_jar: true,
          },
        ],
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Authentication required");
    });

    it("cancels an eligible order via cancelCustomerOrder (and backward-compatible alias cancelOrder)", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          order_id: "44444444-4444-4444-a444-444444444444",
          order_number: "ORD-20261110-044",
          status: "CANCELLED",
          released_reservation: true,
        },
        error: null,
      });

      const mockGetUser = vi.fn().mockResolvedValue({
        data: { user: { id: "user-123" } },
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: mockGetUser },
        rpc: mockRpc,
      });

      // Test cancelCustomerOrder
      const res1 = await cancelCustomerOrder({
        order_id: "44444444-4444-4444-a444-444444444444",
        reason: "Customer cancelled via phone",
      });

      expect(res1.success).toBe(true);
      if (res1.success) {
        expect(res1.data.status).toBe("CANCELLED");
        expect(res1.data.released_reservation).toBe(true);
      }

      // Verify identical function equality
      expect(cancelCustomerOrder).toBe(cancelOrder);
    });

    it("handles cancellation errors gracefully when RPC returns an error", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Order cannot be cancelled in DELIVERED status." },
      });

      const mockGetUser = vi.fn().mockResolvedValue({
        data: { user: { id: "user-123" } },
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: mockGetUser },
        rpc: mockRpc,
      });

      const res = await cancelCustomerOrder({
        order_id: "55555555-5555-4555-a555-555555555555",
        reason: "Late cancellation attempt",
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("Order cannot be cancelled in DELIVERED status.");
    });
  });
});

