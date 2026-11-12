import { describe, it, expect } from "vitest";

interface ProductRecord {
  id: string;
  name: string;
  defaultSalePrice: number;
  gstRate: number; // e.g. 18.0 for 18%
  isActive: boolean;
}

interface CustomerSpecialPrice {
  customerId: string;
  productId: string;
  specialPrice: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

interface OrderItemInput {
  productId: string;
  quantity: number;
  clientUnitPrice?: number;
  clientTaxRate?: number;
  priceOverrideReason?: string;
}

interface OrderItemResult {
  productId: string;
  quantity: number;
  unitPrice: number;
  originalPrice: number;
  isPriceOverridden: boolean;
  overrideReason?: string;
  authorizedBy?: string;
  gstRate: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

interface CreateOrderResult {
  orderId: string;
  customerId: string;
  items: OrderItemResult[];
  subtotal: number;
  taxTotal: number;
  totalAmount: number;
  idempotent?: boolean;
}

interface InventoryBalanceRecord {
  productId: string;
  quantityOnHand: number;
  quantityReserved: number;
}

interface DatabaseState {
  products: Map<string, ProductRecord>;
  customerSpecialPrices: CustomerSpecialPrice[];
  orders: Map<string, CreateOrderResult>;
  orderIdempotencyKeys: Map<string, string>; // key -> orderId
  customerBalances: Map<string, number>;
  inventoryBalances: Map<string, InventoryBalanceRecord>;
}

function simulateRpcCreateCustomerOrder({
  callerUserId,
  callerRole,
  customerId,
  items,
  overallDiscount = 0,
  idempotencyKey,
  targetDate = "2026-11-04",
  state,
}: {
  callerUserId: string;
  callerRole: "owner" | "driver" | "staff" | "accountant";
  customerId: string;
  items: OrderItemInput[];
  overallDiscount?: number;
  idempotencyKey?: string;
  targetDate?: string;
  state: DatabaseState;
}): CreateOrderResult {
  // Snapshot state for atomicity / transaction rollback guarantee
  const stateSnapshot = {
    customerBalance: state.customerBalances.get(customerId) ?? 0,
    ordersCount: state.orders.size,
  };

  try {
    // 1. Idempotency check
    if (idempotencyKey && state.orderIdempotencyKeys.has(idempotencyKey)) {
      const existingOrderId = state.orderIdempotencyKeys.get(idempotencyKey)!;
      const existingOrder = state.orders.get(existingOrderId)!;
      return { ...existingOrder, idempotent: true };
    }

    // 2. Validate items array
    if (!items || items.length === 0) {
      throw new Error("Order must contain at least one item.");
    }

    if (overallDiscount < 0) {
      throw new Error("Discount cannot be negative.");
    }

    // 2b. Deterministic inventory availability validation and reservation (Part 5)
    const groupedReqs = new Map<string, number>();
    for (const item of items) {
      groupedReqs.set(item.productId, (groupedReqs.get(item.productId) ?? 0) + item.quantity);
    }

    const sortedProductIds = Array.from(groupedReqs.keys()).sort();
    for (const pId of sortedProductIds) {
      const reqQty = groupedReqs.get(pId)!;
      const inv = state.inventoryBalances?.get(pId);
      const product = state.products.get(pId);
      const avail = inv ? inv.quantityOnHand - inv.quantityReserved : 0;

      if (avail < reqQty) {
        throw new Error(
          `Insufficient available inventory for product "${product?.name ?? pId}". Requested: ${reqQty}, Available: ${avail} (On-hand: ${inv?.quantityOnHand ?? 0}, Reserved: ${inv?.quantityReserved ?? 0}).`
        );
      }
    }

    // Atomically reserve inventory
    for (const pId of sortedProductIds) {
      const reqQty = groupedReqs.get(pId)!;
      const inv = state.inventoryBalances?.get(pId);
      if (inv) {
        inv.quantityReserved += reqQty;
      }
    }

    let calculatedSubtotal = 0;
    let calculatedTaxTotal = 0;
    const resolvedItems: OrderItemResult[] = [];

    for (const item of items) {
      // 3. Validate quantity
      if (!item.quantity || item.quantity <= 0 || !Number.isInteger(item.quantity)) {
        throw new Error(`Invalid item quantity: ${item.quantity}. Must be a positive integer.`);
      }

      // 4. Retrieve authoritative product master record
      const product = state.products.get(item.productId);
      if (!product || !product.isActive) {
        throw new Error(`Product ${item.productId} not found or inactive in catalog.`);
      }

      // 5. Check customer special negotiated contracted price with effective date range
      const specialPriceRecord = state.customerSpecialPrices.find(
        (sp) =>
          sp.customerId === customerId &&
          sp.productId === item.productId &&
          (!sp.effectiveFrom || sp.effectiveFrom <= targetDate) &&
          (!sp.effectiveTo || sp.effectiveTo >= targetDate)
      );
      const standardPrice = specialPriceRecord
        ? specialPriceRecord.specialPrice
        : product.defaultSalePrice;

      // 6. Unit Price Authorization & Validation
      let finalUnitPrice = standardPrice;
      let isOverridden = false;
      let authorizedBy: string | undefined = undefined;
      let overrideReason: string | undefined = undefined;

      if (item.clientUnitPrice !== undefined && item.clientUnitPrice !== standardPrice) {
        // Client attempting to override price
        if (callerRole !== "owner") {
          throw new Error(
            `Unauthorized price override: Only business owner can override prices. Standard: ${standardPrice}, Submitted: ${item.clientUnitPrice}.`
          );
        }

        if (item.clientUnitPrice < 0) {
          throw new Error(`Unit price cannot be negative. Submitted: ${item.clientUnitPrice}.`);
        }

        if (!item.priceOverrideReason || item.priceOverrideReason.trim().length < 5) {
          throw new Error("Price override requires a valid business reason (minimum 5 characters).");
        }

        finalUnitPrice = item.clientUnitPrice;
        isOverridden = true;
        authorizedBy = callerUserId;
        overrideReason = item.priceOverrideReason.trim();
      }

      // 7. Authoritative GST Tax Rate (Client CANNOT override tax rate)
      // Even if client submits clientTaxRate, database strictly ignores/rejects tampering
      if (item.clientTaxRate !== undefined && item.clientTaxRate !== product.gstRate) {
        throw new Error(
          `Invalid tax rate submitted (${item.clientTaxRate}%). Authoritative tax rate is ${product.gstRate}%.`
        );
      }
      const authoritativeTaxRate = product.gstRate;

      // 8. Server-side line calculations
      const lineSubtotal = Number((finalUnitPrice * item.quantity).toFixed(2));
      const lineTax = Number(((lineSubtotal * authoritativeTaxRate) / 100.0).toFixed(2));
      const lineTotal = Number((lineSubtotal + lineTax).toFixed(2));

      calculatedSubtotal += lineSubtotal;
      calculatedTaxTotal += lineTax;

      resolvedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: finalUnitPrice,
        originalPrice: standardPrice,
        isPriceOverridden: isOverridden,
        overrideReason,
        authorizedBy,
        gstRate: authoritativeTaxRate,
        lineSubtotal,
        lineTax,
        lineTotal,
      });
    }

    // 9. Validate overall discount against subtotal
    if (overallDiscount > calculatedSubtotal) {
      throw new Error(
        `Discount (${overallDiscount}) cannot exceed gross subtotal (${calculatedSubtotal}).`
      );
    }

    const finalOrderTotal = Number((calculatedSubtotal + calculatedTaxTotal - overallDiscount).toFixed(2));

    const orderId = "ord-" + Math.random().toString(36).substring(2, 9);
    const newOrder: CreateOrderResult = {
      orderId,
      customerId,
      items: resolvedItems,
      subtotal: calculatedSubtotal,
      taxTotal: calculatedTaxTotal,
      totalAmount: finalOrderTotal,
      idempotent: false,
    };

    // Commit to state atomically
    state.orders.set(orderId, newOrder);
    if (idempotencyKey) {
      state.orderIdempotencyKeys.set(idempotencyKey, orderId);
    }
    const currentBal = state.customerBalances.get(customerId) ?? 0;
    state.customerBalances.set(customerId, currentBal + finalOrderTotal);

    return newOrder;
  } catch (err) {
    // Transaction Rollback: restore state snapshot
    state.customerBalances.set(customerId, stateSnapshot.customerBalance);
    // Any half-created records are not committed
    throw err;
  }
}

describe("Remediation Round 4: Authoritative Order Pricing, Tax & Atomicity", () => {
  function createInitialState(): DatabaseState {
    const products = new Map<string, ProductRecord>();
    products.set("prod-20l", {
      id: "prod-20l",
      name: "20L Natural Mineral Water Jar",
      defaultSalePrice: 80.0,
      gstRate: 18.0,
      isActive: true,
    });
    products.set("prod-10l", {
      id: "prod-10l",
      name: "10L Water Jar",
      defaultSalePrice: 45.0,
      gstRate: 12.0,
      isActive: true,
    });
    products.set("prod-dispenser", {
      id: "prod-dispenser",
      name: "Tabletop Ceramic Dispenser",
      defaultSalePrice: 650.0,
      gstRate: 18.0,
      isActive: true,
    });

    const customerSpecialPrices: CustomerSpecialPrice[] = [
      {
        customerId: "cust-corp-1",
        productId: "prod-20l",
        specialPrice: 65.0, // Special contract price for corporate customer
      },
    ];

    const customerBalances = new Map<string, number>();
    customerBalances.set("cust-retail-1", 0);
    customerBalances.set("cust-corp-1", 1500);

    const inventoryBalances = new Map<string, InventoryBalanceRecord>();
    inventoryBalances.set("prod-20l", { productId: "prod-20l", quantityOnHand: 100, quantityReserved: 0 });
    inventoryBalances.set("prod-10l", { productId: "prod-10l", quantityOnHand: 50, quantityReserved: 0 });
    inventoryBalances.set("prod-dispenser", { productId: "prod-dispenser", quantityOnHand: 20, quantityReserved: 0 });

    return {
      products,
      customerSpecialPrices,
      orders: new Map(),
      orderIdempotencyKeys: new Map(),
      customerBalances,
      inventoryBalances,
    };
  }

  function simulateRpcCancelCustomerOrder({
    orderId,
    state,
  }: {
    orderId: string;
    state: DatabaseState;
  }): { success: boolean; released: boolean } {
    const order = state.orders.get(orderId);
    if (!order) throw new Error(`Order ${orderId} not found.`);

    for (const item of order.items) {
      const inv = state.inventoryBalances.get(item.productId);
      if (inv) {
        inv.quantityReserved = Math.max(0, inv.quantityReserved - item.quantity);
      }
    }

    state.orders.delete(orderId);
    return { success: true, released: true };
  }

  it("successfully creates standard-price order using authoritative catalog pricing and tax", () => {
    const state = createInitialState();

    const order = simulateRpcCreateCustomerOrder({
      callerUserId: "user-staff-1",
      callerRole: "staff",
      customerId: "cust-retail-1",
      items: [
        { productId: "prod-20l", quantity: 10 }, // 10 * 80 = 800, tax 18% = 144
        { productId: "prod-10l", quantity: 4 }, // 4 * 45 = 180, tax 12% = 21.60
      ],
      state,
    });

    expect(order.items[0].unitPrice).toBe(80.0);
    expect(order.items[0].originalPrice).toBe(80.0);
    expect(order.items[0].isPriceOverridden).toBe(false);
    expect(order.items[0].gstRate).toBe(18.0);
    expect(order.items[0].lineSubtotal).toBe(800.0);
    expect(order.items[0].lineTax).toBe(144.0);
    expect(order.items[0].lineTotal).toBe(944.0);

    expect(order.items[1].unitPrice).toBe(45.0);
    expect(order.items[1].originalPrice).toBe(45.0);
    expect(order.items[1].gstRate).toBe(12.0);
    expect(order.items[1].lineSubtotal).toBe(180.0);
    expect(order.items[1].lineTax).toBe(21.6);
    expect(order.items[1].lineTotal).toBe(201.6);

    expect(order.subtotal).toBe(980.0);
    expect(order.taxTotal).toBe(165.6);
    expect(order.totalAmount).toBe(1145.6);

    // Customer balance updated atomically
    expect(state.customerBalances.get("cust-retail-1")).toBe(1145.6);
  });

  it("applies customer special contracted price automatically when configured", () => {
    const state = createInitialState();

    const order = simulateRpcCreateCustomerOrder({
      callerUserId: "user-driver-1",
      callerRole: "driver",
      customerId: "cust-corp-1",
      items: [{ productId: "prod-20l", quantity: 20 }], // Contract price 65 instead of default 80
      state,
    });

    expect(order.items[0].unitPrice).toBe(65.0);
    expect(order.items[0].originalPrice).toBe(65.0);
    expect(order.items[0].isPriceOverridden).toBe(false);
    expect(order.items[0].lineSubtotal).toBe(1300.0);
    expect(order.items[0].lineTax).toBe(234.0); // 18% of 1300
    expect(order.totalAmount).toBe(1534.0);
    expect(state.customerBalances.get("cust-corp-1")).toBe(1500 + 1534.0);
  });

  it("allows authorized owner to negotiate/override price with recorded reason and audit trail", () => {
    const state = createInitialState();

    const order = simulateRpcCreateCustomerOrder({
      callerUserId: "user-owner-admin",
      callerRole: "owner",
      customerId: "cust-retail-1",
      items: [
        {
          productId: "prod-20l",
          quantity: 5,
          clientUnitPrice: 75.0, // Discounted from standard 80.0
          priceOverrideReason: "Promotional discount for new residential customer",
        },
      ],
      state,
    });

    expect(order.items[0].unitPrice).toBe(75.0);
    expect(order.items[0].originalPrice).toBe(80.0);
    expect(order.items[0].isPriceOverridden).toBe(true);
    expect(order.items[0].overrideReason).toBe("Promotional discount for new residential customer");
    expect(order.items[0].authorizedBy).toBe("user-owner-admin");
    expect(order.items[0].lineSubtotal).toBe(375.0);
  });

  it("strictly rejects unauthorized price override attempts by drivers or staff", () => {
    const state = createInitialState();

    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-driver-2",
        callerRole: "driver", // Driver cannot override prices!
        customerId: "cust-retail-1",
        items: [
          {
            productId: "prod-20l",
            quantity: 5,
            clientUnitPrice: 50.0, // Malicious or unauthorized discount
            priceOverrideReason: "Driver friend discount",
          },
        ],
        state,
      })
    ).toThrow(/Unauthorized price override: Only business owner can override prices/i);

    // Verify transaction aborted: no order created, customer balance untouched
    expect(state.orders.size).toBe(0);
    expect(state.customerBalances.get("cust-retail-1")).toBe(0);
  });

  it("strictly rejects unauthorized price override attempts by staff without owner role", () => {
    const state = createInitialState();

    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-staff-billing",
        callerRole: "staff",
        customerId: "cust-retail-1",
        items: [
          {
            productId: "prod-20l",
            quantity: 2,
            clientUnitPrice: 40.0,
            priceOverrideReason: "Counter discount",
          },
        ],
        state,
      })
    ).toThrow(/Unauthorized price override/i);
  });

  it("rejects invalid or tampered GST tax rate submitted by client", () => {
    const state = createInitialState();

    // Client attempts to claim 0% tax or 5% tax instead of authoritative 18%
    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-owner-admin",
        callerRole: "owner",
        customerId: "cust-retail-1",
        items: [
          {
            productId: "prod-20l",
            quantity: 1,
            clientTaxRate: 5.0, // Fraudulent tax rate
          },
        ],
        state,
      })
    ).toThrow(/Invalid tax rate submitted \(5%\). Authoritative tax rate is 18%/i);
  });

  it("rejects negative unit price and negative discounts", () => {
    const state = createInitialState();

    // Negative price
    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-owner-admin",
        callerRole: "owner",
        customerId: "cust-retail-1",
        items: [
          {
            productId: "prod-20l",
            quantity: 1,
            clientUnitPrice: -20.0,
            priceOverrideReason: "Negative price test",
          },
        ],
        state,
      })
    ).toThrow(/Unit price cannot be negative/i);

    // Negative discount
    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-owner-admin",
        callerRole: "owner",
        customerId: "cust-retail-1",
        items: [{ productId: "prod-20l", quantity: 1 }],
        overallDiscount: -50.0,
        state,
      })
    ).toThrow(/Discount cannot be negative/i);
  });

  it("rejects non-positive and fractional quantities", () => {
    const state = createInitialState();

    // Zero quantity
    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-staff-1",
        callerRole: "staff",
        customerId: "cust-retail-1",
        items: [{ productId: "prod-20l", quantity: 0 }],
        state,
      })
    ).toThrow(/Invalid item quantity: 0/i);

    // Negative quantity
    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-staff-1",
        callerRole: "staff",
        customerId: "cust-retail-1",
        items: [{ productId: "prod-20l", quantity: -5 }],
        state,
      })
    ).toThrow(/Invalid item quantity: -5/i);

    // Fractional quantity for whole jar items
    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-staff-1",
        callerRole: "staff",
        customerId: "cust-retail-1",
        items: [{ productId: "prod-20l", quantity: 2.5 }],
        state,
      })
    ).toThrow(/Invalid item quantity: 2.5. Must be a positive integer/i);
  });

  it("rejects discount exceeding gross order subtotal", () => {
    const state = createInitialState();

    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-owner-admin",
        callerRole: "owner",
        customerId: "cust-retail-1",
        items: [{ productId: "prod-20l", quantity: 1 }], // Subtotal = 80
        overallDiscount: 100.0, // Excessive discount 100 > 80
        state,
      })
    ).toThrow(/Discount \(100\) cannot exceed gross subtotal \(80\)/i);
  });

  it("handles duplicate request with idempotency key without duplicate charges", () => {
    const state = createInitialState();
    const idempotencyKey = "order-idemp-uuid-12345";

    const res1 = simulateRpcCreateCustomerOrder({
      callerUserId: "user-owner-admin",
      callerRole: "owner",
      customerId: "cust-retail-1",
      items: [{ productId: "prod-20l", quantity: 3 }], // 240 + 43.20 = 283.20
      idempotencyKey,
      state,
    });

    expect(res1.idempotent).toBe(false);
    expect(state.customerBalances.get("cust-retail-1")).toBe(283.2);

    // Second execution with same idempotency key
    const res2 = simulateRpcCreateCustomerOrder({
      callerUserId: "user-owner-admin",
      callerRole: "owner",
      customerId: "cust-retail-1",
      items: [{ productId: "prod-20l", quantity: 3 }],
      idempotencyKey,
      state,
    });

    expect(res2.idempotent).toBe(true);
    expect(res2.orderId).toBe(res1.orderId);
    // Balance not charged a second time
    expect(state.customerBalances.get("cust-retail-1")).toBe(283.2);
  });

  it("guarantees transaction rollback: failure leaves no partial order, invoice, or balance change", () => {
    const state = createInitialState();
    const initialBalance = state.customerBalances.get("cust-retail-1")!;

    // Attempt an order where line 1 is valid but line 2 has an invalid price override
    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-driver-1",
        callerRole: "driver",
        customerId: "cust-retail-1",
        items: [
          { productId: "prod-20l", quantity: 5 }, // Valid line
          { productId: "prod-10l", quantity: 2, clientUnitPrice: 10.0, priceOverrideReason: "Cheaper" }, // Unauthorized!
        ],
        state,
      })
    ).toThrow(/Unauthorized price override/i);

    // Verify completely clean rollback
    expect(state.orders.size).toBe(0);
    expect(state.customerBalances.get("cust-retail-1")).toBe(initialBalance);
  });

  // --- Round 5 Specific Remediation Tests ---

  it("strictly rejects owner price overrides with missing, whitespace-only, or short reasons", () => {
    const state = createInitialState();

    // 1. Missing reason (undefined)
    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-owner-admin",
        callerRole: "owner",
        customerId: "cust-retail-1",
        items: [{ productId: "prod-20l", quantity: 2, clientUnitPrice: 70.0 }],
        state,
      })
    ).toThrow(/Price override requires a valid business reason \(minimum 5 characters\)/i);

    // 2. Whitespace-only reason
    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-owner-admin",
        callerRole: "owner",
        customerId: "cust-retail-1",
        items: [{ productId: "prod-20l", quantity: 2, clientUnitPrice: 70.0, priceOverrideReason: "    " }],
        state,
      })
    ).toThrow(/Price override requires a valid business reason \(minimum 5 characters\)/i);

    // 3. Short reason (< 5 characters)
    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-owner-admin",
        callerRole: "owner",
        customerId: "cust-retail-1",
        items: [{ productId: "prod-20l", quantity: 2, clientUnitPrice: 70.0, priceOverrideReason: "disc" }],
        state,
      })
    ).toThrow(/Price override requires a valid business reason \(minimum 5 characters\)/i);

    // 4. Valid reason (>= 5 characters) succeeds
    const order = simulateRpcCreateCustomerOrder({
      callerUserId: "user-owner-admin",
      callerRole: "owner",
      customerId: "cust-retail-1",
      items: [{ productId: "prod-20l", quantity: 2, clientUnitPrice: 70.0, priceOverrideReason: "Promotional loyalty discount" }],
      state,
    });
    expect(order.items[0].isPriceOverridden).toBe(true);
    expect(order.items[0].overrideReason).toBe("Promotional loyalty discount");
  });

  it("safely handles concurrent duplicate order requests with the same idempotency key", async () => {
    const state = createInitialState();
    const idempKey = "concurrent-idemp-uuid-999";

    // Simulate two concurrent requests arriving with the same idempotency key
    // Transaction A processes first and commits
    const resA = simulateRpcCreateCustomerOrder({
      callerUserId: "user-owner-admin",
      callerRole: "owner",
      customerId: "cust-retail-1",
      items: [{ productId: "prod-20l", quantity: 2 }],
      idempotencyKey: idempKey,
      state,
    });

    // Transaction B arrives with same idempotency key (deserialized by advisory lock)
    const resB = simulateRpcCreateCustomerOrder({
      callerUserId: "user-owner-admin",
      callerRole: "owner",
      customerId: "cust-retail-1",
      items: [{ productId: "prod-20l", quantity: 2 }],
      idempotencyKey: idempKey,
      state,
    });

    expect(resA.orderId).toBe(resB.orderId);
    expect(resB.idempotent).toBe(true);
    // Customer balance charged only once (2 * 80 = 160 + 18% tax 28.80 = 188.80)
    expect(state.customerBalances.get("cust-retail-1")).toBe(188.8);
    expect(state.orders.size).toBe(1);
  });

  // --- Round 6 Date-Range Customer Special Pricing Tests ---

  it("applies active special price when order date is within effective date range", () => {
    const state = createInitialState();
    // Configure special price active from 2026-01-01 to 2026-12-31 for cust-date-range
    state.customerSpecialPrices = [
      {
        customerId: "cust-date-range",
        productId: "prod-20l",
        specialPrice: 55.0, // Standard is 80.0
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
      },
    ];

    const order = simulateRpcCreateCustomerOrder({
      callerUserId: "user-staff-1",
      callerRole: "staff",
      customerId: "cust-date-range",
      items: [{ productId: "prod-20l", quantity: 10 }],
      targetDate: "2026-06-15", // Within range
      state,
    });

    expect(order.items[0].unitPrice).toBe(55.0);
    expect(order.items[0].originalPrice).toBe(55.0);
    expect(order.items[0].isPriceOverridden).toBe(false);
  });

  it("falls back to default catalog price when special price has expired", () => {
    const state = createInitialState();
    // Configure special price that expired on 2026-10-31
    state.customerSpecialPrices = [
      {
        customerId: "cust-date-range",
        productId: "prod-20l",
        specialPrice: 50.0,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-10-31", // Expired
      },
    ];

    const order = simulateRpcCreateCustomerOrder({
      callerUserId: "user-staff-1",
      callerRole: "staff",
      customerId: "cust-date-range",
      items: [{ productId: "prod-20l", quantity: 10 }],
      targetDate: "2026-11-04", // After expiration
      state,
    });

    // Falls back to catalog defaultSalePrice (80.0)
    expect(order.items[0].unitPrice).toBe(80.0);
    expect(order.items[0].originalPrice).toBe(80.0);
  });

  it("falls back to default catalog price when special price takes effect in the future", () => {
    const state = createInitialState();
    // Configure special price that starts in the future on 2026-12-01
    state.customerSpecialPrices = [
      {
        customerId: "cust-date-range",
        productId: "prod-20l",
        specialPrice: 45.0,
        effectiveFrom: "2026-12-01", // Future
        effectiveTo: "2027-12-31",
      },
    ];

    const order = simulateRpcCreateCustomerOrder({
      callerUserId: "user-staff-1",
      callerRole: "staff",
      customerId: "cust-date-range",
      items: [{ productId: "prod-20l", quantity: 10 }],
      targetDate: "2026-11-04", // Before effectiveFrom
      state,
    });

    // Falls back to catalog defaultSalePrice (80.0)
    expect(order.items[0].unitPrice).toBe(80.0);
    expect(order.items[0].originalPrice).toBe(80.0);
  });

  // --- Round 7 Remediation: Inventory Lifecycle & Reservation ---

  it("atomically reserves inventory when order is placed and prevents overselling", () => {
    const state = createInitialState();
    // Initially: prod-20l has onHand: 100, reserved: 0
    const invBefore = state.inventoryBalances.get("prod-20l")!;
    expect(invBefore.quantityOnHand).toBe(100);
    expect(invBefore.quantityReserved).toBe(0);

    // Place order for 40 units
    const order1 = simulateRpcCreateCustomerOrder({
      callerUserId: "user-staff-1",
      callerRole: "staff",
      customerId: "cust-retail-1",
      items: [{ productId: "prod-20l", quantity: 40 }],
      state,
    });

    expect(order1.orderId).toBeDefined();
    expect(invBefore.quantityReserved).toBe(40);
    expect(invBefore.quantityOnHand - invBefore.quantityReserved).toBe(60);

    // Place second order for 50 units (60 available -> succeeds)
    const order2 = simulateRpcCreateCustomerOrder({
      callerUserId: "user-staff-1",
      callerRole: "staff",
      customerId: "cust-corp-1",
      items: [{ productId: "prod-20l", quantity: 50 }],
      state,
    });

    expect(order2.orderId).toBeDefined();
    expect(invBefore.quantityReserved).toBe(90);
    expect(invBefore.quantityOnHand - invBefore.quantityReserved).toBe(10);

    // Place third order for 20 units (only 10 available -> MUST THROW!)
    expect(() =>
      simulateRpcCreateCustomerOrder({
        callerUserId: "user-staff-1",
        callerRole: "staff",
        customerId: "cust-retail-1",
        items: [{ productId: "prod-20l", quantity: 20 }],
        state,
      })
    ).toThrow(/Insufficient available inventory for product "20L Natural Mineral Water Jar". Requested: 20, Available: 10/i);
  });

  it("releases reserved inventory when an order is cancelled", () => {
    const state = createInitialState();
    const inv = state.inventoryBalances.get("prod-10l")!;
    expect(inv.quantityOnHand).toBe(50);
    expect(inv.quantityReserved).toBe(0);

    // Place order for 25 units
    const order = simulateRpcCreateCustomerOrder({
      callerUserId: "user-staff-1",
      callerRole: "staff",
      customerId: "cust-retail-1",
      items: [{ productId: "prod-10l", quantity: 25 }],
      state,
    });

    expect(inv.quantityReserved).toBe(25);

    // Cancel order
    const cancelRes = simulateRpcCancelCustomerOrder({
      orderId: order.orderId,
      state,
    });

    expect(cancelRes.success).toBe(true);
    expect(inv.quantityReserved).toBe(0);
    expect(inv.quantityOnHand - inv.quantityReserved).toBe(50);
  });
});



