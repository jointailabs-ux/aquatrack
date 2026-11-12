"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  Phone,
  Droplets,
  RotateCcw,
  Receipt,
  QrCode,
  Banknote,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Minus,
  XCircle,
  Wrench,
  Info,
  Package,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency } from "@/lib/utils";
import { getOrderForDeliveryStop, executeDeliveryStop } from "@/modules/orders/order.service";
import { OrderItem } from "@/modules/orders/order.schema";

export default function StopDeliveryRecordingPage() {
  const router = useRouter();
  const params = useParams();
  const stopId = params?.stopId as string;
  const { addToast } = useToast();

  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [resolvedOrderId, setResolvedOrderId] = React.useState<string | null>(null);
  const [resolvedStopId, setResolvedStopId] = React.useState<string | null>(null);
  const [isFailedStop, setIsFailedStop] = React.useState(false);
  const [failureReason, setFailureReason] = React.useState("");

  const [customerName, setCustomerName] = React.useState("Customer Account");
  const [address, setAddress] = React.useState("Delivery Location");
  const [phone, setPhone] = React.useState("");
  const [deliveryInstructions, setDeliveryInstructions] = React.useState<string | null>(null);
  const [orderAmount, setOrderAmount] = React.useState(0);
  const [orderNumber, setOrderNumber] = React.useState("");
  const [previousFailure, setPreviousFailure] = React.useState<string | null>(null);

  const [items, setItems] = React.useState<OrderItem[]>([]);
  const [itemQuantities, setItemQuantities] = React.useState<Record<string, number>>({});
  const [fullDropped, setFullDropped] = React.useState(1);
  const [emptyCollected, setEmptyCollected] = React.useState(0);
  const [damagedCollected, setDamagedCollected] = React.useState(0);
  const [paymentMode, setPaymentMode] = React.useState<"cash" | "upi" | "credit">("cash");
  const [paymentAmount, setPaymentAmount] = React.useState("0");
  const [remarks, setRemarks] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    async function loadOrder() {
      if (!stopId) return;
      setIsLoading(true);
      setErrorMessage(null);

      const res = await getOrderForDeliveryStop(stopId);
      if (!res.success || !res.data) {
        setErrorMessage(
          res.error || "Delivery stop or associated order could not be resolved."
        );
        setIsLoading(false);
        return;
      }

      const { order, orderId, stopId: matchedStopId } = res.data;
      setResolvedOrderId(orderId);
      setResolvedStopId(matchedStopId);

      setCustomerName(order.customer_name);
      setAddress(order.delivery_address);
      setPhone(order.customer_phone);
      setOrderAmount(order.total_amount);
      setOrderNumber(order.order_number);
      setDeliveryInstructions(order.delivery_instructions || null);
      setPreviousFailure(order.failure_reason || null);
      setPaymentAmount(order.total_amount.toString());

      const initialItems = order.items || [];
      setItems(initialItems);

      const initialMap: Record<string, number> = {};
      let totalFull = 0;
      initialItems.forEach((it) => {
        initialMap[it.product_id] = it.quantity;
        if (it.is_reusable_jar) {
          totalFull += it.quantity;
        }
      });

      setItemQuantities(initialMap);
      setFullDropped(totalFull || (initialItems[0]?.quantity ?? 1));
      setEmptyCollected(totalFull || (initialItems[0]?.quantity ?? 1));
      setIsLoading(false);
    }
    loadOrder();
  }, [stopId]);

  const handleItemQuantityChange = (productId: string, newQty: number) => {
    const updatedMap = {
      ...itemQuantities,
      [productId]: Math.max(0, newQty),
    };
    setItemQuantities(updatedMap);

    // Recompute total reusable jars dropped
    let totalJars = 0;
    items.forEach((it) => {
      if (it.is_reusable_jar) {
        totalJars += updatedMap[it.product_id] ?? 0;
      }
    });
    if (totalJars > 0) {
      setFullDropped(totalJars);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedOrderId) return;
    setIsSubmitting(true);

    const payloadItems = items.map((it) => ({
      product_id: it.product_id,
      quantity_delivered: isFailedStop ? 0 : (itemQuantities[it.product_id] ?? it.quantity),
    }));

    const totalDelivered = isFailedStop
      ? 0
      : payloadItems.reduce((acc, it) => acc + it.quantity_delivered, 0);

    const res = await executeDeliveryStop({
      order_id: resolvedOrderId,
      stop_id: resolvedStopId || undefined,
      actual_quantity_delivered: totalDelivered,
      empty_jars_collected: isFailedStop ? 0 : emptyCollected,
      damaged_jars_collected: isFailedStop ? 0 : damagedCollected,
      amount_collected:
        isFailedStop || paymentMode === "credit" ? 0 : Number(paymentAmount) || 0,
      payment_method: paymentMode.toUpperCase() as "CASH" | "UPI" | "CREDIT",
      delivery_notes: remarks || null,
      failure_reason: isFailedStop ? failureReason || "Delivery failed" : null,
      items: payloadItems.length > 0 ? payloadItems : null,
    });

    setIsSubmitting(false);

    if (res.success) {
      if (isFailedStop) {
        addToast({
          type: "error",
          title: "Stop Marked Failed",
          message: `Recorded undelivered stop: ${failureReason || "Customer unavailable"}`,
        });
      } else {
        addToast({
          type: "success",
          title: "Delivery Stop Completed!",
          message: `Recorded ${fullDropped} full dropped, ${emptyCollected} empty collected, ₹${paymentAmount} payment.`,
        });
      }
      router.push("/driver");
    } else {
      addToast({
        type: "error",
        title: "Execution Error",
        message: res.error || "Failed to update delivery stop in database.",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-slate-400">
        <p className="text-xs">Loading delivery details...</p>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center space-y-4 max-w-lg mx-auto my-8">
        <AlertTriangle className="h-10 w-10 text-rose-500 mx-auto" />
        <div>
          <h3 className="text-base font-bold text-white">Stop Identification Error</h3>
          <p className="text-xs text-rose-200 mt-1">{errorMessage}</p>
        </div>
        <Link href="/driver">
          <Button variant="outline" size="sm" className="gap-2 text-xs border-slate-700 text-slate-200">
            <ArrowLeft className="h-4 w-4" />
            Return to Route Manifest
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Top back navigation */}
      <div className="flex items-center gap-2.5">
        <Link
          href="/driver"
          className="flex h-10 w-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:text-white touch-manipulation shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-white flex items-center gap-2 truncate">
            Record Delivery Stop
            <span className="font-mono text-xs text-blue-400">({orderNumber})</span>
          </h2>
          <p className="text-[10px] text-slate-400 truncate">{customerName}</p>
        </div>
      </div>

      {/* Previous Failure Alert (for Retrying) */}
      {previousFailure && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Previous Attempt Failed:</span> {previousFailure}
            <p className="text-[11px] text-amber-200 mt-0.5">
              You are re-executing this stop. Submitting will complete the delivery and create an updated stop record.
            </p>
          </div>
        </div>
      )}

      {/* Customer Info Card */}
      <div className="rounded-2xl bg-slate-800 border border-slate-700 p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Badge variant="outline" className="border-blue-500/40 text-blue-300 text-[10px] mb-1">
              Customer Account
            </Badge>
            <h3 className="text-base font-bold text-white truncate">{customerName}</h3>
          </div>
          {phone && (
            <a
              href={`tel:${phone}`}
              className="flex h-10 w-10 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs hover:bg-blue-500 touch-manipulation shrink-0"
              title="Call customer"
              aria-label="Call customer"
            >
              <Phone className="h-5 w-5" />
            </a>
          )}
        </div>

        <p className="text-xs text-slate-300 flex items-start gap-1.5 leading-relaxed">
          <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
          {address}
        </p>

        {deliveryInstructions && (
          <div className="mt-2 flex items-start gap-2 rounded-xl bg-slate-900/90 border border-slate-700/80 p-2.5 text-xs text-slate-200">
            <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-blue-300">Delivery Instructions:</span>{" "}
              {deliveryInstructions}
            </div>
          </div>
        )}
      </div>

      {/* Delivery Mode Toggle (Success vs Failed) */}
      <div className="flex rounded-xl bg-slate-900 p-1 border border-slate-700">
        <button
          type="button"
          onClick={() => setIsFailedStop(false)}
          className={`flex-1 min-h-[44px] py-2.5 text-xs font-bold rounded-lg transition-all touch-manipulation ${
            !isFailedStop
              ? "bg-emerald-600 text-white shadow-xs"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Successful Delivery
        </button>
        <button
          type="button"
          onClick={() => setIsFailedStop(true)}
          className={`flex-1 min-h-[44px] py-2.5 text-xs font-bold rounded-lg transition-all touch-manipulation ${
            isFailedStop
              ? "bg-rose-600 text-white shadow-xs"
              : "text-slate-400 hover:text-white"
          }`}
        >
          Failed / Undelivered Stop
        </button>
      </div>

      {/* Delivery Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {isFailedStop ? (
          <div className="rounded-2xl bg-slate-800 border border-rose-500/30 p-4 space-y-3">
            <span className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
              <XCircle className="h-4 w-4" />
              Failed Delivery Reason
            </span>
            <div className="space-y-2">
              {[
                "Customer unavailable / Gate locked",
                "Customer requested reschedule",
                "Wrong address / relocated",
                "Payment disputed / refused",
                "Vehicle breakdown / route delayed",
              ].map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setFailureReason(reason)}
                  className={`w-full text-left p-2.5 rounded-xl text-xs font-medium border transition-all ${
                    failureReason === reason
                      ? "bg-rose-500/20 border-rose-500 text-white"
                      : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {reason}
                </button>
              ))}
              <Input
                placeholder="Or specify custom reason..."
                value={failureReason}
                onChange={(e) => setFailureReason(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white text-xs mt-2"
                required
              />
            </div>
          </div>
        ) : (
          <>
            {/* Multi-Product Delivery Steppers */}
            <div className="rounded-2xl bg-slate-800 border border-slate-700 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Package className="h-4 w-4 text-blue-400" /> Products to Deliver
                </span>
                <span className="text-xs text-slate-400">{items.length} item(s)</span>
              </div>

              {items.map((it) => {
                const qty = itemQuantities[it.product_id] ?? it.quantity;
                return (
                  <div
                    key={it.product_id}
                    className="flex items-center justify-between rounded-xl bg-slate-900/90 p-3 border border-slate-700"
                  >
                    <div>
                      <p className="text-xs font-bold text-white">{it.product_name}</p>
                      <p className="text-[10px] text-slate-400">
                        Ordered: {it.quantity} {it.is_reusable_jar ? "(Reusable 20L Jar)" : ""}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleItemQuantityChange(it.product_id, qty - 1)}
                        className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 active:scale-95 touch-manipulation transition-all"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-10 text-center font-bold text-base text-white">
                        {qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleItemQuantityChange(it.product_id, qty + 1)}
                        className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 active:scale-95 touch-manipulation transition-all"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Strict Invariant Card: Independent Full Drop vs Empty Collected vs Damaged */}
            <div className="rounded-2xl bg-slate-800 border border-slate-700 p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Jar Custody Reconciliation
                </span>
                <Badge variant="outline" className="text-[9px] border-slate-600 text-slate-300">
                  Strict Dual Count
                </Badge>
              </div>

              {/* Stepper 1: Full Dropped */}
              <div className="flex items-center justify-between rounded-xl bg-slate-900/90 p-3 border border-slate-700">
                <div className="space-y-0.5 min-w-0 pr-2">
                  <span className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                    <Droplets className="h-4 w-4 shrink-0" />
                    Actual Full Jars Delivered
                  </span>
                  <p className="text-[10px] text-slate-400">Standard 20L Purified Water</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setFullDropped(Math.max(0, fullDropped - 1))}
                    className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 active:scale-95 touch-manipulation transition-all"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-10 text-center font-bold text-base text-white">
                    {fullDropped}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFullDropped(fullDropped + 1)}
                    className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 active:scale-95 touch-manipulation transition-all"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Stepper 2: Empty Clean/Dirty Collected */}
              <div className="flex items-center justify-between rounded-xl bg-slate-900/90 p-3 border border-slate-700">
                <div className="space-y-0.5 min-w-0 pr-2">
                  <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <RotateCcw className="h-4 w-4 shrink-0" />
                    Empty Jars Collected
                  </span>
                  <p className="text-[10px] text-slate-400">Reusable empties returned</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEmptyCollected(Math.max(0, emptyCollected - 1))}
                    className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 active:scale-95 touch-manipulation transition-all"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-10 text-center font-bold text-base text-white">
                    {emptyCollected}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEmptyCollected(emptyCollected + 1)}
                    className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 active:scale-95 touch-manipulation transition-all"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Stepper 3: Damaged Jars Collected */}
              <div className="flex items-center justify-between rounded-xl bg-slate-900/90 p-3 border border-slate-700">
                <div className="space-y-0.5 min-w-0 pr-2">
                  <span className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                    <Wrench className="h-4 w-4 shrink-0" />
                    Damaged Jars Collected
                  </span>
                  <p className="text-[10px] text-slate-400">Cracked, leaking, repairable/scrap</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setDamagedCollected(Math.max(0, damagedCollected - 1))}
                    className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 active:scale-95 touch-manipulation transition-all"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-10 text-center font-bold text-base text-white">
                    {damagedCollected}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDamagedCollected(damagedCollected + 1)}
                    className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-800 text-white border border-slate-700 hover:bg-slate-700 active:scale-95 touch-manipulation transition-all"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {fullDropped !== emptyCollected + damagedCollected && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-[11px] text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Custody balance delta:{" "}
                    {fullDropped - (emptyCollected + damagedCollected) > 0
                      ? `+${fullDropped - (emptyCollected + damagedCollected)} jars added to customer holding`
                      : `${Math.abs(fullDropped - (emptyCollected + damagedCollected))} jars returned from customer`}
                    .
                  </span>
                </div>
              )}
            </div>

            {/* Payment Collection Card */}
            <div className="rounded-2xl bg-slate-800 border border-slate-700 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Payment Collection
                </span>
                <span className="text-sm font-bold text-emerald-400">
                  Order Total: {formatCurrency(orderAmount)}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "cash", label: "Cash", icon: Banknote },
                  { id: "upi", label: "UPI QR", icon: QrCode },
                  { id: "credit", label: "Credit", icon: Receipt },
                ].map((mode) => {
                  const Icon = mode.icon;
                  const isSelected = paymentMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setPaymentMode(mode.id as "cash" | "upi" | "credit")}
                      className={`flex flex-col items-center justify-center rounded-xl min-h-[52px] p-2.5 text-xs font-bold transition-all touch-manipulation active:scale-95 ${
                        isSelected
                          ? "bg-blue-600 text-white shadow-xs ring-2 ring-blue-400"
                          : "bg-slate-900/80 text-slate-400 border border-slate-700 hover:bg-slate-700"
                      }`}
                    >
                      <Icon className="h-4 w-4 mb-1" />
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>

              {paymentMode === "cash" && (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-300">
                    Cash Received Amount (₹)
                  </label>
                  <Input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="bg-slate-900 border-slate-700 text-white font-bold"
                    required
                  />
                </div>
              )}

              {paymentMode === "upi" && (
                <div className="space-y-2">
                  <div className="rounded-xl bg-slate-900/90 border border-slate-700 p-3 text-center space-y-2">
                    <p className="text-xs font-semibold text-slate-200">
                      Customer Scans Vehicle UPI QR
                    </p>
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-lg bg-white p-2">
                      <QrCode className="h-16 w-16 text-slate-900" />
                    </div>
                    <p className="text-[10px] text-slate-400">
                      UPI ID: aquatrack.fleet01@upi
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-300">
                      UPI Amount Received (₹)
                    </label>
                    <Input
                      type="number"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      className="bg-slate-900 border-slate-700 text-white font-bold"
                      required
                    />
                  </div>
                </div>
              )}

              {paymentMode === "credit" && (
                <div className="rounded-xl bg-slate-900/90 border border-slate-700 p-3 text-xs text-slate-300">
                  <span className="font-semibold text-white">Monthly Invoice Credit:</span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Amount ({formatCurrency(orderAmount)}) posted to customer unpaid account balance. No immediate cash collected.
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Remarks Input */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-300">
            Delivery Notes / Customer Feedback
          </label>
          <Input
            placeholder="e.g. Handed to security guard, gate pass signed"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="bg-slate-900 border-slate-700 text-white text-xs"
          />
        </div>

        {/* Action Button */}
        <Button
          type="submit"
          className={`w-full min-h-[50px] h-12 font-bold text-base shadow-lg gap-2 text-white touch-manipulation ${
            isFailedStop
              ? "bg-rose-600 hover:bg-rose-500"
              : "bg-emerald-600 hover:bg-emerald-500"
          }`}
          disabled={isSubmitting}
        >
          <CheckCircle2 className="h-5 w-5" />
          {isSubmitting
            ? "Submitting Stop Update..."
            : isFailedStop
            ? "Record Failed Stop"
            : "Complete Delivery & Save"}
        </Button>
      </form>
    </div>
  );
}
