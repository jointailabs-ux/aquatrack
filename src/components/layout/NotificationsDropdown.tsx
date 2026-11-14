"use client";

import * as React from "react";
import { Bell, AlertTriangle, CheckCircle2, Truck, RefreshCw, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { getOrders } from "@/modules/orders/order.service";
import { getInventoryStockLevels } from "@/modules/inventory/inventory.service";
import { formatCurrency, formatDateTime } from "@/lib/utils";

interface LiveNotification {
  id: string;
  title: string;
  message: string;
  time: string;
  type: "warning" | "info" | "success" | "order";
  href: string;
  unread: boolean;
}

export function NotificationsDropdown() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<LiveNotification[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const loadLiveNotifications = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [ordersRes, invRes] = await Promise.all([
        getOrders(),
        getInventoryStockLevels(),
      ]);

      const items: LiveNotification[] = [];

      // Check low stock products
      if (invRes.success && invRes.data) {
        const lowStock = invRes.data.filter((i) => i.available_stock <= i.reorder_level);
        lowStock.forEach((p) => {
          items.push({
            id: `low-stock-${p.product_id}`,
            title: `Low Stock Alert: ${p.name}`,
            message: `Only ${p.available_stock} units left in central warehouse (reorder limit: ${p.reorder_level}).`,
            time: "Live Status",
            type: "warning",
            href: "/inventory",
            unread: true,
          });
        });
      }

      // Check recent orders & delivery activity
      if (ordersRes.success && ordersRes.data) {
        const recentOrders = ordersRes.data.slice(0, 6);
        recentOrders.forEach((o) => {
          const isDelivered = o.status === "DELIVERED";
          items.push({
            id: `ord-${o.id}`,
            title: isDelivered ? `Order #${o.order_number} Delivered` : `Order #${o.order_number} (${o.status})`,
            message: `${o.customer_name || "Customer"} • ${formatCurrency(o.total_amount)} • Staff: ${o.assigned_staff_name || "Unassigned"}`,
            time: o.created_at ? formatDateTime(o.created_at).split(",")[0] : "Recent",
            type: isDelivered ? "success" : "order",
            href: "/orders",
            unread: !isDelivered,
          });
        });
      }

      setNotifications(items);
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadLiveNotifications();
  }, [loadLiveNotifications]);

  const unreadCount = notifications.filter((n) => n.unread).length;

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) loadLiveNotifications();
        }}
        className="relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-hidden touch-manipulation cursor-pointer border border-border/80"
        aria-label="View system notifications"
        aria-expanded={isOpen}
      >
        <Bell className="h-4.5 w-4.5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white shadow-xs">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-[calc(100vw-1.5rem)] sm:w-96 max-w-sm rounded-2xl border border-border/90 bg-card/95 backdrop-blur-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/40">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground">Live App Activity & Audit</span>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-[10px] py-0 px-1.5 font-bold">
                  {unreadCount} active
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline font-semibold cursor-pointer"
                >
                  Mark read
                </button>
              )}
              <button
                onClick={loadLiveNotifications}
                className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer"
                title="Refresh notifications"
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <div className="max-h-[380px] overflow-y-auto divide-y divide-border/60">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                <CheckCircle2 className="h-7 w-7 text-emerald-500/60 mx-auto mb-2" />
                No active notifications or alerts.
              </div>
            ) : (
              notifications.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`p-3 flex items-start gap-3 hover:bg-muted/40 transition-colors ${
                    item.unread ? "bg-sky-500/5 dark:bg-sky-500/10" : ""
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {item.type === "warning" && (
                      <div className="h-7 w-7 rounded-lg bg-amber-500/15 text-amber-600 flex items-center justify-center">
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                    )}
                    {item.type === "success" && (
                      <div className="h-7 w-7 rounded-lg bg-emerald-500/15 text-emerald-600 flex items-center justify-center">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                    )}
                    {item.type === "order" && (
                      <div className="h-7 w-7 rounded-lg bg-sky-500/15 text-sky-600 flex items-center justify-center">
                        <Truck className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs font-bold text-foreground truncate">
                        {item.title}
                      </p>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {item.time}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                      {item.message}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>

          <div className="p-2 border-t border-border bg-muted/20 text-center">
            <Link
              href="/orders"
              onClick={() => setIsOpen(false)}
              className="text-xs font-bold text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1"
            >
              Go to Orders & Deliveries <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
