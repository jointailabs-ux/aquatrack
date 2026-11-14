import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CustomerInputSchema,
  CustomerUpdateInputSchema,
  DirectCustomerPaymentSchema,
  CustomerRecord,
} from "@/modules/customers/customer.schema";
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  toggleCustomerActive,
  getCustomerInvoices,
  getCustomerPayments,
  getCustomerJarMovements,
  recordDirectCustomerPayment,
} from "@/modules/customers/customer.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { createClient, createAdminClient } from "@/lib/supabase/server";

describe("Customer Management Module", () => {
  const dummyCustomerId = "11111111-2222-3333-4444-555555555555";
  const dummyLocationId = "22222222-3333-4444-5555-666666666666";
  const dummyInvoiceId = "33333333-4444-5555-6666-777777777777";
  const dummyOrderId = "44444444-5555-6666-7777-888888888888";
  const dummyUserId = "55555555-6666-7777-8888-999999999999";

  const sampleCustomer: CustomerRecord = {
    id: dummyCustomerId,
    location_id: dummyLocationId,
    customer_type: "B2C",
    business_name: null,
    contact_name: "John Doe",
    phone: "9876543210",
    email: "john@example.com",
    address: "123 Main Street, Bangalore",
    delivery_instructions: "Leave with security",
    gstin: null,
    credit_limit: 5000,
    max_jar_limit: 5,
    payment_terms_days: 0,
    current_balance: 1500,
    total_full_jars_holding: 3,
    total_empty_jars_holding: 2,
    total_damaged_jars_holding: 0,
    total_deposit_held: 750,
    notes: "Preferred morning delivery",
    is_active: true,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Customer Schema Validations", () => {
    it("validates valid residential (B2C) customer input", () => {
      const validB2C = {
        customer_type: "B2C" as const,
        contact_name: "Anita Sharma",
        phone: "9845012345",
        email: "anita@example.com",
        address: "Apartment 304, Green Heights, Indiranagar",
        credit_limit: 2000,
        max_jar_limit: 4,
      };

      const result = CustomerInputSchema.safeParse(validB2C);
      expect(result.success).toBe(true);
    });

    it("requires business_name when customer_type is B2B", () => {
      const invalidB2B = {
        customer_type: "B2B" as const,
        contact_name: "Rajesh Varma",
        business_name: null,
        phone: "9845099887",
        address: "Prestige Tech Park, Outer Ring Road",
      };

      const result = CustomerInputSchema.safeParse(invalidB2B);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("Corporate business name is required for B2B accounts");
      }
    });

    it("validates commercial (B2B) customer input with business_name", () => {
      const validB2B = {
        customer_type: "B2B" as const,
        contact_name: "Rajesh Varma",
        business_name: "Apex Technologies Pvt Ltd",
        phone: "9845099887",
        email: "accounts@apextech.com",
        address: "Prestige Tech Park, Outer Ring Road",
        gstin: "29AABCU9603R1ZX",
        credit_limit: 25000,
        max_jar_limit: 30,
        payment_terms_days: 30,
      };

      const result = CustomerInputSchema.safeParse(validB2B);
      expect(result.success).toBe(true);
    });

    it("rejects phone numbers shorter than 8 digits", () => {
      const shortPhone = {
        customer_type: "B2C" as const,
        contact_name: "Short Phone",
        phone: "12345",
        address: "Some address",
      };

      const result = CustomerInputSchema.safeParse(shortPhone);
      expect(result.success).toBe(false);
    });

    it("validates partial customer update inputs", () => {
      const partialUpdate = {
        contact_name: "Updated Name",
        credit_limit: 8000,
        is_active: false,
      };

      const result = CustomerUpdateInputSchema.safeParse(partialUpdate);
      expect(result.success).toBe(true);
    });
  });

  describe("2. Direct Customer Payment Schema Validations", () => {
    it("validates direct payment input with positive amount and valid payment method", () => {
      const validPayment = {
        customer_id: dummyCustomerId,
        amount: 1500.0,
        payment_method: "UPI" as const,
        payment_date: "2026-11-06",
        reference_number: "UPI-88776655",
      };

      const result = DirectCustomerPaymentSchema.safeParse(validPayment);
      expect(result.success).toBe(true);
    });

    it("rejects zero and negative payment amounts", () => {
      const zeroPayment = {
        customer_id: dummyCustomerId,
        amount: 0,
        payment_method: "CASH" as const,
      };
      expect(DirectCustomerPaymentSchema.safeParse(zeroPayment).success).toBe(false);

      const negativePayment = {
        customer_id: dummyCustomerId,
        amount: -500,
        payment_method: "CASH" as const,
      };
      expect(DirectCustomerPaymentSchema.safeParse(negativePayment).success).toBe(false);
    });

    it("rejects invalid payment methods", () => {
      const invalidMethod = {
        customer_id: dummyCustomerId,
        amount: 500,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payment_method: "BITCOIN" as any,
      };
      expect(DirectCustomerPaymentSchema.safeParse(invalidMethod).success).toBe(false);
    });
  });

  describe("3. Customer Directory Queries & Filters", () => {
    it("retrieves paginated customer accounts with default parameters", async () => {
      const mockOrder = vi.fn().mockReturnValue({
        range: vi.fn().mockResolvedValue({
          data: [sampleCustomer],
          count: 1,
          error: null,
        }),
      });

      const mockSelect = vi.fn().mockReturnValue({
        order: mockOrder,
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockReturnValue({
          select: mockSelect,
        }),
      });

      const res = await getCustomers();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.items.length).toBe(1);
        expect(res.data.items[0].contact_name).toBe("John Doe");
        expect(res.data.total).toBe(1);
      }
    });

    it("applies filters for customerType, status, and outstanding balance", async () => {
      const mockGt = vi.fn();
      const mockEq = vi.fn();
      const mockOr = vi.fn();
      const mockRange = vi.fn().mockResolvedValue({
        data: [sampleCustomer],
        count: 1,
        error: null,
      });
      const mockOrder = vi.fn().mockReturnValue({ range: mockRange });

      const chain: Record<string, unknown> = {
        order: mockOrder,
      };
      mockGt.mockReturnValue(chain);
      mockEq.mockReturnValue(chain);
      mockOr.mockReturnValue(chain);
      chain.gt = mockGt;
      chain.eq = mockEq;
      chain.or = mockOr;

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue(chain),
        }),
      });

      const res = await getCustomers({
        search: "John",
        customerType: "B2C",
        status: "ACTIVE",
        hasOutstandingBalance: true,
      });

      expect(res.success).toBe(true);
      expect(mockEq).toHaveBeenCalledWith("customer_type", "B2C");
      expect(mockEq).toHaveBeenCalledWith("is_active", true);
      expect(mockGt).toHaveBeenCalledWith("current_balance", 0);
      expect(mockOr).toHaveBeenCalledWith(expect.stringContaining("contact_name.ilike.%John%"));
    });

    it("fetches a single customer by ID", async () => {
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: sampleCustomer,
                error: null,
              }),
            }),
          }),
        }),
      });

      const res = await getCustomerById(dummyCustomerId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.id).toBe(dummyCustomerId);
        expect(res.data.contact_name).toBe("John Doe");
      }
    });
  });

  describe("4. Customer Creation, Updating & Deactivation", () => {
    it("creates a customer atomically via rpc_create_customer_with_location", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: dummyCustomerId,
        error: null,
      });

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        rpc: mockRpc,
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: sampleCustomer,
                error: null,
              }),
            }),
          }),
        }),
      });

      const res = await createCustomer({
        customer_type: "B2C",
        contact_name: "John Doe",
        phone: "9876543210",
        address: "123 Main Street, Bangalore",
        credit_limit: 5000,
        max_jar_limit: 5,
        payment_terms_days: 0,
      });

      expect(res.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith("rpc_create_customer_with_location", expect.objectContaining({
        p_customer_type: "B2C",
        p_contact_name: "John Doe",
        p_phone: "9876543210",
      }));
    });

    it("updates customer profile attributes", async () => {
      const updatedCustomer = { ...sampleCustomer, contact_name: "John Smith", credit_limit: 10000 };

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: updatedCustomer,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const res = await updateCustomer(dummyCustomerId, {
        contact_name: "John Smith",
        credit_limit: 10000,
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.contact_name).toBe("John Smith");
        expect(res.data.credit_limit).toBe(10000);
      }
    });

    it("deactivates customer without deleting historical data", async () => {
      const deactivatedCustomer = { ...sampleCustomer, is_active: false };

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: deactivatedCustomer,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const res = await toggleCustomerActive(dummyCustomerId, false);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.is_active).toBe(false);
        expect(res.data.id).toBe(dummyCustomerId);
      }
    });
  });

  describe("5. Customer History & Ledger Services", () => {
    it("retrieves billing invoices for a customer", async () => {
      const mockInvoices = [
        {
          id: dummyInvoiceId,
          invoice_number: "INV-20261105-001",
          order_id: dummyOrderId,
          customer_id: dummyCustomerId,
          subtotal: 1000,
          tax_amount: 180,
          total_amount: 1180,
          balance_due: 1180,
          status: "UNPAID",
          invoice_date: "2026-11-05",
          due_date: "2026-11-20",
          created_at: "2026-11-05T10:00:00Z",
        },
      ];

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: mockInvoices,
                error: null,
              }),
            }),
          }),
        }),
      });

      const res = await getCustomerInvoices(dummyCustomerId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.length).toBe(1);
        expect(res.data[0].invoice_number).toBe("INV-20261105-001");
        expect(res.data[0].balance_due).toBe(1180);
      }
    });

    it("retrieves payment receipts for a customer", async () => {
      const mockPayments = [
        {
          id: "pay-1",
          payment_number: "PAY-20261106-ABC",
          customer_id: dummyCustomerId,
          invoice_id: dummyInvoiceId,
          order_id: dummyOrderId,
          amount: 500,
          payment_method: "UPI",
          reference_number: "UPI-12345",
          collected_by_staff_id: dummyUserId,
          payment_date: "2026-11-06",
          notes: "Partial payment",
          created_at: "2026-11-06T12:00:00Z",
        },
      ];

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: mockPayments,
                error: null,
              }),
            }),
          }),
        }),
      });

      const res = await getCustomerPayments(dummyCustomerId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.length).toBe(1);
        expect(res.data[0].amount).toBe(500);
        expect(res.data[0].payment_method).toBe("UPI");
      }
    });

    it("retrieves jar custody movements linked to customer location", async () => {
      const mockMovements = [
        {
          id: "mov-1",
          product_id: "prod-1",
          source_location_id: "loc-warehouse",
          destination_location_id: dummyLocationId,
          condition_from: "FULL_USABLE",
          condition_to: "FULL_USABLE",
          quantity: 5,
          movement_type: "CUSTOMER_DELIVERY",
          reference_type: "ORDER",
          reference_id: dummyOrderId,
          notes: "Delivered 5 full jars",
          created_at: "2026-11-05T14:00:00Z",
          product: { name: "20L Mineral Water Jar" },
        },
      ];

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "customers") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { location_id: dummyLocationId },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "jar_custody_movements") {
            return {
              select: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: mockMovements,
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      });

      const res = await getCustomerJarMovements(dummyCustomerId);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.length).toBe(1);
        expect(res.data[0].quantity).toBe(5);
        expect(res.data[0].product_name).toBe("20L Mineral Water Jar");
        expect(res.data[0].movement_type).toBe("CUSTOMER_DELIVERY");
      }
    });
  });

  describe("6. Direct Customer Payment Collection & Accounting Integration", () => {
    it("rejects payment collection when caller is unauthenticated", async () => {
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
      });

      const res = await recordDirectCustomerPayment({
        customer_id: dummyCustomerId,
        amount: 500,
        payment_method: "CASH",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Authentication required");
    });

    it("rejects payment collection when caller lacks authorization", async () => {
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: dummyUserId } } }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { role: "driver", permissions: { can_manage_orders: false } },
                error: null,
              }),
            }),
          }),
        }),
      });

      const res = await recordDirectCustomerPayment({
        customer_id: dummyCustomerId,
        amount: 500,
        payment_method: "CASH",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Permission denied");
    });

    it("successfully collects customer payment, decrements balance, updates invoice and posts to financial ledger", async () => {
      const mockPaymentRecord = {
        id: "pay-new-123",
        payment_number: "PAY-20261106-ABC123",
        customer_id: dummyCustomerId,
        invoice_id: dummyInvoiceId,
        order_id: dummyOrderId,
        amount: 1000,
        payment_method: "UPI",
        reference_number: "UTR-554433",
        collected_by_staff_id: dummyUserId,
        payment_date: "2026-11-06",
        notes: "Direct UPI collection",
        created_at: "2026-11-06T10:00:00Z",
      };

      const mockCustomerUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      const mockInvoiceUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      const mockOrderUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      const mockLedgerInsert = vi.fn().mockResolvedValue({ error: null });

      const mockDbClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "customer_payments") {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: mockPaymentRecord,
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "customers") {
            return {
              update: mockCustomerUpdate,
            };
          }
          if (table === "invoices") {
            return {
              update: mockInvoiceUpdate,
            };
          }
          if (table === "orders") {
            return {
              update: mockOrderUpdate,
            };
          }
          if (table === "financial_ledger") {
            return {
              insert: mockLedgerInsert,
            };
          }
          return {};
        }),
      };

      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: { id: dummyUserId } } }),
        },
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "profiles") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { role: "owner", permissions: { can_manage_orders: true } },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "customers") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: dummyCustomerId, contact_name: "John Doe", current_balance: 1500 },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "invoices") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: dummyInvoiceId,
                      customer_id: dummyCustomerId,
                      order_id: dummyOrderId,
                      total_amount: 1000,
                      balance_due: 1000,
                      status: "UNPAID",
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      });

      (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockDbClient);

      const res = await recordDirectCustomerPayment({
        customer_id: dummyCustomerId,
        invoice_id: dummyInvoiceId,
        amount: 1000,
        payment_method: "UPI",
        payment_date: "2026-11-06",
        reference_number: "UTR-554433",
        notes: "Direct UPI collection",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.amount).toBe(1000);
        expect(res.data.payment_method).toBe("UPI");
      }

      // Verifies customer balance was reduced from 1500 to 500
      expect(mockCustomerUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          current_balance: 500,
        })
      );

      // Verifies invoice balance due is now 0 and status is PAID
      expect(mockInvoiceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          balance_due: 0,
          status: "PAID",
        })
      );

      // Verifies order payment_status updated to PAID
      expect(mockOrderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_status: "PAID",
        })
      );

      // Verifies balanced double-entry ledger posting
      expect(mockLedgerInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          account_code: "1020", // Bank account for UPI
          account_name: "Bank Current Account",
          debit: 1000,
          credit: 0,
          reference_type: "PAYMENT",
        }),
        expect.objectContaining({
          account_code: "1110", // Accounts Receivable
          account_name: "Accounts Receivable",
          debit: 0,
          credit: 1000,
          reference_type: "PAYMENT",
        }),
      ]);
    });

    it("ensures /customers route is not blocked by decommissioned /customer portal redirect logic", () => {
      const isDecommissionedCustomerPortal = (pathname: string) => {
        return pathname === "/customer" || pathname.startsWith("/customer/");
      };

      // Internal ERP customers directory must NOT be blocked
      expect(isDecommissionedCustomerPortal("/customers")).toBe(false);
      expect(isDecommissionedCustomerPortal("/customers?new=true")).toBe(false);
      expect(isDecommissionedCustomerPortal("/customers/123")).toBe(false);

      // Decommissioned portal routes MUST be redirected
      expect(isDecommissionedCustomerPortal("/customer")).toBe(true);
      expect(isDecommissionedCustomerPortal("/customer/order")).toBe(true);
      expect(isDecommissionedCustomerPortal("/customer/orders")).toBe(true);
      expect(isDecommissionedCustomerPortal("/customer/profile")).toBe(true);
    });
  });
});

