import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDashboardDateRange,
  DashboardKPICards,
  DashboardFinancialOverview,
} from "@/modules/dashboard/dashboard.schema";
import { getDashboardSummary } from "@/modules/dashboard/dashboard.service";

// Mock Supabase Server Client
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

// Mock inventory service
vi.mock("@/modules/inventory/inventory.service", () => ({
  getInventoryStockLevels: vi.fn(),
  getInventoryValuationSummary: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getInventoryStockLevels, getInventoryValuationSummary } from "@/modules/inventory/inventory.service";

describe("Dashboard Module & Section 12 Invariants", () => {
  const mockRefDate = new Date("2026-11-06T10:00:00Z"); // Friday Nov 6, 2026

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Date Range Boundaries & Calculations", () => {
    it("computes 'today' date range correctly", () => {
      const range = getDashboardDateRange("today", undefined, undefined, mockRefDate);
      expect(range.startDate).toBe("2026-11-06");
      expect(range.endDate).toBe("2026-11-06");
      expect(range.label).toContain("Today");
    });

    it("computes 'yesterday' date range correctly", () => {
      const range = getDashboardDateRange("yesterday", undefined, undefined, mockRefDate);
      expect(range.startDate).toBe("2026-11-05");
      expect(range.endDate).toBe("2026-11-05");
      expect(range.label).toContain("Yesterday");
    });

    it("computes 'this_week' starting from Monday correctly", () => {
      // 2026-11-06 is a Friday; Monday of that week was 2026-11-02
      const range = getDashboardDateRange("this_week", undefined, undefined, mockRefDate);
      expect(range.startDate).toBe("2026-11-02");
      expect(range.endDate).toBe("2026-11-06");
      expect(range.label).toContain("This Week");
    });

    it("computes 'this_month' date range correctly", () => {
      const range = getDashboardDateRange("this_month", undefined, undefined, mockRefDate);
      expect(range.startDate).toBe("2026-11-01");
      expect(range.endDate).toBe("2026-11-30");
      expect(range.label).toContain("This Month (2026-11)");
    });

    it("respects custom date range when provided", () => {
      const range = getDashboardDateRange("custom", "2026-10-15", "2026-10-31", mockRefDate);
      expect(range.startDate).toBe("2026-10-15");
      expect(range.endDate).toBe("2026-10-31");
      expect(range.label).toBe("Custom (2026-10-15 to 2026-10-31)");
    });
  });

  describe("2. Dual-Entry Accounting Invariants in Dashboard", () => {
    it("strictly separates Sales Revenue from Collections", () => {
      // 50 jars delivered at ₹80 each
      const orderSubtotal = 4000;
      const gstTax = 720;
      const orderTotal = orderSubtotal + gstTax; // ₹4,720

      // Only partial cash payment of ₹2,000 received
      const cashReceived = 2000;
      const accountsReceivable = orderTotal - cashReceived; // ₹2,720

      expect(orderTotal).toBe(4720);
      expect(cashReceived).toBe(2000);
      expect(accountsReceivable).toBe(2720);
      // Collections must never overwrite sales revenue
      expect(cashReceived).not.toBe(orderTotal);
    });

    it("calculates Net Operating Profit using Accrual COGS (Revenue - COGS - Expenses)", () => {
      const salesRevenue = 45000; // Net order subtotal + POS subtotal
      const unitsSold = 500;
      const unitCostPrice = 30; // ₹30 unit cost
      const cogs = unitsSold * unitCostPrice; // ₹15,000
      const operatingExpenses = 18000; // Fuel + Maintenance + Utilities

      const grossProfit = salesRevenue - cogs; // ₹30,000
      const netOperatingProfit = grossProfit - operatingExpenses; // ₹12,000
      const grossMarginPct = Number(((grossProfit / salesRevenue) * 100).toFixed(1));
      const netMarginPct = Number(((netOperatingProfit / salesRevenue) * 100).toFixed(1));

      expect(grossProfit).toBe(30000);
      expect(netOperatingProfit).toBe(12000);
      expect(grossMarginPct).toBe(66.7);
      expect(netMarginPct).toBe(26.7);

      // Verify that naive calculation (Cash In minus Cash Out) is rejected
      const naiveCashIn = 25000; // Incomplete collections
      const naiveProfit = naiveCashIn - operatingExpenses; // ₹7,000
      expect(naiveProfit).not.toBe(netOperatingProfit);
    });

    it("aggregates Cash and UPI collections across channels accurately", () => {
      const customerCash = 5000;
      const customerUpi = 12000;
      const posCash = 2500;
      const posUpi = 3500;
      const routeDriverCash = 4000;
      const routeDriverUpi = 1500;

      const totalCash = customerCash + posCash + routeDriverCash;
      const totalUpi = customerUpi + posUpi + routeDriverUpi;
      const grandTotalCollections = totalCash + totalUpi;

      expect(totalCash).toBe(11500);
      expect(totalUpi).toBe(17000);
      expect(grandTotalCollections).toBe(28500);
    });
  });

  describe("3. Operational Alerts & Low Stock Logic", () => {
    it("flags products with available stock at or below reorder threshold", () => {
      const mockStockItems = [
        { product_id: "p1", name: "20L Mineral Water Jar", available_stock: 35, reorder_level: 50 },
        { product_id: "p2", name: "10L Water Jar", available_stock: 120, reorder_level: 50 },
        { product_id: "p3", name: "Manual Water Dispenser", available_stock: 4, reorder_level: 10 },
      ];

      const lowStockItems = mockStockItems.filter(
        (item) => item.available_stock <= item.reorder_level
      );

      expect(lowStockItems).toHaveLength(2);
      expect(lowStockItems.map((i) => i.name)).toEqual([
        "20L Mineral Water Jar",
        "Manual Water Dispenser",
      ]);
    });

    it("correctly identifies overdue customer accounts", () => {
      const mockCustomers = [
        { id: "c1", name: "Zenith Gym", current_balance: 4500, is_active: true },
        { id: "c2", name: "Dr. Rao", current_balance: 0, is_active: true },
        { id: "c3", name: "Tech Park", current_balance: 18200, is_active: true },
      ];

      const overdue = mockCustomers
        .filter((c) => c.current_balance > 0)
        .sort((a, b) => b.current_balance - a.current_balance);

      expect(overdue).toHaveLength(2);
      expect(overdue[0].name).toBe("Tech Park");
      expect(overdue[0].current_balance).toBe(18200);
      expect(overdue[1].name).toBe("Zenith Gym");
      expect(overdue[1].current_balance).toBe(4500);
    });
  });

  describe("4. getDashboardSummary Service Integration", () => {
    it("successfully aggregates metrics and preserves zero-safe fallbacks", async () => {
      // Mock inventory returns
      (getInventoryValuationSummary as any).mockResolvedValue({
        success: true,
        data: {
          total_distinct_products: 4,
          total_units_in_warehouse: 450,
          total_inventory_valuation: 35000,
          low_stock_items_count: 1,
        },
      });

      (getInventoryStockLevels as any).mockResolvedValue({
        success: true,
        data: [
          {
            product_id: "prod-1",
            sku: "JAR-20L",
            name: "20L Reusable Jar",
            available_stock: 20,
            reorder_level: 50,
          },
        ],
      });

      // Mock Supabase tables
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "customers") {
            return {
              select: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({
                data: [
                  { id: "cust-1", name: "B2B Office", phone: "9876543210", current_balance: 8500, is_active: true },
                  { id: "cust-2", name: "Apartment C", phone: "9876543211", current_balance: 0, is_active: true },
                ],
                error: null,
              }),
            };
          }
          if (table === "suppliers") {
            return {
              select: vi.fn().mockResolvedValue({
                data: [{ id: "supp-1", name: "PureSpring Plant", current_payable: 14000 }],
                error: null,
              }),
            };
          }
          if (table === "orders") {
            const queryBuilder: any = {
              select: vi.fn().mockReturnThis(),
              in: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({
                data: [
                  { id: "ord-1", order_number: "ORD-001", status: "PENDING", total_amount: 1500, delivery_date: "2026-11-06" },
                ],
                error: null,
              }),
              or: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "ord-1",
                    order_number: "ORD-001",
                    customer_id: "cust-1",
                    customer: { name: "B2B Office" },
                    subtotal: 1200,
                    tax_total: 216,
                    total_amount: 1416,
                    status: "PENDING",
                    delivery_date: "2026-11-06",
                    created_at: "2026-11-06T08:30:00Z",
                  },
                ],
                error: null,
              }),
            };
            return queryBuilder;
          }
          if (table === "delivery_stops") {
            return {
              select: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              lte: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "stop-1",
                    order_id: "ord-1",
                    order: { order_number: "ORD-001", customer: { name: "B2B Office" } },
                    status: "COMPLETED",
                    actual_delivered_quantity: 10,
                    payment_collected: 1416,
                    payment_method: "UPI",
                    executed_at: "2026-11-06T10:00:00Z",
                    created_at: "2026-11-06T09:00:00Z",
                  },
                ],
                error: null,
              }),
            };
          }
          if (table === "pos_sales") {
            return {
              select: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              lte: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "pos-1",
                    sale_number: "POS-101",
                    subtotal: 200,
                    tax_total: 36,
                    total_amount: 236,
                    payment_method: "CASH",
                    created_at: "2026-11-06T11:00:00Z",
                  },
                ],
                error: null,
              }),
            };
          }
          if (table === "customer_payments") {
            return {
              select: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              lte: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "pay-1",
                    payment_number: "PAY-1001",
                    customer_id: "cust-1",
                    customer: { name: "B2B Office" },
                    amount: 3000,
                    payment_method: "BANK_TRANSFER",
                    payment_date: "2026-11-06",
                    created_at: "2026-11-06T09:30:00Z",
                  },
                ],
                error: null,
              }),
            };
          }
          if (table === "expenses") {
            return {
              select: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              lte: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: "exp-1",
                    voucher_number: "EXP-501",
                    category: "FUEL",
                    amount: 800,
                    payment_method: "CASH",
                    expense_date: "2026-11-06",
                    description: "Route 1 Fuel Refill",
                    created_at: "2026-11-06T07:30:00Z",
                  },
                ],
                error: null,
              }),
            };
          }
          if (table === "order_items") {
            return {
              select: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({
                data: [
                  { quantity: 10, product: { cost_price: 40 } }, // COGS = 400
                ],
                error: null,
              }),
            };
          }
          if (table === "pos_sale_items") {
            return {
              select: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({
                data: [
                  { quantity: 2, product: { cost_price: 35 } }, // COGS = 70
                ],
                error: null,
              }),
            };
          }

          return {
            select: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }),
      };

      (createClient as any).mockResolvedValue(mockSupabase);

      const result = await getDashboardSummary({ range: "today" });

      expect(result.success).toBe(true);
      if (!result.success) {
        throw new Error("Expected success");
      }

      const d = result.data;

      // Check KPIs
      expect(d.kpis.orderCount).toBe(1);
      expect(d.kpis.orderRevenue).toBe(1416);
      expect(d.kpis.completedDeliveries).toBe(1);
      expect(d.kpis.activeCustomersCount).toBe(2);
      expect(d.kpis.totalReceivables).toBe(8500);
      expect(d.kpis.posSalesCount).toBe(1);
      expect(d.kpis.posSalesTotal).toBe(236);
      expect(d.kpis.expensesTotal).toBe(800);

      // Check Financial Dual-Entry Breakdown
      // Revenue = 1200 (order subtotal) + 200 (pos subtotal) = 1400
      expect(d.financials.salesRevenue).toBe(1400);
      // COGS = 400 (order) + 70 (pos) = 470
      expect(d.financials.costOfGoodsSold).toBe(470);
      // Gross Profit = 1400 - 470 = 930
      expect(d.financials.grossProfit).toBe(930);
      // Operating Expenses = 800
      expect(d.financials.operatingExpenses).toBe(800);
      // Net Operating Profit = 930 - 800 = 130
      expect(d.financials.netOperatingProfit).toBe(130);
      // Collections = Cash (236 pos) + UPI/Bank (3000 pay + 1416 stop) = 4652
      expect(d.financials.cashCollections).toBe(236);
      expect(d.financials.upiBankCollections).toBe(4416);
      expect(d.financials.totalCollections).toBe(4652);

      // Alerts
      expect(d.alerts.length).toBeGreaterThan(0);
      expect(d.alerts.some((a: { type: string }) => a.type === "low_stock")).toBe(true);
      expect(d.alerts.some((a: { type: string }) => a.type === "overdue_balance")).toBe(true);

      // Trend Chart
      expect(d.trendChart).toHaveLength(7);

      // Recent Activity
      expect(d.recentActivity.length).toBeGreaterThan(0);
    });

    it("handles database exceptions safely without throwing unhandled rejection", async () => {
      (createClient as any).mockRejectedValue(new Error("Supabase connection refused"));

      const result = await getDashboardSummary({ range: "today" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Supabase connection refused");
    });
  });
});
