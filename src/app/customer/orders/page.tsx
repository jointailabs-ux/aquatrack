"use client";

import * as React from "react";
import Link from "next/link";
import { Package, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatCurrency } from "@/lib/utils";

interface OrderItem {
  id: string;
  orderNumber: string;
  date: string;
  fullJars: number;
  emptyJarsReturned: number;
  totalAmount: number;
  paymentStatus: "Paid" | "Pending";
  deliveryStatus: "Delivered" | "Out for Delivery" | "Scheduled";
  deliveryDriver: string;
}

const DEMO_ORDERS: OrderItem[] = [
  {
    id: "ord-1",
    orderNumber: "ORD-2025-108",
    date: "Oct 28, 2025",
    fullJars: 2,
    emptyJarsReturned: 2,
    totalAmount: 140,
    paymentStatus: "Paid",
    deliveryStatus: "Delivered",
    deliveryDriver: "Ramesh Kumar (Route 2)",
  },
  {
    id: "ord-2",
    orderNumber: "ORD-2025-072",
    date: "Oct 21, 2025",
    fullJars: 2,
    emptyJarsReturned: 2,
    totalAmount: 140,
    paymentStatus: "Paid",
    deliveryStatus: "Delivered",
    deliveryDriver: "Ramesh Kumar (Route 2)",
  },
  {
    id: "ord-3",
    orderNumber: "ORD-2025-045",
    date: "Oct 14, 2025",
    fullJars: 3,
    emptyJarsReturned: 2,
    totalAmount: 360, // 210 water + 150 deposit for 1 extra jar
    paymentStatus: "Paid",
    deliveryStatus: "Delivered",
    deliveryDriver: "Ramesh Kumar (Route 2)",
  },
  {
    id: "ord-4",
    orderNumber: "ORD-2025-012",
    date: "Oct 01, 2025",
    fullJars: 2,
    emptyJarsReturned: 0,
    totalAmount: 440, // 140 water + 300 deposit for initial 2 jars
    paymentStatus: "Paid",
    deliveryStatus: "Delivered",
    deliveryDriver: "Ramesh Kumar (Route 2)",
  },
];

export default function MyOrdersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="My Orders & Refill History"
        description="Comprehensive log of all scheduled water refills, physical empty jar returns, and delivery receipts."
        action={
          <Link href="/customer/order">
            <Button size="sm" className="gap-2">
              <Package className="h-4 w-4" />
              Place New Order
            </Button>
          </Link>
        }
      />

      <div className="space-y-4">
        {DEMO_ORDERS.map((order) => (
          <Card key={order.id} className="hover:border-primary/40 transition-colors">
            <CardContent className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Package className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-foreground">
                        {order.orderNumber}
                      </h3>
                      <Badge
                        variant={order.deliveryStatus === "Delivered" ? "success" : "default"}
                        className="text-[10px]"
                      >
                        {order.deliveryStatus}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <Calendar className="h-3 w-3" /> {order.date}
                    </p>
                  </div>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center">
                  <span className="font-extrabold text-base text-foreground">
                    {formatCurrency(order.totalAmount)}
                  </span>
                  <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                    {order.paymentStatus}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Full Jars Delivered:</span>
                  <span className="font-semibold text-foreground ml-1.5">
                    {order.fullJars} Jars
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Empty Jars Returned:</span>
                  <span className="font-semibold text-foreground ml-1.5">
                    {order.emptyJarsReturned} Jars
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Delivery Fleet:</span>
                  <span className="font-semibold text-foreground ml-1.5">
                    {order.deliveryDriver}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
