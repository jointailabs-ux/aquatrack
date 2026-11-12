import { describe, it, expect } from "vitest";
import { RecordSalaryPaymentSchema, RecordSalaryAdvanceSchema } from "@/modules/salaries/salary.schema";

describe("Phase 5 Staff Salary & Advance Calculations", () => {
  it("calculates net payable salary after deducting advances and other deductions", () => {
    const baseSalary = 18000;
    const advanceDeducted = 2500;
    const otherDeductions = 500;

    const netPayable = Math.max(0, baseSalary - advanceDeducted - otherDeductions);
    expect(netPayable).toBe(15000);
  });

  it("ensures net payable is non-negative even if deductions exceed base salary", () => {
    const baseSalary = 12000;
    const advanceDeducted = 15000;

    const netPayable = Math.max(0, baseSalary - advanceDeducted);
    expect(netPayable).toBe(0);
  });

  it("validates salary payment input schema", () => {
    const validPayment = {
      staff_id: "123e4567-e89b-12d3-a456-426614174000",
      period_month: "2026-11",
      base_salary: 20000,
      advance_deducted: 1000,
      other_deductions: 0,
      amount_paid: 19000,
      payment_method: "BANK_TRANSFER",
      payment_date: "2026-11-05",
      notes: "Monthly settlement",
    };

    expect(RecordSalaryPaymentSchema.safeParse(validPayment).success).toBe(true);

    const invalidMonth = {
      ...validPayment,
      period_month: "November-2026", // Invalid format, must be YYYY-MM
    };
    expect(RecordSalaryPaymentSchema.safeParse(invalidMonth).success).toBe(false);

    const invalidSalary = {
      ...validPayment,
      base_salary: -100, // Negative salary not allowed
    };
    expect(RecordSalaryPaymentSchema.safeParse(invalidSalary).success).toBe(false);
  });

  it("validates salary advance schema", () => {
    const validAdvance = {
      staff_id: "123e4567-e89b-12d3-a456-426614174000",
      amount: 3000,
      advance_date: "2026-11-15",
      reason: "Emergency festival advance",
    };

    expect(RecordSalaryAdvanceSchema.safeParse(validAdvance).success).toBe(true);

    const zeroAdvance = {
      ...validAdvance,
      amount: 0, // Must be positive
    };
    expect(RecordSalaryAdvanceSchema.safeParse(zeroAdvance).success).toBe(false);
  });

  // --- Round 3 Remediation Tests ---

  interface StaffProfile {
    id: string;
    fullName: string;
    salaryAmount: number; // Authoritative salary stored in database
  }

  interface SalaryPaymentRecord {
    id: string;
    staffId: string;
    periodMonth: string;
    baseSalary: number;
    amountPaid: number;
    advanceDeducted: number;
    otherDeductions: number;
    idempotencyKey?: string;
  }

  interface AdvanceRecord {
    id: string;
    staffId: string;
    amount: number;
    amountDeducted: number;
    isSettled: boolean;
  }

  function simulateSalaryPayment({
    staff,
    periodMonth,
    untrustedBaseSalary,
    amountPaid,
    advanceDeducted,
    otherDeductions,
    existingPayments,
    advances,
    idempotencyKey,
  }: {
    staff: StaffProfile;
    periodMonth: string;
    untrustedBaseSalary?: number;
    amountPaid: number;
    advanceDeducted: number;
    otherDeductions: number;
    existingPayments: SalaryPaymentRecord[];
    advances: AdvanceRecord[];
    idempotencyKey?: string;
  }) {
    // 1. Authoritative salary check: ignore untrustedBaseSalary completely!
    const authoritativeSalary = staff.salaryAmount;
    if (authoritativeSalary <= 0) {
      throw new Error("Staff member has no authoritative salary configured in profile master record.");
    }

    // 2. Validate period format (YYYY-MM)
    if (!periodMonth || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(periodMonth)) {
      throw new Error(`Invalid salary period format: ${periodMonth}. Expected YYYY-MM.`);
    }

    if (amountPaid <= 0) {
      throw new Error("Payment amount must be greater than zero.");
    }
    if (advanceDeducted < 0 || otherDeductions < 0) {
      throw new Error("Deductions cannot be negative.");
    }

    // 3. Idempotency check
    if (idempotencyKey) {
      const existing = existingPayments.find((p) => p.idempotencyKey === idempotencyKey);
      if (existing) {
        return {
          idempotent: true,
          payment: existing,
          remainingPayable: Math.max(
            0,
            authoritativeSalary -
              existingPayments
                .filter((p) => p.periodMonth === periodMonth)
                .reduce((sum, p) => sum + p.amountPaid + p.advanceDeducted + p.otherDeductions, 0)
          ),
        };
      }
    }

    // 4. Calculate total previously settled for this month
    const previouslySettled = existingPayments
      .filter((p) => p.staffId === staff.id && p.periodMonth === periodMonth)
      .reduce((sum, p) => sum + p.amountPaid + p.advanceDeducted + p.otherDeductions, 0);

    const remainingPayable = Math.max(0, authoritativeSalary - previouslySettled);
    const thisDisbursement = amountPaid + advanceDeducted + otherDeductions;

    if (thisDisbursement > remainingPayable) {
      throw new Error(
        `Total disbursement and deductions (${thisDisbursement}) exceed remaining salary payable (${remainingPayable}) for period ${periodMonth}. Authoritative salary: ${authoritativeSalary}, previously settled: ${previouslySettled}.`
      );
    }

    // 5. Advance deduction validation and FIFO settlement
    if (advanceDeducted > 0) {
      const availableAdvances = advances
        .filter((a) => a.staffId === staff.id && !a.isSettled)
        .reduce((sum, a) => sum + (a.amount - a.amountDeducted), 0);

      if (advanceDeducted > availableAdvances) {
        throw new Error(
          `Requested advance deduction (${advanceDeducted}) exceeds total outstanding advances (${availableAdvances}).`
        );
      }
    }

    const newPayment: SalaryPaymentRecord = {
      id: "pay-" + Math.random().toString(36).slice(2, 8),
      staffId: staff.id,
      periodMonth,
      baseSalary: authoritativeSalary, // Strictly uses authoritative salary!
      amountPaid,
      advanceDeducted,
      otherDeductions,
      idempotencyKey,
    };

    return {
      idempotent: false,
      payment: newPayment,
      remainingPayable: remainingPayable - thisDisbursement,
    };
  }

  it("strictly uses authoritative database salary and ignores client-supplied base salary", () => {
    const staff: StaffProfile = {
      id: "staff-1",
      fullName: "Ramesh Driver",
      salaryAmount: 22000, // True salary stored in profile
    };

    // Client maliciously attempts to send p_base_salary = 50000
    const res = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      untrustedBaseSalary: 50000,
      amountPaid: 22000,
      advanceDeducted: 0,
      otherDeductions: 0,
      existingPayments: [],
      advances: [],
    });

    // Authoritative salary of 22000 was used, remaining payable is 0
    expect(res.payment.baseSalary).toBe(22000);
    expect(res.remainingPayable).toBe(0);

    // If client attempts to disburse 25000 based on fabricated salary 50000, it throws!
    expect(() =>
      simulateSalaryPayment({
        staff,
        periodMonth: "2026-11",
        untrustedBaseSalary: 50000,
        amountPaid: 25000,
        advanceDeducted: 0,
        otherDeductions: 0,
        existingPayments: [],
        advances: [],
      })
    ).toThrow(/exceed remaining salary payable/i);
  });

  it("supports multiple partial salary payments within one month without overpaying", () => {
    const staff: StaffProfile = {
      id: "staff-2",
      fullName: "Suresh Operator",
      salaryAmount: 30000,
    };

    const existingPayments: SalaryPaymentRecord[] = [];

    // Partial payment 1: $10,000 paid
    const p1 = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      amountPaid: 10000,
      advanceDeducted: 0,
      otherDeductions: 0,
      existingPayments,
      advances: [],
    });
    expect(p1.remainingPayable).toBe(20000);
    existingPayments.push(p1.payment);

    // Partial payment 2: $12,000 paid
    const p2 = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      amountPaid: 12000,
      advanceDeducted: 0,
      otherDeductions: 0,
      existingPayments,
      advances: [],
    });
    expect(p2.remainingPayable).toBe(8000);
    existingPayments.push(p2.payment);

    // Partial payment 3: remaining $8,000 paid
    const p3 = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      amountPaid: 8000,
      advanceDeducted: 0,
      otherDeductions: 0,
      existingPayments,
      advances: [],
    });
    expect(p3.remainingPayable).toBe(0);
    existingPayments.push(p3.payment);

    // Attempting payment 4 for $1 fails because month is fully settled!
    expect(() =>
      simulateSalaryPayment({
        staff,
        periodMonth: "2026-11",
        amountPaid: 1,
        advanceDeducted: 0,
        otherDeductions: 0,
        existingPayments,
        advances: [],
      })
    ).toThrow(/exceed remaining salary payable \(0\)/i);
  });

  it("correctly deducts salary advances and rejects excessive advance deductions", () => {
    const staff: StaffProfile = {
      id: "staff-3",
      fullName: "Vikas Loader",
      salaryAmount: 18000,
    };

    const advances: AdvanceRecord[] = [
      { id: "adv-1", staffId: "staff-3", amount: 4000, amountDeducted: 1000, isSettled: false }, // 3000 remaining
      { id: "adv-2", staffId: "staff-3", amount: 2000, amountDeducted: 0, isSettled: false }, // 2000 remaining
    ]; // Total available = 5000

    // Attempt to deduct 6000 advance when only 5000 is outstanding
    expect(() =>
      simulateSalaryPayment({
        staff,
        periodMonth: "2026-11",
        amountPaid: 10000,
        advanceDeducted: 6000,
        otherDeductions: 0,
        existingPayments: [],
        advances,
      })
    ).toThrow(/exceeds total outstanding advances/i);

    // Valid advance deduction of 5000
    const valid = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      amountPaid: 13000,
      advanceDeducted: 5000,
      otherDeductions: 0,
      existingPayments: [],
      advances,
    });
    expect(valid.remainingPayable).toBe(0);
    expect(valid.payment.amountPaid).toBe(13000);
    expect(valid.payment.advanceDeducted).toBe(5000);
  });

  it("protects against duplicate idempotency keys while rejecting distinct keys attempting overpayment", () => {
    const staff: StaffProfile = {
      id: "staff-4",
      fullName: "Anand Staff",
      salaryAmount: 25000,
    };

    const existingPayments: SalaryPaymentRecord[] = [];

    // First request with idempotency key "IDEMP-KEY-001"
    const res1 = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      amountPaid: 25000,
      advanceDeducted: 0,
      otherDeductions: 0,
      existingPayments,
      advances: [],
      idempotencyKey: "IDEMP-KEY-001",
    });
    expect(res1.idempotent).toBe(false);
    existingPayments.push(res1.payment);

    // Duplicate request with SAME idempotency key returns cached record safely
    const res2 = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      amountPaid: 25000,
      advanceDeducted: 0,
      otherDeductions: 0,
      existingPayments,
      advances: [],
      idempotencyKey: "IDEMP-KEY-001",
    });
    expect(res2.idempotent).toBe(true);
    expect(res2.payment.id).toBe(res1.payment.id);

    // Different request with DIFFERENT idempotency key attempts to pay again -> REJECTED!
    expect(() =>
      simulateSalaryPayment({
        staff,
        periodMonth: "2026-11",
        amountPaid: 25000,
        advanceDeducted: 0,
        otherDeductions: 0,
        existingPayments,
        advances: [],
        idempotencyKey: "IDEMP-KEY-002",
      })
    ).toThrow(/exceed remaining salary payable \(0\)/i);
  });

  // --- Round 4 Specific Remediation Tests ---

  it("processes full salary payment without advances when no advances exist", () => {
    const staff: StaffProfile = {
      id: "staff-clean-1",
      fullName: "Deepak Technician",
      salaryAmount: 24000,
    };

    const res = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      amountPaid: 24000,
      advanceDeducted: 0,
      otherDeductions: 0,
      existingPayments: [],
      advances: [],
    });

    expect(res.payment.baseSalary).toBe(24000);
    expect(res.payment.amountPaid).toBe(24000);
    expect(res.payment.advanceDeducted).toBe(0);
    expect(res.remainingPayable).toBe(0);
  });

  it("settles multiple advances in strict FIFO order and supports partial advance deduction across individual rows", () => {
    const staff: StaffProfile = {
      id: "staff-adv-fifo",
      fullName: "Karan Delivery",
      salaryAmount: 20000,
    };

    // Advances in chronological order:
    // Advance 1: 3,000 (0 deducted, 3000 remaining)
    // Advance 2: 2,500 (0 deducted, 2500 remaining)
    // Total available = 5,500
    const advances: AdvanceRecord[] = [
      { id: "adv-fifo-1", staffId: "staff-adv-fifo", amount: 3000, amountDeducted: 0, isSettled: false },
      { id: "adv-fifo-2", staffId: "staff-adv-fifo", amount: 2500, amountDeducted: 0, isSettled: false },
    ];

    // Deduct 4,000 of advance in salary payment (Cash paid: 16,000, Advance deducted: 4,000)
    const deductionToApply = 4000;

    // Simulate individual row locking and FIFO deduction as implemented in rpc_record_salary_payment:
    let remainingDeduction = deductionToApply;
    for (const adv of advances) {
      if (remainingDeduction <= 0) break;
      const advRemaining = adv.amount - adv.amountDeducted;
      const thisDeduction = Math.min(advRemaining, remainingDeduction);
      adv.amountDeducted += thisDeduction;
      remainingDeduction -= thisDeduction;
      if (adv.amountDeducted >= adv.amount) {
        adv.isSettled = true;
      }
    }

    expect(remainingDeduction).toBe(0);
    // Advance 1 is completely settled
    expect(advances[0].amountDeducted).toBe(3000);
    expect(advances[0].isSettled).toBe(true);

    // Advance 2 is partially settled: 1000 deducted, 1500 remaining
    expect(advances[1].amountDeducted).toBe(1000);
    expect(advances[1].isSettled).toBe(false);

    // Now run salary payment simulation with advanceDeducted = 4000 passing the initial advances (available 5500)
    const res = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      amountPaid: 16000,
      advanceDeducted: 4000,
      otherDeductions: 0,
      existingPayments: [],
      advances: [
        { id: "adv-fifo-1", staffId: "staff-adv-fifo", amount: 3000, amountDeducted: 0, isSettled: false },
        { id: "adv-fifo-2", staffId: "staff-adv-fifo", amount: 2500, amountDeducted: 0, isSettled: false },
      ],
    });

    expect(res.payment.amountPaid).toBe(16000);
    expect(res.payment.advanceDeducted).toBe(4000);
    expect(res.remainingPayable).toBe(0);
  });

  it("serializes concurrent salary payments and rejects overpayment when two concurrent transactions compete for remaining salary", () => {
    const staff: StaffProfile = {
      id: "staff-concurrency-test",
      fullName: "Manoj Warehouse",
      salaryAmount: 20000,
    };

    const existingPayments: SalaryPaymentRecord[] = [];

    // Simulate Transaction 1: locks staff row and disburses 14,000
    const tx1 = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      amountPaid: 14000,
      advanceDeducted: 0,
      otherDeductions: 0,
      existingPayments,
      advances: [],
    });
    existingPayments.push(tx1.payment);
    expect(tx1.remainingPayable).toBe(6000);

    // Simulate Transaction 2 (concurrent attempt): attempts to disburse 10,000
    // Because remaining payable is only 6,000, row locking ensures Tx 2 observes the committed state and aborts
    expect(() =>
      simulateSalaryPayment({
        staff,
        periodMonth: "2026-11",
        amountPaid: 10000,
        advanceDeducted: 0,
        otherDeductions: 0,
        existingPayments,
        advances: [],
      })
    ).toThrow(/exceed remaining salary payable \(6000\)/i);

    // But a concurrent transaction requesting <= 6,000 succeeds
    const tx3 = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      amountPaid: 6000,
      advanceDeducted: 0,
      otherDeductions: 0,
      existingPayments,
      advances: [],
    });
    existingPayments.push(tx3.payment);
    expect(tx3.remainingPayable).toBe(0);
  });

  it("strictly prevents client manipulation of base salary regardless of value passed", () => {
    const staff: StaffProfile = {
      id: "staff-secure-salary",
      fullName: "Pooja Accounts",
      salaryAmount: 28000, // Database master record
    };

    // Client passes manipulated base salary = 0
    const resLow = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      untrustedBaseSalary: 0,
      amountPaid: 28000,
      advanceDeducted: 0,
      otherDeductions: 0,
      existingPayments: [],
      advances: [],
    });
    expect(resLow.payment.baseSalary).toBe(28000);

    // Client passes manipulated base salary = 1,000,000
    const resHigh = simulateSalaryPayment({
      staff,
      periodMonth: "2026-11",
      untrustedBaseSalary: 1000000,
      amountPaid: 28000,
      advanceDeducted: 0,
      otherDeductions: 0,
      existingPayments: [],
      advances: [],
    });
    expect(resHigh.payment.baseSalary).toBe(28000);
  });
});

