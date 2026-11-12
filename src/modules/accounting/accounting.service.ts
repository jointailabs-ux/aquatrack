"use server";

import { createClient } from "@/lib/supabase/server";
import { ActionResponse } from "@/types/api.types";
import {
  AccountingOverview,
  AccountBalanceItem,
  TrialBalanceSummary,
  LedgerTransactionItem,
  LedgerFilterParams,
  STANDARD_CHART_OF_ACCOUNTS,
  ChartOfAccountDefinition,
} from "./accounting.schema";
import { getDateRangeForPeriod } from "@/modules/finance/finance.schema";

/**
 * Checks owner authorization for accounting access.
 * Enforces Section 4.2: Only business owners can view financial ledgers and reports.
 */
async function verifyOwnerAccess(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ authorized: boolean; error?: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { authorized: false, error: "Authentication required to access accounting ledger." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "owner") {
    return {
      authorized: false,
      error: "Access denied: Only business owners can access financial ledgers and accounting data.",
    };
  }

  return { authorized: true };
}

/**
 * Real-time Accounting Overview derived strictly from database records.
 * Follows core accounting rules:
 * - Accrual Revenue recognized on Invoice & POS fulfillment.
 * - Customer Collections satisfy Accounts Receivable (never merged with Sales).
 * - POS Revenue and Order Delivery Revenue separated.
 * - Outstanding A/R and A/P displayed separately from collections.
 * - COGS derived from units sold * product cost price.
 * - Cash and Bank balances computed from dual-entry financial ledger accounts.
 */
export async function getAccountingOverview(params?: {
  period?: "THIS_MONTH" | "LAST_MONTH" | "THIS_QUARTER" | "THIS_YEAR" | "ALL";
  startDate?: string;
  endDate?: string;
}): Promise<ActionResponse<AccountingOverview>> {
  try {
    const supabase = await createClient();
    const authCheck = await verifyOwnerAccess(supabase);
    if (!authCheck.authorized) {
      return { success: false, error: authCheck.error || "Unauthorized access." };
    }

    const { startDate, endDate, label } = getDateRangeForPeriod(
      params?.period || "THIS_MONTH",
      params?.startDate,
      params?.endDate
    );

    // 1. Invoices (Order Revenue Net & Tax)
    let invoicesQuery = supabase
      .from("invoices")
      .select("id, subtotal, tax_amount, total_amount, status, invoice_date");

    if (startDate) invoicesQuery = invoicesQuery.gte("invoice_date", startDate);
    if (endDate) invoicesQuery = invoicesQuery.lte("invoice_date", endDate);

    const { data: invoices } = await invoicesQuery;

    let orderRevenue = 0;
    (invoices || []).forEach((inv) => {
      if (inv.status !== "CANCELLED") {
        orderRevenue += Number(inv.subtotal || 0);
      }
    });

    // 2. POS Walk-in Sales (Net Revenue & Collections)
    let posQuery = supabase
      .from("pos_sales")
      .select("id, subtotal, tax_total, total_amount, created_at");

    if (startDate) posQuery = posQuery.gte("created_at", `${startDate}T00:00:00.000Z`);
    if (endDate) posQuery = posQuery.lte("created_at", `${endDate}T23:59:59.999Z`);

    const { data: posSales } = await posQuery;

    let posRevenue = 0;
    let posCollections = 0;
    (posSales || []).forEach((pos) => {
      posRevenue += Number(pos.subtotal || 0);
      posCollections += Number(pos.total_amount || 0);
    });

    const totalRevenue = orderRevenue + posRevenue;

    // 3. Customer Payments (A/R Collections)
    let paymentsQuery = supabase
      .from("customer_payments")
      .select("amount, created_at");

    if (startDate) paymentsQuery = paymentsQuery.gte("created_at", `${startDate}T00:00:00.000Z`);
    if (endDate) paymentsQuery = paymentsQuery.lte("created_at", `${endDate}T23:59:59.999Z`);

    const { data: payments } = await paymentsQuery;

    let arCollections = 0;
    (payments || []).forEach((p) => {
      arCollections += Number(p.amount || 0);
    });

    const totalCustomerCollections = arCollections + posCollections;

    // 4. Cost of Goods Sold (COGS)
    const invoiceIds = (invoices || []).map((i) => i.id);
    const posIds = (posSales || []).map((p) => p.id);
    let costOfGoodsSold = 0;

    interface ProductCostItem {
      quantity: number | string;
      product?: { cost_price?: number | string } | null;
      products?: { cost_price?: number | string } | null;
    }

    if (invoiceIds.length > 0) {
      const { data: invoiceItems } = await supabase
        .from("invoice_items")
        .select("quantity, product:products(cost_price)")
        .in("invoice_id", invoiceIds);

      ((invoiceItems || []) as unknown as ProductCostItem[]).forEach((item) => {
        const qty = Number(item.quantity || 0);
        const cost = Number(item.product?.cost_price ?? item.products?.cost_price ?? 0);
        costOfGoodsSold += qty * cost;
      });
    }

    if (posIds.length > 0) {
      const { data: posItems } = await supabase
        .from("pos_sale_items")
        .select("quantity, product:products(cost_price)")
        .in("sale_id", posIds);

      ((posItems || []) as unknown as ProductCostItem[]).forEach((item) => {
        const qty = Number(item.quantity || 0);
        const cost = Number(item.product?.cost_price ?? item.products?.cost_price ?? 0);
        costOfGoodsSold += qty * cost;
      });
    }

    const grossProfit = totalRevenue - costOfGoodsSold;
    const grossProfitMarginPct =
      totalRevenue > 0 ? Number(((grossProfit / totalRevenue) * 100).toFixed(1)) : 0;

    // 5. Operating Expenses
    let expQuery = supabase.from("expenses").select("amount, expense_date");
    if (startDate) expQuery = expQuery.gte("expense_date", startDate);
    if (endDate) expQuery = expQuery.lte("expense_date", endDate);

    const { data: expenses } = await expQuery;
    let operatingExpenses = 0;
    (expenses || []).forEach((e) => {
      operatingExpenses += Number(e.amount || 0);
    });

    // 6. Staff Salary Expenses
    let salaryQuery = supabase
      .from("salary_payments")
      .select("net_paid, amount_paid, payment_date");
    if (startDate) salaryQuery = salaryQuery.gte("payment_date", startDate);
    if (endDate) salaryQuery = salaryQuery.lte("payment_date", endDate);

    const { data: salaryPayments } = await salaryQuery;
    let salaryExpenses = 0;
    (salaryPayments || []).forEach((sp) => {
      salaryExpenses += Number(sp.amount_paid ?? sp.net_paid ?? 0);
    });

    const totalExpenses = operatingExpenses + salaryExpenses;
    const netOperatingProfit = grossProfit - totalExpenses;
    const netProfitMarginPct =
      totalRevenue > 0 ? Number(((netOperatingProfit / totalRevenue) * 100).toFixed(1)) : 0;

    // 7. Balance Sheet: Real-time Receivables & Payables
    const { data: customers } = await supabase
      .from("customers")
      .select("current_balance");

    let accountsReceivable = 0;
    (customers || []).forEach((c) => {
      accountsReceivable += Number(c.current_balance || 0);
    });

    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("current_payable");

    let accountsPayable = 0;
    (suppliers || []).forEach((s) => {
      accountsPayable += Number(s.current_payable || 0);
    });

    // 8. Cash & Bank Balances from Financial Ledger (Accounts 1010, 1015, 1020)
    const { data: ledgerCash } = await supabase
      .from("financial_ledger")
      .select("account_code, debit, credit")
      .in("account_code", ["1010", "1015", "1020"]);

    let cashInHand = 0;
    let cashWithDrivers = 0;
    let bankBalance = 0;

    (ledgerCash || []).forEach((row) => {
      const net = Number(row.debit || 0) - Number(row.credit || 0);
      if (row.account_code === "1010") cashInHand += net;
      if (row.account_code === "1015") cashWithDrivers += net;
      if (row.account_code === "1020") bankBalance += net;
    });

    const totalCashAndBank = cashInHand + cashWithDrivers + bankBalance;

    const overview: AccountingOverview = {
      period_label: label,
      total_revenue: Number(totalRevenue.toFixed(2)),
      order_revenue: Number(orderRevenue.toFixed(2)),
      pos_revenue: Number(posRevenue.toFixed(2)),
      total_customer_collections: Number(totalCustomerCollections.toFixed(2)),
      total_expenses: Number(totalExpenses.toFixed(2)),
      operating_expenses: Number(operatingExpenses.toFixed(2)),
      salary_expenses: Number(salaryExpenses.toFixed(2)),
      cost_of_goods_sold: Number(costOfGoodsSold.toFixed(2)),
      gross_profit: Number(grossProfit.toFixed(2)),
      gross_profit_margin_pct: grossProfitMarginPct,
      net_operating_profit: Number(netOperatingProfit.toFixed(2)),
      net_profit_margin_pct: netProfitMarginPct,
      accounts_receivable: Number(accountsReceivable.toFixed(2)),
      accounts_payable: Number(accountsPayable.toFixed(2)),
      cash_in_hand: Number(cashInHand.toFixed(2)),
      cash_with_drivers: Number(cashWithDrivers.toFixed(2)),
      bank_balance: Number(bankBalance.toFixed(2)),
      total_cash_and_bank: Number(totalCashAndBank.toFixed(2)),
    };

    return { success: true, data: overview };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load accounting overview.";
    return { success: false, error: message };
  }
}

/**
 * Returns Chart of Accounts with live debit, credit, and net balance
 * calculated from public.financial_ledger dual-entry records.
 */
export async function getChartOfAccountsBalances(): Promise<
  ActionResponse<{
    accounts: AccountBalanceItem[];
    trial_balance: TrialBalanceSummary;
  }>
> {
  try {
    const supabase = await createClient();
    const authCheck = await verifyOwnerAccess(supabase);
    if (!authCheck.authorized) {
      return { success: false, error: authCheck.error || "Unauthorized access." };
    }

    const { data: ledgerEntries, error } = await supabase
      .from("financial_ledger")
      .select("account_code, account_name, debit, credit");

    if (error) {
      return { success: false, error: error.message };
    }

    // Aggregate debit and credit by account code
    const totalsByCode = new Map<
      string,
      { debit: number; credit: number; nameFromLedger?: string }
    >();

    let totalTrialDebit = 0;
    let totalTrialCredit = 0;

    (ledgerEntries || []).forEach((row) => {
      const code = String(row.account_code);
      const dr = Number(row.debit || 0);
      const cr = Number(row.credit || 0);

      totalTrialDebit += dr;
      totalTrialCredit += cr;

      const existing = totalsByCode.get(code) || {
        debit: 0,
        credit: 0,
        nameFromLedger: row.account_name,
      };

      totalsByCode.set(code, {
        debit: existing.debit + dr,
        credit: existing.credit + cr,
        nameFromLedger: existing.nameFromLedger || row.account_name,
      });
    });

    const definitionsByCode = new Map<string, ChartOfAccountDefinition>();
    STANDARD_CHART_OF_ACCOUNTS.forEach((def) => {
      definitionsByCode.set(def.code, def);
    });

    // Populate standard accounts
    const accounts: AccountBalanceItem[] = [];

    STANDARD_CHART_OF_ACCOUNTS.forEach((def) => {
      const ledgerTotal = totalsByCode.get(def.code) || { debit: 0, credit: 0 };
      const debit = Number(ledgerTotal.debit.toFixed(2));
      const credit = Number(ledgerTotal.credit.toFixed(2));

      // Normal balance: DEBIT accounts balance = debit - credit
      //                 CREDIT accounts balance = credit - debit
      const currentBalance =
        def.normal_balance === "DEBIT" ? debit - credit : credit - debit;

      accounts.push({
        account_code: def.code,
        account_name: def.name,
        type: def.type,
        normal_balance: def.normal_balance,
        description: def.description,
        total_debit: debit,
        total_credit: credit,
        current_balance: Number(currentBalance.toFixed(2)),
      });
    });

    // Check for any additional accounts present in financial_ledger that are not in the standard list
    totalsByCode.forEach((totals, code) => {
      if (!definitionsByCode.has(code)) {
        const debit = Number(totals.debit.toFixed(2));
        const credit = Number(totals.credit.toFixed(2));
        accounts.push({
          account_code: code,
          account_name: totals.nameFromLedger || `Custom Account (${code})`,
          type: "ASSET",
          normal_balance: "DEBIT",
          description: "Custom general ledger account",
          total_debit: debit,
          total_credit: credit,
          current_balance: Number((debit - credit).toFixed(2)),
        });
      }
    });

    // Sort accounts by account code ascending
    accounts.sort((a, b) => a.account_code.localeCompare(b.account_code));

    const trialDiff = Number(
      Math.abs(totalTrialDebit - totalTrialCredit).toFixed(2)
    );

    const trialBalance: TrialBalanceSummary = {
      total_debit: Number(totalTrialDebit.toFixed(2)),
      total_credit: Number(totalTrialCredit.toFixed(2)),
      is_balanced: trialDiff < 0.01,
      difference: trialDiff,
    };

    return {
      success: true,
      data: {
        accounts,
        trial_balance: trialBalance,
      },
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load chart of accounts balances.";
    return { success: false, error: message };
  }
}

/**
 * Returns granular journal entries from public.financial_ledger with date,
 * account, reference type, and text search filtering.
 */
export async function getLedgerTransactions(
  params?: LedgerFilterParams
): Promise<
  ActionResponse<{
    transactions: LedgerTransactionItem[];
    total_count: number;
  }>
> {
  try {
    const supabase = await createClient();
    const authCheck = await verifyOwnerAccess(supabase);
    if (!authCheck.authorized) {
      return { success: false, error: authCheck.error || "Unauthorized access." };
    }

    let query = supabase
      .from("financial_ledger")
      .select(
        `
        id,
        entry_number,
        entry_date,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        is_reversal,
        reversed_entry_id,
        created_at
      `,
        { count: "exact" }
      )
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });

    // Handle date filtering
    if (params?.period === "TODAY") {
      const today = new Date().toISOString().split("T")[0];
      query = query.eq("entry_date", today);
    } else if (params?.startDate || params?.endDate) {
      if (params.startDate) query = query.gte("entry_date", params.startDate);
      if (params.endDate) query = query.lte("entry_date", params.endDate);
    } else if (
      params?.period &&
      params.period !== "ALL" &&
      params.period !== "CUSTOM"
    ) {
      const range = getDateRangeForPeriod(params.period);
      if (range.startDate) query = query.gte("entry_date", range.startDate);
      if (range.endDate) query = query.lte("entry_date", range.endDate);
    }

    if (params?.accountCode) {
      query = query.eq("account_code", params.accountCode);
    }

    if (params?.referenceType) {
      query = query.eq("reference_type", params.referenceType);
    }

    const limit = params?.limit || 100;
    const offset = params?.offset || 0;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      return { success: false, error: error.message };
    }

    let transactions: LedgerTransactionItem[] = (data || []).map((row) => ({
      id: row.id,
      entry_number: row.entry_number,
      entry_date: row.entry_date,
      account_code: row.account_code,
      account_name: row.account_name,
      debit: Number(row.debit || 0),
      credit: Number(row.credit || 0),
      description: row.description,
      reference_type: row.reference_type as LedgerTransactionItem["reference_type"],
      reference_id: row.reference_id,
      is_reversal: Boolean(row.is_reversal),
      reversed_entry_id: row.reversed_entry_id,
      created_at: row.created_at,
    }));

    // In-memory search if provided (covers entry_number, description, account code and name)
    if (params?.search && params.search.trim()) {
      const term = params.search.trim().toLowerCase();
      transactions = transactions.filter(
        (t) =>
          t.entry_number.toLowerCase().includes(term) ||
          t.description.toLowerCase().includes(term) ||
          t.account_name.toLowerCase().includes(term) ||
          t.account_code.toLowerCase().includes(term)
      );
    }

    return {
      success: true,
      data: {
        transactions,
        total_count: count ?? transactions.length,
      },
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load ledger transactions.";
    return { success: false, error: message };
  }
}
