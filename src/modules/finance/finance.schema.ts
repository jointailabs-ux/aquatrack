export interface FinancialMetricCard {
  label: string;
  amount: number;
  description: string;
  type: "revenue" | "expense" | "liability" | "asset" | "profit" | "cash";
}

export interface EnterpriseFinancialReport {
  period_label: string;
  // Revenue & Receivables (Accrual)
  sales_revenue_net: number; // Invoiced sales excluding tax
  output_gst_collected: number; // GST liability to government
  total_invoiced_gross: number;
  cash_upi_collections: number; // Actual cash/UPI collected
  unpaid_customer_invoices: number; // Real-time Accounts Receivable (A/R)

  // Direct Product Costs & Margins
  cost_of_goods_sold: number; // COGS (Unit cost * units sold)
  gross_profit: number; // sales_revenue_net - cost_of_goods_sold
  gross_profit_margin_pct: number;

  // Operating Expenses & Payroll
  operating_expenses: number; // Fuel, maintenance, rent, utilities, supplies
  staff_salary_expenses: number; // Staff compensation period expense
  total_operating_expenses: number; // operating_expenses + staff_salary_expenses

  // Bottom-Line Profitability
  net_operating_profit: number; // gross_profit - total_operating_expenses
  net_profit_margin_pct: number;

  // Liabilities & Capital
  customer_jar_deposits_held: number; // Balance sheet liability (NOT revenue!)

  // Supplier Payables
  purchases_total: number; // Total purchases invoiced by suppliers
  supplier_payments_made: number; // Cash outflows to suppliers
  supplier_outstanding_payables: number; // Accounts Payable (A/P)

  // Cash Position
  net_period_cash_flow: number; // cash_upi_collections - supplier_payments_made - total_operating_expenses
}

export function getDateRangeForPeriod(
  period?: "THIS_MONTH" | "LAST_MONTH" | "THIS_QUARTER" | "THIS_YEAR" | "ALL",
  customStart?: string,
  customEnd?: string
): { startDate: string | null; endDate: string | null; label: string } {
  if (customStart || customEnd) {
    return {
      startDate: customStart || null,
      endDate: customEnd || null,
      label: `Custom Period (${customStart || "Start"} to ${customEnd || "End"})`,
    };
  }

  const now = new Date();
  if (period === "THIS_MONTH") {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    return {
      startDate: `${y}-${m}-01`,
      endDate: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
      label: `This Month (${y}-${m})`,
    };
  } else if (period === "LAST_MONTH") {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const y = prev.getFullYear();
    const m = String(prev.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, prev.getMonth() + 1, 0).getDate();
    return {
      startDate: `${y}-${m}-01`,
      endDate: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
      label: `Last Month (${y}-${m})`,
    };
  } else if (period === "THIS_QUARTER") {
    const quarter = Math.floor(now.getMonth() / 3);
    const startM = String(quarter * 3 + 1).padStart(2, "0");
    const lastMonthOfQuarter = (quarter + 1) * 3;
    const lastDay = new Date(now.getFullYear(), lastMonthOfQuarter, 0).getDate();
    return {
      startDate: `${now.getFullYear()}-${startM}-01`,
      endDate: `${now.getFullYear()}-${String(lastMonthOfQuarter).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      label: `Q${quarter + 1} ${now.getFullYear()}`,
    };
  } else if (period === "THIS_YEAR") {
    return {
      startDate: `${now.getFullYear()}-01-01`,
      endDate: `${now.getFullYear()}-12-31`,
      label: `Fiscal Year ${now.getFullYear()}`,
    };
  }

  return {
    startDate: null,
    endDate: null,
    label: "All Time (Cumulative)",
  };
}
