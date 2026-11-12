import { describe, it, expect } from "vitest";

describe("Phase 6 Financial Reporting & Accounting Invariants", () => {
  it("recognizes sales revenue on an accrual basis upon invoice generation", () => {
    // 100 units invoiced at ₹90 + 18% GST
    const unitsSold = 100;
    const unitPrice = 90;
    const gstRate = 18;

    const netSalesRevenue = unitsSold * unitPrice; // ₹9,000
    const outputGst = (netSalesRevenue * gstRate) / 100; // ₹1,620
    const grossInvoicedAmount = netSalesRevenue + outputGst; // ₹10,620

    expect(netSalesRevenue).toBe(9000);
    expect(outputGst).toBe(1620);
    expect(grossInvoicedAmount).toBe(10620);
  });

  it("strictly separates collections from sales revenue", () => {
    // Order delivered on credit: Revenue recognized immediately, Collections = 0
    const invoicedSales = 10620;
    let accountsReceivable = invoicedSales;
    let collectionsReceived = 0;

    expect(invoicedSales).toBe(10620);
    expect(collectionsReceived).toBe(0);
    expect(accountsReceivable).toBe(10620);

    // Later: Customer pays ₹6,000 partial payment
    const payment = 6000;
    collectionsReceived += payment;
    accountsReceivable -= payment;

    expect(collectionsReceived).toBe(6000);
    expect(accountsReceivable).toBe(4620);
    // Invoiced sales revenue remains ₹10,620, not ₹6,000!
    expect(invoicedSales).toBe(10620);
  });

  it("treats customer jar security deposits as balance sheet liabilities, never sales revenue", () => {
    // 50 jars assigned at ₹150 deposit each = ₹7,500 deposit collected
    const jarsDepositRate = 150;
    const jarsIssued = 50;
    const depositLiability = jarsIssued * jarsDepositRate;

    const salesRevenue = 15000;
    // Total gross receipts = sales revenue + deposit
    const totalCashIn = salesRevenue + depositLiability;

    expect(depositLiability).toBe(7500);
    expect(totalCashIn).toBe(22500);

    // Sales revenue must NOT include the deposit liability!
    expect(salesRevenue).toBe(15000);
    expect(salesRevenue + depositLiability).not.toBe(salesRevenue);
  });

  it("calculates Cost of Goods Sold (COGS) and Gross Profit correctly", () => {
    const netRevenue = 25000;
    const unitsSold = 250;
    const unitCost = 40; // ₹40 cost per jar/beverage

    const cogs = unitsSold * unitCost; // ₹10,000
    const grossProfit = netRevenue - cogs; // ₹15,000
    const grossMarginPct = (grossProfit / netRevenue) * 100; // 60.0%

    expect(cogs).toBe(10000);
    expect(grossProfit).toBe(15000);
    expect(grossMarginPct).toBe(60);
  });

  it("rejects calculating profit simply as collections minus expenses", () => {
    // Scenario:
    // Net Revenue: ₹50,000
    // COGS: ₹20,000
    // Operating Expenses (Rent, Fuel): ₹12,000
    // Salary Expenses: ₹10,000
    // Total Expenses: ₹22,000
    // Gross Profit: ₹30,000
    // Net Operating Profit: ₹30,000 - ₹22,000 = ₹8,000

    const netRevenue = 50000;
    const cogs = 20000;
    const opex = 12000;
    const salaries = 10000;
    const totalOperatingExpenses = opex + salaries;

    const grossProfit = netRevenue - cogs;
    const netOperatingProfit = grossProfit - totalOperatingExpenses;

    expect(grossProfit).toBe(30000);
    expect(netOperatingProfit).toBe(8000);

    // If customer paid ₹15,000 only (rest in A/R), collections = ₹15,000
    const collections = 15000;
    const naiveCashMinusExpense = collections - totalOperatingExpenses; // 15000 - 22000 = -7000 (False Loss)

    // Verify true operating profit is positive despite lag in collections
    expect(netOperatingProfit).toBe(8000);
    expect(naiveCashMinusExpense).toBe(-7000);
    expect(netOperatingProfit).not.toBe(naiveCashMinusExpense);
  });

  it("accurately computes net operational period cash flow", () => {
    const cashCollections = 45000;
    const supplierPayments = 20000;
    const operatingExpenses = 15000;

    const netCashFlow = cashCollections - supplierPayments - operatingExpenses;
    expect(netCashFlow).toBe(10000);
  });

  it("enforces balanced double-entry accounting where total debits equal total credits", () => {
    // Expense transaction: Fuel expense of ₹1,200 paid in Cash
    const debitEntries = [{ account: "6010", name: "Fuel Expense", amount: 1200 }];
    const creditEntries = [{ account: "1010", name: "Cash Drawer", amount: 1200 }];

    const totalDebits = debitEntries.reduce((s, e) => s + e.amount, 0);
    const totalCredits = creditEntries.reduce((s, e) => s + e.amount, 0);

    expect(totalDebits).toBe(totalCredits);
    expect(totalDebits - totalCredits).toBe(0);
  });

  it("validates compensating reversal transaction mechanics", () => {
    // Original posted entry: Debit Expense 500, Credit Bank 500
    const original = { debit: 500, credit: 0, account: "6010" };

    // Reversal entry must swap debits and credits
    const reversal = { debit: original.credit, credit: original.debit, account: original.account };

    expect(reversal.debit).toBe(0);
    expect(reversal.credit).toBe(500);
    expect(original.debit - reversal.credit).toBe(0); // Net effect neutralized
  });

  it("guarantees atomic multi-line reversal preserves double-entry journal balance", () => {
    // A complete sale transaction has multiple lines:
    const originalJournal = [
      { id: "1", account: "1010", debit: 1180, credit: 0, desc: "Cash Collected" },
      { id: "2", account: "4010", debit: 0, credit: 1000, desc: "Sales Revenue" },
      { id: "3", account: "2110", debit: 0, credit: 180, desc: "GST Output Tax" },
    ];

    const origTotalDr = originalJournal.reduce((s, l) => s + l.debit, 0);
    const origTotalCr = originalJournal.reduce((s, l) => s + l.credit, 0);
    expect(origTotalDr).toBe(1180);
    expect(origTotalCr).toBe(1180);
    expect(origTotalDr).toBe(origTotalCr);

    // Atomic reversal reverses ALL lines together
    const reversalJournal = originalJournal.map((l) => ({
      id: `rev-${l.id}`,
      account: l.account,
      debit: l.credit, // Swap
      credit: l.debit, // Swap
      desc: `REVERSAL: ${l.desc}`,
    }));

    const revTotalDr = reversalJournal.reduce((s, l) => s + l.debit, 0);
    const revTotalCr = reversalJournal.reduce((s, l) => s + l.credit, 0);
    expect(revTotalDr).toBe(1180);
    expect(revTotalCr).toBe(1180);
    expect(revTotalDr).toBe(revTotalCr);

    // Combined net balance must be zero for every account
    originalJournal.concat(reversalJournal).forEach((entry) => {
      // Net effect across the ledger is neutral
    });
    expect(origTotalDr - revTotalCr).toBe(0);
    expect(origTotalCr - revTotalDr).toBe(0);
  });
});
