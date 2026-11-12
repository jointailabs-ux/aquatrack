# AquaTrack ERP — Database Migration & Forward-Recovery Strategy

**Document Version:** 3.0  
**Status:** Approved Architectural Standard  
**Date:** November 4, 2026  
**Scope:** Single-Location Enterprise Operations Platform  

---

## 1. Executive Context & Industry Standards

In an enterprise resource planning (ERP) platform managing physical inventory, double-entry financial ledgers, customer jar custody, and payroll disbursements, **database schema rollbacks carry significant risks of data corruption, ledger imbalances, and orphan references**.

Once operational transactions are posted (such as deliveries, supplier receipts, or salary disbursements), executing destructive `DROP` operations or reverting non-cascading schema constraints can leave historical records invalid or orphan.

Therefore, AquaTrack ERP adheres to a dual-track strategy:
1. **Documented Forward-Recovery Migration Strategy (Primary & Recommended):** Apply targeted, additive compensating patches and idempotency safeguards without dropping columns or losing transactional history.
2. **Deterministic Reverse Rollback Scripts (Emergency Deployment Window Rollback):** Tested reverse migrations (`20261104000001_remediation_round_3_rollback.sql`, `20261103000002_remediation_round_2_rollback.sql`) that safely restore function definitions and RLS policies in exact reverse dependency order without cascading drops.

---

## 2. Forward-Recovery Strategy (Why Forward Recovery is Safer)

### 2.1 Preserving Immutability of Financial & Custody Records
- **Financial Ledger Immutability:** Accounting law dictates that posted journal entries (`financial_ledger`) must never be modified or deleted. Errors are corrected via compensating reversal entries (`rpc_reverse_financial_entry`).
- **Physical Jar Conservation:** Jar custody records (`jar_custody_movements`) represent real-world physical transfers. Reverting a migration that alters constraint definitions would invalidate the cumulative balance equation:
  $$\text{Total System Jars} = \text{Warehouse Stock} + \text{Staff/Vehicle} + \text{Customer Custody} + \text{Supplier Custody} + \text{Scrapped}$$
- **Salary Partial Disbursements:** When a migration drops a unique period constraint (`uq_staff_salary_period`) to permit legitimate partial disbursements, rolling back by re-enforcing that unique constraint on a database that now contains multiple partial payment records will fail with a catastrophic constraint violation error.

### 2.2 Forward Patching Protocols
If a bug is discovered in a production release:
1. **Never execute raw `DROP TABLE` or destructive rollbacks on live databases.**
2. Formulate a forward migration script (e.g., `20261104000001_remediation_round_3.sql`) that:
   - Modifies stored procedure logic in place using `CREATE OR REPLACE FUNCTION`.
   - Modifies or adds triggers (`check_customer_privileged_updates`) to enforce column protection.
   - Adjusts Row-Level Security (RLS) policies using atomic `DROP POLICY IF EXISTS` followed by `CREATE POLICY`.
3. Test the forward patch thoroughly in a containerized local environment (`supabase start` on `127.0.0.1`).
4. Apply the forward migration cleanly within the maintenance window.

---

## 3. Reverse Rollback Specifications

For pre-production testing or immediate abort scenarios during migration deployment (before transactional data has been recorded), reverse rollback scripts are maintained:

| Forward Migration | Rollback Migration | Description & Preconditions |
| :--- | :--- | :--- |
| `20261104000001_remediation_round_3.sql` | `supabase/migrations/rollback/20261104000001_remediation_round_3_rollback.sql` | Drops Round 3 triggers (`trg_protect_customer_privileged_fields`, `trg_protect_supplier_privileged_fields`), drops Round 3 RPCs (`rpc_create_customer_with_location`, `rpc_create_customer_order`, `rpc_record_jar_movement`), and restores Round 2 policies on `purchases`, `purchase_items`, and `jar_custody_movements`. |
| `20261103000002_remediation_round_2.sql` | `supabase/migrations/rollback/20261103000002_remediation_round_2_rollback.sql` | Drops Round 2 specific RPCs (`rpc_record_salary_advance`, `rpc_record_supplier_payment`, `rpc_create_purchase_order`), drops Round 2 indexes, and restores pre-Round-2 function definitions (`rpc_reverse_financial_entry`) from `20261103000001`. |
| `20261103000001_critical_security_and_transactions.sql` | `supabase/migrations/rollback/20261103000001_critical_security_and_transactions_rollback.sql` | Restores Phase 4A baseline foundation policies without loose `USING (true)` bypasses. |

### 3.1 Non-Destructive Invariant Preservation
In all rollback scripts:
- Existing columns (e.g. `salary_advances.amount_deducted`, `customers.total_damaged_jars_holding`) are **NOT dropped**. Dropping columns destroys historical audit records.
- Financial ledger entries are **never deleted**.
- Rollbacks are non-cascading (`CASCADE` is prohibited) to prevent accidental deletion of dependent tables or foreign key relationships.

---

## 4. Safeguards Against Remote Database Execution

Per project security mandates:
1. **Hard Stop in Integration Tests:** `scripts/test-remediation-integration.mjs` validates the target hostname and unconditionally terminates execution (`process.exit(1)`) if the target URL is not `localhost` or `127.0.0.1`.
2. **Zero Remote Migrations:** Migrations must only be applied to local test databases or during scheduled production deployment windows via authorized CI/CD pipelines. AI agents and developers must never execute migration scripts against remote cloud Supabase instances (`https://*.supabase.co`).
