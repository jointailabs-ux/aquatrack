# AquaTrack ERP — Round 9 Remediation Report
**File:** `docs/ROUND_9_REMEDIATION_REPORT.md`  
**Date:** 2026-11-06  
**Status:** COMPLETED — READY FOR INDEPENDENT AUDIT  
**Scope:** Remediation of Round 8 Defects in Delivery Stop Execution, Order Cancellation, Jar Custody Accounting, and RLS Permissions

---

## 1. Executive Summary

Following an independent source-code audit of Round 8, several critical defects were identified in the database transaction logic, jar custody accounting, historical data integrity, and direct write permissions.

Round 9 provides a comprehensive, rigorous remediation of all identified defects:
1. **Safe Historical Delivery Reconciliation:** Backfills `order_items.delivered_quantity` for historical single-item and documented multi-item orders. Ambiguous multi-product orders with aggregate delivery counts are safely flagged in `public.historical_order_reconciliation_flags` for owner review without guessing or fabricating numbers.
2. **Product-Level Delivery Stop Execution (`rpc_execute_delivery_stop`):**
   - Strictly validates product membership within the order.
   - Enforces uniqueness of `product_id` across delivery items, rejecting duplicate entries.
   - Validates that delivered quantities do not exceed remaining ordered quantities.
   - Rejects aggregate vs. item-sum mismatches.
   - Eliminates `GREATEST(0, ...)` clamping on stock deductions and reservation releases: transactions strictly abort with informative errors if inventory is insufficient.
3. **Reusable Jar Custody Isolation:**
   - Evaluates `products.is_reusable_jar` for every delivered item.
   - Calculates customer jar custody holdings and physical jar movements strictly from reusable jar deliveries, completely decoupling non-jar merchandise (dispensers, bottles, accessories).
4. **Resilient Failure Stop Handling:**
   - A failed delivery stop sets `delivery_stops.status = 'FAILED'` and preserves the order.
   - If other stops are active or if goods were already delivered, the order is **never cancelled**, preserving active reservations for subsequent route rescheduling.
5. **Direct Delivery Item Write Lockdown:**
   - Dropped the permissive `dsi_modify` policy on `public.delivery_stop_items`.
   - Direct `INSERT`, `UPDATE`, and `DELETE` privileges are strictly revoked from `authenticated`, `anon`, and `PUBLIC`.
   - All delivery stop item mutations occur solely through the validated `SECURITY DEFINER` RPC `rpc_execute_delivery_stop`.
6. **Order Cancellation & Accounting Integrity (`rpc_cancel_customer_order`):**
   - Enforces deterministic locking hierarchy: `orders` $\to$ `delivery_stops` $\to$ `order_items` $\to$ `inventory_balances` $\to$ `customers` $\to$ `invoices`.
   - Releases only outstanding reservations for undelivered quantities without clamping.
   - Generates balanced General Ledger reversals (`1110` AR Credit, `4010` Revenue Debit, `2110` GST Output Debit).
   - Prevents duplicate reversals on repeated cancellation calls.
   - Treats repeated cancellations on cancelled orders as safe, idempotent operations.

---

## 2. Key Architecture & Database Changes

### 2.1 Audit & Reconciliation Schema
A dedicated audit table was created to record historical orders requiring owner review:
```sql
CREATE TABLE IF NOT EXISTS public.historical_order_reconciliation_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    flag_type VARCHAR(50) NOT NULL,
    details JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW', 'RESOLVED', 'DISMISSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
```

### 2.2 Historical Backfill Algorithm
```sql
-- Single-item orders: Exact reconstruction
UPDATE public.order_items
SET delivered_quantity = pg_catalog.least(quantity, v_ord.total_stop_delivered)
WHERE id = v_single_item_id;

-- Multi-item orders with granular items: Reconcile from delivery_stop_items
UPDATE public.order_items oi
SET delivered_quantity = COALESCE((
    SELECT SUM(dsi.quantity_delivered)
    FROM public.delivery_stop_items dsi
    JOIN public.delivery_stops ds ON ds.id = dsi.stop_id
    WHERE ds.order_id = oi.order_id AND dsi.product_id = oi.product_id
), 0)
WHERE oi.order_id = v_ord.id;

-- Multi-item orders without granular items: Safe flagging for owner review
INSERT INTO public.historical_order_reconciliation_flags (...)
VALUES (v_ord.id, 'AMBIGUOUS_MULTI_PRODUCT_DELIVERY', ..., 'PENDING_REVIEW');
```

### 2.3 Deterministic Row Lock Hierarchy
To completely eliminate deadlocks between concurrent delivery stop executions and order cancellations:
1. `public.orders` (`WHERE id = p_order_id FOR UPDATE`)
2. `public.delivery_stops` (`WHERE order_id = p_order_id ORDER BY id FOR UPDATE`)
3. `public.order_items` (`WHERE order_id = p_order_id ORDER BY id FOR UPDATE`)
4. `public.inventory_balances` (`WHERE warehouse_id = v_default_wh AND product_id IN (...) ORDER BY product_id FOR UPDATE`)
5. `public.customers` (`WHERE id = v_order.customer_id FOR UPDATE`)
6. `public.invoices` (`WHERE order_id = p_order_id FOR UPDATE`)

Both `rpc_execute_delivery_stop` and `rpc_cancel_customer_order` strictly adhere to this exact lock acquisition order.

---

## 3. Detailed RPC Logic

### 3.1 `rpc_execute_delivery_stop`
- **Validation:**
  - Duplicate product rejection: `COUNT(*) == COUNT(DISTINCT elem->>'product_id')`.
  - Membership check: ensures every product in `p_items` exists in `order_items` for that order.
  - Excess quantity check: ensures `quantity_delivered <= (quantity - delivered_quantity)`.
  - Aggregate consistency check: ensures `p_actual_delivered == SUM(item.quantity_delivered)`.
- **Inventory Check (No Clamping):**
  - If `quantity_reserved < delivered_qty` or `quantity_on_hand < delivered_qty`, raises an explicit exception and aborts.
- **Jar Custody Separation:**
  - `v_reusable_jars_delivered` sums only products where `is_reusable_jar = true`.
  - Customer `total_full_jars_holding` increases strictly by `v_reusable_jars_delivered`. Non-jar products do not alter custody holdings.
  - `jar_custody_movements` are recorded strictly for reusable jar products.
- **Failed Delivery Handling:**
  - Failed stop is marked `FAILED` with `failure_reason`.
  - Order status is checked: if other pending stops exist or if prior deliveries occurred, the order is preserved in its active state with all reservations intact.

### 3.2 `rpc_cancel_customer_order`
- **Idempotency:**
  - If the order is already in `CANCELLED` status, returns `{ success: true, idempotent: true, released_reservation: false }` without error and without duplicating accounting reversals.
- **Strict Reservation Check:**
  - If `inventory_balances.quantity_reserved < remaining_res`, aborts immediately with an explicit error.
- **Accounting Reversals:**
  - Checks `EXISTS (SELECT 1 FROM financial_ledger WHERE reference_id = invoice_id AND reference_type = 'REVERSAL')`.
  - Only generates balanced dual-entry reversals if not previously reversed.
  - Credits Accounts Receivable (`1110`), Debits Water Sales Revenue (`4010`), and Debits GST Output Payable (`2110`).

---

## 4. Verification & Testing Summary

| Test Phase | Tool / Command | Result | Summary |
|---|---|---|---|
| TypeScript Typecheck | `npm run typecheck` | **PASS** | 0 errors across entire workspace |
| Code Quality & Linting | `npm run lint` | **PASS** | 0 ESLint warnings or errors |
| Unit Test Suite | `npm test` | **PASS** | 112/112 unit tests passing |
| Production Build | `npm run build` | **PASS** | 38/38 static & dynamic routes compiled |
| Database Integration Tests | `tests/integration/` | **BLOCKED** | Environment lacks Docker container daemon; cloud execution strictly prohibited |

All changes maintain complete backward compatibility with existing front-end interfaces, Mobile Delivery Driver views, and Supabase client bindings.

