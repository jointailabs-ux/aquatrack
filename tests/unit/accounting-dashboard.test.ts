import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  STANDARD_CHART_OF_ACCOUNTS,
  STANDARD_ACCOUNT_CODES,
  LedgerFilterSchema,
} from "@/modules/accounting/accounting.schema";
import {
  getAccountingOverview,
  getChartOfAccountsBalances,
  getLedgerTransactions,
} from "@/modules/accounting/accounting.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";

describe("Accounting Dashboard Service & Ledger Invariants (Task 8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Standard Chart of Accounts Schema & Invariants", () => {
    it("contains all standard core ledger codes with correct classifications", () => {
      expect(STANDARD_CHART_OF_ACCOUNTS.length).toBe(13);

      const codes = STANDARD_CHART_OF_ACCOUNTS.map((a) => a.code);
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.CASH_DRAWER); // 1010
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.DRIVER_FLOAT); // 1015
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.BANK_CURRENT); // 1020
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE); // 1110
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.INVENTORY_STOCK); // 1210
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.JAR_ASSET_CAPITALIZED); // 1310
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.ACCOUNTS_PAYABLE); // 2010
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.CUSTOMER_JAR_DEPOSITS); // 2110
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.SALES_REVENUE); // 4010
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.COGS); // 5010
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.STAFF_SALARIES); // 6010
      expect(codes).toContain(STANDARD_ACCOUNT_CODES.OPERATING_EXPENSES); // 6020
    });

    it("enforces normal balance conventions for all account types", () => {
      STANDARD_CHART_OF_ACCOUNTS.forEach((acc) => {
        if (acc.type === "ASSET" || acc.type === "EXPENSE" || acc.type === "DIRECT_COST") {
          expect(acc.normal_balance).toBe("DEBIT");
        } else if (acc.type === "LIABILITY" || acc.type === "REVENUE" || acc.type === "EQUITY") {
          expect(acc.normal_balance).toBe("CREDIT");
        }
      });
    });

    it("validates LedgerFilterSchema correctly", () => {
      const parsed = LedgerFilterSchema.parse({
        period: "THIS_MONTH",
        accountCode: "1010",
        search: "INV-001",
      });
      expect(parsed.period).toBe("THIS_MONTH");
      expect(parsed.accountCode).toBe("1010");
      expect(parsed.search).toBe("INV-001");
      expect(parsed.limit).toBe(100);
      expect(parsed.offset).toBe(0);
    });
  });

  describe("2. Security & Role-Based Access Control", () => {
    it("denies access if user is not authenticated", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
        },
      };
      (createClient as any).mockResolvedValue(mockSupabase);

      const overviewRes = await getAccountingOverview();
      expect(overviewRes.success).toBe(false);
      expect(overviewRes.error).toContain("Authentication required");

      const coaRes = await getChartOfAccountsBalances();
      expect(coaRes.success).toBe(false);

      const txRes = await getLedgerTransactions();
      expect(txRes.success).toBe(false);
    });

    it("denies access if user is staff instead of owner", async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "staff-123" } },
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { role: "staff" },
              }),
            }),
          }),
        }),
      };
      (createClient as any).mockResolvedValue(mockSupabase);

      const overviewRes = await getAccountingOverview();
      expect(overviewRes.success).toBe(false);
      expect(overviewRes.error).toContain("Only business owners");
    });
  });

  describe("3. Accounting Overview Calculations", () => {
    it("computes revenue, collections, COGS, expenses and profit correctly", async () => {
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
          if (table === "invoices") {
            return {
              select: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockResolvedValue({
                    data: [
                      { id: "inv-1", subtotal: 10000, tax_amount: 1800, total_amount: 11800, status: "ISSUED" },
                      { id: "inv-2", subtotal: 5000, tax_amount: 900, total_amount: 5900, status: "PAID" },
                      { id: "inv-3", subtotal: 2000, tax_amount: 360, total_amount: 2360, status: "CANCELLED" },
                    ],
                  }),
                }),
              }),
            };
          }
          if (table === "pos_sales") {
            return {
              select: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockResolvedValue({
                    data: [
                      { id: "pos-1", subtotal: 3000, tax_total: 540, total_amount: 3540 },
                    ],
                  }),
                }),
              }),
            };
          }
          if (table === "customer_payments") {
            return {
              select: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockResolvedValue({
                    data: [
                      { id: "pay-1", amount: 7000 },
                      { id: "pay-2", amount: 2000 },
                    ],
                  }),
                }),
              }),
            };
          }
          if (table === "invoice_items") {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    { quantity: 100, product_id: "prod-1", products: { cost_price: 30 } },
                    { quantity: 50, product_id: "prod-1", products: { cost_price: 30 } },
                  ],
                }),
              }),
            };
          }
          if (table === "pos_sale_items") {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    { quantity: 30, product_id: "prod-1", products: { cost_price: 30 } },
                  ],
                }),
              }),
            };
          }
          if (table === "expenses") {
            return {
              select: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockResolvedValue({
                    data: [
                      { id: "exp-1", amount: 1500 },
                      { id: "exp-2", amount: 500 },
                    ],
                  }),
                }),
              }),
            };
          }
          if (table === "salary_payments") {
            return {
              select: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockResolvedValue({
                    data: [
                      { id: "sal-1", amount_paid: 4000 },
                    ],
                  }),
                }),
              }),
            };
          }
          if (table === "customers") {
            return {
              select: vi.fn().mockResolvedValue({
                data: [
                  { current_balance: 4800 },
                  { current_balance: 1200 },
                ],
              }),
            };
          }
          if (table === "suppliers") {
            return {
              select: vi.fn().mockResolvedValue({
                data: [
                  { current_payable: 3500 },
                ],
              }),
            };
          }
          if (table === "financial_ledger") {
            return {
              select: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    { account_code: "1010", debit: 5000, credit: 1000 }, // Cash in hand = 4000
                    { account_code: "1015", debit: 2000, credit: 500 },  // Cash with drivers = 1500
                    { account_code: "1020", debit: 20000, credit: 8000 }, // Bank balance = 12000
                  ],
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

      const res = await getAccountingOverview({ period: "THIS_MONTH" });
      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      const data = res.data;

      // Order Revenue (excluding cancelled inv-3): 10000 + 5000 = 15000
      expect(data.order_revenue).toBe(15000);
      // POS Revenue: 3000
      expect(data.pos_revenue).toBe(3000);
      // Total Revenue: 15000 + 3000 = 18000
      expect(data.total_revenue).toBe(18000);

      // Customer Collections: Payments (7000 + 2000) + POS gross (3540) = 12540
      expect(data.total_customer_collections).toBe(12540);

      // COGS: (100*30) + (50*30) + (30*30) = 3000 + 1500 + 900 = 5400
      expect(data.cost_of_goods_sold).toBe(5400);

      // Gross profit: 18000 - 5400 = 12600 (70.0% margin)
      expect(data.gross_profit).toBe(12600);
      expect(data.gross_profit_margin_pct).toBe(70);

      // Operating expenses: 1500 + 500 = 2000
      expect(data.operating_expenses).toBe(2000);
      // Salary expenses: 4000
      expect(data.salary_expenses).toBe(4000);
      // Total expenses: 6000
      expect(data.total_expenses).toBe(6000);

      // Net operating profit: 12600 - 6000 = 6600 (36.7% margin)
      expect(data.net_operating_profit).toBe(6600);
      expect(data.net_profit_margin_pct).toBe(36.7);

      // Receivables: 4800 + 1200 = 6000
      expect(data.accounts_receivable).toBe(6000);

      // Payables: 3500
      expect(data.accounts_payable).toBe(3500);

      // Cash balances: 4000 + 1500 + 12000 = 17500
      expect(data.cash_in_hand).toBe(4000);
      expect(data.cash_with_drivers).toBe(1500);
      expect(data.bank_balance).toBe(12000);
      expect(data.total_cash_and_bank).toBe(17500);
    });
  });

  describe("4. Chart of Accounts & Trial Balance Equilibrium", () => {
    it("aggregates dual entries and verifies a balanced trial balance", async () => {
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
          if (table === "financial_ledger") {
            return {
              select: vi.fn().mockResolvedValue({
                data: [
                  // Cash In Hand (1010): Dr 10000, Cr 2000 -> Bal 8000
                  { account_code: "1010", account_name: "Central Depot Cash Drawer", debit: 10000, credit: 2000 },
                  // Sales Revenue (4010): Dr 0, Cr 10000 -> Bal 10000
                  { account_code: "4010", account_name: "Sales Revenue", debit: 0, credit: 10000 },
                  // Expense (6020): Dr 2000, Cr 0 -> Bal 2000
                  { account_code: "6020", account_name: "General Operating Expenses", debit: 2000, credit: 0 },
                ],
                error: null,
              }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await getChartOfAccountsBalances();
      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      const { accounts, trial_balance } = res.data;

      // Total Dr = 10000 + 0 + 2000 = 12000
      // Total Cr = 2000 + 10000 + 0 = 12000
      expect(trial_balance.total_debit).toBe(12000);
      expect(trial_balance.total_credit).toBe(12000);
      expect(trial_balance.is_balanced).toBe(true);
      expect(trial_balance.difference).toBe(0);

      // Account 1010 (Asset - Normal DEBIT)
      const acc1010 = accounts.find((a: any) => a.account_code === "1010")!;
      expect(acc1010.total_debit).toBe(10000);
      expect(acc1010.total_credit).toBe(2000);
      expect(acc1010.current_balance).toBe(8000);

      // Account 4010 (Revenue - Normal CREDIT)
      const acc4010 = accounts.find((a: any) => a.account_code === "4010")!;
      expect(acc4010.total_debit).toBe(0);
      expect(acc4010.total_credit).toBe(10000);
      expect(acc4010.current_balance).toBe(10000);

      // Account 6020 (Expense - Normal DEBIT)
      const acc6020 = accounts.find((a: any) => a.account_code === "6020")!;
      expect(acc6020.total_debit).toBe(2000);
      expect(acc6020.total_credit).toBe(0);
      expect(acc6020.current_balance).toBe(2000);
    });

    it("detects an unbalanced trial balance discrepancy", async () => {
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
          if (table === "financial_ledger") {
            return {
              select: vi.fn().mockResolvedValue({
                data: [
                  { account_code: "1010", account_name: "Cash", debit: 5000, credit: 0 },
                  { account_code: "4010", account_name: "Revenue", debit: 0, credit: 4000 },
                ],
                error: null,
              }),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const res = await getChartOfAccountsBalances();
      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.trial_balance.is_balanced).toBe(false);
      expect(res.data.trial_balance.difference).toBe(1000);
    });
  });

  describe("5. General Ledger Transactions Querying & Filtering", () => {
    it("returns sorted journal entries and applies in-memory text search", async () => {
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
          if (table === "financial_ledger") {
            const queryChain: any = {
              order: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              lte: vi.fn().mockReturnThis(),
              range: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "tx-1",
                    entry_number: "LED-INV-20261106-001",
                    entry_date: "2026-11-06",
                    account_code: "1110",
                    account_name: "Accounts Receivable",
                    debit: 5000,
                    credit: 0,
                    description: "Invoice #INV-001 to Acme Corp",
                    reference_type: "INVOICE",
                    reference_id: "inv-1",
                    is_reversal: false,
                    reversed_entry_id: null,
                    created_at: "2026-11-06T10:00:00Z",
                  },
                  {
                    id: "tx-2",
                    entry_number: "LED-PAY-20261106-002",
                    entry_date: "2026-11-06",
                    account_code: "1010",
                    account_name: "Central Depot Cash Drawer",
                    debit: 3000,
                    credit: 0,
                    description: "Cash payment received for order",
                    reference_type: "CUSTOMER_PAYMENT",
                    reference_id: "pay-1",
                    is_reversal: false,
                    reversed_entry_id: null,
                    created_at: "2026-11-06T11:00:00Z",
                  },
                ],
                count: 2,
                error: null,
              }),
            };
            return {
              select: vi.fn().mockReturnValue(queryChain),
            };
          }
          return { select: vi.fn().mockReturnThis() };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      // Search for "Acme"
      const res = await getLedgerTransactions({
        search: "Acme",
      });

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("Expected success");
      expect(res.data.transactions.length).toBe(1);
      expect(res.data.transactions[0].entry_number).toBe("LED-INV-20261106-001");
      expect(res.data.transactions[0].description).toContain("Acme Corp");
    });
  });
});
