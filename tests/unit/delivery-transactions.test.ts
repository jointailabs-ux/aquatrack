import { describe, it, expect } from "vitest";

describe("Phase 4 Delivery Transaction Logic & Multi-Stop Reconciliation", () => {
  interface DeliveryStopRecord {
    id: string;
    orderId: string;
    actualDelivered: number;
    emptyJars: number;
    damagedJars: number;
    paymentCollected: number;
    status: "COMPLETED" | "FAILED" | "ASSIGNED";
  }

  interface OrderState {
    id: string;
    totalOrderedQty: number;
    totalAmount: number;
    stops: DeliveryStopRecord[];
    status: "PENDING" | "ASSIGNED" | "PARTIALLY_DELIVERED" | "DELIVERED";
    paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  }

  function simulateDeliveryStopExecution(
    order: OrderState,
    stopId: string,
    actualDelivered: number,
    emptyJars: number,
    damagedJars: number,
    paymentAmount: number,
    customerHolding: { full: number; empty: number; damaged: number }
  ) {
    if (actualDelivered < 0 || emptyJars < 0 || damagedJars < 0 || paymentAmount < 0) {
      throw new Error("Quantities and payments cannot be negative.");
    }

    // 1. Calculate cumulative deliveries from previous COMPLETED stops
    const previouslyDelivered = order.stops
      .filter((s) => s.status === "COMPLETED" && s.id !== stopId)
      .reduce((sum, s) => sum + s.actualDelivered, 0);

    const remainingQty = order.totalOrderedQty - previouslyDelivered;
    if (actualDelivered > remainingQty) {
      throw new Error(
        `Delivered quantity (${actualDelivered}) exceeds remaining order quantity (${remainingQty}). Total ordered: ${order.totalOrderedQty}, previously delivered: ${previouslyDelivered}.`
      );
    }

    // 2. Calculate cumulative payments from previous COMPLETED stops
    const previouslyPaid = order.stops
      .filter((s) => s.status === "COMPLETED" && s.id !== stopId)
      .reduce((sum, s) => sum + s.paymentCollected, 0);

    const remainingBalance = Math.max(0, order.totalAmount - previouslyPaid);
    if (paymentAmount > remainingBalance) {
      throw new Error(
        `Payment amount (${paymentAmount}) exceeds outstanding order balance (${remainingBalance}). Order total: ${order.totalAmount}, previously paid: ${previouslyPaid}.`
      );
    }

    // 3. Validate physical jar custody conservation
    const totalCustomerCustody = customerHolding.full + customerHolding.empty + customerHolding.damaged;
    const totalReturning = emptyJars + damagedJars;
    if (totalReturning > totalCustomerCustody) {
      throw new Error(
        `Invalid physical return: customer holds ${totalCustomerCustody} jars, but attempted to return ${totalReturning} jars.`
      );
    }

    // Update customer holdings
    let newFull = customerHolding.full + actualDelivered;
    let newEmpty = customerHolding.empty;
    let newDamaged = customerHolding.damaged;

    if (newEmpty >= emptyJars) {
      newEmpty -= emptyJars;
    } else {
      newFull -= (emptyJars - newEmpty);
      newEmpty = 0;
    }

    if (damagedJars > 0) {
      if (newDamaged >= damagedJars) {
        newDamaged -= damagedJars;
      } else {
        const excessDmg = damagedJars - newDamaged;
        newDamaged = 0;
        if (newEmpty >= excessDmg) {
          newEmpty -= excessDmg;
        } else {
          newFull -= (excessDmg - newEmpty);
          newEmpty = 0;
        }
      }
    }

    if (newFull < 0 || newEmpty < 0) {
      throw new Error(`Physical custody violation: negative holdings (full: ${newFull}, empty: ${newEmpty}).`);
    }

    // 4. Update order cumulative state
    const newCumulativeDelivered = previouslyDelivered + actualDelivered;
    const newCumulativePaid = previouslyPaid + paymentAmount;

    const newOrderStatus: OrderState["status"] =
      newCumulativeDelivered >= order.totalOrderedQty
        ? "DELIVERED"
        : newCumulativeDelivered > 0
        ? "PARTIALLY_DELIVERED"
        : order.status;

    const newPaymentStatus: OrderState["paymentStatus"] =
      newCumulativePaid >= order.totalAmount
        ? "PAID"
        : newCumulativePaid > 0
        ? "PARTIALLY_PAID"
        : "UNPAID";

    const completedStop: DeliveryStopRecord = {
      id: stopId,
      orderId: order.id,
      actualDelivered,
      emptyJars,
      damagedJars,
      paymentCollected: paymentAmount,
      status: "COMPLETED",
    };

    return {
      order: {
        ...order,
        status: newOrderStatus,
        paymentStatus: newPaymentStatus,
        stops: [...order.stops.filter((s) => s.id !== stopId), completedStop],
      },
      customerHolding: { full: newFull, empty: newEmpty, damaged: newDamaged },
      remainingQty: order.totalOrderedQty - newCumulativeDelivered,
      remainingBalance: order.totalAmount - newCumulativePaid,
    };
  }

  it("handles multi-stop partial deliveries correctly across 3 stops without exceeding total", () => {
    // Scenario: Order has 20 units total.
    // Stop 1 delivers 8 units -> 12 remaining.
    // Stop 2 delivers 7 units -> 5 remaining.
    // Stop 3 delivers 5 units -> 0 remaining (COMPLETED).
    const initialOrder: OrderState = {
      id: "ord-001",
      totalOrderedQty: 20,
      totalAmount: 1800,
      stops: [],
      status: "ASSIGNED",
      paymentStatus: "UNPAID",
    };

    let customerHolding = { full: 5, empty: 2, damaged: 0 };

    // Stop 1: deliver 8
    const run1 = simulateDeliveryStopExecution(
      initialOrder,
      "stop-01",
      8,
      2,
      0,
      600,
      customerHolding
    );
    expect(run1.remainingQty).toBe(12);
    expect(run1.remainingBalance).toBe(1200);
    expect(run1.order.status).toBe("PARTIALLY_DELIVERED");
    expect(run1.order.paymentStatus).toBe("PARTIALLY_PAID");
    customerHolding = run1.customerHolding;

    // Stop 2: deliver 7
    const run2 = simulateDeliveryStopExecution(
      run1.order,
      "stop-02",
      7,
      3,
      0,
      600,
      customerHolding
    );
    expect(run2.remainingQty).toBe(5);
    expect(run2.remainingBalance).toBe(600);
    expect(run2.order.status).toBe("PARTIALLY_DELIVERED");
    expect(run2.order.paymentStatus).toBe("PARTIALLY_PAID");
    customerHolding = run2.customerHolding;

    // Stop 3: deliver 5
    const run3 = simulateDeliveryStopExecution(
      run2.order,
      "stop-03",
      5,
      2,
      0,
      600,
      customerHolding
    );
    expect(run3.remainingQty).toBe(0);
    expect(run3.remainingBalance).toBe(0);
    expect(run3.order.status).toBe("DELIVERED");
    expect(run3.order.paymentStatus).toBe("PAID");
  });

  it("strictly rejects over-delivery attempts exceeding the remaining order quantity", () => {
    // Scenario: Order of 20 units.
    // Stop 1 delivered 8.
    // Stop 2 delivered 7.
    // Remaining is 5 units.
    // Attempting to deliver 6 units must throw!
    const orderWith15Delivered: OrderState = {
      id: "ord-002",
      totalOrderedQty: 20,
      totalAmount: 2000,
      stops: [
        {
          id: "stop-01",
          orderId: "ord-002",
          actualDelivered: 8,
          emptyJars: 0,
          damagedJars: 0,
          paymentCollected: 800,
          status: "COMPLETED",
        },
        {
          id: "stop-02",
          orderId: "ord-002",
          actualDelivered: 7,
          emptyJars: 0,
          damagedJars: 0,
          paymentCollected: 700,
          status: "COMPLETED",
        },
      ],
      status: "PARTIALLY_DELIVERED",
      paymentStatus: "PARTIALLY_PAID",
    };

    const customerHolding = { full: 15, empty: 5, damaged: 0 };

    expect(() =>
      simulateDeliveryStopExecution(
        orderWith15Delivered,
        "stop-03",
        6, // Exceeds remaining 5!
        0,
        0,
        500,
        customerHolding
      )
    ).toThrow(/exceeds remaining order quantity/i);
  });

  it("strictly rejects overpayment attempts exceeding outstanding balance", () => {
    // Scenario: Order total is $1000.
    // Previous payments: $600 collected across prior stops.
    // Outstanding balance is $400.
    // Attempting to collect $450 must throw!
    const orderWith600Paid: OrderState = {
      id: "ord-003",
      totalOrderedQty: 10,
      totalAmount: 1000,
      stops: [
        {
          id: "stop-01",
          orderId: "ord-003",
          actualDelivered: 6,
          emptyJars: 0,
          damagedJars: 0,
          paymentCollected: 600,
          status: "COMPLETED",
        },
      ],
      status: "PARTIALLY_DELIVERED",
      paymentStatus: "PARTIALLY_PAID",
    };

    const customerHolding = { full: 6, empty: 2, damaged: 0 };

    expect(() =>
      simulateDeliveryStopExecution(
        orderWith600Paid,
        "stop-02",
        4,
        0,
        0,
        450, // Exceeds remaining $400!
        customerHolding
      )
    ).toThrow(/exceeds outstanding order balance/i);

    // Exact payment of $400 succeeds and marks order PAID
    const validRun = simulateDeliveryStopExecution(
      orderWith600Paid,
      "stop-02",
      4,
      0,
      0,
      400,
      customerHolding
    );
    expect(validRun.remainingBalance).toBe(0);
    expect(validRun.order.paymentStatus).toBe("PAID");
  });

  it("strictly rejects jar returns exceeding customer physical holding", () => {
    const order: OrderState = {
      id: "ord-004",
      totalOrderedQty: 10,
      totalAmount: 1000,
      stops: [],
      status: "ASSIGNED",
      paymentStatus: "UNPAID",
    };

    // Customer only holds 3 jars total
    const customerHolding = { full: 2, empty: 1, damaged: 0 };

    expect(() =>
      simulateDeliveryStopExecution(
        order,
        "stop-01",
        5,
        4, // Returning 4 when holding 3!
        0,
        500,
        customerHolding
      )
    ).toThrow(/Invalid physical return: customer holds 3 jars/i);
  });
});
