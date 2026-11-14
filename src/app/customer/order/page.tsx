"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Droplets,
  Clock,
  CreditCard,
  MapPin,
  AlertCircle,
  Plus,
  Minus,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { createOrder } from "@/modules/orders/order.service";
import { getCustomers } from "@/modules/customers/customer.service";
import { getProducts } from "@/modules/products/product.service";
import { CustomerRecord } from "@/modules/customers/customer.schema";
import { ProductRecord } from "@/modules/products/product.schema";
import { formatCurrency } from "@/lib/utils";

const PRICE_PER_JAR = 70; // 20L Purified Drinking Water
const GST_RATE = 0.05; // 5% GST on packaged 20L water
const DEPOSIT_PER_NEW_JAR = 150; // Refundable deposit if ordering more full than returning empty

export default function PlaceOrderPage() {
  const router = useRouter();
  const { addToast } = useToast();

  const [customer, setCustomer] = React.useState<CustomerRecord | null>(null);
  const [products, setProducts] = React.useState<ProductRecord[]>([]);
  const [fullJarsQty, setFullJarsQty] = React.useState(2);
  const [emptyJarsReturn, setEmptyJarsReturn] = React.useState(2);
  const [deliverySlot, setDeliverySlot] = React.useState("morning");
  const deliveryDate = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }, []);
  const [paymentMethod, setPaymentMethod] = React.useState<"cod" | "upi">("cod");
  const [deliveryNotes, setDeliveryNotes] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  React.useEffect(() => {
    async function init() {
      const [custRes, prodRes] = await Promise.all([
        getCustomers({ pageSize: 5 }),
        getProducts({ isActive: true, pageSize: 20 }),
      ]);
      if (custRes.success && custRes.data && custRes.data.items.length > 0) {
        setCustomer(custRes.data.items[0]);
      }
      if (prodRes.success && prodRes.data && prodRes.data.items.length > 0) {
        setProducts(prodRes.data.items);
      }
    }
    init();
  }, []);

  // Financial calculation:
  // If customer orders more full jars than returning empty jars, extra jar deposit applies
  const extraJarsNeeded = Math.max(0, fullJarsQty - emptyJarsReturn);
  const waterSubtotal = fullJarsQty * PRICE_PER_JAR;
  const waterTax = Math.round(waterSubtotal * GST_RATE);
  const extraDeposit = extraJarsNeeded * DEPOSIT_PER_NEW_JAR;
  const orderTotal = waterSubtotal + waterTax + extraDeposit;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) {
      addToast({
        type: "error",
        title: "Customer Account Required",
        message: "No active customer account found to place order.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const jarProduct = products.find((p) => p.is_reusable_jar) || products[0];
      const prodId = jarProduct ? jarProduct.id : "af80a85e-ec3a-42f9-8eb6-609edbb5dc4b";
      const prodName = jarProduct ? jarProduct.name : "20L Polycarbonate Water Jar Refill";

      const res = await createOrder({
        customer_id: customer.id,
        order_date: new Date().toISOString().split("T")[0],
        delivery_address: customer.address || "Doorstep Delivery Address",
        delivery_date: deliveryDate,
        notes: `Slot: ${deliverySlot}. Empty return expected: ${emptyJarsReturn}. ${deliveryNotes}`.trim(),
        items: [
          {
            product_id: prodId,
            product_name: prodName,
            quantity: fullJarsQty,
            unit_price: PRICE_PER_JAR,
            gst_rate: 5,
            tax_amount: waterTax,
            total_amount: waterSubtotal + waterTax,
            is_reusable_jar: true,
          },
        ],
      });

      if (!res.success) {
        throw new Error(res.error || "Failed to place order.");
      }

      addToast({
        type: "success",
        title: "Order Placed Successfully!",
        message: `Your refill request for ${fullJarsQty} jars has been scheduled for delivery!`,
      });
      router.push("/customer/orders");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to place refill order.";
      addToast({
        type: "error",
        title: "Order Failed",
        message: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Order Water Refill"
        description="Schedule a doorstep delivery of 20-litre purified drinking water jars."
      />

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left 2 Cols: Order Configuration */}
        <div className="md:col-span-2 space-y-6">
          {/* Card 1: Water Jars & Empty Returns */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Droplets className="h-4 w-4 text-primary" />
                Select Refill Quantity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Full Jars Stepper */}
              <div className="flex items-center justify-between rounded-xl border border-border p-4">
                <div>
                  <h4 className="text-sm font-bold text-foreground">
                    20L Purified Water Refill
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    ₹70 per jar (inclusive of 5% GST snapshot)
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setFullJarsQty(Math.max(1, fullJarsQty - 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-accent transition-colors"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-8 text-center font-bold text-base text-foreground">
                    {fullJarsQty}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFullJarsQty(fullJarsQty + 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-accent transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Empty Jars to Return Stepper */}
              <div className="flex items-center justify-between rounded-xl border border-border p-4 bg-muted/20">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-foreground">
                      Empty Jars for Return
                    </h4>
                    <Badge variant="outline" className="text-[10px]">
                      Asset Custody
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Empty jars to hand over to driver (you currently hold 3 jars)
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEmptyJarsReturn(Math.max(0, emptyJarsReturn - 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-accent transition-colors"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-8 text-center font-bold text-base text-foreground">
                    {emptyJarsReturn}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEmptyJarsReturn(Math.min(3, emptyJarsReturn + 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground hover:bg-accent transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {extraJarsNeeded > 0 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Deposit Notice:</strong> You are requesting {fullJarsQty} full jars but returning {emptyJarsReturn} empty. A refundable deposit of ₹{extraDeposit} (₹150 × {extraJarsNeeded}) will be added to your account.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 2: Delivery Slot & Instructions */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Delivery Preferences
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-xs font-medium text-foreground block mb-2">
                  Delivery Time Window
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: "morning", label: "Morning", time: "8 AM - 12 PM" },
                    { id: "afternoon", label: "Afternoon", time: "12 PM - 4 PM" },
                    { id: "evening", label: "Evening", time: "4 PM - 8 PM" },
                  ].map((slot) => (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => setDeliverySlot(slot.id)}
                      className={`rounded-xl border p-3 text-left transition-all ${
                        deliverySlot === slot.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <p className="text-xs font-bold text-foreground">{slot.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{slot.time}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-foreground block mb-1">
                  Delivery Instructions (Optional)
                </label>
                <Input
                  placeholder="e.g. Leave at door if no response, ring bell twice"
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Payment Method */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                Payment Mode
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("cod")}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    paymentMethod === "cod"
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <p className="text-xs font-bold text-foreground">Pay on Delivery</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Pay Cash or Scan Driver UPI QR Code at doorstep
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("upi")}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    paymentMethod === "upi"
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-muted/40"
                  }`}
                >
                  <p className="text-xs font-bold text-foreground">Online UPI Payment</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Instant payment via GPay, PhonePe, Paytm
                  </p>
                </button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right 1 Col: Order Summary & Place Button */}
        <div className="space-y-6">
          <Card className="sticky top-20 border-primary/20 shadow-md">
            <CardHeader className="border-b border-border pb-3 bg-muted/20">
              <CardTitle className="text-sm font-bold">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    20L Water ({fullJarsQty} × ₹{PRICE_PER_JAR})
                  </span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(waterSubtotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">GST (5% HSN 2201)</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(waterTax)}
                  </span>
                </div>
                {extraDeposit > 0 && (
                  <div className="flex justify-between text-amber-700 dark:text-amber-300">
                    <span>Refundable Jar Deposit ({extraJarsNeeded} jar)</span>
                    <span className="font-medium">{formatCurrency(extraDeposit)}</span>
                  </div>
                )}
                <div className="border-t border-border pt-2 flex justify-between font-bold text-sm text-foreground">
                  <span>Grand Total</span>
                  <span className="text-primary text-base">
                    {formatCurrency(orderTotal)}
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-muted/40 p-3 text-[11px] space-y-1.5 border border-border">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>Delivering To</span>
                </div>
                <p className="text-muted-foreground pl-5 leading-snug">
                  Flat 402, Sai Nilaya Apts, Indiranagar, Bengaluru
                </p>
              </div>

              <Button
                type="submit"
                className="w-full h-11 text-sm font-bold shadow-md"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting Refill Request..." : "Confirm & Place Order"}
              </Button>

              <p className="text-[10px] text-center text-muted-foreground">
                Zero cancellation fee prior to truck dispatch.
              </p>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}
