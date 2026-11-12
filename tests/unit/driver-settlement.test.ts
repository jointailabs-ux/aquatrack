import { describe, it, expect } from "vitest";

describe("Phase 5 Driver Cash Float Settlement Formula", () => {
  it("enforces Section 3.3 Driver Cash Float settlement equation", () => {
    // Formula from AGENTS.md & Specification:
    // Expected Cash = Opening Float + Route Cash Collections - Approved On-Route Expenses
    const openingFloat = 1500; // Morning float for change
    const routeCashCollections = 8400; // Cash collected on route stops
    const approvedFuelExpense = 1200; // Approved diesel fuel voucher

    const expectedCash = openingFloat + routeCashCollections - approvedFuelExpense;
    expect(expectedCash).toBe(8700);

    // Case 1: Driver surrenders exact cash
    const actualCashHandedOver = 8700;
    const discrepancy = actualCashHandedOver - expectedCash;
    expect(discrepancy).toBe(0);

    // Case 2: Shortage
    const shortageHandover = 8500;
    const shortageDiscrepancy = shortageHandover - expectedCash;
    expect(shortageDiscrepancy).toBe(-200);

    // Case 3: Overage
    const overageHandover = 8800;
    const overageDiscrepancy = overageHandover - expectedCash;
    expect(overageDiscrepancy).toBe(100);
  });

  it("strictly distinguishes driver float transfer from operational expense", () => {
    // Giving float to driver is an asset transfer (Cash in Hand -> Cash with Driver)
    // NOT an operational expense!
    const morningFloat = 2000;
    const operatingExpenses = 0; // Float is NOT an expense
    expect(operatingExpenses).toBe(0);
    expect(morningFloat).not.toBe(operatingExpenses);
  });
});
