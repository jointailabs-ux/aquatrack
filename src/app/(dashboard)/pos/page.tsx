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

// Module-level client cache for instant POS catalog display
let cachedPosState: {
  catalogItems: SellableItem[];
  customers: CustomerRecord[];
} | null = null;

export default function PosPage() {
  const { addToast } = useToast();
  const [catalogItems, setCatalogItems] = React.useState<SellableItem[]>(() => cachedPosState?.catalogItems || []);
  const [cart, setCart] = React.useState<PosCartItem[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedCategory, setSelectedCategory] = React.useState<string>("ALL");
  const [customerName, setCustomerName] = React.useState("Walk-in Customer");
  const [customers, setCustomers] = React.useState<CustomerRecord[]>(() => cachedPosState?.customers || []);
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

      let freshItems: SellableItem[] = [];
      let freshCustomers: CustomerRecord[] = [];

      if (prodRes.success && prodRes.data?.items) {
        freshItems = prodRes.data.items.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          price: Number(p.default_sale_price),
          gstRate: Number(p.gst_rate),
          stock: stockMap.get(p.id) || 0,
          isReusableJar: p.is_reusable_jar,
        }));
        setCatalogItems(freshItems);
      }

      if (custRes.success && custRes.data) {
        freshCustomers = custRes.data.items;
        setCustomers(freshCustomers);
      }

      cachedPosState = {
        catalogItems: freshItems,
        customers: freshCustomers,
      };
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

  const addToCartWithQty = (product: SellableItem, addQty = 1) => {
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
                quantity: i.quantity + addQty,
                total: (i.quantity + addQty) * effectivePrice,
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
        quantity: addQty,
        discount_percent: 0,
        discount_amount: 0,
        gst_rate: product.gstRate,
        tax_amount: taxAmount,
        total: effectivePrice * addQty,
        is_reusable_jar: product.isReusableJar,
      };
      return [...prev, newItem];
    });
  };

  const addToCart = (product: SellableItem) => {
    addToCartWithQty(product, 1);
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
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
              Shop Counter Sale (दुकान काउंटर बिक्री)
            </h1>
            <Badge variant="primary" className="text-xs font-bold">
              Instant Sale
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Instant counter sale for water jars and drinks. Collect cash or UPI and print receipt.
          </p>
        </div>

        {lastReceipt && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.print()}
            className="gap-2 text-xs font-semibold"
          >
            <Printer className="h-4 w-4" />
            Print Last Bill (#{lastReceipt.receipt_number})
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
                  {[
                    { id: "ALL", label: "All (सब)" },
                    { id: "WATER_JAR", label: "Water Jars (20L बोतल)" },
                    { id: "BEVERAGE", label: "Drinks (कोल्ड ड्रिंक्स)" },
                    { id: "PACKAGED_WATER", label: "Small Bottles (पानी बोतल)" },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 touch-manipulation ${
                        selectedCategory === cat.id
                          ? "bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-xs font-bold"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {cat.label}
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
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              addToCartWithQty(p, 1);
                            }}
                            className="h-6 px-2 rounded-md bg-primary/10 text-primary hover:bg-primary hover:text-white text-[10px] font-bold transition-colors cursor-pointer active:scale-95"
                            title="Add 1"
                          >
                            +1
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              addToCartWithQty(p, 5);
                            }}
                            className="h-6 px-2 rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-primary hover:text-white text-[10px] font-bold transition-colors cursor-pointer active:scale-95"
                            title="Add 5"
                          >
                            +5
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              addToCartWithQty(p, 10);
                            }}
                            className="h-6 px-2 rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-primary hover:text-white text-[10px] font-bold transition-colors cursor-pointer active:scale-95"
                            title="Add 10"
                          >
                            +10
                          </button>
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
        <div id="pos-checkout-section" className="lg:col-span-5 space-y-4">
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

                {/* Quick Customer Chips */}
                <div className="flex items-center gap-1 flex-wrap pb-1">
                  <button
                    type="button"
                    onClick={() => handleCustomerChange("")}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all cursor-pointer ${
                      !selectedCustomerId
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                    }`}
                  >
                    Walk-in
                  </button>
                  {customers.slice(0, 3).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleCustomerChange(c.id)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all cursor-pointer ${
                        selectedCustomerId === c.id
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted text-foreground border-border hover:bg-muted/80"
                      }`}
                    >
                      {c.contact_name}
                    </button>
                  ))}
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

              {/* Cash Fast Tender Preset Chips */}
              {paymentMode === "CASH" && cart.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/80 space-y-2.5 animate-in fade-in-50 duration-200">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-amber-900">
                      Cash Given by Customer (ग्राहक ने कितने दिए)
                    </span>
                    {Number(tenderedAmount) > finalTotal && (
                      <span className="text-xs font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
                        Return: {formatCurrency(Number(tenderedAmount) - finalTotal)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setTenderedAmount(String(finalTotal))}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-primary text-white shadow-xs hover:bg-primary/90 transition-colors cursor-pointer"
                    >
                      Exact ({formatCurrency(finalTotal)})
                    </button>
                    {[50, 100, 200, 500, 1000, 2000].map((amt) => {
                      if (amt >= finalTotal) {
                        return (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => setTenderedAmount(String(amt))}
                            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-border hover:bg-slate-100 text-foreground transition-colors cursor-pointer"
                          >
                            ₹{amt}
                          </button>
                        );
                      }
                      return null;
                    })}
                  </div>

                  <Input
                    type="number"
                    placeholder={`Cash Given (₹${finalTotal})`}
                    value={tenderedAmount}
                    onChange={(e) => setTenderedAmount(e.target.value)}
                    className="text-xs h-9 bg-white font-bold"
                  />
                </div>
              )}

              {/* Complete Order Button */}
              <Button
                onClick={handleCompleteSale}
                disabled={cart.length === 0}
                className="w-full min-h-[50px] h-12 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-sm shadow-md shadow-emerald-600/30 gap-2 touch-manipulation active:scale-[0.99]"
              >
                <CheckCircle2 className="h-5 w-5" />
                Complete Sale & Print Bill ({formatCurrency(finalTotal)})
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Mobile Floating Cart Summary */}
      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-20 left-3 right-3 z-30 shadow-2xl rounded-2xl bg-gradient-to-r from-slate-900 to-blue-950 text-white border border-sky-500/40 p-3.5 flex items-center justify-between animate-in slide-in-from-bottom duration-200">
          <div>
            <span className="text-xs font-bold block text-sky-300">
              {cart.reduce((s, i) => s + i.quantity, 0)} Items in Cart
            </span>
            <span className="text-base font-black text-white">{formatCurrency(finalTotal)}</span>
          </div>
          <Button
            size="sm"
            onClick={() => {
              const cartEl = document.getElementById("pos-checkout-section");
              if (cartEl) cartEl.scrollIntoView({ behavior: "smooth" });
            }}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs shadow-md"
          >
            Checkout & Pay &darr;
          </Button>
        </div>
      )}
    </div>
  );
}
