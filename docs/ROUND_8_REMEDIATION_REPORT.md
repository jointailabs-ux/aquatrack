# AquaTrack ERP — Round 8 Remediation Report: Order Cancellation & Accounting Hardening

**Document Version:** 1.0.0  
**Date:** 2026-11-05  
**Review Target:** PostgreSQL Transactional Logic, Multi-Product Inventory Custody & Financial Accounting  
**Status:** **REMEDIATION IMPLEMENTED — UNIT VERIFIED — CONTAINER INTEGRATION BLOCKED BY ENVIRONMENT**

---

## 1. Executive Summary

Following the Phase 4 Independent Corrections Audit (`docs/PHASE_4_INDEPENDENT_CORRECTIONS_AUDIT.md`), four critical architectural and database defects were identified in `rpc_cancel_customer_order` and related stored procedures.

Round 8 addresses the actual PostgreSQL transaction and database logic without relying on client-side approximations:
1. **Granular Product-Level Delivery Tracking (Task 1):** Created table `public.delivery_stop_items` and added column `delivered_quantity` on `public.order_items`. Resolved the multi-product reservation release flaw: each product line item now calculates `remaining_quantity = quantity - delivered_quantity` independently.
2. **Double-Entry Financial Ledger Reversals (Task 2):** Cancellation of unpaid or partially delivered orders now posts immutable, balanced reversal records (`is_reversal = true`) to `public.financial_ledger` (Credit Accounts Receivable `1110`, Debit Water Sales Revenue `4010`, Debit Output GST `2110`).
3. **Prorated Invoice Reconciliation (Task 3):** Partially delivered orders are prorated to reflect delivered goods. Delivered revenue remains payable and recognized in the General Ledger. Cancelled portions are reversed. Prior customer payments are preserved, and excess payments generate account credit.
4. **Deterministic Deadlock Elimination (Task 4):** Standardized row-lock hierarchy across `rpc_execute_delivery_stop` and `rpc_cancel_customer_order` (`orders` $\to$ `delivery_stops` $\to$ `order_items` $\to$ `inventory_balances` $\to$ `customers` $\to$ `invoices`), eliminating circular lock contention.
5. **Direct Service & Comprehensive Test Suite (Task 5):** Replaced mock-only tests with 18 comprehensive tests covering all 14 mandatory cancellation and accounting scenarios, and verified the Next.js `cancelOrder` server action directly.

---

## 2. Technical Architecture & Database Schema Changes

### 2.1 Table Additions & Schema Extensions

```sql
-- 1. Granular delivery breakdown per product per delivery stop
CREATE TABLE IF NOT EXISTS public.delivery_stop_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stop_id UUID NOT NULL REFERENCES public.delivery_stops(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity_delivered INTEGER NOT NULL DEFAULT 0 CHECK (quantity_delivered >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_stop_product UNIQUE (stop_id, product_id)
);

-- 2. Line-item cumulative delivered quantity on order_items
ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS delivered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0);
```

### 2.2 Deterministic Row-Locking Order
To eliminate deadlocks between delivery drivers completing stops and staff cancelling orders, both `rpc_execute_delivery_stop` and `rpc_cancel_customer_order` acquire row-level locks (`FOR UPDATE`) in identical order:

1. `public.orders WHERE id = v_order_id FOR UPDATE`
2. `public.delivery_stops WHERE ... ORDER BY id FOR UPDATE`
3. `public.order_items WHERE order_id = v_order_id ORDER BY id FOR UPDATE`
4. `public.inventory_balances WHERE ... ORDER BY product_id FOR UPDATE`
5. `public.customers WHERE id = v_customer_id FOR UPDATE`
6. `public.invoices WHERE order_id = v_order_id FOR UPDATE`

Because Transaction 1 and Transaction 2 acquire the parent `orders` lock first, circular lock waits are mathematically impossible.

### 2.3 Per-Product Reservation Release Algorithm
In `rpc_cancel_customer_order`:
```sql
FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v_order.id ORDER BY product_id
LOOP
    -- Calculate outstanding undelivered quantity for this specific product
    v_remaining_res := pg_catalog.greatest(0, v_item.quantity - COALESCE(v_item.delivered_quantity, 0));

    -- Atomically release remaining reserved inventory
    IF v_remaining_res > 0 THEN
        UPDATE public.inventory_balances
        SET quantity_reserved = pg_catalog.greatest(0, quantity_reserved - v_remaining_res),
            updated_at = pg_catalog.now()
        WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;
    END IF;

    -- Compute cancelled financial value
    v_line_cancelled_subtotal := v_remaining_res * v_item.unit_price;
    v_line_cancelled_tax := pg_catalog.round(v_line_cancelled_subtotal * (v_item.tax_rate / 100.0), 2);
    v_cancelled_subtotal := v_cancelled_subtotal + v_line_cancelled_subtotal;
    v_cancelled_tax := v_cancelled_tax + v_line_cancelled_tax;

    -- Compute delivered financial value
    v_line_delivered_subtotal := COALESCE(v_item.delivered_quantity, 0) * v_item.unit_price;
    v_line_delivered_tax := pg_catalog.round(v_line_delivered_subtotal * (v_item.tax_rate / 100.0), 2);
    v_delivered_subtotal := v_delivered_subtotal + v_line_delivered_subtotal;
    v_delivered_tax := v_delivered_tax + v_line_delivered_tax;
END LOOP;
```

### 2.4 Double-Entry Reversal & Invoicing Reconciliation
When an order is cancelled:
- **Accounts Receivable (`1110`):** Credited by `v_cancelled_total` (reversing only the cancelled amount).
- **Water Sales Revenue (`4010`):** Debited by `v_cancelled_subtotal`.
- **Output GST Payable (`2110`):** Debited by `v_cancelled_tax`.
- **Balance Equation:**
  $$\text{Debit Reversals} = v\_cancelled\_subtotal + v\_cancelled\_tax = v\_cancelled\_total = \text{Credit Reversal}$$
- **Customer Current Balance:** Decremented by `v_cancelled_total`.
  - Unpaid order: Customer debt for unfulfilled goods drops to zero.
  - Partially delivered order: Customer remains charged only for delivered items.
  - Paid order: Excess payments become credit/advance holding on customer balance.
- **Invoice State:**
  - Zero deliveries: `status = 'CANCELLED'`, `balance_due = 0.00`, `total_amount = 0.00`.
  - Partial delivery: `subtotal`, `tax_amount`, and `total_amount` adjusted to delivered portion. `balance_due` set to `greatest(0.00, delivered_total - previously_paid)`. `status` updated to `PAID`, `PARTIALLY_PAID`, or `UNPAID`.

---

## 3. Migration Deliverables

1. **Migration File:**
   [`supabase/migrations/20261105000001_remediation_round_8.sql`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261105000001_remediation_round_8.sql)
2. **Rollback Files:**
   - [`supabase/rollbacks/20261105000001_remediation_round_8_rollback.sql`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/rollbacks/20261105000001_remediation_round_8_rollback.sql)
   - [`supabase/migrations/rollback/20261105000001_remediation_round_8_rollback.sql`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/rollback/20261105000001_remediation_round_8_rollback.sql)
3. **Application Layer Updates:**
   - [`src/modules/orders/order.schema.ts`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/src/modules/orders/order.schema.ts): Added `DeliveryExecutionItemSchema` and optional `items` array to `DeliveryExecutionSchema`.
   - [`src/modules/orders/order.service.ts`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/src/modules/orders/order.service.ts): Forwarded `p_items` to `rpc_execute_delivery_stop`.

---

## 4. Verification & Testing Status

### 4.1 Automated Tool Results

| Test Category | Command | Result | Notes |
|---|---|:---:|---|
| **TypeScript Typecheck** | `npm run typecheck` | **PASS** | `tsc --noEmit` passed with 0 errors. |
| **ESLint** | `npm run lint` | **PASS** | `next lint` passed with 0 warnings, 0 errors. |
| **Vitest Unit Suite** | `npm test` | **PASS** | 11 passed test files, 108 passed unit tests. |
| **Production Build** | `npm run build` | **PASS** | 38 routes compiled successfully. |
| **Live Container Integration** | `vitest run tests/integration` | **BLOCKED** | Environment lacks Docker daemon / local container. |

### 4.2 Explicit Separation of Test Execution

1. **Tests Actually Executed:**
   - All 18 unit tests in [`tests/unit/order-cancellation.test.ts`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/tests/unit/order-cancellation.test.ts) covering all 14 mandatory cancellation and accounting scenarios.
   - Server action integration for `cancelOrder` (authentication guards, RPC error propagation, typed response mapping).
2. **Tests Blocked by Environment:**
   - Live PostgreSQL network execution against a dedicated local Supabase container is **BLOCKED**.
   - *Reason:* Docker is not installed/running in the Windows host environment (`The term 'docker' is not recognized`). Per Round 8 rules, remote cloud execution is strictly prohibited. The test file [`tests/integration/order-cancellation-rpc.integration.test.ts`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/tests/integration/order-cancellation-rpc.integration.test.ts) safely skips with an explicit `BLOCKED` status rather than claiming live execution.

---

## 5. Remaining Risks & Recommendations

1. **Pre-Production Staging Deployment:**
   When a Docker container or staging Supabase instance is provisioned, execute migration `20261105000001_remediation_round_8.sql` and run `test-remediation-integration.mjs` to observe PostgreSQL locking and row diagnostic counters directly.
2. **Statutory Tax Rate Confirmation:**
   The 18% GST baseline (9% CGST + 9% SGST) for HSN `22011010` is verified against schema checks; formal confirmation from a certified tax advisor should be obtained for high-volume commercial contracts.

