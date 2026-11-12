"use client";

import * as React from "react";
import Link from "next/link";
import {
  MapPin,
  Phone,
  PackageCheck,
  PackageX,
  ArrowRight,
  Truck,
  RotateCcw,
  Play,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { getStaffAssignedDeliveries } from "@/modules/orders/order.service";
import { startDriverTrip } from "@/modules/delivery/delivery.service";
import { OrderRecord } from "@/modules/orders/order.schema";
import { formatCurrency } from "@/lib/utils";

interface Stop {
  id: string;
  sequence: number;
  customerName: string;
  address: string;
  phone: string;
  deliveryInstructions?: string | null;
  failureReason?: string | null;
  itemsSummary: string;
  jarsToDeliver: number;
  expectedEmpty: number;
  orderAmount: number;
  status: "completed" | "in_progress" | "assigned" | "failed";
}

export default function DriverDashboardPage() {
  const { addToast } = useToast();
  const [stops, setStops] = React.useState<Stop[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isStartingTrip, setIsStartingTrip] = React.useState(false);

  const loadRoute = React.useCallback(async () => {
    setIsLoading(true);
    const res = await getStaffAssignedDeliveries();
    if (res.success && res.data) {
      let firstPendingFound = false;
      const mapped: Stop[] = res.data.map((ord: OrderRecord, index: number) => {
        let status: "completed" | "in_progress" | "assigned" | "failed" = "assigned";

        if (ord.status === "DELIVERED") {
          status = "completed";
        } else if (ord.failure_reason) {
          status = "failed";
        } else if (ord.status === "OUT_FOR_DELIVERY" || !firstPendingFound) {
          status = "in_progress";
          firstPendingFound = true;
        }

        const jarsCount = (ord.items || []).reduce(
          (sum, item) => sum + (item.is_reusable_jar ? item.quantity : 0),
          0
        );

        const itemsStr = (ord.items || [])
          .map((i) => `${i.product_name} x${i.quantity}`)
          .join(", ");

        return {
          id: ord.stop_id || ord.id,
          sequence: index + 1,
          customerName: ord.customer_name,
          address: ord.delivery_address,
          phone: ord.customer_phone,
          deliveryInstructions: ord.delivery_instructions || null,
          failureReason: ord.failure_reason || null,
          itemsSummary: itemsStr,
          jarsToDeliver: jarsCount || ord.items?.[0]?.quantity || 1,
          expectedEmpty: jarsCount || 1,
          orderAmount: ord.total_amount,
          status,
        };
      });
      setStops(mapped);
    }
    setIsLoading(false);
  }, []);

  React.useEffect(() => {
    loadRoute();
  }, [loadRoute]);

  const handleStartTrip = async () => {
    setIsStartingTrip(true);
    const res = await startDriverTrip();
    setIsStartingTrip(false);

    if (res.success) {
      addToast({
        type: "success",
        title: "Route Dispatched",
        message: `${res.data?.count || 0} stop(s) marked Out For Delivery. Have a safe drive!`,
      });
      loadRoute();
    } else {
      addToast({
        type: "error",
        title: "Error Starting Route",
        message: res.error || "Failed to update trip status.",
      });
    }
  };

  const completedCount = stops.filter((s) => s.status === "completed").length;
  const failedCount = stops.filter((s) => s.status === "failed").length;
  const progressPercent =
    stops.length > 0 ? Math.round((completedCount / stops.length) * 100) : 0;

  const totalRemainingFull = stops
    .filter((s) => s.status !== "completed")
    .reduce((sum, s) => sum + s.jarsToDeliver, 0);

  const totalCollectedEmpty = stops
    .filter((s) => s.status === "completed")
    .reduce((sum, s) => sum + s.expectedEmpty, 0);

  const canStartRun = stops.some((s) => s.status === "assigned");

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Trip & Vehicle Inventory Card */}
      <div className="rounded-2xl bg-slate-800 border border-slate-700 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Assigned Route Run
            </span>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Today&apos;s Route Manifest
              <Badge
                variant={stops.length > 0 ? "success" : "secondary"}
                className="text-[9px] py-0"
              >
                {stops.length > 0 ? "Active Route" : "Idle"}
              </Badge>
            </h2>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400">Progress</span>
            <p className="text-sm font-bold text-white">
              {completedCount} / {stops.length} Stops ({progressPercent}%)
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden">
          <div
            className="bg-blue-500 h-full rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Dual Truck Stock Summary */}
        <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
          <div className="rounded-xl bg-slate-900/80 p-2.5 border border-slate-700/60 flex items-center gap-2.5">
            <PackageCheck className="h-5 w-5 text-blue-400 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-400">Full Jars Pending Drop</p>
              <p className="text-sm font-bold text-white">{totalRemainingFull} Jars</p>
            </div>
          </div>

          <div className="rounded-xl bg-slate-900/80 p-2.5 border border-slate-700/60 flex items-center gap-2.5">
            <PackageX className="h-5 w-5 text-amber-400 shrink-0" />
            <div>
              <p className="text-[10px] text-slate-400">Empty Jars Collected</p>
              <p className="text-sm font-bold text-white">{totalCollectedEmpty} Jars on Board</p>
            </div>
          </div>
        </div>

        {/* Start Delivery Run Action */}
        {canStartRun && (
          <Button
            onClick={handleStartTrip}
            disabled={isStartingTrip}
            className="w-full min-h-[46px] h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm gap-2 shadow-md mt-1 touch-manipulation"
          >
            <Play className="h-4 w-4" />
            {isStartingTrip ? "Starting Delivery Run..." : "Start Route Run (Mark Out For Delivery)"}
          </Button>
        )}
      </div>

      {/* Stop Manifest Header */}
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
          Delivery Stops Manifest
        </h3>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          {failedCount > 0 && (
            <span className="text-rose-400 font-semibold">{failedCount} Failed</span>
          )}
          <span>Sorted by Sequence</span>
        </div>
      </div>

      {/* Stops List */}
      {isLoading ? (
        <div className="p-8 text-center text-xs text-slate-400">
          Loading assigned stops from database...
        </div>
      ) : stops.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-8 text-center space-y-2">
          <Truck className="h-8 w-8 text-slate-500 mx-auto" />
          <h4 className="text-sm font-bold text-white">No Assigned Deliveries</h4>
          <p className="text-xs text-slate-400 max-w-xs mx-auto">
            You currently have no delivery stops assigned for today&apos;s route. Central dispatch will assign orders.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {stops.map((stop) => (
            <div
              key={stop.id}
              className={`rounded-2xl border p-3.5 transition-all ${
                stop.status === "in_progress"
                  ? "bg-blue-950/40 border-blue-500/50 ring-1 ring-blue-500/30"
                  : stop.status === "completed"
                  ? "bg-slate-800/40 border-slate-800 opacity-75"
                  : stop.status === "failed"
                  ? "bg-rose-950/30 border-rose-500/40"
                  : "bg-slate-800/80 border-slate-700"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      stop.status === "completed"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : stop.status === "failed"
                        ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                        : stop.status === "in_progress"
                        ? "bg-blue-500 text-white animate-pulse"
                        : "bg-slate-700 text-slate-300"
                    }`}
                  >
                    {stop.sequence}
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="text-sm font-bold text-white leading-tight">
                        {stop.customerName}
                      </h4>
                      {stop.status === "completed" && (
                        <Badge variant="success" className="text-[9px] py-0 px-1">
                          Delivered
                        </Badge>
                      )}
                      {stop.status === "failed" && (
                        <Badge variant="destructive" className="text-[9px] py-0 px-1">
                          Failed
                        </Badge>
                      )}
                      {stop.status === "in_progress" && (
                        <Badge variant="primary" className="text-[9px] py-0 px-1 bg-blue-600">
                          Next Stop
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 flex items-start gap-1 mt-1 leading-snug">
                      <MapPin className="h-3 w-3 shrink-0 text-slate-500 mt-0.5" />
                      {stop.address}
                    </p>
                    {stop.deliveryInstructions && (
                      <p className="text-[10px] text-blue-300 flex items-center gap-1 mt-1 font-medium">
                        <Info className="h-3 w-3 shrink-0" />
                        {stop.deliveryInstructions}
                      </p>
                    )}
                    {stop.failureReason && (
                      <p className="text-[10px] text-rose-300 flex items-center gap-1 mt-1">
                        <AlertTriangle className="h-3 w-3 shrink-0 text-rose-400" />
                        Reason: {stop.failureReason}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-500 mt-1">
                      Items: {stop.itemsSummary || `${stop.jarsToDeliver} Jars`}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-xs font-bold text-white">{formatCurrency(stop.orderAmount)}</span>
                  <p className="text-[10px] text-slate-400">{stop.jarsToDeliver} Jars</p>
                </div>
              </div>

              {/* In Progress & Pending Actions */}
              {(stop.status === "in_progress" || stop.status === "assigned") && (
                <div className="mt-3 pt-3 border-t border-slate-700/60 flex items-center justify-between gap-2.5">
                  {stop.phone && (
                    <a
                      href={`tel:${stop.phone}`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-3.5 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 active:bg-slate-600 transition-colors touch-manipulation"
                    >
                      <Phone className="h-4 w-4 text-blue-400" />
                      <span>Call</span>
                    </a>
                  )}

                  <Link href={`/driver/stops/${stop.id}`} className="flex-1">
                    <Button className="w-full min-h-[44px] h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs sm:text-sm gap-2 shadow-md touch-manipulation">
                      <span>Record Delivery</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              )}

              {/* Failed Stop Retry Action */}
              {stop.status === "failed" && (
                <div className="mt-3 pt-3 border-t border-rose-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-[11px] text-rose-400">Order uncancelled & ready for retry</span>
                  <Link href={`/driver/stops/${stop.id}`}>
                    <Button size="sm" variant="outline" className="min-h-[40px] h-10 text-xs gap-1.5 border-rose-500/40 text-rose-300 hover:bg-rose-500/10 touch-manipulation">
                      <RotateCcw className="h-3.5 w-3.5" />
                      Retry Stop
                    </Button>
                  </Link>
                </div>
              )}

              {/* Completed Stop Info */}
              {stop.status === "completed" && (
                <div className="mt-2 text-right">
                  <span className="text-[10px] text-emerald-400 flex items-center justify-end gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Successfully Delivered & Reconciled
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
