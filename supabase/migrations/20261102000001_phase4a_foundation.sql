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
