# AquaTrack ERP — Phase 4A Security & Correctness Review
**Document Version:** 1.0.0  
**Audit Date:** November 2026  
**Auditor Roles:** Senior ERP Security Engineer, Database Architect, Full-Stack Lead  
**Audit Target:** Phase 4A Foundational Master Data & Security Implementation  
**Status:** **MIGRATION HOLD — REMEDIATION REQUIRED BEFORE APPLICATION**  

---

## 1. Executive Summary & Verdict

A thorough, line-by-line security and correctness audit was conducted across all Phase 4A database migrations, rollback scripts, provisioning scripts, Zod schemas, service repositories, and test suites.

### **VERDICT: NOT SAFE TO APPLY IN CURRENT STATE**

> [!CAUTION]
> The Phase 4A migration **MUST NOT be applied to the connected Supabase database** until two **CRITICAL** and four **HIGH** severity vulnerabilities are corrected. Applying the migration as currently written would introduce privilege escalation risks, search path hijacking vulnerabilities, public unauthenticated RPC execution, and unverified RLS policies.

---

## 2. Summary of Findings by Severity

| ID | Finding Title | Severity | Impacted File & Lines |
| :--- | :--- | :---: | :--- |
| **SEC-01** | User Self-Elevation to `super_admin` via Unrestricted Profile UPDATE | **CRITICAL** | `supabase/migrations/20261102000001_phase4a_foundation.sql:294-301` |
| **SEC-02** | Unauthenticated Public Execution of Privileged Creation RPCs | **CRITICAL** | `supabase/migrations/20261102000001_phase4a_foundation.sql:426-607` |
| **SEC-03** | Missing `search_path` on `SECURITY DEFINER` Functions (Hijacking Risk) | **HIGH** | `supabase/migrations/20261102000001_phase4a_foundation.sql:232-250, 426-607` |
| **SEC-04** | Missing Profile INSERT Policy Blocks Customer Self-Registration | **HIGH** | `supabase/migrations/20261102000001_phase4a_foundation.sql:285-301` |
| **SEC-05** | Customer Account Self-Deletion Allowed via `FOR ALL` Policy | **HIGH** | `supabase/migrations/20261102000001_phase4a_foundation.sql:353-366` |
| **SEC-06** | Test Suite Uses Service Role, Bypassing RLS Verification Entirely | **HIGH** | `scripts/test-phase4a-suite.mjs:54-56, 319-361` |
| **SEC-07** | Parameterized `organization_id` in RPC Enables Cross-Tenant Injection | **MEDIUM** | `supabase/migrations/20261102000001_phase4a_foundation.sql:427, 502, 563` |
| **SEC-08** | Product Cost Price (`cost_price`) Exposed to Customers via Full SELECT | **MEDIUM** | `supabase/migrations/20261102000001_phase4a_foundation.sql:388-390` |
| **SEC-09** | Missing `p_profile_id` Parameter in Customer Creation RPC | **MEDIUM** | `supabase/migrations/20261102000001_phase4a_foundation.sql:426-440` |
| **SEC-10** | Missing Non-Unique Foreign Key Indexes on Special Prices & Warehouses | **LOW** | `supabase/migrations/20261102000001_phase4a_foundation.sql:187-201` |
| **SEC-11** | Destructive `CASCADE` in Rollback Script Risks Catastrophic Data Loss | **LOW** | `supabase/migrations/rollback/20261102000001_phase4a_rollback.sql:19-27` |
| **SEC-12** | Missing RLS Policies for DELETE on Organizations and Products | **LOW** | `supabase/migrations/20261102000001_phase4a_foundation.sql:266-273, 388-401` |

---

## 3. Detailed Findings & Recommended Corrections

### SEC-01: User Self-Elevation to `super_admin` via Unrestricted Profile UPDATE
- **Severity:** **CRITICAL**
- **File & Lines:** [`supabase/migrations/20261102000001_phase4a_foundation.sql:294-301`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261102000001_phase4a_foundation.sql#L294-L301)
- **Vulnerability Description:**  
  The RLS update policy on `public.profiles` is defined as:
  ```sql
  CREATE POLICY rls_profiles_update ON public.profiles
      FOR UPDATE TO authenticated
      USING (
          id = auth.uid() OR (
              organization_id = public.get_user_org_id() AND
              public.get_user_role() = 'super_admin'
          )
      );
  ```
  Because there is no `WITH CHECK` expression restricting modifiable columns, any authenticated user (e.g. a `customer` or `delivery_driver`) can issue:
  ```sql
  UPDATE public.profiles SET role = 'super_admin' WHERE id = auth.uid();
  ```
  PostgreSQL evaluates `id = auth.uid()` to `TRUE` and allows the update, granting immediate full system administration privileges to any user.
- **Recommended Correction:**  
  1. Add a PostgreSQL `BEFORE UPDATE` trigger on `public.profiles` preventing modification of `role` or `organization_id` unless `public.get_user_role() = 'super_admin'`.
  2. Split the update policy into user self-service (allowing edits only to `full_name`, `avatar_url`, and `phone`) and administrative update (restricted to `super_admin`).

---

### SEC-02: Unauthenticated Public Execution of Privileged Creation RPCs
- **Severity:** **CRITICAL**
- **File & Lines:** [`supabase/migrations/20261102000001_phase4a_foundation.sql:426-607`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261102000001_phase4a_foundation.sql#L426-L607)
- **Vulnerability Description:**  
  The RPC functions `rpc_create_customer_with_location`, `rpc_create_supplier_with_location`, and `rpc_create_warehouse_with_location` are declared as `SECURITY DEFINER`, which executes them with superuser (`postgres`) privileges.
  However:
  1. By default in PostgreSQL, newly created functions grant `EXECUTE` privilege to `PUBLIC` (including unauthenticated `anon` clients).
  2. Inside `rpc_create_warehouse_with_location` and `rpc_create_supplier_with_location`, there are **zero internal authorization checks**.
  An anonymous web attacker can invoke `supabase.rpc('rpc_create_warehouse_with_location', { ... })` and create arbitrary warehouses and custody locations directly inside the database.
- **Recommended Correction:**  
  1. Add internal caller role validation at the top of each privileged function:
     ```sql
     IF public.get_user_role() NOT IN ('super_admin', 'branch_manager') THEN
         RAISE EXCEPTION 'Access denied: insufficient administrative privileges';
     END IF;
     ```
  2. Explicitly revoke public execution permissions:
     ```sql
     REVOKE EXECUTE ON FUNCTION public.rpc_create_warehouse_with_location FROM PUBLIC;
     REVOKE EXECUTE ON FUNCTION public.rpc_create_supplier_with_location FROM PUBLIC;
     GRANT EXECUTE ON FUNCTION public.rpc_create_warehouse_with_location TO authenticated;
     GRANT EXECUTE ON FUNCTION public.rpc_create_supplier_with_location TO authenticated;
     ```

---

### SEC-03: Missing `search_path` on `SECURITY DEFINER` Functions
- **Severity:** **HIGH**
- **File & Lines:** [`supabase/migrations/20261102000001_phase4a_foundation.sql:232-250, 426-607`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261102000001_phase4a_foundation.sql#L232-L250)
- **Vulnerability Description:**  
  All seven `SECURITY DEFINER` functions (`get_user_role`, `get_user_org_id`, `get_user_branch_id`, `get_user_customer_id`, and the three creation RPCs) omit the clause:
  ```sql
  SET search_path = public, pg_temp;
  ```
  In PostgreSQL, executing `SECURITY DEFINER` functions without a fixed `search_path` allows search-path hijacking attacks, where malicious objects placed in a user-controlled schema or temporary schema override core functions during execution.
- **Recommended Correction:**  
  Append `SET search_path = public, pg_temp;` to all `SECURITY DEFINER` function declarations.

---

### SEC-04: Missing Profile INSERT Policy Blocks Customer Self-Registration
- **Severity:** **HIGH**
- **File & Lines:** [`supabase/migrations/20261102000001_phase4a_foundation.sql:285-301`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261102000001_phase4a_foundation.sql#L285-L301)
- **Vulnerability Description:**  
  The migration defines `rls_profiles_select` and `rls_profiles_update`, but specifies **NO INSERT policy** on `public.profiles`.
  When a newly authenticated customer completes the registration form (`/register`), their browser client attempts to insert into `public.profiles`. Because RLS defaults to deny-all for unspecified actions, the insert is immediately blocked with an RLS violation error.
- **Recommended Correction:**  
  Either:
  1. Add an insert policy allowing authenticated users to insert strictly their own profile row:
     ```sql
     CREATE POLICY rls_profiles_insert ON public.profiles
         FOR INSERT TO authenticated
         WITH CHECK (id = auth.uid() AND role = 'customer');
     ```
  2. Implement a standard Supabase `on_auth_user_created` trigger on `auth.users` to provision the base profile automatically.

---

### SEC-05: Customer Account Self-Deletion Allowed via `FOR ALL` Policy
- **Severity:** **HIGH**
- **File & Lines:** [`supabase/migrations/20261102000001_phase4a_foundation.sql:353-366`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261102000001_phase4a_foundation.sql#L353-L366)
- **Vulnerability Description:**  
  The policy `rls_customers_write` uses `FOR ALL TO authenticated` with the condition:
  ```sql
  USING (
      organization_id = public.get_user_org_id() AND (
          profile_id = auth.uid() OR
          public.get_user_role() IN ('super_admin', 'branch_manager', 'dispatcher', 'accountant')
      )
  )
  ```
  `FOR ALL` encompasses `INSERT`, `UPDATE`, and `DELETE`. Because `profile_id = auth.uid()` satisfies the `USING` condition, any authenticated customer can issue `DELETE FROM customers WHERE id = ...` and permanently delete their customer record, breaking linked locations, audit histories, and jar deposit ledgers.
- **Recommended Correction:**  
  Split `rls_customers_write` into separate `FOR UPDATE` and `FOR INSERT` policies. Completely disallow `DELETE` for customers.

---

### SEC-06: Test Suite Uses Service Role, Bypassing RLS Verification Entirely
- **Severity:** **HIGH**
- **File & Lines:** [`scripts/test-phase4a-suite.mjs:54-56, 319-361`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/scripts/test-phase4a-suite.mjs#L54-L56)
- **Vulnerability Description:**  
  The 13-point test suite script initializes `adminClient` with `SUPABASE_SECRET_KEY` and runs almost all tests through this client. In PostgreSQL and Supabase, the service role key bypasses Row-Level Security entirely.
  Tests 10, 11, 12, and 13 claim to verify tenant isolation, customer data isolation, and RBAC policies, but in reality:
  - Test 11 explicitly notes: `// Under admin client (service role), it bypasses RLS`.
  - Test 12 performs a simple `adminClient.from("customers").select(...)` which proves the record exists, but **does not prove** that an unlinked customer is blocked from reading it.
- **Recommended Correction:**  
  Refactor `scripts/test-phase4a-suite.mjs` to authenticate real JWT sessions for different personas (`customer_client`, `driver_client`, `admin_client`, and `other_org_client`) and execute queries through those authenticated clients to verify RLS enforcement.

---

### SEC-07: Parameterized `organization_id` in RPC Enables Cross-Tenant Injection
- **Severity:** **MEDIUM**
- **File & Lines:** [`supabase/migrations/20261102000001_phase4a_foundation.sql:427, 502, 563`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261102000001_phase4a_foundation.sql#L427)
- **Vulnerability Description:**  
  The RPC functions accept `p_organization_id UUID` as a user-supplied argument and directly insert it into `locations`, `customers`, `suppliers`, and `warehouses`. Because these functions are `SECURITY DEFINER`, they bypass table RLS check policies during insertion. A user authenticated in Organization A could pass Organization B's UUID and create records inside Organization B.
- **Recommended Correction:**  
  Remove `p_organization_id` as a client-supplied parameter and resolve it inside the function via `v_org_id := public.get_user_org_id();`, or validate that `p_organization_id = public.get_user_org_id()`.

---

### SEC-08: Product Cost Price (`cost_price`) Exposed to Customers via Full SELECT
- **Severity:** **MEDIUM**
- **File & Lines:** [`supabase/migrations/20261102000001_phase4a_foundation.sql:388-390`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261102000001_phase4a_foundation.sql#L388-L390)
- **Vulnerability Description:**  
  The policy `rls_products_select` grants `SELECT TO authenticated` with `USING (organization_id = public.get_user_org_id());`. This allows customer users to query `public.products` directly. Because Row-Level Security filters rows rather than columns, a query for `*` returns `cost_price`, exposing internal wholesale procurement prices and distributor profit margins to retail customers.
- **Recommended Correction:**  
  Create a secure public catalog projection (e.g. `view_public_products` or column-level security) that omits `cost_price` for non-staff roles.

---

### SEC-09: Missing `p_profile_id` Parameter in Customer Creation RPC
- **Severity:** **MEDIUM**
- **File & Lines:** [`supabase/migrations/20261102000001_phase4a_foundation.sql:426-440`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261102000001_phase4a_foundation.sql#L426-L440)
- **Vulnerability Description:**  
  `rpc_create_customer_with_location` does not accept a `p_profile_id` parameter. When a customer registers via `/register`, their profile cannot be bound to their customer master record in the initial atomic transaction.
- **Recommended Correction:**  
  Add `p_profile_id UUID DEFAULT NULL` to the function parameters and pass it to the `customers` insert statement.

---

### SEC-10: Missing Foreign Key Indexes on Special Prices & Warehouses
- **Severity:** **LOW**
- **File & Lines:** [`supabase/migrations/20261102000001_phase4a_foundation.sql:187-201`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261102000001_phase4a_foundation.sql#L187-L201)
- **Description:**  
  `customer_special_prices` lacks an index on `organization_id`, and `warehouses` lacks an explicit index on `location_id`.
- **Recommended Correction:**  
  Add `idx_csp_org ON public.customer_special_prices(organization_id);`.

---

### SEC-11: Destructive `CASCADE` in Rollback Script Risks Catastrophic Data Loss
- **Severity:** **LOW**
- **File & Lines:** [`supabase/migrations/rollback/20261102000001_phase4a_rollback.sql:19-27`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/rollback/20261102000001_phase4a_rollback.sql#L19-L27)
- **Description:**  
  The rollback script issues `DROP TABLE IF EXISTS ... CASCADE;`. If executed in an environment where downstream operational tables (e.g. `stock_balances`, `invoices`, `delivery_trips`) have been introduced, it will silently drop all dependent business tables.
- **Recommended Correction:**  
  Add safe existence guards and prominent warnings to the rollback script.

---

### SEC-12: Missing Explicit RLS Policies for DELETE on Organizations and Products
- **Severity:** **LOW**
- **File & Lines:** [`supabase/migrations/20261102000001_phase4a_foundation.sql:266-273, 388-401`](file:///c:/Users/Koushik/Downloads/Aqua%20Lite/supabase/migrations/20261102000001_phase4a_foundation.sql#L266-L273)
- **Description:**  
  `organizations` has no `DELETE` policy, and `products` allows `super_admin` and `branch_manager` to issue `DELETE` via `FOR ALL`. Deleting active catalog items with historical transaction references causes referential integrity failures.
- **Recommended Correction:**  
  Explicitly restrict `DELETE` on products to prevent hard deletion of catalog items; enforce soft-delete via `is_active = false`.

---

## 4. Assessment of Specific Audit Checkpoints

| Checkpoint | Status | Assessment |
| :--- | :---: | :--- |
| **1. Table structure, FKs, constraints, indexes** | **PASSED WITH MINOR ADVISORY** | All tables use UUID PKs, strict foreign keys, domain checks, and appropriate unique constraints. Minor missing indexes noted in SEC-10. |
| **2. RLS enabled on all tables** | **VERIFIED** | All 9 tables execute `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`. |
| **3. RLS policies for CRUD coverage** | **FAILED (REMEDIATION REQUIRED)** | Critical gaps identified: profile self-elevation (SEC-01), customer self-deletion (SEC-05), and missing profile insert policy (SEC-04). |
| **4. SECURITY DEFINER & search_path** | **FAILED (REMEDIATION REQUIRED)** | Functions lack `search_path = public, pg_temp;` (SEC-03) and public execution is not revoked (SEC-02). |
| **5. Cross-organization access prevention** | **PARTIAL** | Table-level RLS isolates rows by `organization_id = get_user_org_id()`, but RPC functions allow client-supplied `organization_id` (SEC-07). |
| **6. Customer and driver data isolation** | **PARTIAL** | Customers are blocked from warehouses and suppliers, but `cost_price` is exposed in `products` (SEC-08). Drivers are properly restricted. |
| **7. Atomic location & child-record creation** | **VERIFIED** | Two-step sequence is correctly wrapped in PL/pgSQL atomic RPC transactions. |
| **8. Configurable GST and HSN** | **VERIFIED** | HSN and GST rates (CGST, SGST, IGST) are fully configurable with no hardcoded rate assumptions; check constraint enforces tax balance. |
| **9. Super admin provisioning & anti-escalation**| **FAILED (REMEDIATION REQUIRED)** | Script logic is sound, but database-level policy flaw (SEC-01) permits users to elevate themselves to `super_admin`. |
| **10. Rollback safety** | **ADVISORY** | Rollback uses `CASCADE`; safe only in isolated Phase 4A development environments (SEC-11). |
| **11. Service-role separation** | **VERIFIED** | Public clients never receive service keys; server boundary `import 'server-only'` is verified. |
| **12. Test suite RLS verification** | **FAILED (REMEDIATION REQUIRED)** | Test suite executes with service role key, bypassing RLS and failing to prove real-world policy enforcement (SEC-06). |

---

## 5. Required Action Plan Before Migration Can Proceed

To make Phase 4A production-ready and safe to apply:

1. **Remediate SQL Migration (`supabase/migrations/20261102000001_phase4a_foundation.sql`):**
   - Implement trigger on `public.profiles` blocking self-elevation of `role`.
   - Add `SET search_path = public, pg_temp;` to all 7 `SECURITY DEFINER` functions.
   - Add internal role validation (`IF get_user_role() NOT IN (...)`) and `REVOKE EXECUTE ... FROM PUBLIC` on RPCs.
   - Remove `p_organization_id` from RPC parameters, using `public.get_user_org_id()` internally.
   - Add `rls_profiles_insert` policy allowing customer self-registration.
   - Split `rls_customers_write` to eliminate customer self-deletion.
2. **Remediate Test Suite (`scripts/test-phase4a-suite.mjs`):**
   - Refactor tests 10–13 to sign in with actual test user accounts possessing `customer`, `delivery_driver`, and `super_admin` roles to rigorously validate RLS behavior under real JWT tokens.
3. **Re-evaluate and Review:**
   - Present the corrected migration and test suite for final approval before connecting to Supabase.
