import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SupplierInputSchema,
  UpdateSupplierInputSchema,
} from "@/modules/suppliers/supplier.schema";
import { updateSupplier } from "@/modules/suppliers/supplier.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

describe("Supplier Management & Editing Module", () => {
  const dummySupplierId = "11111111-2222-3333-4444-555555555555";
  const dummyLocationId = "99999999-8888-7777-6666-555555555555";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("UpdateSupplierInputSchema Validation", () => {
    it("accepts valid supplier update payload", () => {
      const valid = {
        id: dummySupplierId,
        name: "Ganga Purifiers Ltd",
        contact_person: "Ramesh Sharma",
        phone: "+91 98765 43210",
        email: "ramesh@ganga.com",
        address: "Plot 42, Peenya Industrial Area",
        gstin: "29ABCDE1234F1Z5",
        payment_terms_days: 30,
        is_active: true,
      };
      const parsed = UpdateSupplierInputSchema.parse(valid);
      expect(parsed.id).toBe(dummySupplierId);
      expect(parsed.payment_terms_days).toBe(30);
      expect(parsed.is_active).toBe(true);
    });

    it("accepts empty optional email and gstin", () => {
      const valid = {
        id: dummySupplierId,
        name: "Cauvery Water Plant",
        contact_person: "Suresh",
        phone: "9876543210",
        email: "",
        address: "",
        gstin: null,
        payment_terms_days: 15,
        is_active: false,
      };
      const parsed = UpdateSupplierInputSchema.parse(valid);
      expect(parsed.name).toBe("Cauvery Water Plant");
      expect(parsed.is_active).toBe(false);
    });

    it("rejects invalid supplier ID (non-UUID)", () => {
      expect(() => {
        UpdateSupplierInputSchema.parse({
          id: "invalid-id",
          name: "Test Supplier",
          contact_person: "Tester",
          phone: "9876543210",
        });
      }).toThrow();
    });

    it("rejects empty supplier name or short contact person", () => {
      expect(() => {
        UpdateSupplierInputSchema.parse({
          id: dummySupplierId,
          name: "A",
          contact_person: "B",
          phone: "9876543210",
        });
      }).toThrow();
    });
  });

  describe("updateSupplier service", () => {
    it("updates supplier and syncs location record", async () => {
      const mockEq = vi.fn();
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      const mockSingle = vi.fn().mockResolvedValue({
        data: {
          id: dummySupplierId,
          location_id: dummyLocationId,
          name: "Ganga Purifiers",
        },
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: mockSingle,
        }),
      });

      const mockFrom = vi.fn((table: string) => {
        if (table === "suppliers") {
          return {
            select: mockSelect,
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === "locations") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {};
      });

      // For getSupplierById call at the end
      let callCount = 0;
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: (table: string) => {
          if (table === "suppliers") {
            return {
              select: () => ({
                eq: () => ({
                  single: async () => {
                    callCount++;
                    if (callCount === 1) {
                      return {
                        data: { id: dummySupplierId, location_id: dummyLocationId },
                        error: null,
                      };
                    }
                    return {
                      data: {
                        id: dummySupplierId,
                        name: "Ganga Purifiers Ltd",
                        contact_person: "Ramesh Sharma",
                        phone: "9876543210",
                        email: "ramesh@ganga.com",
                        address: "Peenya",
                        gstin: null,
                        payment_terms_days: 30,
                        is_active: true,
                        location_id: dummyLocationId,
                      },
                      error: null,
                    };
                  },
                }),
              }),
              update: () => ({
                eq: async () => ({ error: null }),
              }),
            };
          }
          if (table === "locations") {
            return {
              update: () => ({
                eq: async () => ({ error: null }),
              }),
            };
          }
          return {};
        },
      });

      const res = await updateSupplier({
        id: dummySupplierId,
        name: "Ganga Purifiers Ltd",
        contact_person: "Ramesh Sharma",
        phone: "9876543210",
        email: "ramesh@ganga.com",
        address: "Peenya",
        gstin: null,
        payment_terms_days: 30,
        is_active: true,
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe("Ganga Purifiers Ltd");
        expect(res.data.is_active).toBe(true);
      }
    });

    it("returns error if supplier does not exist", async () => {
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: null,
                error: { message: "Supplier not found" },
              }),
            }),
          }),
        }),
      });

      const res = await updateSupplier({
        id: dummySupplierId,
        name: "Nonexistent Supplier",
        contact_person: "Nobody",
        phone: "12345678",
        payment_terms_days: 15,
        is_active: false,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("Supplier not found");
    });
  });
});
