# AquaTrack ERP — Round 6 Rollback & Safe Forward Recovery Strategy

---

## 1. Executive Summary

This document defines the rollback mechanisms, dependencies, and forward-recovery strategies for **Remediation Round 6**.

- **Rollback File:** `supabase/migrations/rollback/20261104000004_remediation_round_6_rollback.sql`
- **Baseline Restored:** Remediation Round 5 (`20261104000003_remediation_round_5.sql`)
- **Safety Directive:** Rollback scripts are **NEVER** executed automatically. They must only be executed in disposable test environments or during authorized rollbacks.
- **Data Preservation Guarantee:** Rollback scripts strictly avoid dropping operational data tables (`customers`, `orders`, `purchases`, `jar_custody_movements`, `financial_ledger`) or schema columns (`total_empty_clean_holding`, `total_scrap_jars_holding`).

---

## 2. Component-by-Component Restoration Specification

When applying `20261104000004_remediation_round_6_rollback.sql`, the following database components are restored to their verified Round 5 baseline:

| Object | Type | Change in Round 6 | Rollback Action |
|---|---|---|---|
| `public.rpc_create_customer_order` | Function | Aligned with canonical `default_sale_price` and date-range special pricing (`effective_from`/`effective_to`). | Restores Round 5 signature and definition with fallback compatibility. |
| `public.rpc_record_jar_movement` | Function | Aligned with canonical `locations.type`, canonical `stock_movements` columns/types, and PO quantity limit enforcement. | Restores Round 5 definition in reverse order. |
| `public.check_customer_privileged_updates` | Trigger Function | Maintained call-stack domain scoping. | Preserved with strict domain-scoped privilege guards. |
| `public.check_supplier_privileged_updates` | Trigger Function | Maintained supplier custody and payable protection. | Preserved with strict domain-scoped privilege guards. |
| Execution Grants | Permissions | `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role;` | Restores standard authenticated role execution permissions. |

---

## 3. Strict Prohibitions (Never Violate During Rollback)

1. **Never Restore Vulnerable Round 2 or Round 3 Code:**
   Earlier rounds contained trigger bypasses and overly permissive RLS policies. Rollback explicitly stops at the hardened Round 5 baseline.
2. **Never Drop Historical Columns:**
   Columns added in Round 5 (`customers.total_empty_clean_holding`, `customers.total_scrap_jars_holding`) remain in the database schema to prevent catastrophic physical custody data loss.
3. **Never Truncate Audit Ledgers:**
   `stock_movements`, `jar_custody_movements`, and `financial_ledger` records must never be modified or deleted during rollback.

---

## 4. Rollback Execution Sequence & Dependencies

If a rollback must be manually performed in an authorized local test database, execute in this precise order:

```bash
# 1. Ensure local Supabase stack is running
# 2. Execute Round 6 rollback script against local PostgreSQL database:
psql -U postgres -d postgres -h 127.0.0.1 -p 54322 -f supabase/migrations/rollback/20261104000004_remediation_round_6_rollback.sql
```

### Dependencies:
1. PostgreSQL 15+
2. Schema columns: `customers.total_empty_clean_holding`, `customers.total_scrap_jars_holding` must exist.
3. Extensions: `pgcrypto` must be active.

---

## 5. Forward-Recovery Alternative Strategy

In enterprise production environments, rolling back migrations that have processed live customer orders or physical jar movements can introduce inconsistencies between recorded physical inventory and ledger balances.

Therefore, the **recommended recovery strategy is Forward-Fix Remediation**:

1. **Issue Identification:** Identify the specific constraint or calculation mismatch from server logs and audit trails (`public.audit_logs`).
2. **Zero-Downtime Forward Migration:**
   - Author a new forward migration (e.g. `20261104000005_forward_fix.sql`).
   - Re-declare affected RPCs with `CREATE OR REPLACE FUNCTION`.
   - Never drop columns; use non-destructive `ADD COLUMN IF NOT EXISTS` or constraint modifications.
3. **Reversal Entries for Financial Corrections:**
   - Use `rpc_reverse_financial_entry` to reverse erroneous financial postings.
   - Never directly modify or delete posted invoices or ledger rows.
4. **Physical Stock Reconciliation:**
   - Use approved physical audit entries (`AUDIT` reference type with `INTERNAL_ADJUSTMENT` movement type) to reconcile physical counts with database balances.
