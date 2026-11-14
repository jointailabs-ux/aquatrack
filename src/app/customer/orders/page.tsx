"use client";

import * as React from "react";
import Link from "next/link";
import { Package, Calendar, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { getOrders } from "@/modules/orders/order.service";
import { OrderRecord } from "@/modules/orders/order.schema";
import { formatCurrency } from "@/lib/utils";

export default function MyOrdersPage() {
  const [orders, setOrders] = React.useState<OrderRecord[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  const fetchOrders = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getOrders();
      if (res.success && res.data) {
        setOrders(res.data);
      }
    } catch {
      // Handled gracefully
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Orders & Refill History"
        description="Comprehensive log of all scheduled water refills, physical empty jar returns, and delivery receipts."
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={fetchOrders}
              disabled={isLoading}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Link href="/customer/order">
              <Button size="sm" className="gap-2">
                <Package className="h-4 w-4" />
                Place New Order
              </Button>
            </Link>
          </div>
        }
      />

      <div className="space-y-4">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
            <span>Loading your refill orders...</span>
          </div>
        ) : orders.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center space-y-3">
              <Package className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <h3 className="font-bold text-sm text-foreground">No orders placed yet</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                You haven&apos;t placed any refill orders yet. Schedule a 20L water jar or bottled water delivery in seconds!
              </p>
              <Link href="/customer/order" className="inline-block pt-1">
                <Button size="sm" className="gap-2">
                  <Package className="h-4 w-4" />
                  Order Water Now
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          orders.map((order) => {
            const totalUnits = order.items ? order.items.reduce((s, it) => s + it.quantity, 0) : 0;
            const jarUnits = order.items
              ? order.items.filter((it) => it.is_reusable_jar).reduce((s, it) => s + it.quantity, 0)
              : 0;
            const formattedDate = order.created_at
              ? new Date(order.created_at).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : order.order_date;

            return (
              <Card key={order.id} className="hover:border-primary/40 transition-colors shadow-2xs">
                <CardContent className="p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Package className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-sm text-foreground">
                            {order.order_number}
                          </h3>
                          <Badge
                            variant={
                              order.status === "DELIVERED"
                                ? "success"
                                : order.status === "CANCELLED"
                                ? "destructive"
                                : "outline"
                            }
                            className="text-[10px]"
                          >
                            {order.status.replace(/_/g, " ")}
                          </Badge>
                          <Badge
                            variant={order.payment_status === "PAID" ? "success" : "outline"}
                            className="text-[10px]"
                          >
                            {order.payment_status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <Calendar className="h-3 w-3" /> Ordered on: {formattedDate}
                        </p>
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center">
                      <span className="font-black text-base text-primary">
                        {formatCurrency(order.total_amount)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {order.payment_status === "PAID" ? "Payment Completed" : "Payment Due"}
                      </span>
                    </div>
                  </div>

                  {/* Items Ordered Breakdown */}
                  <div className="bg-muted/30 rounded-xl p-3 border border-border/50 text-xs space-y-1.5">
                    <span className="font-bold text-foreground block text-[11px] uppercase tracking-wider">
                      You ordered ({totalUnits} total items{jarUnits > 0 ? `, ${jarUnits} jars` : ""}):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {order.items && order.items.length > 0 ? (
                        order.items.map((it, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-card text-foreground border border-border shadow-2xs"
                          >
                            {it.is_reusable_jar ? "💧" : "📦"} {it.quantity} × {it.product_name} ({formatCurrency(it.total_amount)})
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground italic text-xs">Standard Water Refill</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium">Target Delivery:</span>
                      <span className="font-semibold text-foreground ml-1">{order.delivery_date}</span>
                    </div>
                    <div>
                      <span className="font-medium">Delivery Address:</span>
                      <span className="font-semibold text-foreground ml-1 truncate">{order.delivery_address}</span>
                    </div>
                    <div>
                      <span className="font-medium">Assigned Driver:</span>
                      <span className="font-semibold text-foreground ml-1">{order.assigned_staff_name || "Route Fleet Driver"}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

