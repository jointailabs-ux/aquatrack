# AquaTrack ERP — Round 6 Schema Compatibility Report
**Architectural Baseline:** Single-Location Operations Platform (One Business, One Central Warehouse, Owner + Staff)  
**Database Engine:** PostgreSQL 15+ with Supabase Extensions (`pgcrypto`)  
**Security Standard:** Strict Zero-Trust Column Access, Call-Stack Domain-Scoped Trigger Guards, Row-Level Security (RLS) on all 28 tables.

---

## 1. Canonical Schema Inventory & Discrepancy Analysis

The Round 5 audit identified discrepancies where RPC functions and test scripts referenced non-existent columns or violated database constraints. The table below presents the authoritative foundation schema (`20261102000001_phase4a_foundation.sql`) compared against the erroneous Round 5 references.

| Entity / Table | Canonical Schema Column | Erroneous Round 5 Reference | Remediation Applied in Round 6 |
|---|---|---|---|
| `public.locations` | `type VARCHAR(30)` (`'WAREHOUSE'`, `'VEHICLE'`, `'CUSTOMER'`, `'SUPPLIER'`, `'SCRAP_YARD'`) | `locations.location_type` | Corrected all SQL statements and test fixtures to reference `locations.type`. Validated against `type IN (...)` constraint. |
| `public.products` | `default_sale_price NUMERIC(12,2)` | `products.price` | Replaced all references to `products.price` with authoritative `products.default_sale_price`. |
| `public.customer_special_prices` | `effective_from DATE`, `effective_to DATE` (Nullable) | `customer_special_prices.is_active` | Corrected special price resolution to check date range: `effective_from <= target_date AND (effective_to IS NULL OR effective_to >= target_date)`. |
| `public.stock_movements` | `source_location_id UUID`, `destination_location_id UUID`, `movement_type VARCHAR(40)`, `reference_type VARCHAR(30)` | `warehouse_id`, `movement_type = 'IN'`, `reference_type = 'JAR_MOVEMENT'` | Fixed column list to use canonical location foreign keys. Aligned `movement_type` to `'PURCHASE_RECEIPT'`, `'DELIVERY_DISPATCH'`, `'ADJUSTMENT_IN'`, etc., and `reference_type` to `'PURCHASE'`, `'AUDIT'`, etc. |
| `public.jar_custody_movements` | `movement_type` (11 allowed enum values), `reference_type` (`'ORDER'`, `'DELIVERY_STOP'`, `'PURCHASE'`, `'BATCH_WASH'`, `'AUDIT'`) | `movement_type = 'OPENING_STOCK'`, `movement_type = 'STOCK_ADJUSTMENT'`, `reference_type = 'MANUAL'` | Normalized movement types to database-allowed values (`OPENING_STOCK` maps to `INTERNAL_ADJUSTMENT`; reference type normalizes to `'PURCHASE'`, `'AUDIT'`, etc., or NULL). |
| `public.customers` | `contact_name VARCHAR(150)`, `customer_type VARCHAR(10)` (`'B2C'`, `'B2B'`), `address TEXT NOT NULL` | `full_name`, `customer_type = 'RETAIL'` | Corrected test fixtures to use `contact_name`, `customer_type = 'B2C'`, and provide required `address`. |
| `public.suppliers` | `name VARCHAR(200)` | `supplier_name` | Corrected test fixtures to use canonical column `name`. |

---

## 2. Comprehensive Table Definitions, Types & Constraints

### 2.1 `public.locations`
*Physical custody nodes across the single-location platform.*
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `type VARCHAR(30) NOT NULL`
  - **CHECK:** `type IN ('WAREHOUSE', 'VEHICLE', 'CUSTOMER', 'SUPPLIER', 'SCRAP_YARD')`
- `name VARCHAR(150) NOT NULL`
- `address TEXT`
- `is_active BOOLEAN NOT NULL DEFAULT true`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- **Indexes:** `idx_locations_type ON public.locations(type)`

### 2.2 `public.warehouses`
*Central depot entity (Exactly one default warehouse invariant).*
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `location_id UUID NOT NULL UNIQUE REFERENCES public.locations(id) ON DELETE RESTRICT`
- `name VARCHAR(150) NOT NULL UNIQUE`
- `address TEXT`
- `is_default BOOLEAN NOT NULL DEFAULT true`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- **Unique Partial Index:** `uq_single_default_warehouse ON public.warehouses(is_default) WHERE is_default = true`

### 2.3 `public.profiles`
*Staff and owner profiles extending Supabase auth.users.*
- `id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`
- `full_name VARCHAR(150) NOT NULL`
- `phone VARCHAR(20) NOT NULL`
- `role VARCHAR(30) NOT NULL CHECK (role IN ('owner', 'staff'))`
- `avatar_url TEXT`
- `is_active BOOLEAN NOT NULL DEFAULT true`
- `can_pos BOOLEAN NOT NULL DEFAULT false`
- `can_warehouse BOOLEAN NOT NULL DEFAULT false`
- `can_manage_customers BOOLEAN NOT NULL DEFAULT false`
- `can_manage_orders BOOLEAN NOT NULL DEFAULT false`
- `can_deliveries BOOLEAN NOT NULL DEFAULT true`
- `can_manage_suppliers BOOLEAN NOT NULL DEFAULT false`
- `can_manage_expenses BOOLEAN NOT NULL DEFAULT false`
- `can_manage_salaries BOOLEAN NOT NULL DEFAULT false`
- `salary_amount NUMERIC(12,2) DEFAULT 0.00 CHECK (salary_amount >= 0)`
- `salary_type VARCHAR(20) DEFAULT 'MONTHLY' CHECK (salary_type IN ('MONTHLY', 'FIXED_PERIOD'))`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- **Unique Partial Index:** `uq_single_owner ON public.profiles(role) WHERE role = 'owner'`

### 2.4 `public.customers`
*Customer master with decoupled 5-condition custody accounting.*
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `location_id UUID NOT NULL UNIQUE REFERENCES public.locations(id) ON DELETE RESTRICT`
- `customer_type VARCHAR(10) NOT NULL CHECK (customer_type IN ('B2C', 'B2B'))`
- `business_name VARCHAR(200)`
- `contact_name VARCHAR(150) NOT NULL`
- `phone VARCHAR(20) NOT NULL UNIQUE`
- `email VARCHAR(255)`
- `address TEXT NOT NULL`
- `delivery_instructions TEXT`
- `gstin VARCHAR(30)`
- `credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (credit_limit >= 0)`
- `max_jar_limit INTEGER NOT NULL DEFAULT 5 CHECK (max_jar_limit >= 0)`
- `payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0)`
- `current_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00`
- `total_full_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_full_jars_holding >= 0)` (Condition: `FULL_USABLE`)
- `total_empty_clean_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_empty_clean_holding >= 0)` (Condition: `EMPTY_CLEAN`)
- `total_empty_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_empty_jars_holding >= 0)` (Condition: `EMPTY_DIRTY`)
- `total_damaged_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_damaged_jars_holding >= 0)` (Condition: `DAMAGED_REPAIRABLE`)
- `total_scrap_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_scrap_jars_holding >= 0)` (Condition: `DAMAGED_SCRAP`)
- `total_deposit_held NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (total_deposit_held >= 0)`
- `notes TEXT`
- `is_active BOOLEAN NOT NULL DEFAULT true`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- **CHECK:** `chk_b2b_business_name CHECK (customer_type = 'B2C' OR (customer_type = 'B2B' AND business_name IS NOT NULL))`

### 2.5 `public.suppliers`
*Bottling plants and vendor profiles.*
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `location_id UUID NOT NULL UNIQUE REFERENCES public.locations(id) ON DELETE RESTRICT`
- `name VARCHAR(200) NOT NULL UNIQUE`
- `contact_person VARCHAR(150) NOT NULL`
- `phone VARCHAR(20) NOT NULL`
- `email VARCHAR(255)`
- `address TEXT`
- `gstin VARCHAR(30)`
- `payment_terms_days INTEGER NOT NULL DEFAULT 15 CHECK (payment_terms_days >= 0)`
- `current_payable NUMERIC(12,2) NOT NULL DEFAULT 0.00`
- `jars_in_custody INTEGER NOT NULL DEFAULT 0 CHECK (jars_in_custody >= 0)`
- `is_active BOOLEAN NOT NULL DEFAULT true`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`

### 2.6 `public.products`
*Product master with individual statutory GST configuration.*
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `sku VARCHAR(50) NOT NULL UNIQUE`
- `name VARCHAR(150) NOT NULL`
- `category VARCHAR(30) NOT NULL CHECK (category IN ('REFILLABLE_WATER', 'EMPTY_JAR_ASSET', 'PACKAGED_WATER', 'BEVERAGE', 'DISPENSER_EQUIPMENT', 'CONSUMABLE', 'SERVICE'))`
- `unit_of_measure VARCHAR(20) NOT NULL DEFAULT 'UNIT'`
- `default_sale_price NUMERIC(12,2) NOT NULL CHECK (default_sale_price >= 0)`
- `deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (deposit_amount >= 0)`
- `cost_price NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (cost_price >= 0)`
- `hsn_code VARCHAR(20) NOT NULL`
- `gst_rate NUMERIC(5,2) NOT NULL CHECK (gst_rate >= 0)`
- `cgst_rate NUMERIC(5,2) NOT NULL CHECK (cgst_rate >= 0)`
- `sgst_rate NUMERIC(5,2) NOT NULL CHECK (sgst_rate >= 0)`
- `igst_rate NUMERIC(5,2) NOT NULL CHECK (igst_rate >= 0)`
- `cess_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (cess_rate >= 0)`
- `is_reusable_jar BOOLEAN NOT NULL DEFAULT false`
- `is_active BOOLEAN NOT NULL DEFAULT true`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- **CHECK:** `chk_products_gst_balance CHECK (gst_rate = cgst_rate + sgst_rate)`

### 2.7 `public.customer_special_prices`
*Agreed negotiated contract pricing with effective date ranges.*
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE`
- `product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT`
- `special_price NUMERIC(12,2) NOT NULL CHECK (special_price >= 0)`
- `effective_from DATE NOT NULL DEFAULT CURRENT_DATE`
- `effective_to DATE` (Nullable)
- `created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- **CHECK:** `chk_csp_date_range CHECK (effective_to IS NULL OR effective_to >= effective_from)`
- **Unique Constraint:** `uq_csp_customer_product_date UNIQUE (customer_id, product_id, effective_from)`

### 2.8 `public.inventory_balances`
*Physical central warehouse inventory stock by SKU.*
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE`
- `product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT`
- `quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0)`
- `quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0)`
- `last_counted_at TIMESTAMPTZ`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- **Unique Constraint:** `uq_inv_warehouse_product UNIQUE (warehouse_id, product_id)`

### 2.9 `public.stock_movements`
*Immutable dual-entry inventory audit log.*
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT`
- `source_location_id UUID REFERENCES public.locations(id) ON DELETE RESTRICT`
- `destination_location_id UUID REFERENCES public.locations(id) ON DELETE RESTRICT`
- `quantity INTEGER NOT NULL CHECK (quantity > 0)`
- `movement_type VARCHAR(40) NOT NULL CHECK (movement_type IN ('PURCHASE_RECEIPT', 'POS_SALE', 'DELIVERY_DISPATCH', 'DELIVERY_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SCRAP_WRITEOFF'))`
- `reference_type VARCHAR(30) CHECK (reference_type IN ('PURCHASE', 'POS_SALE', 'ORDER', 'DELIVERY_STOP', 'AUDIT'))`
- `reference_id UUID`
- `notes TEXT`
- `created_by UUID REFERENCES public.profiles(id)`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`

### 2.10 `public.jar_custody_movements`
*Decoupled jar tracking across 5 conditions and physical locations.*
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT`
- `source_location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT`
- `destination_location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT`
- `condition_from VARCHAR(30) NOT NULL CHECK (condition_from IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP'))`
- `condition_to VARCHAR(30) NOT NULL CHECK (condition_to IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP'))`
- `quantity INTEGER NOT NULL CHECK (quantity > 0)`
- `movement_type VARCHAR(40) NOT NULL CHECK (movement_type IN ('CUSTOMER_DELIVERY', 'CUSTOMER_EMPTY_RETURN', 'DAMAGED_COLLECTED', 'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL', 'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT', 'DISPATCH_TO_VEHICLE', 'VEHICLE_RETURN_TO_WAREHOUSE', 'SUPPLIER_PURCHASE', 'RETURN_TO_SUPPLIER'))`
- `reference_type VARCHAR(30) CHECK (reference_type IN ('ORDER', 'DELIVERY_STOP', 'PURCHASE', 'BATCH_WASH', 'AUDIT'))`
- `reference_id UUID`
- `notes TEXT`
- `created_by UUID REFERENCES public.profiles(id)`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`

### 2.11 `public.purchases` & `public.purchase_items`
*Vendor procurement records with ordered vs received quantity tracking.*
- `public.purchases`:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `po_number VARCHAR(50) NOT NULL UNIQUE`
  - `supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT`
  - `status VARCHAR(20) NOT NULL DEFAULT 'ORDERED' CHECK (status IN ('ORDERED', 'RECEIVED', 'CANCELLED'))`
  - `payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID'))`
  - `subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0)`
  - `tax_total NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (tax_total >= 0)`
  - `total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0)`
  - `amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0)`
  - `balance_due NUMERIC(12,2) NOT NULL CHECK (balance_due >= 0)`
  - `purchase_date DATE NOT NULL DEFAULT CURRENT_DATE`
  - `received_at TIMESTAMPTZ`
  - `notes TEXT`
  - `created_by UUID REFERENCES public.profiles(id)`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()`
- `public.purchase_items`:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE`
  - `product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT`
  - `quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0)`
  - `quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0)`
  - `unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0)`
  - `tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00`
  - `tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00`
  - `total_cost NUMERIC(12,2) NOT NULL CHECK (total_cost >= 0)`

---

## 3. Trigger Security & Call-Stack Scoping Matrix

| Trigger Name | Target Table | Function | Authorized RPCs | Permitted Modification Scope | Blocked Operations |
|---|---|---|---|---|---|
| `trg_protect_customer_privileged_fields` | `public.customers` | `check_customer_privileged_updates()` | `rpc_record_jar_movement` | Jar custody columns (`total_full_jars_holding`, `total_empty_clean_holding`, `total_empty_jars_holding`, `total_damaged_jars_holding`, `total_scrap_jars_holding`) ONLY | Direct edits to `current_balance` or `total_deposit_held` blocked. |
| | | | `rpc_create_customer_order` | `current_balance` ONLY | Edits to jar holdings or deposit balances blocked. |
| | | | Direct authenticated user | Owner role ONLY | Ordinary staff attempting direct writes to `current_balance`, deposits, or any jar holdings strictly rejected with access denied exception. |
| | | | Direct INSERT | Any authenticated staff | New records MUST initialize financial balances and jar holdings to 0.00 / 0. |
| `trg_protect_supplier_privileged_fields` | `public.suppliers` | `check_supplier_privileged_updates()` | `rpc_record_jar_movement` | `jars_in_custody` ONLY | Direct edits to `current_payable` blocked. |
| | | | `rpc_receive_purchase_order`, `rpc_record_supplier_payment` | Purchase/payment workflows | Disallowed outside transactional workflows. |
| | | | Direct authenticated user | Owner role ONLY | Staff direct updates to `current_payable` or `jars_in_custody` rejected. Initial inserts must have 0 payable and 0 custody. |

---

## 4. Key RPC Signatures & Execution Grants

```sql
-- 1. Record Jar Movement
FUNCTION public.rpc_record_jar_movement(
    p_source_location_id UUID,
    p_destination_location_id UUID,
    p_condition_from VARCHAR,
    p_condition_to VARCHAR,
    p_quantity INT,
    p_movement_type VARCHAR,
    p_reference_type VARCHAR DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
) RETURNS JSONB;
-- Grants: authenticated, service_role (Public/anon revoked)

-- 2. Create Customer Order
FUNCTION public.rpc_create_customer_order(
    p_customer_id UUID,
    p_delivery_address TEXT DEFAULT NULL,
    p_delivery_date DATE DEFAULT NULL,
    p_assigned_staff_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_price_override_reason TEXT DEFAULT NULL
) RETURNS JSONB;
-- Grants: authenticated, service_role (Public/anon revoked)
```
