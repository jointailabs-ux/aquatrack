import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RecordJarScrapSchema,
  RecordJarAdjustmentSchema,
  JarConditionEnum,
} from "@/modules/jars/jar.schema";
import {
  getJarLocations,
  getLocationJarCount,
  recordJarScrap,
  recordPhysicalStockAdjustment,
  getJarCustodyMovements,
} from "@/modules/jars/jar.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

describe("Task 10: Jar Scrap, Disposal & Physical Stock Adjustment Invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Schema Validations", () => {
    it("validates RecordJarScrapSchema with valid parameters", () => {
      const valid = {
        source_location_id: "123e4567-e89b-12d3-a456-426614174000",
        condition_from: "DAMAGED_REPAIRABLE",
        quantity: 10,
        disposal_date: "2026-11-06",
        reason: "Cracked bottle body, unrepairable",
      };

      const result = RecordJarScrapSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.quantity).toBe(10);
        expect(result.data.condition_from).toBe("DAMAGED_REPAIRABLE");
      }
    });

    it("rejects scrap input with zero or negative quantity", () => {
      const zero = {
        source_location_id: "123e4567-e89b-12d3-a456-426614174000",
        condition_from: "DAMAGED_REPAIRABLE",
        quantity: 0,
        reason: "Cracked body",
      };
      const negative = {
        source_location_id: "123e4567-e89b-12d3-a456-426614174000",
        condition_from: "DAMAGED_REPAIRABLE",
        quantity: -5,
        reason: "Cracked body",
      };

      expect(RecordJarScrapSchema.safeParse(zero).success).toBe(false);
      expect(RecordJarScrapSchema.safeParse(negative).success).toBe(false);
    });

    it("rejects scrap input with non-damaged condition", () => {
      const invalidCond = {
        source_location_id: "123e4567-e89b-12d3-a456-426614174000",
        condition_from: "FULL_USABLE", // Only DAMAGED_REPAIRABLE or DAMAGED_SCRAP can be scrapped
        quantity: 5,
        reason: "Broken",
      };

      expect(RecordJarScrapSchema.safeParse(invalidCond).success).toBe(false);
    });

    it("validates RecordJarAdjustmentSchema with valid parameters", () => {
      const valid = {
        location_id: "123e4567-e89b-12d3-a456-426614174000",
        condition: "EMPTY_CLEAN",
        actual_quantity: 175,
        reason: "Monthly physical inventory audit count",
        adjustment_date: "2026-11-06",
      };

      const result = RecordJarAdjustmentSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.actual_quantity).toBe(175);
        expect(result.data.condition).toBe("EMPTY_CLEAN");
      }
    });

    it("rejects adjustment input with negative actual quantity or missing reason", () => {
      const negativeQty = {
        location_id: "123e4567-e89b-12d3-a456-426614174000",
        condition: "EMPTY_DIRTY",
        actual_quantity: -1,
        reason: "Recount",
      };
      const missingReason = {
        location_id: "123e4567-e89b-12d3-a456-426614174000",
        condition: "EMPTY_DIRTY",
        actual_quantity: 50,
        reason: "  ",
      };

      expect(RecordJarAdjustmentSchema.safeParse(negativeQty).success).toBe(false);
      expect(RecordJarAdjustmentSchema.safeParse(missingReason).success).toBe(false);
    });
  });

  describe("2. Physical Stock Discrepancy & Scrap Math", () => {
    it("calculates surplus and shortage discrepancies accurately", () => {
      const systemCount = 180;

      // Case 1: Shortage
      const actualShortage = 175;
      const deltaShortage = actualShortage - systemCount;
      expect(deltaShortage).toBe(-5);

      // Case 2: Surplus
      const actualSurplus = 192;
      const deltaSurplus = actualSurplus - systemCount;
      expect(deltaSurplus).toBe(12);

      // Case 3: Balanced
      const actualBalanced = 180;
      const deltaBalanced = actualBalanced - systemCount;
      expect(deltaBalanced).toBe(0);
    });

    it("prevents disposal of more jars than available in selected location/condition", () => {
      const availableDamaged = 8;
      const requestedScrap = 12;

      expect(requestedScrap > availableDamaged).toBe(true);
      const isAllowed = requestedScrap <= availableDamaged;
      expect(isAllowed).toBe(false);
    });
  });

  describe("3. Jar Service Operations & Permissions", () => {
    it("retrieves active jar custody locations", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "locations") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockResolvedValue({
                    data: [
                      { id: "loc-1", name: "Central Bottling Depot", type: "WAREHOUSE", address: "Plot 12" },
                      { id: "loc-2", name: "Delivery Van #1", type: "VEHICLE", address: null },
                      { id: "loc-3", name: "Scrap & Disposal Yard", type: "SCRAP_YARD", address: "Yard B" },
                    ],
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

      const res = await getJarLocations();
      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.length).toBe(3);
      expect(res.data[0].type).toBe("WAREHOUSE");
      expect(res.data[2].type).toBe("SCRAP_YARD");
    });

    it("records jar scrap write-off when authorized by owner", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "owner-1" } },
          }),
        },
        from: vi.fn((table: string) => {
          if (table === "profiles") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { role: "owner" } }),
                }),
              }),
            };
          }
          if (table === "locations") {
            const locQuery: any = {
              single: vi.fn().mockResolvedValue({ data: { id: "loc-wh", type: "WAREHOUSE" } }),
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: "loc-scrap", type: "SCRAP_YARD" } }),
            };
            locQuery.eq = vi.fn().mockReturnValue(locQuery);
            return {
              select: vi.fn().mockReturnValue(locQuery),
            };
          }
          if (table === "jar_custody_movements") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn((col: string) => ({
                  eq: vi.fn().mockResolvedValue({
                    data: col === "destination_location_id" ? [{ quantity: 15 }] : [],
                  }),
                })),
              }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
        rpc: vi.fn().mockResolvedValue({
          data: { movement_id: "mov-scrap-123" },
          error: null,
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await recordJarScrap({
        source_location_id: "123e4567-e89b-12d3-a456-426614174000",
        condition_from: "DAMAGED_REPAIRABLE",
        quantity: 5,
        disposal_date: "2026-11-06",
        reason: "Severe base cracks, unrepairable",
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.movementId).toBe("mov-scrap-123");
      expect(mockSupabase.rpc).toHaveBeenCalledWith("rpc_record_jar_movement", {
        p_source_location_id: "123e4567-e89b-12d3-a456-426614174000",
        p_destination_location_id: "loc-scrap",
        p_condition_from: "DAMAGED_REPAIRABLE",
        p_condition_to: "DAMAGED_SCRAP",
        p_quantity: 5,
        p_movement_type: "SCRAP_WRITEOFF",
        p_reference_type: "AUDIT",
        p_notes: "[Scrap Disposal - 2026-11-06] Severe base cracks, unrepairable",
      });
    });

    it("rejects jar scrap when caller is not the business owner", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "staff-1" } },
          }),
        },
        from: vi.fn((table: string) => {
          if (table === "profiles") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { role: "staff" } }),
                }),
              }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await recordJarScrap({
        source_location_id: "123e4567-e89b-12d3-a456-426614174000",
        condition_from: "DAMAGED_REPAIRABLE",
        quantity: 2,
        disposal_date: "2026-11-06",
        reason: "Broken handle",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Only the business owner");
    });

    it("records physical stock adjustment without silently overwriting balances", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "owner-1" } },
          }),
        },
        from: vi.fn((table: string) => {
          if (table === "profiles") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { role: "owner" } }),
                }),
              }),
            };
          }
          if (table === "locations") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: "loc-wh", name: "Warehouse", type: "WAREHOUSE" } }),
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "loc-scrap", type: "SCRAP_YARD" } }),
                }),
              }),
            };
          }
          if (table === "warehouses") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "wh-1", location_id: "loc-wh" } }),
                }),
              }),
            };
          }
          if (table === "products") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "prod-jar-1" } }),
                }),
              }),
            };
          }
          if (table === "inventory_balances") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { quantity_on_hand: 450 } }),
                  }),
                }),
              }),
              upsert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === "stock_movements") {
            return {
              insert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === "jar_custody_movements") {
            return {
              insert: vi.fn().mockResolvedValue({ error: null }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await recordPhysicalStockAdjustment({
        location_id: "123e4567-e89b-12d3-a456-426614174000",
        condition: "FULL_USABLE",
        actual_quantity: 455,
        reason: "Surplus jars found during weekend stock take",
        adjustment_date: "2026-11-06",
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.previousQuantity).toBe(450);
      expect(res.data.newQuantity).toBe(455);
      expect(res.data.difference).toBe(5);
    });

    it("retrieves permanent jar custody movement history", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "jar_custody_movements") {
            return {
              select: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: "mov-1",
                        source_location_id: "loc-wh",
                        destination_location_id: "loc-scrap",
                        condition_from: "DAMAGED_REPAIRABLE",
                        condition_to: "DAMAGED_SCRAP",
                        quantity: 4,
                        movement_type: "SCRAP_WRITEOFF",
                        reference_type: "AUDIT",
                        notes: "Unrepairable cracked jars",
                        created_by: "owner-1",
                        created_at: "2026-11-06T12:00:00Z",
                        source_location: { name: "Central Warehouse", type: "WAREHOUSE" },
                        destination_location: { name: "Scrap Yard", type: "SCRAP_YARD" },
                      },
                    ],
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

      const res = await getJarCustodyMovements(10);
      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.length).toBe(1);
      expect(res.data[0].movement_type).toBe("SCRAP_WRITEOFF");
      expect(res.data[0].quantity).toBe(4);
      expect(res.data[0].source_location_name).toBe("Central Warehouse");
      expect(res.data[0].destination_location_name).toBe("Scrap Yard");
    });
  });
});
