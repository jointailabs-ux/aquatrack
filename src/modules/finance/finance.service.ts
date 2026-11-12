"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import { EnterpriseFinancialReport, getDateRangeForPeriod } from "./finance.schema";

/**
 * Enterprise Financial Report
 * Adheres strictly to Section 12 business invariants:
 * - Sales Revenue is recognized when goods are invoiced/delivered (Accrual basis).
 * - Collections (Cash/UPI) satisfy Accounts Receivable; they are not merged with Sales.
 * - Customer jar deposits are recorded as Refundable Balance Sheet Liabilities, never revenue!
 * - Cost of Goods Sold is recognized based on product cost price * units sold.
 * - Profit is never calculated simply as collections minus expenses.
 * - Date filters actually filter the operational period records.
 * - Zero balances display as 0 with zero demonstration fallbacks.
 */
export async function getEnterpriseFinancialReport(params?: {
  period?: "THIS_MONTH" | "LAST_MONTH" | "THIS_QUARTER" | "THIS_YEAR" | "ALL";
  startDate?: string;
  endDate?: string;
}): Promise<ActionResponse<EnterpriseFinancialReport>> {
  try {
    const supabase = await createClient();
    const { startDate, endDate, label } = getDateRangeForPeriod(
      params?.period || "THIS_MONTH",
      params?.startDate,
      params?.endDate
    );

    // 1. Balance Sheet: Accounts Receivable & Refundable Jar Deposit Liabilities
    const { data: customers } = await supabase
      .from("customers")
      .select("current_balance, total_deposit_held");

    let accountsReceivable = 0;
    let customerDepositsHeld = 0;
    (customers || []).forEach((c) => {
      accountsReceivable += Number(c.current_balance || 0);
      customerDepositsHeld += Number(c.total_deposit_held || 0);
    });

    // 2. Balance Sheet: Supplier Payables
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("current_payable");

    let accountsPayable = 0;
    (suppliers || []).forEach((s) => {
      accountsPayable += Number(s.current_payable || 0);
    });

    // 3. Invoices Query (Filtered by Date)
    let invoicesQuery = supabase
      .from("invoices")
      .select("id, subtotal, tax_amount, total_amount, status, invoice_date");

    if (startDate) {
      invoicesQuery = invoicesQuery.gte("invoice_date", startDate);
    }
    if (endDate) {
      invoicesQuery = invoicesQuery.lte("invoice_date", endDate);
    }

    const { data: invoices } = await invoicesQuery;

    // 4. POS Sales Query (Filtered by Date)
    let posQuery = supabase
      .from("pos_sales")
      .select("id, subtotal, tax_total, total_amount, created_at");

    if (startDate) {
      posQuery = posQuery.gte("created_at", `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      posQuery = posQuery.lte("created_at", `${endDate}T23:59:59.999Z`);
    }

    const { data: posSales } = await posQuery;

    let salesRevenueNet = 0;
    let outputGstCollected = 0;

    (invoices || []).forEach((inv) => {
      if (inv.status !== "CANCELLED") {
        salesRevenueNet += Number(inv.subtotal || 0);
        outputGstCollected += Number(inv.tax_amount || 0);
      }
    });

    (posSales || []).forEach((pos) => {
      salesRevenueNet += Number(pos.subtotal || 0);
      outputGstCollected += Number(pos.tax_total || 0);
    });

    const totalInvoicedGross = salesRevenueNet + outputGstCollected;

    // 5. Cash/UPI Collections (Filtered by Date)
    let paymentsQuery = supabase
      .from("customer_payments")
      .select("amount, created_at");

    if (startDate) {
      paymentsQuery = paymentsQuery.gte("created_at", `${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      paymentsQuery = paymentsQuery.lte("created_at", `${endDate}T23:59:59.999Z`);
    }

    const { data: payments } = await paymentsQuery;

    let cashUpiCollections = 0;
    (payments || []).forEach((p) => {
      cashUpiCollections += Number(p.amount || 0);
    });
    (posSales || []).forEach((pos) => {
      cashUpiCollections += Number(pos.total_amount || 0);
    });

    // 6. Cost of Goods Sold (COGS) for Invoices and POS items in period
    const invoiceIds = (invoices || []).map((i) => i.id);
    const posIds = (posSales || []).map((p) => p.id);

    let costOfGoodsSold = 0;

    if (invoiceIds.length > 0) {
      const { data: invoiceItems } = await supabase
        .from("invoice_items")
        .select("quantity, product:products(cost_price)")
        .in("invoice_id", invoiceIds);

      interface ProductCostItem {
        quantity: number | string;
        product?: { cost_price: number | string } | null;
      }

      ((invoiceItems || []) as unknown as ProductCostItem[]).forEach((item) => {
        const qty = Number(item.quantity || 0);
        const cost = Number(item.product?.cost_price || 0);
        costOfGoodsSold += qty * cost;
      });
    }

    if (posIds.length > 0) {
      const { data: posItems } = await supabase
        .from("pos_sale_items")
        .select("quantity, product:products(cost_price)")
        .in("sale_id", posIds);

      interface ProductCostItem {
        quantity: number | string;
        product?: { cost_price: number | string } | null;
      }

      ((posItems || []) as unknown as ProductCostItem[]).forEach((item) => {
        const qty = Number(item.quantity || 0);
        const cost = Number(item.product?.cost_price || 0);
        costOfGoodsSold += qty * cost;
      });
    }

    const grossProfit = salesRevenueNet - costOfGoodsSold;
    const grossProfitMarginPct =
      salesRevenueNet > 0
        ? Number(((grossProfit / salesRevenueNet) * 100).toFixed(1))
        : 0;

    // 7. Operating Expenses (Filtered by Date)
    let expQuery = supabase
      .from("expenses")
      .select("amount, expense_date");

    if (startDate) {
      expQuery = expQuery.gte("expense_date", startDate);
    }
    if (endDate) {
      expQuery = expQuery.lte("expense_date", endDate);
    }

    const { data: expenses } = await expQuery;

    let operatingExpenses = 0;
    (expenses || []).forEach((e) => {
      operatingExpenses += Number(e.amount || 0);
    });

    // 8. Staff Salary Expenses (Filtered by Date)
    let salaryQuery = supabase
      .from("salary_payments")
      .select("net_paid, amount_paid, payment_date");

    if (startDate) {
      salaryQuery = salaryQuery.gte("payment_date", startDate);
    }
    if (endDate) {
      salaryQuery = salaryQuery.lte("payment_date", endDate);
    }

    const { data: salaryPayments } = await salaryQuery;

    let staffSalaryExpenses = 0;
    (salaryPayments || []).forEach((sp) => {
      staffSalaryExpenses += Number(sp.amount_paid ?? sp.net_paid ?? 0);
    });

    const totalOperatingExpenses = operatingExpenses + staffSalaryExpenses;
    const netOperatingProfit = grossProfit - totalOperatingExpenses;
    const netProfitMarginPct =
      salesRevenueNet > 0
        ? Number(((netOperatingProfit / salesRevenueNet) * 100).toFixed(1))
        : 0;

    // 9. Purchases & Supplier Cash Outflows (Filtered by Date)
    let purchQuery = supabase
      .from("purchases")
      .select("total_amount, status, purchase_date");

    if (startDate) {
      purchQuery = purchQuery.gte("purchase_date", startDate);
    }
    if (endDate) {
      purchQuery = purchQuery.lte("purchase_date", endDate);
    }

    const { data: purchases } = await purchQuery;

    let purchasesTotal = 0;
    (purchases || []).forEach((pur) => {
      if (pur.status !== "CANCELLED") {
        purchasesTotal += Number(pur.total_amount || 0);
      }
    });

    let suppPayQuery = supabase
      .from("supplier_payments")
      .select("amount, payment_date");

    if (startDate) {
      suppPayQuery = suppPayQuery.gte("payment_date", startDate);
    }
    if (endDate) {
      suppPayQuery = suppPayQuery.lte("payment_date", endDate);
    }

    const { data: supplierPayments } = await suppPayQuery;

    let supplierPaymentsMade = 0;
    (supplierPayments || []).forEach((sp) => {
      supplierPaymentsMade += Number(sp.amount || 0);
    });

    // 10. Net Period Cash Flow
    const netPeriodCashFlow =
      cashUpiCollections - supplierPaymentsMade - totalOperatingExpenses;

    const report: EnterpriseFinancialReport = {
      period_label: label,
      sales_revenue_net: Number(salesRevenueNet.toFixed(2)),
      output_gst_collected: Number(outputGstCollected.toFixed(2)),
      total_invoiced_gross: Number(totalInvoicedGross.toFixed(2)),
      cash_upi_collections: Number(cashUpiCollections.toFixed(2)),
      unpaid_customer_invoices: Number(accountsReceivable.toFixed(2)),

      cost_of_goods_sold: Number(costOfGoodsSold.toFixed(2)),
      gross_profit: Number(grossProfit.toFixed(2)),
      gross_profit_margin_pct: grossProfitMarginPct,

      operating_expenses: Number(operatingExpenses.toFixed(2)),
      staff_salary_expenses: Number(staffSalaryExpenses.toFixed(2)),
      total_operating_expenses: Number(totalOperatingExpenses.toFixed(2)),

      net_operating_profit: Number(netOperatingProfit.toFixed(2)),
      net_profit_margin_pct: netProfitMarginPct,

      customer_jar_deposits_held: Number(customerDepositsHeld.toFixed(2)),

      purchases_total: Number(purchasesTotal.toFixed(2)),
      supplier_payments_made: Number(supplierPaymentsMade.toFixed(2)),
      supplier_outstanding_payables: Number(accountsPayable.toFixed(2)),

      net_period_cash_flow: Number(netPeriodCashFlow.toFixed(2)),
    };

    return { success: true, data: report };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate financial report.";
    return { success: false, error: message };
  }
}

/**
 * Reverses a posted financial journal transaction atomically.
 * Reverses all debit and credit lines of the complete journal transaction.
 */
export async function reverseFinancialEntry(
  entryId: string,
  reason: string
): Promise<ActionResponse<{ success: boolean; reversedCount: number; reversedAmount: number }>> {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Authentication required to reverse financial entries." };
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc("rpc_reverse_financial_entry", {
      p_entry_id: entryId,
      p_reason: reason,
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    return {
      success: true,
      data: {
        success: true,
        reversedCount: Number(rpcResult.reversed_lines_count || 1),
        reversedAmount: Number(rpcResult.total_reversed_amount || 0),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reverse financial entry.";
    return { success: false, error: message };
  }
}
