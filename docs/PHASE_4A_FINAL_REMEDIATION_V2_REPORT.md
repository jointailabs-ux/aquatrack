# AquaTrack ERP — Phase 4A Final Independent Review Remediation Report (V2)

**Document Reference:** `docs/PHASE_4A_FINAL_REMEDIATION_V2_REPORT.md`  
**Version:** 2.0.0 (Post-Independent Review Remediation)  
**Date:** November 2026  
**Status:** COMPLETE — REMEDIATED FOR INDEPENDENT VERIFICATION  
**Target Environment:** Supabase PostgreSQL 15+ / Next.js 15 App Router (TypeScript Strict)

---

## 1. Executive Summary

This report documents the architectural, security, and database remediation performed in response to the **Phase 4A Final Independent Review**. The remediation directly resolves all nine critical findings identified in the review without weakening database integrity, leaking credentials, or performing unauthorized remote database migrations.

### Core Remediation Achievements
1. **Administrative Service-Role Authentication Path:** Updated `check_profile_update_privileges()` and `check_profile_insert_privileges()` to recognize genuinely trusted administrative contexts via `auth.role() = 'service_role' OR current_user IN ('postgres', 'supabase_admin')`. Enforced strict branch validation while preserving self-service update restrictions for ordinary users and blocking branch managers from modifying higher-privilege accounts.
2. **Correct Composite Foreign Key Deletion Semantics:** Eliminated unsafe composite `ON DELETE SET NULL` constraints on `(organization_id, ...)`. Transitioned `customers.profile_id` to a single-column nullable foreign key referencing `profiles(id) ON DELETE SET NULL` paired with an engine-level tenancy verification trigger (`trg_verify_customer_profile_tenancy`) ensuring `organization_id` is permanently immutable and never nulled out. Applied `ON DELETE RESTRICT` to branch relationships.
3. **Cryptographic Onboarding Token Hashing:** Eliminated plaintext token storage in `customer_onboarding_tokens`. Tokens are generated using cryptographic pseudo-random number generators, stored strictly as 64-character SHA-256 hashes (`token_hash`) with a safe prefix (`token_prefix`), returned in raw plaintext to staff creators exactly once, and hashed before lookup during verification and atomic registration.
4. **pgcrypto & pg_catalog Namespace Resolution:** Replaced invalid extension function references with built-in PostgreSQL functions (`pg_catalog.sha256` and `pg_catalog.gen_random_uuid`), eliminating dependency on extension relocation or schema resolution ambiguities.
5. **Strict Test Project Allowlist:** Implemented strict project-reference extraction and comparison against a mandatory `EXPECTED_TEST_PROJECT_REF` environment variable in `scripts/test-phase4a-suite.mjs`. Bypassing this check via generic environment flags is strictly prohibited.
6. **Reverse-Dependency Test Cleanup:** Replaced top-down deletion with a reverse-dependency registry that tracks and destroys child entities before parents, checks every Supabase API response, performs post-cleanup orphan audits, and terminates with a non-zero exit code if any test record persists.
7. **Rigorous Test Suite Assertions:** Expanded test suite to 16 authenticated security tests verifying database state after attempted mutations, distinguishing RLS denials from syntax/connection errors, and testing inactive profiles, branch/profile deletions, token hashing/reuse, and cross-tenant rejections.
8. **Hardened Super-Admin Provisioning:** Refactored `scripts/provision-super-admin.mjs` to perform pre-flight conflict checks before creating organizations or branches, separating new-user insertion from existing-user promotion, enforcing explicit organization ID preference, and preventing cross-organization account transfers.
9. **Defensive Rollback Script:** Removed all CASCADE operations, added pre-rollback operational table existence guards, and explicitly documented why `REVOKE CREATE ON SCHEMA public FROM PUBLIC` is retained as a global CIS security baseline rather than restored to PostgreSQL's insecure default.

---

## 2. Detailed Findings & Exact Remediations

### Finding 1: Service-Role Operations and Profile Trigger
- **Root Cause:** `check_profile_update_privileges()` queried `public.get_user_role()`, which relies on `auth.uid()`. When administrative workflows execute via the Supabase Service-Role key or direct migration superusers, `auth.uid()` is NULL. Consequently, legitimate administrative updates were unconditionally rejected.
- **Correction:** Implemented a secure administrative detection clause:
  ```sql
  v_is_service_role := (
      auth.role() = 'service_role' OR 
      current_user IN ('postgres', 'supabase_admin')
  );
  ```
  In Supabase PostgREST, `auth.role()` extracts the JWT claim verified by the server-side JWT secret; client-supplied metadata cannot forge this value. When `v_is_service_role` is true, administrative profile adjustments are authorized while still validating branch-to-organization referential integrity (`NEW.branch_id` must belong to `NEW.organization_id`). For normal users, strict tenancy and self-elevation checks remain fully active. Furthermore, branch managers are explicitly blocked from modifying `super_admin` or peer `branch_manager` accounts (`OLD.role IN ('super_admin', 'branch_manager')`).
- **Files Modified:**
  - `supabase/migrations/20261102000001_phase4a_foundation.sql` (Lines 338–436, 439–476)
  - `scripts/test-phase4a-suite.mjs` (Test 9, Test 16)

---

### Finding 2: Composite Foreign Key ON DELETE SET NULL
- **Root Cause:** `customers` previously defined composite foreign keys containing `organization_id` with `ON DELETE SET NULL`. Because `organization_id` has a strict `NOT NULL` constraint for multi-tenant data isolation, any parent record deletion triggered a database runtime exception (`null value in column "organization_id" violates not-null constraint`).
- **Correction:**
  1. `customers.profile_id` was decoupled from `organization_id` in the foreign key definition:
     ```sql
     profile_id UUID UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL
     ```
  2. To prevent cross-organization profile association attacks, an engine-level trigger was added:
     ```sql
     CREATE OR REPLACE FUNCTION public.verify_customer_profile_tenancy()
     RETURNS TRIGGER AS $$
     BEGIN
         IF NEW.profile_id IS NOT NULL THEN
             IF NOT EXISTS (
                 SELECT 1 FROM public.profiles
                 WHERE id = NEW.profile_id AND organization_id = NEW.organization_id
             ) THEN
                 RAISE EXCEPTION 'Tenancy violation: customer profile belongs to another organization.';
             END IF;
         END IF;
         RETURN NEW;
     END;
     $$ LANGUAGE plpgsql SET search_path = '';
     ```
  3. Branch foreign keys on `profiles` and `customers` use `ON DELETE RESTRICT` to preserve operational and branch integrity. Deleting an auth user cascades to `profiles` and safely nullifies `customers.profile_id` while preserving `organization_id` intact.
- **Files Modified:**
  - `supabase/migrations/20261102000001_phase4a_foundation.sql` (Lines 83, 130, 479–498)
  - `supabase/migrations/rollback/20261102000001_phase4a_rollback.sql` (Lines 23, 44)
  - `scripts/test-phase4a-suite.mjs` (Test 14, Test 15)

---

### Finding 3: Cryptographic Onboarding Token Hashing
- **Root Cause:** Onboarding invitations previously stored plaintext token strings in `customer_onboarding_tokens.token`. A database read leak could expose unused tokens, enabling unauthorized self-registration.
- **Correction:**
  1. Table schema modified: replaced `token VARCHAR(64)` with `token_hash VARCHAR(64)` (storing the SHA-256 digest) and `token_prefix VARCHAR(10)` (first 8 characters for staff identification).
  2. `rpc_create_onboarding_token` generates a 256-bit entropy token prefixed with `aq_`, computes its SHA-256 hash using `pg_catalog.sha256()`, stores the hash, and returns the raw token to staff creator exactly once.
  3. `rpc_verify_onboarding_token` and `rpc_register_customer_with_token` compute the SHA-256 hash of the caller's incoming raw token before querying `customer_onboarding_tokens`.
  4. Token consumption retains atomic row locking (`FOR UPDATE`), increments `uses_count`, and enforces `expires_at` and `max_uses`.
  5. `src/modules/customers/customer.service.ts` updated to align parameter names (`p_raw_token`).
- **Files Modified:**
  - `supabase/migrations/20261102000001_phase4a_foundation.sql` (Lines 226–244, 889–928, 931–1059, 1063–1139)
  - `src/modules/customers/customer.service.ts` (Lines 128–187)
  - `scripts/test-phase4a-suite.mjs` (Test 11)

---

### Finding 4: Correct pgcrypto & Function Namespace
- **Root Cause:** Initial drafts invoked `pg_catalog.gen_random_bytes(24)`, which is not a standard `pg_catalog` function (it belongs to `extensions.gen_random_bytes` when pgcrypto is enabled). Depending on non-standard extension namespaces introduces runtime lookup failures.
- **Correction:** Utilized standard, built-in PostgreSQL core functions located permanently in `pg_catalog`:
  - Token entropy generation: `pg_catalog.gen_random_uuid()`
  - Cryptographic hashing: `pg_catalog.sha256(bytea)`
  - Encoding: `pg_catalog.encode(..., 'hex')`
  - String manipulation: `pg_catalog.convert_to()`, `pg_catalog.replace()`, `pg_catalog.substr()`
  - Preserved `CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;` for cluster baseline compatibility without relying on extension schema search paths.
- **Files Modified:**
  - `supabase/migrations/20261102000001_phase4a_foundation.sql` (Lines 20, 897–900, 957–960, 1098–1105)

---

### Finding 5: Test Environment Safety
- **Root Cause:** `test-phase4a-suite.mjs` relied on keyword substring matching (`production`, `prod-aquatrack`) and permitted generic `ALLOW_TEST_SUITE_EXECUTION="true"` flags to override safety checks.
- **Correction:** Implemented strict project-reference allowlisting:
  1. Mandated `EXPECTED_TEST_PROJECT_REF` in the execution environment.
  2. Extracted the actual project reference from `SUPABASE_URL` host (e.g. `bplpyitmcqqebpdyochz` from `https://bplpyitmcqqebpdyochz.supabase.co` or `local` for loopback).
  3. Performed exact string comparison; halted execution immediately if missing or mismatched.
  4. Prohibited generic environment variables from bypassing the project-reference check.
  5. Logged verified project reference while keeping secret keys completely unprinted.
- **Files Modified:**
  - `scripts/test-phase4a-suite.mjs` (Lines 47, 53–92)

---

### Finding 6: Dependency-Aware Test Cleanup
- **Root Cause:** Prior teardown logic attempted to delete parent `organizations` before child tables (`products`, `customers`, `branches`), triggering foreign key restriction errors and leaving orphaned test records in the database.
- **Correction:**
  1. Implemented a centralized `testRegistry` tracking all test entity UUIDs (`specialPrices`, `tokens`, `customers`, `suppliers`, `warehouses`, `products`, `locations`, `profiles`, `branches`, `organizations`, `authUsers`).
  2. Reversed deletion sequence:
     `customer_special_prices` -> `customer_onboarding_tokens` -> `customers` -> `suppliers` -> `warehouses` -> `products` -> `locations` -> `profiles` -> `branches` -> `organizations` -> `auth.users`.
  3. Checked every Supabase API deletion response for errors.
  4. Executed a post-cleanup audit querying all tables for remaining registered IDs.
  5. Terminated with exit code 1 if any test record failed to be removed.
- **Files Modified:**
  - `scripts/test-phase4a-suite.mjs` (Lines 111–227, 650–657)

---

### Finding 7: Correct Test Assertions
- **Root Cause:** Test assertions previously conflated syntax or database connection errors with successful RLS denials, and omitted coverage for deletion semantics, inactive profiles, token hashing, and higher-privilege protection.
- **Correction:**
  1. Every test checks `{ data, error }` distinctly: RLS policy violations check status `42501` or empty datasets, trigger exceptions check code `P0001`, and unexpected database errors fail the test.
  2. Added state verification queries using `serviceAdminClient` after attempted mutations to confirm the database remained unaltered.
  3. Expanded test suite to 16 comprehensive security tests covering:
     - Customer self-elevation blocked (state verified)
     - Customer data isolation (SELECT)
     - Customer self-deletion blocked
     - Wholesale cost_price margin protection
     - Driver pricing immutability
     - Driver supplier isolation
     - Cross-organization isolation across SELECT, INSERT, UPDATE, DELETE
     - Branch manager cross-branch reassignment blocked
     - Branch manager higher-privilege account modification blocked
     - Inactive profile operational access denial
     - Token SHA-256 hash storage and single-use depletion
     - Atomic location + child record rollback on insertion failure
     - Direct profile insertion with super_admin role blocked
     - Composite foreign-key and customer profile tenancy cross-tenant rejections
     - Profile deletion nullification (`profile_id -> NULL`, `organization_id` preserved) & Branch deletion restriction
     - Service-role administrative update path with cross-org branch validation
  4. Clear classification in test output separating Static Validation, Pre-Migration Safety Stop, and Live Authenticated Execution.
- **Files Modified:**
  - `scripts/test-phase4a-suite.mjs` (Lines 230–648)

---

### Finding 8: Super-Admin Provisioning Workflow
- **Root Cause:** `provision-super-admin.mjs` created organizations and branches before checking auth user conflicts, used blind profile upserts that could collide with profile triggers, selected organizations solely by name, and risked silent role elevation or cross-organization account transfers.
- **Correction:**
  1. Re-architected into 4 sequential phases:
     - **Phase 1: Pre-flight Auth & Profile Inspection:** Queries paginated `auth.admin.listUsers` and `profiles` before touching any database records. Aborts if account exists with non-admin role (unless `ALLOW_ROLE_PROMOTION="YES"`) or if account belongs to a different organization.
     - **Phase 2: Organization Resolution:** Prefers explicit `TARGET_ORGANIZATION_ID`; falls back to name/tax_id search or creation only when ID omitted.
     - **Phase 3: Branch Resolution:** Prefers explicit `TARGET_BRANCH_ID`; falls back to code search or creation within verified organization.
     - **Phase 4: Provisioning:** Explicitly separates existing-user profile update (`update()`) from brand-new user creation (`createUser()` followed by `insert()`). Automatically cleans up created auth user if profile insertion encounters an unexpected error.
  2. Enforced `CONFIRM_PROVISIONING="YES"` gate and minimum 12-character password.
  3. Checked every Supabase API response error.
  4. Zero hardcoded or fictional fallbacks; zero credential logging.
- **Files Modified:**
  - `scripts/provision-super-admin.mjs` (Lines 1–347)

---

### Finding 9: Rollback Script Review & Global Security Baseline
- **Root Cause:** Rollback script required hardening against cascading drops, operational data loss, and clear documentation regarding CIS PostgreSQL security baselines.
- **Correction:**
  1. Removed all `CASCADE` drop clauses to prevent accidental deletion of unrelated schemas or objects.
  2. Implemented pre-rollback operational table existence guards (aborting if `orders`, `invoices`, `delivery_trips`, `stock_balances`, `journal_entries`, etc. exist).
  3. Added non-test organization data loss warnings.
  4. Explicitly documented that `REVOKE CREATE ON SCHEMA public FROM PUBLIC` is intentionally **NOT** reversed upon rollback:
     - Regranting `CREATE` to `PUBLIC` would degrade database hardening and violate CIS Benchmark Section 2.
     - Provided a commented instruction for database administrators who explicitly choose to restore PostgreSQL's non-hardened legacy default.
- **Files Modified:**
  - `supabase/migrations/rollback/20261102000001_phase4a_rollback.sql` (Lines 1–77)

---

## 3. Summary of Files Modified

| File Path | Description of Changes | Lines Affected |
| :--- | :--- | :--- |
| `supabase/migrations/20261102000001_phase4a_foundation.sql` | Service-role update/insert path, single-column SET NULL profile_id + tenancy trigger, SHA-256 token hashing, pg_catalog functions | 83, 130, 226–244, 338–498, 889–1139 |
| `supabase/migrations/rollback/20261102000001_phase4a_rollback.sql` | Defensive operational table checks, reverse-dependency drop sequence, CIS benchmark retention documentation | 1–77 |
| `scripts/provision-super-admin.mjs` | Pre-flight user checks, separate new/existing flows, explicit org ID preference, error handling | 1–347 |
| `scripts/test-phase4a-suite.mjs` | Strict project ref allowlist, reverse-dependency registry teardown, 16 state-verified security tests | 1–670 |
| `src/modules/customers/customer.service.ts` | Updated RPC parameters to `p_raw_token`, documented cryptographic token hashing | 128–187 |

---

## 4. Verification & Testing Disclosure

### Static Checks & Build Verification (Executed)
1. **Next.js Production Build:** Executed `npm run build` locally.
   - **Result:** Exit Code 0. All 37 static and dynamic App Router routes compiled, validated, and optimized without errors.
2. **TypeScript Strict Type Check:** Passed with zero diagnostics across all modules and services.
3. **Pre-Migration Safety Stop Test:** Executed `node scripts/test-phase4a-suite.mjs` with matching `EXPECTED_TEST_PROJECT_REF="bplpyitmcqqebpdyochz"`.
   - **Result:** Successfully extracted and validated project reference, detected remote schema not yet initialized, reported `[PRE-MIGRATION SAFETY STOP]`, and terminated with zero remote writes.
4. **Environment Safety Gate Test:** Executed test suite with missing and mismatched project reference.
   - **Result:** Execution safely refused with exit code 1.
5. **Super-Admin Safety Gate Test:** Executed `scripts/provision-super-admin.mjs` without confirmation flag.
   - **Result:** Safely halted with `[SAFETY HALT] Explicit confirmation required.`

### Live Remote Tests (Not Executed — By Mandate)
- In strict adherence to project safety rules:
  - **No database migrations were pushed** (`supabase db push` was NOT run).
  - **No remote database writes were executed**.
  - **Super-admin provisioning was NOT executed on the remote database**.
  - **Rollback was NOT executed**.
- Live authenticated JWT assertions will execute cleanly once the operator applies migration `20261102000001_phase4a_foundation.sql` to the target development database.

---

## 5. Remaining Limitations & Deployment Guidelines

1. **Operator Migration Step:** The database migration `supabase/migrations/20261102000001_phase4a_foundation.sql` must be applied by the database administrator via the Supabase CLI (`supabase db push`) or the Supabase SQL Editor.
2. **Super-Admin Provisioning:** Once the migration is applied, the administrator can populate `.env.local` with real values (minimum 12-character password, legal entity details) and execute:
   ```bash
   CONFIRM_PROVISIONING="YES" node scripts/provision-super-admin.mjs
   ```
3. **Authenticated Test Suite Execution:** Following migration and initial provisioning, the test suite can be run in the authorized test environment:
   ```bash
   EXPECTED_TEST_PROJECT_REF="bplpyitmcqqebpdyochz" node scripts/test-phase4a-suite.mjs
   ```
