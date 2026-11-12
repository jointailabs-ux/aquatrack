# AquaTrack ERP — Phase 4 Independent Corrections Audit

**Reviewer:** Senior PostgreSQL, Supabase, Next.js & Application Security Auditor  
**Audit Date:** 2026-11-05  
**Target Environment:** Connected Supabase Instance (`bplpyitmcqqebpdyochz.supabase.co`)  
**Assessment Result:** **NOT APPROVED — CORRECTIONS REQUIRED**

---

## Executive Summary

An independent, rigorous code and database security audit was conducted on the Phase 4 deliverables:
1. `supabase/manual-fixes/01_remove_legacy_order_rpc.sql`
2. `supabase/manual-fixes/02_seed_reusable_jar_product.sql`
3. `src/modules/orders/order.schema.ts`
4. `src/modules/orders/order.service.ts`
5. `tests/unit/order-cancellation.test.ts`
6. `docs/PHASE_4_FINAL_CORRECTIONS.md`
7. `docs/PHASE_4_INTEGRATION_TEST_PLAN.md`
8. Live RPC definition `public.rpc_cancel_customer_order` from `supabase/migrations/20261104000005_remediation_round_7.sql`

While the static code checks, TypeScript compiler, ESLint, Vitest test suite, and Next.js production build pass with zero errors, a deep line-by-line inspection of the underlying PostgreSQL stored procedures and test architecture revealed **two CRITICAL** and **two HIGH** severity flaws in the order cancellation and inventory reconciliation workflows.

Passing unit tests and successful builds concealed fundamental accounting and multi-product inventory release errors because the unit tests relied entirely on an in-memory JavaScript simulation and tested exclusively single-item orders.

---

## Summary of Findings

| ID | Category | Description | Severity | Status |
|:---|:---|:---|:---:|:---:|
| **SEC-P4-001** | Inventory & RPC Logic | Multi-product orders experience inventory reservation leakage upon cancellation | **CRITICAL** | **FAIL** |
| **SEC-P4-002** | Accounting & Ledger | `rpc_cancel_customer_order` fails to post reversal entries to `financial_ledger` | **CRITICAL** | **FAIL** |
| **SEC-P4-003** | Invoicing & Receivables | Partial delivery order cancellations cause revenue loss or incorrect billing | **HIGH** | **FAIL** |
| **SEC-P4-004** | Concurrency & Locking | Inconsistent lock ordering between delivery execution and cancellation creates deadlock hazard | **HIGH** | **FAIL** |
| **SEC-P4-005** | Test Engineering | Unit test suite tests an in-memory JS simulation rather than application service or live RPC | **HIGH** | **FAIL** |
| **SEC-P4-006** | Statutory Compliance | GST rate (18%) and intra-state split lack formal legal/accounting documentation | **MEDIUM** | **WARNING** |
| **SEC-P4-007** | Database Maintenance | Legacy RPC removal script (`01_remove_legacy_order_rpc.sql`) is safe and idempotent | **LOW** | **PASS** |
| **SEC-P4-008** | Product & Stock Seeding | Product seed script (`02_seed_reusable_jar_product.sql`) satisfies schema constraints and zero-stock rule | **LOW** | **PASS** |

---

## 1. Review of Legacy RPC Removal SQL (`01_remove_legacy_order_rpc.sql`)

### 1.1 Signature Verification
- **Target File:** [`supabase/manual-fixes/01_remove_legacy_order_rpc.sql`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/manual-fixes/01_remove_legacy_order_rpc.sql)
- **Target Signature:**
  ```sql
  DROP FUNCTION IF EXISTS public.rpc_create_customer_order(
      UUID,   -- p_customer_id
      TEXT,   -- p_delivery_address
      DATE,   -- p_delivery_date
      UUID,   -- p_assigned_staff_id
      TEXT,   -- p_notes
      JSONB   -- p_items
  );
  ```
- **Historical Origin:** Defined in `20261104000001_remediation_round_3.sql` (lines 416–423). In Round 7 (`20261104000005_remediation_round_7.sql`), an 8-parameter version was introduced with `p_idempotency_key` and `p_price_override_reason`. PostgreSQL created an overload rather than replacing the 6-parameter version.

### 1.2 Obsolescence & Dependency Audit
- **Application Calls:** Inspected [`src/modules/orders/order.service.ts`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/src/modules/orders/order.service.ts#L210-L228). The application passes all 8 parameters targeting the Round 7 signature.
- **Database Triggers & Views:** Neither triggers, foreign keys, nor views reference the 6-parameter function OID. The trigger `check_customer_privileged_updates` checks `v_stack LIKE '%rpc_create_customer_order%'`, which matches the function name regardless of overload.
- **Root Cause of PGRST203:** Confirmed. When callers omit optional trailing parameters, PostgREST cannot choose between the exact 6-parameter function and the 8-parameter function with defaults, returning HTTP 300. Dropping the 6-parameter overload resolves the ambiguity cleanly.

### 1.3 Transaction & Verification Logic
- The script is wrapped in `BEGIN; ... COMMIT;`.
- The verification DO block counts remaining functions in `pg_proc`:
  ```sql
  SELECT COUNT(*) INTO v_func_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_create_customer_order';
  ```
  If `v_func_count != 1`, it raises an exception, aborting and rolling back the transaction.
- **Safety Rating:** **PASS (LOW RISK)**. The script is safe, idempotent, and verified.

---

## 2. Review of Product Seed SQL (`02_seed_reusable_jar_product.sql`)

### 2.1 Schema & Constraint Compliance
- **Target File:** [`supabase/manual-fixes/02_seed_reusable_jar_product.sql`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/manual-fixes/02_seed_reusable_jar_product.sql)
- **Columns Inserted:** `sku`, `name`, `category`, `unit_of_measure`, `default_sale_price`, `deposit_amount`, `cost_price`, `hsn_code`, `gst_rate`, `cgst_rate`, `sgst_rate`, `igst_rate`, `cess_rate`, `is_reusable_jar`, `is_active`.
- **Constraint Verification:**
  - `category IN ('REFILLABLE_WATER', ...)`: Value `'REFILLABLE_WATER'` satisfies constraint.
  - `chk_products_gst_balance` (`gst_rate = cgst_rate + sgst_rate`): `18.00 = 9.00 + 9.00` satisfies constraint.
  - Non-negative monetary checks (`default_sale_price >= 0`, `deposit_amount >= 0`, `cost_price >= 0`): Satisfied (`80.00`, `150.00`, `0.00`).
  - NOT NULL columns: All provided.

### 2.2 Business Setting & Dynamic Resolution
- The script dynamically resolves `deposit_amount` from `public.business_settings.default_jar_deposit` (`is_singleton = true`), with fallback to `150.00`.
- Matches the verified business setting in the database audit (`150.00 INR`).

### 2.3 Idempotency & Zero-Stock Enforcement
- **Product Duplication Prevention:** Checks `COUNT(*) FROM public.products WHERE sku = v_sku OR is_reusable_jar = true`. If found, skips insertion and reuses the existing product ID.
- **Zero-Stock Balance:**
  ```sql
  INSERT INTO public.inventory_balances (
      warehouse_id, product_id, quantity_on_hand, quantity_reserved
  ) VALUES (v_default_wh_id, v_product_id, 0, 0)
  ON CONFLICT (warehouse_id, product_id) DO NOTHING;
  ```
  Initializes exactly `0` on hand and `0` reserved. No stock is fabricated. Physical opening stock must be entered via verified count transactions.

### 2.4 Statutory GST Review (Finding SEC-P4-006)
- **Finding:** The script assumes an 18% GST rate (9% CGST + 9% SGST) for HSN `22011010` (purified water). While this matches standard packaged water under Entry 24 of Schedule III of Notification No. 1/2017-Central Tax (Rate), Indian GST law has specific distinctions for bulk unflavored water vs retail packaging.
- **Requirement:** Finance/Chartered Accountant confirmation must be obtained before production billing, though the technical schema constraints are satisfied.

---

## 3. Deep Review of Order Cancellation

The full execution path was traced:
```
Client Request → CancelOrderSchema (Zod) → cancelOrder (Server Action) → rpc_cancel_customer_order (PostgreSQL RPC) → Table State Changes
```

### 3.1 Trace Analysis

1. **Schema Validation:**
   [`src/modules/orders/order.schema.ts`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/src/modules/orders/order.schema.ts#L62-L74)
   - `order_id`: Validated as UUID (`z.string().uuid()`).
   - `reason`: Optional string, capped at 500 characters (`z.string().max(500)`).
   - `CancelOrderResult` interface defines typed return: `{ order_id, order_number, status, released_reservation }`.

2. **Application Service Action:**
   [`src/modules/orders/order.service.ts`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/src/modules/orders/order.service.ts#L349-L386)
   - Checks `supabase.auth.getUser()`. Returns unauthenticated error if no session.
   - Invokes RPC with exact parameter names: `{ p_order_id: validated.order_id, p_reason: validated.reason || null }`.
   - Correctly maps RPC return object to TypeScript `CancelOrderResult`.

3. **Database Security & Role Enforcement:**
   [`supabase/migrations/20261104000005_remediation_round_7.sql`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261104000005_remediation_round_7.sql#L1789-L1804)
   - Validates `auth.uid() IS NOT NULL`.
   - Validates `public.is_active_user()`.
   - Checks role authority: `v_caller_role = 'owner' OR (v_perms->>'can_manage_orders')::boolean = true`.
   - Restricts RPC execution: `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role;`.

### 3.2 Detailed Defect Analysis

#### Defect 1 (CRITICAL — SEC-P4-001): Multi-Product Orders Experience Inventory Reservation Leakage
In `rpc_cancel_customer_order` lines 1819–1833:
```sql
-- Calculate previously delivered quantity
SELECT COALESCE(SUM(actual_delivered_quantity), 0) INTO v_delivered_qty
FROM public.delivery_stops
WHERE order_id = v_order.id AND status = 'COMPLETED';

-- 1. Atomically release reserved inventory for undelivered items
FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v_order.id
LOOP
    v_remaining_res := pg_catalog.greatest(0, v_item.quantity - v_delivered_qty);
    IF v_remaining_res > 0 THEN
        UPDATE public.inventory_balances
        SET quantity_reserved = pg_catalog.greatest(0, quantity_reserved - v_remaining_res),
            updated_at = pg_catalog.now()
        WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;
    END IF;
END LOOP;
```
**Failure Mechanism:**
`v_delivered_qty` is a single aggregate integer summed from `delivery_stops.actual_delivered_quantity`. Delivery stops do not track line-item product deliveries; they track total jar counts.
When an order contains multiple products:
- Example: Order has 10 units of Product A (20L Jar) and 5 units of Product B (Dispenser).
- Delivery stop 1 delivers 6 units of Product A (`actual_delivered_quantity = 6`).
- Customer cancels the remaining balance.
- In the loop:
  - Product A: `v_item.quantity = 10`. `v_remaining_res = 10 - 6 = 4`. `quantity_reserved` decremented by 4. (Delivered 6 was already released by `rpc_execute_delivery_stop`; remaining 4 released. Total released = 10. Correct).
  - Product B: `v_item.quantity = 5`. `v_remaining_res = greatest(0, 5 - 6) = 0`!
  - `v_remaining_res` evaluates to 0. **Zero units of Product B reservation are released!** All 5 units of Product B remain permanently locked in `inventory_balances.quantity_reserved`.
- If `v_delivered_qty = 2`:
  - Product B has `v_remaining_res = 5 - 2 = 3` released. 2 units remain permanently locked!

**Impact:** Multi-product order cancellations corrupt warehouse available inventory calculations ($\text{available} = \text{on\_hand} - \text{reserved}$), preventing future orders from being placed.

---

#### Defect 2 (CRITICAL — SEC-P4-002): Financial Ledger Reversal Missing
In `rpc_create_customer_order` (lines 1212–1267 of Round 7 migration), order placement creates immutable double-entry journal entries in `public.financial_ledger`:
- **Debit:** Accounts Receivable (`1100`)
- **Credit:** Sales Revenue (`4000`)
- **Credit:** Output CGST / SGST (`2200` / `2210`)

In `rpc_cancel_customer_order` lines 1851–1868:
```sql
SELECT * INTO v_invoice FROM public.invoices WHERE order_id = v_order.id LIMIT 1;
IF v_invoice.id IS NOT NULL AND v_invoice.status = 'UNPAID' THEN
    PERFORM public._internal_establish_rpc_context('rpc_cancel_customer_order', 'CUSTOMER_ORDER_BALANCE_ONLY');

    UPDATE public.customers
    SET current_balance = pg_catalog.greatest(0.00, current_balance - v_invoice.balance_due),
        updated_at = pg_catalog.now()
    WHERE id = v_order.customer_id;

    PERFORM public._internal_clear_rpc_context();

    UPDATE public.invoices
    SET status = 'CANCELLED',
        balance_due = 0.00,
        updated_at = pg_catalog.now()
    WHERE id = v_invoice.id;
END IF;
```
**Failure Mechanism:**
While `customers.current_balance` and `invoices.status` are updated, **ZERO entries are inserted into `public.financial_ledger`**.
- The General Ledger (GL) is never reversed.
- The trial balance and financial statements continue to reflect sales revenue and receivables for cancelled orders.
- This directly violates **AGENTS.md Section 3.2.4**:
  > *"Immutability of Posted Transactions: Once a financial journal entry, finalized invoice, or approved delivery trip is posted, it cannot be edited or deleted. Corrections must be made via reversal entries, credit notes, or explicit adjustment vouchers."*

---

#### Defect 3 (HIGH — SEC-P4-003): Partial Delivery Invoicing Accounting Violation
- **Case 1: Order is UNPAID and Partially Delivered:**
  If an order has 10 jars ($1000), 5 are delivered on credit (stop completed, customer owes $500), and the remaining 5 are cancelled:
  `rpc_cancel_customer_order` marks the **entire invoice** as `CANCELLED` and deducts the full $1000 from `customers.current_balance`.
  The customer receives $500 worth of delivered water completely free of charge. No invoice or receivable remains for the 5 delivered jars.
- **Case 2: Order is PARTIALLY_PAID:**
  If the customer paid $400 toward a $1000 order and cancelled the remainder:
  `v_invoice.status = 'PARTIALLY_PAID'`, so the `IF ... v_invoice.status = 'UNPAID'` check evaluates to `FALSE`.
  The invoice is left untouched, and the customer's account balance continues to demand the remaining $600, even though the unfulfilled items were cancelled.

---

#### Defect 4 (HIGH — SEC-P4-004): Deadlock Hazard Between Delivery Stop Execution and Cancellation
- **`rpc_execute_delivery_stop` Lock Order:**
  1. `SELECT * FROM delivery_stops WHERE id = p_stop_id FOR UPDATE;` (Line 1363)
  2. `SELECT * FROM orders WHERE id = v_stop.order_id FOR UPDATE;` (Line 1392)
- **`rpc_cancel_customer_order` Lock Order:**
  1. `SELECT * FROM orders WHERE id = p_order_id FOR UPDATE;` (Line 1806)
  2. `UPDATE delivery_stops SET status = 'CANCELLED' ... WHERE order_id = v_order.id;` (Line 1845)
- **Hazard:**
  If a driver completes a delivery stop at the same millisecond a manager cancels the order:
  - Transaction 1 holds `delivery_stops` lock and waits for `orders` lock.
  - Transaction 2 holds `orders` lock and waits for `delivery_stops` lock.
  - Result: PostgreSQL detects a circular dependency and terminates one transaction with `ERROR: deadlock detected`.

---

## 4. Test Quality & Verification Review

### 4.1 Inspection of Unit Tests (`tests/unit/order-cancellation.test.ts`)
The 16 tests in `tests/unit/order-cancellation.test.ts` were inspected in detail:

1. **Tests Do Not Call Application Code:**
   Line 2 imports only `CancelOrderSchema`:
   ```typescript
   import { CancelOrderSchema } from "@/modules/orders/order.schema";
   ```
   `cancelOrder` from `src/modules/orders/order.service.ts` is **not imported and never invoked**.
2. **Tests Do Not Call Database RPC:**
   The entire test suite executes against an in-memory JavaScript simulation function `simulateRpcCancelCustomerOrder()` (lines 70–151).
3. **No Multi-Product Orders Tested:**
   Every single test fixture in `createTestState()` contains strictly one product item:
   ```typescript
   items: [{ productId: jarProdId, quantity: 10 }]
   ```
   Because no multi-product fixture existed, the critical inventory reservation calculation bug (Defect 1) went completely undetected.
4. **Weak Assertions:**
   In Test 1 (`allows owner to cancel orders`) and Test 2 (`allows staff with can_manage_orders`), the assertions only verify `result.success === true` and `result.status === "CANCELLED"`. They do not assert whether inventory balances or invoices actually updated.
5. **Zero Concurrency Coverage:**
   No parallel or concurrent race condition tests exist.

### 4.2 Verification Command Results

| Verification Step | Command | Result | Notes |
|---|---|:---:|---|
| **TypeScript Typecheck** | `npm run typecheck` | **PASS** | `tsc --noEmit` passed with 0 errors. |
| **ESLint** | `npm run lint` | **PASS** | `next lint` passed with 0 warnings/errors. |
| **Vitest Suite** | `npm test` | **PASS** | 11 test files, 106 tests passed. |
| **Production Build** | `npm run build` | **PASS** | Compiled 38 static and dynamic routes successfully. |

> [!CAUTION]
> Passing TypeScript, lint, unit tests, and production builds **must not** be treated as proof of database or business correctness. The unit tests were testing their own JavaScript simulation, which had identical blind spots to the flawed PL/pgSQL code.

---

## 5. Required Corrections Before Approval

Before `01_remove_legacy_order_rpc.sql` and `02_seed_reusable_jar_product.sql` can be approved for execution on the live database, the following corrections must be implemented:

### Correction 1: Remediate `rpc_cancel_customer_order` Multi-Product & Invoicing Logic
A new migration or SQL patch must update `public.rpc_cancel_customer_order`:
1. **Per-Item Reservation Release:**
   Track delivered quantities per product item, or for orders where delivery stops only track primary jars, release reservations based on the specific product delivered rather than subtracting total delivered count from all products.
2. **Financial Ledger Reversals:**
   Post explicit reversal entries to `public.financial_ledger`:
   - Debit: Sales Revenue (`4000`)
   - Debit: Output GST (`2200` / `2210`)
   - Credit: Accounts Receivable (`1100`)
   - Stamped with `is_reversal = true`, `reversed_entry_id = <original_invoice_entry_id>`.
3. **Partial Delivery Invoice Reconciliation:**
   If an order has completed delivery stops, the invoice must not be completely wiped out. Either:
   - Adjust `invoices.balance_due` and `invoices.total_amount` to match the delivered portion, or
   - Mark the original invoice as partially cancelled with an explicit Credit Note journal entry.
4. **Lock Ordering Alignment:**
   Acquire row locks in consistent order (`orders` then `delivery_stops`) across both `rpc_execute_delivery_stop` and `rpc_cancel_customer_order` to eliminate deadlock hazards.

### Correction 2: Update Application Unit Tests
Update `tests/unit/order-cancellation.test.ts`:
1. Test actual `cancelOrder()` server action using a mocked Supabase client.
2. Add multi-product test fixtures with at least 3 distinct products (reusable jar, accessory, consumable).
3. Assert financial ledger reversal and per-product inventory balance changes.

---

## 6. Final Audit Determination

**STATUS: NOT APPROVED — CORRECTIONS REQUIRED**

Execution of `01_remove_legacy_order_rpc.sql` and `02_seed_reusable_jar_product.sql` on the live database must be deferred until the order cancellation stored procedure (`rpc_cancel_customer_order`) is patched to prevent inventory reservation lockups and financial ledger discrepancies.
