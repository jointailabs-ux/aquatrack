-- ==============================================================================
-- AquaTrack ERP — Rollback Script: Phase 4A Single-Location Operational Platform
-- Version: 20261102000001_phase4a_rollback.sql
-- Architecture: Single-Location Operations
-- Description: Reverses Phase 4A migration cleanly and safely in reverse dependency
--              order. Avoids CASCADE drops to protect unrelated schemas and extensions.
--
-- Security Baseline Retention:
--   The migration executed: REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--   In accordance with CIS PostgreSQL Benchmark Section 2, this rollback
--   script INTENTIONALLY DOES NOT re-grant CREATE on public to PUBLIC.
-- ==============================================================================

-- 1. DROP DEFENSIVE AND UPDATED_AT TRIGGERS
DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
DROP TRIGGER IF EXISTS trg_purchases_updated_at ON public.purchases;
DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
DROP TRIGGER IF EXISTS trg_delivery_stops_updated_at ON public.delivery_stops;
DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
DROP TRIGGER IF EXISTS trg_prevent_product_hard_delete ON public.products;
DROP TRIGGER IF EXISTS trg_protect_customer_financial_fields ON public.customers;
DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON public.profiles;
DROP TRIGGER IF EXISTS trg_check_profile_insert ON public.profiles;

DROP TRIGGER IF EXISTS trg_customer_special_prices_updated_at ON public.customer_special_prices;
DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON public.suppliers;
DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
DROP TRIGGER IF EXISTS trg_warehouses_updated_at ON public.warehouses;
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
DROP TRIGGER IF EXISTS trg_locations_updated_at ON public.locations;
DROP TRIGGER IF EXISTS trg_business_settings_updated_at ON public.business_settings;

-- 2. DROP VIEWS
DROP VIEW IF EXISTS public.customer_product_catalog;

-- 3. DROP RPC FUNCTIONS (SPECIFYING EXACT SIGNATURES)
DROP FUNCTION IF EXISTS public.rpc_receive_purchase_order(UUID, JSONB);
DROP FUNCTION IF EXISTS public.rpc_complete_pos_sale(JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, NUMERIC, NUMERIC, VARCHAR, TEXT);
DROP FUNCTION IF EXISTS public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.rpc_create_warehouse_with_location(VARCHAR, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.rpc_create_supplier_with_location(VARCHAR, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS public.rpc_create_customer_with_location(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, VARCHAR, NUMERIC, INTEGER, INTEGER, TEXT);

-- 4. DROP DEFENSIVE & RLS HELPER FUNCTIONS
DROP FUNCTION IF EXISTS public.protect_customer_financial_fields();
DROP FUNCTION IF EXISTS public.prevent_product_hard_delete();
DROP FUNCTION IF EXISTS public.check_profile_insert_privileges();
DROP FUNCTION IF EXISTS public.check_profile_update_privileges();
DROP FUNCTION IF EXISTS public.get_staff_permissions();
DROP FUNCTION IF EXISTS public.get_user_role();

-- 5. DROP TABLES IN STRICT REVERSE DEPENDENCY ORDER (NO CASCADE)
-- Operational & Ledger Tables First
DROP TABLE IF EXISTS public.audit_logs;
DROP TABLE IF EXISTS public.financial_ledger;
DROP TABLE IF EXISTS public.cash_handovers;
DROP TABLE IF EXISTS public.salary_payments;
DROP TABLE IF EXISTS public.salary_advances;
DROP TABLE IF EXISTS public.expenses;
DROP TABLE IF EXISTS public.supplier_payments;
DROP TABLE IF EXISTS public.purchase_items;
DROP TABLE IF EXISTS public.purchases;
DROP TABLE IF EXISTS public.pos_sale_items;
DROP TABLE IF EXISTS public.pos_sales;
DROP TABLE IF EXISTS public.customer_payments;
DROP TABLE IF EXISTS public.invoice_items;
DROP TABLE IF EXISTS public.invoices;
DROP TABLE IF EXISTS public.delivery_stops;
DROP TABLE IF EXISTS public.order_items;
DROP TABLE IF EXISTS public.orders;
DROP TABLE IF EXISTS public.jar_custody_movements;
DROP TABLE IF EXISTS public.stock_movements;
DROP TABLE IF EXISTS public.inventory_balances;

-- Foundational Master Data Tables Next
DROP TABLE IF EXISTS public.customer_special_prices;
DROP TABLE IF EXISTS public.products;
DROP TABLE IF EXISTS public.suppliers;
DROP TABLE IF EXISTS public.customers;
DROP TABLE IF EXISTS public.warehouses;
DROP TABLE IF EXISTS public.profiles;
DROP TABLE IF EXISTS public.locations;
DROP TABLE IF EXISTS public.business_settings;

-- 6. DROP UTILITY FUNCTION
DROP FUNCTION IF EXISTS public.set_updated_at();

-- Note on Extension pgcrypto:
-- Extension "pgcrypto" is NOT dropped here because other schemas or extensions
-- in the Supabase PostgreSQL cluster may depend on it.
