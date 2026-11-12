"use client";

import * as React from "react";
import { Receipt, ShieldCheck } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { formatCurrency } from "@/lib/utils";

interface PaymentRecord {
  id: string;
  receiptNumber: string;
  date: string;
  type: "Water Refill" | "Security Deposit" | "Deposit Refund";
  mode: "UPI QR" | "Cash Handover" | "Online Card";
  amount: number;
  status: "Settled" | "Pending";
}

const DEMO_PAYMENTS: PaymentRecord[] = [
  {
    id: "pay-1",
    receiptNumber: "RCT-2025-098",
    date: "Oct 28, 2025",
    type: "Water Refill",
    mode: "Cash Handover",
    amount: 140,
    status: "Settled",
  },
  {
    id: "pay-2",
    receiptNumber: "RCT-2025-064",
    date: "Oct 21, 2025",
    type: "Water Refill",
    mode: "UPI QR",
    amount: 140,
    status: "Settled",
  },
  {
    id: "pay-3",
    receiptNumber: "RCT-2025-039",
    date: "Oct 14, 2025",
    type: "Security Deposit",
    mode: "UPI QR",
    amount: 150,
    status: "Settled",
  },
  {
    id: "pay-4",
    receiptNumber: "RCT-2025-008",
    date: "Oct 01, 2025",
    type: "Security Deposit",
    mode: "UPI QR",
    amount: 300,
    status: "Settled",
  },
];

export default function CustomerPaymentsPage() {
  const columns = [
    {
      header: "Receipt #",
      accessorKey: "receiptNumber" as const,
      cell: (p: PaymentRecord) => (
        <span className="font-mono font-medium text-xs text-foreground">
          {p.receiptNumber}
        </span>
      ),
    },
    {
      header: "Date",
      accessorKey: "date" as const,
      cell: (p: PaymentRecord) => (
        <span className="text-xs text-muted-foreground">{p.date}</span>
      ),
    },
    {
      header: "Payment Type",
      accessorKey: "type" as const,
      cell: (p: PaymentRecord) => (
        <Badge
          variant={p.type === "Security Deposit" ? "secondary" : "default"}
          className="text-[10px]"
        >
          {p.type}
        </Badge>
      ),
    },
    {
      header: "Mode",
      accessorKey: "mode" as const,
      cell: (p: PaymentRecord) => (
        <span className="text-xs text-foreground">{p.mode}</span>
      ),
    },
    {
      header: "Amount",
      accessorKey: "amount" as const,
      cell: (p: PaymentRecord) => (
        <span className="font-bold text-xs text-foreground">
          {formatCurrency(p.amount)}
        </span>
      ),
    },
    {
      header: "Status",
      accessorKey: "status" as const,
      cell: (p: PaymentRecord) => (
        <Badge variant="success" className="text-[10px]">
          {p.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Receipts & Jar Deposits"
        description="Transparent breakdown of all refilling charges paid, route collections, and refundable container security deposits."
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground">Total Lifetime Refills Paid</span>
              <p className="text-2xl font-bold text-foreground mt-1">
                {formatCurrency(280)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Receipt className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs text-muted-foreground">Total Refundable Deposit Held</span>
              <p className="text-2xl font-bold text-emerald-600 mt-1">
                {formatCurrency(450)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable data={DEMO_PAYMENTS} columns={columns} />
        </CardContent>
      </Card>
    </div>
  );
}
