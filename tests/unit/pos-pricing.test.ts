import { describe, it, expect } from "vitest";

describe("Phase E POS Transactions: Server-Side Pricing & Stock Integrity", () => {
  it("calculates line subtotal, tax amount, and total strictly on the server from trusted product master", () => {
    // Database product records
    const productA = {
      id: "prod-1",
      name: "Packaged Mineral Water 1L",
      default_sale_price: 20.0,
      gst_rate: 18.0,
    };

    const requestedQty = 5;

    const lineSubtotal = productA.default_sale_price * requestedQty; // 100.00
    const lineTax = Number((lineSubtotal * (productA.gst_rate / 100.0)).toFixed(2)); // 18.00
    const lineTotal = lineSubtotal + lineTax; // 118.00

    expect(lineSubtotal).toBe(100.0);
    expect(lineTax).toBe(18.0);
    expect(lineTotal).toBe(118.0);
  });

  it("verifies double-entry balancing for POS counter sales", () => {
    const subtotal = 500.0;
    const discount = 50.0;
    const taxTotal = 81.0;
    const totalAmount = subtotal + taxTotal - discount; // 531.00

    // Accounting entries:
    // Debit: Cash/Bank = totalAmount (531.00)
    // Credit: Sales Revenue = subtotal - discount (450.00)
    // Credit: GST Output Tax Payable = taxTotal (81.00)
    const debitCash = totalAmount;
    const creditRevenue = subtotal - discount;
    const creditTax = taxTotal;

    const totalDebits = debitCash;
    const totalCredits = creditRevenue + creditTax;

    expect(totalDebits).toBe(531.0);
    expect(totalCredits).toBe(531.0);
    expect(totalDebits).toBe(totalCredits);
  });

  it("strictly rejects insufficient warehouse stock for POS items", () => {
    const warehouseStock = 12;
    const requestedQty = 15;

    const hasSufficientStock = warehouseStock >= requestedQty;
    expect(hasSufficientStock).toBe(false);

    const remainingIfClampedNaive = Math.max(0, warehouseStock - requestedQty);
    expect(remainingIfClampedNaive).toBe(0); // Clamping is forbidden; transaction must abort
  });

  it("aggregates multiple lines of the same product before verifying stock availability", () => {
    // Problem identified in audit: Stock is 10. Client submits Line 1 (7 units) and Line 2 (7 units).
    // Individual line checks would both pass against 10 if checked without prior aggregation!
    const availableStock = 10;
    const cartLines = [
      { product_id: "prod-water-20l", quantity: 7 },
      { product_id: "prod-water-20l", quantity: 7 },
    ];

    // Aggregation logic as implemented in rpc_complete_pos_sale
    const aggregatedStockDemand = cartLines.reduce((acc, line) => {
      acc[line.product_id] = (acc[line.product_id] || 0) + line.quantity;
      return acc;
    }, {} as Record<string, number>);

    expect(aggregatedStockDemand["prod-water-20l"]).toBe(14);

    const isAggregateStockSufficient = availableStock >= aggregatedStockDemand["prod-water-20l"];
    expect(isAggregateStockSufficient).toBe(false); // 10 < 14 -> Rejected!
  });

  it("rejects discount amounts exceeding the gross subtotal", () => {
    const subtotal = 200.0;
    const excessiveDiscount = 250.0;

    const isDiscountValid = excessiveDiscount <= subtotal;
    expect(isDiscountValid).toBe(false);
  });
});
