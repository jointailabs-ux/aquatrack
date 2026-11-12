"use client";

import * as React from "react";
import { Bell, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  type: "warning" | "info" | "success";
  unread: boolean;
}

const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "notif-1",
    title: "Low Stock Alert: Main Warehouse",
    message: "20L Full Jars fell below minimum threshold (180 remaining, min is 250).",
    time: "10 mins ago",
    type: "warning",
    unread: true,
  },
  {
    id: "notif-2",
    title: "Trip #TRP-104 Reconciliation Pending",
    message: "Driver John Doe submitted evening cash float with 1 empty jar discrepancy.",
    time: "45 mins ago",
    type: "warning",
    unread: true,
  },
  {
    id: "notif-3",
    title: "Overdue Invoice: Royal Orchid B2B",
    message: "Invoice #INV-2025-089 (₹14,500) exceeded 30-day payment term.",
    time: "2 hours ago",
    type: "info",
    unread: false,
  },
  {
    id: "notif-4",
    title: "Purchase Order #PO-88 Delivered",
    message: "Supplier PureSpring delivered 300 preforms. GRN generated.",
    time: "Yesterday",
    type: "success",
    unread: false,
  },
];

export function NotificationsDropdown() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState(INITIAL_NOTIFICATIONS);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

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
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex h-10 w-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring touch-manipulation"
        aria-label="View system notifications"
        aria-expanded={isOpen}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute top-2 right-2 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-80 md:w-96 max-w-sm rounded-xl border border-border bg-card shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">Notifications</span>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
                  {unreadCount} new
                </Badge>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-[11px] text-primary hover:underline font-medium"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto divide-y divide-border/60">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No notifications to display
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  className={`p-3.5 flex items-start gap-3 hover:bg-accent/40 transition-colors ${
                    item.unread ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {item.type === "warning" && (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                    {item.type === "info" && (
                      <Clock className="h-4 w-4 text-blue-500" />
                    )}
                    {item.type === "success" && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-foreground leading-snug">
                        {item.title}
                      </p>
                      {item.unread && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {item.message}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70">{item.time}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-2 border-t border-border bg-muted/20 text-center">
            <span className="text-[10px] text-muted-foreground">
              Mock Operational Alerts (Phase 3 Foundation)
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
