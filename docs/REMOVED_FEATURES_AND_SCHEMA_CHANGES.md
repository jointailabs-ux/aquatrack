# REMOVED FEATURES & SCHEMA CHANGES — AquaTrack ERP
**Single-Location Water Distribution & Inventory Management System**

**Document Reference:** `docs/REMOVED_FEATURES_AND_SCHEMA_CHANGES.md`  
**Date:** November 2026  
**Status:** ARCHITECTURAL SCOPE AUDIT  

---

## 1. Executive Summary

In accordance with the revised business requirements, AquaTrack ERP has been streamlined into a **single-location, single-warehouse operations platform**. Unnecessary enterprise features, multi-branch hierarchies, customer self-service authentication, and complex HR workflows have been permanently excised from the product architecture.

This simplification drastically reduces operational friction, eliminates circular database dependencies, hardens security by removing external customer attack surfaces, and focuses development directly on the core business: **reusable jar tracking, single-warehouse inventory, mobile delivery operations, POS walk-in sales, and financial integrity**.

---

## 2. Comprehensive Inventory of Removed Features

### 2.1 Multi-Branch & Multi-Organization Complexity
- **Removed:**
  - `organizations` table and multi-tenant isolation overhead.
  - Multi-organization switching dropdowns and session states.
  - `branches` table and depot hierarchy.
  - `branch_manager` role and branch-level permission checks.
  - Inter-branch stock transfers and branch-wise consolidated reporting.
- **Replacement:**
  - Single business entity configured in `business_settings`.
  - Single central operating warehouse (`warehouses` with `is_default = true`).

---

### 2.2 Customer Authentication & Self-Service Portal
- **Removed:**
  - Customer login page, customer session management, and customer portal layout (`/customer/*`).
  - Customer self-registration flow (`/register`).
  - `customer_onboarding_tokens` table.
  - Onboarding token generation, cryptographic verification, and consumption RPCs (`rpc_create_onboarding_token`, `rpc_verify_onboarding_token`, `rpc_register_customer_with_token`).
  - Foreign key `customers.profile_id` referencing `profiles(id)`.
  - `role = 'customer'` in `profiles`.
- **Replacement:**
  - Customers are managed purely as internal master-data business records by the Owner and authorized staff.
  - Enhanced Customer Detail Screen providing full transaction history, unpaid invoice balance, and full/empty jar holdings.

---

### 2.3 Staff Attendance & Leave Management
- **Removed:**
  - Biometric / mobile clock-in and clock-out tracking.
  - Shift attendance records (`attendance` table and `/attendance` UI route).
  - Leave requests, leave balances, and manager leave approval workflows.
  - Complex payroll deduction algorithms based on clock-in hours.
- **Replacement:**
  - Simplified staff salary tracking: base salary, advances given, approved deductions, and payout history.

---

### 2.4 Multi-Warehouse Tracking
- **Removed:**
  - Multiple regional sub-depots and complex multi-warehouse balance lookups.
- **Replacement:**
  - One central warehouse holding physical inventory, supported by mobile delivery vehicle custodians for in-transit stock.

---

## 3. Database Schema Diff & Modifications

| Object / Field | Previous Multi-Tenant Model | Revised Single-Location Model | Reason for Change |
| :--- | :--- | :--- | :--- |
| **`organizations`** | Table storing business tenants | **REPLACED by `business_settings`** | Single business enterprise; no multi-tenant isolation required |
| **`branches`** | Table storing depots & codes | **REMOVED** | Single operating location; no branches exist |
| **`customer_onboarding_tokens`** | Table storing token hashes | **REMOVED** | Customer authentication & self-registration eliminated |
| **`organization_id` column** | Present on all 10+ tables | **REMOVED from all tables** | Redundant single-business architecture |
| **`branch_id` column** | Present on locations, profiles, customers, warehouses | **REMOVED from all tables** | Redundant; single depot |
| **`profile_id` in `customers`** | FK linking customer to auth user | **REMOVED** | Customers do not authenticate |
| **`profiles.role`** | 7 roles (`super_admin`, `branch_manager`, `dispatcher`, `warehouse_staff`, `delivery_driver`, `accountant`, `customer`) | **SIMPLIFIED to 2 roles (`owner`, `staff`)** | Clear administrative vs staff separation |
| **`profiles` permissions** | Role-derived only | **ADDED modular flags (`can_pos`, `can_warehouse`, `can_manage_customers`, `can_manage_orders`)** | Allows owner to grant flexible operational privileges to staff |
| **`customers.total_full_jars_holding`** | Single `total_jars_holding` | **SPLIT into `total_full_jars_holding` and `total_empty_jars_holding`** | Supports independent tracking of full vs empty custody |
| **RPC: `rpc_create_onboarding_token`** | PRIVILEGED FUNCTION | **REMOVED** | Obsolete customer registration |
| **RPC: `rpc_verify_onboarding_token`** | PUBLIC FUNCTION | **REMOVED** | Obsolete customer registration |
| **RPC: `rpc_register_customer_with_token`** | PUBLIC FUNCTION | **REMOVED** | Obsolete customer registration |

---

## 4. UI / Application Route Clean-up Strategy

1. **Deprecated Routes (Clean Redirect or Removal):**
   - `/register` → Redirect cleanly to `/login`.
   - `/customer/*` → Deprecated; customer portal routes replaced by staff customer management (`/customers`).
   - `/attendance` → Deprecated; replaced by staff salary management (`/payroll` or `/staff`).
2. **Simplified Navigation Sidebar:**
   - **Core Operations:** Dashboard, Orders & Deliveries, POS Counter, Customers, Suppliers.
   - **Inventory & Assets:** Central Warehouse, Jar Tracking (Condition & Custody).
   - **Procurement & Finance:** Purchases, Payments, Expenses, Staff Salaries, Financial Reports.
   - **Administration:** Staff Management, Business Settings.
