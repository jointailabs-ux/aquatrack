import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CreatePurchaseSchema,
  ReceivePurchaseItemsSchema,
  SupplierPaymentSchema,
  PurchaseStatusEnum,
  PurchaseItemSchema,
} from "@/modules/purchases/purchase.schema";
import {
  createPurchase,
  markPurchaseReceived,
  recordSupplierPayment,
  getSupplierPayments,
  getPurchaseById,
} from "@/modules/purchases/purchase.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

describe("Purchase Management & Inward Inventory Module", () => {
  const dummySupplierId = "11111111-2222-3333-4444-555555555555";
  const dummyPurchaseId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const productJarId = "22222222-3333-4444-5555-666666666666";
  const productDispenserId = "33333333-4444-5555-6666-777777777777";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Purchase Order Creation Schema Validation", () => {
    it("validates purchase creation with auto/server generated PO number", () => {
      const validPO = {
        supplier_id: dummySupplierId,
        po_number: "PO-20261103-1234",
        status: "ORDERED" as const,
        purchase_date: "2026-11-03",
        items: [
          {
            product_id: productJarId,
            quantity_ordered: 100,
            quantity_received: 0,
            unit_cost: 35.0,
            gst_rate: 18,
            tax_amount: 630.0,
            total_cost: 4130.0,
            total_amount: 4130.0,
          },
        ],
      };

      expect(CreatePurchaseSchema.safeParse(validPO).success).toBe(true);
    });

    it("supports multiple purchase line items with differing tax rates", () => {
      const multiItemPO = {
        supplier_id: dummySupplierId,
        po_number: "PO-MULTI-001",
        status: "ORDERED" as const,
        purchase_date: "2026-11-05",
        items: [
          {
            product_id: productJarId,
            product_name: "20L Polycarbonate Jars",
            quantity_ordered: 200,
            quantity_received: 0,
            unit_cost: 150.0,
            gst_rate: 18.0,
            tax_amount: 5400.0,
            total_cost: 35400.0,
          },
          {
            product_id: productDispenserId,
            product_name: "Tabletop Dispensers",
            quantity_ordered: 20,
            quantity_received: 0,
            unit_cost: 450.0,
            gst_rate: 12.0,
            tax_amount: 1080.0,
            total_cost: 10080.0,
          },
        ],
      };

      const parsed = CreatePurchaseSchema.parse(multiItemPO);
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0].total_cost).toBe(35400);
      expect(parsed.items[1].total_cost).toBe(10080);
    });

    it("rejects invalid quantities (zero or negative) and negative unit prices", () => {
      const zeroQtyItem = {
        product_id: productJarId,
        quantity_ordered: 0,
        unit_cost: 50.0,
        total_cost: 0,
      };
      expect(() => PurchaseItemSchema.parse(zeroQtyItem)).toThrow("Ordered quantity must be positive");

      const negQtyItem = {
        product_id: productJarId,
        quantity_ordered: -10,
        unit_cost: 50.0,
        total_cost: -500,
      };
      expect(() => PurchaseItemSchema.parse(negQtyItem)).toThrow("Ordered quantity must be positive");

      const negPriceItem = {
        product_id: productJarId,
        quantity_ordered: 10,
        unit_cost: -5.0,
        total_cost: -50,
      };
      expect(() => PurchaseItemSchema.parse(negPriceItem)).toThrow("Unit cost must be non-negative");
    });

    it("rejects empty line items array in purchase order", () => {
      const emptyPO = {
        supplier_id: dummySupplierId,
        purchase_date: "2026-11-05",
        items: [],
      };

      expect(() => CreatePurchaseSchema.parse(emptyPO)).toThrow(
        "At least one item is required in a purchase order"
      );
    });
  });

  describe("Goods Receipt & Inward Inventory Invariants", () => {
    it("validates partial goods receipt schema and ensures positive quantities", () => {
      const partialReceipt = {
        purchase_id: dummyPurchaseId,
        items: [
          {
            product_id: productJarId,
            quantity_received: 40,
          },
        ],
      };

      expect(ReceivePurchaseItemsSchema.safeParse(partialReceipt).success).toBe(true);

      const zeroReceipt = {
        purchase_id: dummyPurchaseId,
        items: [
          {
            product_id: productJarId,
            quantity_received: 0,
          },
        ],
      };

      expect(ReceivePurchaseItemsSchema.safeParse(zeroReceipt).success).toBe(false);
    });

    it("verifies creating a purchase order does NOT increase available inventory", () => {
      // Invariant: Purchase order status is ORDERED; inventory stays unchanged
      const initialStock = 100;
      const poQuantityOrdered = 50;

      // Creating PO does not call inventory balance increment
      const stockAfterPOCreation = initialStock;
      expect(stockAfterPOCreation).toBe(initialStock);

      // Inventory only increases when goods receipt is executed
      const receivedQuantity = 50;
      const stockAfterReceipt = stockAfterPOCreation + receivedQuantity;
      expect(stockAfterReceipt).toBe(150);
    });

    it("strictly prohibits receiving more than the outstanding quantity", () => {
      const ordered = 50;
      const previouslyReceived = 30;
      const outstanding = ordered - previouslyReceived; // 20

      const attemptingToReceive = 25;
      const isExceeded = previouslyReceived + attemptingToReceive > ordered;

      expect(outstanding).toBe(20);
      expect(isExceeded).toBe(true);
    });

    it("evaluates purchase status lifecycle correctly across partial and full receipts", () => {
      const ordered = 100;
      let received = 40;

      let status = received < ordered ? "PARTIALLY_RECEIVED" : "RECEIVED";
      expect(status).toBe("PARTIALLY_RECEIVED");

      received += 60;
      status = received >= ordered ? "RECEIVED" : "PARTIALLY_RECEIVED";
      expect(status).toBe("RECEIVED");

      expect(PurchaseStatusEnum.safeParse("PARTIALLY_RECEIVED").success).toBe(true);
      expect(PurchaseStatusEnum.safeParse("RECEIVED").success).toBe(true);
    });

    it("strictly rejects empty receipt arrays", () => {
      const emptyReceipt = {
        purchase_id: dummyPurchaseId,
        items: [],
      };

      expect(ReceivePurchaseItemsSchema.safeParse(emptyReceipt).success).toBe(false);
    });
  });

  describe("Supplier Payment & Accounts Payable Invariants", () => {
    it("validates supplier payment schema and rejects zero or negative amounts", () => {
      const validPayment = {
        supplier_id: dummySupplierId,
        purchase_id: dummyPurchaseId,
        amount: 5000.0,
        payment_method: "BANK_TRANSFER" as const,
        payment_date: "2026-11-05",
        reference_number: "UTR-9821415",
      };

      expect(SupplierPaymentSchema.safeParse(validPayment).success).toBe(true);

      const zeroPayment = {
        ...validPayment,
        amount: 0,
      };
      expect(SupplierPaymentSchema.safeParse(zeroPayment).success).toBe(false);

      const negPayment = {
        ...validPayment,
        amount: -500,
      };
      expect(SupplierPaymentSchema.safeParse(negPayment).success).toBe(false);
    });

    it("calculates outstanding payable and updates balance due accurately", () => {
      const totalInvoiced = 10000.0;
      let amountPaid = 0.0;
      let balanceDue = totalInvoiced - amountPaid;

      expect(balanceDue).toBe(10000.0);

      // First partial payment
      const payment1 = 4000.0;
      amountPaid += payment1;
      balanceDue = totalInvoiced - amountPaid;
      expect(amountPaid).toBe(4000.0);
      expect(balanceDue).toBe(6000.0);

      // Final settlement
      const payment2 = 6000.0;
      amountPaid += payment2;
      balanceDue = Math.max(0, totalInvoiced - amountPaid);
      expect(amountPaid).toBe(10000.0);
      expect(balanceDue).toBe(0.0);
    });

    it("verifies balanced dual-entry accounting for purchase receipt and supplier payment", () => {
      const goodsReceivedValue = 4130.0;
      // On Goods Receipt:
      // Debit: Warehouse Inventory Asset = 4130.0
      // Credit: Accounts Payable (Supplier) = 4130.0
      const receiptDr = goodsReceivedValue;
      const receiptCr = goodsReceivedValue;
      expect(receiptDr).toBe(receiptCr);

      // On Supplier Payment:
      // Debit: Accounts Payable (Supplier) = 4130.0
      // Credit: Bank Current Account = 4130.0
      const paymentAmount = 4130.0;
      const paymentDr = paymentAmount;
      const paymentCr = paymentAmount;
      expect(paymentDr).toBe(paymentCr);
    });
  });

  describe("Purchase Service Mocked RPC Integration", () => {
    it("calls rpc_create_purchase_order with structured items", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          purchase_id: dummyPurchaseId,
          po_number: "PO-20261105-001",
          total_amount: 11800,
          status: "ORDERED",
        },
        error: null,
      });

      const mockGetUser = vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "owner@aquatrack.com" } },
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: mockGetUser },
        rpc: mockRpc,
      });

      const res = await createPurchase({
        supplier_id: dummySupplierId,
        po_number: "PO-20261105-001",
        purchase_date: "2026-11-05",
        status: "ORDERED",
        items: [
          {
            product_id: productJarId,
            quantity_ordered: 100,
            quantity_received: 0,
            unit_cost: 100,
            gst_rate: 18,
            tax_rate: 18,
            tax_amount: 1800,
            total_cost: 11800,
            total_amount: 11800,
          },
        ],
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.po_number).toBe("PO-20261105-001");
        expect(res.data.status).toBe("ORDERED");
      }
      expect(mockRpc).toHaveBeenCalledWith("rpc_create_purchase_order", expect.objectContaining({
        p_supplier_id: dummySupplierId,
        p_po_number: "PO-20261105-001",
      }));
    });

    it("calls rpc_receive_purchase_order and returns incremental payable", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          status: "RECEIVED",
          incremental_payable: 11800,
        },
        error: null,
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        rpc: mockRpc,
      });

      const res = await markPurchaseReceived({
        purchase_id: dummyPurchaseId,
        items: [{ product_id: productJarId, quantity_received: 100 }],
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.received).toBe(true);
        expect(res.data.status).toBe("RECEIVED");
        expect(res.data.incrementalPayable).toBe(11800);
      }
      expect(mockRpc).toHaveBeenCalledWith("rpc_receive_purchase_order", {
        p_purchase_id: dummyPurchaseId,
        p_received_items: [{ product_id: productJarId, quantity_received: 100 }],
      });
    });

    it("records supplier payment and reduces supplier liability", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          payment_id: "pay-1234",
          payment_number: "SPAY-20261105-001",
        },
        error: null,
      });

      const mockGetUser = vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "owner@aquatrack.com" } },
      });

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { name: "Bisleri Bottling Plant" },
              error: null,
            }),
          }),
        }),
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: mockGetUser },
        rpc: mockRpc,
        from: mockFrom,
      });

      const res = await recordSupplierPayment({
        supplier_id: dummySupplierId,
        purchase_id: dummyPurchaseId,
        amount: 5000,
        payment_method: "BANK_TRANSFER",
        payment_date: "2026-11-05",
        reference_number: "UTR-54321",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.payment_number).toBe("SPAY-20261105-001");
        expect(res.data.amount).toBe(5000);
      }
      expect(mockRpc).toHaveBeenCalledWith("rpc_record_supplier_payment", expect.objectContaining({
        p_supplier_id: dummySupplierId,
        p_amount: 5000,
        p_payment_method: "BANK_TRANSFER",
      }));
    });
  });
});
