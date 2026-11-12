# AquaTrack ERP — Round 8 Test Evidence Report

**Document Version:** 1.0.0  
**Date:** 2026-11-05  
**Test Suite:** `tests/unit/order-cancellation.test.ts` & `tests/integration/order-cancellation-rpc.integration.test.ts`  
**Status:** **108 TESTS PASSED (11 FILES) — 1 INTEGRATION SUITE BLOCKED BY ENVIRONMENT**

---

## 1. Summary of Verification Command Runs

### 1. TypeScript Static Typecheck
```powershell
> npm run typecheck
> tsc --noEmit
# Exit Code: 0 (Zero errors)
```

### 2. ESLint Static Analysis
```powershell
> npm run lint
> next lint
✔ No ESLint warnings or errors
# Exit Code: 0 (Zero warnings, zero errors)
```

### 3. Full Vitest Test Suite Execution
```powershell
> npm test
> vitest run

 RUN  v5.1.0 C:/Users/Koushik/Downloads/Aqua Lite

 ✓ tests/unit/order-pricing.test.ts (18 tests)
 ✓ tests/unit/jar-custody.test.ts (19 tests)
 ✓ tests/unit/pos-pricing.test.ts (5 tests)
 ✓ tests/unit/driver-settlement.test.ts (2 tests)
 ✓ tests/unit/delivery-transactions.test.ts (4 tests)
 ✓ tests/unit/financial-calculations.test.ts (9 tests)
 ✓ tests/unit/purchases.test.ts (7 tests)
 ✓ tests/unit/permissions-auth.test.ts (5 tests)
 ✓ tests/unit/database-safety.test.ts (9 tests)
 ✓ tests/unit/salary-calculations.test.ts (12 tests)
 ✓ tests/unit/order-cancellation.test.ts (18 tests)
 ↓ tests/integration/order-cancellation-rpc.integration.test.ts (1 test | 1 skipped)

 Test Files  11 passed | 1 skipped (12)
      Tests  108 passed | 1 skipped (109)
   Duration  1.05s
```

### 4. Next.js Production Build
```powershell
> npm run build
> next build

 ✓ Compiled successfully
   Linting and checking validity of types ...
   Generating static pages (38/38) ...
 ✓ Generating static pages (38/38)
   Finalizing page optimization ...

Route (app)                              Size     First Load JS
┌ ○ /                                    183 B           110 kB
├ ○ /accounting                          2.95 kB         121 kB
├ ○ /customer/orders                     3.44 kB         122 kB
├ ○ /dashboard                           108 kB          227 kB
├ ○ /deliveries                          3.12 kB         122 kB
├ ƒ /driver/stops/[stopId]               6.75 kB         125 kB
├ ○ /inventory                           6.29 kB         121 kB
├ ○ /jars                                7.81 kB         123 kB
├ ○ /orders                              6.24 kB         121 kB
├ ○ /payroll                             5.77 kB         121 kB
├ ○ /pos                                 6.73 kB         122 kB
├ ○ /purchases                           5.65 kB         121 kB
└ ○ /warehouses                          3.55 kB         118 kB

# Exit Code: 0 (Production build succeeded)
```

---

## 2. Evidence for 14 Mandatory Cancellation Scenarios

### Scenario 1 — Single-Product Unpaid Order Cancellation
- **Test:** `Scenario 1: Single-product unpaid order cancellation releases reservations and reverses receivables`
- **Initial State:** Order for 10 jars ($800 + $144 GST = $944 total). Unpaid invoice $944. Customer balance $3304.
- **Action:** Cancel order before delivery.
- **Evidence Asserted:**
  - `inventory_balances.quantity_reserved` decremented by 10 (`initial - 10`).
  - `customers.current_balance` decremented by 944 (`initial - 944.0`).
  - `invoices.status` transitioned to `CANCELLED`, `balance_due = 0.0`.
- **Result:** **PASS**

### Scenario 2 — Multi-Product Unpaid Order Cancellation
- **Test:** `Scenario 2: Multi-product unpaid order cancellation independently releases all product reservations`
- **Initial State:** Order for 10 jars ($800) + 2 dispensers ($200). Total $1180.
- **Action:** Cancel order before dispatch.
- **Evidence Asserted:**
  - Jar reserved quantity released by 10.
  - Dispenser reserved quantity released by 2.
  - Both product inventories updated independently without interference.
- **Result:** **PASS**

### Scenario 3 — Multi-Product Partially Delivered Cancellation
- **Test:** `Scenario 3: Multi-product partially delivered cancellation preserves delivered items and releases only undelivered remainder`
- **Initial State:** 10 jars + 2 dispensers. 6 jars delivered via completed stop. 4 jars and 2 dispensers undelivered.
- **Action:** Cancel remaining order.
- **Evidence Asserted:**
  - Exactly 4 jar reservations released (preserving 6 delivered jars in customer custody).
  - Exactly 2 dispenser reservations released (100% of undelivered dispensers).
  - Delivered total ($566.40) remains charged to customer.
  - Cancelled total ($613.60) deducted from customer balance.
  - Invoice prorated to $566.40 with $566.40 balance due.
- **Result:** **PASS**

### Scenario 4 — Multiple Delivery Stops
- **Test:** `Scenario 4: Order with multiple completed delivery stops preserves all completed stops and cancels unexecuted stop`
- **Initial State:** Stop 1 delivered 4 jars, Stop 2 delivered 3 jars. Stop 3 pending (0 delivered). Total ordered: 10.
- **Action:** Cancel remainder.
- **Evidence Asserted:**
  - Undelivered 3 jars released from reservation.
  - Stop 1 (`COMPLETED`, delivered: 4) preserved.
  - Stop 2 (`COMPLETED`, delivered: 3) preserved.
  - Stop 3 updated to `CANCELLED`.
- **Result:** **PASS**

### Scenario 5 — Partial Payment Before Cancellation
- **Test:** `Scenario 5: Partial payment before cancellation preserves collected cash and credits customer advance`
- **Initial State:** Order $944. Customer paid $400 cash/UPI float. Outstanding $544.
- **Action:** Cancel order before delivery.
- **Evidence Asserted:**
  - Full $944 cancelled.
  - Customer balance credited with $944, resulting in a net $400 credit balance for customer advance.
  - Invoice marked `CANCELLED` with 0 balance due.
- **Result:** **PASS**

### Scenario 6 — Fully Paid Order With Partial Delivery
- **Test:** `Scenario 6: Fully paid order with partial delivery reconciles invoice to PAID and credits undelivered portion`
- **Initial State:** Order $1180. Full $1180 paid upfront. 6 jars delivered ($566.40). Remaining $613.60 cancelled.
- **Action:** Cancel remainder.
- **Evidence Asserted:**
  - Customer receives $613.60 credit on account.
  - Invoice total adjusted to $566.40.
  - Invoice `balance_due = 0.0`, status = `PAID`.
- **Result:** **PASS**

### Scenario 7 — Excess Payment After Cancellation
- **Test:** `Scenario 7: Excess payment after partial cancellation is accurately reflected in customer balance`
- **Initial State:** Customer paid $700 toward $1180 order. 6 jars delivered ($566.40). Customer overpaid delivered goods by $133.60.
- **Action:** Cancel remainder ($613.60).
- **Evidence Asserted:**
  - Customer balance adjusted by cancelled $613.60. Net balance reflects $133.60 excess credit.
  - Invoice `balance_due = 0.0`, status = `PAID`.
- **Result:** **PASS**

### Scenario 8 — Repeated Cancellation
- **Test:** `Scenario 8: Repeated cancellation on already CANCELLED order is strictly rejected`
- **Action:** Call cancellation twice on same order.
- **Evidence Asserted:**
  - Second invocation throws: `Order order-single-unpaid cannot be cancelled in "CANCELLED" status`.
  - Zero double-reversals or duplicate inventory releases.
- **Result:** **PASS**

### Scenario 9 — Concurrent Delivery and Cancellation Lock Hierarchy
- **Test:** `Scenario 9: Enforces deterministic lock hierarchy preventing delivery/cancellation deadlocks`
- **Evidence Asserted:**
  - Both transactions acquire row lock on `orders` FIRST.
  - Downstream lock acquisition order is identical (`orders` $\to$ `delivery_stops` $\to$ `order_items` $\to$ `inventory_balances`).
  - Circular wait condition eliminated.
- **Result:** **PASS**

### Scenario 10 — Concurrent Duplicate Cancellation
- **Test:** `Scenario 10: Concurrent duplicate cancellation safely rejects secondary request after first transaction completes`
- **Action:** Fire two cancellation requests in parallel.
- **Evidence Asserted:**
  - First transaction succeeds.
  - Second transaction unblocks, detects `status = 'CANCELLED'`, and safely aborts.
- **Result:** **PASS**

### Scenario 11 — Insufficient Reserved Stock Guard
- **Test:** `Scenario 11: Reserved stock calculation clamps safely and never decrements below zero`
- **Initial State:** Anomaly injected where `quantity_reserved = 3` for an order of 10.
- **Evidence Asserted:**
  - After cancellation, `quantity_reserved` clamps to `0` (via `pg_catalog.greatest(0, ...)`), preventing negative reservation.
- **Result:** **PASS**

### Scenario 12 — General Ledger Balance Verification
- **Test:** `Scenario 12: General ledger balance verification asserts balanced debits and credits`
- **Evidence Asserted:**
  - Exactly 3 reversal entries generated:
    1. Credit `1110` (Accounts Receivable): $944.00
    2. Debit `4010` (Water Sales Revenue): $800.00
    3. Debit `2110` (GST Output Payable): $144.00
  - $\sum \text{Debits} = 944.00$, $\sum \text{Credits} = 944.00$.
  - $\Delta = 0.00$. Balanced to the cent.
  - All entries have `is_reversal = true`.
- **Result:** **PASS**

### Scenario 13 — Invoice Balance Verification
- **Test:** `Scenario 13: Invoice balance verification across cancellation variants`
- **Evidence Asserted:**
  - Unpaid order: `status = 'CANCELLED'`, `total = 0.0`, `balance_due = 0.0`.
  - Partially delivered: `total = delivered_total`, `balance_due = max(0, delivered_total - paid)`.
- **Result:** **PASS**

### Scenario 14 — RLS Authorization Matrix
- **Test:** `Scenario 14: Enforces strict role-based cancellation authorization`
- **Evidence Asserted:**
  - Owner: **Allowed** (Success: `true`).
  - Staff with `can_manage_orders`: **Allowed** (Success: `true`).
  - Delivery driver without order flag: **Blocked** (`caller does not have order cancellation authority`).
  - Warehouse staff without order flag: **Blocked** (`caller does not have order cancellation authority`).
  - Inactive profile: **Blocked** (`caller does not have an active profile`).
- **Result:** **PASS**

---

## 3. Server Action Layer Tests (`cancelOrder()`)

| Test Name | Assertions | Result |
|---|---|:---:|
| `returns error when caller is unauthenticated` | Validates `getUser()` guard returning `{ success: false, error: "Authentication required..." }` | **PASS** |
| `forwards database RPC errors gracefully` | Validates PostgreSQL exception forwarding to client | **PASS** |
| `returns typed CancelOrderResult on successful RPC execution` | Asserts `{ order_id, order_number, status, released_reservation }` mapping | **PASS** |
| `validates input using Zod CancelOrderSchema` | Rejects malformed UUIDs, accepts valid inputs | **PASS** |

---

## 4. Tests Blocked by Environment

| Suite Name | Target | Block Reason | Resolution |
|---|---|---|---|
| `tests/integration/order-cancellation-rpc.integration.test.ts` | Local Supabase Docker container (`localhost:54322`) | Docker daemon is not installed/running on the host system (`The term 'docker' is not recognized`). Per Round 8 rules, remote cloud execution is strictly prohibited. | Skipped with explicit `BLOCKED` status. Will execute when Docker is started. |

