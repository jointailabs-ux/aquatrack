"use client";

import * as React from "react";
import {
  ShoppingCart,
  Search,
  Plus,
  Minus,
  Trash2,
  QrCode,
  Banknote,
  Receipt,
  CheckCircle2,
  Percent,
  Printer,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { PosCartItem, PosSaleRecord } from "@/modules/pos/pos.schema";
import { completePosSale } from "@/modules/pos/pos.service";
import { getProducts } from "@/modules/products/product.service";
import { getCustomers } from "@/modules/customers/customer.service";
import { getCustomerSpecialPrices } from "@/modules/pricing/special-price.service";
import { CustomerRecord } from "@/modules/customers/customer.schema";
import { getInventoryStockLevels } from "@/modules/inventory/inventory.service";
import { formatCurrency } from "@/lib/utils";

interface SellableItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  gstRate: number;
  stock: number;
  isReusableJar: boolean;
}

export default function PosPage() {
  const { addToast } = useToast();
  const [catalogItems, setCatalogItems] = React.useState<SellableItem[]>([]);
  const [cart, setCart] = React.useState<PosCartItem[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState<string>("ALL");
  const [customerName, setCustomerName] = React.useState("Walk-in Customer");
  const [customers, setCustomers] = React.useState<CustomerRecord[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = React.useState<string>("");
  const [customerSpecialPrices, setCustomerSpecialPrices] = React.useState<Record<string, number>>({});
  const [paymentMode, setPaymentMode] = React.useState<"CASH" | "UPI" | "CARD">("UPI");
  const [tenderedAmount, setTenderedAmount] = React.useState<string>("");
  const [discountPercent, setDiscountPercent] = React.useState<number>(0);
  const [lastReceipt, setLastReceipt] = React.useState<PosSaleRecord | null>(null);

  React.useEffect(() => {
    async function loadCatalog() {
      const [prodRes, invRes, custRes] = await Promise.all([
        getProducts({ pageSize: 100 }),
        getInventoryStockLevels(),
        getCustomers({ pageSize: 150 }),
      ]);

      const stockMap = new Map<string, number>();
      if (invRes.success && invRes.data) {
        invRes.data.forEach((inv) => stockMap.set(inv.product_id, inv.available_stock));
      }

      if (prodRes.success && prodRes.data?.items) {
        const sellable: SellableItem[] = prodRes.data.items.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          price: Number(p.default_sale_price),
          gstRate: Number(p.gst_rate),
          stock: stockMap.get(p.id) || 0,
          isReusableJar: p.is_reusable_jar,
        }));
        setCatalogItems(sellable);
      }

      if (custRes.success && custRes.data) {
        setCustomers(custRes.data.items);
      }
    }
    loadCatalog();
  }, []);

  const handleCustomerChange = async (customerId: string) => {
    setSelectedCustomerId(customerId);
    if (customerId) {
      const cust = customers.find((c) => c.id === customerId);
      if (cust) {
        setCustomerName(cust.contact_name + (cust.business_name ? ` (${cust.business_name})` : ""));
      }
      const priceRes = await getCustomerSpecialPrices(customerId);
      const specMap: Record<string, number> = {};
      if (priceRes.success && Array.isArray(priceRes.data)) {
        priceRes.data.forEach((p) => {
          specMap[p.product_id] = Number(p.special_price);
        });
      }
      setCustomerSpecialPrices(specMap);

      // Re-evaluate prices in cart with special contract pricing
      setCart((prev) =>
        prev.map((item) => {
          const specPrice = specMap[item.product_id];
          const catItem = catalogItems.find((p) => p.id === item.product_id);
          const effectivePrice =
            specPrice !== undefined ? specPrice : catItem ? catItem.price : item.unit_price;
          return {
            ...item,
            unit_price: effectivePrice,
            total: item.quantity * effectivePrice,
          };
        })
      );
    } else {
      setCustomerName("Walk-in Customer");
      setCustomerSpecialPrices({});
      // Revert cart items to standard catalog price
      setCart((prev) =>
        prev.map((item) => {
          const catItem = catalogItems.find((p) => p.id === item.product_id);
          const effectivePrice = catItem ? catItem.price : item.unit_price;
          return {
            ...item,
            unit_price: effectivePrice,
            total: item.quantity * effectivePrice,
          };
        })
      );
    }
  };

  const addToCart = (product: SellableItem) => {
    const specPrice = customerSpecialPrices[product.id];
    const effectivePrice = specPrice !== undefined ? specPrice : product.price;

    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id
            ? {
                ...i,
                unit_price: effectivePrice,
                quantity: i.quantity + 1,
                total: (i.quantity + 1) * effectivePrice,
              }
            : i
        );
      }

      const taxAmount = (effectivePrice * product.gstRate) / (100 + product.gstRate);

      const newItem: PosCartItem = {
        product_id: product.id,
        product_sku: product.sku,
        product_name: product.name,
        unit_price: effectivePrice,
        quantity: 1,
        discount_percent: 0,
        discount_amount: 0,
        gst_rate: product.gstRate,
        tax_amount: taxAmount,
        total: effectivePrice,
        is_reusable_jar: product.isReusableJar,
      };
      return [...prev, newItem];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product_id === productId) {
            const newQty = item.quantity + delta;
            if (newQty <= 0) return null;
            return {
              ...item,
              quantity: newQty,
              total: newQty * item.unit_price,
            };
          }
          return item;
        })
        .filter(Boolean) as PosCartItem[]
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((i) => i.product_id !== productId));
  };

  // Totals calculations
  const grossSubtotal = cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const catalogGrossSubtotal = cart.reduce((sum, item) => {
    const catItem = catalogItems.find((p) => p.id === item.product_id);
    return sum + (catItem ? catItem.price : item.unit_price) * item.quantity;
  }, 0);
  const contractSavings = Math.max(0, Math.round((catalogGrossSubtotal - grossSubtotal) * 100) / 100);
  const discountAmount = Number(((grossSubtotal * discountPercent) / 100).toFixed(2));
  const finalTotal = Math.max(0, grossSubtotal - discountAmount);
  const taxPortion = cart.reduce((sum, item) => sum + item.tax_amount * item.quantity, 0);

  const handleCompleteSale = async () => {
    if (cart.length === 0) return;

    const tendered = Number(tenderedAmount) || finalTotal;
    const change = Math.max(0, tendered - finalTotal);
    const totalDiscount = Math.round((discountAmount + contractSavings) * 100) / 100;

    const res = await completePosSale({
      customer_id: selectedCustomerId || null,
      walk_in_name: customerName,
      items: cart,
      subtotal: catalogGrossSubtotal,
      discount_amount: totalDiscount,
      tax_amount: taxPortion,
      total_amount: finalTotal,
      payment_method: paymentMode,
      tendered_amount: tendered,
      change_returned: change,
    });

    if (res.success && res.data) {
      setLastReceipt(res.data);
      addToast({
        type: "success",
        title: "Sale Completed!",
        message: `Issued Receipt #${res.data.receipt_number}. Stock auto-decremented.`,
      });
      setCart([]);
      setTenderedAmount("");
      setDiscountPercent(0);
    }
  };

  const filteredProducts = catalogItems.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = selectedCategory === "ALL" || item.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Point of Sale (POS) Counter
            </h1>
            <Badge variant="primary" className="text-xs">
              Fast Walk-in Checkout
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Counter sales for water refills and packaged beverages with automatic inventory deduction and bill printing.
          </p>
        </div>

        {lastReceipt && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.print()}
            className="gap-2 text-xs"
          >
            <Printer className="h-4 w-4" />
            Print Last Receipt (#{lastReceipt.receipt_number})
          </Button>
        )}
      </div>

      {/* POS Two-Pane Split: Catalog (Left) + Cart & Billing (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Product Catalog */}
        <div className="lg:col-span-7 space-y-4">
          <Card className="border-border shadow-xs">
            <CardHeader className="p-4 pb-3 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-nowrap pb-1 sm:pb-0">
                  {["ALL", "WATER_JAR", "BEVERAGE", "PACKAGED_WATER"].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 touch-manipulation ${
                        selectedCategory === cat
                          ? "bg-primary text-primary-foreground shadow-xs font-bold"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {cat.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>

                <div className="w-full sm:w-56">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search drinks / jars..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 text-xs h-9"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {filteredProducts.map((p) => {
                  return (
                    <div
                      key={p.id}
                      onClick={() => addToCart(p)}
                      className="rounded-xl border border-border bg-card p-3.5 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between space-y-2 select-none group"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {p.sku}
                          </span>
                          <Badge variant="outline" className="text-[9px] py-0 px-1">
                            {p.stock} in stock
                          </Badge>
                        </div>
                        <h4 className="text-xs font-bold text-foreground leading-snug group-hover:text-primary transition-colors">
                          {p.name}
                        </h4>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-border/60">
                        <div>
                          {customerSpecialPrices[p.id] !== undefined ? (
                            <div className="space-y-0.5">
                              <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 block">
                                {formatCurrency(customerSpecialPrices[p.id])}
                              </span>
                              <span className="text-[10px] text-muted-foreground line-through block">
                                Std: {formatCurrency(p.price)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm font-extrabold text-foreground">
                              {formatCurrency(p.price)}
                            </span>
                          )}
                        </div>
                        <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                          <Plus className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right 5 Columns: Active POS Cart & Tender */}
        <div className="lg:col-span-5 space-y-4">
          <Card className="border-border shadow-xs bg-card">
            <CardHeader className="p-4 pb-3 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-primary" />
                  Active Cart ({cart.reduce((s, i) => s + i.quantity, 0)} items)
                </CardTitle>
                {cart.length > 0 && (
                  <button
                    onClick={() => setCart([])}
                    className="text-[11px] text-rose-500 hover:underline"
                  >
                    Clear Cart
                  </button>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-4 space-y-4">
              {/* Customer Selector with Special Pricing Detection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-muted-foreground">
                    Customer Account
                  </label>
                  {selectedCustomerId && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Contract Pricing Active
                    </span>
                  )}
                </div>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => handleCustomerChange(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary h-8"
                >
                  <option value="">Walk-in Customer (Standard Prices)</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.contact_name} {c.business_name ? `(${c.business_name})` : ""}
                    </option>
                  ))}
                </select>
                {!selectedCustomerId && (
                  <Input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Walk-in Customer Reference Name"
                    className="text-xs h-7 mt-1"
                  />
                )}
              </div>

              {/* Cart Items List */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1 divide-y divide-border/60">
                {cart.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    Tap any beverage or water jar from catalog to add to cart.
                  </div>
                ) : (
                  cart.map((item) => (
                    <div
                      key={item.product_id}
                      className="pt-2 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <h5 className="text-xs font-bold text-foreground truncate">
                          {item.product_name}
                        </h5>
                        <p className="text-[11px] text-muted-foreground">
                          {formatCurrency(item.unit_price)} × {item.quantity}
                          {customerSpecialPrices[item.product_id] !== undefined && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold ml-1.5">
                              (Contract Price)
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.product_id, -1)}
                          className="h-8 w-8 min-h-[36px] min-w-[36px] rounded-lg bg-muted flex items-center justify-center text-foreground hover:bg-muted/80 active:scale-95 touch-manipulation text-xs"
                          aria-label={`Decrease quantity of ${item.product_name}`}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-6 text-center text-xs font-bold text-foreground">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(item.product_id, 1)}
                          className="h-8 w-8 min-h-[36px] min-w-[36px] rounded-lg bg-muted flex items-center justify-center text-foreground hover:bg-muted/80 active:scale-95 touch-manipulation text-xs"
                          aria-label={`Increase quantity of ${item.product_name}`}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.product_id)}
                          className="h-8 w-8 min-h-[36px] min-w-[36px] rounded-lg text-rose-500 hover:bg-rose-500/10 active:scale-95 touch-manipulation flex items-center justify-center ml-1 text-xs"
                          aria-label={`Remove ${item.product_name} from cart`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Discount Stepper (Permission Checked) */}
              {cart.length > 0 && (
                <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border text-xs">
                  <span className="font-semibold text-muted-foreground flex items-center gap-1">
                    <Percent className="h-3.5 w-3.5 text-primary" />
                    Special Discount:
                  </span>
                  <div className="flex items-center gap-1">
                    {[0, 5, 10, 15].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setDiscountPercent(pct)}
                        className={`min-h-[32px] px-2.5 py-1 text-xs font-bold rounded touch-manipulation transition-colors ${
                          discountPercent === pct
                            ? "bg-primary text-primary-foreground shadow-xs"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Financial Calculation Summary */}
              <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs space-y-1.5">
                <div className="flex justify-between text-muted-foreground">
                  <span>Gross Subtotal:</span>
                  <span>{formatCurrency(catalogGrossSubtotal)}</span>
                </div>
                {contractSavings > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium">
                    <span>Contract Discount:</span>
                    <span>-{formatCurrency(contractSavings)}</span>
                  </div>
                )}
                {discountAmount > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium">
                    <span>Counter Discount ({discountPercent}%):</span>
                    <span>-{formatCurrency(discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground text-[11px]">
                  <span>Included GST:</span>
                  <span>{formatCurrency(taxPortion)}</span>
                </div>
                <div className="flex justify-between text-base font-extrabold text-foreground pt-1.5 border-t border-border">
                  <span>Total Payable:</span>
                  <span className="text-primary">{formatCurrency(finalTotal)}</span>
                </div>
              </div>

              {/* Payment Mode Selector */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-muted-foreground">
                  Select Payment Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "UPI", label: "UPI QR", icon: QrCode },
                    { id: "CASH", label: "Cash", icon: Banknote },
                    { id: "CARD", label: "Card", icon: Receipt },
                  ].map((m) => {
                    const Icon = m.icon;
                    const isSelected = paymentMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPaymentMode(m.id as "CASH" | "UPI" | "CARD")}
                        className={`flex flex-col items-center justify-center min-h-[48px] p-2 rounded-xl text-xs font-bold border transition-all touch-manipulation active:scale-95 ${
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-xs"
                            : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                        }`}
                      >
                        <Icon className="h-4 w-4 mb-1" />
                        <span>{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Complete Order Button */}
              <Button
                onClick={handleCompleteSale}
                disabled={cart.length === 0}
                className="w-full min-h-[48px] h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-md gap-2 touch-manipulation"
              >
                <CheckCircle2 className="h-5 w-5" />
                Complete Sale ({formatCurrency(finalTotal)})
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
