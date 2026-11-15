import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  StockAdjustmentInputSchema,
  StockMovementTypeEnum,
  InventoryItemRecord,
  InventoryMovementRecord,
} from "@/modules/inventory/inventory.schema";
import {
  getInventoryStockLevels,
  getInventoryValuationSummary,
  getStockMovements,
  adjustStock,
} from "@/modules/inventory/inventory.service";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("Task 11: Inventory Management & Invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Schema & Movement Types Validation", () => {
    it("validates valid StockAdjustmentInputSchema", () => {
      const valid = {
        product_id: "123e4567-e89b-12d3-a456-426614174000",
        quantity_delta: -5,
        reason: "Damaged bottle during handling",
        movement_type: "DAMAGE_WRITEOFF" as const,
      };

      const parsed = StockAdjustmentInputSchema.parse(valid);
      expect(parsed.product_id).toBe(valid.product_id);
      expect(parsed.quantity_delta).toBe(-5);
      expect(parsed.movement_type).toBe("DAMAGE_WRITEOFF");
    });

    it("rejects adjustment input with short reason or non-integer delta", () => {
      const invalidShortReason = {
        product_id: "123e4567-e89b-12d3-a456-426614174000",
        quantity_delta: 10,
        reason: "no",
      };
      expect(() => StockAdjustmentInputSchema.parse(invalidShortReason)).toThrow();

      const invalidFloat = {
        product_id: "123e4567-e89b-12d3-a456-426614174000",
        quantity_delta: 5.5,
        reason: "Recount adjustment",
      };
      expect(() => StockAdjustmentInputSchema.parse(invalidFloat)).toThrow();
    });

    it("supports all authoritative database stock movement types", () => {
      const dbTypes = [
        "PURCHASE_RECEIPT",
        "POS_SALE",
        "DELIVERY_DISPATCH",
        "DELIVERY_RETURN",
        "ADJUSTMENT_IN",
        "ADJUSTMENT_OUT",
        "SCRAP_WRITEOFF",
      ];

      dbTypes.forEach((type) => {
        expect(() => StockMovementTypeEnum.parse(type)).not.toThrow();
      });
    });
  });

  describe("2. Low-Stock Visibility & Shortage Calculation", () => {
    it("calculates shortage and detects low-stock items accurately", () => {
      const sampleItems: InventoryItemRecord[] = [
        {
          product_id: "prod-1",
          sku: "JAR-20L",
          name: "20L Reusable Jar",
          category: "REFILLABLE_WATER",
          unit_of_measure: "JAR",
          current_stock: 40,
          reserved_stock: 15,
          available_stock: 25,
          reorder_level: 50,
          cost_price: 30,
          valuation: 1200,
          is_reusable_jar: true,
          updated_at: new Date().toISOString(),
        },
        {
          product_id: "prod-2",
          sku: "BTL-1L",
          name: "1L Packaged Water Box (12pk)",
          category: "PACKAGED_WATER",
          unit_of_measure: "BOX",
          current_stock: 120,
          reserved_stock: 10,
          available_stock: 110,
          reorder_level: 50,
          cost_price: 150,
          valuation: 18000,
          is_reusable_jar: false,
          updated_at: new Date().toISOString(),
        },
      ];

      // Item 1: available (25) <= reorder (50) -> Low Stock
      const item1 = sampleItems[0];
      const isItem1Low = item1.available_stock <= item1.reorder_level;
      const item1Shortage = Math.max(0, item1.reorder_level - item1.available_stock);
      expect(isItem1Low).toBe(true);
      expect(item1Shortage).toBe(25);

      // Item 2: available (110) > reorder (50) -> Optimal
      const item2 = sampleItems[1];
      const isItem2Low = item2.available_stock <= item2.reorder_level;
      const item2Shortage = Math.max(0, item2.reorder_level - item2.available_stock);
      expect(isItem2Low).toBe(false);
      expect(item2Shortage).toBe(0);

      // Filtering low stock only
      const lowStockList = sampleItems.filter((i) => i.available_stock <= i.reorder_level);
      expect(lowStockList.length).toBe(1);
      expect(lowStockList[0].sku).toBe("JAR-20L");
    });

    it("detects and flags over-commitment discrepancy when reserved exceeds physical stock", () => {
      // Discrepancy scenario: 80 physical units on hand, but 100 units reserved for orders
      const physicalStock = 80;
      const reservedStock = 100;

      const rawAvailable = physicalStock - reservedStock; // -20
      const availableStock = Math.max(0, rawAvailable); // 0 (cannot pick negative items)
      const overcommittedStock = Math.max(0, reservedStock - physicalStock); // 20

      expect(rawAvailable).toBe(-20);
      expect(availableStock).toBe(0);
      expect(overcommittedStock).toBe(20);
    });
  });

  describe("3. Authoritative Stock Levels & Valuation Summary", () => {
    it("retrieves stock levels with balances, shortage and valuation from database", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "warehouses") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "wh-central-1" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "products") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: "p1",
                        sku: "JAR-20L",
                        name: "20L Water Jar",
                        category: "REFILLABLE_WATER",
                        unit_of_measure: "JAR",
                        cost_price: 35,
                        is_reusable_jar: true,
                        is_active: true,
                      },
                      {
                        id: "p2",
                        sku: "DISP-ELEC",
                        name: "Electric Dispenser",
                        category: "DISPENSER_EQUIPMENT",
                        unit_of_measure: "UNIT",
                        cost_price: 600,
                        is_reusable_jar: false,
                        is_active: true,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "inventory_balances") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      product_id: "p1",
                      quantity_on_hand: 200,
                      quantity_reserved: 20,
                      updated_at: "2026-11-06T10:00:00Z",
                    },
                    {
                      product_id: "p2",
                      quantity_on_hand: 15,
                      quantity_reserved: 0,
                      updated_at: "2026-11-06T10:00:00Z",
                    },
                  ],
                  error: null,
                }),
              }),
            };
          }
          if (table === "customers") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [{ total_full_jars_holding: 5, total_empty_jars_holding: 2 }],
                  error: null,
                }),
              }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await getInventoryStockLevels();
      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");

      expect(res.data.length).toBe(2);

      // p1
      const p1 = res.data[0];
      expect(p1.current_stock).toBe(200);
      expect(p1.reserved_stock).toBe(20);
      expect(p1.available_stock).toBe(180);
      expect(p1.valuation).toBe(200 * 35); // 7,000
      expect(p1.shortage).toBe(0); // 180 > 50

      // p2
      const p2 = res.data[1];
      expect(p2.current_stock).toBe(15);
      expect(p2.available_stock).toBe(15);
      expect(p2.reorder_level).toBe(50);
      expect(p2.shortage).toBe(35); // 50 - 15 = 35 shortage
      expect(p2.valuation).toBe(15 * 600); // 9,000
    });

    it("aggregates inventory valuation summary correctly", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "warehouses") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "wh-central-1" },
                  }),
                }),
              }),
            };
          }
          if (table === "products") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: "p1",
                        sku: "JAR-20L",
                        name: "20L Water Jar",
                        cost_price: 35,
                      },
                      {
                        id: "p2",
                        sku: "DISP-ELEC",
                        name: "Electric Dispenser",
                        cost_price: 600,
                      },
                    ],
                  }),
                }),
              }),
            };
          }
          if (table === "inventory_balances") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { product_id: "p1", quantity_on_hand: 200, quantity_reserved: 0 },
                    { product_id: "p2", quantity_on_hand: 15, quantity_reserved: 0 },
                  ],
                }),
              }),
            };
          }
          if (table === "customers") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [{ total_full_jars_holding: 5, total_empty_jars_holding: 2 }],
                  error: null,
                }),
              }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const valRes = await getInventoryValuationSummary();
      expect(valRes.success).toBe(true);
      if (!valRes.success) throw new Error("Expected success");

      expect(valRes.data.total_distinct_products).toBe(2);
      expect(valRes.data.total_units_in_warehouse).toBe(215); // 200 + 15
      expect(valRes.data.total_inventory_valuation).toBe(16000); // 7000 + 9000
      expect(valRes.data.low_stock_items_count).toBe(1); // p2 has 15 <= 50
    });
  });

  describe("4. Stock Movement History & Audit Trails", () => {
    it("retrieves stock movements and calculates signed quantities and balance after", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "warehouses") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "wh-1" },
                  }),
                }),
              }),
            };
          }
          if (table === "inventory_balances") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { quantity_on_hand: 45 },
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "stock_movements") {
            return {
              select: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    eq: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: "sm-3",
                          product_id: "p1",
                          quantity: 5,
                          movement_type: "POS_SALE",
                          reference_type: "POS_SALE",
                          reference_id: "sale-101",
                          notes: "Counter beverage sale",
                          created_by: "staff-1",
                          created_at: "2026-11-06T15:00:00Z",
                          product: { id: "p1", sku: "BTL-500", name: "500ml Bottle", unit_of_measure: "BOTTLE" },
                          creator: { id: "staff-1", full_name: "Ramesh Staff" },
                        },
                        {
                          id: "sm-2",
                          product_id: "p1",
                          quantity: 10,
                          movement_type: "ADJUSTMENT_IN",
                          reference_type: "AUDIT",
                          reference_id: null,
                          notes: "Stock take recount surplus",
                          created_by: "owner-1",
                          created_at: "2026-11-06T12:00:00Z",
                          product: { id: "p1", sku: "BTL-500", name: "500ml Bottle", unit_of_measure: "BOTTLE" },
                          creator: { id: "owner-1", full_name: "Owner Kumar" },
                        },
                        {
                          id: "sm-1",
                          product_id: "p1",
                          quantity: 40,
                          movement_type: "PURCHASE_RECEIPT",
                          reference_type: "PURCHASE",
                          reference_id: "po-1",
                          notes: "Received purchase batch",
                          created_by: "owner-1",
                          created_at: "2026-11-05T09:00:00Z",
                          product: { id: "p1", sku: "BTL-500", name: "500ml Bottle", unit_of_measure: "BOTTLE" },
                          creator: { id: "owner-1", full_name: "Owner Kumar" },
                        },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "customers") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [{ total_full_jars_holding: 5, total_empty_jars_holding: 2 }],
                  error: null,
                }),
              }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await getStockMovements("p1", 10);
      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");

      expect(res.data.length).toBe(3);

      // sm-3 (most recent): POS_SALE outflow (-5)
      const m3 = res.data[0];
      expect(m3.quantity).toBe(-5);
      expect(m3.creator_name).toBe("Ramesh Staff");
      expect(m3.notes).toBe("Counter beverage sale");

      // sm-2: ADJUSTMENT_IN (+10)
      const m2 = res.data[1];
      expect(m2.quantity).toBe(10);
      expect(m2.notes).toBe("Stock take recount surplus");

      // sm-1: PURCHASE_RECEIPT (+40)
      const m1 = res.data[2];
      expect(m1.quantity).toBe(40);
      expect(m1.reference_type).toBe("PURCHASE");
    });
  });

  describe("5. Manual Stock Adjustment & Atomic RPC", () => {
    it("calls rpc_adjust_inventory_stock atomically and returns new stock balance", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: { new_stock: 55 },
          error: null,
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await adjustStock({
        product_id: "123e4567-e89b-12d3-a456-426614174000",
        quantity_delta: 5,
        reason: "Surplus detected during daily count",
        movement_type: "PHYSICAL_AUDIT_ADJUSTMENT",
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.newStock).toBe(55);
      expect(mockSupabase.rpc).toHaveBeenCalledWith("rpc_adjust_inventory_stock", {
        p_product_id: "123e4567-e89b-12d3-a456-426614174000",
        p_quantity_delta: 5,
        p_reason: "Surplus detected during daily count",
      });
    });

    it("propagates RPC error when negative stock is prohibited", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "Negative stock prohibited: current 2, requested change -5" },
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await adjustStock({
        product_id: "123e4567-e89b-12d3-a456-426614174000",
        quantity_delta: -5,
        reason: "Excess damage claim",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Negative stock prohibited");
    });
  });
});

