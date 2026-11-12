-- ==============================================================================
-- AquaTrack ERP — Migration: Complete Operational Database Foundation
-- Version: 20261102000001_phase4a_foundation.sql
-- Architecture: Single-Location Operations Platform (One Business, One Warehouse, Owner + Staff)
-- Invariants:
--   - Singleton Business Profile (is_singleton = true)
--   - Exactly One Owner in public.profiles (uq_single_owner)
--   - Exactly One Default Central Warehouse (uq_single_default_warehouse)
--   - Decoupled Jar Custody (5 Conditions, 4 Custodies, Dropped Full != Collected Empty)
--   - Dual-Entry Inventory Stock Movements and Immutable Ledger Entries
--   - Idempotent Delivery Stop Execution & POS Sale Settlement
--   - Full RLS Enforcement on Every Table with search_path = '' Security Definer RPCs
-- ==============================================================================

-- 1. EXTENSIONS & SECURITY BASELINE
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- Revoke default public schema creation
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 2. BUSINESS SETTINGS (Singleton Table — Enforced at Database Level)
CREATE TABLE IF NOT EXISTS public.business_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_singleton BOOLEAN NOT NULL DEFAULT true CHECK (is_singleton = true),
    name VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255),
    tax_id VARCHAR(50), -- GSTIN
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    address TEXT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    default_jar_deposit NUMERIC(12,2) NOT NULL DEFAULT 150.00 CHECK (default_jar_deposit >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_single_business_settings UNIQUE (is_singleton)
);

-- 3. LOCATIONS (Canonical Physical Custody Entities: Warehouse, Vehicles, Customers, Suppliers, Scrap)
CREATE TABLE IF NOT EXISTS public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(30) NOT NULL CHECK (
        type IN ('WAREHOUSE', 'VEHICLE', 'CUSTOMER', 'SUPPLIER', 'SCRAP_YARD')
    ),
    name VARCHAR(150) NOT NULL,
    address TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 4. WAREHOUSES (Single Central Depot — Exactly One Default Warehouse)
CREATE TABLE IF NOT EXISTS public.warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL UNIQUE REFERENCES public.locations(id) ON DELETE RESTRICT,
    name VARCHAR(150) NOT NULL UNIQUE,
    address TEXT,
    is_default BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_default_warehouse ON public.warehouses (is_default) WHERE is_default = true;

-- 5. PROFILES (Extends Supabase auth.users — Exactly One Owner Enforced)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    role VARCHAR(30) NOT NULL CHECK (role IN ('owner', 'staff')),
    avatar_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    -- Modular Staff Permissions
    can_pos BOOLEAN NOT NULL DEFAULT false,
    can_warehouse BOOLEAN NOT NULL DEFAULT false,
    can_manage_customers BOOLEAN NOT NULL DEFAULT false,
    can_manage_orders BOOLEAN NOT NULL DEFAULT false,
    -- Staff Salary Profile
    salary_amount NUMERIC(12,2) DEFAULT 0.00 CHECK (salary_amount >= 0),
    salary_type VARCHAR(20) DEFAULT 'MONTHLY' CHECK (salary_type IN ('MONTHLY', 'FIXED_PERIOD')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_single_owner ON public.profiles (role) WHERE role = 'owner';

-- 6. CUSTOMERS (Internal Customer Master — No Public Portal / Auth)
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL UNIQUE REFERENCES public.locations(id) ON DELETE RESTRICT,
    customer_type VARCHAR(10) NOT NULL CHECK (customer_type IN ('B2C', 'B2B')),
    business_name VARCHAR(200),
    contact_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255),
    address TEXT NOT NULL,
    delivery_instructions TEXT,
    gstin VARCHAR(30),
    credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (credit_limit >= 0),
    max_jar_limit INTEGER NOT NULL DEFAULT 5 CHECK (max_jar_limit >= 0),
    payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
    current_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00, -- Real-time unpaid invoice sum
    total_full_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_full_jars_holding >= 0),
    total_empty_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_empty_jars_holding >= 0),
    total_deposit_held NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (total_deposit_held >= 0),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_b2b_business_name CHECK (customer_type = 'B2C' OR (customer_type = 'B2B' AND business_name IS NOT NULL))
);

-- 7. SUPPLIERS (Bottling Plants & Packaging Vendors)
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL UNIQUE REFERENCES public.locations(id) ON DELETE RESTRICT,
    name VARCHAR(200) NOT NULL UNIQUE,
    contact_person VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    address TEXT,
    gstin VARCHAR(30),
    payment_terms_days INTEGER NOT NULL DEFAULT 15 CHECK (payment_terms_days >= 0),
    current_payable NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    jars_in_custody INTEGER NOT NULL DEFAULT 0 CHECK (jars_in_custody >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 8. PRODUCTS (Water Jars & Packaged Beverages with Individual GST)
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(30) NOT NULL CHECK (
        category IN ('REFILLABLE_WATER', 'EMPTY_JAR_ASSET', 'PACKAGED_WATER', 'BEVERAGE', 'DISPENSER_EQUIPMENT', 'CONSUMABLE', 'SERVICE')
    ),
    unit_of_measure VARCHAR(20) NOT NULL DEFAULT 'UNIT',
    default_sale_price NUMERIC(12,2) NOT NULL CHECK (default_sale_price >= 0),
    deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (deposit_amount >= 0),
    cost_price NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (cost_price >= 0),
    hsn_code VARCHAR(20) NOT NULL,
    gst_rate NUMERIC(5,2) NOT NULL CHECK (gst_rate >= 0),
    cgst_rate NUMERIC(5,2) NOT NULL CHECK (cgst_rate >= 0),
    sgst_rate NUMERIC(5,2) NOT NULL CHECK (sgst_rate >= 0),
    igst_rate NUMERIC(5,2) NOT NULL CHECK (igst_rate >= 0),
    cess_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (cess_rate >= 0),
    is_reusable_jar BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_products_gst_balance CHECK (gst_rate = cgst_rate + sgst_rate)
);

-- 9. CUSTOMER SPECIAL PRICES (Tiered Customer Pricing)
CREATE TABLE IF NOT EXISTS public.customer_special_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    special_price NUMERIC(12,2) NOT NULL CHECK (special_price >= 0),
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_csp_date_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT uq_csp_customer_product_date UNIQUE (customer_id, product_id, effective_from)
);

-- 10. INVENTORY BALANCES (Physical Depot Stock by SKU)
CREATE TABLE IF NOT EXISTS public.inventory_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
    quantity_reserved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
    last_counted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_inv_warehouse_product UNIQUE(warehouse_id, product_id)
);

-- 11. STOCK MOVEMENTS (Immutable Dual-Entry Inventory Audit Trail)
CREATE TABLE IF NOT EXISTS public.stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    source_location_id UUID REFERENCES public.locations(id) ON DELETE RESTRICT,
    destination_location_id UUID REFERENCES public.locations(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    movement_type VARCHAR(40) NOT NULL CHECK (
        movement_type IN ('PURCHASE_RECEIPT', 'POS_SALE', 'DELIVERY_DISPATCH', 'DELIVERY_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SCRAP_WRITEOFF')
    ),
    reference_type VARCHAR(30) CHECK (reference_type IN ('PURCHASE', 'POS_SALE', 'ORDER', 'DELIVERY_STOP', 'AUDIT')),
    reference_id UUID,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 12. JAR CUSTODY MOVEMENTS (5 Conditions, 4 Custodies Invariant Tracking)
CREATE TABLE IF NOT EXISTS public.jar_custody_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    source_location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
    destination_location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
    condition_from VARCHAR(30) NOT NULL CHECK (
        condition_from IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP')
    ),
    condition_to VARCHAR(30) NOT NULL CHECK (
        condition_to IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP')
    ),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    movement_type VARCHAR(40) NOT NULL CHECK (
        movement_type IN (
            'CUSTOMER_DELIVERY', 'CUSTOMER_EMPTY_RETURN', 'DAMAGED_COLLECTED',
            'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL',
            'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT', 'DISPATCH_TO_VEHICLE',
            'VEHICLE_RETURN_TO_WAREHOUSE', 'SUPPLIER_PURCHASE', 'RETURN_TO_SUPPLIER'
        )
    ),
    reference_type VARCHAR(30) CHECK (reference_type IN ('ORDER', 'DELIVERY_STOP', 'PURCHASE', 'BATCH_WASH', 'AUDIT')),
    reference_id UUID,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 13. CUSTOMER ORDERS & ORDER ITEMS
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(50) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    delivery_address TEXT NOT NULL,
    delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
    assigned_staff_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'CONFIRMED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED')
    ),
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0),
    tax_total NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (tax_total >= 0),
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK (
        payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')
    ),
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (tax_rate >= 0),
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0)
);

-- 14. DELIVERY STOPS (Staff Mobile Route Execution)
CREATE TABLE IF NOT EXISTS public.delivery_stops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    assigned_staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    sequence_number INTEGER NOT NULL DEFAULT 1 CHECK (sequence_number >= 1),
    status VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED' CHECK (
        status IN ('ASSIGNED', 'EN_ROUTE', 'COMPLETED', 'FAILED', 'CANCELLED')
    ),
    actual_delivered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (actual_delivered_quantity >= 0),
    empty_jars_collected INTEGER NOT NULL DEFAULT 0 CHECK (empty_jars_collected >= 0),
    damaged_jars_collected INTEGER NOT NULL DEFAULT 0 CHECK (damaged_jars_collected >= 0),
    payment_collected NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (payment_collected >= 0),
    payment_method VARCHAR(20) CHECK (payment_method IN ('CASH', 'UPI', 'CREDIT')),
    notes TEXT,
    failure_reason TEXT,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 15. INVOICES & INVOICE ITEMS (Accrual Sales Revenue)
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) NOT NULL UNIQUE,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    balance_due NUMERIC(12,2) NOT NULL CHECK (balance_due >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK (
        status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')
    ),
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    description TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0)
);

-- 16. CUSTOMER PAYMENTS (Satisfies Accounts Receivable)
CREATE TABLE IF NOT EXISTS public.customer_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number VARCHAR(50) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE')),
    reference_number VARCHAR(100),
    collected_by_staff_id UUID REFERENCES public.profiles(id),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 17. POS SALES & POS ITEMS (Counter Cash/UPI Walk-in Sales)
CREATE TABLE IF NOT EXISTS public.pos_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number VARCHAR(50) NOT NULL UNIQUE,
    subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    tax_total NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (tax_total >= 0),
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'CARD', 'OTHER')),
    cash_tendered NUMERIC(12,2) DEFAULT 0.00,
    change_due NUMERIC(12,2) DEFAULT 0.00,
    notes TEXT,
    staff_id UUID NOT NULL REFERENCES public.profiles(id),
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS public.pos_sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES public.pos_sales(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    product_name VARCHAR(150) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0)
);

-- 18. PURCHASES & PURCHASE ITEMS (Procurement Asset Capitalization)
CREATE TABLE IF NOT EXISTS public.purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number VARCHAR(50) NOT NULL UNIQUE,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    invoice_number VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'ORDERED' CHECK (status IN ('ORDERED', 'RECEIVED', 'CANCELLED')),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
    subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    tax_total NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (tax_total >= 0),
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0),
    balance_due NUMERIC(12,2) NOT NULL CHECK (balance_due >= 0),
    purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
    received_at TIMESTAMPTZ,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS public.purchase_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
    quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
    unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_cost NUMERIC(12,2) NOT NULL CHECK (total_cost >= 0)
);

-- 19. SUPPLIER PAYMENTS (Satisfies Accounts Payable)
CREATE TABLE IF NOT EXISTS public.supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    purchase_id UUID REFERENCES public.purchases(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('BANK_TRANSFER', 'UPI', 'CASH', 'CHEQUE')),
    reference_number VARCHAR(100),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 20. OPERATING EXPENSES (Period Outflows)
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_number VARCHAR(50) NOT NULL UNIQUE,
    category VARCHAR(30) NOT NULL CHECK (
        category IN ('FUEL', 'VEHICLE_MAINTENANCE', 'RENT', 'ELECTRICITY', 'PACKAGING', 'CLEANING', 'REPAIRS', 'OTHER')
    ),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CARD')),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT NOT NULL,
    vehicle_number VARCHAR(30),
    receipt_url TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 21. STAFF SALARY ADVANCES & PAYMENTS
CREATE TABLE IF NOT EXISTS public.salary_advances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER')),
    advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    is_deducted BOOLEAN NOT NULL DEFAULT false,
    deducted_in_payment_id UUID,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS public.salary_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_number VARCHAR(50) NOT NULL UNIQUE,
    staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    period_month VARCHAR(7) NOT NULL, -- YYYY-MM
    base_salary NUMERIC(12,2) NOT NULL CHECK (base_salary >= 0),
    advance_deducted NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (advance_deducted >= 0),
    net_paid NUMERIC(12,2) NOT NULL CHECK (net_paid >= 0),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('BANK_TRANSFER', 'UPI', 'CASH')),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_staff_salary_period UNIQUE(staff_id, period_month)
);

-- 22. DRIVER CASH HANDOVER & SETTLEMENT
CREATE TABLE IF NOT EXISTS public.cash_handovers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    handover_date DATE NOT NULL DEFAULT CURRENT_DATE,
    opening_float NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (opening_float >= 0),
    route_cash_collected NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (route_cash_collected >= 0),
    on_route_expenses NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (on_route_expenses >= 0),
    expected_cash NUMERIC(12,2) NOT NULL CHECK (expected_cash >= 0),
    cash_handed_over NUMERIC(12,2) NOT NULL CHECK (cash_handed_over >= 0),
    upi_collected NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (upi_collected >= 0),
    variance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (
        status IN ('PENDING_VERIFICATION', 'SETTLED', 'DISCREPANCY')
    ),
    verified_by UUID REFERENCES public.profiles(id),
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_staff_daily_handover UNIQUE(staff_id, handover_date)
);

-- 23. FINANCIAL LEDGER (Dual-Entry Accrual Accounting Ledger)
CREATE TABLE IF NOT EXISTS public.financial_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number VARCHAR(50) NOT NULL UNIQUE,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    account_code VARCHAR(20) NOT NULL, -- 1010 Cash, 1020 Bank, 1110 A/R, 1210 Inventory, 2010 A/P, 2020 Jar Deposits Liability, 4010 Revenue, 5010 COGS, 6010 Operating Expense, 6020 Salary Expense
    account_name VARCHAR(150) NOT NULL,
    debit NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (debit >= 0),
    credit NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (credit >= 0),
    description TEXT NOT NULL,
    reference_type VARCHAR(30) CHECK (reference_type IN ('INVOICE', 'PAYMENT', 'PURCHASE', 'EXPENSE', 'SALARY', 'HANDOVER', 'REVERSAL')),
    reference_id UUID,
    is_reversal BOOLEAN NOT NULL DEFAULT false,
    reversed_entry_id UUID REFERENCES public.financial_ledger(id),
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 24. AUDIT LOGS (Immutable Operational Audit Trail)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE', 'REVERSAL', 'DISPATCH')),
    old_data JSONB,
    new_data JSONB,
    performed_by UUID REFERENCES public.profiles(id),
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 25. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_locations_type ON public.locations(type);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_active ON public.profiles(id, is_active);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_active ON public.customers(is_active);
CREATE INDEX IF NOT EXISTS idx_customers_location ON public.customers(location_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON public.suppliers(is_active);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category);
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products(is_active);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_staff ON public.orders(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_delivery_stops_staff ON public.delivery_stops(assigned_staff_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON public.invoices(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON public.customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_jar_custody_product ON public.jar_custody_movements(product_id, condition_from, condition_to);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(expense_date, category);
CREATE INDEX IF NOT EXISTS idx_salary_payments_staff ON public.salary_payments(staff_id, period_month);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON public.financial_ledger(account_code, entry_date);

-- 26. SECURITY HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS VARCHAR AS $$
    SELECT role FROM public.profiles
    WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

CREATE OR REPLACE FUNCTION public.get_staff_permissions()
RETURNS JSONB AS $$
    SELECT pg_catalog.jsonb_build_object(
        'can_pos', can_pos,
        'can_warehouse', can_warehouse,
        'can_manage_customers', can_manage_customers,
        'can_manage_orders', can_manage_orders
    )
    FROM public.profiles
    WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '';

REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_staff_permissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_staff_permissions() TO authenticated, service_role;

-- 27. SECURITY DEFENSIVE TRIGGERS

-- Profile Update Privilege Escalation Guard
CREATE OR REPLACE FUNCTION public.check_profile_update_privileges()
RETURNS TRIGGER AS $$
DECLARE
    v_is_service_role BOOLEAN;
    v_caller_role VARCHAR;
BEGIN
    v_is_service_role := (
        auth.role() = 'service_role' OR 
        current_user IN ('postgres', 'supabase_admin')
    );

    IF v_is_service_role THEN
        RETURN NEW;
    END IF;

    v_caller_role := public.get_user_role();

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: caller has no active profile.';
    END IF;

    -- Self-service profile updates: cannot alter role, active status, permissions, or salary
    IF NEW.id = auth.uid() THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Privilege escalation blocked: users cannot alter their own role.';
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'Security violation: users cannot alter their own active status.';
        END IF;
        IF NEW.can_pos IS DISTINCT FROM OLD.can_pos OR
           NEW.can_warehouse IS DISTINCT FROM OLD.can_warehouse OR
           NEW.can_manage_customers IS DISTINCT FROM OLD.can_manage_customers OR
           NEW.can_manage_orders IS DISTINCT FROM OLD.can_manage_orders THEN
            RAISE EXCEPTION 'Privilege escalation blocked: users cannot modify their own operational permissions.';
        END IF;
        IF NEW.salary_amount IS DISTINCT FROM OLD.salary_amount OR
           NEW.salary_type IS DISTINCT FROM OLD.salary_type THEN
            RAISE EXCEPTION 'Security violation: staff cannot modify their own salary parameters.';
        END IF;
    ELSE
        -- Modifying another profile requires Owner role
        IF v_caller_role != 'owner' THEN
            RAISE EXCEPTION 'Access denied: only the owner can modify other staff profiles.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_privilege_escalation
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.check_profile_update_privileges();

-- Profile Insertion Trigger: Restricts account creation to Owner or Service Role
CREATE OR REPLACE FUNCTION public.check_profile_insert_privileges()
RETURNS TRIGGER AS $$
DECLARE
    v_is_service_role BOOLEAN;
    v_caller_role VARCHAR;
BEGIN
    v_is_service_role := (
        auth.role() = 'service_role' OR 
        current_user IN ('postgres', 'supabase_admin')
    );

    IF v_is_service_role THEN
        RETURN NEW;
    END IF;

    v_caller_role := public.get_user_role();

    IF v_caller_role = 'owner' THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access denied: unauthorized profile creation.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS trg_check_profile_insert ON public.profiles;
CREATE TRIGGER trg_check_profile_insert
    BEFORE INSERT ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.check_profile_insert_privileges();

-- Protect Customer Financial & Jar Holding Fields from Direct Staff Tampering
CREATE OR REPLACE FUNCTION public.protect_customer_financial_fields()
RETURNS TRIGGER AS $$
DECLARE
    v_caller_role VARCHAR;
BEGIN
    v_caller_role := public.get_user_role();

    IF v_caller_role = 'staff' THEN
        IF NEW.credit_limit IS DISTINCT FROM OLD.credit_limit OR
           NEW.current_balance IS DISTINCT FROM OLD.current_balance OR
           NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding OR
           NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding OR
           NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held OR
           NEW.max_jar_limit IS DISTINCT FROM OLD.max_jar_limit OR
           NEW.payment_terms_days IS DISTINCT FROM OLD.payment_terms_days OR
           NEW.is_active IS DISTINCT FROM OLD.is_active OR
           NEW.location_id IS DISTINCT FROM OLD.location_id THEN
            RAISE EXCEPTION 'Access denied: staff cannot modify customer credit limits, balances, jar limits, or location linkage directly.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS trg_protect_customer_financial_fields ON public.customers;
CREATE TRIGGER trg_protect_customer_financial_fields
    BEFORE UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_customer_financial_fields();

-- Apply Updated At Triggers
DROP TRIGGER IF EXISTS trg_business_settings_updated_at ON public.business_settings;
CREATE TRIGGER trg_business_settings_updated_at BEFORE UPDATE ON public.business_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_locations_updated_at ON public.locations;
CREATE TRIGGER trg_locations_updated_at BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_warehouses_updated_at ON public.warehouses;
CREATE TRIGGER trg_warehouses_updated_at BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_customers_updated_at ON public.customers;
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_delivery_stops_updated_at ON public.delivery_stops;
CREATE TRIGGER trg_delivery_stops_updated_at BEFORE UPDATE ON public.delivery_stops FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON public.invoices;
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_purchases_updated_at ON public.purchases;
CREATE TRIGGER trg_purchases_updated_at BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 28. ROW LEVEL SECURITY (RLS) FOR ALL TABLES
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_special_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_special_prices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.jar_custody_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jar_custody_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_stops FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sales FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.salary_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_advances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_handovers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- business_settings Policies
CREATE POLICY bs_select ON public.business_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY bs_modify ON public.business_settings FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- profiles Policies
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING (public.get_user_role() = 'owner' OR id = auth.uid());
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (public.get_user_role() = 'owner');
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING (public.get_user_role() = 'owner' OR id = auth.uid()) WITH CHECK (public.get_user_role() = 'owner' OR id = auth.uid());
CREATE POLICY profiles_delete ON public.profiles FOR DELETE TO authenticated USING (public.get_user_role() = 'owner');

-- locations Policies
CREATE POLICY loc_select ON public.locations FOR SELECT TO authenticated USING (is_active = true OR public.get_user_role() = 'owner');
CREATE POLICY loc_modify ON public.locations FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- warehouses Policies
CREATE POLICY wh_select ON public.warehouses FOR SELECT TO authenticated USING (true);
CREATE POLICY wh_modify ON public.warehouses FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- customers Policies
CREATE POLICY cust_select ON public.customers FOR SELECT TO authenticated USING (is_active = true OR public.get_user_role() = 'owner');
CREATE POLICY cust_insert ON public.customers FOR INSERT TO authenticated WITH CHECK (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_manage_customers')::boolean = true);
CREATE POLICY cust_update ON public.customers FOR UPDATE TO authenticated USING (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_manage_customers')::boolean = true) WITH CHECK (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_manage_customers')::boolean = true);
CREATE POLICY cust_delete ON public.customers FOR DELETE TO authenticated USING (public.get_user_role() = 'owner');

-- suppliers Policies
CREATE POLICY supp_select ON public.suppliers FOR SELECT TO authenticated USING (is_active = true OR public.get_user_role() = 'owner');
CREATE POLICY supp_modify ON public.suppliers FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- products Policies
CREATE POLICY prod_select ON public.products FOR SELECT TO authenticated USING (is_active = true OR public.get_user_role() = 'owner');
CREATE POLICY prod_modify ON public.products FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- customer_special_prices Policies
CREATE POLICY csp_select ON public.customer_special_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY csp_modify ON public.customer_special_prices FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- inventory_balances Policies
CREATE POLICY inv_select ON public.inventory_balances FOR SELECT TO authenticated USING (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_warehouse')::boolean = true);
CREATE POLICY inv_modify ON public.inventory_balances FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- stock_movements Policies
CREATE POLICY sm_select ON public.stock_movements FOR SELECT TO authenticated USING (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_warehouse')::boolean = true);
CREATE POLICY sm_insert ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_warehouse')::boolean = true);

-- jar_custody_movements Policies
CREATE POLICY jcm_select ON public.jar_custody_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY jcm_insert ON public.jar_custody_movements FOR INSERT TO authenticated WITH CHECK (true);

-- orders Policies
CREATE POLICY orders_select ON public.orders FOR SELECT TO authenticated USING (public.get_user_role() = 'owner' OR assigned_staff_id = auth.uid() OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true);
CREATE POLICY orders_insert ON public.orders FOR INSERT TO authenticated WITH CHECK (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true);
CREATE POLICY orders_update ON public.orders FOR UPDATE TO authenticated USING (public.get_user_role() = 'owner' OR assigned_staff_id = auth.uid() OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true);

-- order_items Policies
CREATE POLICY oi_select ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY oi_modify ON public.order_items FOR ALL TO authenticated WITH CHECK (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true);

-- delivery_stops Policies
CREATE POLICY ds_select ON public.delivery_stops FOR SELECT TO authenticated USING (public.get_user_role() = 'owner' OR assigned_staff_id = auth.uid() OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true);
CREATE POLICY ds_update ON public.delivery_stops FOR UPDATE TO authenticated USING (public.get_user_role() = 'owner' OR assigned_staff_id = auth.uid());

-- invoices Policies
CREATE POLICY invs_select ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY invs_modify ON public.invoices FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- invoice_items Policies
CREATE POLICY invs_items_select ON public.invoice_items FOR SELECT TO authenticated USING (true);
CREATE POLICY invs_items_modify ON public.invoice_items FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- customer_payments Policies
CREATE POLICY cp_select ON public.customer_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY cp_insert ON public.customer_payments FOR INSERT TO authenticated WITH CHECK (true);

-- pos_sales Policies
CREATE POLICY pos_select ON public.pos_sales FOR SELECT TO authenticated USING (public.get_user_role() = 'owner' OR staff_id = auth.uid());
CREATE POLICY pos_insert ON public.pos_sales FOR INSERT TO authenticated WITH CHECK (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_pos')::boolean = true);

-- pos_sale_items Policies
CREATE POLICY pos_items_select ON public.pos_sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY pos_items_insert ON public.pos_sale_items FOR INSERT TO authenticated WITH CHECK (true);

-- purchases & purchase_items Policies (Owner Only)
CREATE POLICY purch_all ON public.purchases FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');
CREATE POLICY purch_items_all ON public.purchase_items FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');
CREATE POLICY supp_pay_all ON public.supplier_payments FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- expenses Policies (Owner Only)
CREATE POLICY exp_select ON public.expenses FOR SELECT TO authenticated USING (public.get_user_role() = 'owner');
CREATE POLICY exp_modify ON public.expenses FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- salary_advances & salary_payments Policies (Owner Only)
CREATE POLICY sal_adv_select ON public.salary_advances FOR SELECT TO authenticated USING (public.get_user_role() = 'owner' OR staff_id = auth.uid());
CREATE POLICY sal_adv_modify ON public.salary_advances FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');
CREATE POLICY sal_pay_select ON public.salary_payments FOR SELECT TO authenticated USING (public.get_user_role() = 'owner' OR staff_id = auth.uid());
CREATE POLICY sal_pay_modify ON public.salary_payments FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- cash_handovers Policies
CREATE POLICY ch_select ON public.cash_handovers FOR SELECT TO authenticated USING (public.get_user_role() = 'owner' OR staff_id = auth.uid());
CREATE POLICY ch_modify ON public.cash_handovers FOR ALL TO authenticated USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- financial_ledger & audit_logs Policies (Owner View Only)
CREATE POLICY ledger_select ON public.financial_ledger FOR SELECT TO authenticated USING (public.get_user_role() = 'owner');
CREATE POLICY audit_select ON public.audit_logs FOR SELECT TO authenticated USING (public.get_user_role() = 'owner');

-- 29. ATOMIC BUSINESS OPERATIONS RPCS (search_path = '')

-- RPC 1: Execute Delivery Stop (Idempotent stop reconciliation)
CREATE OR REPLACE FUNCTION public.rpc_execute_delivery_stop(
    p_stop_id UUID,
    p_actual_delivered INT,
    p_empty_jars INT,
    p_damaged_jars INT,
    p_payment_amount NUMERIC DEFAULT 0.00,
    p_payment_method VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_stop RECORD;
    v_order RECORD;
    v_customer RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_payment_num VARCHAR(50);
BEGIN
    v_caller_id := auth.uid();
    v_caller_role := public.get_user_role();

    -- Retrieve stop record
    SELECT * INTO v_stop FROM public.delivery_stops WHERE id = p_stop_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop not found: %', p_stop_id;
    END IF;

    -- Verify caller assignment
    IF v_caller_role != 'owner' AND v_stop.assigned_staff_id != v_caller_id THEN
        RAISE EXCEPTION 'Access denied: staff can only execute stops assigned to them.';
    END IF;

    -- Idempotency check: If already completed, return existing state
    IF v_stop.status = 'COMPLETED' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', 'ALREADY_COMPLETED'
        );
    END IF;

    -- Check for failure report
    IF p_failure_reason IS NOT NULL AND p_actual_delivered = 0 THEN
        UPDATE public.delivery_stops
        SET status = 'FAILED',
            failure_reason = p_failure_reason,
            executed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_stop_id;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'FAILED');
    END IF;

    -- Retrieve order and customer
    SELECT * INTO v_order FROM public.orders WHERE id = v_stop.order_id;
    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id;

    -- 1. Update Customer Jar Holdings (Full != Empty Invariant)
    UPDATE public.customers
    SET total_full_jars_holding = total_full_jars_holding + p_actual_delivered,
        total_empty_jars_holding = pg_catalog.greatest(0, total_empty_jars_holding - p_empty_jars),
        updated_at = pg_catalog.now()
    WHERE id = v_customer.id;

    -- 2. Log Immutable Jar Custody Movements
    IF p_actual_delivered > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            (SELECT id FROM public.products WHERE is_reusable_jar = true LIMIT 1),
            (SELECT location_id FROM public.warehouses WHERE is_default = true),
            v_customer.location_id,
            'FULL_USABLE',
            'FULL_USABLE',
            p_actual_delivered,
            'CUSTOMER_DELIVERY',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    IF p_empty_jars > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            (SELECT id FROM public.products WHERE is_reusable_jar = true LIMIT 1),
            v_customer.location_id,
            (SELECT location_id FROM public.warehouses WHERE is_default = true),
            'EMPTY_CLEAN',
            'EMPTY_DIRTY',
            p_empty_jars,
            'CUSTOMER_EMPTY_RETURN',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    IF p_damaged_jars > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            (SELECT id FROM public.products WHERE is_reusable_jar = true LIMIT 1),
            v_customer.location_id,
            (SELECT location_id FROM public.warehouses WHERE is_default = true),
            'EMPTY_DIRTY',
            'DAMAGED_REPAIRABLE',
            p_damaged_jars,
            'DAMAGED_COLLECTED',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    -- 3. Payment Processing
    IF p_payment_amount > 0 THEN
        v_payment_num := 'PAY-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || pg_catalog.substr(p_stop_id::text, 1, 6);

        INSERT INTO public.customer_payments (
            payment_number,
            customer_id,
            order_id,
            amount,
            payment_method,
            collected_by_staff_id,
            notes
        ) VALUES (
            v_payment_num,
            v_customer.id,
            v_order.id,
            p_payment_amount,
            COALESCE(p_payment_method, 'CASH'),
            v_caller_id,
            'Route stop payment'
        );

        -- Decrement customer balance
        UPDATE public.customers
        SET current_balance = pg_catalog.greatest(0, current_balance - p_payment_amount),
            updated_at = pg_catalog.now()
        WHERE id = v_customer.id;
    END IF;

    -- 4. Mark Stop Completed
    UPDATE public.delivery_stops
    SET status = 'COMPLETED',
        actual_delivered_quantity = p_actual_delivered,
        empty_jars_collected = p_empty_jars,
        damaged_jars_collected = p_damaged_jars,
        payment_collected = p_payment_amount,
        payment_method = p_payment_method,
        notes = p_notes,
        executed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_stop_id;

    -- Update order status
    UPDATE public.orders
    SET status = 'DELIVERED',
        payment_status = CASE WHEN p_payment_amount >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'COMPLETED',
        'delivered', p_actual_delivered,
        'empty_collected', p_empty_jars
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- RPC 2: Complete Walk-in POS Sale (Idempotent Stock Decrement & Transaction Posting)
CREATE OR REPLACE FUNCTION public.rpc_complete_pos_sale(
    p_items JSONB,
    p_subtotal NUMERIC,
    p_tax_total NUMERIC,
    p_discount_amount NUMERIC,
    p_total_amount NUMERIC,
    p_payment_method VARCHAR,
    p_cash_tendered NUMERIC DEFAULT 0.00,
    p_change_due NUMERIC DEFAULT 0.00,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_sale_id UUID;
    v_receipt_num VARCHAR(50);
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_item RECORD;
    v_default_wh UUID;
BEGIN
    v_caller_id := auth.uid();
    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_pos')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have POS Counter permissions.';
    END IF;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, receipt_number INTO v_sale_id, v_receipt_num
        FROM public.pos_sales
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'sale_id', v_sale_id,
                'receipt_number', v_receipt_num
            );
        END IF;
    END IF;

    SELECT id INTO v_default_wh FROM public.warehouses WHERE is_default = true LIMIT 1;

    v_receipt_num := 'POS-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || pg_catalog.to_char(pg_catalog.floor(pg_catalog.random() * 9000 + 1000), 'FM9999');

    -- Insert Master POS Sale
    INSERT INTO public.pos_sales (
        receipt_number,
        subtotal,
        tax_total,
        discount_amount,
        total_amount,
        payment_method,
        cash_tendered,
        change_due,
        notes,
        staff_id,
        idempotency_key
    ) VALUES (
        v_receipt_num,
        p_subtotal,
        p_tax_total,
        p_discount_amount,
        p_total_amount,
        p_payment_method,
        p_cash_tendered,
        p_change_due,
        p_notes,
        v_caller_id,
        p_idempotency_key
    ) RETURNING id INTO v_sale_id;

    -- Process Line Items & Atomic Stock Decrement
    FOR v_item IN SELECT * FROM pg_catalog.jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        product_name VARCHAR,
        quantity INT,
        unit_price NUMERIC,
        tax_rate NUMERIC,
        tax_amount NUMERIC,
        total_amount NUMERIC
    )
    LOOP
        INSERT INTO public.pos_sale_items (
            sale_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            tax_rate,
            tax_amount,
            total_amount
        ) VALUES (
            v_sale_id,
            v_item.product_id,
            v_item.product_name,
            v_item.quantity,
            v_item.unit_price,
            v_item.tax_rate,
            v_item.tax_amount,
            v_item.total_amount
        );

        -- Decrement packaged inventory balance atomically
        UPDATE public.inventory_balances
        SET quantity_on_hand = pg_catalog.greatest(0, quantity_on_hand - v_item.quantity),
            updated_at = pg_catalog.now()
        WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;

        -- Record stock movement
        INSERT INTO public.stock_movements (
            product_id,
            source_location_id,
            destination_location_id,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_item.product_id,
            (SELECT location_id FROM public.warehouses WHERE id = v_default_wh),
            NULL,
            v_item.quantity,
            'POS_SALE',
            'POS_SALE',
            v_sale_id,
            v_caller_id
        );
    END LOOP;

    -- Post Balanced Entry to Financial Ledger
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_receipt_num,
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        p_total_amount,
        0.00,
        'POS Sale ' || v_receipt_num,
        'PAYMENT',
        v_sale_id,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'receipt_number', v_receipt_num
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- RPC 3: Receive Purchase Order (Increments Inventory only on actual warehouse receipt)
CREATE OR REPLACE FUNCTION public.rpc_receive_purchase_order(
    p_purchase_id UUID,
    p_received_items JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_purchase RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_default_wh UUID;
    v_item RECORD;
BEGIN
    v_caller_id := auth.uid();
    v_caller_role := public.get_user_role();

    IF v_caller_role != 'owner' THEN
        RAISE EXCEPTION 'Access denied: only the owner can receive and capitalize purchase orders.';
    END IF;

    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order not found: %', p_purchase_id;
    END IF;

    IF v_purchase.status = 'RECEIVED' THEN
        RETURN pg_catalog.jsonb_build_object('success', true, 'idempotent', true, 'status', 'ALREADY_RECEIVED');
    END IF;

    SELECT id INTO v_default_wh FROM public.warehouses WHERE is_default = true LIMIT 1;

    -- Mark Purchase Received
    UPDATE public.purchases
    SET status = 'RECEIVED',
        received_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_purchase_id;

    -- Update inventory stock levels for all purchase items
    FOR v_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id
    LOOP
        INSERT INTO public.inventory_balances (
            warehouse_id,
            product_id,
            quantity_on_hand,
            updated_at
        ) VALUES (
            v_default_wh,
            v_item.product_id,
            v_item.quantity_ordered,
            pg_catalog.now()
        )
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET
            quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
            updated_at = pg_catalog.now();

        -- Record dual-entry stock movement
        INSERT INTO public.stock_movements (
            product_id,
            source_location_id,
            destination_location_id,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_item.product_id,
            (SELECT location_id FROM public.suppliers WHERE id = v_purchase.supplier_id),
            (SELECT location_id FROM public.warehouses WHERE id = v_default_wh),
            v_item.quantity_ordered,
            'PURCHASE_RECEIPT',
            'PURCHASE',
            p_purchase_id,
            v_caller_id
        );
    END LOOP;

    -- Increase supplier payable balance
    UPDATE public.suppliers
    SET current_payable = current_payable + v_purchase.balance_due,
        updated_at = pg_catalog.now()
    WHERE id = v_purchase.supplier_id;

    RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'RECEIVED');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Grant RPC execution permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_complete_pos_sale(JSONB, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, NUMERIC, NUMERIC, VARCHAR, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_receive_purchase_order(UUID, JSONB) TO authenticated, service_role;
-- ==============================================================================
-- AquaTrack ERP — Migration: Critical Security & Transaction Remediation
-- Version: 20261103000001_critical_security_and_transactions.sql
-- Description:
--   1. Harden all SECURITY DEFINER functions with strict auth.uid() & profile checks.
--   2. Revoke execution from PUBLIC and anon; grant exclusively to authenticated/service_role.
--   3. Overhaul RLS across all 28 tables to eliminate loose USING (true) / WITH CHECK (true).
--   4. Purchase Module: Add po_number generator, draft/partial receipt, and status lifecycle.
--   5. Salary Module: Reconcile schema (voucher_number, other_deductions, net_payable, amount_paid).
--   6. Jar Custody: Decouple full/empty, disallow negative holdings, eliminate GREATEST() clamping.
--   7. POS Module: Server-side price calculation from database records; atomic row locking & balanced ledger.
--   8. Financial Ledger: Balanced double-entry posting, non-destructive reversals, atomic RPCs.
--   9. Inventory: Atomic RPC adjustments with FOR UPDATE locking and negative stock prevention.
-- ==============================================================================

-- 1. SCHEMA ALIGNMENT & EXTENSIONS

-- 1.1 Purchases: Extend status check to support DRAFT and PARTIALLY_RECEIVED
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_status_check
    CHECK (status IN ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'));

-- Default po_number generation if omitted
ALTER TABLE public.purchases ALTER COLUMN po_number SET DEFAULT 
    ('PO-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6));

-- 1.2 Purchase Items: Reconcile total_cost, total_amount, tax_rate, and gst_rate
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'purchase_items' AND column_name = 'total_amount') THEN
        ALTER TABLE public.purchase_items ADD COLUMN total_amount NUMERIC(12,2);
        UPDATE public.purchase_items SET total_amount = total_cost WHERE total_amount IS NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'purchase_items' AND column_name = 'gst_rate') THEN
        ALTER TABLE public.purchase_items ADD COLUMN gst_rate NUMERIC(5,2) DEFAULT 0.00;
        UPDATE public.purchase_items SET gst_rate = tax_rate WHERE gst_rate IS NULL;
    END IF;
END $$;

-- 1.3 Salary Payments: Add other_deductions, net_payable, amount_paid
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_payments' AND column_name = 'other_deductions') THEN
        ALTER TABLE public.salary_payments ADD COLUMN other_deductions NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (other_deductions >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_payments' AND column_name = 'net_payable') THEN
        ALTER TABLE public.salary_payments ADD COLUMN net_payable NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (net_payable >= 0);
        UPDATE public.salary_payments SET net_payable = net_paid WHERE net_payable = 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_payments' AND column_name = 'amount_paid') THEN
        ALTER TABLE public.salary_payments ADD COLUMN amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0);
        UPDATE public.salary_payments SET amount_paid = net_paid WHERE amount_paid = 0;
    END IF;
END $$;

-- 1.4 Salary Advances: Reconcile is_settled, is_deducted, reason, notes
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_advances' AND column_name = 'is_settled') THEN
        ALTER TABLE public.salary_advances ADD COLUMN is_settled BOOLEAN NOT NULL DEFAULT false;
        UPDATE public.salary_advances SET is_settled = is_deducted;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_advances' AND column_name = 'reason') THEN
        ALTER TABLE public.salary_advances ADD COLUMN reason TEXT;
        UPDATE public.salary_advances SET reason = notes WHERE reason IS NULL;
    END IF;
END $$;

-- 1.5 Modular Staff Permissions in profiles
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'can_deliveries') THEN
        ALTER TABLE public.profiles ADD COLUMN can_deliveries BOOLEAN NOT NULL DEFAULT true;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'can_manage_suppliers') THEN
        ALTER TABLE public.profiles ADD COLUMN can_manage_suppliers BOOLEAN NOT NULL DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'can_manage_expenses') THEN
        ALTER TABLE public.profiles ADD COLUMN can_manage_expenses BOOLEAN NOT NULL DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'can_manage_salaries') THEN
        ALTER TABLE public.profiles ADD COLUMN can_manage_salaries BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- 2. HARDENED SECURITY HELPER FUNCTIONS

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS VARCHAR AS $$
    SELECT role FROM public.profiles
    WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_staff_permissions()
RETURNS JSONB AS $$
    SELECT pg_catalog.jsonb_build_object(
        'can_pos', COALESCE(can_pos, false),
        'can_warehouse', COALESCE(can_warehouse, false),
        'can_manage_customers', COALESCE(can_manage_customers, false),
        'can_manage_orders', COALESCE(can_manage_orders, false),
        'can_deliveries', COALESCE(can_deliveries, true),
        'can_manage_suppliers', COALESCE(can_manage_suppliers, false),
        'can_manage_expenses', COALESCE(can_manage_expenses, false),
        'can_manage_salaries', COALESCE(can_manage_salaries, false)
    )
    FROM public.profiles
    WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_staff_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_staff_permissions() TO authenticated, service_role;

-- 2.1 Profile Update Privilege Escalation Trigger (Fail-closed)
CREATE OR REPLACE FUNCTION public.check_profile_update_privileges()
RETURNS TRIGGER AS $$
DECLARE
    v_is_service_role BOOLEAN;
    v_caller_role VARCHAR;
BEGIN
    v_is_service_role := (
        auth.role() = 'service_role' OR 
        current_user IN ('postgres', 'supabase_admin')
    );

    IF v_is_service_role THEN
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Access denied: caller is unauthenticated.';
    END IF;

    v_caller_role := public.get_user_role();

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: caller has no active profile.';
    END IF;

    -- Self-service profile updates: cannot alter role, active status, permissions, or salary
    IF NEW.id = auth.uid() THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Privilege escalation blocked: users cannot alter their own role.';
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'Security violation: users cannot alter their own active status.';
        END IF;
        IF NEW.can_pos IS DISTINCT FROM OLD.can_pos OR
           NEW.can_warehouse IS DISTINCT FROM OLD.can_warehouse OR
           NEW.can_manage_customers IS DISTINCT FROM OLD.can_manage_customers OR
           NEW.can_manage_orders IS DISTINCT FROM OLD.can_manage_orders OR
           NEW.can_deliveries IS DISTINCT FROM OLD.can_deliveries OR
           NEW.can_manage_suppliers IS DISTINCT FROM OLD.can_manage_suppliers OR
           NEW.can_manage_expenses IS DISTINCT FROM OLD.can_manage_expenses OR
           NEW.can_manage_salaries IS DISTINCT FROM OLD.can_manage_salaries THEN
            RAISE EXCEPTION 'Privilege escalation blocked: users cannot modify their own operational permissions.';
        END IF;
        IF NEW.salary_amount IS DISTINCT FROM OLD.salary_amount OR
           NEW.salary_type IS DISTINCT FROM OLD.salary_type THEN
            RAISE EXCEPTION 'Security violation: staff cannot modify their own salary parameters.';
        END IF;
    ELSE
        -- Modifying another profile requires Owner role
        IF v_caller_role != 'owner' THEN
            RAISE EXCEPTION 'Access denied: only the owner can modify other staff profiles.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3. PERMISSION-AWARE ROW LEVEL SECURITY (RLS) POLICIES OVERHAUL

-- 3.1 Drop loose / permissive policies
DROP POLICY IF EXISTS bs_select ON public.business_settings;
DROP POLICY IF EXISTS bs_modify ON public.business_settings;
DROP POLICY IF EXISTS wh_select ON public.warehouses;
DROP POLICY IF EXISTS wh_modify ON public.warehouses;
DROP POLICY IF EXISTS csp_select ON public.customer_special_prices;
DROP POLICY IF EXISTS csp_modify ON public.customer_special_prices;
DROP POLICY IF EXISTS jcm_select ON public.jar_custody_movements;
DROP POLICY IF EXISTS jcm_insert ON public.jar_custody_movements;
DROP POLICY IF EXISTS oi_select ON public.order_items;
DROP POLICY IF EXISTS oi_modify ON public.order_items;
DROP POLICY IF EXISTS invs_select ON public.invoices;
DROP POLICY IF EXISTS invs_modify ON public.invoices;
DROP POLICY IF EXISTS invs_items_select ON public.invoice_items;
DROP POLICY IF EXISTS invs_items_modify ON public.invoice_items;
DROP POLICY IF EXISTS cp_select ON public.customer_payments;
DROP POLICY IF EXISTS cp_insert ON public.customer_payments;
DROP POLICY IF EXISTS pos_items_select ON public.pos_sale_items;
DROP POLICY IF EXISTS pos_items_insert ON public.pos_sale_items;

-- 3.2 Business Settings
CREATE POLICY bs_select ON public.business_settings FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND public.get_user_role() IN ('owner', 'staff'));
CREATE POLICY bs_modify ON public.business_settings FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.3 Warehouses
CREATE POLICY wh_select ON public.warehouses FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND public.get_user_role() IN ('owner', 'staff'));
CREATE POLICY wh_modify ON public.warehouses FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.4 Customer Special Prices
CREATE POLICY csp_select ON public.customer_special_prices FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_manage_customers')::boolean = true OR
        (public.get_staff_permissions()->>'can_pos')::boolean = true OR
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY csp_modify ON public.customer_special_prices FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.5 Order Items
CREATE POLICY oi_select ON public.order_items FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_items.order_id
        AND (public.get_user_role() = 'owner' OR o.assigned_staff_id = auth.uid() OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true)
    ));
CREATE POLICY oi_modify ON public.order_items FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true)
    WITH CHECK (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true);

-- 3.6 Invoices & Invoice Items
CREATE POLICY invs_select ON public.invoices FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY invs_modify ON public.invoices FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

CREATE POLICY invs_items_select ON public.invoice_items FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY invs_items_modify ON public.invoice_items FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.7 Customer Payments
CREATE POLICY cp_select ON public.customer_payments FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        collected_by_staff_id = auth.uid() OR 
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY cp_insert ON public.customer_payments FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        collected_by_staff_id = auth.uid() OR 
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));

-- 3.8 Jar Custody Movements
CREATE POLICY jcm_select ON public.jar_custody_movements FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        created_by = auth.uid() OR 
        (public.get_staff_permissions()->>'can_warehouse')::boolean = true OR
        (public.get_staff_permissions()->>'can_deliveries')::boolean = true
    ));
CREATE POLICY jcm_insert ON public.jar_custody_movements FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        created_by = auth.uid()
    ));

-- 3.9 POS Sale Items
CREATE POLICY pos_items_select ON public.pos_sale_items FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        EXISTS (SELECT 1 FROM public.pos_sales ps WHERE ps.id = pos_sale_items.sale_id AND ps.staff_id = auth.uid())
    ));
CREATE POLICY pos_items_insert ON public.pos_sale_items FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_pos')::boolean = true
    ));

-- 4. ATOMIC, VALIDATED BUSINESS TRANSACTION RPCS

-- ==============================================================================
-- RPC 1: rpc_execute_delivery_stop
-- Decoupled full jar drop and empty jar return. Validates customer holdings.
-- No GREATEST() clamping. Locks rows FOR UPDATE. Balanced financial posting.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_execute_delivery_stop(
    p_stop_id UUID,
    p_actual_delivered INT,
    p_empty_jars INT,
    p_damaged_jars INT,
    p_payment_amount NUMERIC DEFAULT 0.00,
    p_payment_method VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_stop RECORD;
    v_order RECORD;
    v_customer RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_payment_num VARCHAR(50);
    v_wh_location UUID;
    v_default_jar_id UUID;
    v_current_total_custody INT;
    v_total_returning INT;
    v_new_full_holding INT;
    v_new_empty_holding INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: caller is unauthenticated.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := v_caller_profile.role;

    -- Validate input sanity
    IF p_actual_delivered < 0 OR p_empty_jars < 0 OR p_damaged_jars < 0 THEN
        RAISE EXCEPTION 'Quantities cannot be negative.';
    END IF;
    IF p_payment_amount < 0 THEN
        RAISE EXCEPTION 'Payment amount cannot be negative.';
    END IF;

    -- Retrieve and lock stop record
    SELECT * INTO v_stop FROM public.delivery_stops WHERE id = p_stop_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop not found: %', p_stop_id;
    END IF;

    -- Verify caller assignment
    IF v_caller_role != 'owner' AND v_stop.assigned_staff_id != v_caller_id THEN
        RAISE EXCEPTION 'Access denied: staff can only execute stops assigned to them.';
    END IF;

    -- Idempotency check: If already completed, return existing state
    IF v_stop.status = 'COMPLETED' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', 'ALREADY_COMPLETED'
        );
    END IF;

    -- Check for failure report
    IF p_failure_reason IS NOT NULL AND p_actual_delivered = 0 THEN
        UPDATE public.delivery_stops
        SET status = 'FAILED',
            failure_reason = p_failure_reason,
            executed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_stop_id;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'FAILED');
    END IF;

    -- Retrieve and lock order and customer
    SELECT * INTO v_order FROM public.orders WHERE id = v_stop.order_id FOR UPDATE;
    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;

    SELECT location_id INTO v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    SELECT id INTO v_default_jar_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;

    -- 1. Validate Customer Physical Jar Custody (Never Clamped, Strictly Conserved)
    v_current_total_custody := v_customer.total_full_jars_holding + v_customer.total_empty_jars_holding;
    v_total_returning := p_empty_jars + p_damaged_jars;

    IF v_total_returning > v_current_total_custody THEN
        RAISE EXCEPTION 'Invalid physical return: Customer holding is % jars (full: %, empty: %), but returning % jars.',
            v_current_total_custody, v_customer.total_full_jars_holding, v_customer.total_empty_jars_holding, v_total_returning;
    END IF;

    -- Decoupled holding calculation: Full jars delivered increment full holding
    v_new_full_holding := v_customer.total_full_jars_holding + p_actual_delivered;

    -- Empty/damaged jars returned deduct from customer holding
    IF v_customer.total_empty_jars_holding >= v_total_returning THEN
        v_new_empty_holding := v_customer.total_empty_jars_holding - v_total_returning;
    ELSE
        -- Emptied full jars returned
        v_new_full_holding := v_new_full_holding - (v_total_returning - v_customer.total_empty_jars_holding);
        v_new_empty_holding := 0;
    END IF;

    IF v_new_full_holding < 0 THEN
        RAISE EXCEPTION 'Physical custody violation: Customer full jars holding cannot become negative (% < 0)', v_new_full_holding;
    END IF;

    UPDATE public.customers
    SET total_full_jars_holding = v_new_full_holding,
        total_empty_jars_holding = v_new_empty_holding,
        updated_at = pg_catalog.now()
    WHERE id = v_customer.id;

    -- 2. Log Immutable Jar Custody Movements
    IF p_actual_delivered > 0 AND v_default_jar_id IS NOT NULL THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_wh_location,
            v_customer.location_id,
            'FULL_USABLE',
            'FULL_USABLE',
            p_actual_delivered,
            'CUSTOMER_DELIVERY',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    IF p_empty_jars > 0 AND v_default_jar_id IS NOT NULL THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_customer.location_id,
            v_wh_location,
            'EMPTY_CLEAN',
            'EMPTY_DIRTY',
            p_empty_jars,
            'CUSTOMER_EMPTY_RETURN',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    IF p_damaged_jars > 0 AND v_default_jar_id IS NOT NULL THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_customer.location_id,
            v_wh_location,
            'EMPTY_DIRTY',
            'DAMAGED_REPAIRABLE',
            p_damaged_jars,
            'DAMAGED_COLLECTED',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    -- 3. Payment Processing & Balanced Financial Ledger Entry
    IF p_payment_amount > 0 THEN
        v_payment_num := 'PAY-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || pg_catalog.substr(p_stop_id::text, 1, 6);

        INSERT INTO public.customer_payments (
            payment_number,
            customer_id,
            order_id,
            amount,
            payment_method,
            collected_by_staff_id,
            notes
        ) VALUES (
            v_payment_num,
            v_customer.id,
            v_order.id,
            p_payment_amount,
            COALESCE(p_payment_method, 'CASH'),
            v_caller_id,
            'Route stop payment'
        );

        -- Decrement customer receivable balance
        UPDATE public.customers
        SET current_balance = current_balance - p_payment_amount,
            updated_at = pg_catalog.now()
        WHERE id = v_customer.id;

        -- Post balanced dual-entry to financial ledger
        -- Entry 1: Debit Cash with Driver (or Bank if UPI)
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_payment_num || '-DR',
            CASE WHEN p_payment_method = 'UPI' THEN '1020' ELSE '1015' END,
            CASE WHEN p_payment_method = 'UPI' THEN 'Bank Current Account' ELSE 'Cash Float with Driver' END,
            p_payment_amount,
            0.00,
            'Route collection from ' || v_customer.contact_name,
            'PAYMENT',
            p_stop_id,
            v_caller_id
        );

        -- Entry 2: Credit Accounts Receivable
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_payment_num || '-CR',
            '1200',
            'Accounts Receivable (Customer)',
            0.00,
            p_payment_amount,
            'Settlement of AR for ' || v_customer.contact_name,
            'PAYMENT',
            p_stop_id,
            v_caller_id
        );
    END IF;

    -- 4. Mark Stop Completed
    UPDATE public.delivery_stops
    SET status = 'COMPLETED',
        actual_delivered_quantity = p_actual_delivered,
        empty_jars_collected = p_empty_jars,
        damaged_jars_collected = p_damaged_jars,
        payment_collected = p_payment_amount,
        payment_method = p_payment_method,
        notes = p_notes,
        executed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_stop_id;

    -- Update order status
    UPDATE public.orders
    SET status = 'DELIVERED',
        payment_status = CASE WHEN p_payment_amount >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'COMPLETED',
        'delivered', p_actual_delivered,
        'empty_collected', p_empty_jars,
        'customer_closing_holding', (v_new_full_holding + v_new_empty_holding)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 2: rpc_complete_pos_sale
-- Server-side pricing from products table. Row locking on inventory balances.
-- Rejects insufficient stock. Balanced double-entry financial ledger.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_complete_pos_sale(
    p_items JSONB,
    p_payment_method VARCHAR,
    p_discount_amount NUMERIC DEFAULT 0.00,
    p_cash_tendered NUMERIC DEFAULT 0.00,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_sale_id UUID;
    v_receipt_num VARCHAR(50);
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_item JSONB;
    v_product RECORD;
    v_inv RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
    v_item_qty INT;
    v_item_price NUMERIC(12,2);
    v_item_tax NUMERIC(12,2);
    v_item_total NUMERIC(12,2);
    v_change_due NUMERIC(12,2) := 0.00;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := v_caller_profile.role;
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_pos')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have POS permissions.';
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'POS sale must contain at least one item.';
    END IF;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, receipt_number, total_amount INTO v_sale_id, v_receipt_num, v_total_amount
        FROM public.pos_sales
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'sale_id', v_sale_id,
                'receipt_number', v_receipt_num,
                'total_amount', v_total_amount
            );
        END IF;
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        RAISE EXCEPTION 'Central warehouse is not configured.';
    END IF;

    v_receipt_num := 'POS-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- Phase 1: Validate stock & compute server-authoritative totals
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity')::int;
        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be greater than zero.';
        END IF;

        -- Fetch product directly from database
        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND is_active = true;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % is invalid or inactive.', v_item->>'product_id';
        END IF;

        -- Lock inventory balance record FOR UPDATE
        SELECT * INTO v_inv FROM public.inventory_balances
        WHERE warehouse_id = v_default_wh AND product_id = v_product.id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Inventory record missing for product "%" in warehouse.', v_product.name;
        END IF;

        IF v_inv.quantity_on_hand < v_item_qty THEN
            RAISE EXCEPTION 'Insufficient stock for product "%": available %, requested %.',
                v_product.name, v_inv.quantity_on_hand, v_item_qty;
        END IF;

        -- Authoritative price calculation
        v_item_price := v_product.default_sale_price;
        v_item_tax := pg_catalog.round(v_item_price * v_item_qty * (v_product.gst_rate / 100.0), 2);
        v_item_total := (v_item_price * v_item_qty) + v_item_tax;

        v_subtotal := v_subtotal + (v_item_price * v_item_qty);
        v_tax_total := v_tax_total + v_item_tax;
    END LOOP;

    v_total_amount := pg_catalog.greatest(0.00, (v_subtotal + v_tax_total) - COALESCE(p_discount_amount, 0.00));

    IF p_payment_method = 'CASH' AND p_cash_tendered > 0 THEN
        IF p_cash_tendered < v_total_amount THEN
            RAISE EXCEPTION 'Cash tendered (%) is less than total amount (%).', p_cash_tendered, v_total_amount;
        END IF;
        v_change_due := p_cash_tendered - v_total_amount;
    END IF;

    -- Phase 2: Insert master POS Sale
    INSERT INTO public.pos_sales (
        receipt_number,
        subtotal,
        tax_total,
        discount_amount,
        total_amount,
        payment_method,
        cash_tendered,
        change_due,
        notes,
        staff_id,
        idempotency_key
    ) VALUES (
        v_receipt_num,
        v_subtotal,
        v_tax_total,
        COALESCE(p_discount_amount, 0.00),
        v_total_amount,
        p_payment_method,
        p_cash_tendered,
        v_change_due,
        p_notes,
        v_caller_id,
        p_idempotency_key
    ) RETURNING id INTO v_sale_id;

    -- Phase 3: Insert line items, deduct stock, and write stock movements
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity')::int;
        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;

        v_item_price := v_product.default_sale_price;
        v_item_tax := pg_catalog.round(v_item_price * v_item_qty * (v_product.gst_rate / 100.0), 2);
        v_item_total := (v_item_price * v_item_qty) + v_item_tax;

        INSERT INTO public.pos_sale_items (
            sale_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            tax_rate,
            tax_amount,
            total_amount
        ) VALUES (
            v_sale_id,
            v_product.id,
            v_product.name,
            v_item_qty,
            v_item_price,
            v_product.gst_rate,
            v_item_tax,
            v_item_total
        );

        -- Decrement inventory balance atomically
        UPDATE public.inventory_balances
        SET quantity_on_hand = quantity_on_hand - v_item_qty,
            updated_at = pg_catalog.now()
        WHERE warehouse_id = v_default_wh AND product_id = v_product.id;

        -- Record stock movement
        INSERT INTO public.stock_movements (
            product_id,
            source_location_id,
            destination_location_id,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_product.id,
            v_wh_location,
            NULL,
            v_item_qty,
            'POS_SALE',
            'POS_SALE',
            v_sale_id,
            v_caller_id
        );
    END LOOP;

    -- Phase 4: Post balanced entries to financial ledger
    -- Entry 1: Debit Cash Drawer or Bank
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_receipt_num || '-DR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        v_total_amount,
        0.00,
        'POS Walk-in Sale ' || v_receipt_num,
        'POS_SALE',
        v_sale_id,
        v_caller_id
    );

    -- Entry 2: Credit Sales Revenue (subtotal minus discount)
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_receipt_num || '-CR-REV',
        '4010',
        'POS Counter Sales Revenue',
        0.00,
        (v_subtotal - COALESCE(p_discount_amount, 0.00)),
        'Net Revenue for POS ' || v_receipt_num,
        'POS_SALE',
        v_sale_id,
        v_caller_id
    );

    -- Entry 3: Credit GST Output Tax Payable (if tax > 0)
    IF v_tax_total > 0 THEN
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_receipt_num || '-CR-TAX',
            '2110',
            'GST Output Tax Payable',
            0.00,
            v_tax_total,
            'GST Collected on POS ' || v_receipt_num,
            'POS_SALE',
            v_sale_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'receipt_number', v_receipt_num,
        'subtotal', v_subtotal,
        'tax_total', v_tax_total,
        'total_amount', v_total_amount,
        'change_due', v_change_due
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 3: rpc_receive_purchase_order
-- Supports partial receipt. Increments inventory only for actual goods received.
-- Prevents exceeding ordered quantities. Locks records FOR UPDATE.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_receive_purchase_order(
    p_purchase_id UUID,
    p_received_items JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_purchase RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_supplier RECORD;
    v_item RECORD;
    v_recv_item JSONB;
    v_target_product_id UUID;
    v_qty_to_receive INT;
    v_all_fully_received BOOLEAN := true;
    v_any_item_received BOOLEAN := false;
    v_incremental_payable NUMERIC(12,2) := 0.00;
    v_item_cost NUMERIC(12,2);
    v_new_status VARCHAR(20);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := v_caller_profile.role;
    IF v_caller_role != 'owner' AND (public.get_staff_permissions()->>'can_manage_suppliers')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: only owner or authorized procurement staff can receive goods.';
    END IF;

    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order not found: %', p_purchase_id;
    END IF;

    IF v_purchase.status = 'RECEIVED' THEN
        RETURN pg_catalog.jsonb_build_object('success', true, 'idempotent', true, 'status', 'ALREADY_RECEIVED');
    END IF;

    IF v_purchase.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Cannot receive goods for a CANCELLED purchase order.';
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_purchase.supplier_id;

    -- Process partial or full goods receipt
    IF p_received_items IS NOT NULL AND jsonb_array_length(p_received_items) > 0 THEN
        -- Specific received items payload: [{"product_id": "uuid", "quantity_received": 10}]
        FOR v_recv_item IN SELECT * FROM jsonb_array_elements(p_received_items)
        LOOP
            v_target_product_id := (v_recv_item->>'product_id')::uuid;
            v_qty_to_receive := (v_recv_item->>'quantity_received')::int;

            IF v_qty_to_receive > 0 THEN
                SELECT * INTO v_item FROM public.purchase_items
                WHERE purchase_id = p_purchase_id AND product_id = v_target_product_id
                FOR UPDATE;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Product % is not on purchase order %', v_target_product_id, p_purchase_id;
                END IF;

                IF (v_item.quantity_received + v_qty_to_receive) > v_item.quantity_ordered THEN
                    RAISE EXCEPTION 'Received quantity (%) exceeds outstanding quantity (%) for product.',
                        v_qty_to_receive, (v_item.quantity_ordered - v_item.quantity_received);
                END IF;

                -- Update line item received count
                UPDATE public.purchase_items
                SET quantity_received = quantity_received + v_qty_to_receive
                WHERE id = v_item.id;

                -- Lock and increment inventory balance
                INSERT INTO public.inventory_balances (
                    warehouse_id,
                    product_id,
                    quantity_on_hand,
                    updated_at
                ) VALUES (
                    v_default_wh,
                    v_target_product_id,
                    v_qty_to_receive,
                    pg_catalog.now()
                )
                ON CONFLICT (warehouse_id, product_id)
                DO UPDATE SET
                    quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
                    updated_at = pg_catalog.now();

                -- Record immutable stock movement
                INSERT INTO public.stock_movements (
                    product_id,
                    source_location_id,
                    destination_location_id,
                    quantity,
                    movement_type,
                    reference_type,
                    reference_id,
                    created_by
                ) VALUES (
                    v_target_product_id,
                    v_supplier.location_id,
                    v_wh_location,
                    v_qty_to_receive,
                    'PURCHASE_RECEIPT',
                    'PURCHASE',
                    p_purchase_id,
                    v_caller_id
                );

                -- Increment incremental payable
                v_item_cost := pg_catalog.round(v_qty_to_receive * v_item.unit_cost * (1 + (COALESCE(v_item.tax_rate, 0) / 100.0)), 2);
                v_incremental_payable := v_incremental_payable + v_item_cost;
                v_any_item_received := true;
            END IF;
        END LOOP;
    ELSE
        -- Full receipt: accept all outstanding quantities
        FOR v_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id FOR UPDATE
        LOOP
            v_qty_to_receive := v_item.quantity_ordered - v_item.quantity_received;
            IF v_qty_to_receive > 0 THEN
                UPDATE public.purchase_items
                SET quantity_received = quantity_ordered
                WHERE id = v_item.id;

                INSERT INTO public.inventory_balances (
                    warehouse_id,
                    product_id,
                    quantity_on_hand,
                    updated_at
                ) VALUES (
                    v_default_wh,
                    v_item.product_id,
                    v_qty_to_receive,
                    pg_catalog.now()
                )
                ON CONFLICT (warehouse_id, product_id)
                DO UPDATE SET
                    quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
                    updated_at = pg_catalog.now();

                INSERT INTO public.stock_movements (
                    product_id,
                    source_location_id,
                    destination_location_id,
                    quantity,
                    movement_type,
                    reference_type,
                    reference_id,
                    created_by
                ) VALUES (
                    v_item.product_id,
                    v_supplier.location_id,
                    v_wh_location,
                    v_qty_to_receive,
                    'PURCHASE_RECEIPT',
                    'PURCHASE',
                    p_purchase_id,
                    v_caller_id
                );

                v_item_cost := pg_catalog.round(v_qty_to_receive * v_item.unit_cost * (1 + (COALESCE(v_item.tax_rate, 0) / 100.0)), 2);
                v_incremental_payable := v_incremental_payable + v_item_cost;
                v_any_item_received := true;
            END IF;
        END LOOP;
    END IF;

    -- Evaluate order completion status
    FOR v_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id
    LOOP
        IF v_item.quantity_received < v_item.quantity_ordered THEN
            v_all_fully_received := false;
        END IF;
        IF v_item.quantity_received > 0 THEN
            v_any_item_received := true;
        END IF;
    END LOOP;

    IF v_all_fully_received THEN
        v_new_status := 'RECEIVED';
    ELSIF v_any_item_received THEN
        v_new_status := 'PARTIALLY_RECEIVED';
    ELSE
        v_new_status := v_purchase.status;
    END IF;

    -- Update purchase header
    UPDATE public.purchases
    SET status = v_new_status,
        received_at = CASE WHEN v_new_status = 'RECEIVED' THEN pg_catalog.now() ELSE received_at END,
        updated_at = pg_catalog.now()
    WHERE id = p_purchase_id;

    -- Update supplier payable balance for newly received inventory
    IF v_incremental_payable > 0 THEN
        UPDATE public.suppliers
        SET current_payable = current_payable + v_incremental_payable,
            updated_at = pg_catalog.now()
        WHERE id = v_purchase.supplier_id;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', v_new_status,
        'incremental_payable', v_incremental_payable
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 4: rpc_record_salary_payment
-- Atomic salary payment with advance deduction and balanced ledger entries.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_record_salary_payment(
    p_staff_id UUID,
    p_period_month VARCHAR,
    p_base_salary NUMERIC,
    p_advance_deducted NUMERIC,
    p_other_deductions NUMERIC,
    p_amount_paid NUMERIC,
    p_payment_method VARCHAR,
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_staff RECORD;
    v_payment_id UUID;
    v_voucher_num VARCHAR(50);
    v_net_payable NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND OR v_caller_profile.role != 'owner' THEN
        RAISE EXCEPTION 'Access denied: only the owner can disburse salaries.';
    END IF;

    SELECT * INTO v_staff FROM public.profiles WHERE id = p_staff_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found or inactive.';
    END IF;

    -- Duplicate check for period
    IF EXISTS (SELECT 1 FROM public.salary_payments WHERE staff_id = p_staff_id AND period_month = p_period_month) THEN
        RAISE EXCEPTION 'Salary payment for period % has already been recorded for %.', p_period_month, v_staff.full_name;
    END IF;

    v_net_payable := pg_catalog.greatest(0.00, p_base_salary - COALESCE(p_advance_deducted, 0) - COALESCE(p_other_deductions, 0));
    IF p_amount_paid <= 0 OR p_amount_paid > v_net_payable THEN
        RAISE EXCEPTION 'Payment amount (%) must be positive and cannot exceed net payable (%).', p_amount_paid, v_net_payable;
    END IF;

    v_voucher_num := 'SAL-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert salary payment record
    INSERT INTO public.salary_payments (
        voucher_number,
        staff_id,
        period_month,
        base_salary,
        advance_deducted,
        other_deductions,
        net_payable,
        amount_paid,
        net_paid,
        payment_method,
        payment_date,
        notes,
        created_by
    ) VALUES (
        v_voucher_num,
        p_staff_id,
        p_period_month,
        p_base_salary,
        COALESCE(p_advance_deducted, 0),
        COALESCE(p_other_deductions, 0),
        v_net_payable,
        p_amount_paid,
        p_amount_paid,
        p_payment_method,
        p_payment_date,
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_payment_id;

    -- 2. Mark deducted advances as settled
    IF p_advance_deducted > 0 THEN
        UPDATE public.salary_advances
        SET is_deducted = true,
            is_settled = true,
            deducted_in_payment_id = v_payment_id
        WHERE staff_id = p_staff_id AND (is_settled = false OR is_deducted = false);
    END IF;

    -- 3. Post balanced double-entry to financial ledger
    -- Entry 1: Debit Staff Salary Expense
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-DR',
        '6020',
        'Staff Salary Expense',
        p_amount_paid,
        0.00,
        'Salary disbursement for ' || v_staff.full_name || ' (' || p_period_month || ')',
        'SALARY',
        v_payment_id,
        v_caller_id
    );

    -- Entry 2: Credit Cash Drawer or Bank Account
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-CR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        0.00,
        p_amount_paid,
        'Payment of salary for ' || v_staff.full_name,
        'SALARY',
        v_payment_id,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'voucher_number', v_voucher_num,
        'net_payable', v_net_payable,
        'amount_paid', p_amount_paid
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 5: rpc_record_expense
-- Atomic expense creation with balanced financial ledger posting.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_record_expense(
    p_category VARCHAR,
    p_amount NUMERIC,
    p_payment_method VARCHAR,
    p_expense_date DATE DEFAULT CURRENT_DATE,
    p_description TEXT DEFAULT 'Operational Expense',
    p_vehicle_number VARCHAR DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_expense_id UUID;
    v_voucher_num VARCHAR(50);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := v_caller_profile.role;
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_expenses')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have expense management permissions.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Expense amount must be greater than zero.';
    END IF;

    v_voucher_num := 'EXP-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert into expenses
    INSERT INTO public.expenses (
        voucher_number,
        category,
        amount,
        payment_method,
        expense_date,
        description,
        vehicle_number,
        created_by
    ) VALUES (
        v_voucher_num,
        p_category,
        p_amount,
        p_payment_method,
        p_expense_date,
        p_description,
        p_vehicle_number,
        v_caller_id
    ) RETURNING id INTO v_expense_id;

    -- 2. Post balanced dual-entry to financial ledger
    -- Entry 1: Debit Operating Expense Account
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-DR',
        '6010',
        'Operating Expense (' || p_category || ')',
        p_amount,
        0.00,
        p_description,
        'EXPENSE',
        v_expense_id,
        v_caller_id
    );

    -- Entry 2: Credit Cash Drawer or Bank Account
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-CR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        0.00,
        p_amount,
        'Disbursement for ' || p_category || ' expense',
        'EXPENSE',
        v_expense_id,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'expense_id', v_expense_id,
        'voucher_number', v_voucher_num,
        'amount', p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 6: rpc_adjust_inventory_stock
-- Atomic warehouse stock adjustment with FOR UPDATE locking and negative prevention.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_adjust_inventory_stock(
    p_product_id UUID,
    p_quantity_delta INT,
    p_reason TEXT DEFAULT 'Manual Stock Adjustment'
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_inv RECORD;
    v_new_stock INT;
    v_movement_type VARCHAR(30);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    IF v_caller_profile.role != 'owner' AND (public.get_staff_permissions()->>'can_warehouse')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: only owner or warehouse staff can adjust stock.';
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        RAISE EXCEPTION 'Central warehouse is not configured.';
    END IF;

    -- Lock inventory balance record FOR UPDATE
    SELECT * INTO v_inv FROM public.inventory_balances
    WHERE warehouse_id = v_default_wh AND product_id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        IF p_quantity_delta < 0 THEN
            RAISE EXCEPTION 'Negative stock prohibited: cannot deduct from non-existent balance.';
        END IF;
        v_new_stock := p_quantity_delta;
        INSERT INTO public.inventory_balances (
            warehouse_id,
            product_id,
            quantity_on_hand,
            updated_at
        ) VALUES (
            v_default_wh,
            p_product_id,
            v_new_stock,
            pg_catalog.now()
        );
    ELSE
        v_new_stock := v_inv.quantity_on_hand + p_quantity_delta;
        IF v_new_stock < 0 THEN
            RAISE EXCEPTION 'Negative stock prohibited: current %, requested change % (% < 0)',
                v_inv.quantity_on_hand, p_quantity_delta, v_new_stock;
        END IF;

        UPDATE public.inventory_balances
        SET quantity_on_hand = v_new_stock,
            updated_at = pg_catalog.now()
        WHERE id = v_inv.id;
    END IF;

    v_movement_type := CASE WHEN p_quantity_delta >= 0 THEN 'ADJUSTMENT_IN' ELSE 'ADJUSTMENT_OUT' END;

    -- Record immutable stock movement
    INSERT INTO public.stock_movements (
        product_id,
        source_location_id,
        destination_location_id,
        quantity,
        movement_type,
        reference_type,
        notes,
        created_by
    ) VALUES (
        p_product_id,
        CASE WHEN p_quantity_delta < 0 THEN v_wh_location ELSE NULL END,
        CASE WHEN p_quantity_delta >= 0 THEN v_wh_location ELSE NULL END,
        abs(p_quantity_delta),
        v_movement_type,
        'MANUAL_ADJUSTMENT',
        p_reason,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'product_id', p_product_id,
        'previous_stock', COALESCE(v_inv.quantity_on_hand, 0),
        'new_stock', v_new_stock,
        'delta', p_quantity_delta
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 7: rpc_reverse_financial_entry
-- Immutable ledger reversal: generates compensating entry with swapped debit/credit.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_reverse_financial_entry(
    p_entry_id UUID,
    p_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_orig RECORD;
    v_rev_id UUID;
    v_rev_entry_num VARCHAR(50);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND OR v_caller_profile.role != 'owner' THEN
        RAISE EXCEPTION 'Access denied: only the business owner can reverse posted financial entries.';
    END IF;

    SELECT * INTO v_orig FROM public.financial_ledger WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Financial entry not found: %', p_entry_id;
    END IF;

    IF v_orig.reference_type = 'REVERSAL' THEN
        RAISE EXCEPTION 'Cannot reverse an entry that is already a reversal.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.financial_ledger WHERE reference_type = 'REVERSAL' AND reference_id = p_entry_id) THEN
        RAISE EXCEPTION 'This entry has already been reversed.';
    END IF;

    v_rev_entry_num := 'REV-' || v_orig.entry_number;

    -- Compensating reversal entry
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        v_rev_entry_num,
        v_orig.account_code,
        v_orig.account_name,
        v_orig.credit, -- Swapped debit/credit
        v_orig.debit,
        'REVERSAL: ' || v_orig.description || ' (Reason: ' || p_reason || ')',
        'REVERSAL',
        p_entry_id,
        v_caller_id
    ) RETURNING id INTO v_rev_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'reversal_id', v_rev_id,
        'reversal_entry_number', v_rev_entry_num,
        'reversed_entry_id', p_entry_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 5. RPC EXECUTION GRANTS (Revoked from PUBLIC/anon, Granted to authenticated/service_role)

REVOKE ALL ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_complete_pos_sale(JSONB, VARCHAR, NUMERIC, NUMERIC, VARCHAR, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_receive_purchase_order(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_salary_payment(UUID, VARCHAR, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_expense(VARCHAR, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_adjust_inventory_stock(UUID, INT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_reverse_financial_entry(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_complete_pos_sale(JSONB, VARCHAR, NUMERIC, NUMERIC, VARCHAR, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_receive_purchase_order(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_salary_payment(UUID, VARCHAR, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_expense(VARCHAR, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_adjust_inventory_stock(UUID, INT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reverse_financial_entry(UUID, TEXT) TO authenticated, service_role;
-- ==============================================================================
-- AquaTrack ERP — Migration: Remediation Round 2
-- Version: 20261103000002_remediation_round_2.sql
-- Description:
--   1. RLS & Policy Hardening: Enumerate and drop all unsafe foundation/legacy policies
--      across all 28 tables. Disallow direct writes to financial ledger, stock movements,
--      inventory balances, jar custody movements, delivery stops, and customer payments.
--   2. Delivery Stop & Jar Custody: Physical custody strict conservation, decoupled drops/returns,
--      row locking (FOR UPDATE), condition tracking without fabricated transitions,
--      and validation that customer jar holdings never become negative.
--   3. POS Module: Aggregate line quantities by product before stock check, row-locking FOR UPDATE,
--      strict payment method allowlist, server-side pricing/taxes, and stable idempotency keys.
--   4. Purchases Module: Atomic purchase order creation (rpc_create_purchase_order),
--      partial goods receipt with empty-array rejection, over-receipt prevention,
--      and atomic supplier payment with ledger posting (rpc_record_supplier_payment).
--   5. Salary Module: Partial advance deduction (FIFO), remove uq_staff_salary_period to support
--      legitimate partial salary disbursements, atomic advance disbursement (rpc_record_salary_advance),
--      and balanced accrual ledger entries.
--   6. Financial Ledger: Multi-line atomic journal reversal (rpc_reverse_financial_entry),
--      guaranteeing balanced debits and credits and linking to original transactions.
-- ==============================================================================

-- 1. SCHEMA REFINEMENTS & EXTENSIONS

-- 1.1 Support partial salary advance deductions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'salary_advances' AND column_name = 'amount_deducted'
    ) THEN
        ALTER TABLE public.salary_advances ADD COLUMN amount_deducted NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (amount_deducted >= 0);
        UPDATE public.salary_advances SET amount_deducted = amount WHERE is_settled = true OR is_deducted = true;
    END IF;
END $$;

-- 1.2 Remove single-payment restriction per period to support partial salary payments
ALTER TABLE public.salary_payments DROP CONSTRAINT IF EXISTS uq_staff_salary_period;

-- 1.3 Add idempotency key support to salary payments
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'salary_payments' AND column_name = 'idempotency_key'
    ) THEN
        ALTER TABLE public.salary_payments ADD COLUMN idempotency_key VARCHAR(100);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_payments_idempotency ON public.salary_payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
    END IF;
END $$;

-- 1.4 Customer damaged jars holding tracking
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'total_damaged_jars_holding'
    ) THEN
        ALTER TABLE public.customers ADD COLUMN total_damaged_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_damaged_jars_holding >= 0);
    END IF;
END $$;

-- 1.5 Indexes on financial ledger for fast batch journal lookup
CREATE INDEX IF NOT EXISTS idx_financial_ledger_ref ON public.financial_ledger(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_reversed ON public.financial_ledger(reversed_entry_id);

-- 2. HARDENED SECURITY HELPER FUNCTIONS

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_active = true
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS VARCHAR AS $$
    SELECT role FROM public.profiles
    WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_staff_permissions()
RETURNS JSONB AS $$
    SELECT pg_catalog.jsonb_build_object(
        'can_pos', COALESCE(can_pos, false),
        'can_warehouse', COALESCE(can_warehouse, false),
        'can_manage_customers', COALESCE(can_manage_customers, false),
        'can_manage_orders', COALESCE(can_manage_orders, false),
        'can_deliveries', COALESCE(can_deliveries, true),
        'can_manage_suppliers', COALESCE(can_manage_suppliers, false),
        'can_manage_expenses', COALESCE(can_manage_expenses, false),
        'can_manage_salaries', COALESCE(can_manage_salaries, false)
    )
    FROM public.profiles
    WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_staff_permissions() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_staff_permissions() TO authenticated, service_role;

-- 3. COMPLETE RLS POLICIES OVERHAUL ACROSS ALL 28 TABLES
-- Eradicate all loose USING (true) / WITH CHECK (true) policies and prevent direct-write bypasses.

-- Drop all existing policies
DROP POLICY IF EXISTS bs_select ON public.business_settings;
DROP POLICY IF EXISTS bs_modify ON public.business_settings;
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS profiles_delete ON public.profiles;
DROP POLICY IF EXISTS loc_select ON public.locations;
DROP POLICY IF EXISTS loc_modify ON public.locations;
DROP POLICY IF EXISTS wh_select ON public.warehouses;
DROP POLICY IF EXISTS wh_modify ON public.warehouses;
DROP POLICY IF EXISTS cust_select ON public.customers;
DROP POLICY IF EXISTS cust_insert ON public.customers;
DROP POLICY IF EXISTS cust_update ON public.customers;
DROP POLICY IF EXISTS cust_delete ON public.customers;
DROP POLICY IF EXISTS supp_select ON public.suppliers;
DROP POLICY IF EXISTS supp_modify ON public.suppliers;
DROP POLICY IF EXISTS prod_select ON public.products;
DROP POLICY IF EXISTS prod_modify ON public.products;
DROP POLICY IF EXISTS csp_select ON public.customer_special_prices;
DROP POLICY IF EXISTS csp_modify ON public.customer_special_prices;
DROP POLICY IF EXISTS inv_select ON public.inventory_balances;
DROP POLICY IF EXISTS inv_modify ON public.inventory_balances;
DROP POLICY IF EXISTS sm_select ON public.stock_movements;
DROP POLICY IF EXISTS sm_insert ON public.stock_movements;
DROP POLICY IF EXISTS jcm_select ON public.jar_custody_movements;
DROP POLICY IF EXISTS jcm_insert ON public.jar_custody_movements;
DROP POLICY IF EXISTS orders_select ON public.orders;
DROP POLICY IF EXISTS orders_insert ON public.orders;
DROP POLICY IF EXISTS orders_update ON public.orders;
DROP POLICY IF EXISTS oi_select ON public.order_items;
DROP POLICY IF EXISTS oi_modify ON public.order_items;
DROP POLICY IF EXISTS ds_select ON public.delivery_stops;
DROP POLICY IF EXISTS ds_update ON public.delivery_stops;
DROP POLICY IF EXISTS ds_modify ON public.delivery_stops;
DROP POLICY IF EXISTS invs_select ON public.invoices;
DROP POLICY IF EXISTS invs_modify ON public.invoices;
DROP POLICY IF EXISTS invs_items_select ON public.invoice_items;
DROP POLICY IF EXISTS invs_items_modify ON public.invoice_items;
DROP POLICY IF EXISTS cp_select ON public.customer_payments;
DROP POLICY IF EXISTS cp_insert ON public.customer_payments;
DROP POLICY IF EXISTS pos_select ON public.pos_sales;
DROP POLICY IF EXISTS pos_insert ON public.pos_sales;
DROP POLICY IF EXISTS pos_items_select ON public.pos_sale_items;
DROP POLICY IF EXISTS pos_items_insert ON public.pos_sale_items;
DROP POLICY IF EXISTS purch_all ON public.purchases;
DROP POLICY IF EXISTS purch_items_all ON public.purchase_items;
DROP POLICY IF EXISTS supp_pay_all ON public.supplier_payments;
DROP POLICY IF EXISTS exp_select ON public.expenses;
DROP POLICY IF EXISTS exp_modify ON public.expenses;
DROP POLICY IF EXISTS sal_adv_select ON public.salary_advances;
DROP POLICY IF EXISTS sal_adv_modify ON public.salary_advances;
DROP POLICY IF EXISTS sal_pay_select ON public.salary_payments;
DROP POLICY IF EXISTS sal_pay_modify ON public.salary_payments;
DROP POLICY IF EXISTS ch_select ON public.cash_handovers;
DROP POLICY IF EXISTS ch_modify ON public.cash_handovers;
DROP POLICY IF EXISTS ledger_select ON public.financial_ledger;
DROP POLICY IF EXISTS audit_select ON public.audit_logs;

-- Enable and Force RLS on all tables
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_special_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_special_prices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.jar_custody_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jar_custody_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_stops FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sales FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.salary_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_advances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_handovers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- 3.1 Business Settings
CREATE POLICY bs_select ON public.business_settings FOR SELECT TO authenticated
    USING (public.is_active_user());
CREATE POLICY bs_modify ON public.business_settings FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.2 Profiles
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
    USING (public.is_active_user() AND (public.get_user_role() = 'owner' OR id = auth.uid()));
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role() = 'owner');
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
    USING (public.is_active_user() AND (public.get_user_role() = 'owner' OR id = auth.uid()))
    WITH CHECK (public.is_active_user() AND (public.get_user_role() = 'owner' OR id = auth.uid()));
CREATE POLICY profiles_delete ON public.profiles FOR DELETE TO authenticated
    USING (public.get_user_role() = 'owner');

-- 3.3 Locations
CREATE POLICY loc_select ON public.locations FOR SELECT TO authenticated
    USING (public.is_active_user());
CREATE POLICY loc_modify ON public.locations FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.4 Warehouses
CREATE POLICY wh_select ON public.warehouses FOR SELECT TO authenticated
    USING (public.is_active_user());
CREATE POLICY wh_modify ON public.warehouses FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.5 Customers (Strict Permission-Aware Access)
CREATE POLICY cust_select ON public.customers FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR
            (public.get_staff_permissions()->>'can_manage_customers')::boolean = true OR
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true OR
            (public.get_staff_permissions()->>'can_deliveries')::boolean = true OR
            (public.get_staff_permissions()->>'can_pos')::boolean = true
        )
    );
CREATE POLICY cust_insert ON public.customers FOR INSERT TO authenticated
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_customers')::boolean = true
        )
    );
CREATE POLICY cust_update ON public.customers FOR UPDATE TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_customers')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_customers')::boolean = true
        )
    );
CREATE POLICY cust_delete ON public.customers FOR DELETE TO authenticated
    USING (public.get_user_role() = 'owner');

-- 3.6 Suppliers
CREATE POLICY supp_select ON public.suppliers FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true OR
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true
        )
    );
CREATE POLICY supp_modify ON public.suppliers FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    );

-- 3.7 Products
CREATE POLICY prod_select ON public.products FOR SELECT TO authenticated
    USING (public.is_active_user());
CREATE POLICY prod_modify ON public.products FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.8 Customer Special Prices
CREATE POLICY csp_select ON public.customer_special_prices FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_customers')::boolean = true OR
            (public.get_staff_permissions()->>'can_pos')::boolean = true OR
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY csp_modify ON public.customer_special_prices FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.9 Inventory Balances (Read Only for Authorized Roles; Direct Writes Disallowed)
CREATE POLICY inv_select ON public.inventory_balances FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true OR
            (public.get_staff_permissions()->>'can_pos')::boolean = true
        )
    );
-- No direct INSERT, UPDATE, or DELETE policy for authenticated staff. Updates handled exclusively via RPCs.

-- 3.10 Stock Movements (Read Only; Direct Writes Disallowed)
CREATE POLICY sm_select ON public.stock_movements FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true
        )
    );
-- No direct INSERT, UPDATE, or DELETE policy for authenticated staff. Movements recorded exclusively via validated RPCs.

-- 3.11 Jar Custody Movements
CREATE POLICY jcm_select ON public.jar_custody_movements FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true OR
            (public.get_staff_permissions()->>'can_deliveries')::boolean = true
        )
    );
CREATE POLICY jcm_insert ON public.jar_custody_movements FOR INSERT TO authenticated
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true
        )
    );
-- No UPDATE or DELETE policy. Jar custody ledger is immutable append-only.

-- 3.12 Customer Orders & Order Items
CREATE POLICY orders_select ON public.orders FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            assigned_staff_id = auth.uid() OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY orders_insert ON public.orders FOR INSERT TO authenticated
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY orders_update ON public.orders FOR UPDATE TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );

CREATE POLICY oi_select ON public.order_items FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_items.order_id
            AND (public.get_user_role() = 'owner' OR o.assigned_staff_id = auth.uid() OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true)
        )
    );
CREATE POLICY oi_modify ON public.order_items FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );

-- 3.13 Delivery Stops
CREATE POLICY ds_select ON public.delivery_stops FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            assigned_staff_id = auth.uid() OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY ds_insert ON public.delivery_stops FOR INSERT TO authenticated
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY ds_modify ON public.delivery_stops FOR UPDATE TO authenticated
    USING (public.is_active_user() AND public.get_user_role() = 'owner')
    WITH CHECK (public.is_active_user() AND public.get_user_role() = 'owner');
-- Staff execution of delivery stops is strictly governed by rpc_execute_delivery_stop.

-- 3.14 Invoices & Invoice Items
CREATE POLICY invs_select ON public.invoices FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY invs_modify ON public.invoices FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );

CREATE POLICY invs_items_select ON public.invoice_items FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY invs_items_modify ON public.invoice_items FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );

-- 3.15 Customer Payments
CREATE POLICY cp_select ON public.customer_payments FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            collected_by_staff_id = auth.uid() OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
-- Direct client inserts disallowed. Customer payments recorded exclusively via RPC or owner.
CREATE POLICY cp_modify ON public.customer_payments FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.16 POS Sales & Items
CREATE POLICY pos_select ON public.pos_sales FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid()
        )
    );
-- Direct inserts disallowed; POS completed exclusively via rpc_complete_pos_sale.

CREATE POLICY pos_items_select ON public.pos_sale_items FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            EXISTS (SELECT 1 FROM public.pos_sales ps WHERE ps.id = pos_sale_items.sale_id AND ps.staff_id = auth.uid())
        )
    );
-- Direct inserts disallowed; line items created exclusively via rpc_complete_pos_sale.

-- 3.17 Purchases & Purchase Items
CREATE POLICY purch_all ON public.purchases FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    );

CREATE POLICY purch_items_all ON public.purchase_items FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    );

-- 3.18 Supplier Payments
CREATE POLICY supp_pay_select ON public.supplier_payments FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    );
-- Direct inserts disallowed; recorded atomically via rpc_record_supplier_payment.

-- 3.19 Expenses
CREATE POLICY exp_select ON public.expenses FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_expenses')::boolean = true
        )
    );
CREATE POLICY exp_modify ON public.expenses FOR UPDATE TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');
-- Direct inserts disallowed; created exclusively via rpc_record_expense.

-- 3.20 Salary Advances & Salary Payments
CREATE POLICY sal_adv_select ON public.salary_advances FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid() OR
            (public.get_staff_permissions()->>'can_manage_salaries')::boolean = true
        )
    );
-- Direct inserts disallowed; advances created via rpc_record_salary_advance.

CREATE POLICY sal_pay_select ON public.salary_payments FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid() OR
            (public.get_staff_permissions()->>'can_manage_salaries')::boolean = true
        )
    );
-- Direct inserts disallowed; disbursements created via rpc_record_salary_payment.

-- 3.21 Driver Cash Handovers
CREATE POLICY ch_select ON public.cash_handovers FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid()
        )
    );
CREATE POLICY ch_modify ON public.cash_handovers FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid()
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid()
        )
    );

-- 3.22 Financial Ledger & Audit Logs (Strictly Owner Only; Immutable)
CREATE POLICY ledger_select ON public.financial_ledger FOR SELECT TO authenticated
    USING (public.is_active_user() AND public.get_user_role() = 'owner');
-- No INSERT, UPDATE, or DELETE policy for authenticated. Entries posted strictly via validated RPCs.

CREATE POLICY audit_select ON public.audit_logs FOR SELECT TO authenticated
    USING (public.is_active_user() AND public.get_user_role() = 'owner');
-- No INSERT, UPDATE, or DELETE policy for authenticated.

-- ==============================================================================
-- 4. ATOMIC, VALIDATED BUSINESS TRANSACTION RPCS
-- ==============================================================================

-- 4.1 RPC: rpc_execute_delivery_stop
-- Strictly enforces jar physical conservation, row-locking (FOR UPDATE),
-- non-negative customer holdings, actual condition tracking, and balanced ledger.
CREATE OR REPLACE FUNCTION public.rpc_execute_delivery_stop(
    p_stop_id UUID,
    p_actual_delivered INT,
    p_empty_jars INT,
    p_damaged_jars INT,
    p_payment_amount NUMERIC DEFAULT 0.00,
    p_payment_method VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_stop RECORD;
    v_order RECORD;
    v_customer RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_perms JSONB;
    v_payment_num VARCHAR(50);
    v_default_wh UUID;
    v_wh_location UUID;
    v_default_jar_id UUID;
    v_total_ordered_qty INT := 0;
    v_current_total_custody INT := 0;
    v_total_returning INT := 0;
    v_new_full_holding INT := 0;
    v_new_empty_holding INT := 0;
    v_new_damaged_holding INT := 0;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_deliveries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have delivery execution authority.';
    END IF;

    -- Validate input non-negativity
    IF p_actual_delivered < 0 OR p_empty_jars < 0 OR p_damaged_jars < 0 THEN
        RAISE EXCEPTION 'Quantities cannot be negative.';
    END IF;
    IF p_payment_amount < 0 THEN
        RAISE EXCEPTION 'Payment amount cannot be negative.';
    END IF;

    -- Lock delivery stop row FOR UPDATE
    SELECT * INTO v_stop FROM public.delivery_stops WHERE id = p_stop_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop not found: %', p_stop_id;
    END IF;

    -- Verify assignment: assigned staff can only execute their own stops
    IF v_caller_role != 'owner' AND v_stop.assigned_staff_id != v_caller_id THEN
        RAISE EXCEPTION 'Access denied: staff can only execute stops assigned to them.';
    END IF;

    -- Idempotency check: if already completed, return existing status
    IF v_stop.status = 'COMPLETED' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', 'ALREADY_COMPLETED'
        );
    END IF;

    IF v_stop.status NOT IN ('ASSIGNED', 'EN_ROUTE', 'PENDING') THEN
        RAISE EXCEPTION 'Delivery stop cannot be executed in "%" status.', v_stop.status;
    END IF;

    -- Handle explicit failure report
    IF p_failure_reason IS NOT NULL AND p_actual_delivered = 0 THEN
        UPDATE public.delivery_stops
        SET status = 'FAILED',
            failure_reason = p_failure_reason,
            executed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_stop_id;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'FAILED');
    END IF;

    -- Lock order and customer records FOR UPDATE
    SELECT * INTO v_order FROM public.orders WHERE id = v_stop.order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent order % not found.', v_stop.order_id;
    END IF;

    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer % not found.', v_order.customer_id;
    END IF;

    -- Validate delivered quantity against order items remaining
    SELECT COALESCE(SUM(quantity), 0) INTO v_total_ordered_qty
    FROM public.order_items WHERE order_id = v_order.id;

    IF p_actual_delivered > v_total_ordered_qty THEN
        RAISE EXCEPTION 'Delivered quantity (%) exceeds remaining ordered quantity (%).',
            p_actual_delivered, v_total_ordered_qty;
    END IF;

    -- Validate payment method and amount
    IF p_payment_amount > 0 THEN
        IF p_payment_method IS NULL OR p_payment_method NOT IN ('CASH', 'UPI', 'CREDIT') THEN
            RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, CREDIT.', p_payment_method;
        END IF;
        IF p_payment_method = 'CREDIT' THEN
            RAISE EXCEPTION 'Payment amount cannot be positive when payment method is CREDIT.';
        END IF;
        IF p_payment_amount > v_order.total_amount THEN
            RAISE EXCEPTION 'Payment amount (%) exceeds order total amount (%).', p_payment_amount, v_order.total_amount;
        END IF;
    END IF;

    -- Resolve required custody entities
    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    SELECT id INTO v_default_jar_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;

    IF v_default_jar_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;
    IF v_wh_location IS NULL THEN
        RAISE EXCEPTION 'Central warehouse location is not configured.';
    END IF;
    IF v_customer.location_id IS NULL THEN
        RAISE EXCEPTION 'Customer physical location is not configured.';
    END IF;

    -- 1. Physical Jar Custody Conservation & Validation
    v_current_total_custody := v_customer.total_full_jars_holding + v_customer.total_empty_jars_holding + COALESCE(v_customer.total_damaged_jars_holding, 0);
    v_total_returning := p_empty_jars + p_damaged_jars;

    IF v_total_returning > v_current_total_custody THEN
        RAISE EXCEPTION 'Invalid physical return: customer holds % jars, but attempted to return % jars.',
            v_current_total_custody, v_total_returning;
    END IF;

    -- Customer full holding increases with fresh drops
    v_new_full_holding := v_customer.total_full_jars_holding + p_actual_delivered;

    -- Empty/damaged jars returned deduct from customer custody
    IF v_customer.total_empty_jars_holding >= p_empty_jars THEN
        v_new_empty_holding := v_customer.total_empty_jars_holding - p_empty_jars;
    ELSE
        -- Emptied full jars returned
        v_new_full_holding := v_new_full_holding - (p_empty_jars - v_customer.total_empty_jars_holding);
        v_new_empty_holding := 0;
    END IF;

    -- Damaged jars deduction
    v_new_damaged_holding := COALESCE(v_customer.total_damaged_jars_holding, 0);
    IF p_damaged_jars > 0 THEN
        IF v_new_damaged_holding >= p_damaged_jars THEN
            v_new_damaged_holding := v_new_damaged_holding - p_damaged_jars;
        ELSE
            -- Damaged during customer usage: deduct remainder from empty/full holding
            DECLARE
                v_excess_dmg INT := p_damaged_jars - v_new_damaged_holding;
            BEGIN
                v_new_damaged_holding := 0;
                IF v_new_empty_holding >= v_excess_dmg THEN
                    v_new_empty_holding := v_new_empty_holding - v_excess_dmg;
                ELSE
                    v_new_full_holding := v_new_full_holding - (v_excess_dmg - v_new_empty_holding);
                    v_new_empty_holding := 0;
                END IF;
            END;
        END IF;
    END IF;

    IF v_new_full_holding < 0 OR v_new_empty_holding < 0 THEN
        RAISE EXCEPTION 'Physical custody violation: customer jar holding cannot become negative (full: %, empty: %).',
            v_new_full_holding, v_new_empty_holding;
    END IF;

    -- Update customer holdings atomically
    UPDATE public.customers
    SET total_full_jars_holding = v_new_full_holding,
        total_empty_jars_holding = v_new_empty_holding,
        total_damaged_jars_holding = v_new_damaged_holding,
        updated_at = pg_catalog.now()
    WHERE id = v_customer.id;

    -- 2. Log Immutable Jar Custody Movements
    IF p_actual_delivered > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_wh_location,
            v_customer.location_id,
            'FULL_USABLE',
            'FULL_USABLE',
            p_actual_delivered,
            'CUSTOMER_DELIVERY',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    IF p_empty_jars > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_customer.location_id,
            v_wh_location,
            'EMPTY_DIRTY',
            'EMPTY_DIRTY',
            p_empty_jars,
            'CUSTOMER_EMPTY_RETURN',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    IF p_damaged_jars > 0 THEN
        -- Condition from customer is DAMAGED_REPAIRABLE; no fabricated EMPTY_DIRTY transition
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_customer.location_id,
            v_wh_location,
            'DAMAGED_REPAIRABLE',
            'DAMAGED_REPAIRABLE',
            p_damaged_jars,
            'DAMAGED_COLLECTED',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    -- 3. Payment Processing & Balanced Financial Ledger Entry
    IF p_payment_amount > 0 THEN
        v_payment_num := 'PAY-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || pg_catalog.substr(p_stop_id::text, 1, 6);

        INSERT INTO public.customer_payments (
            payment_number,
            customer_id,
            order_id,
            amount,
            payment_method,
            collected_by_staff_id,
            notes
        ) VALUES (
            v_payment_num,
            v_customer.id,
            v_order.id,
            p_payment_amount,
            p_payment_method,
            v_caller_id,
            'Route stop payment'
        );

        UPDATE public.customers
        SET current_balance = current_balance - p_payment_amount,
            updated_at = pg_catalog.now()
        WHERE id = v_customer.id;

        -- Balanced dual-entry posting
        -- Entry 1: Debit Cash Float with Driver (or Bank Current Account if UPI)
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_payment_num || '-DR',
            CASE WHEN p_payment_method = 'UPI' THEN '1020' ELSE '1015' END,
            CASE WHEN p_payment_method = 'UPI' THEN 'Bank Current Account' ELSE 'Cash Float with Driver' END,
            p_payment_amount,
            0.00,
            'Route collection from ' || v_customer.contact_name,
            'PAYMENT',
            p_stop_id,
            v_caller_id
        );

        -- Entry 2: Credit Accounts Receivable
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_payment_num || '-CR',
            '1110',
            'Accounts Receivable',
            0.00,
            p_payment_amount,
            'Settlement of A/R for order ' || v_order.order_number,
            'PAYMENT',
            p_stop_id,
            v_caller_id
        );
    END IF;

    -- 4. Finalize stop and order records
    UPDATE public.delivery_stops
    SET status = 'COMPLETED',
        actual_delivered_quantity = p_actual_delivered,
        empty_jars_collected = p_empty_jars,
        damaged_jars_collected = p_damaged_jars,
        payment_collected = p_payment_amount,
        payment_method = p_payment_method,
        notes = p_notes,
        executed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_stop_id;

    UPDATE public.orders
    SET status = 'DELIVERED',
        payment_status = CASE 
            WHEN p_payment_amount >= total_amount THEN 'PAID'
            WHEN p_payment_amount > 0 THEN 'PARTIALLY_PAID'
            ELSE payment_status 
        END,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'COMPLETED',
        'delivered', p_actual_delivered,
        'empty_collected', p_empty_jars,
        'damaged_collected', p_damaged_jars,
        'customer_closing_holding', (v_new_full_holding + v_new_empty_holding + v_new_damaged_holding)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.2 RPC: rpc_complete_pos_sale
-- Aggregates quantities by product before stock checks to prevent multi-line stock bypass.
-- Locks inventory balances FOR UPDATE. Strictly validates payment allowlist, recalculates
-- server-side prices/taxes, and balances the financial ledger.
CREATE OR REPLACE FUNCTION public.rpc_complete_pos_sale(
    p_items JSONB,
    p_payment_method VARCHAR,
    p_discount_amount NUMERIC DEFAULT 0.00,
    p_cash_tendered NUMERIC DEFAULT 0.00,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_sale_id UUID;
    v_receipt_num VARCHAR(50);
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_agg RECORD;
    v_item JSONB;
    v_product RECORD;
    v_inv RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
    v_item_qty INT;
    v_item_price NUMERIC(12,2);
    v_item_tax NUMERIC(12,2);
    v_change_due NUMERIC(12,2) := 0.00;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_pos')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have POS execution authority.';
    END IF;

    -- Strict payment method allowlist
    IF p_payment_method NOT IN ('CASH', 'UPI', 'CARD') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, CARD.', p_payment_method;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'POS sale must contain at least one item.';
    END IF;

    -- Idempotency protection against network retries
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, receipt_number, total_amount, subtotal, tax_total, change_due
        INTO v_sale_id, v_receipt_num, v_total_amount, v_subtotal, v_tax_total, v_change_due
        FROM public.pos_sales
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'sale_id', v_sale_id,
                'receipt_number', v_receipt_num,
                'subtotal', v_subtotal,
                'tax_total', v_tax_total,
                'total_amount', v_total_amount,
                'change_due', v_change_due
            );
        END IF;
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        RAISE EXCEPTION 'Central warehouse is not configured.';
    END IF;

    -- PHASE 1: AGGREGATE QUANTITIES BY PRODUCT AND LOCK INVENTORY BALANCES FOR UPDATE
    -- Prevents multi-line bypass where multiple lines individually pass stock checks.
    FOR v_agg IN 
        SELECT 
            (elem->>'product_id')::uuid AS product_id,
            SUM((elem->>'quantity')::int) AS total_qty
        FROM jsonb_array_elements(p_items) AS elem
        GROUP BY (elem->>'product_id')::uuid
    LOOP
        IF v_agg.total_qty <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be greater than zero.';
        END IF;

        -- Verify product from master catalog
        SELECT * INTO v_product FROM public.products WHERE id = v_agg.product_id AND is_active = true;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % is invalid or inactive.', v_agg.product_id;
        END IF;

        -- Lock inventory balance record FOR UPDATE
        SELECT * INTO v_inv FROM public.inventory_balances
        WHERE warehouse_id = v_default_wh AND product_id = v_product.id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Inventory record missing for product "%" in warehouse.', v_product.name;
        END IF;

        IF v_inv.quantity_on_hand < v_agg.total_qty THEN
            RAISE EXCEPTION 'Insufficient stock for product "%": available %, requested %.',
                v_product.name, v_inv.quantity_on_hand, v_agg.total_qty;
        END IF;
    END LOOP;

    -- PHASE 2: SERVER-SIDE AUTHORITATIVE PRICING & TAX CALCULATION
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity')::int;
        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be greater than zero.';
        END IF;

        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
        v_item_price := v_product.default_sale_price;
        IF v_item_price < 0 THEN
            RAISE EXCEPTION 'Product sale price cannot be negative.';
        END IF;

        v_item_tax := pg_catalog.round(v_item_price * v_item_qty * (COALESCE(v_product.gst_rate, 0.00) / 100.0), 2);
        v_subtotal := v_subtotal + (v_item_price * v_item_qty);
        v_tax_total := v_tax_total + v_item_tax;
    END LOOP;

    IF p_discount_amount < 0 THEN
        RAISE EXCEPTION 'Discount amount cannot be negative.';
    END IF;

    IF p_discount_amount > v_subtotal THEN
        RAISE EXCEPTION 'Discount amount (%) cannot exceed subtotal (%).', p_discount_amount, v_subtotal;
    END IF;

    v_total_amount := (v_subtotal + v_tax_total) - COALESCE(p_discount_amount, 0.00);
    IF v_total_amount < 0 THEN
        RAISE EXCEPTION 'Sale total amount cannot be negative.';
    END IF;

    -- Validate cash tendered
    IF p_payment_method = 'CASH' THEN
        IF p_cash_tendered < v_total_amount THEN
            RAISE EXCEPTION 'Cash tendered (%) is less than total amount (%).', p_cash_tendered, v_total_amount;
        END IF;
        v_change_due := p_cash_tendered - v_total_amount;
    ELSE
        p_cash_tendered := v_total_amount;
        v_change_due := 0.00;
    END IF;

    v_receipt_num := 'POS-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- PHASE 3: INSERT MASTER POS SALE RECORD
    INSERT INTO public.pos_sales (
        receipt_number,
        subtotal,
        tax_total,
        discount_amount,
        total_amount,
        payment_method,
        cash_tendered,
        change_due,
        notes,
        staff_id,
        idempotency_key
    ) VALUES (
        v_receipt_num,
        v_subtotal,
        v_tax_total,
        COALESCE(p_discount_amount, 0.00),
        v_total_amount,
        p_payment_method,
        p_cash_tendered,
        v_change_due,
        p_notes,
        v_caller_id,
        p_idempotency_key
    ) RETURNING id INTO v_sale_id;

    -- PHASE 4: INSERT LINE ITEMS, ATOMICALLY DEDUCT INVENTORY, AND LOG MOVEMENTS
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity')::int;
        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
        v_item_price := v_product.default_sale_price;
        v_item_tax := pg_catalog.round(v_item_price * v_item_qty * (COALESCE(v_product.gst_rate, 0.00) / 100.0), 2);

        INSERT INTO public.pos_sale_items (
            sale_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            tax_rate,
            tax_amount,
            total_amount
        ) VALUES (
            v_sale_id,
            v_product.id,
            v_product.name,
            v_item_qty,
            v_item_price,
            COALESCE(v_product.gst_rate, 0.00),
            v_item_tax,
            (v_item_price * v_item_qty) + v_item_tax
        );

        -- Atomically decrement warehouse stock
        UPDATE public.inventory_balances
        SET quantity_on_hand = quantity_on_hand - v_item_qty,
            updated_at = pg_catalog.now()
        WHERE warehouse_id = v_default_wh AND product_id = v_product.id;

        -- Record immutable stock movement
        INSERT INTO public.stock_movements (
            product_id,
            source_location_id,
            destination_location_id,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_product.id,
            v_wh_location,
            NULL,
            v_item_qty,
            'POS_SALE',
            'POS_SALE',
            v_sale_id,
            v_caller_id
        );
    END LOOP;

    -- PHASE 5: BALANCED DOUBLE-ENTRY FINANCIAL LEDGER POSTING
    -- Entry 1: Debit Cash Drawer or Bank Current Account
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_receipt_num || '-DR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        v_total_amount,
        0.00,
        'POS Walk-in Sale ' || v_receipt_num,
        'POS_SALE',
        v_sale_id,
        v_caller_id
    );

    -- Entry 2: Credit Sales Revenue (subtotal minus discount)
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_receipt_num || '-CR-REV',
        '4010',
        'POS Counter Sales Revenue',
        0.00,
        (v_subtotal - COALESCE(p_discount_amount, 0.00)),
        'Net Revenue for POS ' || v_receipt_num,
        'POS_SALE',
        v_sale_id,
        v_caller_id
    );

    -- Entry 3: Credit GST Output Tax Payable (if tax > 0)
    IF v_tax_total > 0 THEN
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_receipt_num || '-CR-TAX',
            '2110',
            'GST Output Tax Payable',
            0.00,
            v_tax_total,
            'GST Collected on POS ' || v_receipt_num,
            'POS_SALE',
            v_sale_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'receipt_number', v_receipt_num,
        'subtotal', v_subtotal,
        'tax_total', v_tax_total,
        'total_amount', v_total_amount,
        'change_due', v_change_due
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.3 RPC: rpc_create_purchase_order
-- Atomically inserts purchase order header and line items within a single database transaction.
CREATE OR REPLACE FUNCTION public.rpc_create_purchase_order(
    p_supplier_id UUID,
    p_purchase_date DATE,
    p_invoice_number VARCHAR DEFAULT NULL,
    p_status VARCHAR DEFAULT 'ORDERED',
    p_items JSONB DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_po_number VARCHAR DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_purchase_id UUID;
    v_po_number VARCHAR(50);
    v_supplier RECORD;
    v_item JSONB;
    v_product RECORD;
    v_item_qty INT;
    v_unit_cost NUMERIC(12,2);
    v_tax_rate NUMERIC(5,2);
    v_tax_amount NUMERIC(12,2);
    v_line_total NUMERIC(12,2);
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_suppliers')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have purchase management authority.';
    END IF;

    SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_supplier_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Supplier % not found or inactive.', p_supplier_id;
    END IF;

    IF p_status NOT IN ('DRAFT', 'ORDERED') THEN
        RAISE EXCEPTION 'Initial purchase status must be DRAFT or ORDERED, received %.', p_status;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Purchase order must contain at least one item.';
    END IF;

    -- Validate line items & calculate totals
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity_ordered')::int;
        v_unit_cost := (v_item->>'unit_cost')::numeric;
        v_tax_rate := COALESCE((v_item->>'gst_rate')::numeric, (v_item->>'tax_rate')::numeric, 0.00);

        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item ordered quantity must be greater than zero.';
        END IF;
        IF v_unit_cost < 0 THEN
            RAISE EXCEPTION 'Item unit cost cannot be negative.';
        END IF;

        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND is_active = true;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % is invalid or inactive.', v_item->>'product_id';
        END IF;

        v_tax_amount := pg_catalog.round((v_item_qty * v_unit_cost) * (v_tax_rate / 100.0), 2);
        v_line_total := (v_item_qty * v_unit_cost) + v_tax_amount;

        v_subtotal := v_subtotal + (v_item_qty * v_unit_cost);
        v_tax_total := v_tax_total + v_tax_amount;
    END LOOP;

    v_total_amount := v_subtotal + v_tax_total;

    v_po_number := COALESCE(
        p_po_number,
        'PO-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6)
    );

    -- 1. Insert Master Purchase Header
    INSERT INTO public.purchases (
        po_number,
        supplier_id,
        invoice_number,
        status,
        payment_status,
        subtotal,
        tax_total,
        total_amount,
        total_cost,
        amount_paid,
        balance_due,
        purchase_date,
        notes,
        created_by
    ) VALUES (
        v_po_number,
        p_supplier_id,
        p_invoice_number,
        p_status,
        'UNPAID',
        v_subtotal,
        v_tax_total,
        v_total_amount,
        v_total_amount,
        0.00,
        v_total_amount,
        COALESCE(p_purchase_date, CURRENT_DATE),
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_purchase_id;

    -- 2. Insert Purchase Line Items Atomically
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity_ordered')::int;
        v_unit_cost := (v_item->>'unit_cost')::numeric;
        v_tax_rate := COALESCE((v_item->>'gst_rate')::numeric, (v_item->>'tax_rate')::numeric, 0.00);
        v_tax_amount := pg_catalog.round((v_item_qty * v_unit_cost) * (v_tax_rate / 100.0), 2);
        v_line_total := (v_item_qty * v_unit_cost) + v_tax_amount;

        INSERT INTO public.purchase_items (
            purchase_id,
            product_id,
            quantity_ordered,
            quantity_received,
            unit_cost,
            tax_rate,
            gst_rate,
            tax_amount,
            total_cost,
            total_amount
        ) VALUES (
            v_purchase_id,
            (v_item->>'product_id')::uuid,
            v_item_qty,
            0,
            v_unit_cost,
            v_tax_rate,
            v_tax_rate,
            v_tax_amount,
            v_line_total,
            v_line_total
        );
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'purchase_id', v_purchase_id,
        'po_number', v_po_number,
        'total_amount', v_total_amount,
        'status', p_status
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.4 RPC: rpc_receive_purchase_order
-- Supports partial or full goods receipt. Rejects empty receipt arrays.
-- Enforces row-locking, increments inventory only for actual received quantities,
-- prevents over-receipt, records stock movements, updates supplier payable,
-- and posts balanced inventory / accounts payable ledger entries.
CREATE OR REPLACE FUNCTION public.rpc_receive_purchase_order(
    p_purchase_id UUID,
    p_received_items JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_purchase RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_perms JSONB;
    v_default_wh UUID;
    v_wh_location UUID;
    v_supplier RECORD;
    v_item RECORD;
    v_recv_item JSONB;
    v_target_product_id UUID;
    v_qty_to_receive INT;
    v_all_fully_received BOOLEAN := true;
    v_any_item_received BOOLEAN := false;
    v_incremental_payable NUMERIC(12,2) := 0.00;
    v_item_cost NUMERIC(12,2);
    v_new_status VARCHAR(20);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_suppliers')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have goods receipt authority.';
    END IF;

    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order not found: %', p_purchase_id;
    END IF;

    IF v_purchase.status = 'RECEIVED' THEN
        RETURN pg_catalog.jsonb_build_object('success', true, 'idempotent', true, 'status', 'ALREADY_RECEIVED');
    END IF;

    IF v_purchase.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Cannot receive goods for a CANCELLED purchase order.';
    END IF;

    -- Strict rejection of empty receipt array
    IF p_received_items IS NOT NULL AND jsonb_array_length(p_received_items) = 0 THEN
        RAISE EXCEPTION 'Receipt items list cannot be empty. Specify items and quantities to receive.';
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        RAISE EXCEPTION 'Central warehouse is not configured.';
    END IF;

    SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_purchase.supplier_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Supplier % not found.', v_purchase.supplier_id;
    END IF;

    IF p_received_items IS NOT NULL THEN
        -- Specific received items payload
        FOR v_recv_item IN SELECT * FROM jsonb_array_elements(p_received_items)
        LOOP
            v_target_product_id := (v_recv_item->>'product_id')::uuid;
            v_qty_to_receive := (v_recv_item->>'quantity_received')::int;

            IF v_qty_to_receive <= 0 THEN
                RAISE EXCEPTION 'Received quantity must be greater than zero.';
            END IF;

            SELECT * INTO v_item FROM public.purchase_items
            WHERE purchase_id = p_purchase_id AND product_id = v_target_product_id
            FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Product % is not on purchase order %', v_target_product_id, p_purchase_id;
            END IF;

            IF (v_item.quantity_received + v_qty_to_receive) > v_item.quantity_ordered THEN
                RAISE EXCEPTION 'Received quantity (%) exceeds outstanding quantity (%) for product.',
                    v_qty_to_receive, (v_item.quantity_ordered - v_item.quantity_received);
            END IF;

            -- Update line item received count
            UPDATE public.purchase_items
            SET quantity_received = quantity_received + v_qty_to_receive
            WHERE id = v_item.id;

            -- Lock and increment inventory balance
            INSERT INTO public.inventory_balances (
                warehouse_id,
                product_id,
                quantity_on_hand,
                updated_at
            ) VALUES (
                v_default_wh,
                v_target_product_id,
                v_qty_to_receive,
                pg_catalog.now()
            )
            ON CONFLICT (warehouse_id, product_id)
            DO UPDATE SET
                quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
                updated_at = pg_catalog.now();

            -- Record immutable stock movement
            INSERT INTO public.stock_movements (
                product_id,
                source_location_id,
                destination_location_id,
                quantity,
                movement_type,
                reference_type,
                reference_id,
                created_by
            ) VALUES (
                v_target_product_id,
                v_supplier.location_id,
                v_wh_location,
                v_qty_to_receive,
                'PURCHASE_RECEIPT',
                'PURCHASE',
                p_purchase_id,
                v_caller_id
            );

            -- Increment incremental payable
            v_item_cost := pg_catalog.round(v_qty_to_receive * v_item.unit_cost * (1 + (COALESCE(v_item.tax_rate, 0) / 100.0)), 2);
            v_incremental_payable := v_incremental_payable + v_item_cost;
            v_any_item_received := true;
        END LOOP;
    ELSE
        -- Full receipt: accept all outstanding quantities
        FOR v_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id FOR UPDATE
        LOOP
            v_qty_to_receive := v_item.quantity_ordered - v_item.quantity_received;
            IF v_qty_to_receive > 0 THEN
                UPDATE public.purchase_items
                SET quantity_received = quantity_ordered
                WHERE id = v_item.id;

                INSERT INTO public.inventory_balances (
                    warehouse_id,
                    product_id,
                    quantity_on_hand,
                    updated_at
                ) VALUES (
                    v_default_wh,
                    v_item.product_id,
                    v_qty_to_receive,
                    pg_catalog.now()
                )
                ON CONFLICT (warehouse_id, product_id)
                DO UPDATE SET
                    quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
                    updated_at = pg_catalog.now();

                INSERT INTO public.stock_movements (
                    product_id,
                    source_location_id,
                    destination_location_id,
                    quantity,
                    movement_type,
                    reference_type,
                    reference_id,
                    created_by
                ) VALUES (
                    v_item.product_id,
                    v_supplier.location_id,
                    v_wh_location,
                    v_qty_to_receive,
                    'PURCHASE_RECEIPT',
                    'PURCHASE',
                    p_purchase_id,
                    v_caller_id
                );

                v_item_cost := pg_catalog.round(v_qty_to_receive * v_item.unit_cost * (1 + (COALESCE(v_item.tax_rate, 0) / 100.0)), 2);
                v_incremental_payable := v_incremental_payable + v_item_cost;
                v_any_item_received := true;
            END IF;
        END LOOP;
    END IF;

    -- Evaluate order completion status
    FOR v_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id
    LOOP
        IF v_item.quantity_received < v_item.quantity_ordered THEN
            v_all_fully_received := false;
        END IF;
        IF v_item.quantity_received > 0 THEN
            v_any_item_received := true;
        END IF;
    END LOOP;

    IF v_all_fully_received THEN
        v_new_status := 'RECEIVED';
    ELSIF v_any_item_received THEN
        v_new_status := 'PARTIALLY_RECEIVED';
    ELSE
        v_new_status := v_purchase.status;
    END IF;

    -- Update purchase header
    UPDATE public.purchases
    SET status = v_new_status,
        received_at = CASE WHEN v_new_status = 'RECEIVED' THEN pg_catalog.now() ELSE received_at END,
        updated_at = pg_catalog.now()
    WHERE id = p_purchase_id;

    -- Update supplier payable balance
    IF v_incremental_payable > 0 THEN
        UPDATE public.suppliers
        SET current_payable = current_payable + v_incremental_payable,
            updated_at = pg_catalog.now()
        WHERE id = v_purchase.supplier_id;

        -- Post balanced double-entry accounting to financial ledger
        -- Entry 1: Debit Warehouse Inventory Asset
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-PO-' || pg_catalog.substr(p_purchase_id::text, 1, 8) || '-RECV-' || pg_catalog.substr(gen_random_uuid()::text, 1, 4) || '-DR',
            '1040',
            'Warehouse Inventory Asset',
            v_incremental_payable,
            0.00,
            'Inventory receipt for PO ' || v_purchase.po_number,
            'PURCHASE',
            p_purchase_id,
            v_caller_id
        );

        -- Entry 2: Credit Accounts Payable (Supplier Liability)
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-PO-' || pg_catalog.substr(p_purchase_id::text, 1, 8) || '-RECV-' || pg_catalog.substr(gen_random_uuid()::text, 1, 4) || '-CR',
            '2010',
            'Accounts Payable',
            0.00,
            v_incremental_payable,
            'Supplier liability for PO ' || v_purchase.po_number || ' (' || v_supplier.name || ')',
            'PURCHASE',
            p_purchase_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', v_new_status,
        'incremental_payable', v_incremental_payable
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.5 RPC: rpc_record_supplier_payment
-- Atomically registers supplier payment, decrements current_payable, updates purchase balance,
-- and posts balanced double-entry entries to the financial ledger.
CREATE OR REPLACE FUNCTION public.rpc_record_supplier_payment(
    p_supplier_id UUID,
    p_purchase_id UUID DEFAULT NULL,
    p_amount NUMERIC DEFAULT 0.00,
    p_payment_method VARCHAR DEFAULT 'BANK_TRANSFER',
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_reference_number VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_supplier RECORD;
    v_purchase RECORD;
    v_payment_id UUID;
    v_payment_num VARCHAR(50);
    v_new_paid NUMERIC(12,2);
    v_new_balance NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_suppliers')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have supplier payment authority.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero.';
    END IF;

    IF p_payment_method NOT IN ('CASH', 'UPI', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, BANK_TRANSFER.', p_payment_method;
    END IF;

    -- Lock supplier record FOR UPDATE
    SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_supplier_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Supplier % not found.', p_supplier_id;
    END IF;

    v_payment_num := 'SPAY-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert Supplier Payment Record
    INSERT INTO public.supplier_payments (
        payment_number,
        supplier_id,
        purchase_id,
        amount,
        payment_method,
        payment_date,
        reference_number,
        notes,
        created_by
    ) VALUES (
        v_payment_num,
        p_supplier_id,
        p_purchase_id,
        p_amount,
        p_payment_method,
        COALESCE(p_payment_date, CURRENT_DATE),
        p_reference_number,
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_payment_id;

    -- 2. Decrement supplier payable balance
    UPDATE public.suppliers
    SET current_payable = pg_catalog.greatest(0.00, current_payable - p_amount),
        updated_at = pg_catalog.now()
    WHERE id = p_supplier_id;

    -- 3. If tied to a specific purchase order, update amount_paid & balance_due
    IF p_purchase_id IS NOT NULL THEN
        SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
        IF FOUND THEN
            v_new_paid := v_purchase.amount_paid + p_amount;
            v_new_balance := pg_catalog.greatest(0.00, v_purchase.total_amount - v_new_paid);

            UPDATE public.purchases
            SET amount_paid = v_new_paid,
                balance_due = v_new_balance,
                payment_status = CASE 
                    WHEN v_new_paid >= total_amount THEN 'PAID'
                    ELSE 'PARTIALLY_PAID'
                END,
                updated_at = pg_catalog.now()
            WHERE id = p_purchase_id;
        END IF;
    END IF;

    -- 4. Balanced double-entry financial ledger posting
    -- Entry 1: Debit Accounts Payable (reduces supplier liability)
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_payment_num || '-DR',
        '2010',
        'Accounts Payable',
        p_amount,
        0.00,
        'Payment to supplier ' || v_supplier.name || ' (' || v_payment_num || ')',
        'PURCHASE',
        v_payment_id,
        v_caller_id
    );

    -- Entry 2: Credit Cash Drawer or Bank Account
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_payment_num || '-CR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        0.00,
        p_amount,
        'Disbursement for supplier payment ' || v_payment_num,
        'PURCHASE',
        v_payment_id,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'payment_number', v_payment_num,
        'amount', p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.6 RPC: rpc_record_salary_advance
-- Atomically registers a staff salary advance and writes balanced double-entry ledger impact.
CREATE OR REPLACE FUNCTION public.rpc_record_salary_advance(
    p_staff_id UUID,
    p_amount NUMERIC,
    p_payment_method VARCHAR DEFAULT 'CASH',
    p_advance_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_staff RECORD;
    v_advance_id UUID;
    v_voucher_num VARCHAR(50);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_salaries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: only owner or salary manager can disburse advances.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Advance amount must be greater than zero.';
    END IF;

    IF p_payment_method NOT IN ('CASH', 'UPI', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, BANK_TRANSFER.', p_payment_method;
    END IF;

    SELECT * INTO v_staff FROM public.profiles WHERE id = p_staff_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member % not found or inactive.', p_staff_id;
    END IF;

    v_voucher_num := 'ADV-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert Salary Advance Record
    INSERT INTO public.salary_advances (
        staff_id,
        amount,
        amount_deducted,
        payment_method,
        advance_date,
        reason,
        notes,
        is_settled,
        is_deducted,
        created_by
    ) VALUES (
        p_staff_id,
        p_amount,
        0.00,
        p_payment_method,
        COALESCE(p_advance_date, CURRENT_DATE),
        p_notes,
        p_notes,
        false,
        false,
        v_caller_id
    ) RETURNING id INTO v_advance_id;

    -- 2. Balanced Double-Entry Financial Ledger Posting
    -- Entry 1: Debit Staff Advance Receivable Asset
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-DR',
        '1310',
        'Staff Advance Receivable',
        p_amount,
        0.00,
        'Advance disbursed to ' || v_staff.full_name,
        'SALARY',
        v_advance_id,
        v_caller_id
    );

    -- Entry 2: Credit Cash Drawer or Bank Account
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-CR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        0.00,
        p_amount,
        'Disbursement of advance ' || v_voucher_num,
        'SALARY',
        v_advance_id,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'advance_id', v_advance_id,
        'voucher_number', v_voucher_num,
        'amount', p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.7 RPC: rpc_record_salary_payment
-- Supports legitimate partial salary payments within the same month.
-- Deducts salary advances accurately via FIFO row-locking without blanket settlement.
-- Enforces idempotency, locks outstanding advances, and writes balanced double-entry postings.
CREATE OR REPLACE FUNCTION public.rpc_record_salary_payment(
    p_staff_id UUID,
    p_period_month VARCHAR,
    p_base_salary NUMERIC,
    p_advance_deducted NUMERIC,
    p_other_deductions NUMERIC,
    p_amount_paid NUMERIC,
    p_payment_method VARCHAR,
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL,
    p_idempotency_key VARCHAR DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_staff RECORD;
    v_payment_id UUID;
    v_voucher_num VARCHAR(50);
    v_prev_paid NUMERIC(12,2) := 0.00;
    v_prev_adv NUMERIC(12,2) := 0.00;
    v_prev_other NUMERIC(12,2) := 0.00;
    v_total_settled_so_far NUMERIC(12,2) := 0.00;
    v_outstanding_payable NUMERIC(12,2) := 0.00;
    v_avail_advances NUMERIC(12,2) := 0.00;
    v_rem_adv_to_deduct NUMERIC(12,2);
    v_adv RECORD;
    v_rem_on_adv NUMERIC(12,2);
    v_deduct_this NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_salaries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: only owner or authorized salary manager can disburse salaries.';
    END IF;

    SELECT * INTO v_staff FROM public.profiles WHERE id = p_staff_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found or inactive.';
    END IF;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, voucher_number, amount_paid, net_payable INTO v_payment_id, v_voucher_num, p_amount_paid, v_outstanding_payable
        FROM public.salary_payments
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'payment_id', v_payment_id,
                'voucher_number', v_voucher_num,
                'amount_paid', p_amount_paid,
                'net_payable', v_outstanding_payable
            );
        END IF;
    END IF;

    IF p_amount_paid <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero.';
    END IF;
    IF p_advance_deducted < 0 OR p_other_deductions < 0 THEN
        RAISE EXCEPTION 'Deductions cannot be negative.';
    END IF;
    IF p_payment_method NOT IN ('CASH', 'UPI', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, BANK_TRANSFER.', p_payment_method;
    END IF;

    -- Calculate total previously settled for this period to support partial payments
    SELECT 
        COALESCE(SUM(amount_paid), 0.00),
        COALESCE(SUM(advance_deducted), 0.00),
        COALESCE(SUM(other_deductions), 0.00)
    INTO v_prev_paid, v_prev_adv, v_prev_other
    FROM public.salary_payments
    WHERE staff_id = p_staff_id AND period_month = p_period_month;

    v_total_settled_so_far := v_prev_paid + v_prev_adv + v_prev_other;
    v_outstanding_payable := pg_catalog.greatest(0.00, p_base_salary - v_total_settled_so_far);

    IF (p_amount_paid + p_advance_deducted + p_other_deductions) > v_outstanding_payable THEN
        RAISE EXCEPTION 'Total disbursement and deductions (%) exceed remaining salary payable (%) for period %.',
            (p_amount_paid + p_advance_deducted + p_other_deductions), v_outstanding_payable, p_period_month;
    END IF;

    -- Validate and allocate advance deductions using FIFO row locking
    IF p_advance_deducted > 0 THEN
        SELECT COALESCE(SUM(amount - amount_deducted), 0.00) INTO v_avail_advances
        FROM public.salary_advances
        WHERE staff_id = p_staff_id AND is_settled = false;

        IF p_advance_deducted > v_avail_advances THEN
            RAISE EXCEPTION 'Requested advance deduction (%) exceeds total outstanding advances (%).',
                p_advance_deducted, v_avail_advances;
        END IF;
    END IF;

    v_voucher_num := 'SAL-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert Salary Payment Record
    INSERT INTO public.salary_payments (
        voucher_number,
        staff_id,
        period_month,
        base_salary,
        advance_deducted,
        other_deductions,
        net_payable,
        amount_paid,
        net_paid,
        payment_method,
        payment_date,
        notes,
        idempotency_key,
        created_by
    ) VALUES (
        v_voucher_num,
        p_staff_id,
        p_period_month,
        p_base_salary,
        p_advance_deducted,
        p_other_deductions,
        v_outstanding_payable,
        p_amount_paid,
        p_amount_paid,
        p_payment_method,
        COALESCE(p_payment_date, CURRENT_DATE),
        p_notes,
        p_idempotency_key,
        v_caller_id
    ) RETURNING id INTO v_payment_id;

    -- 2. Systematically deduct from advances (FIFO)
    IF p_advance_deducted > 0 THEN
        v_rem_adv_to_deduct := p_advance_deducted;

        FOR v_adv IN 
            SELECT id, amount, amount_deducted
            FROM public.salary_advances
            WHERE staff_id = p_staff_id AND is_settled = false
            ORDER BY advance_date ASC, created_at ASC
            FOR UPDATE
        LOOP
            v_rem_on_adv := v_adv.amount - v_adv.amount_deducted;
            v_deduct_this := pg_catalog.least(v_rem_adv_to_deduct, v_rem_on_adv);

            UPDATE public.salary_advances
            SET amount_deducted = amount_deducted + v_deduct_this,
                is_settled = ((amount_deducted + v_deduct_this) >= amount),
                is_deducted = true,
                deducted_in_payment_id = v_payment_id
            WHERE id = v_adv.id;

            v_rem_adv_to_deduct := v_rem_adv_to_deduct - v_deduct_this;
            EXIT WHEN v_rem_adv_to_deduct <= 0;
        END LOOP;
    END IF;

    -- 3. Balanced Dual-Entry Financial Ledger Posting
    -- Entry 1: Debit Staff Salary Expense (Gross compensation recognized in this disbursement)
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-DR',
        '6020',
        'Staff Salary Expense',
        (p_amount_paid + p_advance_deducted),
        0.00,
        'Salary disbursement for ' || v_staff.full_name || ' (' || p_period_month || ')',
        'SALARY',
        v_payment_id,
        v_caller_id
    );

    -- Entry 2: Credit Cash Drawer or Bank Account for cash disbursed
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-CR-CASH',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        0.00,
        p_amount_paid,
        'Net payment to ' || v_staff.full_name,
        'SALARY',
        v_payment_id,
        v_caller_id
    );

    -- Entry 3: Credit Staff Advance Receivable for advance deduction (clears asset)
    IF p_advance_deducted > 0 THEN
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_voucher_num || '-CR-ADV',
            '1310',
            'Staff Advance Receivable',
            0.00,
            p_advance_deducted,
            'Advance recovery for ' || v_staff.full_name,
            'SALARY',
            v_payment_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'voucher_number', v_voucher_num,
        'amount_paid', p_amount_paid,
        'advance_deducted', p_advance_deducted,
        'net_payable', (v_outstanding_payable - (p_amount_paid + p_advance_deducted + p_other_deductions))
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.8 RPC: rpc_reverse_financial_entry
-- Multi-line atomic journal reversal. Reverses ALL debit and credit lines of the complete
-- journal transaction together, maintaining double-entry balance. Rejects already reversed entries.
CREATE OR REPLACE FUNCTION public.rpc_reverse_financial_entry(
    p_entry_id UUID,
    p_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_orig RECORD;
    v_line RECORD;
    v_batch_ref_type VARCHAR(30);
    v_batch_ref_id UUID;
    v_total_dr NUMERIC(12,2) := 0.00;
    v_total_cr NUMERIC(12,2) := 0.00;
    v_reversal_count INT := 0;
    v_new_rev_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    IF v_caller_role != 'owner' THEN
        RAISE EXCEPTION 'Access denied: only the business owner can reverse posted financial entries.';
    END IF;

    IF p_reason IS NULL OR pg_catalog.length(pg_catalog.trim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'Reversal reason is required.';
    END IF;

    -- Lock target entry FOR UPDATE
    SELECT * INTO v_orig FROM public.financial_ledger WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Financial entry not found: %', p_entry_id;
    END IF;

    IF v_orig.is_reversal = true OR v_orig.reference_type = 'REVERSAL' THEN
        RAISE EXCEPTION 'Cannot reverse an entry that is already a reversal.';
    END IF;

    IF v_orig.reversed_entry_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.financial_ledger 
        WHERE reversed_entry_id = v_orig.id OR (reference_type = 'REVERSAL' AND reference_id = v_orig.id)
    ) THEN
        RAISE EXCEPTION 'This transaction has already been reversed.';
    END IF;

    v_batch_ref_type := v_orig.reference_type;
    v_batch_ref_id := v_orig.reference_id;

    -- Validate that complete original journal is balanced
    IF v_batch_ref_id IS NOT NULL THEN
        SELECT COALESCE(SUM(debit), 0.00), COALESCE(SUM(credit), 0.00)
        INTO v_total_dr, v_total_cr
        FROM public.financial_ledger
        WHERE reference_type = v_batch_ref_type 
          AND reference_id = v_batch_ref_id 
          AND is_reversal = false;
    ELSE
        v_total_dr := v_orig.debit;
        v_total_cr := v_orig.credit;
    END IF;

    IF v_total_dr != v_total_cr THEN
        RAISE EXCEPTION 'Original journal transaction is unbalanced (Debits: %, Credits: %); cannot reverse partially.',
            v_total_dr, v_total_cr;
    END IF;

    -- Reverse every debit and credit line in the journal transaction atomically
    IF v_batch_ref_id IS NOT NULL THEN
        FOR v_line IN 
            SELECT * FROM public.financial_ledger
            WHERE reference_type = v_batch_ref_type 
              AND reference_id = v_batch_ref_id 
              AND is_reversal = false
            FOR UPDATE
        LOOP
            INSERT INTO public.financial_ledger (
                entry_number,
                account_code,
                account_name,
                debit,
                credit,
                description,
                reference_type,
                reference_id,
                is_reversal,
                reversed_entry_id,
                created_by
            ) VALUES (
                'REV-' || v_line.entry_number || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 4),
                v_line.account_code,
                v_line.account_name,
                v_line.credit, -- Swapped debit/credit
                v_line.debit,
                'REVERSAL: ' || v_line.description || ' (Reason: ' || p_reason || ')',
                'REVERSAL',
                v_line.id,
                true,
                v_line.id,
                v_caller_id
            ) RETURNING id INTO v_new_rev_id;

            UPDATE public.financial_ledger
            SET reversed_entry_id = v_new_rev_id
            WHERE id = v_line.id;

            v_reversal_count := v_reversal_count + 1;
        END LOOP;
    ELSE
        -- Single entry reversal if reference_id is null
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            is_reversal,
            reversed_entry_id,
            created_by
        ) VALUES (
            'REV-' || v_orig.entry_number || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 4),
            v_orig.account_code,
            v_orig.account_name,
            v_orig.credit,
            v_orig.debit,
            'REVERSAL: ' || v_orig.description || ' (Reason: ' || p_reason || ')',
            'REVERSAL',
            v_orig.id,
            true,
            v_orig.id,
            v_caller_id
        ) RETURNING id INTO v_new_rev_id;

        UPDATE public.financial_ledger
        SET reversed_entry_id = v_new_rev_id
        WHERE id = v_orig.id;

        v_reversal_count := 1;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'reversed_lines_count', v_reversal_count,
        'total_reversed_amount', v_total_dr,
        'target_entry_id', p_entry_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- 5. FUNCTION EXECUTION PRIVILEGES (Revoke from PUBLIC/anon; Grant authenticated/service_role)
-- ==============================================================================

REVOKE ALL ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_complete_pos_sale(JSONB, VARCHAR, NUMERIC, NUMERIC, VARCHAR, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_create_purchase_order(UUID, DATE, VARCHAR, VARCHAR, JSONB, TEXT, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_receive_purchase_order(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_supplier_payment(UUID, UUID, NUMERIC, VARCHAR, DATE, VARCHAR, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_salary_advance(UUID, NUMERIC, VARCHAR, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_salary_payment(UUID, VARCHAR, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_expense(VARCHAR, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_adjust_inventory_stock(UUID, INT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_reverse_financial_entry(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_complete_pos_sale(JSONB, VARCHAR, NUMERIC, NUMERIC, VARCHAR, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_purchase_order(UUID, DATE, VARCHAR, VARCHAR, JSONB, TEXT, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_receive_purchase_order(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_supplier_payment(UUID, UUID, NUMERIC, VARCHAR, DATE, VARCHAR, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_salary_advance(UUID, NUMERIC, VARCHAR, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_salary_payment(UUID, VARCHAR, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_expense(VARCHAR, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_adjust_inventory_stock(UUID, INT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reverse_financial_entry(UUID, TEXT) TO authenticated, service_role;
-- ==============================================================================
-- AquaTrack ERP — Migration: Remediation Round 3
-- Version: 20261104000001_remediation_round_3.sql
-- Description:
--   1. Customer & Supplier privileged field protection triggers (preventing
--      direct manipulation of financial balances and jar holdings by staff).
--   2. Elimination of direct database write bypasses across purchases, jar custody,
--      orders, delivery stops, payments, and financial tables.
--   3. Introduction of atomic rpc_create_customer_with_location, rpc_create_customer_order,
--      and rpc_record_jar_movement.
--   4. Hardened rpc_execute_delivery_stop with cumulative delivered quantity
--      and remaining order balance validation, preventing over-delivery/overpayment.
--   5. Hardened rpc_record_salary_payment enforcing authoritative database salary
--      from public.profiles, row-locking (FOR UPDATE), and concurrent overpayment prevention.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PRIVILEGED COLUMN PROTECTION TRIGGERS (CUSTOMERS & SUPPLIERS)
-- ------------------------------------------------------------------------------

-- 1.1 Customer Privileged Field Protection Trigger Function
CREATE OR REPLACE FUNCTION public.check_customer_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Allow internal security-definer RPC functions that explicitly set the context
    IF pg_catalog.current_setting('app.internal_rpc_context', true) = 'true' THEN
        RETURN NEW;
    END IF;

    -- Allow postgres superuser or service_role or owner to perform administrative overrides
    IF current_user IN ('postgres', 'service_role') OR public.get_user_role() = 'owner' THEN
        RETURN NEW;
    END IF;

    -- For ordinary authenticated staff, enforce strict field protection
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
           (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
           (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
           (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
           (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
            RAISE EXCEPTION 'Access Denied: Customer financial balances and jar holdings cannot be directly modified. Use approved transactional workflows.';
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        IF (NEW.current_balance IS DISTINCT FROM 0.00) OR
           (NEW.total_full_jars_holding IS DISTINCT FROM 0) OR
           (NEW.total_empty_jars_holding IS DISTINCT FROM 0) OR
           (NEW.total_damaged_jars_holding IS DISTINCT FROM 0) OR
           (NEW.total_deposit_held IS DISTINCT FROM 0.00) THEN
            RAISE EXCEPTION 'Access Denied: New customer records must initialize with zero financial balances and jar holdings.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_customer_privileged_fields ON public.customers;
CREATE TRIGGER trg_protect_customer_privileged_fields
    BEFORE INSERT OR UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_customer_privileged_updates();

-- 1.2 Supplier Privileged Field Protection Trigger Function
CREATE OR REPLACE FUNCTION public.check_supplier_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF pg_catalog.current_setting('app.internal_rpc_context', true) = 'true' THEN
        RETURN NEW;
    END IF;

    IF current_user IN ('postgres', 'service_role') OR public.get_user_role() = 'owner' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) OR
           (NEW.jars_in_custody IS DISTINCT FROM OLD.jars_in_custody) THEN
            RAISE EXCEPTION 'Access Denied: Supplier payables and jar custody cannot be directly modified. Use approved purchase and payment workflows.';
        END IF;
    ELSIF TG_OP = 'INSERT' THEN
        IF (NEW.current_payable IS DISTINCT FROM 0.00) OR
           (NEW.jars_in_custody IS DISTINCT FROM 0) THEN
            RAISE EXCEPTION 'Access Denied: New supplier records must initialize with zero payable and custody.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_supplier_privileged_fields ON public.suppliers;
CREATE TRIGGER trg_protect_supplier_privileged_fields
    BEFORE INSERT OR UPDATE ON public.suppliers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_supplier_privileged_updates();

-- ------------------------------------------------------------------------------
-- 2. ELIMINATE DIRECT DATABASE WRITE BYPASSES (RLS OVERHAUL)
-- ------------------------------------------------------------------------------

-- 2.1 Purchases & Purchase Items: Staff must use rpc_create_purchase_order and rpc_receive_purchase_order
DROP POLICY IF EXISTS purch_all ON public.purchases;
DROP POLICY IF EXISTS purch_select ON public.purchases;
DROP POLICY IF EXISTS purch_owner_modify ON public.purchases;

CREATE POLICY purch_select ON public.purchases FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true OR
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true
        )
    );

CREATE POLICY purch_owner_modify ON public.purchases FOR ALL TO authenticated
    USING (public.is_active_user() AND public.get_user_role() = 'owner')
    WITH CHECK (public.is_active_user() AND public.get_user_role() = 'owner');

DROP POLICY IF EXISTS purch_items_all ON public.purchase_items;
DROP POLICY IF EXISTS purch_items_select ON public.purchase_items;
DROP POLICY IF EXISTS purch_items_owner_modify ON public.purchase_items;

CREATE POLICY purch_items_select ON public.purchase_items FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true OR
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true
        )
    );

CREATE POLICY purch_items_owner_modify ON public.purchase_items FOR ALL TO authenticated
    USING (public.is_active_user() AND public.get_user_role() = 'owner')
    WITH CHECK (public.is_active_user() AND public.get_user_role() = 'owner');

-- 2.2 Jar Custody Movements: Staff must use rpc_record_jar_movement or delivery/receipt RPCs
DROP POLICY IF EXISTS jcm_insert ON public.jar_custody_movements;
DROP POLICY IF EXISTS jcm_select ON public.jar_custody_movements;
DROP POLICY IF EXISTS jcm_owner_insert ON public.jar_custody_movements;

CREATE POLICY jcm_select ON public.jar_custody_movements FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true OR
            (public.get_staff_permissions()->>'can_deliveries')::boolean = true
        )
    );

CREATE POLICY jcm_owner_insert ON public.jar_custody_movements FOR INSERT TO authenticated
    WITH CHECK (public.is_active_user() AND public.get_user_role() = 'owner');

-- ------------------------------------------------------------------------------
-- 3. ATOMIC MASTER DATA & MOVEMENT RPCS
-- ------------------------------------------------------------------------------

-- 3.1 RPC: rpc_create_customer_with_location
-- Atomically creates a custody location and corresponding customer record
CREATE OR REPLACE FUNCTION public.rpc_create_customer_with_location(
    p_customer_type VARCHAR,
    p_contact_name VARCHAR,
    p_phone VARCHAR,
    p_address TEXT,
    p_business_name VARCHAR DEFAULT NULL,
    p_email VARCHAR DEFAULT NULL,
    p_delivery_instructions TEXT DEFAULT NULL,
    p_gstin VARCHAR DEFAULT NULL,
    p_credit_limit NUMERIC DEFAULT 0.00,
    p_max_jar_limit INTEGER DEFAULT 5,
    p_payment_terms_days INTEGER DEFAULT 0,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_location_id UUID;
    v_customer_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_customers')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have customer management authority.';
    END IF;

    IF p_customer_type NOT IN ('B2C', 'B2B') THEN
        RAISE EXCEPTION 'Invalid customer type: %. Allowed values are B2C, B2B.', p_customer_type;
    END IF;

    IF p_contact_name IS NULL OR pg_catalog.length(pg_catalog.trim(p_contact_name)) = 0 THEN
        RAISE EXCEPTION 'Contact name is required.';
    END IF;

    IF p_phone IS NULL OR pg_catalog.length(pg_catalog.trim(p_phone)) = 0 THEN
        RAISE EXCEPTION 'Phone number is required.';
    END IF;

    IF p_address IS NULL OR pg_catalog.length(pg_catalog.trim(p_address)) = 0 THEN
        RAISE EXCEPTION 'Address is required.';
    END IF;

    -- 1. Create Location record
    INSERT INTO public.locations (
        name,
        location_type,
        address
    ) VALUES (
        COALESCE(p_business_name, p_contact_name),
        'CUSTOMER',
        p_address
    ) RETURNING id INTO v_location_id;

    -- 2. Create Customer record with zero initial balances
    INSERT INTO public.customers (
        location_id,
        customer_type,
        business_name,
        contact_name,
        phone,
        email,
        address,
        delivery_instructions,
        gstin,
        credit_limit,
        max_jar_limit,
        payment_terms_days,
        current_balance,
        total_full_jars_holding,
        total_empty_jars_holding,
        total_damaged_jars_holding,
        total_deposit_held,
        notes
    ) VALUES (
        v_location_id,
        p_customer_type,
        p_business_name,
        p_contact_name,
        p_phone,
        p_email,
        p_address,
        p_delivery_instructions,
        p_gstin,
        COALESCE(p_credit_limit, 0.00),
        COALESCE(p_max_jar_limit, 5),
        COALESCE(p_payment_terms_days, 0),
        0.00,
        0,
        0,
        0,
        0.00,
        p_notes
    ) RETURNING id INTO v_customer_id;

    RETURN v_customer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_create_customer_with_location(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, VARCHAR, NUMERIC, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_customer_with_location(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, VARCHAR, NUMERIC, INTEGER, INTEGER, TEXT) TO authenticated, service_role;

-- 3.2 RPC: rpc_record_jar_movement
-- Validated, audited jar movement recording for warehouse adjustments, sanitization, and returns
CREATE OR REPLACE FUNCTION public.rpc_record_jar_movement(
    p_source_location_id UUID,
    p_destination_location_id UUID,
    p_condition_from VARCHAR,
    p_condition_to VARCHAR,
    p_quantity INT,
    p_movement_type VARCHAR,
    p_reference_type VARCHAR DEFAULT 'MANUAL',
    p_reference_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_jar_product_id UUID;
    v_movement_id UUID;
    v_default_wh_id UUID;
    v_wh_location_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_warehouse')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have warehouse management authority.';
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero.';
    END IF;

    -- Resolve reusable jar product
    SELECT id INTO v_jar_product_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_jar_product_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;

    -- Resolve warehouse location
    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id FROM public.warehouses WHERE is_default = true LIMIT 1;

    -- Insert immutable jar movement
    INSERT INTO public.jar_custody_movements (
        product_id,
        source_location_id,
        destination_location_id,
        condition_from,
        condition_to,
        quantity,
        movement_type,
        reference_type,
        reference_id,
        notes,
        created_by
    ) VALUES (
        v_jar_product_id,
        p_source_location_id,
        p_destination_location_id,
        p_condition_from,
        p_condition_to,
        p_quantity,
        p_movement_type,
        COALESCE(p_reference_type, 'MANUAL'),
        p_reference_id,
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_movement_id;

    -- If sanitized to FULL_USABLE in central warehouse, update warehouse inventory balance
    IF p_destination_location_id = v_wh_location_id AND p_condition_to = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
        INSERT INTO public.inventory_balances (
            warehouse_id,
            product_id,
            quantity_on_hand,
            updated_at
        ) VALUES (
            v_default_wh_id,
            v_jar_product_id,
            p_quantity,
            pg_catalog.now()
        )
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET
            quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
            updated_at = pg_catalog.now();

        INSERT INTO public.stock_movements (
            warehouse_id,
            product_id,
            movement_type,
            quantity,
            reference_type,
            reference_id,
            source_location_id,
            destination_location_id,
            created_by
        ) VALUES (
            v_default_wh_id,
            v_jar_product_id,
            'JAR_SANITIZATION',
            p_quantity,
            'JAR_MOVEMENT',
            v_movement_id,
            p_source_location_id,
            p_destination_location_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'movement_id', v_movement_id,
        'quantity', p_quantity,
        'movement_type', p_movement_type
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_record_jar_movement(UUID, UUID, VARCHAR, VARCHAR, INT, VARCHAR, VARCHAR, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_record_jar_movement(UUID, UUID, VARCHAR, VARCHAR, INT, VARCHAR, VARCHAR, UUID, TEXT) TO authenticated, service_role;

-- 3.3 RPC: rpc_create_customer_order
-- Fully atomic order creation, line items insertion, delivery stop creation,
-- accrual invoice generation, and customer balance adjustment.
CREATE OR REPLACE FUNCTION public.rpc_create_customer_order(
    p_customer_id UUID,
    p_delivery_address TEXT,
    p_delivery_date DATE,
    p_assigned_staff_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_customer RECORD;
    v_order_id UUID;
    v_order_num VARCHAR(50);
    v_invoice_id UUID;
    v_invoice_num VARCHAR(50);
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
    v_item RECORD;
    v_product RECORD;
    v_item_subtotal NUMERIC(12,2);
    v_item_tax NUMERIC(12,2);
    v_item_total NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_orders')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have order creation authority.';
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order items array cannot be empty.';
    END IF;

    -- Lock customer record FOR UPDATE
    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found or inactive.';
    END IF;

    -- Calculate order totals using authoritative product prices
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity INT, unit_price NUMERIC, gst_rate NUMERIC)
    LOOP
        IF v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be greater than zero.';
        END IF;

        SELECT id, name, price, gst_rate INTO v_product
        FROM public.products
        WHERE id = v_item.product_id AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found or inactive.', v_item.product_id;
        END IF;

        -- Use authoritative product price unless custom negotiated price provided
        v_item_subtotal := COALESCE(v_item.unit_price, v_product.price) * v_item.quantity;
        v_item_tax := pg_catalog.round(v_item_subtotal * (COALESCE(v_item.gst_rate, v_product.gst_rate) / 100.0), 2);
        v_item_total := v_item_subtotal + v_item_tax;

        v_subtotal := v_subtotal + v_item_subtotal;
        v_tax_total := v_tax_total + v_item_tax;
    END LOOP;

    v_total_amount := v_subtotal + v_tax_total;
    v_order_num := 'ORD-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert master order
    INSERT INTO public.orders (
        order_number,
        customer_id,
        delivery_address,
        delivery_date,
        assigned_staff_id,
        status,
        payment_status,
        subtotal,
        tax_total,
        total_amount,
        notes,
        created_by
    ) VALUES (
        v_order_num,
        p_customer_id,
        COALESCE(p_delivery_address, v_customer.address),
        COALESCE(p_delivery_date, CURRENT_DATE),
        p_assigned_staff_id,
        CASE WHEN p_assigned_staff_id IS NOT NULL THEN 'ASSIGNED' ELSE 'PENDING' END,
        'UNPAID',
        v_subtotal,
        v_tax_total,
        v_total_amount,
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_order_id;

    -- 2. Insert line items
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity INT, unit_price NUMERIC, gst_rate NUMERIC)
    LOOP
        SELECT price, gst_rate INTO v_product FROM public.products WHERE id = v_item.product_id;
        v_item_subtotal := COALESCE(v_item.unit_price, v_product.price) * v_item.quantity;
        v_item_tax := pg_catalog.round(v_item_subtotal * (COALESCE(v_item.gst_rate, v_product.gst_rate) / 100.0), 2);
        v_item_total := v_item_subtotal + v_item_tax;

        INSERT INTO public.order_items (
            order_id,
            product_id,
            quantity,
            unit_price,
            tax_rate,
            tax_amount,
            total_amount
        ) VALUES (
            v_order_id,
            v_item.product_id,
            v_item.quantity,
            COALESCE(v_item.unit_price, v_product.price),
            COALESCE(v_item.gst_rate, v_product.gst_rate),
            v_item_tax,
            v_item_total
        );
    END LOOP;

    -- 3. Create delivery stop if assigned to staff
    IF p_assigned_staff_id IS NOT NULL THEN
        INSERT INTO public.delivery_stops (
            order_id,
            assigned_staff_id,
            sequence_number,
            status
        ) VALUES (
            v_order_id,
            p_assigned_staff_id,
            1,
            'ASSIGNED'
        );
    END IF;

    -- 4. Create Accrual Invoice
    v_invoice_num := 'INV-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);
    INSERT INTO public.invoices (
        invoice_number,
        order_id,
        customer_id,
        subtotal,
        tax_amount,
        total_amount,
        balance_due,
        status,
        invoice_date,
        created_by
    ) VALUES (
        v_invoice_num,
        v_order_id,
        p_customer_id,
        v_subtotal,
        v_tax_total,
        v_total_amount,
        v_total_amount,
        'UNPAID',
        CURRENT_DATE,
        v_caller_id
    ) RETURNING id INTO v_invoice_id;

    -- 5. Set internal RPC context and increment customer balance
    PERFORM pg_catalog.set_config('app.internal_rpc_context', 'true', true);

    UPDATE public.customers
    SET current_balance = current_balance + v_total_amount,
        updated_at = pg_catalog.now()
    WHERE id = p_customer_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'order_number', v_order_num,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_num,
        'total_amount', v_total_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. HARDENED DELIVERY STOP EXECUTION (MULTI-STOP & REMAINING QUANTITY/PAYMENT)
-- ------------------------------------------------------------------------------

-- Hardened rpc_execute_delivery_stop:
-- Strictly calculates cumulative delivered quantity across previous completed stops
-- and validates against remaining order quantity.
-- Strictly calculates cumulative payments across previous completed stops
-- and validates against remaining order balance.
-- Enforces physical jar custody conservation without clamping.
CREATE OR REPLACE FUNCTION public.rpc_execute_delivery_stop(
    p_stop_id UUID,
    p_actual_delivered INT,
    p_empty_jars INT,
    p_damaged_jars INT,
    p_payment_amount NUMERIC DEFAULT 0.00,
    p_payment_method VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_stop RECORD;
    v_order RECORD;
    v_customer RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_perms JSONB;
    v_payment_num VARCHAR(50);
    v_default_wh UUID;
    v_wh_location UUID;
    v_default_jar_id UUID;
    v_total_ordered_qty INT := 0;
    v_previously_delivered_qty INT := 0;
    v_remaining_ordered_qty INT := 0;
    v_new_cumulative_delivered INT := 0;
    v_previously_paid_amount NUMERIC(12,2) := 0.00;
    v_remaining_order_balance NUMERIC(12,2) := 0.00;
    v_new_cumulative_paid NUMERIC(12,2) := 0.00;
    v_current_total_custody INT := 0;
    v_total_returning INT := 0;
    v_new_full_holding INT := 0;
    v_new_empty_holding INT := 0;
    v_new_damaged_holding INT := 0;
    v_new_order_status VARCHAR(30);
    v_new_payment_status VARCHAR(20);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_deliveries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have delivery execution authority.';
    END IF;

    -- Validate input non-negativity
    IF p_actual_delivered < 0 OR p_empty_jars < 0 OR p_damaged_jars < 0 THEN
        RAISE EXCEPTION 'Quantities cannot be negative.';
    END IF;
    IF p_payment_amount < 0 THEN
        RAISE EXCEPTION 'Payment amount cannot be negative.';
    END IF;

    -- Lock delivery stop row FOR UPDATE
    SELECT * INTO v_stop FROM public.delivery_stops WHERE id = p_stop_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop not found: %', p_stop_id;
    END IF;

    -- Verify assignment: assigned staff can only execute their own stops
    IF v_caller_role != 'owner' AND v_stop.assigned_staff_id != v_caller_id THEN
        RAISE EXCEPTION 'Access denied: staff can only execute stops assigned to them.';
    END IF;

    -- Idempotency check: if already completed, return existing status
    IF v_stop.status = 'COMPLETED' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', 'ALREADY_COMPLETED'
        );
    END IF;

    IF v_stop.status NOT IN ('ASSIGNED', 'EN_ROUTE', 'PENDING') THEN
        RAISE EXCEPTION 'Delivery stop cannot be executed in "%" status.', v_stop.status;
    END IF;

    -- Handle explicit failure report
    IF p_failure_reason IS NOT NULL AND p_actual_delivered = 0 THEN
        UPDATE public.delivery_stops
        SET status = 'FAILED',
            failure_reason = p_failure_reason,
            executed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_stop_id;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'FAILED');
    END IF;

    -- Lock order and customer records FOR UPDATE
    SELECT * INTO v_order FROM public.orders WHERE id = v_stop.order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent order % not found.', v_stop.order_id;
    END IF;

    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer % not found.', v_order.customer_id;
    END IF;

    -- 1. Calculate actual remaining ordered quantity across previous deliveries
    SELECT COALESCE(SUM(quantity), 0) INTO v_total_ordered_qty
    FROM public.order_items WHERE order_id = v_order.id;

    SELECT COALESCE(SUM(actual_delivered_quantity), 0) INTO v_previously_delivered_qty
    FROM public.delivery_stops
    WHERE order_id = v_order.id AND status = 'COMPLETED' AND id != p_stop_id;

    v_remaining_ordered_qty := v_total_ordered_qty - v_previously_delivered_qty;

    IF p_actual_delivered > v_remaining_ordered_qty THEN
        RAISE EXCEPTION 'Delivered quantity (%) exceeds remaining order quantity (%). Total ordered: %, previously delivered: %.',
            p_actual_delivered, v_remaining_ordered_qty, v_total_ordered_qty, v_previously_delivered_qty;
    END IF;

    -- 2. Validate payment against actual remaining balance after previous payments
    SELECT COALESCE(SUM(payment_collected), 0.00) INTO v_previously_paid_amount
    FROM public.delivery_stops
    WHERE order_id = v_order.id AND status = 'COMPLETED' AND id != p_stop_id;

    v_remaining_order_balance := pg_catalog.greatest(0.00, v_order.total_amount - v_previously_paid_amount);

    IF p_payment_amount > 0 THEN
        IF p_payment_method IS NULL OR p_payment_method NOT IN ('CASH', 'UPI', 'CREDIT') THEN
            RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, CREDIT.', p_payment_method;
        END IF;
        IF p_payment_method = 'CREDIT' THEN
            RAISE EXCEPTION 'Payment amount cannot be positive when payment method is CREDIT.';
        END IF;
        IF p_payment_amount > v_remaining_order_balance THEN
            RAISE EXCEPTION 'Payment amount (%) exceeds outstanding order balance (%). Order total: %, previously paid: %.',
                p_payment_amount, v_remaining_order_balance, v_order.total_amount, v_previously_paid_amount;
        END IF;
    END IF;

    -- Resolve required custody entities
    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    SELECT id INTO v_default_jar_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;

    IF v_default_jar_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;
    IF v_wh_location IS NULL THEN
        RAISE EXCEPTION 'Central warehouse location is not configured.';
    END IF;
    IF v_customer.location_id IS NULL THEN
        RAISE EXCEPTION 'Customer physical location is not configured.';
    END IF;

    -- 3. Physical Jar Custody Conservation & Validation
    v_current_total_custody := v_customer.total_full_jars_holding + v_customer.total_empty_jars_holding + COALESCE(v_customer.total_damaged_jars_holding, 0);
    v_total_returning := p_empty_jars + p_damaged_jars;

    IF v_total_returning > v_current_total_custody THEN
        RAISE EXCEPTION 'Invalid physical return: customer holds % jars, but attempted to return % jars.',
            v_current_total_custody, v_total_returning;
    END IF;

    -- Customer full holding increases with fresh drops
    v_new_full_holding := v_customer.total_full_jars_holding + p_actual_delivered;

    -- Empty/damaged jars returned deduct from customer custody
    IF v_customer.total_empty_jars_holding >= p_empty_jars THEN
        v_new_empty_holding := v_customer.total_empty_jars_holding - p_empty_jars;
    ELSE
        -- Emptied full jars returned
        v_new_full_holding := v_new_full_holding - (p_empty_jars - v_customer.total_empty_jars_holding);
        v_new_empty_holding := 0;
    END IF;

    -- Damaged jars deduction
    v_new_damaged_holding := COALESCE(v_customer.total_damaged_jars_holding, 0);
    IF p_damaged_jars > 0 THEN
        IF v_new_damaged_holding >= p_damaged_jars THEN
            v_new_damaged_holding := v_new_damaged_holding - p_damaged_jars;
        ELSE
            -- Damaged during customer usage: deduct remainder from empty/full holding
            DECLARE
                v_excess_dmg INT := p_damaged_jars - v_new_damaged_holding;
            BEGIN
                v_new_damaged_holding := 0;
                IF v_new_empty_holding >= v_excess_dmg THEN
                    v_new_empty_holding := v_new_empty_holding - v_excess_dmg;
                ELSE
                    v_new_full_holding := v_new_full_holding - (v_excess_dmg - v_new_empty_holding);
                    v_new_empty_holding := 0;
                END IF;
            END;
        END IF;
    END IF;

    IF v_new_full_holding < 0 OR v_new_empty_holding < 0 THEN
        RAISE EXCEPTION 'Physical custody violation: customer jar holding cannot become negative (full: %, empty: %).',
            v_new_full_holding, v_new_empty_holding;
    END IF;

    -- Set internal RPC context so trigger permits customer balance and holding updates
    PERFORM pg_catalog.set_config('app.internal_rpc_context', 'true', true);

    -- Update customer holdings atomically
    UPDATE public.customers
    SET total_full_jars_holding = v_new_full_holding,
        total_empty_jars_holding = v_new_empty_holding,
        total_damaged_jars_holding = v_new_damaged_holding,
        updated_at = pg_catalog.now()
    WHERE id = v_customer.id;

    -- 4. Log Immutable Jar Custody Movements
    IF p_actual_delivered > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_wh_location,
            v_customer.location_id,
            'FULL_USABLE',
            'FULL_USABLE',
            p_actual_delivered,
            'CUSTOMER_DELIVERY',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    IF p_empty_jars > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_customer.location_id,
            v_wh_location,
            'EMPTY_DIRTY',
            'EMPTY_DIRTY',
            p_empty_jars,
            'CUSTOMER_EMPTY_RETURN',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    IF p_damaged_jars > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_customer.location_id,
            v_wh_location,
            'DAMAGED_REPAIRABLE',
            'DAMAGED_REPAIRABLE',
            p_damaged_jars,
            'DAMAGED_COLLECTED',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    -- 5. Payment Processing & Balanced Financial Ledger Entry
    IF p_payment_amount > 0 THEN
        v_payment_num := 'PAY-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || pg_catalog.substr(p_stop_id::text, 1, 6);

        INSERT INTO public.customer_payments (
            payment_number,
            customer_id,
            order_id,
            amount,
            payment_method,
            collected_by_staff_id,
            notes
        ) VALUES (
            v_payment_num,
            v_customer.id,
            v_order.id,
            p_payment_amount,
            p_payment_method,
            v_caller_id,
            'Route stop payment'
        );

        UPDATE public.customers
        SET current_balance = current_balance - p_payment_amount,
            updated_at = pg_catalog.now()
        WHERE id = v_customer.id;

        -- Balanced dual-entry posting
        -- Entry 1: Debit Cash Float with Driver (or Bank Current Account if UPI)
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_payment_num || '-DR',
            CASE WHEN p_payment_method = 'UPI' THEN '1020' ELSE '1015' END,
            CASE WHEN p_payment_method = 'UPI' THEN 'Bank Current Account' ELSE 'Cash Float with Driver' END,
            p_payment_amount,
            0.00,
            'Route collection from ' || v_customer.contact_name,
            'PAYMENT',
            p_stop_id,
            v_caller_id
        );

        -- Entry 2: Credit Accounts Receivable
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_payment_num || '-CR',
            '1110',
            'Accounts Receivable',
            0.00,
            p_payment_amount,
            'Settlement of A/R for order ' || v_order.order_number,
            'PAYMENT',
            p_stop_id,
            v_caller_id
        );
    END IF;

    -- 6. Finalize stop record
    UPDATE public.delivery_stops
    SET status = 'COMPLETED',
        actual_delivered_quantity = p_actual_delivered,
        empty_jars_collected = p_empty_jars,
        damaged_jars_collected = p_damaged_jars,
        payment_collected = p_payment_amount,
        payment_method = p_payment_method,
        notes = p_notes,
        executed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_stop_id;

    -- 7. Recalculate cumulative status for parent order and accrual invoice
    v_new_cumulative_delivered := v_previously_delivered_qty + p_actual_delivered;
    v_new_cumulative_paid := v_previously_paid_amount + p_payment_amount;

    v_new_order_status := CASE 
        WHEN v_new_cumulative_delivered >= v_total_ordered_qty THEN 'DELIVERED'
        WHEN v_new_cumulative_delivered > 0 THEN 'PARTIALLY_DELIVERED'
        ELSE v_order.status
    END;

    v_new_payment_status := CASE 
        WHEN v_new_cumulative_paid >= v_order.total_amount THEN 'PAID'
        WHEN v_new_cumulative_paid > 0 THEN 'PARTIALLY_PAID'
        ELSE 'UNPAID'
    END;

    UPDATE public.orders
    SET status = v_new_order_status,
        payment_status = v_new_payment_status,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    UPDATE public.invoices
    SET balance_due = pg_catalog.greatest(0.00, total_amount - v_new_cumulative_paid),
        status = CASE 
            WHEN v_new_cumulative_paid >= total_amount THEN 'PAID'
            WHEN v_new_cumulative_paid > 0 THEN 'PARTIALLY_PAID'
            ELSE 'UNPAID'
        END,
        updated_at = pg_catalog.now()
    WHERE order_id = v_order.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'COMPLETED',
        'delivered', p_actual_delivered,
        'cumulative_delivered', v_new_cumulative_delivered,
        'remaining_ordered', (v_total_ordered_qty - v_new_cumulative_delivered),
        'payment_collected', p_payment_amount,
        'cumulative_paid', v_new_cumulative_paid,
        'remaining_balance', (v_order.total_amount - v_new_cumulative_paid),
        'empty_collected', p_empty_jars,
        'damaged_collected', p_damaged_jars,
        'customer_closing_holding', (v_new_full_holding + v_new_empty_holding + v_new_damaged_holding)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. HARDENED SALARY PAYMENT (AUTHORITATIVE SALARY & CONCURRENCY ROW LOCKING)
-- ------------------------------------------------------------------------------

-- Hardened rpc_record_salary_payment:
-- Never trusts client-supplied p_base_salary.
-- Queries authoritative salary from public.profiles with FOR UPDATE row locking.
-- Locks existing salary payments and outstanding advances to prevent concurrent overpayments.
-- Supports legitimate partial disbursements within the same month.
CREATE OR REPLACE FUNCTION public.rpc_record_salary_payment(
    p_staff_id UUID,
    p_period_month VARCHAR,
    p_base_salary NUMERIC,
    p_advance_deducted NUMERIC,
    p_other_deductions NUMERIC,
    p_amount_paid NUMERIC,
    p_payment_method VARCHAR,
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL,
    p_idempotency_key VARCHAR DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_staff RECORD;
    v_authoritative_base_salary NUMERIC(12,2);
    v_payment_id UUID;
    v_voucher_num VARCHAR(50);
    v_prev_paid NUMERIC(12,2) := 0.00;
    v_prev_adv NUMERIC(12,2) := 0.00;
    v_prev_other NUMERIC(12,2) := 0.00;
    v_total_settled_so_far NUMERIC(12,2) := 0.00;
    v_outstanding_payable NUMERIC(12,2) := 0.00;
    v_total_this_disbursement NUMERIC(12,2) := 0.00;
    v_avail_advances NUMERIC(12,2) := 0.00;
    v_rem_adv_to_deduct NUMERIC(12,2);
    v_adv RECORD;
    v_rem_on_adv NUMERIC(12,2);
    v_deduct_this NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_salaries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: only owner or authorized salary manager can disburse salaries.';
    END IF;

    -- Validate salary period format (YYYY-MM)
    IF p_period_month IS NULL OR p_period_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid salary period format: %. Expected YYYY-MM.', p_period_month;
    END IF;

    -- Validate payment parameters
    IF p_amount_paid <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero.';
    END IF;
    IF p_advance_deducted < 0 OR p_other_deductions < 0 THEN
        RAISE EXCEPTION 'Deductions cannot be negative.';
    END IF;
    IF p_payment_method NOT IN ('CASH', 'UPI', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, BANK_TRANSFER.', p_payment_method;
    END IF;

    -- Idempotency check: if already processed with this key, return cached record
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, voucher_number, amount_paid, net_payable INTO v_payment_id, v_voucher_num, p_amount_paid, v_outstanding_payable
        FROM public.salary_payments
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'payment_id', v_payment_id,
                'voucher_number', v_voucher_num,
                'amount_paid', p_amount_paid,
                'net_payable', v_outstanding_payable
            );
        END IF;
    END IF;

    -- 1. Lock Staff Profile FOR UPDATE and retrieve AUTHORITATIVE salary from database
    SELECT * INTO v_staff FROM public.profiles WHERE id = p_staff_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found or inactive.';
    END IF;

    v_authoritative_base_salary := COALESCE(v_staff.salary_amount, 0.00);
    IF v_authoritative_base_salary <= 0 THEN
        RAISE EXCEPTION 'Staff member has no authoritative salary configured in profile master record.';
    END IF;

    -- 2. Lock existing salary payments for this staff member and period to prevent concurrent overpayments
    PERFORM id FROM public.salary_payments
    WHERE staff_id = p_staff_id AND period_month = p_period_month
    FOR UPDATE;

    SELECT 
        COALESCE(SUM(amount_paid), 0.00),
        COALESCE(SUM(advance_deducted), 0.00),
        COALESCE(SUM(other_deductions), 0.00)
    INTO v_prev_paid, v_prev_adv, v_prev_other
    FROM public.salary_payments
    WHERE staff_id = p_staff_id AND period_month = p_period_month;

    v_total_settled_so_far := v_prev_paid + v_prev_adv + v_prev_other;
    v_outstanding_payable := pg_catalog.greatest(0.00, v_authoritative_base_salary - v_total_settled_so_far);

    v_total_this_disbursement := p_amount_paid + p_advance_deducted + p_other_deductions;

    IF v_total_this_disbursement > v_outstanding_payable THEN
        RAISE EXCEPTION 'Total disbursement and deductions (%) exceed remaining salary payable (%) for period %. Authoritative salary: %, previously settled: %.',
            v_total_this_disbursement, v_outstanding_payable, p_period_month, v_authoritative_base_salary, v_total_settled_so_far;
    END IF;

    -- 3. Lock and validate salary advances before applying deductions
    IF p_advance_deducted > 0 THEN
        -- Recheck and lock eligible unsettled advances
        SELECT COALESCE(SUM(amount - amount_deducted), 0.00) INTO v_avail_advances
        FROM public.salary_advances
        WHERE staff_id = p_staff_id AND is_settled = false
        FOR UPDATE;

        IF p_advance_deducted > v_avail_advances THEN
            RAISE EXCEPTION 'Requested advance deduction (%) exceeds total outstanding advances (%).',
                p_advance_deducted, v_avail_advances;
        END IF;
    END IF;

    v_voucher_num := 'SAL-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 4. Insert Salary Payment Record using authoritative base salary
    INSERT INTO public.salary_payments (
        voucher_number,
        staff_id,
        period_month,
        base_salary,
        advance_deducted,
        other_deductions,
        net_payable,
        amount_paid,
        net_paid,
        payment_method,
        payment_date,
        notes,
        idempotency_key,
        created_by
    ) VALUES (
        v_voucher_num,
        p_staff_id,
        p_period_month,
        v_authoritative_base_salary,
        p_advance_deducted,
        p_other_deductions,
        v_outstanding_payable,
        p_amount_paid,
        p_amount_paid,
        p_payment_method,
        COALESCE(p_payment_date, CURRENT_DATE),
        p_notes,
        p_idempotency_key,
        v_caller_id
    ) RETURNING id INTO v_payment_id;

    -- 5. Systematically deduct from advances (FIFO with row locking)
    IF p_advance_deducted > 0 THEN
        v_rem_adv_to_deduct := p_advance_deducted;

        FOR v_adv IN 
            SELECT id, amount, amount_deducted
            FROM public.salary_advances
            WHERE staff_id = p_staff_id AND is_settled = false
            ORDER BY advance_date ASC, created_at ASC
            FOR UPDATE
        LOOP
            v_rem_on_adv := v_adv.amount - v_adv.amount_deducted;
            v_deduct_this := pg_catalog.least(v_rem_adv_to_deduct, v_rem_on_adv);

            UPDATE public.salary_advances
            SET amount_deducted = amount_deducted + v_deduct_this,
                is_settled = ((amount_deducted + v_deduct_this) >= amount),
                is_deducted = true,
                deducted_in_payment_id = v_payment_id,
                updated_at = pg_catalog.now()
            WHERE id = v_adv.id;

            v_rem_adv_to_deduct := v_rem_adv_to_deduct - v_deduct_this;
            EXIT WHEN v_rem_adv_to_deduct <= 0;
        END LOOP;
    END IF;

    -- 6. Balanced Dual-Entry Financial Ledger Posting
    -- Entry 1: Debit Staff Salary Expense (Gross compensation recognized: Net Cash Paid + Advance Recovered + Other Deductions)
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-EXP',
        '5010',
        'Staff Salary Expense',
        (p_amount_paid + p_advance_deducted + p_other_deductions),
        0.00,
        'Salary payment for ' || v_staff.full_name || ' (' || p_period_month || ')',
        'SALARY_PAYMENT',
        v_payment_id,
        v_caller_id
    );

    -- Entry 2: Credit Cash Float / Bank Current Account (Net cash transferred to employee)
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-PAY',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Cash on Hand' ELSE 'Bank Current Account' END,
        0.00,
        p_amount_paid,
        'Salary disbursement to ' || v_staff.full_name,
        'SALARY_PAYMENT',
        v_payment_id,
        v_caller_id
    );

    -- Entry 3: Credit Salary Advance Asset (Advance deduction recovery)
    IF p_advance_deducted > 0 THEN
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_voucher_num || '-ADV',
            '1130',
            'Salary Advance Asset',
            0.00,
            p_advance_deducted,
            'Advance deduction recovery from ' || v_staff.full_name,
            'SALARY_PAYMENT',
            v_payment_id,
            v_caller_id
        );
    END IF;

    -- Entry 4: Credit Payroll Deductions Payable (Other statutory/company deductions)
    IF p_other_deductions > 0 THEN
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_voucher_num || '-OTH',
            '2120',
            'Payroll Deductions Payable',
            0.00,
            p_other_deductions,
            'Other payroll deduction for ' || v_staff.full_name,
            'SALARY_PAYMENT',
            v_payment_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'voucher_number', v_voucher_num,
        'authoritative_base_salary', v_authoritative_base_salary,
        'amount_paid', p_amount_paid,
        'advance_deducted', p_advance_deducted,
        'other_deductions', p_other_deductions,
        'net_payable', (v_outstanding_payable - v_total_this_disbursement)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_record_salary_payment(UUID, VARCHAR, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_record_salary_payment(UUID, VARCHAR, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) TO authenticated, service_role;
-- ==============================================================================
-- AquaTrack ERP — Migration: Remediation Round 4
-- Version: 20261104000002_remediation_round_4.sql
-- Description:
--   1. Fix customer & supplier protection triggers (secure caller identity via auth.uid(),
--      call-stack diagnostic verification via PG_CONTEXT, zero reliance on current_user or
--      caller-controlled session variables).
--   2. Fix salary advance deduction and row locking (eliminate invalid aggregate FOR UPDATE,
--      lock individual unsettled advance rows first, calculate balance post-lock, FIFO deduction).
--   3. Fix jar custody conservation (verify and lock source location holdings before transfer,
--      prevent stock fabrication, enforce valid condition transitions, conserve total assets).
--   4. Fix customer order pricing and tax validation (authoritative prices and GST from database,
--      strict owner-only price overrides with audit tracking, database-side calculation, idempotency).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA ENHANCEMENTS FOR AUDIT & IDEMPOTENCY
-- ------------------------------------------------------------------------------

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100) UNIQUE;

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS original_price NUMERIC(12,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_price_overridden BOOLEAN DEFAULT false;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS authorized_by UUID REFERENCES public.profiles(id);

-- ------------------------------------------------------------------------------
-- 2. HARDENED CUSTOMER & SUPPLIER PROTECTION TRIGGERS
-- ------------------------------------------------------------------------------

-- Trigger function: check_customer_privileged_updates
-- Identifies authenticated caller via auth.uid() and trusted profiles lookup.
-- Uses PG_CONTEXT call stack diagnostics to identify approved internal RPCs.
-- Prevents ordinary staff from directly modifying financial balances or jar holdings.
CREATE OR REPLACE FUNCTION public.check_customer_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_stack TEXT;
    v_is_authorized_rpc BOOLEAN := false;
BEGIN
    v_caller_id := auth.uid();

    -- Inspect PostgreSQL call stack to check if update was initiated by a trusted transactional RPC
    GET DIAGNOSTICS v_stack = PG_CONTEXT;
    IF v_stack LIKE '%rpc_execute_delivery_stop%' OR v_stack LIKE '%rpc_create_customer_order%' THEN
        v_is_authorized_rpc := true;
    END IF;

    -- If executing from an authorized internal transactional RPC, permit updates
    IF v_is_authorized_rpc THEN
        RETURN NEW;
    END IF;

    -- If caller is authenticated, verify their role from trusted database profiles
    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        -- Authorized owner accounts have administrative override permissions
        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        -- For ordinary staff, strictly prohibit direct modification of privileged fields
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
               (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
                RAISE EXCEPTION 'Access Denied: Customer financial balances and jar holdings cannot be directly modified. Use approved transactional workflows.';
            END IF;
        ELSIF TG_OP = 'INSERT' THEN
            IF (NEW.current_balance IS DISTINCT FROM 0.00) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_deposit_held IS DISTINCT FROM 0.00) THEN
                RAISE EXCEPTION 'Access Denied: New customer records must initialize with zero financial balances and jar holdings.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    -- If auth.uid() is null: check if this is direct database maintenance by postgres superuser without PostgREST headers
    IF current_setting('request.jwt.claim.sub', true) IS NULL AND 
       current_setting('request.jwt.claim.role', true) IS NULL THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access Denied: Unauthenticated modification of customer records.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_customer_privileged_fields ON public.customers;
CREATE TRIGGER trg_protect_customer_privileged_fields
    BEFORE INSERT OR UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_customer_privileged_updates();

-- Trigger function: check_supplier_privileged_updates
CREATE OR REPLACE FUNCTION public.check_supplier_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_stack TEXT;
    v_is_authorized_rpc BOOLEAN := false;
BEGIN
    v_caller_id := auth.uid();

    GET DIAGNOSTICS v_stack = PG_CONTEXT;
    IF v_stack LIKE '%rpc_receive_purchase_order%' OR 
       v_stack LIKE '%rpc_record_supplier_payment%' OR
       v_stack LIKE '%rpc_record_jar_movement%' THEN
        v_is_authorized_rpc := true;
    END IF;

    IF v_is_authorized_rpc THEN
        RETURN NEW;
    END IF;

    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) OR
               (NEW.jars_in_custody IS DISTINCT FROM OLD.jars_in_custody) THEN
                RAISE EXCEPTION 'Access Denied: Supplier payables and jar custody cannot be directly modified. Use approved purchase and payment workflows.';
            END IF;
        ELSIF TG_OP = 'INSERT' THEN
            IF (NEW.current_payable IS DISTINCT FROM 0.00) OR
               (NEW.jars_in_custody IS DISTINCT FROM 0) THEN
                RAISE EXCEPTION 'Access Denied: New supplier records must initialize with zero payable and custody.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    IF current_setting('request.jwt.claim.sub', true) IS NULL AND 
       current_setting('request.jwt.claim.role', true) IS NULL THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access Denied: Unauthenticated modification of supplier records.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_supplier_privileged_fields ON public.suppliers;
CREATE TRIGGER trg_protect_supplier_privileged_fields
    BEFORE INSERT OR UPDATE ON public.suppliers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_supplier_privileged_updates();

-- ------------------------------------------------------------------------------
-- 3. HARDENED SALARY PAYMENT WITH VALID ROW-LEVEL ADVANCE LOCKING
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_record_salary_payment(
    p_staff_id UUID,
    p_period_month VARCHAR,
    p_base_salary NUMERIC,
    p_advance_deducted NUMERIC,
    p_other_deductions NUMERIC,
    p_amount_paid NUMERIC,
    p_payment_method VARCHAR,
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL,
    p_idempotency_key VARCHAR DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_staff RECORD;
    v_authoritative_base_salary NUMERIC(12,2);
    v_payment_id UUID;
    v_voucher_num VARCHAR(50);
    v_prev_paid NUMERIC(12,2) := 0.00;
    v_prev_adv NUMERIC(12,2) := 0.00;
    v_prev_other NUMERIC(12,2) := 0.00;
    v_total_settled_so_far NUMERIC(12,2) := 0.00;
    v_outstanding_payable NUMERIC(12,2) := 0.00;
    v_total_this_disbursement NUMERIC(12,2) := 0.00;
    v_avail_advances NUMERIC(12,2) := 0.00;
    v_rem_adv_to_deduct NUMERIC(12,2);
    v_adv RECORD;
    v_rem_on_adv NUMERIC(12,2);
    v_deduct_this NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_salaries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: only owner or authorized salary manager can disburse salaries.';
    END IF;

    -- Validate salary period format (YYYY-MM)
    IF p_period_month IS NULL OR p_period_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid salary period format: %. Expected YYYY-MM.', p_period_month;
    END IF;

    -- Validate payment parameters
    IF p_amount_paid <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero.';
    END IF;
    IF p_advance_deducted < 0 OR p_other_deductions < 0 THEN
        RAISE EXCEPTION 'Deductions cannot be negative.';
    END IF;
    IF p_payment_method NOT IN ('CASH', 'UPI', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, BANK_TRANSFER.', p_payment_method;
    END IF;

    -- Idempotency check: if already processed with this key, return cached record
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, voucher_number, amount_paid, net_payable INTO v_payment_id, v_voucher_num, p_amount_paid, v_outstanding_payable
        FROM public.salary_payments
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'payment_id', v_payment_id,
                'voucher_number', v_voucher_num,
                'amount_paid', p_amount_paid,
                'net_payable', v_outstanding_payable
            );
        END IF;
    END IF;

    -- 1. Lock Staff Profile FOR UPDATE and retrieve AUTHORITATIVE salary from database
    SELECT * INTO v_staff FROM public.profiles WHERE id = p_staff_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found or inactive.';
    END IF;

    v_authoritative_base_salary := COALESCE(v_staff.salary_amount, 0.00);
    IF v_authoritative_base_salary <= 0 THEN
        RAISE EXCEPTION 'Staff member has no authoritative salary configured in profile master record.';
    END IF;

    -- 2. Lock existing salary payments for this staff member and period to serialize concurrent disbursements
    PERFORM id FROM public.salary_payments
    WHERE staff_id = p_staff_id AND period_month = p_period_month
    FOR UPDATE;

    SELECT 
        COALESCE(SUM(amount_paid), 0.00),
        COALESCE(SUM(advance_deducted), 0.00),
        COALESCE(SUM(other_deductions), 0.00)
    INTO v_prev_paid, v_prev_adv, v_prev_other
    FROM public.salary_payments
    WHERE staff_id = p_staff_id AND period_month = p_period_month;

    v_total_settled_so_far := v_prev_paid + v_prev_adv + v_prev_other;
    v_outstanding_payable := pg_catalog.greatest(0.00, v_authoritative_base_salary - v_total_settled_so_far);

    v_total_this_disbursement := p_amount_paid + p_advance_deducted + p_other_deductions;

    IF v_total_this_disbursement > v_outstanding_payable THEN
        RAISE EXCEPTION 'Total disbursement and deductions (%) exceed remaining salary payable (%) for period %. Authoritative salary: %, previously settled: %.',
            v_total_this_disbursement, v_outstanding_payable, p_period_month, v_authoritative_base_salary, v_total_settled_so_far;
    END IF;

    -- 3. Lock individual unsettled advance rows (NO aggregate FOR UPDATE)
    -- Iterate and sum available advances post-lock
    IF p_advance_deducted > 0 THEN
        v_avail_advances := 0.00;
        FOR v_adv IN 
            SELECT id, amount, amount_deducted
            FROM public.salary_advances
            WHERE staff_id = p_staff_id AND is_settled = false
            ORDER BY advance_date ASC, created_at ASC
            FOR UPDATE
        LOOP
            v_avail_advances := v_avail_advances + (v_adv.amount - v_adv.amount_deducted);
        END LOOP;

        IF p_advance_deducted > v_avail_advances THEN
            RAISE EXCEPTION 'Requested advance deduction (%) exceeds total outstanding advances (%).',
                p_advance_deducted, v_avail_advances;
        END IF;
    END IF;

    v_voucher_num := 'SAL-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 4. Insert Salary Payment Record using authoritative base salary
    INSERT INTO public.salary_payments (
        voucher_number,
        staff_id,
        period_month,
        base_salary,
        advance_deducted,
        other_deductions,
        net_payable,
        amount_paid,
        net_paid,
        payment_method,
        payment_date,
        notes,
        idempotency_key,
        created_by
    ) VALUES (
        v_voucher_num,
        p_staff_id,
        p_period_month,
        v_authoritative_base_salary,
        p_advance_deducted,
        p_other_deductions,
        v_outstanding_payable,
        p_amount_paid,
        p_amount_paid,
        p_payment_method,
        COALESCE(p_payment_date, CURRENT_DATE),
        p_notes,
        p_idempotency_key,
        v_caller_id
    ) RETURNING id INTO v_payment_id;

    -- 5. Deduct from locked advances systematically (FIFO order)
    IF p_advance_deducted > 0 THEN
        v_rem_adv_to_deduct := p_advance_deducted;

        FOR v_adv IN 
            SELECT id, amount, amount_deducted
            FROM public.salary_advances
            WHERE staff_id = p_staff_id AND is_settled = false
            ORDER BY advance_date ASC, created_at ASC
            FOR UPDATE
        LOOP
            v_rem_on_adv := v_adv.amount - v_adv.amount_deducted;
            v_deduct_this := pg_catalog.least(v_rem_adv_to_deduct, v_rem_on_adv);

            UPDATE public.salary_advances
            SET amount_deducted = amount_deducted + v_deduct_this,
                is_settled = ((amount_deducted + v_deduct_this) >= amount),
                is_deducted = true,
                deducted_in_payment_id = v_payment_id,
                updated_at = pg_catalog.now()
            WHERE id = v_adv.id;

            v_rem_adv_to_deduct := v_rem_adv_to_deduct - v_deduct_this;
            EXIT WHEN v_rem_adv_to_deduct <= 0;
        END LOOP;
    END IF;

    -- 6. Balanced Dual-Entry Financial Ledger Posting
    -- Entry 1: Debit Staff Salary Expense
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-EXP',
        '5010',
        'Staff Salary Expense',
        (p_amount_paid + p_advance_deducted + p_other_deductions),
        0.00,
        'Salary payment for ' || v_staff.full_name || ' (' || p_period_month || ')',
        'SALARY_PAYMENT',
        v_payment_id,
        v_caller_id
    );

    -- Entry 2: Credit Cash Float / Bank Current Account
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_voucher_num || '-PAY',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Cash on Hand' ELSE 'Bank Current Account' END,
        0.00,
        p_amount_paid,
        'Salary disbursement to ' || v_staff.full_name,
        'SALARY_PAYMENT',
        v_payment_id,
        v_caller_id
    );

    -- Entry 3: Credit Salary Advance Asset (if advance deducted)
    IF p_advance_deducted > 0 THEN
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_voucher_num || '-ADV',
            '1130',
            'Salary Advance Asset',
            0.00,
            p_advance_deducted,
            'Advance deduction recovery from ' || v_staff.full_name,
            'SALARY_PAYMENT',
            v_payment_id,
            v_caller_id
        );
    END IF;

    -- Entry 4: Credit Payroll Deductions Payable (if other deductions)
    IF p_other_deductions > 0 THEN
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_voucher_num || '-OTH',
            '2120',
            'Payroll Deductions Payable',
            0.00,
            p_other_deductions,
            'Other payroll deduction for ' || v_staff.full_name,
            'SALARY_PAYMENT',
            v_payment_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'voucher_number', v_voucher_num,
        'authoritative_base_salary', v_authoritative_base_salary,
        'amount_paid', p_amount_paid,
        'advance_deducted', p_advance_deducted,
        'other_deductions', p_other_deductions,
        'net_payable', (v_outstanding_payable - v_total_this_disbursement)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ------------------------------------------------------------------------------
-- 4. HARDENED JAR CUSTODY MOVEMENT WITH SOURCE VERIFICATION & ASSET CONSERVATION
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_record_jar_movement(
    p_source_location_id UUID,
    p_destination_location_id UUID,
    p_condition_from VARCHAR,
    p_condition_to VARCHAR,
    p_quantity INT,
    p_movement_type VARCHAR,
    p_reference_type VARCHAR DEFAULT 'MANUAL',
    p_reference_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_jar_product_id UUID;
    v_movement_id UUID;
    v_default_wh_id UUID;
    v_wh_location_id UUID;
    v_src_loc RECORD;
    v_dst_loc RECORD;
    v_first_loc UUID;
    v_second_loc UUID;
    v_src_wh_full INT := 0;
    v_avail_wh_cond INT := 0;
    v_avail_veh_cond INT := 0;
    v_cust RECORD;
    v_supp RECORD;
    v_dst_cust RECORD;
    v_dst_supp RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_warehouse')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have warehouse management authority.';
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero.';
    END IF;

    -- Validate allowed conditions
    IF p_condition_from NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_from: %', p_condition_from;
    END IF;
    IF p_condition_to NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_to: %', p_condition_to;
    END IF;

    -- Validate allowed movement types
    IF p_movement_type NOT IN (
        'CUSTOMER_DELIVERY', 'CUSTOMER_EMPTY_RETURN', 'DAMAGED_COLLECTED',
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL',
        'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT', 'DISPATCH_TO_VEHICLE',
        'VEHICLE_RETURN_TO_WAREHOUSE', 'SUPPLIER_PURCHASE', 'RETURN_TO_SUPPLIER'
    ) THEN
        RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
    END IF;

    -- Enforce condition transition invariants
    IF p_movement_type = 'WASHING_CYCLE_DIRTY_TO_CLEAN' AND (p_condition_from != 'EMPTY_DIRTY' OR p_condition_to != 'EMPTY_CLEAN') THEN
        RAISE EXCEPTION 'Washing cycle requires EMPTY_DIRTY -> EMPTY_CLEAN transition.';
    END IF;
    IF p_movement_type = 'FILLING_CYCLE_CLEAN_TO_FULL' AND (p_condition_from != 'EMPTY_CLEAN' OR p_condition_to != 'FULL_USABLE') THEN
        RAISE EXCEPTION 'Filling cycle requires EMPTY_CLEAN -> FULL_USABLE transition.';
    END IF;
    IF p_movement_type = 'SCRAP_WRITEOFF' AND (p_condition_from NOT IN ('DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') OR p_condition_to != 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Scrap writeoff requires DAMAGED_REPAIRABLE/DAMAGED_SCRAP -> DAMAGED_SCRAP transition.';
    END IF;

    -- Resolve reusable jar product
    SELECT id INTO v_jar_product_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_jar_product_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;

    -- Resolve default central warehouse
    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id FROM public.warehouses WHERE is_default = true LIMIT 1;

    -- 1. Deadlock-free locking of locations (Deterministic UUID ordering)
    IF p_source_location_id = p_destination_location_id THEN
        SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
        v_dst_loc := v_src_loc;
    ELSE
        IF p_source_location_id < p_destination_location_id THEN
            SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
            SELECT * INTO v_dst_loc FROM public.locations WHERE id = p_destination_location_id FOR UPDATE;
        ELSE
            SELECT * INTO v_dst_loc FROM public.locations WHERE id = p_destination_location_id FOR UPDATE;
            SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
        END IF;
    END IF;

    IF v_src_loc.id IS NULL THEN
        RAISE EXCEPTION 'Source location % does not exist.', p_source_location_id;
    END IF;
    IF v_dst_loc.id IS NULL THEN
        RAISE EXCEPTION 'Destination location % does not exist.', p_destination_location_id;
    END IF;

    -- 2. Verify and Lock Source Location Balance (Prevents inventory fabrication)
    -- Except for initial external supplier procurement (SUPPLIER_PURCHASE) where stock is procured into system
    IF p_movement_type != 'SUPPLIER_PURCHASE' THEN
        IF v_src_loc.location_type = 'CUSTOMER' THEN
            SELECT * INTO v_cust FROM public.customers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_cust.id IS NULL THEN
                RAISE EXCEPTION 'Customer at location % not found.', p_source_location_id;
            END IF;

            IF p_condition_from = 'FULL_USABLE' AND v_cust.total_full_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient full jars. Available: %, Requested: %.', v_cust.total_full_jars_holding, p_quantity;
            ELSIF p_condition_from = 'EMPTY_DIRTY' AND v_cust.total_empty_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient empty jars. Available: %, Requested: %.', v_cust.total_empty_jars_holding, p_quantity;
            ELSIF p_condition_from = 'DAMAGED_REPAIRABLE' AND COALESCE(v_cust.total_damaged_jars_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient damaged jars. Available: %, Requested: %.', COALESCE(v_cust.total_damaged_jars_holding, 0), p_quantity;
            END IF;

            -- Deduct from customer custody
            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_from = 'FULL_USABLE' THEN total_full_jars_holding - p_quantity ELSE total_full_jars_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_from = 'EMPTY_DIRTY' THEN total_empty_jars_holding - p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding - p_quantity ELSE total_damaged_jars_holding END,
                updated_at = pg_catalog.now()
            WHERE id = v_cust.id;

        ELSIF v_src_loc.location_type = 'SUPPLIER' THEN
            SELECT * INTO v_supp FROM public.suppliers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_supp.id IS NULL THEN
                RAISE EXCEPTION 'Supplier at location % not found.', p_source_location_id;
            END IF;

            IF v_supp.jars_in_custody < p_quantity THEN
                RAISE EXCEPTION 'Supplier has insufficient jars in custody. Available: %, Requested: %.', v_supp.jars_in_custody, p_quantity;
            END IF;

            UPDATE public.suppliers
            SET jars_in_custody = jars_in_custody - p_quantity,
                updated_at = pg_catalog.now()
            WHERE id = v_supp.id;

        ELSIF v_src_loc.location_type = 'WAREHOUSE' THEN
            IF p_condition_from = 'FULL_USABLE' THEN
                SELECT quantity_on_hand INTO v_src_wh_full
                FROM public.inventory_balances
                WHERE warehouse_id = v_default_wh_id AND product_id = v_jar_product_id
                FOR UPDATE;

                IF COALESCE(v_src_wh_full, 0) < p_quantity THEN
                    RAISE EXCEPTION 'Warehouse has insufficient full usable jars. Available: %, Requested: %.', COALESCE(v_src_wh_full, 0), p_quantity;
                END IF;

                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand - p_quantity,
                    updated_at = pg_catalog.now()
                WHERE warehouse_id = v_default_wh_id AND product_id = v_jar_product_id;
            ELSE
                -- Calculate warehouse available condition stock from movements
                SELECT COALESCE(
                    (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = p_condition_from)
                    -
                    (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = p_condition_from),
                    0
                ) INTO v_avail_wh_cond;

                IF v_avail_wh_cond < p_quantity THEN
                    RAISE EXCEPTION 'Warehouse has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_wh_cond, p_quantity;
                END IF;
            END IF;

        ELSIF v_src_loc.location_type IN ('INTERNAL', 'VEHICLE') THEN
            -- Calculate vehicle/staff available condition stock from movements
            SELECT COALESCE(
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = p_condition_from)
                -
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = p_condition_from),
                0
            ) INTO v_avail_veh_cond;

            IF v_avail_veh_cond < p_quantity THEN
                RAISE EXCEPTION 'Staff vehicle has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_veh_cond, p_quantity;
            END IF;
        END IF;
    END IF;

    -- 3. Update Destination Holdings
    IF v_dst_loc.location_type = 'CUSTOMER' THEN
        SELECT * INTO v_dst_cust FROM public.customers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_cust.id IS NOT NULL THEN
            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_to = 'FULL_USABLE' THEN total_full_jars_holding + p_quantity ELSE total_full_jars_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_to = 'EMPTY_DIRTY' THEN total_empty_jars_holding + p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding + p_quantity ELSE total_damaged_jars_holding END,
                updated_at = pg_catalog.now()
            WHERE id = v_dst_cust.id;
        END IF;

    ELSIF v_dst_loc.location_type = 'SUPPLIER' THEN
        SELECT * INTO v_dst_supp FROM public.suppliers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_supp.id IS NOT NULL THEN
            UPDATE public.suppliers
            SET jars_in_custody = jars_in_custody + p_quantity,
                updated_at = pg_catalog.now()
            WHERE id = v_dst_supp.id;
        END IF;

    ELSIF v_dst_loc.location_type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
        INSERT INTO public.inventory_balances (
            warehouse_id,
            product_id,
            quantity_on_hand,
            updated_at
        ) VALUES (
            v_default_wh_id,
            v_jar_product_id,
            p_quantity,
            pg_catalog.now()
        )
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET
            quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
            updated_at = pg_catalog.now();
    END IF;

    -- 4. Insert Immutable Jar Custody Movement Audit Log
    INSERT INTO public.jar_custody_movements (
        product_id,
        source_location_id,
        destination_location_id,
        condition_from,
        condition_to,
        quantity,
        movement_type,
        reference_type,
        reference_id,
        notes,
        created_by
    ) VALUES (
        v_jar_product_id,
        p_source_location_id,
        p_destination_location_id,
        p_condition_from,
        p_condition_to,
        p_quantity,
        p_movement_type,
        COALESCE(p_reference_type, 'MANUAL'),
        p_reference_id,
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_movement_id;

    -- Dual-entry stock movement if warehouse full usable inventory affected
    IF v_dst_loc.location_type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
        INSERT INTO public.stock_movements (
            warehouse_id,
            product_id,
            movement_type,
            quantity,
            reference_type,
            reference_id,
            source_location_id,
            destination_location_id,
            created_by
        ) VALUES (
            v_default_wh_id,
            v_jar_product_id,
            CASE WHEN p_movement_type = 'FILLING_CYCLE_CLEAN_TO_FULL' THEN 'ADJUSTMENT_IN' ELSE 'DELIVERY_RETURN' END,
            p_quantity,
            'JAR_MOVEMENT',
            v_movement_id,
            p_source_location_id,
            p_destination_location_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'movement_id', v_movement_id,
        'quantity', p_quantity,
        'movement_type', p_movement_type,
        'condition_from', p_condition_from,
        'condition_to', p_condition_to
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ------------------------------------------------------------------------------
-- 5. HARDENED ORDER CREATION WITH AUTHORITATIVE PRICING & TAX VALIDATION
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_create_customer_order(
    p_customer_id UUID,
    p_delivery_address TEXT,
    p_delivery_date DATE,
    p_assigned_staff_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_price_override_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_customer RECORD;
    v_order_id UUID;
    v_order_num VARCHAR(50);
    v_invoice_id UUID;
    v_invoice_num VARCHAR(50);
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
    v_item RECORD;
    v_product RECORD;
    v_special_price NUMERIC(12,2);
    v_base_unit_price NUMERIC(12,2);
    v_final_unit_price NUMERIC(12,2);
    v_is_overridden BOOLEAN;
    v_item_subtotal NUMERIC(12,2);
    v_item_tax NUMERIC(12,2);
    v_item_total NUMERIC(12,2);
    v_existing_order_id UUID;
    v_existing_order_num VARCHAR(50);
    v_existing_total NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_orders')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have order creation authority.';
    END IF;

    -- Idempotency check: if order with this key already exists, return cached record
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, order_number, total_amount INTO v_existing_order_id, v_existing_order_num, v_existing_total
        FROM public.orders
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'order_id', v_existing_order_id,
                'order_number', v_existing_order_num,
                'total_amount', v_existing_total
            );
        END IF;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order items array cannot be empty.';
    END IF;

    -- Lock customer record FOR UPDATE
    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found or inactive.';
    END IF;

    -- 1. Calculate order totals using AUTHORITATIVE product prices and tax rates from database
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        quantity INT,
        unit_price NUMERIC,
        gst_rate NUMERIC
    )
    LOOP
        IF v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be greater than zero.';
        END IF;

        SELECT id, name, price, gst_rate INTO v_product
        FROM public.products
        WHERE id = v_item.product_id AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found or inactive.', v_item.product_id;
        END IF;

        -- Check customer-specific agreed special price
        SELECT special_price INTO v_special_price
        FROM public.customer_special_prices
        WHERE customer_id = p_customer_id AND product_id = v_item.product_id AND is_active = true;

        v_base_unit_price := COALESCE(v_special_price, v_product.price);

        -- Authoritative price validation:
        -- Ordinary staff MUST use standard or customer-special price.
        -- Only Owner can authorize negotiated discounts or custom prices.
        IF v_item.unit_price IS NOT NULL AND v_item.unit_price != v_base_unit_price THEN
            IF v_caller_role != 'owner' THEN
                RAISE EXCEPTION 'Unauthorized price override: only the business owner can authorize price overrides or custom discounts. Product: %, Standard: %, Submitted: %.',
                    v_product.name, v_base_unit_price, v_item.unit_price;
            END IF;

            IF v_item.unit_price < 0 THEN
                RAISE EXCEPTION 'Overridden unit price cannot be negative.';
            END IF;

            v_final_unit_price := v_item.unit_price;
            v_is_overridden := true;
        ELSE
            v_final_unit_price := v_base_unit_price;
            v_is_overridden := false;
        END IF;

        -- Tax rate is ALWAYS strictly authoritative from products table (clients cannot manipulate GST)
        v_item_subtotal := v_final_unit_price * v_item.quantity;
        v_item_tax := pg_catalog.round(v_item_subtotal * (v_product.gst_rate / 100.0), 2);
        v_item_total := v_item_subtotal + v_item_tax;

        v_subtotal := v_subtotal + v_item_subtotal;
        v_tax_total := v_tax_total + v_item_tax;
    END LOOP;

    v_total_amount := v_subtotal + v_tax_total;
    v_order_num := 'ORD-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 2. Insert master order
    INSERT INTO public.orders (
        order_number,
        customer_id,
        delivery_address,
        delivery_date,
        assigned_staff_id,
        status,
        payment_status,
        subtotal,
        tax_total,
        total_amount,
        notes,
        idempotency_key,
        created_by
    ) VALUES (
        v_order_num,
        p_customer_id,
        COALESCE(p_delivery_address, v_customer.address),
        COALESCE(p_delivery_date, CURRENT_DATE),
        p_assigned_staff_id,
        CASE WHEN p_assigned_staff_id IS NOT NULL THEN 'ASSIGNED' ELSE 'PENDING' END,
        'UNPAID',
        v_subtotal,
        v_tax_total,
        v_total_amount,
        p_notes,
        p_idempotency_key,
        v_caller_id
    ) RETURNING id INTO v_order_id;

    -- 3. Insert line items with pricing audit trail
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        quantity INT,
        unit_price NUMERIC,
        gst_rate NUMERIC
    )
    LOOP
        SELECT id, name, price, gst_rate INTO v_product FROM public.products WHERE id = v_item.product_id;
        SELECT special_price INTO v_special_price FROM public.customer_special_prices WHERE customer_id = p_customer_id AND product_id = v_item.product_id AND is_active = true;
        v_base_unit_price := COALESCE(v_special_price, v_product.price);

        IF v_item.unit_price IS NOT NULL AND v_item.unit_price != v_base_unit_price AND v_caller_role = 'owner' THEN
            v_final_unit_price := v_item.unit_price;
            v_is_overridden := true;
        ELSE
            v_final_unit_price := v_base_unit_price;
            v_is_overridden := false;
        END IF;

        v_item_subtotal := v_final_unit_price * v_item.quantity;
        v_item_tax := pg_catalog.round(v_item_subtotal * (v_product.gst_rate / 100.0), 2);
        v_item_total := v_item_subtotal + v_item_tax;

        INSERT INTO public.order_items (
            order_id,
            product_id,
            quantity,
            unit_price,
            tax_rate,
            tax_amount,
            total_amount,
            original_price,
            is_price_overridden,
            override_reason,
            authorized_by
        ) VALUES (
            v_order_id,
            v_item.product_id,
            v_item.quantity,
            v_final_unit_price,
            v_product.gst_rate,
            v_item_tax,
            v_item_total,
            v_base_unit_price,
            v_is_overridden,
            CASE WHEN v_is_overridden THEN p_price_override_reason ELSE NULL END,
            CASE WHEN v_is_overridden THEN v_caller_id ELSE NULL END
        );
    END LOOP;

    -- 4. Create delivery stop if assigned to driver
    IF p_assigned_staff_id IS NOT NULL THEN
        INSERT INTO public.delivery_stops (
            order_id,
            assigned_staff_id,
            sequence_number,
            status
        ) VALUES (
            v_order_id,
            p_assigned_staff_id,
            1,
            'ASSIGNED'
        );
    END IF;

    -- 5. Create Accrual Sales Invoice matching exact order totals
    v_invoice_num := 'INV-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);
    INSERT INTO public.invoices (
        invoice_number,
        order_id,
        customer_id,
        subtotal,
        tax_amount,
        total_amount,
        balance_due,
        status,
        invoice_date,
        created_by
    ) VALUES (
        v_invoice_num,
        v_order_id,
        p_customer_id,
        v_subtotal,
        v_tax_total,
        v_total_amount,
        v_total_amount,
        'UNPAID',
        CURRENT_DATE,
        v_caller_id
    ) RETURNING id INTO v_invoice_id;

    -- 6. Increment customer balance (permitted via trigger stack recognition)
    UPDATE public.customers
    SET current_balance = current_balance + v_total_amount,
        updated_at = pg_catalog.now()
    WHERE id = p_customer_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'order_number', v_order_num,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_num,
        'subtotal', v_subtotal,
        'tax_total', v_tax_total,
        'total_amount', v_total_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB, VARCHAR, TEXT) TO authenticated, service_role;
-- ==============================================================================
-- AquaTrack ERP — Migration: Remediation Round 5
-- Version: 20261104000003_remediation_round_5.sql
-- Description:
--   1. Complete jar-condition custody accounting on public.customers:
--      Adds total_empty_clean_holding and total_scrap_jars_holding.
--   2. Hardened trigger authorization for customer & supplier protection:
--      Authorizes rpc_record_jar_movement to mutate custody while strictly
--      protecting financial balances and deposit balances from direct staff edits.
--   3. Hardened rpc_record_jar_movement:
--      - Validates supplier purchases: source must be supplier, destination warehouse,
--        verifies purchase order reference or opening stock, rejects customer sources.
--      - Complete condition accounting across all 5 conditions (FULL_USABLE,
--        EMPTY_CLEAN, EMPTY_DIRTY, DAMAGED_REPAIRABLE, DAMAGED_SCRAP).
--      - Strict condition transition matrix (dirty->clean only via washing,
--        clean->full only via filling, repairable->clean/scrap via repair, scrap is final).
--      - Strict asset conservation (delta = 0 for ordinary movements).
--      - Deterministic location and entity row-level locking.
--   4. Hardened rpc_create_customer_order:
--      - Mandatory price override reason validation (minimum 5 non-whitespace chars).
--      - Strict GST tax rate validation against master catalog (rejects tampering).
--      - Concurrent-safe idempotency via pg_advisory_xact_lock.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA ENHANCEMENTS: COMPLETE JAR CONDITION CUSTODY COLUMNS
-- ------------------------------------------------------------------------------

ALTER TABLE public.customers 
    ADD COLUMN IF NOT EXISTS total_empty_clean_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_empty_clean_holding >= 0);

ALTER TABLE public.customers 
    ADD COLUMN IF NOT EXISTS total_scrap_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_scrap_jars_holding >= 0);

-- ------------------------------------------------------------------------------
-- 2. HARDENED TRIGGER: check_customer_privileged_updates
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_customer_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_stack TEXT;
BEGIN
    v_caller_id := auth.uid();

    -- Inspect PostgreSQL call stack to check if update was initiated by a trusted transactional RPC
    GET DIAGNOSTICS v_stack = PG_CONTEXT;

    -- Internal RPC Authorization Check:
    -- Each RPC is strictly restricted to its authorized domain fields:
    IF v_stack LIKE '%rpc_record_jar_movement%' THEN
        -- Jar movement RPC can ONLY modify jar custody holdings, NEVER financial balances or deposits!
        IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
           (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
            RAISE EXCEPTION 'Access Denied: Jar movement operations cannot modify financial balances or deposits.';
        END IF;
        RETURN NEW;
    END IF;

    IF v_stack LIKE '%rpc_create_customer_order%' THEN
        -- Order creation RPC can ONLY update current_balance, NEVER jar holdings!
        IF (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
           (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
           (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
           (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
           (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
           (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
            RAISE EXCEPTION 'Access Denied: Order creation cannot directly modify jar holdings.';
        END IF;
        RETURN NEW;
    END IF;

    IF v_stack LIKE '%rpc_execute_delivery_stop%' OR v_stack LIKE '%rpc_record_customer_payment%' THEN
        RETURN NEW;
    END IF;

    -- If caller is authenticated, verify their role from trusted database profiles
    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        -- Authorized owner accounts have administrative override permissions
        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        -- For ordinary staff and direct SQL updates, strictly prohibit modification of privileged fields
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
               (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
               (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
               (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
                RAISE EXCEPTION 'Access Denied: Customer financial balances and jar holdings cannot be directly modified. Use approved transactional workflows.';
            END IF;
        ELSIF TG_OP = 'INSERT' THEN
            IF (NEW.current_balance IS DISTINCT FROM 0.00) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_empty_clean_holding IS DISTINCT FROM 0) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_scrap_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_deposit_held IS DISTINCT FROM 0.00) THEN
                RAISE EXCEPTION 'Access Denied: New customer records must initialize with zero financial balances and jar holdings.';
            END IF;
        END IF;

        -- Standard non-privileged updates (notes, phone, address, contact_name) are permitted
        RETURN NEW;
    END IF;

    -- If auth.uid() is null: direct maintenance by postgres superuser without PostgREST headers
    IF current_setting('request.jwt.claim.sub', true) IS NULL AND 
       current_setting('request.jwt.claim.role', true) IS NULL THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access Denied: Unauthenticated modification of customer records.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_customer_privileged_fields ON public.customers;
CREATE TRIGGER trg_protect_customer_privileged_fields
    BEFORE INSERT OR UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_customer_privileged_updates();

-- ------------------------------------------------------------------------------
-- 3. HARDENED TRIGGER: check_supplier_privileged_updates
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_supplier_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_stack TEXT;
BEGIN
    v_caller_id := auth.uid();

    GET DIAGNOSTICS v_stack = PG_CONTEXT;

    IF v_stack LIKE '%rpc_record_jar_movement%' THEN
        -- Jar movement RPC can ONLY modify jars_in_custody, NEVER current_payable!
        IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) THEN
            RAISE EXCEPTION 'Access Denied: Jar movements cannot modify supplier payable balances.';
        END IF;
        RETURN NEW;
    END IF;

    IF v_stack LIKE '%rpc_receive_purchase_order%' OR 
       v_stack LIKE '%rpc_record_supplier_payment%' THEN
        RETURN NEW;
    END IF;

    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) OR
               (NEW.jars_in_custody IS DISTINCT FROM OLD.jars_in_custody) THEN
                RAISE EXCEPTION 'Access Denied: Supplier payables and jar custody cannot be directly modified. Use approved purchase and payment workflows.';
            END IF;
        ELSIF TG_OP = 'INSERT' THEN
            IF (NEW.current_payable IS DISTINCT FROM 0.00) OR
               (NEW.jars_in_custody IS DISTINCT FROM 0) THEN
                RAISE EXCEPTION 'Access Denied: New supplier records must initialize with zero payable and custody.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    IF current_setting('request.jwt.claim.sub', true) IS NULL AND 
       current_setting('request.jwt.claim.role', true) IS NULL THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access Denied: Unauthenticated modification of supplier records.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_supplier_privileged_fields ON public.suppliers;
CREATE TRIGGER trg_protect_supplier_privileged_fields
    BEFORE INSERT OR UPDATE ON public.suppliers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_supplier_privileged_updates();

-- ------------------------------------------------------------------------------
-- 4. HARDENED JAR MOVEMENT WITH COMPREHENSIVE ASSET CONSERVATION
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_record_jar_movement(
    p_source_location_id UUID,
    p_destination_location_id UUID,
    p_condition_from VARCHAR,
    p_condition_to VARCHAR,
    p_quantity INT,
    p_movement_type VARCHAR,
    p_reference_type VARCHAR DEFAULT 'MANUAL',
    p_reference_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_jar_product_id UUID;
    v_movement_id UUID;
    v_default_wh_id UUID;
    v_wh_location_id UUID;
    v_src_loc RECORD;
    v_dst_loc RECORD;
    v_first_loc UUID;
    v_second_loc UUID;
    v_src_wh_full INT := 0;
    v_avail_wh_cond INT := 0;
    v_avail_veh_cond INT := 0;
    v_cust RECORD;
    v_supp RECORD;
    v_dst_cust RECORD;
    v_dst_supp RECORD;
    v_po_exists BOOLEAN := false;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND 
       (v_perms->>'can_warehouse')::boolean != true AND
       (v_perms->>'can_deliveries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have jar movement authority.';
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero.';
    END IF;

    -- Validate all 5 allowed conditions
    IF p_condition_from NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_from: %', p_condition_from;
    END IF;
    IF p_condition_to NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_to: %', p_condition_to;
    END IF;

    -- Validate allowed movement types
    IF p_movement_type NOT IN (
        'CUSTOMER_DELIVERY', 'CUSTOMER_EMPTY_RETURN', 'DAMAGED_COLLECTED',
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL',
        'REPAIR_CYCLE', 'SCRAP_WRITEOFF', 'DISPATCH_TO_VEHICLE',
        'VEHICLE_RETURN_TO_WAREHOUSE', 'SUPPLIER_PURCHASE', 'RETURN_TO_SUPPLIER',
        'STOCK_ADJUSTMENT', 'OPENING_STOCK'
    ) THEN
        RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
    END IF;

    -- Enforce strict condition transition matrix
    -- 1. Scrapped jars can NEVER be restored to usable or repairable condition
    IF p_condition_from = 'DAMAGED_SCRAP' AND p_condition_to != 'DAMAGED_SCRAP' THEN
        RAISE EXCEPTION 'Scrapped jars cannot be restored to usable or repairable condition.';
    END IF;

    -- 2. Specific workflow transitions
    IF p_movement_type = 'WASHING_CYCLE_DIRTY_TO_CLEAN' AND (p_condition_from != 'EMPTY_DIRTY' OR p_condition_to != 'EMPTY_CLEAN') THEN
        RAISE EXCEPTION 'Washing cycle requires EMPTY_DIRTY -> EMPTY_CLEAN transition.';
    END IF;

    IF p_movement_type = 'FILLING_CYCLE_CLEAN_TO_FULL' AND (p_condition_from != 'EMPTY_CLEAN' OR p_condition_to != 'FULL_USABLE') THEN
        RAISE EXCEPTION 'Filling cycle requires EMPTY_CLEAN -> FULL_USABLE transition.';
    END IF;

    IF p_movement_type = 'REPAIR_CYCLE' AND (p_condition_from != 'DAMAGED_REPAIRABLE' OR p_condition_to NOT IN ('EMPTY_CLEAN', 'DAMAGED_SCRAP')) THEN
        RAISE EXCEPTION 'Repair cycle requires DAMAGED_REPAIRABLE -> EMPTY_CLEAN or DAMAGED_SCRAP transition.';
    END IF;

    IF p_movement_type = 'SCRAP_WRITEOFF' AND (p_condition_from NOT IN ('DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') OR p_condition_to != 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Scrap writeoff requires DAMAGED_REPAIRABLE/DAMAGED_SCRAP -> DAMAGED_SCRAP transition.';
    END IF;

    -- 3. Disallow arbitrary condition changes via generic adjustments
    IF p_condition_from != p_condition_to AND p_movement_type NOT IN (
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL', 'REPAIR_CYCLE', 'SCRAP_WRITEOFF'
    ) THEN
        RAISE EXCEPTION 'Arbitrary condition conversion from % to % is not permitted under movement type %.',
            p_condition_from, p_condition_to, p_movement_type;
    END IF;

    -- Resolve reusable jar product
    SELECT id INTO v_jar_product_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_jar_product_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;

    -- Resolve default central warehouse
    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id FROM public.warehouses WHERE is_default = true LIMIT 1;

    -- 1. Deadlock-free locking of locations (Deterministic UUID ordering)
    IF p_source_location_id = p_destination_location_id THEN
        SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
        v_dst_loc := v_src_loc;
    ELSE
        IF p_source_location_id < p_destination_location_id THEN
            SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
            SELECT * INTO v_dst_loc FROM public.locations WHERE id = p_destination_location_id FOR UPDATE;
        ELSE
            SELECT * INTO v_dst_loc FROM public.locations WHERE id = p_destination_location_id FOR UPDATE;
            SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
        END IF;
    END IF;

    IF v_src_loc.id IS NULL THEN
        RAISE EXCEPTION 'Source location % does not exist.', p_source_location_id;
    END IF;
    IF v_dst_loc.id IS NULL THEN
        RAISE EXCEPTION 'Destination location % does not exist.', p_destination_location_id;
    END IF;

    -- 2. Strict Supplier Purchase & Inflow Validation (Problem A Fix)
    IF p_movement_type = 'SUPPLIER_PURCHASE' THEN
        -- Source MUST be a valid supplier
        IF v_src_loc.location_type != 'SUPPLIER' THEN
            RAISE EXCEPTION 'Supplier purchase source must be a valid supplier location. Location % is %.',
                p_source_location_id, v_src_loc.location_type;
        END IF;

        -- Destination MUST be the warehouse
        IF v_dst_loc.location_type != 'WAREHOUSE' THEN
            RAISE EXCEPTION 'Supplier purchase destination must be a warehouse location. Location % is %.',
                p_destination_location_id, v_dst_loc.location_type;
        END IF;

        -- Must have an authorized purchase reference or explicit opening-stock reference
        IF p_reference_type NOT IN ('PURCHASE_ORDER', 'OPENING_STOCK', 'PURCHASE') THEN
            RAISE EXCEPTION 'Supplier purchase requires a valid purchase reference (PURCHASE_ORDER) or OPENING_STOCK.';
        END IF;

        SELECT * INTO v_supp FROM public.suppliers WHERE location_id = p_source_location_id FOR UPDATE;
        IF v_supp.id IS NULL THEN
            RAISE EXCEPTION 'Supplier record not found for location %.', p_source_location_id;
        END IF;

        IF p_reference_type = 'PURCHASE_ORDER' AND p_reference_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1 FROM public.purchases WHERE id = p_reference_id AND supplier_id = v_supp.id
            ) INTO v_po_exists;

            IF NOT v_po_exists THEN
                RAISE EXCEPTION 'Purchase order reference % not found for supplier %.', p_reference_id, v_supp.id;
            END IF;
        END IF;

    ELSIF p_movement_type = 'OPENING_STOCK' THEN
        IF v_caller_role != 'owner' THEN
            RAISE EXCEPTION 'Only business owners can record initial opening stock entries.';
        END IF;
        IF v_dst_loc.location_type != 'WAREHOUSE' THEN
            RAISE EXCEPTION 'Opening stock destination must be a warehouse location.';
        END IF;

    ELSE
        -- 3. Strict Source Balance Verification for All Ordinary Movements (Prevents inventory fabrication)
        IF v_src_loc.location_type = 'CUSTOMER' THEN
            SELECT * INTO v_cust FROM public.customers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_cust.id IS NULL THEN
                RAISE EXCEPTION 'Customer at location % not found.', p_source_location_id;
            END IF;

            -- Check specific condition holding on customer
            IF p_condition_from = 'FULL_USABLE' AND v_cust.total_full_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient full jars. Available: %, Requested: %.', v_cust.total_full_jars_holding, p_quantity;
            ELSIF p_condition_from = 'EMPTY_CLEAN' AND COALESCE(v_cust.total_empty_clean_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient clean empty jars. Available: %, Requested: %.', COALESCE(v_cust.total_empty_clean_holding, 0), p_quantity;
            ELSIF p_condition_from = 'EMPTY_DIRTY' AND v_cust.total_empty_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient dirty empty jars. Available: %, Requested: %.', v_cust.total_empty_jars_holding, p_quantity;
            ELSIF p_condition_from = 'DAMAGED_REPAIRABLE' AND COALESCE(v_cust.total_damaged_jars_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient damaged repairable jars. Available: %, Requested: %.', COALESCE(v_cust.total_damaged_jars_holding, 0), p_quantity;
            ELSIF p_condition_from = 'DAMAGED_SCRAP' AND COALESCE(v_cust.total_scrap_jars_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient scrap jars. Available: %, Requested: %.', COALESCE(v_cust.total_scrap_jars_holding, 0), p_quantity;
            END IF;

            -- Deduct from exact condition holding
            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_from = 'FULL_USABLE' THEN total_full_jars_holding - p_quantity ELSE total_full_jars_holding END,
                total_empty_clean_holding = CASE WHEN p_condition_from = 'EMPTY_CLEAN' THEN total_empty_clean_holding - p_quantity ELSE total_empty_clean_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_from = 'EMPTY_DIRTY' THEN total_empty_jars_holding - p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding - p_quantity ELSE total_damaged_jars_holding END,
                total_scrap_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_SCRAP' THEN total_scrap_jars_holding - p_quantity ELSE total_scrap_jars_holding END,
                updated_at = pg_catalog.now()
            WHERE id = v_cust.id;

        ELSIF v_src_loc.location_type = 'SUPPLIER' THEN
            SELECT * INTO v_supp FROM public.suppliers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_supp.id IS NULL THEN
                RAISE EXCEPTION 'Supplier at location % not found.', p_source_location_id;
            END IF;

            IF v_supp.jars_in_custody < p_quantity THEN
                RAISE EXCEPTION 'Supplier has insufficient jars in custody. Available: %, Requested: %.', v_supp.jars_in_custody, p_quantity;
            END IF;

            UPDATE public.suppliers
            SET jars_in_custody = jars_in_custody - p_quantity,
                updated_at = pg_catalog.now()
            WHERE id = v_supp.id;

        ELSIF v_src_loc.location_type = 'WAREHOUSE' THEN
            IF p_condition_from = 'FULL_USABLE' THEN
                SELECT quantity_on_hand INTO v_src_wh_full
                FROM public.inventory_balances
                WHERE warehouse_id = v_default_wh_id AND product_id = v_jar_product_id
                FOR UPDATE;

                IF COALESCE(v_src_wh_full, 0) < p_quantity THEN
                    RAISE EXCEPTION 'Warehouse has insufficient full usable jars. Available: %, Requested: %.', COALESCE(v_src_wh_full, 0), p_quantity;
                END IF;

                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand - p_quantity,
                    updated_at = pg_catalog.now()
                WHERE warehouse_id = v_default_wh_id AND product_id = v_jar_product_id;
            ELSE
                SELECT COALESCE(
                    (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = p_condition_from)
                    -
                    (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = p_condition_from),
                    0
                ) INTO v_avail_wh_cond;

                IF v_avail_wh_cond < p_quantity THEN
                    RAISE EXCEPTION 'Warehouse has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_wh_cond, p_quantity;
                END IF;
            END IF;

        ELSIF v_src_loc.location_type IN ('INTERNAL', 'VEHICLE') THEN
            SELECT COALESCE(
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = p_condition_from)
                -
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = p_condition_from),
                0
            ) INTO v_avail_veh_cond;

            IF v_avail_veh_cond < p_quantity THEN
                RAISE EXCEPTION 'Staff vehicle has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_veh_cond, p_quantity;
            END IF;
        END IF;
    END IF;

    -- 4. Update Destination Holdings for All Conditions
    IF v_dst_loc.location_type = 'CUSTOMER' THEN
        SELECT * INTO v_dst_cust FROM public.customers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_cust.id IS NOT NULL THEN
            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_to = 'FULL_USABLE' THEN total_full_jars_holding + p_quantity ELSE total_full_jars_holding END,
                total_empty_clean_holding = CASE WHEN p_condition_to = 'EMPTY_CLEAN' THEN total_empty_clean_holding + p_quantity ELSE total_empty_clean_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_to = 'EMPTY_DIRTY' THEN total_empty_jars_holding + p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding + p_quantity ELSE total_damaged_jars_holding END,
                total_scrap_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_SCRAP' THEN total_scrap_jars_holding + p_quantity ELSE total_scrap_jars_holding END,
                updated_at = pg_catalog.now()
            WHERE id = v_dst_cust.id;
        END IF;

    ELSIF v_dst_loc.location_type = 'SUPPLIER' THEN
        SELECT * INTO v_dst_supp FROM public.suppliers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_supp.id IS NOT NULL THEN
            UPDATE public.suppliers
            SET jars_in_custody = jars_in_custody + p_quantity,
                updated_at = pg_catalog.now()
            WHERE id = v_dst_supp.id;
        END IF;

    ELSIF v_dst_loc.location_type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
        INSERT INTO public.inventory_balances (
            warehouse_id,
            product_id,
            quantity_on_hand,
            updated_at
        ) VALUES (
            v_default_wh_id,
            v_jar_product_id,
            p_quantity,
            pg_catalog.now()
        )
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET
            quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
            updated_at = pg_catalog.now();
    END IF;

    -- 5. Insert Immutable Jar Custody Movement Audit Record
    INSERT INTO public.jar_custody_movements (
        product_id,
        source_location_id,
        destination_location_id,
        condition_from,
        condition_to,
        quantity,
        movement_type,
        reference_type,
        reference_id,
        notes,
        created_by
    ) VALUES (
        v_jar_product_id,
        p_source_location_id,
        p_destination_location_id,
        p_condition_from,
        p_condition_to,
        p_quantity,
        p_movement_type,
        COALESCE(p_reference_type, 'MANUAL'),
        p_reference_id,
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_movement_id;

    -- Dual-entry stock movement if warehouse full usable inventory affected
    IF v_dst_loc.location_type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
        INSERT INTO public.stock_movements (
            warehouse_id,
            product_id,
            movement_type,
            quantity,
            reference_type,
            reference_id,
            notes,
            created_by
        ) VALUES (
            v_default_wh_id,
            v_jar_product_id,
            'IN',
            p_quantity,
            'JAR_MOVEMENT',
            v_movement_id,
            'Jar movement inbound to warehouse stock',
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'movement_id', v_movement_id,
        'quantity', p_quantity,
        'condition_from', p_condition_from,
        'condition_to', p_condition_to,
        'movement_type', p_movement_type
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_record_jar_movement(UUID, UUID, VARCHAR, VARCHAR, INT, VARCHAR, VARCHAR, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_record_jar_movement(UUID, UUID, VARCHAR, VARCHAR, INT, VARCHAR, VARCHAR, UUID, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. HARDENED ORDER CREATION WITH AUTHORITATIVE PRICING, GST & IDEMPOTENCY LOCK
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_create_customer_order(
    p_customer_id UUID,
    p_delivery_address TEXT DEFAULT NULL,
    p_delivery_date DATE DEFAULT NULL,
    p_assigned_staff_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_price_override_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_customer RECORD;
    v_order_id UUID;
    v_order_num VARCHAR(50);
    v_invoice_id UUID;
    v_invoice_num VARCHAR(50);
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
    v_item RECORD;
    v_product RECORD;
    v_special_price NUMERIC(12,2);
    v_base_unit_price NUMERIC(12,2);
    v_final_unit_price NUMERIC(12,2);
    v_is_overridden BOOLEAN;
    v_item_subtotal NUMERIC(12,2);
    v_item_tax NUMERIC(12,2);
    v_item_total NUMERIC(12,2);
    v_existing_order_id UUID;
    v_existing_order_num VARCHAR(50);
    v_existing_total NUMERIC(12,2);
    v_client_tax NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_orders')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have order creation authority.';
    END IF;

    -- Concurrency-Safe Idempotency: acquire transactional advisory lock on hash of key
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        PERFORM pg_advisory_xact_lock(hashtext('order_idemp_' || trim(p_idempotency_key)));

        SELECT id, order_number, total_amount INTO v_existing_order_id, v_existing_order_num, v_existing_total
        FROM public.orders
        WHERE idempotency_key = trim(p_idempotency_key);

        IF FOUND THEN
            SELECT id, invoice_number INTO v_invoice_id, v_invoice_num
            FROM public.invoices
            WHERE order_id = v_existing_order_id
            LIMIT 1;

            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'order_id', v_existing_order_id,
                'order_number', v_existing_order_num,
                'invoice_id', v_invoice_id,
                'invoice_number', v_invoice_num,
                'total_amount', v_existing_total
            );
        END IF;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order items array cannot be empty.';
    END IF;

    -- Lock customer record FOR UPDATE
    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found or inactive.';
    END IF;

    -- 1. Calculate order totals using AUTHORITATIVE product prices and tax rates from database
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        quantity INT,
        unit_price NUMERIC,
        gst_rate NUMERIC,
        tax_rate NUMERIC
    )
    LOOP
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be a positive integer.';
        END IF;

        SELECT id, name, price, gst_rate INTO v_product
        FROM public.products
        WHERE id = v_item.product_id AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found or inactive.', v_item.product_id;
        END IF;

        -- Authoritative GST rate validation: Reject any attempt to tamper with tax rate
        v_client_tax := COALESCE(v_item.tax_rate, v_item.gst_rate);
        IF v_client_tax IS NOT NULL AND v_client_tax != v_product.gst_rate THEN
            RAISE EXCEPTION 'Invalid tax rate submitted (%). Authoritative tax rate is %.',
                v_client_tax, v_product.gst_rate;
        END IF;

        -- Check customer-specific agreed special price
        SELECT special_price INTO v_special_price
        FROM public.customer_special_prices
        WHERE customer_id = p_customer_id AND product_id = v_item.product_id AND is_active = true;

        v_base_unit_price := COALESCE(v_special_price, v_product.price);

        -- Authoritative price validation:
        -- Ordinary staff MUST use standard or customer-special price.
        -- Only Owner can authorize custom discounts or overridden prices.
        IF v_item.unit_price IS NOT NULL AND v_item.unit_price != v_base_unit_price THEN
            IF v_caller_role != 'owner' THEN
                RAISE EXCEPTION 'Unauthorized price override: only the business owner can authorize price overrides or custom discounts. Product: %, Standard: %, Submitted: %.',
                    v_product.name, v_base_unit_price, v_item.unit_price;
            END IF;

            IF v_item.unit_price < 0 THEN
                RAISE EXCEPTION 'Overridden unit price cannot be negative. Submitted: %.', v_item.unit_price;
            END IF;

            -- Mandatory price override reason validation (minimum 5 non-whitespace chars)
            IF p_price_override_reason IS NULL OR length(trim(p_price_override_reason)) < 5 THEN
                RAISE EXCEPTION 'Price override requires a valid business reason (minimum 5 characters).';
            END IF;

            v_final_unit_price := v_item.unit_price;
            v_is_overridden := true;
        ELSE
            v_final_unit_price := v_base_unit_price;
            v_is_overridden := false;
        END IF;

        -- Tax and line calculations strictly computed database-side
        v_item_subtotal := v_final_unit_price * v_item.quantity;
        v_item_tax := pg_catalog.round(v_item_subtotal * (v_product.gst_rate / 100.0), 2);
        v_item_total := v_item_subtotal + v_item_tax;

        v_subtotal := v_subtotal + v_item_subtotal;
        v_tax_total := v_tax_total + v_item_tax;
    END LOOP;

    v_total_amount := v_subtotal + v_tax_total;
    v_order_num := 'ORD-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 2. Insert master order
    INSERT INTO public.orders (
        order_number,
        customer_id,
        delivery_address,
        delivery_date,
        assigned_staff_id,
        status,
        payment_status,
        subtotal,
        tax_total,
        total_amount,
        notes,
        idempotency_key,
        created_by
    ) VALUES (
        v_order_num,
        p_customer_id,
        COALESCE(p_delivery_address, v_customer.address),
        COALESCE(p_delivery_date, CURRENT_DATE),
        p_assigned_staff_id,
        CASE WHEN p_assigned_staff_id IS NOT NULL THEN 'ASSIGNED' ELSE 'PENDING' END,
        'UNPAID',
        v_subtotal,
        v_tax_total,
        v_total_amount,
        p_notes,
        p_idempotency_key,
        v_caller_id
    ) RETURNING id INTO v_order_id;

    -- 3. Insert line items with pricing audit trail
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        quantity INT,
        unit_price NUMERIC,
        gst_rate NUMERIC,
        tax_rate NUMERIC
    )
    LOOP
        SELECT id, name, price, gst_rate INTO v_product FROM public.products WHERE id = v_item.product_id;
        SELECT special_price INTO v_special_price FROM public.customer_special_prices WHERE customer_id = p_customer_id AND product_id = v_item.product_id AND is_active = true;
        v_base_unit_price := COALESCE(v_special_price, v_product.price);

        IF v_item.unit_price IS NOT NULL AND v_item.unit_price != v_base_unit_price AND v_caller_role = 'owner' THEN
            v_final_unit_price := v_item.unit_price;
            v_is_overridden := true;
        ELSE
            v_final_unit_price := v_base_unit_price;
            v_is_overridden := false;
        END IF;

        v_item_subtotal := v_final_unit_price * v_item.quantity;
        v_item_tax := pg_catalog.round(v_item_subtotal * (v_product.gst_rate / 100.0), 2);
        v_item_total := v_item_subtotal + v_item_tax;

        INSERT INTO public.order_items (
            order_id,
            product_id,
            quantity,
            unit_price,
            tax_rate,
            tax_amount,
            total_amount,
            original_price,
            is_price_overridden,
            override_reason,
            authorized_by
        ) VALUES (
            v_order_id,
            v_item.product_id,
            v_item.quantity,
            v_final_unit_price,
            v_product.gst_rate,
            v_item_tax,
            v_item_total,
            v_base_unit_price,
            v_is_overridden,
            CASE WHEN v_is_overridden THEN p_price_override_reason ELSE NULL END,
            CASE WHEN v_is_overridden THEN v_caller_id ELSE NULL END
        );
    END LOOP;

    -- 4. Create delivery stop if assigned to driver
    IF p_assigned_staff_id IS NOT NULL THEN
        INSERT INTO public.delivery_stops (
            order_id,
            assigned_staff_id,
            sequence_number,
            status
        ) VALUES (
            v_order_id,
            p_assigned_staff_id,
            1,
            'ASSIGNED'
        );
    END IF;

    -- 5. Create Accrual Sales Invoice matching exact order totals
    v_invoice_num := 'INV-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);
    INSERT INTO public.invoices (
        invoice_number,
        order_id,
        customer_id,
        subtotal,
        tax_amount,
        total_amount,
        balance_due,
        status,
        invoice_date,
        created_by
    ) VALUES (
        v_invoice_num,
        v_order_id,
        p_customer_id,
        v_subtotal,
        v_tax_total,
        v_total_amount,
        v_total_amount,
        'UNPAID',
        CURRENT_DATE,
        v_caller_id
    ) RETURNING id INTO v_invoice_id;

    -- 6. Increment customer balance (permitted via trigger stack recognition)
    UPDATE public.customers
    SET current_balance = current_balance + v_total_amount,
        updated_at = pg_catalog.now()
    WHERE id = p_customer_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'order_number', v_order_num,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_num,
        'subtotal', v_subtotal,
        'tax_total', v_tax_total,
        'total_amount', v_total_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB, VARCHAR, TEXT) TO authenticated, service_role;


-- ==============================================================================
-- Remediation Round 6: Canonical Schema Compatibility, Invariants and Security
-- ==============================================================================

-- ==============================================================================
-- AquaTrack ERP — Migration: Remediation Round 6
-- Version: 20261104000004_remediation_round_6.sql
-- Description:
--   1. Schema compatibility fixes:
--      - Use locations.type (canonical column, NOT location_type)
--      - Use products.default_sale_price (canonical column, NOT price)
--      - Use customer_special_prices effective_from / effective_to date ranges
--        (canonical schema, NOT non-existent is_active)
--      - Align stock_movements with canonical schema columns:
--        (product_id, source_location_id, destination_location_id, quantity,
--         movement_type, reference_type, reference_id, notes, created_by)
--        and enforce valid CHECK constraint values ('PURCHASE_RECEIPT', 'AUDIT', etc.)
--      - Align jar_custody_movements with canonical schema constraints:
--        enforce valid movement_type and reference_type ('ORDER', 'DELIVERY_STOP',
--        'PURCHASE', 'BATCH_WASH', 'AUDIT')
--   2. Hardened Jar Custody & Asset Conservation:
--      - Complete 5-condition customer custody tracking
--        (FULL_USABLE, EMPTY_CLEAN, EMPTY_DIRTY, DAMAGED_REPAIRABLE, DAMAGED_SCRAP)
--      - Strict condition transition matrix:
--        Washing: EMPTY_DIRTY -> EMPTY_CLEAN
--        Filling: EMPTY_CLEAN -> FULL_USABLE
--        Repair: DAMAGED_REPAIRABLE -> EMPTY_CLEAN or DAMAGED_SCRAP
--        Terminal Scrap: DAMAGED_SCRAP cannot be restored to usable/repairable
--      - Strict supplier purchase validation:
--        Source must be supplier (locations.type = 'SUPPLIER')
--        Destination must be warehouse (locations.type = 'WAREHOUSE')
--        Mandatory purchase reference validated against public.purchases and public.purchase_items
--        Prevents receiving more jars than remaining receivable quantity
--        Customer cannot be supplier source; ordinary movements cannot fabricate stock
--      - Opening stock: owner-only authorized operation
--      - Deterministic row-locking in UUID order to prevent deadlocks
--   3. Hardened Order Creation (rpc_create_customer_order):
--      - Authoritative product pricing from products.default_sale_price
--      - Customer special pricing checked against active date ranges
--      - Owner-only price override requiring mandatory business reason (min 5 chars)
--      - Authoritative GST validation: reject client tax tampering
--      - Deterministic inventory row locking
--      - Concurrent-safe idempotency via pg_advisory_xact_lock
--   4. Hardened Customer & Supplier Trigger Security:
--      - Call-stack domain scoping: rpc_record_jar_movement can only alter custody holdings;
--        rpc_create_customer_order can only alter current_balance
--      - Staff blocked from direct writes to financial and custody fields
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HARDENED TRIGGER: check_customer_privileged_updates
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_customer_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_stack TEXT;
BEGIN
    v_caller_id := auth.uid();

    -- Inspect PostgreSQL call stack to check if update was initiated by a trusted transactional RPC
    GET DIAGNOSTICS v_stack = PG_CONTEXT;

    -- Internal RPC Authorization Check:
    -- Each RPC is strictly restricted to its authorized domain fields:
    IF v_stack LIKE '%rpc_record_jar_movement%' THEN
        -- Jar movement RPC can ONLY modify jar custody holdings, NEVER financial balances or deposits!
        IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
           (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
            RAISE EXCEPTION 'Access Denied: Jar movement operations cannot modify financial balances or deposits.';
        END IF;
        RETURN NEW;
    END IF;

    IF v_stack LIKE '%rpc_create_customer_order%' THEN
        -- Order creation RPC can ONLY update current_balance, NEVER jar holdings or deposit held!
        IF (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
           (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
           (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
           (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
           (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
           (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
            RAISE EXCEPTION 'Access Denied: Order creation cannot directly modify jar holdings or deposit held.';
        END IF;
        RETURN NEW;
    END IF;

    IF v_stack LIKE '%rpc_execute_delivery_stop%' OR v_stack LIKE '%rpc_record_customer_payment%' THEN
        RETURN NEW;
    END IF;

    -- If caller is authenticated, verify their role from trusted database profiles
    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        -- Authorized owner accounts have administrative override permissions
        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        -- For ordinary staff and direct SQL updates, strictly prohibit modification of privileged fields
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
               (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
               (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
               (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
                RAISE EXCEPTION 'Access Denied: Customer financial balances and jar holdings cannot be directly modified. Use approved transactional workflows.';
            END IF;
        ELSIF TG_OP = 'INSERT' THEN
            IF (NEW.current_balance IS DISTINCT FROM 0.00) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_empty_clean_holding IS DISTINCT FROM 0) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_scrap_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_deposit_held IS DISTINCT FROM 0.00) THEN
                RAISE EXCEPTION 'Access Denied: New customer records must initialize with zero financial balances and jar holdings.';
            END IF;
        END IF;

        -- Standard non-privileged updates (notes, phone, address, contact_name, business_name) are permitted
        RETURN NEW;
    END IF;

    -- If auth.uid() is null: direct maintenance by postgres superuser without PostgREST headers
    IF current_setting('request.jwt.claim.sub', true) IS NULL AND 
       current_setting('request.jwt.claim.role', true) IS NULL THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access Denied: Unauthenticated modification of customer records.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_customer_privileged_fields ON public.customers;
CREATE TRIGGER trg_protect_customer_privileged_fields
    BEFORE INSERT OR UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_customer_privileged_updates();

-- ------------------------------------------------------------------------------
-- 2. HARDENED TRIGGER: check_supplier_privileged_updates
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_supplier_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_stack TEXT;
BEGIN
    v_caller_id := auth.uid();

    GET DIAGNOSTICS v_stack = PG_CONTEXT;

    IF v_stack LIKE '%rpc_record_jar_movement%' THEN
        -- Jar movement RPC can ONLY modify jars_in_custody, NEVER current_payable!
        IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) THEN
            RAISE EXCEPTION 'Access Denied: Jar movements cannot modify supplier payable balances.';
        END IF;
        RETURN NEW;
    END IF;

    IF v_stack LIKE '%rpc_receive_purchase_order%' OR 
       v_stack LIKE '%rpc_record_supplier_payment%' THEN
        RETURN NEW;
    END IF;

    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) OR
               (NEW.jars_in_custody IS DISTINCT FROM OLD.jars_in_custody) THEN
                RAISE EXCEPTION 'Access Denied: Supplier payables and jar custody cannot be directly modified. Use approved purchase and payment workflows.';
            END IF;
        ELSIF TG_OP = 'INSERT' THEN
            IF (NEW.current_payable IS DISTINCT FROM 0.00) OR
               (NEW.jars_in_custody IS DISTINCT FROM 0) THEN
                RAISE EXCEPTION 'Access Denied: New supplier records must initialize with zero payable and custody.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    IF current_setting('request.jwt.claim.sub', true) IS NULL AND 
       current_setting('request.jwt.claim.role', true) IS NULL THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access Denied: Unauthenticated modification of supplier records.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_supplier_privileged_fields ON public.suppliers;
CREATE TRIGGER trg_protect_supplier_privileged_fields
    BEFORE INSERT OR UPDATE ON public.suppliers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_supplier_privileged_updates();

-- ------------------------------------------------------------------------------
-- 3. HARDENED JAR MOVEMENT RPC (rpc_record_jar_movement)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_record_jar_movement(
    p_source_location_id UUID,
    p_destination_location_id UUID,
    p_condition_from VARCHAR,
    p_condition_to VARCHAR,
    p_quantity INT,
    p_movement_type VARCHAR,
    p_reference_type VARCHAR DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_jar_product_id UUID;
    v_movement_id UUID;
    v_default_wh_id UUID;
    v_wh_location_id UUID;
    v_src_loc RECORD;
    v_dst_loc RECORD;
    v_src_wh_full INT := 0;
    v_avail_wh_cond INT := 0;
    v_avail_veh_cond INT := 0;
    v_cust RECORD;
    v_supp RECORD;
    v_dst_cust RECORD;
    v_dst_supp RECORD;
    v_po RECORD;
    v_po_item RECORD;
    v_remaining_qty INT;
    v_inserted_movement_type VARCHAR(40);
    v_inserted_ref_type VARCHAR(30);
    v_stock_m_type VARCHAR(40);
    v_stock_ref_type VARCHAR(30);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    -- Staff authorization: only owner, warehouse staff, or delivery drivers
    IF v_caller_role != 'owner' AND 
       (v_perms->>'can_warehouse')::boolean != true AND
       (v_perms->>'can_deliveries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have jar movement authority.';
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero.';
    END IF;

    -- Validate all 5 allowed conditions
    IF p_condition_from NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_from: %', p_condition_from;
    END IF;
    IF p_condition_to NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_to: %', p_condition_to;
    END IF;

    -- Validate supported movement types
    IF p_movement_type NOT IN (
        'CUSTOMER_DELIVERY', 'CUSTOMER_EMPTY_RETURN', 'DAMAGED_COLLECTED',
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL',
        'REPAIR_CYCLE', 'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT',
        'DISPATCH_TO_VEHICLE', 'VEHICLE_RETURN_TO_WAREHOUSE',
        'SUPPLIER_PURCHASE', 'RETURN_TO_SUPPLIER', 'OPENING_STOCK'
    ) THEN
        RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
    END IF;

    -- Strict condition transition matrix:
    -- 1. Scrapped jars are terminal: can NEVER be restored to usable or repairable condition
    IF p_condition_from = 'DAMAGED_SCRAP' AND p_condition_to != 'DAMAGED_SCRAP' THEN
        RAISE EXCEPTION 'Scrapped jars cannot be restored to usable or repairable condition. Scrap is terminal.';
    END IF;

    -- 2. Washing cycle requires dirty -> clean
    IF p_movement_type = 'WASHING_CYCLE_DIRTY_TO_CLEAN' THEN
        IF p_condition_from != 'EMPTY_DIRTY' OR p_condition_to != 'EMPTY_CLEAN' THEN
            RAISE EXCEPTION 'Washing cycle requires EMPTY_DIRTY -> EMPTY_CLEAN transition.';
        END IF;
    END IF;

    -- 3. Filling cycle requires clean -> full
    IF p_movement_type = 'FILLING_CYCLE_CLEAN_TO_FULL' THEN
        IF p_condition_from != 'EMPTY_CLEAN' OR p_condition_to != 'FULL_USABLE' THEN
            RAISE EXCEPTION 'Filling cycle requires EMPTY_CLEAN -> FULL_USABLE transition.';
        END IF;
    END IF;

    -- 4. Repair cycle requires repairable -> clean or scrap
    IF p_movement_type = 'REPAIR_CYCLE' THEN
        IF p_condition_from != 'DAMAGED_REPAIRABLE' OR p_condition_to NOT IN ('EMPTY_CLEAN', 'DAMAGED_SCRAP') THEN
            RAISE EXCEPTION 'Repair cycle requires DAMAGED_REPAIRABLE -> EMPTY_CLEAN or DAMAGED_SCRAP transition.';
        END IF;
    END IF;

    -- 5. Scrap write-off requires terminal scrap destination
    IF p_movement_type = 'SCRAP_WRITEOFF' THEN
        IF p_condition_from NOT IN ('DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') OR p_condition_to != 'DAMAGED_SCRAP' THEN
            RAISE EXCEPTION 'Scrap writeoff requires DAMAGED_REPAIRABLE/DAMAGED_SCRAP -> DAMAGED_SCRAP transition.';
        END IF;
    END IF;

    -- 6. Disallow condition changes on ordinary movements (asset conservation invariant)
    IF p_condition_from != p_condition_to AND p_movement_type NOT IN (
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL', 'REPAIR_CYCLE', 'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT'
    ) THEN
        RAISE EXCEPTION 'Condition transition from % to % is not permitted under movement type %.',
            p_condition_from, p_condition_to, p_movement_type;
    END IF;

    -- 7. Disallow arbitrary condition jumping through generic adjustments
    IF p_movement_type = 'INTERNAL_ADJUSTMENT' AND p_condition_from != p_condition_to THEN
        IF NOT (p_condition_from = 'DAMAGED_REPAIRABLE' AND p_condition_to IN ('EMPTY_CLEAN', 'DAMAGED_SCRAP')) THEN
            RAISE EXCEPTION 'Internal adjustment cannot perform arbitrary condition conversion from % to %.',
                p_condition_from, p_condition_to;
        END IF;
    END IF;

    -- Resolve reusable jar product
    SELECT id INTO v_jar_product_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_jar_product_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;

    -- Resolve default central warehouse
    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh_id IS NULL THEN
        RAISE EXCEPTION 'Default warehouse configuration is missing.';
    END IF;

    -- 1. Deadlock-free locking of physical locations (Deterministic UUID ordering)
    -- References canonical column locations.type (NOT location_type)
    IF p_source_location_id = p_destination_location_id THEN
        SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
        v_dst_loc := v_src_loc;
    ELSE
        IF p_source_location_id < p_destination_location_id THEN
            SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
            SELECT * INTO v_dst_loc FROM public.locations WHERE id = p_destination_location_id FOR UPDATE;
        ELSE
            SELECT * INTO v_dst_loc FROM public.locations WHERE id = p_destination_location_id FOR UPDATE;
            SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
        END IF;
    END IF;

    IF v_src_loc.id IS NULL THEN
        RAISE EXCEPTION 'Source location % does not exist.', p_source_location_id;
    END IF;
    IF v_dst_loc.id IS NULL THEN
        RAISE EXCEPTION 'Destination location % does not exist.', p_destination_location_id;
    END IF;

    -- 2. Strict Supplier Purchase & Inflow Validation
    IF p_movement_type = 'SUPPLIER_PURCHASE' THEN
        -- Source MUST be a valid supplier location
        IF v_src_loc.type != 'SUPPLIER' THEN
            RAISE EXCEPTION 'Supplier purchase source must be a supplier location. Location % is %.',
                p_source_location_id, v_src_loc.type;
        END IF;

        -- Destination MUST be the central warehouse
        IF v_dst_loc.type != 'WAREHOUSE' THEN
            RAISE EXCEPTION 'Supplier purchase destination must be a warehouse location. Location % is %.',
                p_destination_location_id, v_dst_loc.type;
        END IF;

        -- Reference ID is mandatory for supplier purchase
        IF p_reference_id IS NULL THEN
            RAISE EXCEPTION 'Supplier purchase requires a mandatory purchase reference ID.';
        END IF;

        SELECT * INTO v_supp FROM public.suppliers WHERE location_id = p_source_location_id FOR UPDATE;
        IF v_supp.id IS NULL THEN
            RAISE EXCEPTION 'Supplier record not found for location %.', p_source_location_id;
        END IF;

        SELECT * INTO v_po FROM public.purchases WHERE id = p_reference_id FOR UPDATE;
        IF v_po.id IS NULL THEN
            RAISE EXCEPTION 'Purchase order % not found.', p_reference_id;
        END IF;

        IF v_po.supplier_id != v_supp.id THEN
            RAISE EXCEPTION 'Purchase order % does not belong to supplier %.', p_reference_id, v_supp.id;
        END IF;

        IF v_po.status = 'CANCELLED' THEN
            RAISE EXCEPTION 'Cannot receive jars against cancelled purchase order %.', p_reference_id;
        END IF;

        -- Check remaining receivable quantity on purchase order item
        SELECT * INTO v_po_item FROM public.purchase_items
        WHERE purchase_id = v_po.id AND product_id = v_jar_product_id
        FOR UPDATE;

        IF v_po_item.id IS NULL THEN
            RAISE EXCEPTION 'Purchase order % does not contain jar product %.', p_reference_id, v_jar_product_id;
        END IF;

        v_remaining_qty := v_po_item.quantity_ordered - v_po_item.quantity_received;
        IF p_quantity > v_remaining_qty THEN
            RAISE EXCEPTION 'Cannot receive % jars: remaining receivable quantity on purchase order % is % (ordered: %, received: %).',
                p_quantity, p_reference_id, v_remaining_qty, v_po_item.quantity_ordered, v_po_item.quantity_received;
        END IF;

        -- Update purchase order item received count
        UPDATE public.purchase_items
        SET quantity_received = quantity_received + p_quantity
        WHERE id = v_po_item.id;

        -- If all items fully received, mark purchase order as RECEIVED
        IF NOT EXISTS (
            SELECT 1 FROM public.purchase_items
            WHERE purchase_id = v_po.id AND quantity_received < quantity_ordered
        ) THEN
            UPDATE public.purchases
            SET status = 'RECEIVED',
                received_at = pg_catalog.now(),
                updated_at = pg_catalog.now()
            WHERE id = v_po.id;
        END IF;

        v_inserted_ref_type := 'PURCHASE';

    ELSIF p_movement_type = 'OPENING_STOCK' THEN
        IF v_caller_role != 'owner' THEN
            RAISE EXCEPTION 'Only the business owner can record initial opening stock entries.';
        END IF;
        IF v_dst_loc.type != 'WAREHOUSE' THEN
            RAISE EXCEPTION 'Opening stock destination must be a warehouse location.';
        END IF;

        v_inserted_ref_type := 'AUDIT';

    ELSE
        -- 3. Strict Source Balance Verification for All Ordinary Movements (Prevents stock fabrication)
        IF v_src_loc.type = 'CUSTOMER' THEN
            SELECT * INTO v_cust FROM public.customers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_cust.id IS NULL THEN
                RAISE EXCEPTION 'Customer at location % not found.', p_source_location_id;
            END IF;

            -- Check specific condition holding on customer
            IF p_condition_from = 'FULL_USABLE' AND v_cust.total_full_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient full jars. Available: %, Requested: %.', v_cust.total_full_jars_holding, p_quantity;
            ELSIF p_condition_from = 'EMPTY_CLEAN' AND COALESCE(v_cust.total_empty_clean_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient clean empty jars. Available: %, Requested: %.', COALESCE(v_cust.total_empty_clean_holding, 0), p_quantity;
            ELSIF p_condition_from = 'EMPTY_DIRTY' AND v_cust.total_empty_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient dirty empty jars. Available: %, Requested: %.', v_cust.total_empty_jars_holding, p_quantity;
            ELSIF p_condition_from = 'DAMAGED_REPAIRABLE' AND COALESCE(v_cust.total_damaged_jars_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient damaged repairable jars. Available: %, Requested: %.', COALESCE(v_cust.total_damaged_jars_holding, 0), p_quantity;
            ELSIF p_condition_from = 'DAMAGED_SCRAP' AND COALESCE(v_cust.total_scrap_jars_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient scrap jars. Available: %, Requested: %.', COALESCE(v_cust.total_scrap_jars_holding, 0), p_quantity;
            END IF;

            -- Deduct from exact condition holding
            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_from = 'FULL_USABLE' THEN total_full_jars_holding - p_quantity ELSE total_full_jars_holding END,
                total_empty_clean_holding = CASE WHEN p_condition_from = 'EMPTY_CLEAN' THEN total_empty_clean_holding - p_quantity ELSE total_empty_clean_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_from = 'EMPTY_DIRTY' THEN total_empty_jars_holding - p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding - p_quantity ELSE total_damaged_jars_holding END,
                total_scrap_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_SCRAP' THEN total_scrap_jars_holding - p_quantity ELSE total_scrap_jars_holding END,
                updated_at = pg_catalog.now()
            WHERE id = v_cust.id;

        ELSIF v_src_loc.type = 'SUPPLIER' THEN
            SELECT * INTO v_supp FROM public.suppliers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_supp.id IS NULL THEN
                RAISE EXCEPTION 'Supplier at location % not found.', p_source_location_id;
            END IF;

            IF v_supp.jars_in_custody < p_quantity THEN
                RAISE EXCEPTION 'Supplier has insufficient jars in custody. Available: %, Requested: %.', v_supp.jars_in_custody, p_quantity;
            END IF;

            UPDATE public.suppliers
            SET jars_in_custody = jars_in_custody - p_quantity,
                updated_at = pg_catalog.now()
            WHERE id = v_supp.id;

        ELSIF v_src_loc.type = 'WAREHOUSE' THEN
            IF p_condition_from = 'FULL_USABLE' THEN
                SELECT quantity_on_hand INTO v_src_wh_full
                FROM public.inventory_balances
                WHERE warehouse_id = v_default_wh_id AND product_id = v_jar_product_id
                FOR UPDATE;

                IF COALESCE(v_src_wh_full, 0) < p_quantity THEN
                    RAISE EXCEPTION 'Warehouse has insufficient full usable jars. Available: %, Requested: %.', COALESCE(v_src_wh_full, 0), p_quantity;
                END IF;

                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand - p_quantity,
                    updated_at = pg_catalog.now()
                WHERE warehouse_id = v_default_wh_id AND product_id = v_jar_product_id;
            ELSE
                SELECT COALESCE(
                    (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = p_condition_from)
                    -
                    (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = p_condition_from),
                    0
                ) INTO v_avail_wh_cond;

                IF v_avail_wh_cond < p_quantity THEN
                    RAISE EXCEPTION 'Warehouse has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_wh_cond, p_quantity;
                END IF;
            END IF;

        ELSIF v_src_loc.type = 'VEHICLE' THEN
            SELECT COALESCE(
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = p_condition_from)
                -
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = p_condition_from),
                0
            ) INTO v_avail_veh_cond;

            IF v_avail_veh_cond < p_quantity THEN
                RAISE EXCEPTION 'Staff vehicle has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_veh_cond, p_quantity;
            END IF;
        END IF;

        -- Normalize reference type for ordinary movements
        v_inserted_ref_type := CASE
            WHEN p_reference_type IN ('PURCHASE_ORDER', 'PURCHASE') THEN 'PURCHASE'
            WHEN p_reference_type IN ('ORDER') THEN 'ORDER'
            WHEN p_reference_type IN ('DELIVERY_STOP', 'DELIVERY') THEN 'DELIVERY_STOP'
            WHEN p_reference_type IN ('BATCH_WASH') THEN 'BATCH_WASH'
            WHEN p_reference_type IN ('AUDIT') THEN 'AUDIT'
            ELSE NULL
        END;
    END IF;

    -- 4. Update Destination Holdings for All Conditions
    IF v_dst_loc.type = 'CUSTOMER' THEN
        SELECT * INTO v_dst_cust FROM public.customers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_cust.id IS NOT NULL THEN
            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_to = 'FULL_USABLE' THEN total_full_jars_holding + p_quantity ELSE total_full_jars_holding END,
                total_empty_clean_holding = CASE WHEN p_condition_to = 'EMPTY_CLEAN' THEN total_empty_clean_holding + p_quantity ELSE total_empty_clean_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_to = 'EMPTY_DIRTY' THEN total_empty_jars_holding + p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding + p_quantity ELSE total_damaged_jars_holding END,
                total_scrap_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_SCRAP' THEN total_scrap_jars_holding + p_quantity ELSE total_scrap_jars_holding END,
                updated_at = pg_catalog.now()
            WHERE id = v_dst_cust.id;
        END IF;

    ELSIF v_dst_loc.type = 'SUPPLIER' THEN
        SELECT * INTO v_dst_supp FROM public.suppliers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_supp.id IS NOT NULL THEN
            UPDATE public.suppliers
            SET jars_in_custody = jars_in_custody + p_quantity,
                updated_at = pg_catalog.now()
            WHERE id = v_dst_supp.id;
        END IF;

    ELSIF v_dst_loc.type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
        INSERT INTO public.inventory_balances (
            warehouse_id,
            product_id,
            quantity_on_hand,
            updated_at
        ) VALUES (
            v_default_wh_id,
            v_jar_product_id,
            p_quantity,
            pg_catalog.now()
        )
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET
            quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
            updated_at = pg_catalog.now();
    END IF;

    -- Map movement_type to database CHECK constraint values:
    -- movement_type IN ('CUSTOMER_DELIVERY', 'CUSTOMER_EMPTY_RETURN', 'DAMAGED_COLLECTED',
    --                   'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL',
    --                   'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT', 'DISPATCH_TO_VEHICLE',
    --                   'VEHICLE_RETURN_TO_WAREHOUSE', 'SUPPLIER_PURCHASE', 'RETURN_TO_SUPPLIER')
    v_inserted_movement_type := CASE
        WHEN p_movement_type IN ('OPENING_STOCK', 'REPAIR_CYCLE') THEN 'INTERNAL_ADJUSTMENT'
        ELSE p_movement_type
    END;

    -- 5. Insert Immutable Jar Custody Movement Audit Record
    INSERT INTO public.jar_custody_movements (
        product_id,
        source_location_id,
        destination_location_id,
        condition_from,
        condition_to,
        quantity,
        movement_type,
        reference_type,
        reference_id,
        notes,
        created_by
    ) VALUES (
        v_jar_product_id,
        p_source_location_id,
        p_destination_location_id,
        p_condition_from,
        p_condition_to,
        p_quantity,
        v_inserted_movement_type,
        v_inserted_ref_type,
        p_reference_id,
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_movement_id;

    -- 6. Canonical Dual-Entry Stock Movement when warehouse FULL_USABLE inventory is affected
    -- stock_movements columns: (product_id, source_location_id, destination_location_id, quantity, movement_type, reference_type, reference_id, notes, created_by)
    -- stock_movements movement_type CHECK constraint: ('PURCHASE_RECEIPT', 'POS_SALE', 'DELIVERY_DISPATCH', 'DELIVERY_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SCRAP_WRITEOFF')
    -- stock_movements reference_type CHECK constraint: ('PURCHASE', 'POS_SALE', 'ORDER', 'DELIVERY_STOP', 'AUDIT')
    IF v_dst_loc.type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
        v_stock_m_type := CASE
            WHEN p_movement_type = 'SUPPLIER_PURCHASE' THEN 'PURCHASE_RECEIPT'
            WHEN p_movement_type = 'VEHICLE_RETURN_TO_WAREHOUSE' THEN 'DELIVERY_RETURN'
            ELSE 'ADJUSTMENT_IN'
        END;
        v_stock_ref_type := CASE
            WHEN p_movement_type = 'SUPPLIER_PURCHASE' THEN 'PURCHASE'
            WHEN p_movement_type = 'VEHICLE_RETURN_TO_WAREHOUSE' THEN 'DELIVERY_STOP'
            ELSE 'AUDIT'
        END;

        INSERT INTO public.stock_movements (
            product_id,
            source_location_id,
            destination_location_id,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            notes,
            created_by
        ) VALUES (
            v_jar_product_id,
            p_source_location_id,
            p_destination_location_id,
            p_quantity,
            v_stock_m_type,
            v_stock_ref_type,
            COALESCE(p_reference_id, v_movement_id),
            COALESCE(p_notes, 'Jar movement inbound to warehouse stock'),
            v_caller_id
        );
    ELSIF v_src_loc.type = 'WAREHOUSE' AND p_condition_from = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
        v_stock_m_type := CASE
            WHEN p_movement_type IN ('DISPATCH_TO_VEHICLE', 'CUSTOMER_DELIVERY') THEN 'DELIVERY_DISPATCH'
            ELSE 'ADJUSTMENT_OUT'
        END;
        v_stock_ref_type := CASE
            WHEN p_movement_type IN ('DISPATCH_TO_VEHICLE', 'CUSTOMER_DELIVERY') THEN 'DELIVERY_STOP'
            ELSE 'AUDIT'
        END;

        INSERT INTO public.stock_movements (
            product_id,
            source_location_id,
            destination_location_id,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            notes,
            created_by
        ) VALUES (
            v_jar_product_id,
            p_source_location_id,
            p_destination_location_id,
            p_quantity,
            v_stock_m_type,
            v_stock_ref_type,
            COALESCE(p_reference_id, v_movement_id),
            COALESCE(p_notes, 'Jar movement outbound from warehouse stock'),
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'movement_id', v_movement_id,
        'quantity', p_quantity,
        'condition_from', p_condition_from,
        'condition_to', p_condition_to,
        'movement_type', p_movement_type
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_record_jar_movement(UUID, UUID, VARCHAR, VARCHAR, INT, VARCHAR, VARCHAR, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_record_jar_movement(UUID, UUID, VARCHAR, VARCHAR, INT, VARCHAR, VARCHAR, UUID, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. HARDENED ORDER CREATION RPC (rpc_create_customer_order)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_create_customer_order(
    p_customer_id UUID,
    p_delivery_address TEXT DEFAULT NULL,
    p_delivery_date DATE DEFAULT NULL,
    p_assigned_staff_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_price_override_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_customer RECORD;
    v_order_id UUID;
    v_order_num VARCHAR(50);
    v_invoice_id UUID;
    v_invoice_num VARCHAR(50);
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
    v_item RECORD;
    v_product RECORD;
    v_special_price NUMERIC(12,2);
    v_base_unit_price NUMERIC(12,2);
    v_final_unit_price NUMERIC(12,2);
    v_is_overridden BOOLEAN;
    v_item_subtotal NUMERIC(12,2);
    v_item_tax NUMERIC(12,2);
    v_item_total NUMERIC(12,2);
    v_existing_order_id UUID;
    v_existing_order_num VARCHAR(50);
    v_existing_total NUMERIC(12,2);
    v_client_tax NUMERIC(12,2);
    v_target_date DATE;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_orders')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have order creation authority.';
    END IF;

    -- Concurrency-Safe Idempotency: acquire transactional advisory lock on hash of key
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        PERFORM pg_advisory_xact_lock(hashtext('order_idemp_' || trim(p_idempotency_key)));

        SELECT id, order_number, total_amount INTO v_existing_order_id, v_existing_order_num, v_existing_total
        FROM public.orders
        WHERE idempotency_key = trim(p_idempotency_key);

        IF FOUND THEN
            SELECT id, invoice_number INTO v_invoice_id, v_invoice_num
            FROM public.invoices
            WHERE order_id = v_existing_order_id
            LIMIT 1;

            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'order_id', v_existing_order_id,
                'order_number', v_existing_order_num,
                'invoice_id', v_invoice_id,
                'invoice_number', v_invoice_num,
                'total_amount', v_existing_total
            );
        END IF;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order items array cannot be empty.';
    END IF;

    v_target_date := COALESCE(p_delivery_date, CURRENT_DATE);

    -- Lock customer record FOR UPDATE
    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found or inactive.';
    END IF;

    -- 1. Calculate order totals using AUTHORITATIVE product prices and tax rates from database
    -- Note: Canonical price column is products.default_sale_price (NOT price)
    -- Note: customer_special_prices uses effective_from / effective_to date ranges (NOT is_active)
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        quantity INT,
        unit_price NUMERIC,
        gst_rate NUMERIC,
        tax_rate NUMERIC
    )
    LOOP
        IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be a positive integer.';
        END IF;

        SELECT id, name, default_sale_price, gst_rate INTO v_product
        FROM public.products
        WHERE id = v_item.product_id AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found or inactive.', v_item.product_id;
        END IF;

        -- Authoritative GST rate validation: Reject any attempt to tamper with tax rate
        v_client_tax := COALESCE(v_item.tax_rate, v_item.gst_rate);
        IF v_client_tax IS NOT NULL AND v_client_tax != v_product.gst_rate THEN
            RAISE EXCEPTION 'Invalid tax rate submitted (%). Authoritative tax rate is %.',
                v_client_tax, v_product.gst_rate;
        END IF;

        -- Check customer-specific agreed special price valid for the target date
        SELECT special_price INTO v_special_price
        FROM public.customer_special_prices
        WHERE customer_id = p_customer_id 
          AND product_id = v_item.product_id 
          AND effective_from <= v_target_date
          AND (effective_to IS NULL OR effective_to >= v_target_date)
        ORDER BY effective_from DESC
        LIMIT 1;

        v_base_unit_price := COALESCE(v_special_price, v_product.default_sale_price);

        -- Authoritative price validation:
        -- Ordinary staff MUST use standard or customer-special price.
        -- Only Owner can authorize custom discounts or overridden prices.
        IF v_item.unit_price IS NOT NULL AND v_item.unit_price != v_base_unit_price THEN
            IF v_caller_role != 'owner' THEN
                RAISE EXCEPTION 'Unauthorized price override: only the business owner can authorize price overrides or custom discounts. Product: %, Standard: %, Submitted: %.',
                    v_product.name, v_base_unit_price, v_item.unit_price;
            END IF;

            IF v_item.unit_price < 0 THEN
                RAISE EXCEPTION 'Overridden unit price cannot be negative. Submitted: %.', v_item.unit_price;
            END IF;

            -- Mandatory price override reason validation (minimum 5 non-whitespace chars)
            IF p_price_override_reason IS NULL OR length(trim(p_price_override_reason)) < 5 THEN
                RAISE EXCEPTION 'Price override requires a valid business reason (minimum 5 characters).';
            END IF;

            v_final_unit_price := v_item.unit_price;
            v_is_overridden := true;
        ELSE
            v_final_unit_price := v_base_unit_price;
            v_is_overridden := false;
        END IF;

        -- Tax and line calculations strictly computed database-side
        v_item_subtotal := v_final_unit_price * v_item.quantity;
        v_item_tax := pg_catalog.round(v_item_subtotal * (v_product.gst_rate / 100.0), 2);
        v_item_total := v_item_subtotal + v_item_tax;

        v_subtotal := v_subtotal + v_item_subtotal;
        v_tax_total := v_tax_total + v_item_tax;
    END LOOP;

    v_total_amount := v_subtotal + v_tax_total;
    v_order_num := 'ORD-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 2. Insert master order
    INSERT INTO public.orders (
        order_number,
        customer_id,
        delivery_address,
        delivery_date,
        assigned_staff_id,
        status,
        payment_status,
        subtotal,
        tax_total,
        total_amount,
        notes,
        idempotency_key,
        created_by
    ) VALUES (
        v_order_num,
        p_customer_id,
        COALESCE(p_delivery_address, v_customer.address),
        v_target_date,
        p_assigned_staff_id,
        CASE WHEN p_assigned_staff_id IS NOT NULL THEN 'ASSIGNED' ELSE 'PENDING' END,
        'UNPAID',
        v_subtotal,
        v_tax_total,
        v_total_amount,
        p_notes,
        p_idempotency_key,
        v_caller_id
    ) RETURNING id INTO v_order_id;

    -- 3. Insert line items with pricing audit trail
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        quantity INT,
        unit_price NUMERIC,
        gst_rate NUMERIC,
        tax_rate NUMERIC
    )
    LOOP
        SELECT id, name, default_sale_price, gst_rate INTO v_product 
        FROM public.products 
        WHERE id = v_item.product_id;

        SELECT special_price INTO v_special_price 
        FROM public.customer_special_prices 
        WHERE customer_id = p_customer_id 
          AND product_id = v_item.product_id 
          AND effective_from <= v_target_date
          AND (effective_to IS NULL OR effective_to >= v_target_date)
        ORDER BY effective_from DESC
        LIMIT 1;

        v_base_unit_price := COALESCE(v_special_price, v_product.default_sale_price);

        IF v_item.unit_price IS NOT NULL AND v_item.unit_price != v_base_unit_price AND v_caller_role = 'owner' THEN
            v_final_unit_price := v_item.unit_price;
            v_is_overridden := true;
        ELSE
            v_final_unit_price := v_base_unit_price;
            v_is_overridden := false;
        END IF;

        v_item_subtotal := v_final_unit_price * v_item.quantity;
        v_item_tax := pg_catalog.round(v_item_subtotal * (v_product.gst_rate / 100.0), 2);
        v_item_total := v_item_subtotal + v_item_tax;

        INSERT INTO public.order_items (
            order_id,
            product_id,
            quantity,
            unit_price,
            tax_rate,
            tax_amount,
            total_amount,
            original_price,
            is_price_overridden,
            override_reason,
            authorized_by
        ) VALUES (
            v_order_id,
            v_item.product_id,
            v_item.quantity,
            v_final_unit_price,
            v_product.gst_rate,
            v_item_tax,
            v_item_total,
            v_base_unit_price,
            v_is_overridden,
            CASE WHEN v_is_overridden THEN p_price_override_reason ELSE NULL END,
            CASE WHEN v_is_overridden THEN v_caller_id ELSE NULL END
        );
    END LOOP;

    -- 4. Create delivery stop if assigned to driver
    IF p_assigned_staff_id IS NOT NULL THEN
        INSERT INTO public.delivery_stops (
            order_id,
            assigned_staff_id,
            sequence_number,
            status
        ) VALUES (
            v_order_id,
            p_assigned_staff_id,
            1,
            'ASSIGNED'
        );
    END IF;

    -- 5. Create Accrual Sales Invoice matching exact order totals
    v_invoice_num := 'INV-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);
    INSERT INTO public.invoices (
        invoice_number,
        order_id,
        customer_id,
        subtotal,
        tax_amount,
        total_amount,
        balance_due,
        status,
        invoice_date,
        created_by
    ) VALUES (
        v_invoice_num,
        v_order_id,
        p_customer_id,
        v_subtotal,
        v_tax_total,
        v_total_amount,
        v_total_amount,
        'UNPAID',
        CURRENT_DATE,
        v_caller_id
    ) RETURNING id INTO v_invoice_id;

    -- 6. Increment customer balance (permitted via trigger stack recognition)
    UPDATE public.customers
    SET current_balance = current_balance + v_total_amount,
        updated_at = pg_catalog.now()
    WHERE id = p_customer_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'order_number', v_order_num,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_num,
        'subtotal', v_subtotal,
        'tax_total', v_tax_total,
        'total_amount', v_total_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB, VARCHAR, TEXT) TO authenticated, service_role;


-- ==============================================================================
-- ROUND 7 REMEDIATION: 20261104000005_remediation_round_7.sql
-- ==============================================================================

-- ==============================================================================
-- AquaTrack ERP — Migration: Round 7 Remediation
-- Version: 20261104000005_remediation_round_7.sql
-- Description:
--   1. Real Warehouse Identity: Enforce singleton canonical warehouse constraint
--      and reject any mismatched warehouse locations across all stock operations.
--   2. Scrap-Yard Stock Conservation: Prevent stock fabrication from SCRAP_YARD.
--      Every source location (WAREHOUSE, VEHICLE, CUSTOMER, SUPPLIER, SCRAP_YARD)
--      locks and validates available source balance before any outgoing movement.
--      Scrapped jars are strictly terminal.
--   3. Destination Relationship Validation: CUSTOMER and SUPPLIER destination
--      locations must reference real, active business records; transactions reject
--      with explicit exceptions instead of silently skipping balance updates.
--   4. Order Inventory Lifecycle & Reservation: rpc_create_customer_order locks
--      inventory_balances rows in deterministic order and reserves stock
--      (quantity_reserved) to prevent overselling. Delivery stop completion
--      deducts quantity_on_hand and releases quantity_reserved. Cancelled orders
--      release reserved inventory atomically.
--   5. Internal RPC Authorization & Trigger Security: Dedicated, non-accessible
--      table public.internal_rpc_auth_tokens tied to txid_current() and auth.uid()
--      with strict domain scoping. Completely prevents direct table bypass while
--      safely permitting authorized transactional RPCs.
--   6. Strict Supplier Purchase Validation: Mandatory purchase order reference,
--      supplier location matching, remaining receivable quantity limit enforcement,
--      and automatic PO status updates.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ENFORCE REAL WAREHOUSE IDENTITY (Singleton Database Enforcement)
-- ------------------------------------------------------------------------------

-- Ensure public.warehouses strictly enforces exactly one canonical central warehouse
CREATE UNIQUE INDEX IF NOT EXISTS uq_singleton_warehouse ON public.warehouses ((true));

ALTER TABLE public.warehouses DROP CONSTRAINT IF EXISTS chk_single_default_warehouse;
ALTER TABLE public.warehouses ADD CONSTRAINT chk_single_default_warehouse CHECK (is_default = true);

-- Ensure all custody condition balance columns exist on public.customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_damaged_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_damaged_jars_holding >= 0);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_empty_clean_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_empty_clean_holding >= 0);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_scrap_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_scrap_jars_holding >= 0);

-- ------------------------------------------------------------------------------
-- 2. INTERNAL RPC AUTHORIZATION INFRASTRUCTURE (Unforgeable Domain Tokens)
-- ------------------------------------------------------------------------------

-- Internal table to store transaction-scoped RPC execution tokens
-- Strictly inaccessible to ordinary callers (even authenticated) via direct PostgREST/SQL
CREATE TABLE IF NOT EXISTS public.internal_rpc_auth_tokens (
    token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    txid BIGINT NOT NULL,
    rpc_name VARCHAR(80) NOT NULL,
    authorized_user_id UUID NOT NULL,
    allowed_scope VARCHAR(80) NOT NULL, -- 'JAR_CUSTODY_ONLY', 'CUSTOMER_ORDER_BALANCE_ONLY', 'DELIVERY_STOP_EXECUTION', 'SUPPLIER_PAYABLE_ONLY'
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_internal_rpc_auth_txid ON public.internal_rpc_auth_tokens (txid, authorized_user_id);

-- Enforce RLS and revoke ALL direct access from public, anon, and authenticated roles
ALTER TABLE public.internal_rpc_auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_rpc_auth_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.internal_rpc_auth_tokens FROM PUBLIC, anon, authenticated;

-- Trusted helper to establish internal RPC authorization context
CREATE OR REPLACE FUNCTION public._internal_establish_rpc_context(
    p_rpc_name VARCHAR,
    p_allowed_scope VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller UUID;
    v_txid BIGINT;
BEGIN
    v_caller := auth.uid();
    IF v_caller IS NULL THEN
        -- Allow internal superuser / migration scripts executing without PostgREST headers
        IF current_setting('request.jwt.claim.sub', true) IS NULL AND
           current_setting('request.jwt.claim.role', true) IS NULL THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'Cannot establish internal RPC authorization context for unauthenticated caller.';
    END IF;

    v_txid := txid_current();

    -- Clean up any historical tokens older than 10 minutes
    DELETE FROM public.internal_rpc_auth_tokens WHERE created_at < clock_timestamp() - INTERVAL '10 minutes';

    INSERT INTO public.internal_rpc_auth_tokens (
        txid,
        rpc_name,
        authorized_user_id,
        allowed_scope
    ) VALUES (
        v_txid,
        p_rpc_name,
        v_caller,
        p_allowed_scope
    );
END;
$$;

REVOKE ALL ON FUNCTION public._internal_establish_rpc_context(VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;

-- Trusted helper to clear internal RPC authorization context
CREATE OR REPLACE FUNCTION public._internal_clear_rpc_context()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    DELETE FROM public.internal_rpc_auth_tokens WHERE txid = txid_current();
END;
$$;

REVOKE ALL ON FUNCTION public._internal_clear_rpc_context() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. HARDENED TRIGGER: check_customer_privileged_updates
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_customer_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_auth_scope VARCHAR;
    v_auth_rpc VARCHAR;
BEGIN
    v_caller_id := auth.uid();

    -- Check for an active, unforgeable transaction token in internal_rpc_auth_tokens
    SELECT allowed_scope, rpc_name INTO v_auth_scope, v_auth_rpc
    FROM public.internal_rpc_auth_tokens
    WHERE txid = txid_current() AND authorized_user_id = v_caller_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_auth_scope IS NOT NULL THEN
        -- 1. JAR_CUSTODY_ONLY: Can ONLY modify jar custody holdings, NEVER financial balance or deposit!
        IF v_auth_scope = 'JAR_CUSTODY_ONLY' THEN
            IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
               (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
                RAISE EXCEPTION 'Access Denied: Jar custody operations cannot modify financial balances or deposits.';
            END IF;
            RETURN NEW;
        END IF;

        -- 2. CUSTOMER_ORDER_BALANCE_ONLY: Can ONLY update current_balance, NEVER jar holdings or deposit held!
        IF v_auth_scope = 'CUSTOMER_ORDER_BALANCE_ONLY' THEN
            IF (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
               (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
               (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
               (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
                RAISE EXCEPTION 'Access Denied: Customer order creation cannot modify jar holdings or deposit held.';
            END IF;
            RETURN NEW;
        END IF;

        -- 3. DELIVERY_STOP_EXECUTION: Permitted to update delivered custody holdings and route payments
        IF v_auth_scope = 'DELIVERY_STOP_EXECUTION' THEN
            RETURN NEW;
        END IF;
    END IF;

    -- If caller is authenticated, check their role in public.profiles
    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        -- Business owner accounts have administrative override permissions
        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        -- For ordinary staff and direct table writes, strictly prohibit modification of privileged fields
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
               (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
               (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
               (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
                RAISE EXCEPTION 'Access Denied: Customer financial balances and jar holdings cannot be directly modified. Direct updates are prohibited.';
            END IF;
        ELSIF TG_OP = 'INSERT' THEN
            IF (NEW.current_balance IS DISTINCT FROM 0.00) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_empty_clean_holding IS DISTINCT FROM 0) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_scrap_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_deposit_held IS DISTINCT FROM 0.00) THEN
                RAISE EXCEPTION 'Access Denied: New customer records must initialize with zero financial balances and jar holdings.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    -- If auth.uid() is null: direct maintenance by postgres superuser without PostgREST headers
    IF current_setting('request.jwt.claim.sub', true) IS NULL AND 
       current_setting('request.jwt.claim.role', true) IS NULL THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access Denied: Unauthenticated modification of customer records.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_customer_privileged_fields ON public.customers;
CREATE TRIGGER trg_protect_customer_privileged_fields
    BEFORE INSERT OR UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_customer_privileged_updates();

-- ------------------------------------------------------------------------------
-- 4. HARDENED TRIGGER: check_supplier_privileged_updates
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_supplier_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_auth_scope VARCHAR;
    v_auth_rpc VARCHAR;
BEGIN
    v_caller_id := auth.uid();

    SELECT allowed_scope, rpc_name INTO v_auth_scope, v_auth_rpc
    FROM public.internal_rpc_auth_tokens
    WHERE txid = txid_current() AND authorized_user_id = v_caller_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_auth_scope IS NOT NULL THEN
        -- 1. JAR_CUSTODY_ONLY: Can ONLY modify jars_in_custody, NEVER current_payable!
        IF v_auth_scope = 'JAR_CUSTODY_ONLY' THEN
            IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) THEN
                RAISE EXCEPTION 'Access Denied: Jar custody operations cannot modify supplier payable balances.';
            END IF;
            RETURN NEW;
        END IF;

        -- 2. PURCHASE_RECEIPT: Can modify jars_in_custody and current_payable atomically
        IF v_auth_scope = 'PURCHASE_RECEIPT' THEN
            RETURN NEW;
        END IF;
    END IF;

    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) OR
               (NEW.jars_in_custody IS DISTINCT FROM OLD.jars_in_custody) THEN
                RAISE EXCEPTION 'Access Denied: Supplier payable balances and jar custody cannot be directly modified. Direct updates are prohibited.';
            END IF;
        ELSIF TG_OP = 'INSERT' THEN
            IF (NEW.current_payable IS DISTINCT FROM 0.00) OR
               (NEW.jars_in_custody IS DISTINCT FROM 0) THEN
                RAISE EXCEPTION 'Access Denied: New supplier records must initialize with zero payable and custody.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    IF current_setting('request.jwt.claim.sub', true) IS NULL AND 
       current_setting('request.jwt.claim.role', true) IS NULL THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access Denied: Unauthenticated modification of supplier records.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_supplier_privileged_fields ON public.suppliers;
CREATE TRIGGER trg_protect_supplier_privileged_fields
    BEFORE INSERT OR UPDATE ON public.suppliers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_supplier_privileged_updates();

-- ------------------------------------------------------------------------------
-- 5. HARDENED JAR MOVEMENT RPC (rpc_record_jar_movement)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_record_jar_movement(
    p_source_location_id UUID,
    p_destination_location_id UUID,
    p_condition_from VARCHAR,
    p_condition_to VARCHAR,
    p_quantity INT,
    p_movement_type VARCHAR,
    p_reference_type VARCHAR DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_jar_product_id UUID;
    v_movement_id UUID;
    v_default_wh_id UUID;
    v_wh_location_id UUID;
    v_src_loc RECORD;
    v_dst_loc RECORD;
    v_src_wh_full INT := 0;
    v_avail_wh_cond INT := 0;
    v_avail_veh_cond INT := 0;
    v_avail_scrapyr_cond INT := 0;
    v_cust RECORD;
    v_supp RECORD;
    v_dst_cust RECORD;
    v_dst_supp RECORD;
    v_po RECORD;
    v_po_item RECORD;
    v_remaining_qty INT;
    v_inserted_movement_type VARCHAR(40);
    v_inserted_ref_type VARCHAR(30);
    v_stock_m_type VARCHAR(40);
    v_stock_ref_type VARCHAR(30);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    -- Staff authorization: only owner, warehouse staff, or delivery drivers
    IF v_caller_role != 'owner' AND 
       (v_perms->>'can_warehouse')::boolean != true AND
       (v_perms->>'can_deliveries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have jar movement authority.';
    END IF;

    -- Strict non-negative, non-zero quantity validation
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero. Submitted: %.', p_quantity;
    END IF;

    -- Validate all 5 allowed physical jar conditions
    IF p_condition_from NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_from: %', p_condition_from;
    END IF;
    IF p_condition_to NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_to: %', p_condition_to;
    END IF;

    -- Validate supported movement types
    IF p_movement_type NOT IN (
        'CUSTOMER_DELIVERY', 'CUSTOMER_EMPTY_RETURN', 'DAMAGED_COLLECTED',
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL',
        'REPAIR_CYCLE', 'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT',
        'DISPATCH_TO_VEHICLE', 'VEHICLE_RETURN_TO_WAREHOUSE',
        'SUPPLIER_PURCHASE', 'RETURN_TO_SUPPLIER', 'OPENING_STOCK'
    ) THEN
        RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
    END IF;

    -- Strict condition transition matrix:
    -- 1. Scrapped jars are terminal: can NEVER be restored to usable or repairable condition
    IF p_condition_from = 'DAMAGED_SCRAP' AND p_condition_to != 'DAMAGED_SCRAP' THEN
        RAISE EXCEPTION 'Scrapped jars cannot be restored to usable or repairable condition. Scrap is terminal.';
    END IF;

    -- 2. Washing cycle requires dirty -> clean
    IF p_movement_type = 'WASHING_CYCLE_DIRTY_TO_CLEAN' THEN
        IF p_condition_from != 'EMPTY_DIRTY' OR p_condition_to != 'EMPTY_CLEAN' THEN
            RAISE EXCEPTION 'Washing cycle requires EMPTY_DIRTY -> EMPTY_CLEAN transition.';
        END IF;
    END IF;

    -- 3. Filling cycle requires clean -> full
    IF p_movement_type = 'FILLING_CYCLE_CLEAN_TO_FULL' THEN
        IF p_condition_from != 'EMPTY_CLEAN' OR p_condition_to != 'FULL_USABLE' THEN
            RAISE EXCEPTION 'Filling cycle requires EMPTY_CLEAN -> FULL_USABLE transition.';
        END IF;
    END IF;

    -- 4. Repair cycle requires repairable -> clean or scrap
    IF p_movement_type = 'REPAIR_CYCLE' THEN
        IF p_condition_from != 'DAMAGED_REPAIRABLE' OR p_condition_to NOT IN ('EMPTY_CLEAN', 'DAMAGED_SCRAP') THEN
            RAISE EXCEPTION 'Repair cycle requires DAMAGED_REPAIRABLE -> EMPTY_CLEAN or DAMAGED_SCRAP transition.';
        END IF;
    END IF;

    -- 5. Scrap write-off requires terminal scrap destination and owner authorization
    IF p_movement_type = 'SCRAP_WRITEOFF' THEN
        IF v_caller_role != 'owner' THEN
            RAISE EXCEPTION 'Only the business owner can authorize scrap write-off entries.';
        END IF;
        IF p_condition_from NOT IN ('DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') OR p_condition_to != 'DAMAGED_SCRAP' THEN
            RAISE EXCEPTION 'Scrap writeoff requires DAMAGED_REPAIRABLE/DAMAGED_SCRAP -> DAMAGED_SCRAP transition.';
        END IF;
    END IF;

    -- 6. Disallow condition changes on ordinary movements (asset conservation invariant)
    IF p_condition_from != p_condition_to AND p_movement_type NOT IN (
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL', 'REPAIR_CYCLE', 'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT'
    ) THEN
        RAISE EXCEPTION 'Condition transition from % to % is not permitted under movement type %.',
            p_condition_from, p_condition_to, p_movement_type;
    END IF;

    -- 7. Disallow arbitrary condition jumping through generic adjustments
    IF p_movement_type = 'INTERNAL_ADJUSTMENT' AND p_condition_from != p_condition_to THEN
        IF NOT (p_condition_from = 'DAMAGED_REPAIRABLE' AND p_condition_to IN ('EMPTY_CLEAN', 'DAMAGED_SCRAP')) THEN
            RAISE EXCEPTION 'Internal adjustment cannot perform arbitrary condition conversion from % to %.',
                p_condition_from, p_condition_to;
        END IF;
    END IF;

    -- Resolve reusable jar product
    SELECT id INTO v_jar_product_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_jar_product_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;

    -- Resolve canonical single warehouse
    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id 
    FROM public.warehouses 
    WHERE is_default = true 
    LIMIT 1;

    IF v_default_wh_id IS NULL OR v_wh_location_id IS NULL THEN
        RAISE EXCEPTION 'Default central warehouse configuration is missing.';
    END IF;

    -- 1. Deadlock-free locking of physical locations (Deterministic UUID ordering)
    IF p_source_location_id = p_destination_location_id THEN
        SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
        v_dst_loc := v_src_loc;
    ELSE
        IF p_source_location_id < p_destination_location_id THEN
            SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
            SELECT * INTO v_dst_loc FROM public.locations WHERE id = p_destination_location_id FOR UPDATE;
        ELSE
            SELECT * INTO v_dst_loc FROM public.locations WHERE id = p_destination_location_id FOR UPDATE;
            SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
        END IF;
    END IF;

    IF v_src_loc.id IS NULL THEN
        RAISE EXCEPTION 'Source location % does not exist.', p_source_location_id;
    END IF;
    IF v_dst_loc.id IS NULL THEN
        RAISE EXCEPTION 'Destination location % does not exist.', p_destination_location_id;
    END IF;

    -- 2. Enforce Real Warehouse Identity (Reject arbitrary second warehouse locations)
    IF v_src_loc.type = 'WAREHOUSE' AND p_source_location_id != v_wh_location_id THEN
        RAISE EXCEPTION 'Invalid warehouse location: % does not match the canonical central warehouse location (%).',
            p_source_location_id, v_wh_location_id;
    END IF;
    IF v_dst_loc.type = 'WAREHOUSE' AND p_destination_location_id != v_wh_location_id THEN
        RAISE EXCEPTION 'Invalid warehouse location: % does not match the canonical central warehouse location (%).',
            p_destination_location_id, v_wh_location_id;
    END IF;

    -- Establish internal unforgeable token for authorized trigger updates
    PERFORM public._internal_establish_rpc_context('rpc_record_jar_movement', 'JAR_CUSTODY_ONLY');

    -- 3. Strict Supplier Purchase & Inflow Validation
    IF p_movement_type = 'SUPPLIER_PURCHASE' THEN
        IF v_src_loc.type != 'SUPPLIER' THEN
            RAISE EXCEPTION 'Supplier purchase source must be a supplier location. Location % is %.',
                p_source_location_id, v_src_loc.type;
        END IF;

        IF v_dst_loc.type != 'WAREHOUSE' THEN
            RAISE EXCEPTION 'Supplier purchase destination must be the central warehouse. Location % is %.',
                p_destination_location_id, v_dst_loc.type;
        END IF;

        IF p_reference_id IS NULL THEN
            RAISE EXCEPTION 'Supplier purchase requires a mandatory purchase reference ID.';
        END IF;

        SELECT * INTO v_supp FROM public.suppliers WHERE location_id = p_source_location_id FOR UPDATE;
        IF v_supp.id IS NULL THEN
            RAISE EXCEPTION 'Supplier record not found for location %.', p_source_location_id;
        END IF;

        SELECT * INTO v_po FROM public.purchases WHERE id = p_reference_id FOR UPDATE;
        IF v_po.id IS NULL THEN
            RAISE EXCEPTION 'Purchase order % not found.', p_reference_id;
        END IF;

        IF v_po.supplier_id != v_supp.id THEN
            RAISE EXCEPTION 'Purchase order % does not belong to supplier %.', p_reference_id, v_supp.id;
        END IF;

        IF v_po.status = 'CANCELLED' THEN
            RAISE EXCEPTION 'Cannot receive jars against cancelled purchase order %.', p_reference_id;
        END IF;

        -- Check remaining receivable quantity on purchase order item
        SELECT * INTO v_po_item FROM public.purchase_items
        WHERE purchase_id = v_po.id AND product_id = v_jar_product_id
        FOR UPDATE;

        IF v_po_item.id IS NULL THEN
            RAISE EXCEPTION 'Purchase order % does not contain jar product %.', p_reference_id, v_jar_product_id;
        END IF;

        v_remaining_qty := v_po_item.quantity_ordered - v_po_item.quantity_received;
        IF p_quantity > v_remaining_qty THEN
            RAISE EXCEPTION 'Cannot receive % jars: remaining receivable quantity on purchase order % is % (ordered: %, received: %).',
                p_quantity, p_reference_id, v_remaining_qty, v_po_item.quantity_ordered, v_po_item.quantity_received;
        END IF;

        -- Update purchase order item received count
        UPDATE public.purchase_items
        SET quantity_received = quantity_received + p_quantity
        WHERE id = v_po_item.id;

        -- If all items fully received, mark purchase order as RECEIVED
        IF NOT EXISTS (
            SELECT 1 FROM public.purchase_items
            WHERE purchase_id = v_po.id AND quantity_received < quantity_ordered
        ) THEN
            UPDATE public.purchases
            SET status = 'RECEIVED',
                received_at = pg_catalog.now(),
                updated_at = pg_catalog.now()
            WHERE id = v_po.id;
        END IF;

        v_inserted_ref_type := 'PURCHASE';

    ELSIF p_movement_type = 'OPENING_STOCK' THEN
        IF v_caller_role != 'owner' THEN
            RAISE EXCEPTION 'Only the business owner can record initial opening stock entries.';
        END IF;
        IF v_dst_loc.type != 'WAREHOUSE' THEN
            RAISE EXCEPTION 'Opening stock destination must be a warehouse location.';
        END IF;

        v_inserted_ref_type := 'AUDIT';

    ELSE
        -- 4. Authoritative Source Balance Verification for ALL 5 Location Types (Prevents Stock Fabrication)
        IF v_src_loc.type = 'CUSTOMER' THEN
            SELECT * INTO v_cust FROM public.customers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_cust.id IS NULL THEN
                RAISE EXCEPTION 'Customer at location % not found.', p_source_location_id;
            END IF;

            -- Check specific condition holding on customer
            IF p_condition_from = 'FULL_USABLE' AND v_cust.total_full_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient full jars. Available: %, Requested: %.', v_cust.total_full_jars_holding, p_quantity;
            ELSIF p_condition_from = 'EMPTY_CLEAN' AND COALESCE(v_cust.total_empty_clean_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient clean empty jars. Available: %, Requested: %.', COALESCE(v_cust.total_empty_clean_holding, 0), p_quantity;
            ELSIF p_condition_from = 'EMPTY_DIRTY' AND v_cust.total_empty_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient dirty empty jars. Available: %, Requested: %.', v_cust.total_empty_jars_holding, p_quantity;
            ELSIF p_condition_from = 'DAMAGED_REPAIRABLE' AND COALESCE(v_cust.total_damaged_jars_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient damaged repairable jars. Available: %, Requested: %.', COALESCE(v_cust.total_damaged_jars_holding, 0), p_quantity;
            ELSIF p_condition_from = 'DAMAGED_SCRAP' AND COALESCE(v_cust.total_scrap_jars_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient scrap jars. Available: %, Requested: %.', COALESCE(v_cust.total_scrap_jars_holding, 0), p_quantity;
            END IF;

            -- Deduct from exact condition holding
            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_from = 'FULL_USABLE' THEN total_full_jars_holding - p_quantity ELSE total_full_jars_holding END,
                total_empty_clean_holding = CASE WHEN p_condition_from = 'EMPTY_CLEAN' THEN total_empty_clean_holding - p_quantity ELSE total_empty_clean_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_from = 'EMPTY_DIRTY' THEN total_empty_jars_holding - p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding - p_quantity ELSE total_damaged_jars_holding END,
                total_scrap_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_SCRAP' THEN total_scrap_jars_holding - p_quantity ELSE total_scrap_jars_holding END,
                updated_at = pg_catalog.now()
            WHERE id = v_cust.id;

        ELSIF v_src_loc.type = 'SUPPLIER' THEN
            SELECT * INTO v_supp FROM public.suppliers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_supp.id IS NULL THEN
                RAISE EXCEPTION 'Supplier at location % not found.', p_source_location_id;
            END IF;

            IF v_supp.jars_in_custody < p_quantity THEN
                RAISE EXCEPTION 'Supplier has insufficient jars in custody. Available: %, Requested: %.', v_supp.jars_in_custody, p_quantity;
            END IF;

            UPDATE public.suppliers
            SET jars_in_custody = jars_in_custody - p_quantity,
                updated_at = pg_catalog.now()
            WHERE id = v_supp.id;

        ELSIF v_src_loc.type = 'WAREHOUSE' THEN
            IF p_condition_from = 'FULL_USABLE' THEN
                SELECT quantity_on_hand INTO v_src_wh_full
                FROM public.inventory_balances
                WHERE warehouse_id = v_default_wh_id AND product_id = v_jar_product_id
                FOR UPDATE;

                IF COALESCE(v_src_wh_full, 0) < p_quantity THEN
                    RAISE EXCEPTION 'Warehouse has insufficient full usable jars. Available: %, Requested: %.', COALESCE(v_src_wh_full, 0), p_quantity;
                END IF;

                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand - p_quantity,
                    updated_at = pg_catalog.now()
                WHERE warehouse_id = v_default_wh_id AND product_id = v_jar_product_id;
            ELSE
                SELECT COALESCE(
                    (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = p_condition_from)
                    -
                    (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = p_condition_from),
                    0
                ) INTO v_avail_wh_cond;

                IF v_avail_wh_cond < p_quantity THEN
                    RAISE EXCEPTION 'Warehouse has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_wh_cond, p_quantity;
                END IF;
            END IF;

        ELSIF v_src_loc.type = 'VEHICLE' THEN
            SELECT COALESCE(
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = p_condition_from)
                -
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = p_condition_from),
                0
            ) INTO v_avail_veh_cond;

            IF v_avail_veh_cond < p_quantity THEN
                RAISE EXCEPTION 'Staff vehicle has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_veh_cond, p_quantity;
            END IF;

        ELSIF v_src_loc.type = 'SCRAP_YARD' THEN
            -- Strictly validate available stock in scrap yard (no stock fabrication)
            IF p_condition_from != 'DAMAGED_SCRAP' THEN
                RAISE EXCEPTION 'Scrap yard only holds DAMAGED_SCRAP jars. Requested condition: %.', p_condition_from;
            END IF;

            SELECT COALESCE(
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = 'DAMAGED_SCRAP')
                -
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = 'DAMAGED_SCRAP'),
                0
            ) INTO v_avail_scrapyr_cond;

            IF v_avail_scrapyr_cond < p_quantity THEN
                RAISE EXCEPTION 'Scrap yard has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_scrapyr_cond, p_quantity;
            END IF;
        END IF;

        -- Normalize reference type for ordinary movements
        v_inserted_ref_type := CASE
            WHEN p_reference_type IN ('PURCHASE_ORDER', 'PURCHASE') THEN 'PURCHASE'
            WHEN p_reference_type IN ('ORDER') THEN 'ORDER'
            WHEN p_reference_type IN ('DELIVERY_STOP', 'DELIVERY') THEN 'DELIVERY_STOP'
            WHEN p_reference_type IN ('BATCH_WASH') THEN 'BATCH_WASH'
            WHEN p_reference_type IN ('AUDIT') THEN 'AUDIT'
            ELSE NULL
        END;
    END IF;

    -- 5. Mandatory Destination Relationship Validation (Never silently skip balance updates)
    IF v_dst_loc.type = 'CUSTOMER' THEN
        SELECT * INTO v_dst_cust FROM public.customers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_cust.id IS NULL THEN
            RAISE EXCEPTION 'Destination customer record not found for location %. Balance update cannot be skipped.',
                p_destination_location_id;
        END IF;

        UPDATE public.customers
        SET total_full_jars_holding = CASE WHEN p_condition_to = 'FULL_USABLE' THEN total_full_jars_holding + p_quantity ELSE total_full_jars_holding END,
            total_empty_clean_holding = CASE WHEN p_condition_to = 'EMPTY_CLEAN' THEN total_empty_clean_holding + p_quantity ELSE total_empty_clean_holding END,
            total_empty_jars_holding = CASE WHEN p_condition_to = 'EMPTY_DIRTY' THEN total_empty_jars_holding + p_quantity ELSE total_empty_jars_holding END,
            total_damaged_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding + p_quantity ELSE total_damaged_jars_holding END,
            total_scrap_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_SCRAP' THEN total_scrap_jars_holding + p_quantity ELSE total_scrap_jars_holding END,
            updated_at = pg_catalog.now()
        WHERE id = v_dst_cust.id;

    ELSIF v_dst_loc.type = 'SUPPLIER' THEN
        SELECT * INTO v_dst_supp FROM public.suppliers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_supp.id IS NULL THEN
            RAISE EXCEPTION 'Destination supplier record not found for location %. Balance update cannot be skipped.',
                p_destination_location_id;
        END IF;

        UPDATE public.suppliers
        SET jars_in_custody = jars_in_custody + p_quantity,
            updated_at = pg_catalog.now()
        WHERE id = v_dst_supp.id;

    ELSIF v_dst_loc.type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
        INSERT INTO public.inventory_balances (
            warehouse_id,
            product_id,
            quantity_on_hand,
            updated_at
        ) VALUES (
            v_default_wh_id,
            v_jar_product_id,
            p_quantity,
            pg_catalog.now()
        )
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET
            quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
            updated_at = pg_catalog.now();

    ELSIF v_dst_loc.type = 'SCRAP_YARD' THEN
        IF p_condition_to != 'DAMAGED_SCRAP' THEN
            RAISE EXCEPTION 'Destination scrap yard only accepts DAMAGED_SCRAP condition. Received: %.', p_condition_to;
        END IF;
    END IF;

    -- 6. Insert into jar_custody_movements (Mapping to Accepted Foundation Check Constraints)
    v_inserted_movement_type := CASE 
        WHEN p_movement_type = 'OPENING_STOCK' THEN 'INTERNAL_ADJUSTMENT'
        WHEN p_movement_type = 'REPAIR_CYCLE' THEN 'INTERNAL_ADJUSTMENT'
        ELSE p_movement_type
    END;

    INSERT INTO public.jar_custody_movements (
        product_id,
        source_location_id,
        destination_location_id,
        condition_from,
        condition_to,
        quantity,
        movement_type,
        reference_type,
        reference_id,
        notes,
        created_by
    ) VALUES (
        v_jar_product_id,
        p_source_location_id,
        p_destination_location_id,
        p_condition_from,
        p_condition_to,
        p_quantity,
        v_inserted_movement_type,
        v_inserted_ref_type,
        p_reference_id,
        COALESCE(p_notes, 'Round 7 jar custody movement'),
        v_caller_id
    ) RETURNING id INTO v_movement_id;

    -- 7. Dual-Entry Stock Movements Ledger Update (Preserving Physical Stock Movements Invariant)
    IF (v_src_loc.type = 'WAREHOUSE' AND p_condition_from = 'FULL_USABLE') OR
       (v_dst_loc.type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE') OR
       (p_movement_type = 'SCRAP_WRITEOFF') THEN

        v_stock_m_type := CASE
            WHEN p_movement_type = 'SUPPLIER_PURCHASE' THEN 'PURCHASE_RECEIPT'
            WHEN p_movement_type = 'CUSTOMER_DELIVERY' THEN 'DELIVERY_DISPATCH'
            WHEN p_movement_type = 'CUSTOMER_EMPTY_RETURN' THEN 'DELIVERY_RETURN'
            WHEN p_movement_type = 'SCRAP_WRITEOFF' THEN 'SCRAP_WRITEOFF'
            WHEN p_movement_type = 'DISPATCH_TO_VEHICLE' THEN 'DELIVERY_DISPATCH'
            WHEN p_movement_type = 'VEHICLE_RETURN_TO_WAREHOUSE' THEN 'DELIVERY_RETURN'
            WHEN p_movement_type = 'OPENING_STOCK' THEN 'ADJUSTMENT_IN'
            WHEN v_dst_loc.type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' THEN 'ADJUSTMENT_IN'
            WHEN v_src_loc.type = 'WAREHOUSE' AND p_condition_from = 'FULL_USABLE' THEN 'ADJUSTMENT_OUT'
            ELSE 'ADJUSTMENT_OUT'
        END;

        v_stock_ref_type := CASE
            WHEN p_movement_type = 'SUPPLIER_PURCHASE' THEN 'PURCHASE'
            WHEN p_movement_type = 'OPENING_STOCK' THEN 'AUDIT'
            WHEN p_movement_type = 'SCRAP_WRITEOFF' THEN 'AUDIT'
            WHEN p_movement_type IN ('DISPATCH_TO_VEHICLE', 'VEHICLE_RETURN_TO_WAREHOUSE') THEN 'DELIVERY_STOP'
            WHEN p_reference_type IN ('PURCHASE', 'PURCHASE_ORDER') THEN 'PURCHASE'
            WHEN p_reference_type IN ('ORDER') THEN 'ORDER'
            WHEN p_reference_type IN ('DELIVERY_STOP', 'DELIVERY') THEN 'DELIVERY_STOP'
            WHEN p_reference_type IN ('AUDIT') THEN 'AUDIT'
            ELSE 'AUDIT'
        END;

        INSERT INTO public.stock_movements (
            product_id,
            source_location_id,
            destination_location_id,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            notes,
            created_by
        ) VALUES (
            v_jar_product_id,
            p_source_location_id,
            p_destination_location_id,
            p_quantity,
            v_stock_m_type,
            v_stock_ref_type,
            p_reference_id,
            COALESCE(p_notes, 'Round 7 stock ledger movement'),
            v_caller_id
        );
    END IF;

    -- Clear transaction context before returning
    PERFORM public._internal_clear_rpc_context();

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'movement_id', v_movement_id,
        'movement_type', p_movement_type,
        'quantity', p_quantity,
        'condition_from', p_condition_from,
        'condition_to', p_condition_to,
        'source_location_id', p_source_location_id,
        'destination_location_id', p_destination_location_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_record_jar_movement(UUID, UUID, VARCHAR, VARCHAR, INT, VARCHAR, VARCHAR, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_record_jar_movement(UUID, UUID, VARCHAR, VARCHAR, INT, VARCHAR, VARCHAR, UUID, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. HARDENED ORDER CREATION RPC (rpc_create_customer_order with Inventory Reservation)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_create_customer_order(
    p_customer_id UUID,
    p_delivery_address TEXT,
    p_delivery_date DATE,
    p_assigned_staff_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_price_override_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_customer RECORD;
    v_default_wh_id UUID;
    v_wh_location_id UUID;
    v_order_id UUID;
    v_order_num VARCHAR(50);
    v_invoice_id UUID;
    v_invoice_num VARCHAR(50);
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
    v_item RECORD;
    v_product RECORD;
    v_special_price NUMERIC(12,2);
    v_base_unit_price NUMERIC(12,2);
    v_final_unit_price NUMERIC(12,2);
    v_is_overridden BOOLEAN;
    v_item_subtotal NUMERIC(12,2);
    v_item_tax NUMERIC(12,2);
    v_item_total NUMERIC(12,2);
    v_existing_order_id UUID;
    v_existing_order_num VARCHAR(50);
    v_existing_total NUMERIC(12,2);
    v_client_tax NUMERIC(12,2);
    v_target_date DATE;
    v_inv RECORD;
    v_avail_stock INT;
    v_req_item RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_orders')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have order creation authority.';
    END IF;

    -- Concurrency-Safe Idempotency: acquire transactional advisory lock on hash of key
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        PERFORM pg_advisory_xact_lock(hashtext('order_idemp_' || trim(p_idempotency_key)));

        SELECT id, order_number, total_amount INTO v_existing_order_id, v_existing_order_num, v_existing_total
        FROM public.orders
        WHERE idempotency_key = trim(p_idempotency_key);

        IF FOUND THEN
            SELECT id, invoice_number INTO v_invoice_id, v_invoice_num
            FROM public.invoices
            WHERE order_id = v_existing_order_id
            LIMIT 1;

            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'order_id', v_existing_order_id,
                'order_number', v_existing_order_num,
                'invoice_id', v_invoice_id,
                'invoice_number', v_invoice_num,
                'total_amount', v_existing_total
            );
        END IF;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order items array cannot be empty.';
    END IF;

    -- Resolve canonical warehouse
    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id 
    FROM public.warehouses 
    WHERE is_default = true 
    LIMIT 1;

    IF v_default_wh_id IS NULL OR v_wh_location_id IS NULL THEN
        RAISE EXCEPTION 'Canonical warehouse configuration is missing.';
    END IF;

    v_target_date := COALESCE(p_delivery_date, CURRENT_DATE);

    -- Lock customer record FOR UPDATE
    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found or inactive.';
    END IF;

    -- 1. DETERMINISTIC INVENTORY ROW LOCKING & AVAILABILITY VALIDATION (Part 5)
    -- Group requested quantities by product_id to handle multiple line items of same SKU
    FOR v_req_item IN 
        SELECT (x.product_id)::UUID as product_id, SUM(x.quantity)::INT as total_req_qty
        FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity INT)
        GROUP BY x.product_id
        ORDER BY x.product_id ASC
    LOOP
        IF v_req_item.total_req_qty <= 0 THEN
            RAISE EXCEPTION 'Quantity for product % must be greater than zero.', v_req_item.product_id;
        END IF;

        -- Deterministically lock warehouse inventory row FOR UPDATE
        SELECT * INTO v_inv
        FROM public.inventory_balances
        WHERE warehouse_id = v_default_wh_id AND product_id = v_req_item.product_id
        FOR UPDATE;

        IF NOT FOUND THEN
            -- If no inventory record exists, available stock is 0
            SELECT name INTO v_product FROM public.products WHERE id = v_req_item.product_id;
            RAISE EXCEPTION 'Insufficient available inventory for product "%". Requested: %, Available: 0 (No warehouse stock record).',
                COALESCE(v_product.name, v_req_item.product_id::text), v_req_item.total_req_qty;
        END IF;

        v_avail_stock := v_inv.quantity_on_hand - v_inv.quantity_reserved;
        IF v_avail_stock < v_req_item.total_req_qty THEN
            SELECT name INTO v_product FROM public.products WHERE id = v_req_item.product_id;
            RAISE EXCEPTION 'Insufficient available inventory for product "%". Requested: %, Available: % (On-hand: %, Reserved: %).',
                COALESCE(v_product.name, v_req_item.product_id::text), v_req_item.total_req_qty, v_avail_stock, v_inv.quantity_on_hand, v_inv.quantity_reserved;
        END IF;

        -- Atomically reserve inventory to prevent concurrent orders from overselling
        UPDATE public.inventory_balances
        SET quantity_reserved = quantity_reserved + v_req_item.total_req_qty,
            updated_at = pg_catalog.now()
        WHERE id = v_inv.id;
    END LOOP;

    -- 2. Calculate order totals using authoritative pricing and GST configuration
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        quantity INT,
        unit_price NUMERIC,
        gst_rate NUMERIC,
        tax_rate NUMERIC
    )
    LOOP
        SELECT id, name, default_sale_price, gst_rate INTO v_product
        FROM public.products
        WHERE id = v_item.product_id AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found or inactive.', v_item.product_id;
        END IF;

        -- Authoritative GST rate validation
        v_client_tax := COALESCE(v_item.tax_rate, v_item.gst_rate);
        IF v_client_tax IS NOT NULL AND v_client_tax != v_product.gst_rate THEN
            RAISE EXCEPTION 'Invalid tax rate submitted (%). Authoritative tax rate is %.',
                v_client_tax, v_product.gst_rate;
        END IF;

        -- Active date-range special price
        SELECT special_price INTO v_special_price
        FROM public.customer_special_prices
        WHERE customer_id = p_customer_id 
          AND product_id = v_item.product_id 
          AND effective_from <= v_target_date
          AND (effective_to IS NULL OR effective_to >= v_target_date)
        ORDER BY effective_from DESC
        LIMIT 1;

        v_base_unit_price := COALESCE(v_special_price, v_product.default_sale_price);

        -- Owner-only price overrides with mandatory reason validation
        IF v_item.unit_price IS NOT NULL AND v_item.unit_price != v_base_unit_price THEN
            IF v_caller_role != 'owner' THEN
                RAISE EXCEPTION 'Unauthorized price override: only the business owner can authorize price overrides or custom discounts. Product: %, Standard: %, Submitted: %.',
                    v_product.name, v_base_unit_price, v_item.unit_price;
            END IF;

            IF v_item.unit_price < 0 THEN
                RAISE EXCEPTION 'Overridden unit price cannot be negative. Submitted: %.', v_item.unit_price;
            END IF;

            IF p_price_override_reason IS NULL OR length(trim(p_price_override_reason)) < 5 THEN
                RAISE EXCEPTION 'Price override requires a valid business reason (minimum 5 characters).';
            END IF;

            v_final_unit_price := v_item.unit_price;
            v_is_overridden := true;
        ELSE
            v_final_unit_price := v_base_unit_price;
            v_is_overridden := false;
        END IF;

        v_item_subtotal := v_final_unit_price * v_item.quantity;
        v_item_tax := pg_catalog.round(v_item_subtotal * (v_product.gst_rate / 100.0), 2);
        v_item_total := v_item_subtotal + v_item_tax;

        v_subtotal := v_subtotal + v_item_subtotal;
        v_tax_total := v_tax_total + v_item_tax;
    END LOOP;

    v_total_amount := v_subtotal + v_tax_total;
    v_order_num := 'ORD-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 3. Insert master order record
    INSERT INTO public.orders (
        order_number,
        customer_id,
        delivery_address,
        delivery_date,
        assigned_staff_id,
        status,
        payment_status,
        subtotal,
        tax_total,
        total_amount,
        notes,
        idempotency_key,
        created_by
    ) VALUES (
        v_order_num,
        p_customer_id,
        COALESCE(p_delivery_address, v_customer.address),
        v_target_date,
        p_assigned_staff_id,
        CASE WHEN p_assigned_staff_id IS NOT NULL THEN 'ASSIGNED' ELSE 'PENDING' END,
        'UNPAID',
        v_subtotal,
        v_tax_total,
        v_total_amount,
        p_notes,
        p_idempotency_key,
        v_caller_id
    ) RETURNING id INTO v_order_id;

    -- 4. Insert line items with pricing audit trail
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        quantity INT,
        unit_price NUMERIC,
        gst_rate NUMERIC,
        tax_rate NUMERIC
    )
    LOOP
        SELECT id, name, default_sale_price, gst_rate INTO v_product 
        FROM public.products 
        WHERE id = v_item.product_id;

        SELECT special_price INTO v_special_price 
        FROM public.customer_special_prices 
        WHERE customer_id = p_customer_id 
          AND product_id = v_item.product_id 
          AND effective_from <= v_target_date
          AND (effective_to IS NULL OR effective_to >= v_target_date)
        ORDER BY effective_from DESC
        LIMIT 1;

        v_base_unit_price := COALESCE(v_special_price, v_product.default_sale_price);

        IF v_item.unit_price IS NOT NULL AND v_item.unit_price != v_base_unit_price AND v_caller_role = 'owner' THEN
            v_final_unit_price := v_item.unit_price;
            v_is_overridden := true;
        ELSE
            v_final_unit_price := v_base_unit_price;
            v_is_overridden := false;
        END IF;

        v_item_subtotal := v_final_unit_price * v_item.quantity;
        v_item_tax := pg_catalog.round(v_item_subtotal * (v_product.gst_rate / 100.0), 2);
        v_item_total := v_item_subtotal + v_item_tax;

        INSERT INTO public.order_items (
            order_id,
            product_id,
            quantity,
            unit_price,
            tax_rate,
            tax_amount,
            total_amount,
            original_price,
            is_price_overridden,
            override_reason,
            authorized_by
        ) VALUES (
            v_order_id,
            v_item.product_id,
            v_item.quantity,
            v_final_unit_price,
            v_product.gst_rate,
            v_item_tax,
            v_item_total,
            v_base_unit_price,
            v_is_overridden,
            CASE WHEN v_is_overridden THEN p_price_override_reason ELSE NULL END,
            CASE WHEN v_is_overridden THEN v_caller_id ELSE NULL END
        );
    END LOOP;

    -- 5. Create delivery stop if assigned to driver
    IF p_assigned_staff_id IS NOT NULL THEN
        INSERT INTO public.delivery_stops (
            order_id,
            assigned_staff_id,
            sequence_number,
            status
        ) VALUES (
            v_order_id,
            p_assigned_staff_id,
            1,
            'ASSIGNED'
        );
    END IF;

    -- 6. Create Accrual Sales Invoice matching exact order totals
    v_invoice_num := 'INV-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);
    INSERT INTO public.invoices (
        invoice_number,
        order_id,
        customer_id,
        subtotal,
        tax_amount,
        total_amount,
        balance_due,
        status,
        invoice_date
    ) VALUES (
        v_invoice_num,
        v_order_id,
        p_customer_id,
        v_subtotal,
        v_tax_total,
        v_total_amount,
        v_total_amount,
        'UNPAID',
        CURRENT_DATE
    ) RETURNING id INTO v_invoice_id;

    -- 7. Establish internal RPC context for customer balance update
    PERFORM public._internal_establish_rpc_context('rpc_create_customer_order', 'CUSTOMER_ORDER_BALANCE_ONLY');

    UPDATE public.customers
    SET current_balance = current_balance + v_total_amount,
        updated_at = pg_catalog.now()
    WHERE id = p_customer_id;

    -- Clear context
    PERFORM public._internal_clear_rpc_context();

    -- 8. Balanced Financial Ledger Accrual Entries
    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_invoice_num || '-DR',
        '1110',
        'Accounts Receivable',
        v_total_amount,
        0.00,
        'Accrual invoice for order ' || v_order_num,
        'INVOICE',
        v_invoice_id,
        v_caller_id
    );

    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        created_by
    ) VALUES (
        'LED-' || v_invoice_num || '-CR-REV',
        '4010',
        'Water Sales Revenue',
        0.00,
        v_subtotal,
        'Revenue from order ' || v_order_num,
        'INVOICE',
        v_invoice_id,
        v_caller_id
    );

    IF v_tax_total > 0 THEN
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_invoice_num || '-CR-TAX',
            '2110',
            'GST Output Payable',
            0.00,
            v_tax_total,
            'GST liability from order ' || v_order_num,
            'INVOICE',
            v_invoice_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'order_number', v_order_num,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_num,
        'subtotal', v_subtotal,
        'tax_total', v_tax_total,
        'total_amount', v_total_amount,
        'status', CASE WHEN p_assigned_staff_id IS NOT NULL THEN 'ASSIGNED' ELSE 'PENDING' END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB, VARCHAR, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. HARDENED DELIVERY EXECUTION RPC (rpc_execute_delivery_stop)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_execute_delivery_stop(
    p_stop_id UUID,
    p_actual_delivered INT,
    p_empty_jars INT,
    p_damaged_jars INT,
    p_payment_amount NUMERIC DEFAULT 0.00,
    p_payment_method VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_stop RECORD;
    v_order RECORD;
    v_customer RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_perms JSONB;
    v_payment_num VARCHAR(50);
    v_default_wh UUID;
    v_wh_location UUID;
    v_default_jar_id UUID;
    v_total_ordered_qty INT := 0;
    v_previously_delivered_qty INT := 0;
    v_remaining_ordered_qty INT := 0;
    v_new_cumulative_delivered INT := 0;
    v_previously_paid_amount NUMERIC(12,2) := 0.00;
    v_remaining_order_balance NUMERIC(12,2) := 0.00;
    v_new_cumulative_paid NUMERIC(12,2) := 0.00;
    v_current_total_custody INT := 0;
    v_total_returning INT := 0;
    v_new_full_holding INT := 0;
    v_new_empty_holding INT := 0;
    v_new_damaged_holding INT := 0;
    v_new_order_status VARCHAR(30);
    v_new_payment_status VARCHAR(20);
    v_item RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_deliveries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have delivery execution authority.';
    END IF;

    IF p_actual_delivered < 0 OR p_empty_jars < 0 OR p_damaged_jars < 0 THEN
        RAISE EXCEPTION 'Quantities cannot be negative.';
    END IF;
    IF p_payment_amount < 0 THEN
        RAISE EXCEPTION 'Payment amount cannot be negative.';
    END IF;

    -- Lock delivery stop row FOR UPDATE
    SELECT * INTO v_stop FROM public.delivery_stops WHERE id = p_stop_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop not found: %', p_stop_id;
    END IF;

    IF v_caller_role != 'owner' AND v_stop.assigned_staff_id != v_caller_id THEN
        RAISE EXCEPTION 'Access denied: staff can only execute stops assigned to them.';
    END IF;

    -- Idempotency check: if already completed, return existing status
    IF v_stop.status = 'COMPLETED' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', 'ALREADY_COMPLETED'
        );
    END IF;

    IF v_stop.status NOT IN ('ASSIGNED', 'EN_ROUTE', 'PENDING') THEN
        RAISE EXCEPTION 'Delivery stop cannot be executed in "%" status.', v_stop.status;
    END IF;

    -- Resolve canonical warehouse
    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL OR v_wh_location IS NULL THEN
        RAISE EXCEPTION 'Canonical warehouse configuration is missing.';
    END IF;

    -- Lock parent order and customer records FOR UPDATE
    SELECT * INTO v_order FROM public.orders WHERE id = v_stop.order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent order % not found.', v_stop.order_id;
    END IF;

    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer % not found.', v_order.customer_id;
    END IF;

    -- Handle explicit failure report: release reserved inventory for order items if stop cancelled/failed
    IF p_failure_reason IS NOT NULL AND p_actual_delivered = 0 THEN
        UPDATE public.delivery_stops
        SET status = 'FAILED',
            failure_reason = p_failure_reason,
            executed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_stop_id;

        -- Release reserved stock back to available pool
        FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v_order.id
        LOOP
            UPDATE public.inventory_balances
            SET quantity_reserved = pg_catalog.greatest(0, quantity_reserved - v_item.quantity),
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;
        END LOOP;

        UPDATE public.orders
        SET status = 'CANCELLED',
            updated_at = pg_catalog.now()
        WHERE id = v_order.id;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'FAILED');
    END IF;

    -- 1. Calculate actual remaining ordered quantity across previous deliveries
    SELECT COALESCE(SUM(quantity), 0) INTO v_total_ordered_qty
    FROM public.order_items WHERE order_id = v_order.id;

    SELECT COALESCE(SUM(actual_delivered_quantity), 0) INTO v_previously_delivered_qty
    FROM public.delivery_stops
    WHERE order_id = v_order.id AND status = 'COMPLETED' AND id != p_stop_id;

    v_remaining_ordered_qty := v_total_ordered_qty - v_previously_delivered_qty;

    IF p_actual_delivered > v_remaining_ordered_qty THEN
        RAISE EXCEPTION 'Delivered quantity (%) exceeds remaining order quantity (%). Total ordered: %, previously delivered: %.',
            p_actual_delivered, v_remaining_ordered_qty, v_total_ordered_qty, v_previously_delivered_qty;
    END IF;

    -- 2. Validate payment against actual remaining balance after previous payments
    SELECT COALESCE(SUM(payment_collected), 0.00) INTO v_previously_paid_amount
    FROM public.delivery_stops
    WHERE order_id = v_order.id AND status = 'COMPLETED' AND id != p_stop_id;

    v_remaining_order_balance := pg_catalog.greatest(0.00, v_order.total_amount - v_previously_paid_amount);

    IF p_payment_amount > 0 THEN
        IF p_payment_method IS NULL OR p_payment_method NOT IN ('CASH', 'UPI', 'CREDIT') THEN
            RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, CREDIT.', p_payment_method;
        END IF;
        IF p_payment_method = 'CREDIT' THEN
            RAISE EXCEPTION 'Payment amount cannot be positive when payment method is CREDIT.';
        END IF;
        IF p_payment_amount > v_remaining_order_balance THEN
            RAISE EXCEPTION 'Payment amount (%) exceeds outstanding order balance (%). Order total: %, previously paid: %.',
                p_payment_amount, v_remaining_order_balance, v_order.total_amount, v_previously_paid_amount;
        END IF;
    END IF;

    SELECT id INTO v_default_jar_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_default_jar_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;

    -- 3. Physical Jar Custody Conservation & Validation
    v_current_total_custody := v_customer.total_full_jars_holding + v_customer.total_empty_jars_holding + COALESCE(v_customer.total_damaged_jars_holding, 0);
    v_total_returning := p_empty_jars + p_damaged_jars;

    IF v_total_returning > v_current_total_custody THEN
        RAISE EXCEPTION 'Invalid physical return: customer holds % jars, but attempted to return % jars.',
            v_current_total_custody, v_total_returning;
    END IF;

    v_new_full_holding := v_customer.total_full_jars_holding + p_actual_delivered;

    IF v_customer.total_empty_jars_holding >= p_empty_jars THEN
        v_new_empty_holding := v_customer.total_empty_jars_holding - p_empty_jars;
    ELSE
        v_new_full_holding := v_new_full_holding - (p_empty_jars - v_customer.total_empty_jars_holding);
        v_new_empty_holding := 0;
    END IF;

    v_new_damaged_holding := COALESCE(v_customer.total_damaged_jars_holding, 0);
    IF p_damaged_jars > 0 THEN
        IF v_new_damaged_holding >= p_damaged_jars THEN
            v_new_damaged_holding := v_new_damaged_holding - p_damaged_jars;
        ELSE
            DECLARE
                v_excess_dmg INT := p_damaged_jars - v_new_damaged_holding;
            BEGIN
                v_new_damaged_holding := 0;
                IF v_new_empty_holding >= v_excess_dmg THEN
                    v_new_empty_holding := v_new_empty_holding - v_excess_dmg;
                ELSE
                    v_new_full_holding := v_new_full_holding - (v_excess_dmg - v_new_empty_holding);
                    v_new_empty_holding := 0;
                END IF;
            END;
        END IF;
    END IF;

    IF v_new_full_holding < 0 OR v_new_empty_holding < 0 THEN
        RAISE EXCEPTION 'Physical custody violation: customer jar holding cannot become negative (full: %, empty: %).',
            v_new_full_holding, v_new_empty_holding;
    END IF;

    -- Establish internal unforgeable token for delivery execution
    PERFORM public._internal_establish_rpc_context('rpc_execute_delivery_stop', 'DELIVERY_STOP_EXECUTION');

    -- Update customer holdings
    UPDATE public.customers
    SET total_full_jars_holding = v_new_full_holding,
        total_empty_jars_holding = v_new_empty_holding,
        total_damaged_jars_holding = v_new_damaged_holding,
        updated_at = pg_catalog.now()
    WHERE id = v_customer.id;

    -- 4. Deduct Inventory Balances and Release Reservation (Part 5 Single Inventory Lifecycle)
    IF p_actual_delivered > 0 THEN
        -- Deduct delivered stock from on_hand and release from quantity_reserved
        UPDATE public.inventory_balances
        SET quantity_on_hand = pg_catalog.greatest(0, quantity_on_hand - p_actual_delivered),
            quantity_reserved = pg_catalog.greatest(0, quantity_reserved - p_actual_delivered),
            updated_at = pg_catalog.now()
        WHERE warehouse_id = v_default_wh AND product_id = v_default_jar_id;

        -- Record stock movement
        INSERT INTO public.stock_movements (
            product_id,
            source_location_id,
            destination_location_id,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_wh_location,
            v_customer.location_id,
            p_actual_delivered,
            'DELIVERY_DISPATCH',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );

        -- Record jar custody movements
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_wh_location,
            v_customer.location_id,
            'FULL_USABLE',
            'FULL_USABLE',
            p_actual_delivered,
            'CUSTOMER_DELIVERY',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    IF p_empty_jars > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_customer.location_id,
            v_wh_location,
            'EMPTY_DIRTY',
            'EMPTY_DIRTY',
            p_empty_jars,
            'CUSTOMER_EMPTY_RETURN',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    IF p_damaged_jars > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id,
            source_location_id,
            destination_location_id,
            condition_from,
            condition_to,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_customer.location_id,
            v_wh_location,
            'DAMAGED_REPAIRABLE',
            'DAMAGED_REPAIRABLE',
            p_damaged_jars,
            'DAMAGED_COLLECTED',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    -- 5. Payment Processing & Balanced Financial Ledger Entry
    IF p_payment_amount > 0 THEN
        v_payment_num := 'PAY-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || pg_catalog.substr(p_stop_id::text, 1, 6);

        INSERT INTO public.customer_payments (
            payment_number,
            customer_id,
            order_id,
            amount,
            payment_method,
            collected_by_staff_id,
            notes
        ) VALUES (
            v_payment_num,
            v_customer.id,
            v_order.id,
            p_payment_amount,
            p_payment_method,
            v_caller_id,
            'Route stop payment'
        );

        UPDATE public.customers
        SET current_balance = current_balance - p_payment_amount,
            updated_at = pg_catalog.now()
        WHERE id = v_customer.id;

        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_payment_num || '-DR',
            CASE WHEN p_payment_method = 'UPI' THEN '1020' ELSE '1015' END,
            CASE WHEN p_payment_method = 'UPI' THEN 'Bank Current Account' ELSE 'Cash Float with Driver' END,
            p_payment_amount,
            0.00,
            'Route collection from ' || v_customer.contact_name,
            'PAYMENT',
            p_stop_id,
            v_caller_id
        );

        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            'LED-' || v_payment_num || '-CR',
            '1110',
            'Accounts Receivable',
            0.00,
            p_payment_amount,
            'Settlement of A/R for order ' || v_order.order_number,
            'PAYMENT',
            p_stop_id,
            v_caller_id
        );
    END IF;

    -- Clear internal auth token
    PERFORM public._internal_clear_rpc_context();

    -- 6. Finalize stop record
    UPDATE public.delivery_stops
    SET status = 'COMPLETED',
        actual_delivered_quantity = p_actual_delivered,
        empty_jars_collected = p_empty_jars,
        damaged_jars_collected = p_damaged_jars,
        payment_collected = p_payment_amount,
        payment_method = p_payment_method,
        notes = p_notes,
        executed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_stop_id;

    -- 7. Recalculate cumulative status for parent order and accrual invoice
    v_new_cumulative_delivered := v_previously_delivered_qty + p_actual_delivered;
    v_new_cumulative_paid := v_previously_paid_amount + p_payment_amount;

    v_new_order_status := CASE 
        WHEN v_new_cumulative_delivered >= v_total_ordered_qty THEN 'DELIVERED'
        WHEN v_new_cumulative_delivered > 0 THEN 'PARTIALLY_DELIVERED'
        ELSE v_order.status
    END;

    v_new_payment_status := CASE 
        WHEN v_new_cumulative_paid >= v_order.total_amount THEN 'PAID'
        WHEN v_new_cumulative_paid > 0 THEN 'PARTIALLY_PAID'
        ELSE 'UNPAID'
    END;

    UPDATE public.orders
    SET status = v_new_order_status,
        payment_status = v_new_payment_status,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    UPDATE public.invoices
    SET balance_due = pg_catalog.greatest(0.00, total_amount - v_new_cumulative_paid),
        status = CASE 
            WHEN v_new_cumulative_paid >= total_amount THEN 'PAID'
            WHEN v_new_cumulative_paid > 0 THEN 'PARTIALLY_PAID'
            ELSE 'UNPAID'
        END,
        updated_at = pg_catalog.now()
    WHERE order_id = v_order.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'COMPLETED',
        'delivered', p_actual_delivered,
        'cumulative_delivered', v_new_cumulative_delivered,
        'remaining_ordered', (v_total_ordered_qty - v_new_cumulative_delivered),
        'payment_collected', p_payment_amount,
        'cumulative_paid', v_new_cumulative_paid,
        'remaining_balance', (v_order.total_amount - v_new_cumulative_paid),
        'empty_collected', p_empty_jars,
        'damaged_collected', p_damaged_jars,
        'customer_closing_holding', (v_new_full_holding + v_new_empty_holding + v_new_damaged_holding)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 8. ORDER CANCELLATION RPC (rpc_cancel_customer_order with Reservation Release)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_cancel_customer_order(
    p_order_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_order RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_item RECORD;
    v_delivered_qty INT := 0;
    v_remaining_res INT := 0;
    v_invoice RECORD;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_orders')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have order cancellation authority.';
    END IF;

    -- Lock order row FOR UPDATE
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found.', p_order_id;
    END IF;

    IF v_order.status IN ('DELIVERED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Order % cannot be cancelled in "%" status.', p_order_id, v_order.status;
    END IF;

    -- Resolve canonical warehouse
    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;

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

    -- 2. Mark order and pending stops as CANCELLED
    UPDATE public.orders
    SET status = 'CANCELLED',
        notes = CASE 
            WHEN p_reason IS NOT NULL THEN COALESCE(notes, '') || ' [Cancelled: ' || p_reason || ']'
            ELSE notes
        END,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    UPDATE public.delivery_stops
    SET status = 'CANCELLED',
        failure_reason = COALESCE(p_reason, 'Order cancelled'),
        updated_at = pg_catalog.now()
    WHERE order_id = v_order.id AND status NOT IN ('COMPLETED', 'FAILED');

    -- 3. Adjust customer accounts receivable balance if invoice was unpaid
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

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', 'CANCELLED',
        'released_reservation', true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_cancel_customer_order(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_customer_order(UUID, TEXT) TO authenticated, service_role;
 

-- AquaTrack ERP - Migration: Remediation Round 8
-- Version: 20261105000001_remediation_round_8.sql

-- ==============================================================================
-- AquaTrack ERP — Database Migration Round 8
-- File: supabase/migrations/20261105000001_remediation_round_8.sql
-- Date: 2026-11-05
-- Objective: Critical Order Cancellation, Multi-Product Reservation Release,
--            Deterministic Row-Locking, and General Ledger Accounting Remediation.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. SCHEMA HARDENING: DELIVERY STOP ITEMS & ORDER ITEMS DELIVERED QUANTITY
-- ------------------------------------------------------------------------------

-- 1.1 Add delivered_quantity tracking to public.order_items
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'order_items' 
          AND column_name = 'delivered_quantity'
    ) THEN
        ALTER TABLE public.order_items 
        ADD COLUMN delivered_quantity INTEGER NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0);
    END IF;
END $$;

-- 1.2 Create public.delivery_stop_items for granular per-product delivery records
CREATE TABLE IF NOT EXISTS public.delivery_stop_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stop_id UUID NOT NULL REFERENCES public.delivery_stops(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity_delivered INTEGER NOT NULL DEFAULT 0 CHECK (quantity_delivered >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_stop_product UNIQUE (stop_id, product_id)
);

-- Index for rapid stop item lookups
CREATE INDEX IF NOT EXISTS idx_delivery_stop_items_stop_id 
ON public.delivery_stop_items(stop_id);

CREATE INDEX IF NOT EXISTS idx_delivery_stop_items_product_id 
ON public.delivery_stop_items(product_id);

-- Enable & Force Row-Level Security on delivery_stop_items
ALTER TABLE public.delivery_stop_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_stop_items FORCE ROW LEVEL SECURITY;

-- 1.3 RLS Policies for delivery_stop_items matching delivery_stops
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_stop_items' AND policyname = 'dsi_select') THEN
        CREATE POLICY dsi_select ON public.delivery_stop_items
        FOR SELECT TO authenticated
        USING (
            public.get_user_role() = 'owner' 
            OR (public.get_staff_permissions()->>'can_deliveries')::boolean = true
            OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_stop_items' AND policyname = 'dsi_modify') THEN
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
    END IF;
END $$;

-- 1.4 Ensure Composite Constraints on Inventory & Products
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_inv_warehouse_product'
    ) THEN
        ALTER TABLE public.inventory_balances 
        ADD CONSTRAINT uq_inv_warehouse_product UNIQUE(warehouse_id, product_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_customer_special_price'
    ) THEN
        ALTER TABLE public.customer_special_prices 
        ADD CONSTRAINT uq_customer_special_price UNIQUE(customer_id, product_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_gst_balance'
    ) THEN
        ALTER TABLE public.products 
        ADD CONSTRAINT chk_products_gst_balance CHECK (gst_rate = cgst_rate + sgst_rate);
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 2. HARDENED DELIVERY EXECUTION RPC (rpc_execute_delivery_stop)
--    Enforces deterministic lock hierarchy: orders -> delivery_stops -> order_items -> inventory_balances -> customers -> invoices
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_execute_delivery_stop(
    p_stop_id UUID,
    p_actual_delivered INT,
    p_empty_jars INT,
    p_damaged_jars INT,
    p_payment_amount NUMERIC DEFAULT 0.00,
    p_payment_method VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL,
    p_items JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_stop RECORD;
    v_order RECORD;
    v_customer RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_perms JSONB;
    v_payment_num VARCHAR(50);
    v_default_wh UUID;
    v_wh_location UUID;
    v_default_jar_id UUID;
    v_total_ordered_qty INT := 0;
    v_previously_delivered_qty INT := 0;
    v_remaining_ordered_qty INT := 0;
    v_new_cumulative_delivered INT := 0;
    v_previously_paid_amount NUMERIC(12,2) := 0.00;
    v_remaining_order_balance NUMERIC(12,2) := 0.00;
    v_new_cumulative_paid NUMERIC(12,2) := 0.00;
    v_current_total_custody INT := 0;
    v_total_returning INT := 0;
    v_new_full_holding INT := 0;
    v_new_empty_holding INT := 0;
    v_new_damaged_holding INT := 0;
    v_new_order_status VARCHAR(30);
    v_new_payment_status VARCHAR(20);
    v_item RECORD;
    v_parsed_item RECORD;
    v_order_id UUID;
    v_item_delivered_qty INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_deliveries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have delivery execution authority.';
    END IF;

    IF p_actual_delivered < 0 OR p_empty_jars < 0 OR p_damaged_jars < 0 THEN
        RAISE EXCEPTION 'Quantities cannot be negative.';
    END IF;
    IF p_payment_amount < 0 THEN
        RAISE EXCEPTION 'Payment amount cannot be negative.';
    END IF;

    -- Look up order_id first without lock to enforce global lock hierarchy
    SELECT order_id INTO v_order_id FROM public.delivery_stops WHERE id = p_stop_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop not found: %', p_stop_id;
    END IF;

    -- =========================================================================
    -- DETERMINISTIC LOCK ACQUISITION HIERARCHY
    -- 1. Order row
    -- 2. Delivery stop rows (ORDER BY id)
    -- 3. Order item rows (ORDER BY id)
    -- 4. Inventory balance rows (ORDER BY product_id)
    -- 5. Customer row
    -- 6. Invoice row
    -- =========================================================================

    -- Step 1: Lock parent order FOR UPDATE
    SELECT * INTO v_order FROM public.orders WHERE id = v_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent order % not found.', v_order_id;
    END IF;

    -- Step 2: Lock delivery stop row FOR UPDATE
    SELECT * INTO v_stop FROM public.delivery_stops WHERE id = p_stop_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop not found: %', p_stop_id;
    END IF;

    IF v_caller_role != 'owner' AND v_stop.assigned_staff_id != v_caller_id THEN
        RAISE EXCEPTION 'Access denied: staff can only execute stops assigned to them.';
    END IF;

    -- Idempotency check: if already completed, return existing status
    IF v_stop.status = 'COMPLETED' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', 'ALREADY_COMPLETED'
        );
    END IF;

    IF v_stop.status NOT IN ('ASSIGNED', 'EN_ROUTE', 'PENDING') THEN
        RAISE EXCEPTION 'Delivery stop cannot be executed in "%" status.', v_stop.status;
    END IF;

    IF v_order.status IN ('DELIVERED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Cannot execute delivery stop for order in "%" status.', v_order.status;
    END IF;

    -- Resolve canonical central warehouse
    SELECT id, location_id INTO v_default_wh, v_wh_location 
    FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL OR v_wh_location IS NULL THEN
        RAISE EXCEPTION 'Canonical warehouse configuration is missing.';
    END IF;

    -- Step 3: Lock all order_items for this order (ORDER BY id FOR UPDATE)
    PERFORM 1 FROM public.order_items WHERE order_id = v_order.id ORDER BY id FOR UPDATE;

    -- Step 4: Lock inventory_balances for products in this order (ORDER BY product_id FOR UPDATE)
    PERFORM 1 FROM public.inventory_balances 
    WHERE warehouse_id = v_default_wh 
      AND product_id IN (SELECT product_id FROM public.order_items WHERE order_id = v_order.id)
    ORDER BY product_id FOR UPDATE;

    -- Step 5: Lock customer record FOR UPDATE
    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer % not found.', v_order.customer_id;
    END IF;

    -- Handle explicit failure report: release reserved inventory for order items if stop failed
    IF p_failure_reason IS NOT NULL AND p_actual_delivered = 0 THEN
        UPDATE public.delivery_stops
        SET status = 'FAILED',
            failure_reason = p_failure_reason,
            executed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_stop_id;

        -- Release reserved stock back to available pool for undelivered items
        FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v_order.id ORDER BY product_id
        LOOP
            UPDATE public.inventory_balances
            SET quantity_reserved = pg_catalog.greatest(0, quantity_reserved - (v_item.quantity - v_item.delivered_quantity)),
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;
        END LOOP;

        UPDATE public.orders
        SET status = 'CANCELLED',
            updated_at = pg_catalog.now()
        WHERE id = v_order.id;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'FAILED');
    END IF;

    -- Calculate total ordered & previously delivered quantities
    SELECT COALESCE(SUM(quantity), 0) INTO v_total_ordered_qty
    FROM public.order_items WHERE order_id = v_order.id;

    SELECT COALESCE(SUM(actual_delivered_quantity), 0) INTO v_previously_delivered_qty
    FROM public.delivery_stops
    WHERE order_id = v_order.id AND status = 'COMPLETED' AND id != p_stop_id;

    v_remaining_ordered_qty := v_total_ordered_qty - v_previously_delivered_qty;

    IF p_actual_delivered > v_remaining_ordered_qty THEN
        RAISE EXCEPTION 'Delivered quantity (%) exceeds remaining order quantity (%). Total ordered: %, previously delivered: %.',
            p_actual_delivered, v_remaining_ordered_qty, v_total_ordered_qty, v_previously_delivered_qty;
    END IF;

    -- Validate payment against remaining balance
    SELECT COALESCE(SUM(payment_collected), 0.00) INTO v_previously_paid_amount
    FROM public.delivery_stops
    WHERE order_id = v_order.id AND status = 'COMPLETED' AND id != p_stop_id;

    v_remaining_order_balance := pg_catalog.greatest(0.00, v_order.total_amount - v_previously_paid_amount);

    IF p_payment_amount > 0 THEN
        IF p_payment_method IS NULL OR p_payment_method NOT IN ('CASH', 'UPI', 'CREDIT') THEN
            RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, CREDIT.', p_payment_method;
        END IF;
        IF p_payment_method = 'CREDIT' THEN
            RAISE EXCEPTION 'Payment amount cannot be positive when payment method is CREDIT.';
        END IF;
        IF p_payment_amount > v_remaining_order_balance THEN
            RAISE EXCEPTION 'Payment amount (%) exceeds outstanding order balance (%). Order total: %, previously paid: %.',
                p_payment_amount, v_remaining_order_balance, v_order.total_amount, v_previously_paid_amount;
        END IF;
    END IF;

    SELECT id INTO v_default_jar_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_default_jar_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;

    -- Validate Physical Jar Custody
    v_current_total_custody := v_customer.total_full_jars_holding + v_customer.total_empty_jars_holding + COALESCE(v_customer.total_damaged_jars_holding, 0);
    v_total_returning := p_empty_jars + p_damaged_jars;

    IF v_total_returning > v_current_total_custody THEN
        RAISE EXCEPTION 'Invalid physical return: customer holds % jars, but attempted to return % jars.',
            v_current_total_custody, v_total_returning;
    END IF;

    v_new_full_holding := v_customer.total_full_jars_holding + p_actual_delivered;

    IF v_customer.total_empty_jars_holding >= p_empty_jars THEN
        v_new_empty_holding := v_customer.total_empty_jars_holding - p_empty_jars;
    ELSE
        v_new_full_holding := v_new_full_holding - (p_empty_jars - v_customer.total_empty_jars_holding);
        v_new_empty_holding := 0;
    END IF;

    v_new_damaged_holding := COALESCE(v_customer.total_damaged_jars_holding, 0);
    IF p_damaged_jars > 0 THEN
        IF v_new_damaged_holding >= p_damaged_jars THEN
            v_new_damaged_holding := v_new_damaged_holding - p_damaged_jars;
        ELSE
            DECLARE
                v_excess_dmg INT := p_damaged_jars - v_new_damaged_holding;
            BEGIN
                v_new_damaged_holding := 0;
                IF v_new_empty_holding >= v_excess_dmg THEN
                    v_new_empty_holding := v_new_empty_holding - v_excess_dmg;
                ELSE
                    v_new_full_holding := v_new_full_holding - (v_excess_dmg - v_new_empty_holding);
                    v_new_empty_holding := 0;
                END IF;
            END;
        END IF;
    END IF;

    IF v_new_full_holding < 0 OR v_new_empty_holding < 0 THEN
        RAISE EXCEPTION 'Physical custody violation: customer jar holding cannot become negative (full: %, empty: %).',
            v_new_full_holding, v_new_empty_holding;
    END IF;

    -- Establish internal unforgeable token for delivery execution
    PERFORM public._internal_establish_rpc_context('rpc_execute_delivery_stop', 'DELIVERY_STOP_EXECUTION');

    -- Update customer custody holdings
    UPDATE public.customers
    SET total_full_jars_holding = v_new_full_holding,
        total_empty_jars_holding = v_new_empty_holding,
        total_damaged_jars_holding = v_new_damaged_holding,
        updated_at = pg_catalog.now()
    WHERE id = v_customer.id;

    -- Record Product-Level Deliveries & Release Inventory Reservations
    IF p_items IS NOT NULL AND pg_catalog.jsonb_array_length(p_items) > 0 THEN
        -- Explicit multi-product delivery items passed
        FOR v_parsed_item IN 
            SELECT (val->>'product_id')::UUID AS product_id, (val->>'quantity_delivered')::INT AS qty
            FROM pg_catalog.jsonb_array_elements(p_items) AS val
        LOOP
            IF v_parsed_item.qty > 0 THEN
                -- Insert stop-level item breakdown
                INSERT INTO public.delivery_stop_items (stop_id, product_id, quantity_delivered)
                VALUES (p_stop_id, v_parsed_item.product_id, v_parsed_item.qty)
                ON CONFLICT (stop_id, product_id) DO UPDATE
                SET quantity_delivered = public.delivery_stop_items.quantity_delivered + EXCLUDED.quantity_delivered,
                    updated_at = pg_catalog.now();

                -- Update cumulative delivered quantity on order_items
                UPDATE public.order_items
                SET delivered_quantity = delivered_quantity + v_parsed_item.qty
                WHERE order_id = v_order.id AND product_id = v_parsed_item.product_id;

                -- Deduct inventory on-hand and release reservation
                UPDATE public.inventory_balances
                SET quantity_on_hand = pg_catalog.greatest(0, quantity_on_hand - v_parsed_item.qty),
                    quantity_reserved = pg_catalog.greatest(0, quantity_reserved - v_parsed_item.qty),
                    updated_at = pg_catalog.now()
                WHERE warehouse_id = v_default_wh AND product_id = v_parsed_item.product_id;

                -- Stock movement audit record
                INSERT INTO public.stock_movements (
                    product_id, source_location_id, destination_location_id,
                    quantity, movement_type, reference_type, reference_id, created_by
                ) VALUES (
                    v_parsed_item.product_id, v_wh_location, v_customer.location_id,
                    v_parsed_item.qty, 'DELIVERY_DISPATCH', 'DELIVERY_STOP', p_stop_id, v_caller_id
                );
            END IF;
        END LOOP;
    ELSE
        -- Fallback / single-product delivery execution: attribute p_actual_delivered to primary order item or default jar
        IF p_actual_delivered > 0 THEN
            SELECT product_id INTO v_parsed_item.product_id
            FROM public.order_items 
            WHERE order_id = v_order.id 
            ORDER BY (product_id = v_default_jar_id) DESC, quantity DESC 
            LIMIT 1;

            INSERT INTO public.delivery_stop_items (stop_id, product_id, quantity_delivered)
            VALUES (p_stop_id, v_parsed_item.product_id, p_actual_delivered)
            ON CONFLICT (stop_id, product_id) DO UPDATE
            SET quantity_delivered = public.delivery_stop_items.quantity_delivered + EXCLUDED.quantity_delivered,
                updated_at = pg_catalog.now();

            UPDATE public.order_items
            SET delivered_quantity = delivered_quantity + p_actual_delivered
            WHERE order_id = v_order.id AND product_id = v_parsed_item.product_id;

            UPDATE public.inventory_balances
            SET quantity_on_hand = pg_catalog.greatest(0, quantity_on_hand - p_actual_delivered),
                quantity_reserved = pg_catalog.greatest(0, quantity_reserved - p_actual_delivered),
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_parsed_item.product_id;

            INSERT INTO public.stock_movements (
                product_id, source_location_id, destination_location_id,
                quantity, movement_type, reference_type, reference_id, created_by
            ) VALUES (
                v_parsed_item.product_id, v_wh_location, v_customer.location_id,
                p_actual_delivered, 'DELIVERY_DISPATCH', 'DELIVERY_STOP', p_stop_id, v_caller_id
            );
        END IF;
    END IF;

    -- Record jar custody movements if jars delivered or returned
    IF p_actual_delivered > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id, source_location_id, destination_location_id,
            condition_from, condition_to, quantity, movement_type, reference_type, reference_id, created_by
        ) VALUES (
            v_default_jar_id, v_wh_location, v_customer.location_id,
            'FULL_USABLE', 'FULL_USABLE', p_actual_delivered, 'CUSTOMER_DELIVERY', 'DELIVERY_STOP', p_stop_id, v_caller_id
        );
    END IF;

    IF p_empty_jars > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id, source_location_id, destination_location_id,
            condition_from, condition_to, quantity, movement_type, reference_type, reference_id, created_by
        ) VALUES (
            v_default_jar_id, v_customer.location_id, v_wh_location,
            'EMPTY_CLEAN', 'EMPTY_CLEAN', p_empty_jars, 'CUSTOMER_EMPTY_RETURN', 'DELIVERY_STOP', p_stop_id, v_caller_id
        );
    END IF;

    IF p_damaged_jars > 0 THEN
        INSERT INTO public.jar_custody_movements (
            product_id, source_location_id, destination_location_id,
            condition_from, condition_to, quantity, movement_type, reference_type, reference_id, created_by
        ) VALUES (
            v_default_jar_id, v_customer.location_id, v_wh_location,
            'DAMAGED_REPAIRABLE', 'DAMAGED_REPAIRABLE', p_damaged_jars, 'DAMAGED_COLLECTED', 'DELIVERY_STOP', p_stop_id, v_caller_id
        );
    END IF;

    -- Clear RPC context
    PERFORM public._internal_clear_rpc_context();

    -- Payment Collection & Accounting
    IF p_payment_amount > 0 THEN
        v_payment_num := 'PAY-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

        INSERT INTO public.customer_payments (
            payment_number, customer_id, order_id, amount,
            payment_method, reference_number, collected_by_staff_id, payment_date
        ) VALUES (
            v_payment_num, v_customer.id, v_order.id, p_payment_amount,
            p_payment_method, 'STOP-' || v_stop.sequence_number, v_caller_id, CURRENT_DATE
        );

        UPDATE public.customers
        SET current_balance = current_balance - p_payment_amount,
            updated_at = pg_catalog.now()
        WHERE id = v_customer.id;

        INSERT INTO public.financial_ledger (
            entry_number, account_code, account_name, debit, credit,
            description, reference_type, reference_id, created_by
        ) VALUES (
            'LED-' || v_payment_num || '-DR',
            CASE WHEN p_payment_method = 'UPI' THEN '1020' ELSE '1015' END,
            CASE WHEN p_payment_method = 'UPI' THEN 'Bank Current Account' ELSE 'Cash Float with Driver' END,
            p_payment_amount, 0.00,
            'Route collection from ' || v_customer.contact_name, 'PAYMENT', p_stop_id, v_caller_id
        );

        INSERT INTO public.financial_ledger (
            entry_number, account_code, account_name, debit, credit,
            description, reference_type, reference_id, created_by
        ) VALUES (
            'LED-' || v_payment_num || '-CR',
            '1110', 'Accounts Receivable', 0.00, p_payment_amount,
            'Settlement of A/R for order ' || v_order.order_number, 'PAYMENT', p_stop_id, v_caller_id
        );
    END IF;

    -- Update Delivery Stop Status to COMPLETED
    UPDATE public.delivery_stops
    SET status = 'COMPLETED',
        actual_delivered_quantity = p_actual_delivered,
        empty_jars_collected = p_empty_jars,
        damaged_jars_collected = p_damaged_jars,
        payment_collected = p_payment_amount,
        payment_method = p_payment_method,
        notes = p_notes,
        executed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_stop_id;

    -- Recalculate Cumulative Status
    v_new_cumulative_delivered := v_previously_delivered_qty + p_actual_delivered;
    v_new_cumulative_paid := v_previously_paid_amount + p_payment_amount;

    v_new_order_status := CASE 
        WHEN v_new_cumulative_delivered >= v_total_ordered_qty THEN 'DELIVERED'
        WHEN v_new_cumulative_delivered > 0 THEN 'PARTIALLY_DELIVERED'
        ELSE v_order.status
    END;

    v_new_payment_status := CASE 
        WHEN v_new_cumulative_paid >= v_order.total_amount THEN 'PAID'
        WHEN v_new_cumulative_paid > 0 THEN 'PARTIALLY_PAID'
        ELSE 'UNPAID'
    END;

    UPDATE public.orders
    SET status = v_new_order_status,
        payment_status = v_new_payment_status,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    UPDATE public.invoices
    SET balance_due = pg_catalog.greatest(0.00, total_amount - v_new_cumulative_paid),
        status = CASE 
            WHEN v_new_cumulative_paid >= total_amount THEN 'PAID'
            WHEN v_new_cumulative_paid > 0 THEN 'PARTIALLY_PAID'
            ELSE 'UNPAID'
        END,
        updated_at = pg_catalog.now()
    WHERE order_id = v_order.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'COMPLETED',
        'delivered', p_actual_delivered,
        'cumulative_delivered', v_new_cumulative_delivered,
        'remaining_ordered', (v_total_ordered_qty - v_new_cumulative_delivered),
        'payment_collected', p_payment_amount,
        'cumulative_paid', v_new_cumulative_paid,
        'remaining_balance', (v_order.total_amount - v_new_cumulative_paid),
        'empty_collected', p_empty_jars,
        'damaged_collected', p_damaged_jars,
        'customer_closing_holding', (v_new_full_holding + v_new_empty_holding + v_new_damaged_holding)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Revoke & Grant for rpc_execute_delivery_stop
REVOKE ALL ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT, JSONB) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 3. REMEDIATED ORDER CANCELLATION RPC (rpc_cancel_customer_order)
--    - Per-product reservation release
--    - Dual-entry GL reversal entries (Debits == Credits)
--    - Partial-delivery invoice reconciliation
--    - Strict deterministic row-lock hierarchy matching execution RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_cancel_customer_order(
    p_order_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_order RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_item RECORD;
    v_remaining_res INT := 0;
    v_invoice RECORD;
    v_previously_paid NUMERIC(12,2) := 0.00;
    v_entry_num VARCHAR(50);
    v_cancelled_subtotal NUMERIC(12,2) := 0.00;
    v_cancelled_tax NUMERIC(12,2) := 0.00;
    v_cancelled_total NUMERIC(12,2) := 0.00;
    v_delivered_subtotal NUMERIC(12,2) := 0.00;
    v_delivered_tax NUMERIC(12,2) := 0.00;
    v_delivered_total NUMERIC(12,2) := 0.00;
    v_new_balance_due NUMERIC(12,2) := 0.00;
    v_new_inv_status VARCHAR(20);
    v_released_reservations_count INT := 0;
    v_line_cancelled_subtotal NUMERIC(12,2);
    v_line_cancelled_tax NUMERIC(12,2);
    v_line_delivered_subtotal NUMERIC(12,2);
    v_line_delivered_tax NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_orders')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have order cancellation authority.';
    END IF;

    -- =========================================================================
    -- DETERMINISTIC LOCK ACQUISITION HIERARCHY
    -- 1. Order row
    -- 2. Delivery stop rows (ORDER BY id)
    -- 3. Order item rows (ORDER BY id)
    -- 4. Inventory balance rows (ORDER BY product_id)
    -- 5. Customer row
    -- 6. Invoice row
    -- =========================================================================

    -- Step 1: Lock parent order FOR UPDATE
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found.', p_order_id;
    END IF;

    -- Terminal status guard
    IF v_order.status IN ('DELIVERED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Order % cannot be cancelled in "%" status.', p_order_id, v_order.status;
    END IF;

    -- Resolve default central warehouse
    SELECT id, location_id INTO v_default_wh, v_wh_location 
    FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        RAISE EXCEPTION 'Default central warehouse not found.';
    END IF;

    -- Step 2: Lock delivery stops (ORDER BY id FOR UPDATE)
    PERFORM 1 FROM public.delivery_stops WHERE order_id = v_order.id ORDER BY id FOR UPDATE;

    -- Step 3: Lock order items (ORDER BY id FOR UPDATE)
    PERFORM 1 FROM public.order_items WHERE order_id = v_order.id ORDER BY id FOR UPDATE;

    -- Step 4: Lock inventory balances (ORDER BY product_id FOR UPDATE)
    PERFORM 1 FROM public.inventory_balances 
    WHERE warehouse_id = v_default_wh 
      AND product_id IN (SELECT product_id FROM public.order_items WHERE order_id = v_order.id)
    ORDER BY product_id FOR UPDATE;

    -- Step 5: Lock customer row FOR UPDATE
    PERFORM 1 FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;

    -- Step 6: Lock invoice row FOR UPDATE
    SELECT * INTO v_invoice FROM public.invoices WHERE order_id = v_order.id FOR UPDATE;

    -- =========================================================================
    -- 1. PER-PRODUCT RESERVATION RELEASE & FINANCIAL TOTALS CALCULATION
    -- =========================================================================
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v_order.id ORDER BY product_id
    LOOP
        -- Calculate outstanding undelivered quantity for this specific product
        v_remaining_res := pg_catalog.greatest(0, v_item.quantity - COALESCE(v_item.delivered_quantity, 0));

        -- Atomically release remaining reserved inventory
        IF v_remaining_res > 0 THEN
            UPDATE public.inventory_balances
            SET quantity_reserved = pg_catalog.greatest(0, quantity_reserved - v_remaining_res),
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;

            v_released_reservations_count := v_released_reservations_count + 1;
        END IF;

        -- Calculate financial breakdown for cancelled (undelivered) portion
        v_line_cancelled_subtotal := v_remaining_res * v_item.unit_price;
        v_line_cancelled_tax := pg_catalog.round(v_line_cancelled_subtotal * (v_item.tax_rate / 100.0), 2);
        v_cancelled_subtotal := v_cancelled_subtotal + v_line_cancelled_subtotal;
        v_cancelled_tax := v_cancelled_tax + v_line_cancelled_tax;

        -- Calculate financial breakdown for delivered portion
        v_line_delivered_subtotal := COALESCE(v_item.delivered_quantity, 0) * v_item.unit_price;
        v_line_delivered_tax := pg_catalog.round(v_line_delivered_subtotal * (v_item.tax_rate / 100.0), 2);
        v_delivered_subtotal := v_delivered_subtotal + v_line_delivered_subtotal;
        v_delivered_tax := v_delivered_tax + v_line_delivered_tax;
    END LOOP;

    v_cancelled_total := v_cancelled_subtotal + v_cancelled_tax;
    v_delivered_total := v_delivered_subtotal + v_delivered_tax;

    -- =========================================================================
    -- 2. UPDATE ORDER & DELIVERY STOPS STATUS
    -- =========================================================================
    UPDATE public.orders
    SET status = 'CANCELLED',
        notes = CASE 
            WHEN p_reason IS NOT NULL THEN COALESCE(notes, '') || ' [Cancelled: ' || p_reason || ']'
            ELSE notes
        END,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    -- Cancel all unexecuted delivery stops; preserve completed or failed stops
    UPDATE public.delivery_stops
    SET status = 'CANCELLED',
        failure_reason = COALESCE(p_reason, 'Order cancelled'),
        updated_at = pg_catalog.now()
    WHERE order_id = v_order.id AND status NOT IN ('COMPLETED', 'FAILED');

    -- =========================================================================
    -- 3. FINANCIAL LEDGER REVERSALS & INVOICE RECONCILIATION
    -- =========================================================================
    IF v_invoice.id IS NOT NULL THEN
        -- Resolve cumulative payments collected for this invoice
        SELECT COALESCE(SUM(amount), 0.00) INTO v_previously_paid
        FROM public.customer_payments
        WHERE invoice_id = v_invoice.id;

        IF v_previously_paid = 0.00 AND v_invoice.status IN ('PAID', 'PARTIALLY_PAID') THEN
            v_previously_paid := pg_catalog.greatest(0.00, v_invoice.total_amount - v_invoice.balance_due);
        END IF;

        -- Only reverse the CANCELLED portion of the customer balance & General Ledger
        IF v_cancelled_total > 0 THEN
            PERFORM public._internal_establish_rpc_context('rpc_cancel_customer_order', 'CUSTOMER_ORDER_BALANCE_ONLY');

            -- Reduce customer current_balance by cancelled total
            -- (Preserves debt for delivered items; credits customer for unfulfilled amount)
            UPDATE public.customers
            SET current_balance = current_balance - v_cancelled_total,
                updated_at = pg_catalog.now()
            WHERE id = v_order.customer_id;

            PERFORM public._internal_clear_rpc_context();

            v_entry_num := 'REV-' || v_order.order_number;

            -- Double-entry reversal 1: Credit Accounts Receivable (1110)
            INSERT INTO public.financial_ledger (
                entry_number, entry_date, account_code, account_name,
                debit, credit, description, reference_type, reference_id, is_reversal, created_by
            ) VALUES (
                'LED-' || v_entry_num || '-AR',
                CURRENT_DATE,
                '1110',
                'Accounts Receivable',
                0.00,
                v_cancelled_total,
                'Order Cancellation A/R Reversal: ' || v_order.order_number,
                'REVERSAL',
                v_invoice.id,
                true,
                v_caller_id
            );

            -- Double-entry reversal 2: Debit Water Sales Revenue (4010)
            INSERT INTO public.financial_ledger (
                entry_number, entry_date, account_code, account_name,
                debit, credit, description, reference_type, reference_id, is_reversal, created_by
            ) VALUES (
                'LED-' || v_entry_num || '-REV',
                CURRENT_DATE,
                '4010',
                'Water Sales Revenue',
                v_cancelled_subtotal,
                0.00,
                'Order Cancellation Revenue Reversal: ' || v_order.order_number,
                'REVERSAL',
                v_invoice.id,
                true,
                v_caller_id
            );

            -- Double-entry reversal 3: Debit Output GST Payable (2110) if tax was charged
            IF v_cancelled_tax > 0 THEN
                INSERT INTO public.financial_ledger (
                    entry_number, entry_date, account_code, account_name,
                    debit, credit, description, reference_type, reference_id, is_reversal, created_by
                ) VALUES (
                    'LED-' || v_entry_num || '-TAX',
                    CURRENT_DATE,
                    '2110',
                    'GST Output Payable',
                    v_cancelled_tax,
                    0.00,
                    'Order Cancellation GST Reversal: ' || v_order.order_number,
                    'REVERSAL',
                    v_invoice.id,
                    true,
                    v_caller_id
                );
            END IF;
        END IF;

        -- Reconcile Invoice State
        IF v_delivered_total = 0.00 THEN
            -- Complete order cancellation with zero deliveries: invoice is fully cancelled
            UPDATE public.invoices
            SET status = 'CANCELLED',
                balance_due = 0.00,
                subtotal = 0.00,
                tax_amount = 0.00,
                total_amount = 0.00,
                updated_at = pg_catalog.now()
            WHERE id = v_invoice.id;
        ELSE
            -- Partially delivered order: prorate invoice to delivered portion
            v_new_balance_due := pg_catalog.greatest(0.00, v_delivered_total - v_previously_paid);
            v_new_inv_status := CASE 
                WHEN v_new_balance_due = 0.00 THEN 'PAID'
                WHEN v_previously_paid > 0 THEN 'PARTIALLY_PAID'
                ELSE 'UNPAID'
            END;

            UPDATE public.invoices
            SET subtotal = v_delivered_subtotal,
                tax_amount = v_delivered_tax,
                total_amount = v_delivered_total,
                balance_due = v_new_balance_due,
                status = v_new_inv_status,
                updated_at = pg_catalog.now()
            WHERE id = v_invoice.id;
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', 'CANCELLED',
        'cancelled_subtotal', v_cancelled_subtotal,
        'cancelled_tax', v_cancelled_tax,
        'cancelled_total', v_cancelled_total,
        'delivered_total', v_delivered_total,
        'released_reservation', (v_released_reservations_count > 0)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_cancel_customer_order(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_customer_order(UUID, TEXT) TO authenticated, service_role;

COMMIT;



-- AquaTrack ERP - Migration: Remediation Round 9
-- Version: 20261106000001_remediation_round_9.sql

-- ==============================================================================
-- AquaTrack ERP — Database Migration Round 9
-- File: supabase/migrations/20261106000001_remediation_round_9.sql
-- Date: 2026-11-06
-- Objective: Critical Delivery Stop Execution, Product-Level Reservation Release,
--            Reusable Jar Custody Isolation, Safe Historical Reconciliation,
--            Direct Delivery Item Write Lockdown, and GL Ledger Integrity.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. SECURITY HARDENING: LOCK DOWN DELIVERY STOP ITEMS DIRECT WRITES
-- ------------------------------------------------------------------------------
-- Drop direct modification policy for delivery_stop_items.
-- Mutations must ONLY happen via the validated SECURITY DEFINER RPC rpc_execute_delivery_stop.
DROP POLICY IF EXISTS dsi_modify ON public.delivery_stop_items;
REVOKE INSERT, UPDATE, DELETE ON public.delivery_stop_items FROM authenticated, anon, PUBLIC;

-- Ensure SELECT policy allows authorized roles/permissions only
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'delivery_stop_items' AND policyname = 'dsi_select'
    ) THEN
        CREATE POLICY dsi_select ON public.delivery_stop_items
        FOR SELECT TO authenticated
        USING (
            public.get_user_role() = 'owner' 
            OR (public.get_staff_permissions()->>'can_deliveries')::boolean = true
            OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        );
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 2. HISTORICAL DELIVERY QUANTITIES AUDIT & RECONCILIATION TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.historical_order_reconciliation_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    flag_type VARCHAR(50) NOT NULL,
    details JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW', 'RESOLVED', 'DISMISSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_order_id 
ON public.historical_order_reconciliation_flags(order_id);

ALTER TABLE public.historical_order_reconciliation_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_order_reconciliation_flags FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'historical_order_reconciliation_flags' AND policyname = 'horf_owner_select'
    ) THEN
        CREATE POLICY horf_owner_select ON public.historical_order_reconciliation_flags
        FOR SELECT TO authenticated
        USING (public.get_user_role() = 'owner');
    END IF;
END $$;

REVOKE ALL ON public.historical_order_reconciliation_flags FROM PUBLIC, anon;
GRANT SELECT ON public.historical_order_reconciliation_flags TO authenticated;
GRANT ALL ON public.historical_order_reconciliation_flags TO service_role;

-- 2.1 Safe Historical Backfill Strategy for order_items.delivered_quantity
DO $$
DECLARE
    v_ord RECORD;
    v_item_count INT;
    v_single_item_id UUID;
    v_single_item_qty INT;
    v_dsi_count INT;
BEGIN
    FOR v_ord IN 
        SELECT o.id, o.order_number, o.status, COALESCE(SUM(ds.actual_delivered_quantity), 0) AS total_stop_delivered
        FROM public.orders o
        JOIN public.delivery_stops ds ON ds.order_id = o.id AND ds.status = 'COMPLETED'
        GROUP BY o.id, o.order_number, o.status
    LOOP
        SELECT COUNT(*), MIN(id), MIN(quantity) 
        INTO v_item_count, v_single_item_id, v_single_item_qty
        FROM public.order_items WHERE order_id = v_ord.id;

        IF v_item_count = 1 THEN
            -- Unambiguous single-item orders: backfill delivered_quantity directly
            UPDATE public.order_items
            SET delivered_quantity = pg_catalog.least(quantity, v_ord.total_stop_delivered)
            WHERE id = v_single_item_id;
        ELSE
            -- Multi-product order: check if granular delivery_stop_items exist
            SELECT COUNT(*) INTO v_dsi_count
            FROM public.delivery_stop_items dsi
            JOIN public.delivery_stops ds ON ds.id = dsi.stop_id
            WHERE ds.order_id = v_ord.id;

            IF v_dsi_count > 0 THEN
                UPDATE public.order_items oi
                SET delivered_quantity = COALESCE((
                    SELECT SUM(dsi.quantity_delivered)
                    FROM public.delivery_stop_items dsi
                    JOIN public.delivery_stops ds ON ds.id = dsi.stop_id
                    WHERE ds.order_id = oi.order_id AND dsi.product_id = oi.product_id
                ), 0)
                WHERE oi.order_id = v_ord.id;
            ELSE
                -- Ambiguous multi-product delivery: flag for owner review without fabricating numbers
                INSERT INTO public.historical_order_reconciliation_flags (
                    order_id, flag_type, details, status
                ) VALUES (
                    v_ord.id,
                    'AMBIGUOUS_MULTI_PRODUCT_DELIVERY',
                    pg_catalog.jsonb_build_object(
                        'order_number', v_ord.order_number,
                        'order_status', v_ord.status,
                        'total_delivered_on_stops', v_ord.total_stop_delivered,
                        'item_count', v_item_count
                    ),
                    'PENDING_REVIEW'
                )
                ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END LOOP;
END $$;


-- ------------------------------------------------------------------------------
-- 3. REMEDIATED DELIVERY STOP EXECUTION RPC (rpc_execute_delivery_stop)
--    - Deterministic lock hierarchy:
--      1. orders -> 2. delivery_stops -> 3. order_items -> 4. inventory_balances -> 5. customers -> 6. invoices
--    - Strict product-level membership and remaining quantity validation
--    - Reject duplicate product IDs in items payload
--    - Never clamp stock or reservations with GREATEST(0, ...); fail if insufficient
--    - Calculate jar custody movements STRICTLY for products where is_reusable_jar = true
--    - Single failed stop does NOT cancel active or partially delivered orders
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_execute_delivery_stop(
    p_stop_id UUID,
    p_actual_delivered INT,
    p_empty_jars INT,
    p_damaged_jars INT,
    p_payment_amount NUMERIC DEFAULT 0.00,
    p_payment_method VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL,
    p_items JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_stop RECORD;
    v_order RECORD;
    v_customer RECORD;
    v_invoice RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_perms JSONB;
    v_payment_num VARCHAR(50);
    v_default_wh UUID;
    v_wh_location UUID;
    v_default_jar_id UUID;
    v_total_ordered_qty INT := 0;
    v_previously_delivered_qty INT := 0;
    v_remaining_ordered_qty INT := 0;
    v_new_cumulative_delivered INT := 0;
    v_previously_paid_amount NUMERIC(12,2) := 0.00;
    v_remaining_order_balance NUMERIC(12,2) := 0.00;
    v_new_cumulative_paid NUMERIC(12,2) := 0.00;
    v_current_total_custody INT := 0;
    v_total_returning INT := 0;
    v_new_full_holding INT := 0;
    v_new_empty_holding INT := 0;
    v_new_damaged_holding INT := 0;
    v_new_order_status VARCHAR(30);
    v_new_payment_status VARCHAR(20);
    v_order_id UUID;
    v_other_pending_stops_count INT := 0;
    v_items_total_count INT := 0;
    v_items_distinct_count INT := 0;
    v_items_sum_delivered INT := 0;
    v_order_items_count INT := 0;
    v_matched_order_item RECORD;
    v_inv_bal RECORD;
    v_parsed_item RECORD;
    v_reusable_jars_delivered INT := 0;
    v_is_jar BOOLEAN;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_deliveries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have delivery execution authority.';
    END IF;

    -- Strict non-null & non-negative parameter validation
    IF p_actual_delivered IS NULL OR p_empty_jars IS NULL OR p_damaged_jars IS NULL THEN
        RAISE EXCEPTION 'Quantities cannot be null.';
    END IF;
    IF p_actual_delivered < 0 OR p_empty_jars < 0 OR p_damaged_jars < 0 THEN
        RAISE EXCEPTION 'Quantities cannot be negative.';
    END IF;
    IF p_payment_amount IS NULL OR p_payment_amount < 0 THEN
        RAISE EXCEPTION 'Payment amount cannot be null or negative.';
    END IF;

    -- Look up order_id first without lock to enforce global lock hierarchy
    SELECT order_id INTO v_order_id FROM public.delivery_stops WHERE id = p_stop_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop not found: %', p_stop_id;
    END IF;

    -- =========================================================================
    -- DETERMINISTIC LOCK ACQUISITION HIERARCHY
    -- 1. Order row
    -- 2. Delivery stop rows (ORDER BY id)
    -- 3. Order item rows (ORDER BY id)
    -- 4. Inventory balance rows (ORDER BY product_id)
    -- 5. Customer row
    -- 6. Invoice row
    -- =========================================================================

    -- Step 1: Lock parent order FOR UPDATE
    SELECT * INTO v_order FROM public.orders WHERE id = v_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent order % not found.', v_order_id;
    END IF;

    -- Step 2: Lock delivery stop rows FOR UPDATE in deterministic id order
    PERFORM 1 FROM public.delivery_stops WHERE order_id = v_order_id ORDER BY id FOR UPDATE;
    SELECT * INTO v_stop FROM public.delivery_stops WHERE id = p_stop_id;

    IF v_caller_role != 'owner' AND v_stop.assigned_staff_id != v_caller_id THEN
        RAISE EXCEPTION 'Access denied: staff can only execute stops assigned to them.';
    END IF;

    -- Idempotency check: if already completed, return existing status
    IF v_stop.status = 'COMPLETED' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', 'ALREADY_COMPLETED'
        );
    END IF;

    IF v_stop.status NOT IN ('ASSIGNED', 'EN_ROUTE', 'PENDING') THEN
        RAISE EXCEPTION 'Delivery stop cannot be executed in "%" status.', v_stop.status;
    END IF;

    IF v_order.status IN ('DELIVERED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Cannot execute delivery stop for order in "%" status.', v_order.status;
    END IF;

    -- Resolve canonical central warehouse
    SELECT id, location_id INTO v_default_wh, v_wh_location 
    FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL OR v_wh_location IS NULL THEN
        RAISE EXCEPTION 'Canonical warehouse configuration is missing.';
    END IF;

    -- Step 3: Lock all order_items for this order (ORDER BY id FOR UPDATE)
    PERFORM 1 FROM public.order_items WHERE order_id = v_order.id ORDER BY id FOR UPDATE;

    -- Step 4: Lock inventory_balances for products in this order (ORDER BY product_id FOR UPDATE)
    PERFORM 1 FROM public.inventory_balances 
    WHERE warehouse_id = v_default_wh 
      AND product_id IN (SELECT product_id FROM public.order_items WHERE order_id = v_order.id)
    ORDER BY product_id FOR UPDATE;

    -- Step 5: Lock customer record FOR UPDATE
    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer % not found.', v_order.customer_id;
    END IF;

    -- Step 6: Lock invoice row FOR UPDATE
    SELECT * INTO v_invoice FROM public.invoices WHERE order_id = v_order.id FOR UPDATE;

    -- =========================================================================
    -- FAILED DELIVERY STOP HANDLING
    -- A single failed stop must NOT cancel active or partially delivered orders!
    -- =========================================================================
    IF p_failure_reason IS NOT NULL AND p_actual_delivered = 0 THEN
        UPDATE public.delivery_stops
        SET status = 'FAILED',
            failure_reason = p_failure_reason,
            executed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_stop_id;

        -- Check previously delivered items across the order
        SELECT COALESCE(SUM(delivered_quantity), 0) INTO v_previously_delivered_qty
        FROM public.order_items WHERE order_id = v_order.id;

        -- Check if any other delivery stops are pending/assigned
        SELECT COUNT(*) INTO v_other_pending_stops_count
        FROM public.delivery_stops
        WHERE order_id = v_order.id AND id != p_stop_id AND status IN ('PENDING', 'ASSIGNED', 'EN_ROUTE');

        -- Safe Invariant: Never cancel an order that has pending stops or prior delivered goods!
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'status', 'FAILED',
            'order_status', v_order.status,
            'other_pending_stops', (v_other_pending_stops_count > 0),
            'previously_delivered', v_previously_delivered_qty,
            'message', 'Delivery stop recorded as failed. Order reservations preserved.'
        );
    END IF;

    -- =========================================================================
    -- VALIDATE REQUEST PAYLOAD & PRODUCT-LEVEL DETAILS
    -- =========================================================================
    SELECT COUNT(*) INTO v_order_items_count 
    FROM public.order_items WHERE order_id = v_order.id;

    IF p_items IS NOT NULL THEN
        IF pg_catalog.jsonb_typeof(p_items) != 'array' THEN
            RAISE EXCEPTION 'Invalid delivery items payload: expected JSON array.';
        END IF;

        IF pg_catalog.jsonb_array_length(p_items) > 0 THEN
            -- Validate presence, format, and non-negativity of each element in p_items
            FOR elem IN SELECT * FROM pg_catalog.jsonb_array_elements(p_items)
            LOOP
                IF elem->>'product_id' IS NULL OR (elem->>'product_id') = '' THEN
                    RAISE EXCEPTION 'Missing product_id in delivery items payload.';
                END IF;

                IF (elem->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                    RAISE EXCEPTION 'Malformed product_id in delivery items payload: %', elem->>'product_id';
                END IF;

                IF elem->>'quantity_delivered' IS NULL OR (elem->>'quantity_delivered') = '' THEN
                    RAISE EXCEPTION 'Missing quantity_delivered for product % in delivery items payload.', elem->>'product_id';
                END IF;

                IF (elem->>'quantity_delivered') !~ '^\d+$' THEN
                    RAISE EXCEPTION 'Invalid quantity_delivered for product %: % (must be a non-negative integer).', elem->>'product_id', elem->>'quantity_delivered';
                END IF;
            END LOOP;

            -- Check for duplicate product IDs in items payload
            SELECT COUNT(*), COUNT(DISTINCT (elem->>'product_id'))
            INTO v_items_total_count, v_items_distinct_count
            FROM pg_catalog.jsonb_array_elements(p_items) AS elem;

            IF v_items_total_count != v_items_distinct_count THEN
                RAISE EXCEPTION 'Duplicate product_id found in delivery items payload.';
            END IF;

            v_items_sum_delivered := 0;

            -- Validate each item against order_items and inventory_balances
            FOR v_parsed_item IN 
                SELECT (elem->>'product_id')::UUID AS product_id, (elem->>'quantity_delivered')::INT AS qty
                FROM pg_catalog.jsonb_array_elements(p_items) AS elem
            LOOP
                IF v_parsed_item.qty < 0 THEN
                    RAISE EXCEPTION 'Item delivered quantity cannot be negative for product %.', v_parsed_item.product_id;
                END IF;

                SELECT * INTO v_matched_order_item
                FROM public.order_items
                WHERE order_id = v_order.id AND product_id = v_parsed_item.product_id;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Product % does not belong to order %.', v_parsed_item.product_id, v_order.id;
                END IF;

                IF v_parsed_item.qty > (v_matched_order_item.quantity - v_matched_order_item.delivered_quantity) THEN
                    RAISE EXCEPTION 'Delivered quantity (%) exceeds remaining quantity (%) for product %.',
                        v_parsed_item.qty, (v_matched_order_item.quantity - v_matched_order_item.delivered_quantity), v_parsed_item.product_id;
                END IF;

                IF v_parsed_item.qty > 0 THEN
                    SELECT * INTO v_inv_bal
                    FROM public.inventory_balances
                    WHERE warehouse_id = v_default_wh AND product_id = v_parsed_item.product_id;

                    IF NOT FOUND THEN
                        RAISE EXCEPTION 'Inventory balance record missing for product %.', v_parsed_item.product_id;
                    END IF;

                    IF v_inv_bal.quantity_reserved < v_parsed_item.qty THEN
                        RAISE EXCEPTION 'Insufficient reserved quantity for product % (reserved: %, required: %).',
                            v_parsed_item.product_id, v_inv_bal.quantity_reserved, v_parsed_item.qty;
                    END IF;

                    IF v_inv_bal.quantity_on_hand < v_parsed_item.qty THEN
                        RAISE EXCEPTION 'Insufficient stock on hand for product % (on hand: %, required: %).',
                            v_parsed_item.product_id, v_inv_bal.quantity_on_hand, v_parsed_item.qty;
                    END IF;
                END IF;

                v_items_sum_delivered := v_items_sum_delivered + v_parsed_item.qty;
            END LOOP;

            IF v_items_sum_delivered != p_actual_delivered THEN
                RAISE EXCEPTION 'Aggregate delivered quantity (%) does not match sum of item quantities (%).',
                    p_actual_delivered, v_items_sum_delivered;
            END IF;
        ELSE
            -- Empty array [] passed
            IF v_order_items_count > 1 AND p_actual_delivered > 0 THEN
                RAISE EXCEPTION 'Multi-product order requires item-level delivery breakdown in p_items.';
            END IF;

            IF p_actual_delivered > 0 THEN
                RAISE EXCEPTION 'Delivered quantity (%) provided with empty items payload.', p_actual_delivered;
            END IF;
        END IF;
    ELSE
        -- No granular items payload passed (single-product fallback)
        IF v_order_items_count > 1 AND p_actual_delivered > 0 THEN
            RAISE EXCEPTION 'Multi-product order requires item-level delivery breakdown in p_items.';
        END IF;

        IF p_actual_delivered > 0 THEN
            SELECT * INTO v_matched_order_item
            FROM public.order_items
            WHERE order_id = v_order.id
            LIMIT 1;

            IF p_actual_delivered > (v_matched_order_item.quantity - v_matched_order_item.delivered_quantity) THEN
                RAISE EXCEPTION 'Delivered quantity (%) exceeds remaining quantity (%) for product %.',
                    p_actual_delivered, (v_matched_order_item.quantity - v_matched_order_item.delivered_quantity), v_matched_order_item.product_id;
            END IF;

            SELECT * INTO v_inv_bal
            FROM public.inventory_balances
            WHERE warehouse_id = v_default_wh AND product_id = v_matched_order_item.product_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Inventory balance record missing for product %.', v_matched_order_item.product_id;
            END IF;

            IF v_inv_bal.quantity_reserved < p_actual_delivered THEN
                RAISE EXCEPTION 'Insufficient reserved quantity for product % (reserved: %, required: %).',
                    v_matched_order_item.product_id, v_inv_bal.quantity_reserved, p_actual_delivered;
            END IF;

            IF v_inv_bal.quantity_on_hand < p_actual_delivered THEN
                RAISE EXCEPTION 'Insufficient stock on hand for product % (on hand: %, required: %).',
                    v_matched_order_item.product_id, v_inv_bal.quantity_on_hand, p_actual_delivered;
            END IF;
        END IF;
    END IF;

    -- =========================================================================
    -- PAYMENT RECONCILIATION: Single Consistent Source of Truth (public.customer_payments)
    -- =========================================================================
    SELECT COALESCE(SUM(amount), 0.00) INTO v_previously_paid_amount
    FROM public.customer_payments
    WHERE order_id = v_order.id OR (v_invoice.id IS NOT NULL AND invoice_id = v_invoice.id);

    v_remaining_order_balance := pg_catalog.greatest(0.00, v_order.total_amount - v_previously_paid_amount);

    IF p_payment_amount > 0 THEN
        IF p_payment_method IS NULL OR p_payment_method NOT IN ('CASH', 'UPI', 'CREDIT') THEN
            RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, CREDIT.', p_payment_method;
        END IF;
        IF p_payment_method = 'CREDIT' THEN
            RAISE EXCEPTION 'Payment amount cannot be positive when payment method is CREDIT.';
        END IF;
        IF p_payment_amount > v_remaining_order_balance THEN
            RAISE EXCEPTION 'Payment amount (%) exceeds outstanding order balance (%). Order total: %, previously paid: %.',
                p_payment_amount, v_remaining_order_balance, v_order.total_amount, v_previously_paid_amount;
        END IF;

        -- Prevent duplicate payment recording for the same delivery stop
        IF EXISTS (
            SELECT 1 FROM public.customer_payments
            WHERE order_id = v_order.id 
              AND reference_number = 'STOP-' || v_stop.sequence_number::text
        ) THEN
            RAISE EXCEPTION 'Payment already recorded for delivery stop %.', p_stop_id;
        END IF;
    END IF;

    -- Identify default reusable jar product
    SELECT id INTO v_default_jar_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;

    -- =========================================================================
    -- ISOLATE JAR CUSTODY MOVEMENTS (STRICTLY FOR is_reusable_jar = true)
    -- =========================================================================
    v_reusable_jars_delivered := 0;

    IF p_items IS NOT NULL AND pg_catalog.jsonb_array_length(p_items) > 0 THEN
        FOR v_parsed_item IN 
            SELECT (elem->>'product_id')::UUID AS product_id, (elem->>'quantity_delivered')::INT AS qty
            FROM pg_catalog.jsonb_array_elements(p_items) AS elem
        LOOP
            SELECT is_reusable_jar INTO v_is_jar FROM public.products WHERE id = v_parsed_item.product_id;
            IF v_is_jar IS TRUE THEN
                v_reusable_jars_delivered := v_reusable_jars_delivered + v_parsed_item.qty;
            END IF;
        END LOOP;
    ELSE
        IF p_actual_delivered > 0 THEN
            SELECT is_reusable_jar INTO v_is_jar FROM public.products WHERE id = v_matched_order_item.product_id;
            IF v_is_jar IS TRUE THEN
                v_reusable_jars_delivered := p_actual_delivered;
            END IF;
        END IF;
    END IF;

    -- Validate physical jar custody
    v_current_total_custody := v_customer.total_full_jars_holding + v_customer.total_empty_jars_holding + COALESCE(v_customer.total_damaged_jars_holding, 0);
    v_total_returning := p_empty_jars + p_damaged_jars;

    IF v_total_returning > v_current_total_custody THEN
        RAISE EXCEPTION 'Invalid physical return: customer holds % jars, but attempted to return % jars.',
            v_current_total_custody, v_total_returning;
    END IF;

    -- Reusable jar holdings update (non-jar products NEVER touch jar custody)
    v_new_full_holding := v_customer.total_full_jars_holding + v_reusable_jars_delivered;

    IF v_customer.total_empty_jars_holding >= p_empty_jars THEN
        v_new_empty_holding := v_customer.total_empty_jars_holding - p_empty_jars;
    ELSE
        v_new_full_holding := v_new_full_holding - (p_empty_jars - v_customer.total_empty_jars_holding);
        v_new_empty_holding := 0;
    END IF;

    v_new_damaged_holding := COALESCE(v_customer.total_damaged_jars_holding, 0);
    IF p_damaged_jars > 0 THEN
        IF v_new_damaged_holding >= p_damaged_jars THEN
            v_new_damaged_holding := v_new_damaged_holding - p_damaged_jars;
        ELSE
            DECLARE
                v_excess_dmg INT := p_damaged_jars - v_new_damaged_holding;
            BEGIN
                v_new_damaged_holding := 0;
                IF v_new_empty_holding >= v_excess_dmg THEN
                    v_new_empty_holding := v_new_empty_holding - v_excess_dmg;
                ELSE
                    v_new_full_holding := v_new_full_holding - (v_excess_dmg - v_new_empty_holding);
                    v_new_empty_holding := 0;
                END IF;
            END;
        END IF;
    END IF;

    IF v_new_full_holding < 0 OR v_new_empty_holding < 0 THEN
        RAISE EXCEPTION 'Physical custody violation: customer jar holding cannot become negative (full: %, empty: %).',
            v_new_full_holding, v_new_empty_holding;
    END IF;

    -- =========================================================================
    -- ATOMIC INVENTORY DEDUCTION & PRODUCT-LEVEL RECORDING
    -- =========================================================================
    IF p_items IS NOT NULL AND pg_catalog.jsonb_array_length(p_items) > 0 THEN
        FOR v_parsed_item IN 
            SELECT (elem->>'product_id')::UUID AS product_id, (elem->>'quantity_delivered')::INT AS qty
            FROM pg_catalog.jsonb_array_elements(p_items) AS elem
        LOOP
            IF v_parsed_item.qty > 0 THEN
                INSERT INTO public.delivery_stop_items (stop_id, product_id, quantity_delivered)
                VALUES (p_stop_id, v_parsed_item.product_id, v_parsed_item.qty)
                ON CONFLICT (stop_id, product_id) DO UPDATE
                SET quantity_delivered = public.delivery_stop_items.quantity_delivered + EXCLUDED.quantity_delivered,
                    updated_at = pg_catalog.now();

                UPDATE public.order_items
                SET delivered_quantity = delivered_quantity + v_parsed_item.qty
                WHERE order_id = v_order.id AND product_id = v_parsed_item.product_id;

                -- Deduct inventory without clamping
                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand - v_parsed_item.qty,
                    quantity_reserved = quantity_reserved - v_parsed_item.qty,
                    updated_at = pg_catalog.now()
                WHERE warehouse_id = v_default_wh AND product_id = v_parsed_item.product_id;

                INSERT INTO public.stock_movements (
                    product_id, source_location_id, destination_location_id,
                    quantity, movement_type, reference_type, reference_id, created_by
                ) VALUES (
                    v_parsed_item.product_id, v_wh_location, v_customer.location_id,
                    v_parsed_item.qty, 'DELIVERY_DISPATCH', 'DELIVERY_STOP', p_stop_id, v_caller_id
                );
            END IF;
        END LOOP;
    ELSE
        IF p_actual_delivered > 0 THEN
            INSERT INTO public.delivery_stop_items (stop_id, product_id, quantity_delivered)
            VALUES (p_stop_id, v_matched_order_item.product_id, p_actual_delivered)
            ON CONFLICT (stop_id, product_id) DO UPDATE
            SET quantity_delivered = public.delivery_stop_items.quantity_delivered + EXCLUDED.quantity_delivered,
                updated_at = pg_catalog.now();

            UPDATE public.order_items
            SET delivered_quantity = delivered_quantity + p_actual_delivered
            WHERE order_id = v_order.id AND product_id = v_matched_order_item.product_id;

            -- Deduct inventory without clamping
            UPDATE public.inventory_balances
            SET quantity_on_hand = quantity_on_hand - p_actual_delivered,
                quantity_reserved = quantity_reserved - p_actual_delivered,
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_matched_order_item.product_id;

            INSERT INTO public.stock_movements (
                product_id, source_location_id, destination_location_id,
                quantity, movement_type, reference_type, reference_id, created_by
            ) VALUES (
                v_matched_order_item.product_id, v_wh_location, v_customer.location_id,
                p_actual_delivered, 'DELIVERY_DISPATCH', 'DELIVERY_STOP', p_stop_id, v_caller_id
            );
        END IF;
    END IF;

    -- Update Customer Jar Custody Holdings
    PERFORM public._internal_establish_rpc_context('rpc_execute_delivery_stop', 'DELIVERY_STOP_EXECUTION');

    UPDATE public.customers
    SET total_full_jars_holding = v_new_full_holding,
        total_empty_jars_holding = v_new_empty_holding,
        total_damaged_jars_holding = v_new_damaged_holding,
        updated_at = pg_catalog.now()
    WHERE id = v_customer.id;

    -- Jar Custody Movements: Only if reusable jars were delivered or returned
    IF v_reusable_jars_delivered > 0 AND v_default_jar_id IS NOT NULL THEN
        INSERT INTO public.jar_custody_movements (
            product_id, source_location_id, destination_location_id,
            condition_from, condition_to, quantity, movement_type, reference_type, reference_id, created_by
        ) VALUES (
            v_default_jar_id, v_wh_location, v_customer.location_id,
            'FULL_USABLE', 'FULL_USABLE', v_reusable_jars_delivered, 'CUSTOMER_DELIVERY', 'DELIVERY_STOP', p_stop_id, v_caller_id
        );
    END IF;

    IF p_empty_jars > 0 AND v_default_jar_id IS NOT NULL THEN
        INSERT INTO public.jar_custody_movements (
            product_id, source_location_id, destination_location_id,
            condition_from, condition_to, quantity, movement_type, reference_type, reference_id, created_by
        ) VALUES (
            v_default_jar_id, v_customer.location_id, v_wh_location,
            'EMPTY_CLEAN', 'EMPTY_CLEAN', p_empty_jars, 'CUSTOMER_EMPTY_RETURN', 'DELIVERY_STOP', p_stop_id, v_caller_id
        );
    END IF;

    IF p_damaged_jars > 0 AND v_default_jar_id IS NOT NULL THEN
        INSERT INTO public.jar_custody_movements (
            product_id, source_location_id, destination_location_id,
            condition_from, condition_to, quantity, movement_type, reference_type, reference_id, created_by
        ) VALUES (
            v_default_jar_id, v_customer.location_id, v_wh_location,
            'DAMAGED_REPAIRABLE', 'DAMAGED_REPAIRABLE', p_damaged_jars, 'DAMAGED_COLLECTED', 'DELIVERY_STOP', p_stop_id, v_caller_id
        );
    END IF;

    PERFORM public._internal_clear_rpc_context();

    -- Payment Collection & Accounting
    IF p_payment_amount > 0 THEN
        v_payment_num := 'PAY-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

        INSERT INTO public.customer_payments (
            payment_number, customer_id, order_id, invoice_id, amount,
            payment_method, reference_number, collected_by_staff_id, payment_date
        ) VALUES (
            v_payment_num, v_customer.id, v_order.id, v_invoice.id, p_payment_amount,
            p_payment_method, 'STOP-' || v_stop.sequence_number, v_caller_id, CURRENT_DATE
        );

        UPDATE public.customers
        SET current_balance = current_balance - p_payment_amount,
            updated_at = pg_catalog.now()
        WHERE id = v_customer.id;

        INSERT INTO public.financial_ledger (
            entry_number, account_code, account_name, debit, credit,
            description, reference_type, reference_id, created_by
        ) VALUES (
            'LED-' || v_payment_num || '-DR',
            CASE WHEN p_payment_method = 'UPI' THEN '1020' ELSE '1015' END,
            CASE WHEN p_payment_method = 'UPI' THEN 'Bank Current Account' ELSE 'Cash Float with Driver' END,
            p_payment_amount, 0.00,
            'Route collection from ' || v_customer.contact_name, 'PAYMENT', p_stop_id, v_caller_id
        );

        INSERT INTO public.financial_ledger (
            entry_number, account_code, account_name, debit, credit,
            description, reference_type, reference_id, created_by
        ) VALUES (
            'LED-' || v_payment_num || '-CR',
            '1110', 'Accounts Receivable', 0.00, p_payment_amount,
            'Settlement of A/R for order ' || v_order.order_number, 'PAYMENT', p_stop_id, v_caller_id
        );
    END IF;

    -- Update Delivery Stop Status to COMPLETED
    UPDATE public.delivery_stops
    SET status = 'COMPLETED',
        actual_delivered_quantity = p_actual_delivered,
        empty_jars_collected = p_empty_jars,
        damaged_jars_collected = p_damaged_jars,
        payment_collected = p_payment_amount,
        payment_method = p_payment_method,
        notes = p_notes,
        executed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_stop_id;

    -- Recalculate Cumulative Status
    SELECT COALESCE(SUM(delivered_quantity), 0), COALESCE(SUM(quantity), 0)
    INTO v_new_cumulative_delivered, v_total_ordered_qty
    FROM public.order_items WHERE order_id = v_order.id;

    -- Recalculate Cumulative Paid directly from single source of truth: public.customer_payments
    SELECT COALESCE(SUM(amount), 0.00) INTO v_new_cumulative_paid
    FROM public.customer_payments
    WHERE order_id = v_order.id OR (v_invoice.id IS NOT NULL AND invoice_id = v_invoice.id);

    v_new_order_status := CASE 
        WHEN v_new_cumulative_delivered >= v_total_ordered_qty THEN 'DELIVERED'
        WHEN v_new_cumulative_delivered > 0 THEN 'PARTIALLY_DELIVERED'
        ELSE v_order.status
    END;

    v_new_payment_status := CASE 
        WHEN v_new_cumulative_paid >= v_order.total_amount THEN 'PAID'
        WHEN v_new_cumulative_paid > 0 THEN 'PARTIALLY_PAID'
        ELSE 'UNPAID'
    END;

    UPDATE public.orders
    SET status = v_new_order_status,
        payment_status = v_new_payment_status,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    IF v_invoice.id IS NOT NULL THEN
        UPDATE public.invoices
        SET balance_due = pg_catalog.greatest(0.00, total_amount - v_new_cumulative_paid),
            status = CASE 
                WHEN v_new_cumulative_paid >= total_amount THEN 'PAID'
                WHEN v_new_cumulative_paid > 0 THEN 'PARTIALLY_PAID'
                ELSE 'UNPAID'
            END,
            updated_at = pg_catalog.now()
        WHERE id = v_invoice.id;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'COMPLETED',
        'delivered', p_actual_delivered,
        'reusable_jars_delivered', v_reusable_jars_delivered,
        'cumulative_delivered', v_new_cumulative_delivered,
        'remaining_ordered', (v_total_ordered_qty - v_new_cumulative_delivered),
        'payment_collected', p_payment_amount,
        'cumulative_paid', v_new_cumulative_paid,
        'remaining_balance', (v_order.total_amount - v_new_cumulative_paid),
        'empty_collected', p_empty_jars,
        'damaged_collected', p_damaged_jars,
        'customer_closing_holding', (v_new_full_holding + v_new_empty_holding + v_new_damaged_holding)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT, JSONB) TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 4. REMEDIATED ORDER CANCELLATION RPC (rpc_cancel_customer_order)
--    - Per-product reservation release
--    - Dual-entry GL reversal entries (Debits == Credits)
--    - Duplicate reversal prevention
--    - Partial-delivery invoice reconciliation
--    - Strict deterministic row-lock hierarchy matching execution RPC
--    - Never clamp reservation release with GREATEST(0, ...); fail if insufficient
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_cancel_customer_order(
    p_order_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_order RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_item RECORD;
    v_inv_bal RECORD;
    v_remaining_res INT := 0;
    v_invoice RECORD;
    v_previously_paid NUMERIC(12,2) := 0.00;
    v_entry_num VARCHAR(50);
    v_cancelled_subtotal NUMERIC(12,2) := 0.00;
    v_cancelled_tax NUMERIC(12,2) := 0.00;
    v_cancelled_total NUMERIC(12,2) := 0.00;
    v_delivered_subtotal NUMERIC(12,2) := 0.00;
    v_delivered_tax NUMERIC(12,2) := 0.00;
    v_delivered_total NUMERIC(12,2) := 0.00;
    v_new_balance_due NUMERIC(12,2) := 0.00;
    v_new_inv_status VARCHAR(20);
    v_released_reservations_count INT := 0;
    v_line_cancelled_subtotal NUMERIC(12,2);
    v_line_cancelled_tax NUMERIC(12,2);
    v_line_delivered_subtotal NUMERIC(12,2);
    v_line_delivered_tax NUMERIC(12,2);
    v_reversal_exists BOOLEAN := false;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_orders')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have order cancellation authority.';
    END IF;

    -- =========================================================================
    -- DETERMINISTIC LOCK ACQUISITION HIERARCHY
    -- 1. Order row
    -- 2. Delivery stop rows (ORDER BY id)
    -- 3. Order item rows (ORDER BY id)
    -- 4. Inventory balance rows (ORDER BY product_id)
    -- 5. Customer row
    -- 6. Invoice row
    -- =========================================================================

    -- Step 1: Lock parent order FOR UPDATE
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found.', p_order_id;
    END IF;

    -- Idempotency check: if order is already cancelled, safely return success
    IF v_order.status = 'CANCELLED' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'idempotent', true,
            'order_id', v_order.id,
            'order_number', v_order.order_number,
            'status', 'CANCELLED',
            'released_reservation', false
        );
    END IF;

    -- Terminal status guard
    IF v_order.status = 'DELIVERED' THEN
        RAISE EXCEPTION 'Order % cannot be cancelled in "DELIVERED" status.', p_order_id;
    END IF;

    -- Resolve default central warehouse
    SELECT id, location_id INTO v_default_wh, v_wh_location 
    FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        RAISE EXCEPTION 'Default central warehouse not found.';
    END IF;

    -- Step 2: Lock delivery stops (ORDER BY id FOR UPDATE)
    PERFORM 1 FROM public.delivery_stops WHERE order_id = v_order.id ORDER BY id FOR UPDATE;

    -- Step 3: Lock order items (ORDER BY id FOR UPDATE)
    PERFORM 1 FROM public.order_items WHERE order_id = v_order.id ORDER BY id FOR UPDATE;

    -- Step 4: Lock inventory balances (ORDER BY product_id FOR UPDATE)
    PERFORM 1 FROM public.inventory_balances 
    WHERE warehouse_id = v_default_wh 
      AND product_id IN (SELECT product_id FROM public.order_items WHERE order_id = v_order.id)
    ORDER BY product_id FOR UPDATE;

    -- Step 5: Lock customer row FOR UPDATE
    PERFORM 1 FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;

    -- Step 6: Lock invoice row FOR UPDATE
    SELECT * INTO v_invoice FROM public.invoices WHERE order_id = v_order.id FOR UPDATE;

    -- =========================================================================
    -- 1. PER-PRODUCT RESERVATION RELEASE & FINANCIAL TOTALS CALCULATION
    -- =========================================================================
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v_order.id ORDER BY product_id
    LOOP
        -- Calculate outstanding undelivered quantity for this specific product
        v_remaining_res := v_item.quantity - COALESCE(v_item.delivered_quantity, 0);

        -- Atomically release remaining reserved inventory without clamping
        IF v_remaining_res > 0 THEN
            SELECT * INTO v_inv_bal 
            FROM public.inventory_balances
            WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Inventory balance record missing for product %.', v_item.product_id;
            END IF;

            IF v_inv_bal.quantity_reserved < v_remaining_res THEN
                RAISE EXCEPTION 'Cannot cancel order: inventory reserved quantity (%) is less than outstanding order reservation (%) for product %.',
                    v_inv_bal.quantity_reserved, v_remaining_res, v_item.product_id;
            END IF;

            UPDATE public.inventory_balances
            SET quantity_reserved = quantity_reserved - v_remaining_res,
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;

            v_released_reservations_count := v_released_reservations_count + 1;
        END IF;

        -- Calculate financial breakdown for cancelled (undelivered) portion
        v_line_cancelled_subtotal := v_remaining_res * v_item.unit_price;
        v_line_cancelled_tax := pg_catalog.round(v_line_cancelled_subtotal * (v_item.tax_rate / 100.0), 2);
        v_cancelled_subtotal := v_cancelled_subtotal + v_line_cancelled_subtotal;
        v_cancelled_tax := v_cancelled_tax + v_line_cancelled_tax;

        -- Calculate financial breakdown for delivered portion
        v_line_delivered_subtotal := COALESCE(v_item.delivered_quantity, 0) * v_item.unit_price;
        v_line_delivered_tax := pg_catalog.round(v_line_delivered_subtotal * (v_item.tax_rate / 100.0), 2);
        v_delivered_subtotal := v_delivered_subtotal + v_line_delivered_subtotal;
        v_delivered_tax := v_delivered_tax + v_line_delivered_tax;
    END LOOP;

    v_cancelled_total := v_cancelled_subtotal + v_cancelled_tax;
    v_delivered_total := v_delivered_subtotal + v_delivered_tax;

    -- =========================================================================
    -- 2. UPDATE ORDER & DELIVERY STOPS STATUS
    -- =========================================================================
    UPDATE public.orders
    SET status = 'CANCELLED',
        notes = CASE 
            WHEN p_reason IS NOT NULL THEN COALESCE(notes, '') || ' [Cancelled: ' || p_reason || ']'
            ELSE notes
        END,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    -- Cancel all unexecuted delivery stops; preserve completed or failed stops
    UPDATE public.delivery_stops
    SET status = 'CANCELLED',
        failure_reason = COALESCE(p_reason, 'Order cancelled'),
        updated_at = pg_catalog.now()
    WHERE order_id = v_order.id AND status NOT IN ('COMPLETED', 'FAILED');

    -- =========================================================================
    -- 3. FINANCIAL LEDGER REVERSALS & INVOICE RECONCILIATION
    -- =========================================================================
    IF v_invoice.id IS NOT NULL THEN
        -- Resolve cumulative payments collected for this invoice / order from single consistent source of truth
        SELECT COALESCE(SUM(amount), 0.00) INTO v_previously_paid
        FROM public.customer_payments
        WHERE order_id = v_order.id OR (v_invoice.id IS NOT NULL AND invoice_id = v_invoice.id);

        IF v_previously_paid = 0.00 AND v_invoice.status IN ('PAID', 'PARTIALLY_PAID') THEN
            v_previously_paid := pg_catalog.greatest(0.00, v_invoice.total_amount - v_invoice.balance_due);
        END IF;

        -- Prevent duplicate reversals for this invoice
        SELECT EXISTS (
            SELECT 1 FROM public.financial_ledger 
            WHERE reference_id = v_invoice.id AND reference_type = 'REVERSAL'
        ) INTO v_reversal_exists;

        -- Only reverse the CANCELLED portion if not already reversed
        IF NOT v_reversal_exists AND v_cancelled_total > 0 THEN
            PERFORM public._internal_establish_rpc_context('rpc_cancel_customer_order', 'CUSTOMER_ORDER_BALANCE_ONLY');

            -- Reduce customer current_balance by cancelled total
            UPDATE public.customers
            SET current_balance = current_balance - v_cancelled_total,
                updated_at = pg_catalog.now()
            WHERE id = v_order.customer_id;

            PERFORM public._internal_clear_rpc_context();

            v_entry_num := 'REV-' || v_order.order_number;

            -- Double-entry reversal 1: Credit Accounts Receivable (1110)
            INSERT INTO public.financial_ledger (
                entry_number, entry_date, account_code, account_name,
                debit, credit, description, reference_type, reference_id, is_reversal, created_by
            ) VALUES (
                'LED-' || v_entry_num || '-AR',
                CURRENT_DATE,
                '1110',
                'Accounts Receivable',
                0.00,
                v_cancelled_total,
                'Order Cancellation A/R Reversal: ' || v_order.order_number,
                'REVERSAL',
                v_invoice.id,
                true,
                v_caller_id
            );

            -- Double-entry reversal 2: Debit Water Sales Revenue (4010)
            INSERT INTO public.financial_ledger (
                entry_number, entry_date, account_code, account_name,
                debit, credit, description, reference_type, reference_id, is_reversal, created_by
            ) VALUES (
                'LED-' || v_entry_num || '-REV',
                CURRENT_DATE,
                '4010',
                'Water Sales Revenue',
                v_cancelled_subtotal,
                0.00,
                'Order Cancellation Revenue Reversal: ' || v_order.order_number,
                'REVERSAL',
                v_invoice.id,
                true,
                v_caller_id
            );

            -- Double-entry reversal 3: Debit Output GST Payable (2110) if tax was charged
            IF v_cancelled_tax > 0 THEN
                INSERT INTO public.financial_ledger (
                    entry_number, entry_date, account_code, account_name,
                    debit, credit, description, reference_type, reference_id, is_reversal, created_by
                ) VALUES (
                    'LED-' || v_entry_num || '-TAX',
                    CURRENT_DATE,
                    '2110',
                    'GST Output Payable',
                    v_cancelled_tax,
                    0.00,
                    'Order Cancellation GST Reversal: ' || v_order.order_number,
                    'REVERSAL',
                    v_invoice.id,
                    true,
                    v_caller_id
                );
            END IF;
        END IF;

        -- Reconcile Invoice & Order Payment State
        IF v_delivered_total = 0.00 THEN
            -- Complete order cancellation with zero deliveries: invoice is cancelled
            UPDATE public.invoices
            SET status = 'CANCELLED',
                balance_due = 0.00,
                subtotal = 0.00,
                tax_amount = 0.00,
                total_amount = 0.00,
                updated_at = pg_catalog.now()
            WHERE id = v_invoice.id;

            UPDATE public.orders
            SET payment_status = CASE WHEN v_previously_paid > 0 THEN 'PAID' ELSE 'UNPAID' END,
                updated_at = pg_catalog.now()
            WHERE id = v_order.id;
        ELSE
            -- Partially delivered order: prorate invoice to delivered portion
            v_new_balance_due := pg_catalog.greatest(0.00, v_delivered_total - v_previously_paid);
            v_new_inv_status := CASE 
                WHEN v_new_balance_due = 0.00 THEN 'PAID'
                WHEN v_previously_paid > 0 THEN 'PARTIALLY_PAID'
                ELSE 'UNPAID'
            END;

            UPDATE public.invoices
            SET subtotal = v_delivered_subtotal,
                tax_amount = v_delivered_tax,
                total_amount = v_delivered_total,
                balance_due = v_new_balance_due,
                status = v_new_inv_status,
                updated_at = pg_catalog.now()
            WHERE id = v_invoice.id;

            UPDATE public.orders
            SET payment_status = v_new_inv_status,
                updated_at = pg_catalog.now()
            WHERE id = v_order.id;
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', 'CANCELLED',
        'cancelled_subtotal', v_cancelled_subtotal,
        'cancelled_tax', v_cancelled_tax,
        'cancelled_total', v_cancelled_total,
        'delivered_total', v_delivered_total,
        'released_reservation', (v_released_reservations_count > 0)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_cancel_customer_order(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_customer_order(UUID, TEXT) TO authenticated, service_role;

COMMIT;


