# AQUATRACK ERP — ROUND 7 ROLLBACK AND RECOVERY STRATEGY
## In-Depth Rollback Specification, Invariant Preservation & Forward Recovery Strategy

**Project:** AquaTrack ERP  
**Remediation Phase:** Round 7  
**Rollback Script:** `supabase/migrations/rollback/20261104000005_remediation_round_7_rollback.sql`  
**Target Baseline:** Round 6 Remediation Baseline  

---

## 1. Rollback Overview & Verification

This document specifies the database rollback and forward-recovery procedures for Round 7. 

In strict adherence to development rules:
- **Zero Data Deletion:** Rollback does not drop tables containing customer, financial, or jar movement history (`customers`, `suppliers`, `invoices`, `financial_ledger`, `orders`, `jar_custody_movements`, `stock_movements`).
- **No Vulnerable Policy Restoration:** The rollback restores the verified Round 6 definitions without resurrecting any previously eliminated security flaws (e.g. Round 2/3 permissive triggers).
- **Exact DDL Restoration:** Every replaced function and trigger is restored to its exact Round 6 implementation.

---

## 2. Object Modification & Restoration Matrix

| Object Name | Object Type | Round 7 Remediation State | Action on Rollback | Restored State (Round 6) |
|---|---|---|---|---|
| `public.rpc_record_jar_movement` | RPC Function | Hardened: scrap-yard source balance locking, canonical warehouse validation, destination customer/supplier check | Replace with exact Round 6 definition | Restores Round 6 RPC (`20261104000004_remediation_round_6.sql` lines 223–723) |
| `public.rpc_create_customer_order` | RPC Function | Hardened: deterministic row-locking on `inventory_balances`, stock reservation (`quantity_reserved`) | Replace with exact Round 6 definition | Restores Round 6 RPC with date-range pricing and owner override reason |
| `public.rpc_execute_delivery_stop` | RPC Function | Hardened: deducts `quantity_on_hand` and releases `quantity_reserved` for delivered items | Replace with exact Round 6/3 definition | Restores Round 3 RPC definition |
| `public.rpc_cancel_customer_order` | RPC Function | New Round 7 function: cancels order and releases reserved inventory | Drop function | `DROP FUNCTION IF EXISTS public.rpc_cancel_customer_order(UUID, TEXT);` |
| `public.internal_rpc_auth_tokens` | Table | New Round 7 internal authorization token table | Drop table | `DROP TABLE IF EXISTS public.internal_rpc_auth_tokens;` |
| `public._internal_establish_rpc_context` | Function | Internal token context generator | Drop function | `DROP FUNCTION IF EXISTS public._internal_establish_rpc_context(VARCHAR, VARCHAR);` |
| `public._internal_clear_rpc_context` | Function | Internal token context cleaner | Drop function | `DROP FUNCTION IF EXISTS public._internal_clear_rpc_context();` |
| `check_customer_privileged_updates` | Trigger Function | Hardened: verifies unforgeable transaction token in `internal_rpc_auth_tokens` | Replace with Round 6 definition | Restores Round 6 trigger using `PG_CONTEXT` |
| `check_supplier_privileged_updates` | Trigger Function | Hardened: verifies unforgeable transaction token in `internal_rpc_auth_tokens` | Replace with Round 6 definition | Restores Round 6 trigger using `PG_CONTEXT` |
| `uq_singleton_warehouse` | Unique Index | Enforces single warehouse in `public.warehouses` | Drop index | `DROP INDEX IF EXISTS public.uq_singleton_warehouse;` |
| `chk_single_default_warehouse` | CHECK Constraint | Enforces `is_default = true` on `public.warehouses` | Drop constraint | `ALTER TABLE public.warehouses DROP CONSTRAINT IF EXISTS chk_single_default_warehouse;` |

---

## 3. Data Safety & Invariant Preservation Analysis

### 3.1 Inventory Reservations Data Preservation
Under Round 7, `inventory_balances.quantity_reserved` is actively incremented when orders are created.
- **Rollback Impact:** Rolling back to Round 6 will restore the Round 6 order creation function, which does not modify `quantity_reserved`. Existing records in `inventory_balances` will retain their `quantity_reserved` values without corrupting `quantity_on_hand`.
- **Precautionary Measure:** If a rollback is initiated while orders have unfulfilled reserved stock, run the following SQL update before rolling back to reconcile reservations:
  ```sql
  -- Reset reserved quantities to active pending order sums
  UPDATE public.inventory_balances ib
  SET quantity_reserved = COALESCE((
      SELECT SUM(oi.quantity)
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.product_id = ib.product_id
        AND o.status IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY')
  ), 0);
  ```

### 3.2 Jar Custody Movements & Asset Conservation
All records inserted into `public.jar_custody_movements` and `public.stock_movements` are strictly append-only.
- The rollback script contains zero `DELETE` or `TRUNCATE` operations on historical ledger tables.
- All historical jar movements remain intact and fully auditable.

---

## 4. Forward-Recovery Strategy

In production environments where historical data has accumulated under Round 7 rules, executing a backwards rollback is generally discouraged because:
1. Reverting `rpc_record_jar_movement` would re-expose the system to scrap-yard stock fabrication if an empty scrap yard was selected as source.
2. Reverting `rpc_create_customer_order` would remove deterministic row-locking, re-opening the race condition window for overselling.
3. Reverting the triggers to `PG_CONTEXT` would re-introduce dependence on call-stack strings.

### Recommended Forward-Recovery Path:
If an issue is detected in Round 7 operations:
1. Do not apply destructive rollbacks to live customer databases.
2. Author an additive patch migration (`20261104000006_remediation_round_8.sql`) addressing the specific edge case.
3. Re-validate through the local database test runner before applying to production.
