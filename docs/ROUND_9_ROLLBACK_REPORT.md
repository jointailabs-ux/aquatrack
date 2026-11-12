# AquaTrack ERP — Round 9 Rollback & Recovery Report
**File:** `docs/ROUND_9_ROLLBACK_REPORT.md`  
**Date:** 2026-11-06  
**Rollback File:** `supabase/rollbacks/20261106000001_remediation_round_9_rollback.sql`  
**Rollback Mirror:** `supabase/migrations/rollback/20261106000001_remediation_round_9_rollback.sql`

---

## 1. Executive Summary

A complete, standalone rollback migration was authored and verified for Round 9. In the event that Round 9 must be reverted, the rollback script will safely restore the exact pre-Round 9 schema definitions, RPC signatures, and RLS policies of Round 8 without destroying business transactional data created after the migration.

---

## 2. Objects Modified and Restored

### 2.1 Audit Table Removal
The audit table introduced in Round 9 is dropped cleanly:
```sql
DROP TABLE IF EXISTS public.historical_order_reconciliation_flags CASCADE;
```
*Note:* If records in `historical_order_reconciliation_flags` have been created and reviewed, exporting this table prior to executing a rollback is recommended.

### 2.2 RLS Policy Restoration on `delivery_stop_items`
Round 9 dropped the permissive direct write policy `dsi_modify`. The rollback restores the exact Round 8 policy:
```sql
CREATE POLICY dsi_modify ON public.delivery_stop_items
FOR ALL TO authenticated
USING (
    public.get_user_role() = 'owner' 
    OR (public.get_staff_permissions()->>'can_deliveries')::boolean = true
)
WITH CHECK (
    public.get_user_role() = 'owner' 
    OR (public.get_staff_permissions()->>'can_deliveries')::boolean = true
);
```

### 2.3 RPC Function Reversion
The rollback reinstates the exact Round 8 definitions for:
1. `public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT, JSONB)`
2. `public.rpc_cancel_customer_order(UUID, TEXT)`

Both functions are re-granted to `authenticated` and `service_role`, with public execution revoked.

---

## 3. Data Safety & Limitations

1. **Transactional Preservation:** Reversible schema and function changes do not delete or modify rows in:
   - `public.orders`
   - `public.order_items`
   - `public.delivery_stops`
   - `public.delivery_stop_items`
   - `public.customers`
   - `public.invoices`
   - `public.financial_ledger`
2. **Delivered Quantity Column:** The column `order_items.delivered_quantity` was introduced in Round 8 and is therefore preserved during a Round 9 rollback.
3. **Data Created Post-Migration:** Any orders created and processed under Round 9 remain valid and fully functional under Round 8 definitions.

---

## 4. Verification Checklist

To verify rollback execution in a disposable database:
1. Run `supabase/rollbacks/20261106000001_remediation_round_9_rollback.sql`.
2. Confirm `historical_order_reconciliation_flags` table no longer exists.
3. Confirm `dsi_modify` policy exists on `delivery_stop_items`.
4. Verify function signatures and definitions for `rpc_execute_delivery_stop` and `rpc_cancel_customer_order`.

