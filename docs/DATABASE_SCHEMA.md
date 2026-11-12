# DATABASE SCHEMA SPECIFICATION — AquaTrack ERP
**Single-Location Water Distribution & Inventory Management System**

---

## 1. Architectural Philosophy & Conventions

- **Database Engine:** PostgreSQL 15+ (Supabase).
- **Primary Keys:** UUID v4 generated via `gen_random_uuid()`.
- **Timestamps:** `TIMESTAMPTZ` with default `pg_catalog.now()`.
- **Financial Fields:** `NUMERIC(12,2)` (never IEEE floating point).
- **Audit Columns:** Every table includes `created_at` and `updated_at` governed by `set_updated_at()` trigger.
- **Single Warehouse & Business:** Exactly one business entity (`business_settings`) and one central warehouse (`warehouses`).
- **No Branches & No Customer Auth:** All branch references, multi-tenant composite keys, and customer authentication tables/RPCs are completely eliminated.

---

## 2. Core Tables Specification

### 2.1 `business_settings` (Single Enterprise Profile)
```sql
CREATE TABLE public.business_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    trade_name VARCHAR(255),
    tax_id VARCHAR(50), -- GSTIN
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    address TEXT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    default_jar_deposit NUMERIC(12,2) NOT NULL DEFAULT 150.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
```

### 2.2 `profiles` (Owner & Staff Accounts)
Extends Supabase `auth.users`. Two user roles: `owner` and `staff`.
```sql
CREATE TABLE public.profiles (
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
    -- Staff Salary Defaults
    salary_amount NUMERIC(12,2) DEFAULT 0.00,
    salary_type VARCHAR(20) DEFAULT 'MONTHLY' CHECK (salary_type IN ('MONTHLY', 'FIXED_PERIOD')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
```

### 2.3 `locations` (Canonical Stock Custodians)
```sql
CREATE TABLE public.locations (
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
```

### 2.4 `warehouses` (Single Central Depot)
```sql
CREATE TABLE public.warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL UNIQUE REFERENCES public.locations(id) ON DELETE RESTRICT,
    name VARCHAR(150) NOT NULL,
    address TEXT,
    is_default BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
```

### 2.5 `customers` (Internal Customer Master — No Authentication)
```sql
CREATE TABLE public.customers (
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
    current_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00, -- Unpaid invoices total
    total_full_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_full_jars_holding >= 0),
    total_empty_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_empty_jars_holding >= 0),
    total_deposit_held NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (total_deposit_held >= 0),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_b2b_business_name CHECK (customer_type = 'B2C' OR (customer_type = 'B2B' AND business_name IS NOT NULL))
);
```

### 2.6 `suppliers` (Bottling Plants & Packaging Vendors)
```sql
CREATE TABLE public.suppliers (
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
```

### 2.7 `products` (Water Jars & Packaged Beverages)
```sql
CREATE TABLE public.products (
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
```

### 2.8 `customer_special_prices` (Negotiated Tier Pricing)
```sql
CREATE TABLE public.customer_special_prices (
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
```

### 2.9 `inventory_balances` (Physical Condition Stocks)
```sql
CREATE TABLE public.inventory_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    condition VARCHAR(30) NOT NULL CHECK (
        condition IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP')
    ),
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_inventory_location_product_condition UNIQUE (location_id, product_id, condition)
);
```

### 2.10 `stock_movements` (Immutable Asset & Inventory Audit Log)
```sql
CREATE TABLE public.stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
    destination_location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    condition VARCHAR(30) NOT NULL CHECK (
        condition IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP')
    ),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    movement_type VARCHAR(40) NOT NULL CHECK (
        movement_type IN (
            'PURCHASE_RECEIPT',
            'DISPATCH_TO_STAFF',
            'DELIVERY_TO_CUSTOMER',
            'EMPTY_COLLECTION',
            'STAFF_RETURN',
            'SUPPLIER_REFILL_DISPATCH',
            'SUPPLIER_REFILL_RECEIPT',
            'POS_SALE',
            'JAR_SCRAP_WRITEOFF',
            'AUDIT_ADJUSTMENT'
        )
    ),
    reference_type VARCHAR(40),
    reference_id UUID,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
```

### 2.11 `orders` & `order_items`
```sql
CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(30) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
    delivery_address TEXT NOT NULL,
    assigned_staff_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'CONFIRMED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED')
    ),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (
        payment_status IN ('PENDING', 'PARTIAL', 'PAID')
    ),
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    tax_total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    discount_total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
```

### 2.12 `delivery_trips` & `trip_stops`
```sql
CREATE TABLE public.delivery_trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_number VARCHAR(30) NOT NULL UNIQUE,
    staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    trip_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED' CHECK (
        status IN ('ASSIGNED', 'DISPATCHED', 'COMPLETED', 'SETTLED')
    ),
    cash_float_given NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (cash_float_given >= 0),
    cash_collected NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (cash_collected >= 0),
    upi_collected NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (upi_collected >= 0),
    expenses_incurred NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (expenses_incurred >= 0),
    settlement_notes TEXT,
    settled_at TIMESTAMPTZ,
    settled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.trip_stops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.delivery_trips(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    stop_sequence INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'DELIVERED', 'PARTIALLY_DELIVERED', 'FAILED', 'CANCELLED')
    ),
    actual_delivered_qty INTEGER NOT NULL DEFAULT 0 CHECK (actual_delivered_qty >= 0),
    empty_jars_collected INTEGER NOT NULL DEFAULT 0 CHECK (empty_jars_collected >= 0),
    damaged_jars_collected INTEGER NOT NULL DEFAULT 0 CHECK (damaged_jars_collected >= 0),
    amount_collected NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (amount_collected >= 0),
    payment_method VARCHAR(20) CHECK (payment_method IN ('CASH', 'UPI', 'CHEQUE', 'CREDIT_ACCOUNT')),
    delivery_notes TEXT,
    failed_reason TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
```

### 2.13 `pos_sales` & `pos_sale_items`
```sql
CREATE TABLE public.pos_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_number VARCHAR(30) NOT NULL UNIQUE,
    sale_date TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    customer_name VARCHAR(150),
    customer_phone VARCHAR(20),
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    tax_total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'CARD')),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.pos_sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES public.pos_sales(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0)
);
```

### 2.14 `payments` (Customer Receipts)
```sql
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number VARCHAR(30) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'CARD', 'CHEQUE', 'BANK_TRANSFER')),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reference_number VARCHAR(100), -- UPI UTR / Cheque No
    notes TEXT,
    received_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
```

### 2.15 `purchases` & `purchase_items`
```sql
CREATE TABLE public.purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_number VARCHAR(30) NOT NULL UNIQUE,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    supplier_invoice_number VARCHAR(100),
    purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
    received_date DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'ORDERED' CHECK (status IN ('ORDERED', 'RECEIVED', 'CANCELLED')),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PARTIAL', 'PAID')),
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    tax_total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.purchase_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    ordered_quantity INTEGER NOT NULL CHECK (ordered_quantity > 0),
    received_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
    unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0)
);
```

### 2.16 `supplier_payments`
```sql
CREATE TABLE public.supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number VARCHAR(30) NOT NULL UNIQUE,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    purchase_id UUID REFERENCES public.purchases(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE')),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reference_number VARCHAR(100),
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
```

### 2.17 `staff_salaries` & `staff_advances`
```sql
CREATE TABLE public.staff_salaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    salary_month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
    base_salary NUMERIC(12,2) NOT NULL CHECK (base_salary >= 0),
    advance_deductions NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (advance_deductions >= 0),
    other_deductions NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (other_deductions >= 0),
    net_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (net_paid >= 0),
    unpaid_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'UPI')),
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_staff_salary_month UNIQUE (staff_id, salary_month)
);

CREATE TABLE public.staff_advances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER')),
    notes TEXT,
    is_settled BOOLEAN NOT NULL DEFAULT false,
    settled_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
```

### 2.18 `expenses` (Operational Expenses)
```sql
CREATE TABLE public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_number VARCHAR(30) NOT NULL UNIQUE,
    category VARCHAR(30) NOT NULL CHECK (
        category IN (
            'FUEL',
            'VEHICLE_MAINTENANCE',
            'RENT',
            'ELECTRICITY_WATER',
            'PACKAGING',
            'CLEANING',
            'REPAIRS',
            'STAFF_SALARY',
            'MISCELLANEOUS'
        )
    ),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CARD')),
    description TEXT NOT NULL,
    receipt_url TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
```
