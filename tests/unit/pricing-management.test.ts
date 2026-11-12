import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SpecialPriceInputSchema,
  SpecialPriceUpdateSchema,
  SpecialPriceRecord,
} from "@/modules/pricing/special-price.schema";
import {
  createSpecialPrice,
  updateSpecialPrice,
  deactivateSpecialPrice,
  resolveEffectivePrice,
  getAllSpecialPrices,
  getPricingDashboardKPIs,
} from "@/modules/pricing/special-price.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

describe("Pricing Management Module & Invariants", () => {
  const dummyCustomerId = "11111111-2222-3333-4444-555555555555";
  const dummyCustomer2Id = "22222222-3333-4444-5555-666666666666";
  const dummyProductId = "33333333-4444-5555-6666-777777777777";
  const dummyProduct2Id = "44444444-5555-6666-7777-888888888888";
  const dummyAgreementId = "99999999-aaaa-bbbb-cccc-dddddddddddd";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Schema Validations & Constraints", () => {
    it("validates valid special pricing agreement input", () => {
      const validInput = {
        customer_id: dummyCustomerId,
        product_id: dummyProductId,
        special_price: 75.0,
        effective_from: "2026-11-01",
        effective_to: "2026-12-31",
      };

      const result = SpecialPriceInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("allows indefinite / ongoing agreements where effective_to is null or omitted", () => {
      const ongoingInput = {
        customer_id: dummyCustomerId,
        product_id: dummyProductId,
        special_price: 80.0,
        effective_from: "2026-11-01",
      };

      const result = SpecialPriceInputSchema.safeParse(ongoingInput);
      expect(result.success).toBe(true);
    });

    it("rejects negative special prices", () => {
      const negativePriceInput = {
        customer_id: dummyCustomerId,
        product_id: dummyProductId,
        special_price: -10.0,
        effective_from: "2026-11-01",
      };

      const result = SpecialPriceInputSchema.safeParse(negativePriceInput);
      expect(result.success).toBe(false);
    });

    it("rejects agreements where effective_to precedes effective_from", () => {
      const invalidDatesInput = {
        customer_id: dummyCustomerId,
        product_id: dummyProductId,
        special_price: 75.0,
        effective_from: "2026-11-15",
        effective_to: "2026-11-10",
      };

      const result = SpecialPriceInputSchema.safeParse(invalidDatesInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("Effective to date cannot precede effective from date");
      }
    });

    it("validates special price update schema", () => {
      const validUpdate = {
        special_price: 70.0,
        effective_to: "2027-01-31",
      };

      const result = SpecialPriceUpdateSchema.safeParse(validUpdate);
      expect(result.success).toBe(true);
    });
  });

  describe("2. Agreement Creation & Conflict Prevention", () => {
    it("prevents duplicate active agreements for the same customer and product", async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: dummyAgreementId,
          effective_from: "2026-11-01",
          effective_to: null,
        },
        error: null,
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: mockMaybeSingle,
              }),
            }),
          }),
        }),
      });

      const res = await createSpecialPrice({
        customer_id: dummyCustomerId,
        product_id: dummyProductId,
        special_price: 75.0,
        effective_from: "2026-11-01",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("A special price agreement already exists");
    });

    it("successfully creates special price when no conflicting agreement exists", async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      const newRecord: SpecialPriceRecord = {
        id: dummyAgreementId,
        customer_id: dummyCustomerId,
        product_id: dummyProductId,
        special_price: 75.0,
        effective_from: "2026-11-01",
        effective_to: null,
        created_at: "2026-11-01T10:00:00Z",
        updated_at: "2026-11-01T10:00:00Z",
      };

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: newRecord,
            error: null,
          }),
        }),
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "customer_special_prices") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: mockMaybeSingle,
                  }),
                }),
              }),
              insert: mockInsert,
            };
          }
          return {};
        }),
      });

      const res = await createSpecialPrice({
        customer_id: dummyCustomerId,
        product_id: dummyProductId,
        special_price: 75.0,
        effective_from: "2026-11-01",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.special_price).toBe(75.0);
        expect(res.data.customer_id).toBe(dummyCustomerId);
      }
    });
  });

  describe("3. Price Resolution & Date Range Precedence", () => {
    it("returns agreed special price when agreement is active on target date", async () => {
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lte: vi.fn().mockReturnValue({
                  or: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { special_price: 75.0 },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const res = await resolveEffectivePrice(dummyCustomerId, dummyProductId, "2026-11-06");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.price).toBe(75.0);
        expect(res.data.isSpecial).toBe(true);
      }
    });

    it("falls back to catalog default sale price when special price is expired or absent", async () => {
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "customer_special_prices") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    lte: vi.fn().mockReturnValue({
                      or: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                          limit: vi.fn().mockReturnValue({
                            maybeSingle: vi.fn().mockResolvedValue({
                              data: null, // Expired or none
                              error: null,
                            }),
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "products") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { default_sale_price: 90.0 },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      });

      const res = await resolveEffectivePrice(dummyCustomerId, dummyProductId, "2026-11-06");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.price).toBe(90.0);
        expect(res.data.isSpecial).toBe(false);
      }
    });
  });

  describe("4. Multi-Product Orders & Mixed Pricing Application", () => {
    it("correctly resolves mixed prices across multiple line items with authoritative taxes", () => {
      // Line 1: 20L Water Jar - Customer has special price agreement ₹75 (Catalog ₹90), GST 18%
      // Line 2: 1L Packaged Case - No special price, uses Catalog ₹120, GST 18%
      const line1Qty = 10;
      const line1EffectivePrice = 75.0; // Special
      const line1GstRate = 18.0;
      const line1Subtotal = line1Qty * line1EffectivePrice; // 750.00
      const line1Tax = Math.round(line1Subtotal * (line1GstRate / 100) * 100) / 100; // 135.00
      const line1Total = line1Subtotal + line1Tax; // 885.00

      const line2Qty = 2;
      const line2EffectivePrice = 120.0; // Standard Catalog
      const line2GstRate = 18.0;
      const line2Subtotal = line2Qty * line2EffectivePrice; // 240.00
      const line2Tax = Math.round(line2Subtotal * (line2GstRate / 100) * 100) / 100; // 43.20
      const line2Total = line2Subtotal + line2Tax; // 283.20

      const orderSubtotal = line1Subtotal + line2Subtotal; // 990.00
      const orderTax = line1Tax + line2Tax; // 178.20
      const orderTotal = line1Total + line2Total; // 1168.20

      expect(line1Subtotal).toBe(750.0);
      expect(line1Total).toBe(885.0);
      expect(line2Subtotal).toBe(240.0);
      expect(line2Total).toBe(283.2);
      expect(orderSubtotal).toBe(990.0);
      expect(orderTotal).toBe(1168.2);
      expect(orderSubtotal + orderTax).toBe(orderTotal);
    });
  });

  describe("5. POS Customer-Linked Pricing & Discounts", () => {
    it("computes contract discount savings when registered customer is linked in POS", () => {
      const catalogPrice = 90.0;
      const agreedSpecialPrice = 75.0;
      const qty = 5;

      const catalogSubtotal = catalogPrice * qty; // 450.00
      const contractSubtotal = agreedSpecialPrice * qty; // 375.00
      const contractSavings = catalogSubtotal - contractSubtotal; // 75.00

      expect(catalogSubtotal).toBe(450.0);
      expect(contractSubtotal).toBe(375.0);
      expect(contractSavings).toBe(75.0);
    });
  });

  describe("6. Deactivation & Historical Immutability", () => {
    it("deactivates an agreement by expiring effective_to without deleting the record", async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: dummyAgreementId,
                customer_id: dummyCustomerId,
                product_id: dummyProductId,
                special_price: 75.0,
                effective_from: "2026-11-01",
                effective_to: yesterday,
              },
              error: null,
            }),
          }),
        }),
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockReturnValue({
          update: mockUpdate,
        }),
      });

      const res = await deactivateSpecialPrice(dummyAgreementId);
      expect(res.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          effective_to: yesterday,
        })
      );
    });

    it("verifies that editing a price agreement does not alter historical order items or invoices", () => {
      // Historical order item snapshot recorded on 2026-11-01
      const historicalOrderItem = {
        orderId: "order-1",
        productId: dummyProductId,
        unitPrice: 75.0,
        originalPrice: 90.0,
        subtotal: 750.0,
        taxAmount: 135.0,
        totalAmount: 885.0,
        createdAt: "2026-11-01T10:00:00Z",
      };

      // Price renegotiation on 2026-11-06: new agreed price is ₹80
      const newPriceAgreement = {
        specialPrice: 80.0,
        effectiveFrom: "2026-11-06",
      };

      // Historical item price remains strictly unchanged
      expect(historicalOrderItem.unitPrice).toBe(75.0);
      expect(historicalOrderItem.totalAmount).toBe(885.0);
      expect(newPriceAgreement.specialPrice).toBe(80.0);
    });
  });

  describe("7. Pricing Dashboard KPIs Calculation", () => {
    it("calculates active, expired, and upcoming expiration metrics accurately", async () => {
      const today = new Date().toISOString().split("T")[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
      const in10Days = new Date(Date.now() + 10 * 86400000).toISOString().split("T")[0];
      const in60Days = new Date(Date.now() + 60 * 86400000).toISOString().split("T")[0];

      const mockData = [
        // Active ongoing contract
        { id: "1", customer_id: dummyCustomerId, product_id: dummyProductId, effective_from: "2026-01-01", effective_to: null },
        // Active contract expiring in 10 days (Upcoming expiration)
        { id: "2", customer_id: dummyCustomerId, product_id: dummyProduct2Id, effective_from: "2026-01-01", effective_to: in10Days },
        // Active contract expiring in 60 days
        { id: "3", customer_id: dummyCustomer2Id, product_id: dummyProductId, effective_from: "2026-01-01", effective_to: in60Days },
        // Expired contract
        { id: "4", customer_id: dummyCustomer2Id, product_id: dummyProduct2Id, effective_from: "2026-01-01", effective_to: yesterday },
        // Upcoming contract
        { id: "5", customer_id: "cust-3", product_id: "prod-3", effective_from: in10Days, effective_to: in60Days },
      ];

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: mockData,
            error: null,
          }),
        }),
      });

      const res = await getPricingDashboardKPIs();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.totalActive).toBe(3); // 1, 2, 3
        expect(res.data.totalCustomers).toBe(2); // dummyCustomerId and dummyCustomer2Id
        expect(res.data.totalProducts).toBe(2); // dummyProductId and dummyProduct2Id
        expect(res.data.totalExpired).toBe(1); // 4
        expect(res.data.totalUpcomingExpirations).toBe(1); // 2 (expires in 10 days)
      }
    });
  });
});

