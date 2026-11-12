import { z } from "zod";

export type AccountType =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "REVENUE"
  | "DIRECT_COST"
  | "EXPENSE";

export type NormalBalance = "DEBIT" | "CREDIT";

export interface ChartOfAccountDefinition {
  code: string;
  name: string;
  type: AccountType;
  normal_balance: NormalBalance;
  description: string;
}

export const STANDARD_ACCOUNT_CODES = {
  CASH_DRAWER: "1010",
  DRIVER_FLOAT: "1015",
  BANK_CURRENT: "1020",
  ACCOUNTS_RECEIVABLE: "1110",
  INVENTORY_STOCK: "1210",
  JAR_ASSET_CAPITALIZED: "1310",
  ACCOUNTS_PAYABLE: "2010",
  CUSTOMER_JAR_DEPOSITS: "2110",
  OUTPUT_GST_PAYABLE: "2210",
  SALES_REVENUE: "4010",
  COGS: "5010",
  STAFF_SALARIES: "6010",
  OPERATING_EXPENSES: "6020",
} as const;

export const STANDARD_CHART_OF_ACCOUNTS: ChartOfAccountDefinition[] = [
  {
    code: "1010",
    name: "Cash in Hand (Depot Vault)",
    type: "ASSET",
    normal_balance: "DEBIT",
    description: "Physical cash in office safe and counter cash drawer",
  },
  {
    code: "1015",
    name: "Cash Float with Driver (In-Transit)",
    type: "ASSET",
    normal_balance: "DEBIT",
    description: "Route delivery change float and collections awaiting evening handover",
  },
  {
    code: "1020",
    name: "Bank Current Account (UPI / Bank)",
    type: "ASSET",
    normal_balance: "DEBIT",
    description: "Company operational bank account and merchant QR UPI settlements",
  },
  {
    code: "1110",
    name: "Accounts Receivable (Customer Invoices Due)",
    type: "ASSET",
    normal_balance: "DEBIT",
    description: "Amounts owed by credit and commercial customers for delivered water products",
  },
  {
    code: "1210",
    name: "Finished Water & Merchandise Inventory",
    type: "ASSET",
    normal_balance: "DEBIT",
    description: "Warehouse stock of filled jars, bottled water, and resale goods",
  },
  {
    code: "1310",
    name: "Returnable Polycarbonate Jar Assets",
    type: "ASSET",
    normal_balance: "DEBIT",
    description: "Capitalized 20L reusable container assets owned by the enterprise",
  },
  {
    code: "2010",
    name: "Accounts Payable (Bottling Plant & Suppliers)",
    type: "LIABILITY",
    normal_balance: "CREDIT",
    description: "Outstanding payables due to water bottling plants and raw material vendors",
  },
  {
    code: "2020",
    name: "Refundable Customer Jar Deposits (Held)",
    type: "LIABILITY",
    normal_balance: "CREDIT",
    description: "Customer security deposits held in custody, refundable upon return of jars",
  },
  {
    code: "2110",
    name: "GST Output Tax Payable (CGST + SGST)",
    type: "LIABILITY",
    normal_balance: "CREDIT",
    description: "Taxes collected on sales to be remitted to the tax authorities",
  },
  {
    code: "4010",
    name: "Sales Revenue (Water & Merchandise)",
    type: "REVENUE",
    normal_balance: "CREDIT",
    description: "Gross earned revenue from fulfilled customer deliveries and counter walk-in POS",
  },
  {
    code: "5010",
    name: "Cost of Goods Sold (COGS)",
    type: "DIRECT_COST",
    normal_balance: "DEBIT",
    description: "Direct acquisition and processing cost of purified water jars and packaged items sold",
  },
  {
    code: "6010",
    name: "Operating Expenses (Fuel, Repairs, Rent)",
    type: "EXPENSE",
    normal_balance: "DEBIT",
    description: "Period business operational overheads including vehicle maintenance and utilities",
  },
  {
    code: "6020",
    name: "Staff Salary Expenses",
    type: "EXPENSE",
    normal_balance: "DEBIT",
    description: "Monthly payroll compensation and wages paid to drivers, warehouse, and office staff",
  },
];

export interface AccountBalanceItem {
  account_code: string;
  account_name: string;
  type: AccountType;
  normal_balance: NormalBalance;
  description: string;
  total_debit: number;
  total_credit: number;
  current_balance: number;
}

export interface TrialBalanceSummary {
  total_debit: number;
  total_credit: number;
  is_balanced: boolean;
  difference: number;
}

export interface AccountingOverview {
  period_label: string;
  total_revenue: number;
  order_revenue: number;
  pos_revenue: number;
  total_customer_collections: number;
  total_expenses: number;
  operating_expenses: number;
  salary_expenses: number;
  cost_of_goods_sold: number;
  gross_profit: number;
  gross_profit_margin_pct: number;
  net_operating_profit: number;
  net_profit_margin_pct: number;
  accounts_receivable: number;
  accounts_payable: number;
  cash_in_hand: number;
  cash_with_drivers: number;
  bank_balance: number;
  total_cash_and_bank: number;
}

export interface LedgerTransactionItem {
  id: string;
  entry_number: string;
  entry_date: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  description: string;
  reference_type:
    | "INVOICE"
    | "PAYMENT"
    | "PURCHASE"
    | "EXPENSE"
    | "SALARY"
    | "HANDOVER"
    | "REVERSAL"
    | null;
  reference_id: string | null;
  is_reversal: boolean;
  reversed_entry_id: string | null;
  created_at: string;
}

export const LedgerFilterSchema = z.object({
  period: z
    .enum([
      "ALL",
      "TODAY",
      "THIS_MONTH",
      "LAST_MONTH",
      "THIS_QUARTER",
      "THIS_YEAR",
      "CUSTOM",
    ])
    .optional()
    .default("THIS_MONTH"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  accountCode: z.string().optional(),
  referenceType: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().positive().optional().default(100),
  offset: z.number().int().nonnegative().optional().default(0),
});

export type LedgerFilterParams = z.input<typeof LedgerFilterSchema>;
