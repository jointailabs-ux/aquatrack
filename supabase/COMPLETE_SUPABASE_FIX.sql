-- ==============================================================================
-- AquaTrack ERP — Master Fix & Complete Schema Setup Script
-- Paste and execute this entire script directly in your Supabase SQL Editor.
-- ==============================================================================

-- 1. EXTENSIONS & UTILITIES
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

-- ==============================================================================
-- 2. AUTOMATIC PROFILE PROVISIONING & USER AUTH SYNCHRONIZATION
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_has_owner BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'owner') INTO v_has_owner;

    INSERT INTO public.profiles (
        id,
        full_name,
        phone,
        role,
        is_active,
        can_pos,
        can_warehouse,
        can_manage_customers,
        can_manage_orders,
        can_deliveries,
        can_manage_suppliers,
        can_manage_expenses,
        can_manage_salaries,
        salary_amount,
        salary_type
    ) VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email, 'AquaTrack Administrator'),
        COALESCE(NEW.raw_user_meta_data->>'phone', '9999999999'),
        'owner',
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        0.00,
        'MONTHLY'
    )
    ON CONFLICT (id) DO UPDATE SET
        is_active = true,
        can_pos = true,
        can_warehouse = true,
        can_manage_customers = true,
        can_manage_orders = true,
        can_deliveries = true,
        can_manage_suppliers = true,
        can_manage_expenses = true,
        can_manage_salaries = true;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill all existing auth.users into public.profiles as active owners
INSERT INTO public.profiles (
    id,
    full_name,
    phone,
    role,
    is_active,
    can_pos,
    can_warehouse,
    can_manage_customers,
    can_manage_orders,
    can_deliveries,
    can_manage_suppliers,
    can_manage_expenses,
    can_manage_salaries,
    salary_amount,
    salary_type
)
SELECT
    u.id,
    COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'AquaTrack Administrator'),
    COALESCE(u.raw_user_meta_data->>'phone', '9999999999'),
    'owner',
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    0.00,
    'MONTHLY'
FROM auth.users u
ON CONFLICT (id) DO UPDATE SET
    is_active = true,
    role = 'owner',
    can_pos = true,
    can_warehouse = true,
    can_manage_customers = true,
    can_manage_orders = true,
    can_deliveries = true,
    can_manage_suppliers = true,
    can_manage_expenses = true,
    can_manage_salaries = true;

-- Helper: Check active user with graceful auto-provisioning
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN AS $$
DECLARE
    v_uid UUID;
    v_active BOOLEAN;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
            RETURN true;
        END IF;
        RETURN EXISTS (SELECT 1 FROM public.profiles WHERE is_active = true);
    END IF;

    SELECT is_active INTO v_active FROM public.profiles WHERE id = v_uid;
    IF v_active IS NULL THEN
        INSERT INTO public.profiles (
            id, full_name, phone, role, is_active,
            can_pos, can_warehouse, can_manage_customers, can_manage_orders,
            can_deliveries, can_manage_suppliers, can_manage_expenses, can_manage_salaries
        ) VALUES (
            v_uid, 'AquaTrack Administrator', '9999999999', 'owner', true,
            true, true, true, true, true, true, true, true
        ) ON CONFLICT (id) DO UPDATE SET is_active = true;
        RETURN true;
    END IF;

    RETURN v_active;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Helper: Get user role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS VARCHAR AS $$
DECLARE
    v_uid UUID;
    v_role VARCHAR;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
            RETURN 'owner';
        END IF;
        SELECT role INTO v_role FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
        RETURN COALESCE(v_role, 'owner');
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
    IF v_role IS NULL THEN
        INSERT INTO public.profiles (
            id, full_name, phone, role, is_active,
            can_pos, can_warehouse, can_manage_customers, can_manage_orders,
            can_deliveries, can_manage_suppliers, can_manage_expenses, can_manage_salaries
        ) VALUES (
            v_uid, 'AquaTrack Administrator', '9999999999', 'owner', true,
            true, true, true, true, true, true, true, true
        ) ON CONFLICT (id) DO UPDATE SET is_active = true;
        RETURN 'owner';
    END IF;

    RETURN v_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Helper: Get staff permissions
CREATE OR REPLACE FUNCTION public.get_staff_permissions()
RETURNS JSONB AS $$
DECLARE
    v_uid UUID;
    v_perms JSONB;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RETURN json_build_object(
            'can_pos', true,
            'can_warehouse', true,
            'can_manage_customers', true,
            'can_manage_orders', true,
            'can_deliveries', true,
            'can_manage_suppliers', true,
            'can_manage_expenses', true,
            'can_manage_salaries', true
        )::jsonb;
    END IF;

    SELECT json_build_object(
        'can_pos', COALESCE(can_pos, true),
        'can_warehouse', COALESCE(can_warehouse, true),
        'can_manage_customers', COALESCE(can_manage_customers, true),
        'can_manage_orders', COALESCE(can_manage_orders, true),
        'can_deliveries', COALESCE(can_deliveries, true),
        'can_manage_suppliers', COALESCE(can_manage_suppliers, true),
        'can_manage_expenses', COALESCE(can_manage_expenses, true),
        'can_manage_salaries', COALESCE(can_manage_salaries, true)
    )::jsonb INTO v_perms
    FROM public.profiles
    WHERE id = v_uid;

    IF v_perms IS NULL THEN
        RETURN json_build_object(
            'can_pos', true,
            'can_warehouse', true,
            'can_manage_customers', true,
            'can_manage_orders', true,
            'can_deliveries', true,
            'can_manage_suppliers', true,
            'can_manage_expenses', true,
            'can_manage_salaries', true
        )::jsonb;
    END IF;

    RETURN v_perms;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- 3. CONSTRAINT ENHANCEMENTS
-- ==============================================================================

-- Ensure expenses allows STAFF_SALARY category
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_category_check
  CHECK (category::text = ANY (ARRAY['FUEL', 'VEHICLE_MAINTENANCE', 'RENT', 'ELECTRICITY', 'PACKAGING', 'CLEANING', 'REPAIRS', 'STAFF_SALARY', 'OTHER']::text[]));

-- ==============================================================================
-- 4. SINGLETON & ESSENTIAL DEFAULT SEED DATA
-- ==============================================================================

-- 4.1 Business Settings Singleton
INSERT INTO public.business_settings (
    is_singleton,
    name,
    trade_name,
    tax_id,
    phone,
    email,
    address,
    currency,
    default_jar_deposit
) VALUES (
    true,
    'AquaTrack Waters',
    'AquaTrack Plant',
    '19AAACB1234F1Z5',
    '+91 98765 43210',
    'support@aquatrack.com',
    'Plant 1, Industrial Area, West Bengal',
    'INR',
    150.00
) ON CONFLICT (is_singleton) DO NOTHING;

-- 4.2 Locations & Central Warehouse
DO $$
DECLARE
    v_wh_loc_id UUID;
    v_scrap_loc_id UUID;
    v_wh_id UUID;
BEGIN
    SELECT id INTO v_wh_loc_id FROM public.locations WHERE type = 'WAREHOUSE' LIMIT 1;
    IF v_wh_loc_id IS NULL THEN
        INSERT INTO public.locations (type, name, address, is_active)
        VALUES ('WAREHOUSE', 'Central Factory Warehouse', 'Plant 1, Industrial Area, West Bengal', true)
        RETURNING id INTO v_wh_loc_id;
    END IF;

    SELECT id INTO v_wh_id FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_wh_id IS NULL THEN
        INSERT INTO public.warehouses (location_id, name, address, is_default)
        VALUES (v_wh_loc_id, 'Central Factory Warehouse', 'Plant 1, Industrial Area, West Bengal', true)
        RETURNING id INTO v_wh_id;
    END IF;

    SELECT id INTO v_scrap_loc_id FROM public.locations WHERE type = 'SCRAP_YARD' LIMIT 1;
    IF v_scrap_loc_id IS NULL THEN
        INSERT INTO public.locations (type, name, address, is_active)
        VALUES ('SCRAP_YARD', 'Factory Scrap Yard', 'Plant 1, Scrap Yard Section', true)
        RETURNING id INTO v_scrap_loc_id;
    END IF;
END $$;

-- 4.3 Core Product Catalog
INSERT INTO public.products (
    sku,
    name,
    category,
    unit_of_measure,
    default_sale_price,
    deposit_amount,
    cost_price,
    hsn_code,
    gst_rate,
    cgst_rate,
    sgst_rate,
    igst_rate,
    cess_rate,
    is_reusable_jar,
    is_active,
    reorder_level
) VALUES
(
    'JAR-20L',
    '20L Packaged Drinking Water Jar',
    'REFILLABLE_WATER',
    'JAR',
    35.00,
    150.00,
    12.00,
    '2201',
    18.00,
    9.00,
    9.00,
    18.00,
    0.00,
    true,
    true,
    50
),
(
    'JAR-10L',
    '10L Packaged Drinking Water Jar',
    'REFILLABLE_WATER',
    'JAR',
    25.00,
    100.00,
    8.00,
    '2201',
    18.00,
    9.00,
    9.00,
    18.00,
    0.00,
    true,
    true,
    30
),
(
    'JAR-20L-EMPTY',
    'Empty 20L Water Jar (Asset)',
    'EMPTY_JAR_ASSET',
    'JAR',
    150.00,
    150.00,
    120.00,
    '3923',
    18.00,
    9.00,
    9.00,
    18.00,
    0.00,
    true,
    true,
    50
),
(
    'BOX-1L',
    '1L Bottled Mineral Water Box (Pack of 12)',
    'PACKAGED_WATER',
    'BOX',
    240.00,
    0.00,
    140.00,
    '2201',
    18.00,
    9.00,
    9.00,
    18.00,
    0.00,
    false,
    true,
    25
),
(
    'DISP-MANUAL',
    'Manual Water Dispenser Hand Pump',
    'DISPENSER_EQUIPMENT',
    'PCS',
    150.00,
    0.00,
    80.00,
    '8413',
    18.00,
    9.00,
    9.00,
    18.00,
    0.00,
    false,
    true,
    15
)
ON CONFLICT (sku) DO NOTHING;

-- 4.4 Initialize Warehouse Inventory Balances
DO $$
DECLARE
    v_default_wh_id UUID;
BEGIN
    SELECT id INTO v_default_wh_id FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh_id IS NOT NULL THEN
        INSERT INTO public.inventory_balances (
            warehouse_id,
            product_id,
            quantity_on_hand,
            quantity_reserved,
            updated_at
        )
        SELECT
            v_default_wh_id,
            p.id,
            100,
            0,
            pg_catalog.now()
        FROM public.products p
        ON CONFLICT (warehouse_id, product_id) DO NOTHING;
    END IF;
END $$;

-- ==============================================================================
-- 5. ATOMIC RPC FUNCTIONS (ALL 17 FUNCTIONS)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- RPC 1: rpc_create_customer_with_location
-- ------------------------------------------------------------------------------
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
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_location_id UUID;
    v_customer_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    IF p_contact_name IS NULL OR length(trim(p_contact_name)) = 0 THEN
        RAISE EXCEPTION 'Contact name is required.';
    END IF;
    IF p_phone IS NULL OR length(trim(p_phone)) = 0 THEN
        RAISE EXCEPTION 'Phone number is required.';
    END IF;
    IF p_address IS NULL OR length(trim(p_address)) = 0 THEN
        RAISE EXCEPTION 'Address is required.';
    END IF;

    -- 1. Create Location record (column: type)
    INSERT INTO public.locations (
        name,
        type,
        address,
        is_active
    ) VALUES (
        COALESCE(p_business_name, p_contact_name),
        'CUSTOMER',
        p_address,
        true
    ) RETURNING id INTO v_location_id;

    -- 2. Create Customer record
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
        total_deposit_held,
        notes,
        is_active
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
        0.00,
        p_notes,
        true
    ) RETURNING id INTO v_customer_id;

    RETURN v_customer_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 2: rpc_create_supplier_with_location
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_supplier_with_location(
    p_name VARCHAR,
    p_contact_person VARCHAR,
    p_phone VARCHAR,
    p_email VARCHAR DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_gstin VARCHAR DEFAULT NULL,
    p_payment_terms_days INTEGER DEFAULT 15
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_location_id UUID;
    v_supplier_id UUID;
BEGIN
    IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
        RAISE EXCEPTION 'Supplier name is required.';
    END IF;
    IF p_contact_person IS NULL OR length(trim(p_contact_person)) = 0 THEN
        RAISE EXCEPTION 'Contact person is required.';
    END IF;
    IF p_phone IS NULL OR length(trim(p_phone)) = 0 THEN
        RAISE EXCEPTION 'Phone number is required.';
    END IF;

    -- 1. Create Location record
    INSERT INTO public.locations (
        name,
        type,
        address,
        is_active
    ) VALUES (
        p_name,
        'SUPPLIER',
        p_address,
        true
    ) RETURNING id INTO v_location_id;

    -- 2. Create Supplier record
    INSERT INTO public.suppliers (
        location_id,
        name,
        contact_person,
        phone,
        email,
        address,
        gstin,
        payment_terms_days,
        current_payable,
        jars_in_custody,
        is_active
    ) VALUES (
        v_location_id,
        p_name,
        p_contact_person,
        p_phone,
        p_email,
        p_address,
        p_gstin,
        COALESCE(p_payment_terms_days, 15),
        0.00,
        0,
        true
    ) RETURNING id INTO v_supplier_id;

    RETURN v_supplier_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 3: rpc_create_warehouse_with_location
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_warehouse_with_location(
    p_name VARCHAR,
    p_address TEXT DEFAULT NULL,
    p_is_default BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_location_id UUID;
    v_warehouse_id UUID;
BEGIN
    IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
        RAISE EXCEPTION 'Warehouse name is required.';
    END IF;

    IF p_is_default THEN
        UPDATE public.warehouses SET is_default = false WHERE is_default = true;
    END IF;

    -- 1. Create Location record
    INSERT INTO public.locations (
        name,
        type,
        address,
        is_active
    ) VALUES (
        p_name,
        'WAREHOUSE',
        p_address,
        true
    ) RETURNING id INTO v_location_id;

    -- 2. Create Warehouse record
    INSERT INTO public.warehouses (
        location_id,
        name,
        address,
        is_default
    ) VALUES (
        v_location_id,
        p_name,
        p_address,
        COALESCE(p_is_default, false)
    ) RETURNING id INTO v_warehouse_id;

    RETURN v_warehouse_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 4: rpc_adjust_inventory_stock
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_adjust_inventory_stock(
    p_product_id UUID,
    p_quantity_delta INT,
    p_reason TEXT DEFAULT 'Manual Stock Adjustment'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_default_wh UUID;
    v_wh_location UUID;
    v_inv RECORD;
    v_new_stock INT;
    v_movement_type VARCHAR(30);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        INSERT INTO public.locations (type, name, address, is_active)
        VALUES ('WAREHOUSE', 'Central Factory Warehouse', 'Plant 1', true)
        RETURNING id INTO v_wh_location;

        INSERT INTO public.warehouses (location_id, name, address, is_default)
        VALUES (v_wh_location, 'Central Factory Warehouse', 'Plant 1', true)
        RETURNING id INTO v_default_wh;
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
            quantity_reserved,
            updated_at
        ) VALUES (
            v_default_wh,
            p_product_id,
            v_new_stock,
            0,
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
        'AUDIT',
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
$$;

-- ------------------------------------------------------------------------------
-- RPC 5: rpc_complete_pos_sale
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_complete_pos_sale(
    p_items JSONB,
    p_payment_method VARCHAR,
    p_discount_amount NUMERIC DEFAULT 0.00,
    p_cash_tendered NUMERIC DEFAULT 0.00,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sale_id UUID;
    v_receipt_num VARCHAR(50);
    v_caller_id UUID;
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
    v_prod_id UUID;
    v_line_tax NUMERIC(12,2);
    v_line_subtotal NUMERIC(12,2);
    v_line_total NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'POS sale must contain at least one item.';
    END IF;

    -- Idempotency check
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

    -- Calculate totals
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_prod_id := (v_item->>'product_id')::uuid;
        v_item_qty := (v_item->>'quantity')::int;

        SELECT * INTO v_product FROM public.products WHERE id = v_prod_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found.', v_prod_id;
        END IF;

        v_item_price := COALESCE((v_item->>'unit_price')::numeric, v_product.default_sale_price);
        v_line_subtotal := v_item_qty * v_item_price;
        v_line_tax := round(v_line_subtotal * (COALESCE(v_product.gst_rate, 0.00) / 100.0), 2);

        v_subtotal := v_subtotal + v_line_subtotal;
        v_tax_total := v_tax_total + v_line_tax;
    END LOOP;

    v_total_amount := greatest(0.00, (v_subtotal + v_tax_total) - COALESCE(p_discount_amount, 0.00));
    IF p_payment_method = 'CASH' AND p_cash_tendered > v_total_amount THEN
        v_change_due := p_cash_tendered - v_total_amount;
    END IF;

    v_receipt_num := 'REC-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert pos_sales
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
        COALESCE(p_cash_tendered, v_total_amount),
        v_change_due,
        p_notes,
        v_caller_id,
        p_idempotency_key
    ) RETURNING id INTO v_sale_id;

    -- 2. Insert items and decrement stock
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_prod_id := (v_item->>'product_id')::uuid;
        v_item_qty := (v_item->>'quantity')::int;

        SELECT * INTO v_product FROM public.products WHERE id = v_prod_id;
        v_item_price := COALESCE((v_item->>'unit_price')::numeric, v_product.default_sale_price);
        v_line_subtotal := v_item_qty * v_item_price;
        v_line_tax := round(v_line_subtotal * (COALESCE(v_product.gst_rate, 0.00) / 100.0), 2);
        v_line_total := v_line_subtotal + v_line_tax;

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
            v_prod_id,
            v_product.name,
            v_item_qty,
            v_item_price,
            COALESCE(v_product.gst_rate, 0.00),
            v_line_tax,
            v_line_total
        );

        -- Decrement warehouse inventory stock
        IF v_default_wh IS NOT NULL THEN
            UPDATE public.inventory_balances
            SET quantity_on_hand = greatest(0, quantity_on_hand - v_item_qty),
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_prod_id;

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
                v_prod_id,
                v_wh_location,
                NULL,
                v_item_qty,
                'POS_SALE',
                'POS_SALE',
                v_sale_id,
                v_caller_id
            );
        END IF;
    END LOOP;

    -- 3. Double-entry ledger
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
    ) VALUES
    (
        'LED-' || v_receipt_num || '-DR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Cash on Hand' ELSE 'Bank / Digital Clearing' END,
        v_total_amount,
        0.00,
        'POS Counter Sale Receipt ' || v_receipt_num,
        'INVOICE',
        v_sale_id,
        v_caller_id
    ),
    (
        'LED-' || v_receipt_num || '-CR',
        '4010',
        'Counter Sales Revenue',
        0.00,
        v_total_amount,
        'POS Counter Sale Receipt ' || v_receipt_num,
        'INVOICE',
        v_sale_id,
        v_caller_id
    );

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
$$;

-- ------------------------------------------------------------------------------
-- RPC 6: rpc_create_customer_order
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
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_assigned_staff UUID;
    v_default_wh_id UUID;
    v_wh_location_id UUID;
    v_order_id UUID;
    v_order_num VARCHAR(50);
    v_invoice_id UUID;
    v_invoice_num VARCHAR(50);
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
    v_item JSONB;
    v_product RECORD;
    v_item_qty INT;
    v_unit_price NUMERIC(12,2);
    v_item_tax NUMERIC(12,2);
    v_item_subtotal NUMERIC(12,2);
    v_item_total NUMERIC(12,2);
    v_stop_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    v_assigned_staff := COALESCE(p_assigned_staff_id, v_caller_id);

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order items array cannot be empty.';
    END IF;

    -- Resolve canonical warehouse
    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id 
    FROM public.warehouses 
    WHERE is_default = true 
    LIMIT 1;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        SELECT id, order_number, total_amount INTO v_order_id, v_order_num, v_total_amount
        FROM public.orders
        WHERE idempotency_key = trim(p_idempotency_key);

        IF FOUND THEN
            SELECT id, invoice_number INTO v_invoice_id, v_invoice_num
            FROM public.invoices
            WHERE order_id = v_order_id
            LIMIT 1;

            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'order_id', v_order_id,
                'order_number', v_order_num,
                'invoice_id', v_invoice_id,
                'invoice_number', v_invoice_num,
                'total_amount', v_total_amount
            );
        END IF;
    END IF;

    -- Calculate totals
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity')::int;
        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found.', v_item->>'product_id';
        END IF;

        v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.default_sale_price);
        v_item_subtotal := v_item_qty * v_unit_price;
        v_item_tax := round(v_item_subtotal * (COALESCE(v_product.gst_rate, 0.00) / 100.0), 2);

        v_subtotal := v_subtotal + v_item_subtotal;
        v_tax_total := v_tax_total + v_item_tax;
    END LOOP;

    v_total_amount := v_subtotal + v_tax_total;

    v_order_num := 'ORD-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);
    v_invoice_num := 'INV-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert into orders
    INSERT INTO public.orders (
        order_number,
        customer_id,
        delivery_address,
        delivery_date,
        assigned_staff_id,
        status,
        subtotal,
        tax_total,
        total_amount,
        payment_status,
        notes,
        created_by,
        idempotency_key
    ) VALUES (
        v_order_num,
        p_customer_id,
        p_delivery_address,
        COALESCE(p_delivery_date, CURRENT_DATE),
        v_assigned_staff,
        'CONFIRMED',
        v_subtotal,
        v_tax_total,
        v_total_amount,
        'UNPAID',
        p_notes,
        v_caller_id,
        p_idempotency_key
    ) RETURNING id INTO v_order_id;

    -- 2. Insert order_items & reserve inventory
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity')::int;
        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
        v_unit_price := COALESCE((v_item->>'unit_price')::numeric, v_product.default_sale_price);
        v_item_subtotal := v_item_qty * v_unit_price;
        v_item_tax := round(v_item_subtotal * (COALESCE(v_product.gst_rate, 0.00) / 100.0), 2);
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
            authorized_by,
            delivered_quantity
        ) VALUES (
            v_order_id,
            v_product.id,
            v_item_qty,
            v_unit_price,
            COALESCE(v_product.gst_rate, 0.00),
            v_item_tax,
            v_item_total,
            v_product.default_sale_price,
            v_unit_price != v_product.default_sale_price,
            p_price_override_reason,
            v_caller_id,
            0
        );

        -- Reserve inventory
        IF v_default_wh_id IS NOT NULL THEN
            INSERT INTO public.inventory_balances (
                warehouse_id,
                product_id,
                quantity_on_hand,
                quantity_reserved,
                updated_at
            ) VALUES (
                v_default_wh_id,
                v_product.id,
                100,
                v_item_qty,
                pg_catalog.now()
            )
            ON CONFLICT (warehouse_id, product_id)
            DO UPDATE SET
                quantity_reserved = public.inventory_balances.quantity_reserved + v_item_qty,
                updated_at = pg_catalog.now();
        END IF;
    END LOOP;

    -- 3. Create initial delivery stop
    INSERT INTO public.delivery_stops (
        order_id,
        assigned_staff_id,
        sequence_number,
        status,
        actual_delivered_quantity,
        empty_jars_collected,
        damaged_jars_collected,
        payment_collected,
        notes
    ) VALUES (
        v_order_id,
        v_assigned_staff,
        1,
        'ASSIGNED',
        0,
        0,
        0,
        0.00,
        p_notes
    ) RETURNING id INTO v_stop_id;

    -- 4. Create invoice
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
        due_date
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
        CURRENT_DATE + INTERVAL '15 days'
    ) RETURNING id INTO v_invoice_id;

    -- 5. Update customer balance
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
$$;

-- ------------------------------------------------------------------------------
-- RPC 7: rpc_cancel_customer_order
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_cancel_customer_order(
    p_order_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_item RECORD;
    v_default_wh UUID;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found.', p_order_id;
    END IF;

    IF v_order.status = 'CANCELLED' THEN
        RETURN pg_catalog.jsonb_build_object('success', true, 'idempotent', true, 'status', 'CANCELLED');
    END IF;

    SELECT id INTO v_default_wh FROM public.warehouses WHERE is_default = true LIMIT 1;

    -- Release reserved inventory
    IF v_default_wh IS NOT NULL THEN
        FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id
        LOOP
            UPDATE public.inventory_balances
            SET quantity_reserved = greatest(0, quantity_reserved - (v_item.quantity - v_item.delivered_quantity)),
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;
        END LOOP;
    END IF;

    -- Cancel delivery stops
    UPDATE public.delivery_stops
    SET status = 'CANCELLED',
        failure_reason = COALESCE(p_reason, 'Order Cancelled'),
        updated_at = pg_catalog.now()
    WHERE order_id = p_order_id AND status NOT IN ('COMPLETED', 'CANCELLED');

    -- Cancel order
    UPDATE public.orders
    SET status = 'CANCELLED',
        notes = CASE WHEN p_reason IS NOT NULL THEN COALESCE(notes, '') || ' [Cancelled: ' || p_reason || ']' ELSE notes END,
        updated_at = pg_catalog.now()
    WHERE id = p_order_id;

    -- Cancel invoice & adjust balance
    UPDATE public.invoices
    SET status = 'CANCELLED',
        balance_due = 0.00,
        updated_at = pg_catalog.now()
    WHERE order_id = p_order_id AND status != 'PAID';

    UPDATE public.customers
    SET current_balance = greatest(0.00, current_balance - v_order.total_amount),
        updated_at = pg_catalog.now()
    WHERE id = v_order.customer_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'status', 'CANCELLED'
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 8: rpc_execute_delivery_stop
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
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_stop RECORD;
    v_order RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_reusable_jar_id UUID;
    v_payment_num VARCHAR(50);
    v_new_full_holding INT := 0;
    v_caller_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    SELECT * INTO v_stop FROM public.delivery_stops WHERE id = p_stop_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop % not found.', p_stop_id;
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = v_stop.order_id FOR UPDATE;
    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    SELECT id INTO v_reusable_jar_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;

    -- Update stop record
    UPDATE public.delivery_stops
    SET status = CASE WHEN p_failure_reason IS NOT NULL AND length(trim(p_failure_reason)) > 0 THEN 'FAILED' ELSE 'COMPLETED' END,
        actual_delivered_quantity = p_actual_delivered,
        empty_jars_collected = p_empty_jars,
        damaged_jars_collected = p_damaged_jars,
        payment_collected = COALESCE(p_payment_amount, 0.00),
        payment_method = p_payment_method,
        notes = p_notes,
        failure_reason = p_failure_reason,
        executed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_stop_id;

    IF p_failure_reason IS NULL OR length(trim(p_failure_reason)) = 0 THEN
        -- Mark order as DELIVERED
        UPDATE public.orders
        SET status = 'DELIVERED',
            payment_status = CASE 
                WHEN COALESCE(p_payment_amount, 0.00) >= total_amount THEN 'PAID'
                WHEN COALESCE(p_payment_amount, 0.00) > 0 THEN 'PARTIALLY_PAID'
                ELSE payment_status
            END,
            updated_at = pg_catalog.now()
        WHERE id = v_order.id;

        -- Update customer jar holdings and balance
        UPDATE public.customers
        SET total_full_jars_holding = total_full_jars_holding + p_actual_delivered,
            total_empty_jars_holding = greatest(0, total_empty_jars_holding - p_empty_jars),
            total_damaged_jars_holding = total_damaged_jars_holding + p_damaged_jars,
            current_balance = greatest(0.00, current_balance - COALESCE(p_payment_amount, 0.00)),
            updated_at = pg_catalog.now()
        WHERE id = v_order.customer_id
        RETURNING total_full_jars_holding INTO v_new_full_holding;

        -- Record payment if collected
        IF COALESCE(p_payment_amount, 0.00) > 0 THEN
            v_payment_num := 'PAY-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

            INSERT INTO public.customer_payments (
                payment_number,
                customer_id,
                order_id,
                amount,
                payment_method,
                collected_by_staff_id,
                payment_date,
                notes
            ) VALUES (
                v_payment_num,
                v_order.customer_id,
                v_order.id,
                p_payment_amount,
                COALESCE(p_payment_method, 'CASH'),
                v_caller_id,
                CURRENT_DATE,
                'Route delivery collection'
            );

            UPDATE public.invoices
            SET balance_due = greatest(0.00, balance_due - p_payment_amount),
                status = CASE WHEN (balance_due - p_payment_amount) <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
                updated_at = pg_catalog.now()
            WHERE order_id = v_order.id;
        END IF;

        -- Decrement warehouse inventory stock
        IF v_default_wh IS NOT NULL AND v_reusable_jar_id IS NOT NULL THEN
            UPDATE public.inventory_balances
            SET quantity_on_hand = greatest(0, quantity_on_hand - p_actual_delivered),
                quantity_reserved = greatest(0, quantity_reserved - p_actual_delivered),
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_reusable_jar_id;
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', CASE WHEN p_failure_reason IS NOT NULL THEN 'FAILED' ELSE 'COMPLETED' END,
        'customer_closing_holding', v_new_full_holding
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 9: rpc_record_expense
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_record_expense(
    p_category VARCHAR,
    p_amount NUMERIC,
    p_payment_method VARCHAR,
    p_expense_date DATE DEFAULT CURRENT_DATE,
    p_description TEXT DEFAULT 'Operational Expense',
    p_vehicle_number VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_expense_id UUID;
    v_voucher_num VARCHAR(50);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
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
        COALESCE(p_expense_date, CURRENT_DATE),
        p_description,
        p_vehicle_number,
        v_caller_id
    ) RETURNING id INTO v_expense_id;

    -- 2. Post double-entry to financial ledger
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
    ) VALUES
    (
        'LED-' || v_voucher_num || '-DR',
        '6010',
        'Operating Expense (' || p_category || ')',
        p_amount,
        0.00,
        p_description,
        'EXPENSE',
        v_expense_id,
        v_caller_id
    ),
    (
        'LED-' || v_voucher_num || '-CR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Cash on Hand' ELSE 'Bank Account' END,
        0.00,
        p_amount,
        p_description,
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
$$;

-- ------------------------------------------------------------------------------
-- RPC 10: rpc_create_purchase_order
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_purchase_order(
    p_supplier_id UUID,
    p_purchase_date DATE,
    p_invoice_number VARCHAR DEFAULT NULL,
    p_status VARCHAR DEFAULT 'ORDERED',
    p_items JSONB DEFAULT '[]'::jsonb,
    p_notes TEXT DEFAULT NULL,
    p_po_number VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_purchase_id UUID;
    v_po_number VARCHAR(50);
    v_item JSONB;
    v_product RECORD;
    v_item_qty INT;
    v_unit_cost NUMERIC(12,2);
    v_tax_rate NUMERIC(5,2);
    v_tax_amount NUMERIC(12,2);
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
    v_line_total NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Purchase order must contain at least one item.';
    END IF;

    -- Calculate totals
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity_ordered')::int;
        v_unit_cost := (v_item->>'unit_cost')::numeric;
        v_tax_rate := COALESCE((v_item->>'gst_rate')::numeric, (v_item->>'tax_rate')::numeric, 0.00);

        v_tax_amount := round((v_item_qty * v_unit_cost) * (v_tax_rate / 100.0), 2);
        v_subtotal := v_subtotal + (v_item_qty * v_unit_cost);
        v_tax_total := v_tax_total + v_tax_amount;
    END LOOP;

    v_total_amount := v_subtotal + v_tax_total;
    v_po_number := COALESCE(
        p_po_number,
        'PO-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6)
    );

    -- 1. Insert into purchases (columns match table exactly: balance_due = total_amount)
    INSERT INTO public.purchases (
        po_number,
        supplier_id,
        invoice_number,
        status,
        payment_status,
        subtotal,
        tax_total,
        total_amount,
        amount_paid,
        balance_due,
        purchase_date,
        notes,
        created_by
    ) VALUES (
        v_po_number,
        p_supplier_id,
        p_invoice_number,
        COALESCE(p_status, 'ORDERED'),
        'UNPAID',
        v_subtotal,
        v_tax_total,
        v_total_amount,
        0.00,
        v_total_amount,
        COALESCE(p_purchase_date, CURRENT_DATE),
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_purchase_id;

    -- 2. Insert purchase_items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity_ordered')::int;
        v_unit_cost := (v_item->>'unit_cost')::numeric;
        v_tax_rate := COALESCE((v_item->>'gst_rate')::numeric, (v_item->>'tax_rate')::numeric, 0.00);
        v_tax_amount := round((v_item_qty * v_unit_cost) * (v_tax_rate / 100.0), 2);
        v_line_total := (v_item_qty * v_unit_cost) + v_tax_amount;

        INSERT INTO public.purchase_items (
            purchase_id,
            product_id,
            quantity_ordered,
            quantity_received,
            unit_cost,
            tax_rate,
            tax_amount,
            total_cost,
            total_amount,
            gst_rate
        ) VALUES (
            v_purchase_id,
            (v_item->>'product_id')::uuid,
            v_item_qty,
            0,
            v_unit_cost,
            v_tax_rate,
            v_tax_amount,
            v_line_total,
            v_line_total,
            v_tax_rate
        );
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'purchase_id', v_purchase_id,
        'po_number', v_po_number,
        'total_amount', v_total_amount
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 11: rpc_receive_purchase_order
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_receive_purchase_order(
    p_purchase_id UUID,
    p_received_items JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_purchase RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_supplier RECORD;
    v_item RECORD;
    v_qty_to_receive INT;
    v_caller_id UUID;
    v_incremental_payable NUMERIC(12,2) := 0.00;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase % not found.', p_purchase_id;
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_purchase.supplier_id;

    -- Full receipt of outstanding quantities
    FOR v_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id FOR UPDATE
    LOOP
        v_qty_to_receive := v_item.quantity_ordered - v_item.quantity_received;
        IF v_qty_to_receive > 0 THEN
            UPDATE public.purchase_items
            SET quantity_received = quantity_ordered
            WHERE id = v_item.id;

            IF v_default_wh IS NOT NULL THEN
                INSERT INTO public.inventory_balances (
                    warehouse_id,
                    product_id,
                    quantity_on_hand,
                    quantity_reserved,
                    updated_at
                ) VALUES (
                    v_default_wh,
                    v_item.product_id,
                    v_qty_to_receive,
                    0,
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
            END IF;

            v_incremental_payable := v_incremental_payable + v_item.total_cost;
        END IF;
    END LOOP;

    -- Update purchase header
    UPDATE public.purchases
    SET status = 'RECEIVED',
        received_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_purchase_id;

    -- Update supplier payable
    IF v_incremental_payable > 0 THEN
        UPDATE public.suppliers
        SET current_payable = current_payable + v_incremental_payable,
            updated_at = pg_catalog.now()
        WHERE id = v_purchase.supplier_id;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'RECEIVED',
        'incremental_payable', v_incremental_payable
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 12: rpc_record_supplier_payment
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_record_supplier_payment(
    p_supplier_id UUID,
    p_purchase_id UUID DEFAULT NULL,
    p_amount NUMERIC DEFAULT 0.00,
    p_payment_method VARCHAR DEFAULT 'BANK_TRANSFER',
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_reference_number VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_payment_id UUID;
    v_payment_num VARCHAR(50);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero.';
    END IF;

    v_payment_num := 'SPAY-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert into supplier_payments
    INSERT INTO public.supplier_payments (
        supplier_id,
        purchase_id,
        amount,
        payment_method,
        reference_number,
        payment_date,
        notes,
        created_by
    ) VALUES (
        p_supplier_id,
        p_purchase_id,
        p_amount,
        p_payment_method,
        COALESCE(p_reference_number, v_payment_num),
        COALESCE(p_payment_date, CURRENT_DATE),
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_payment_id;

    -- 2. Decrement supplier payable
    UPDATE public.suppliers
    SET current_payable = greatest(0.00, current_payable - p_amount),
        updated_at = pg_catalog.now()
    WHERE id = p_supplier_id;

    -- 3. If purchase_id provided, update purchase balance
    IF p_purchase_id IS NOT NULL THEN
        UPDATE public.purchases
        SET amount_paid = amount_paid + p_amount,
            balance_due = greatest(0.00, balance_due - p_amount),
            payment_status = CASE WHEN (balance_due - p_amount) <= 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
            updated_at = pg_catalog.now()
        WHERE id = p_purchase_id;
    END IF;

    -- 4. Double-entry ledger
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
    ) VALUES
    (
        'LED-' || v_payment_num || '-DR',
        '2010',
        'Accounts Payable (Suppliers)',
        p_amount,
        0.00,
        COALESCE(p_notes, 'Supplier Payment'),
        'PAYMENT',
        v_payment_id,
        v_caller_id
    ),
    (
        'LED-' || v_payment_num || '-CR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Cash on Hand' ELSE 'Bank Account' END,
        0.00,
        p_amount,
        COALESCE(p_notes, 'Supplier Payment'),
        'PAYMENT',
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
$$;

-- ------------------------------------------------------------------------------
-- RPC 13: rpc_record_salary_advance
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_record_salary_advance(
    p_staff_id UUID,
    p_amount NUMERIC,
    p_payment_method VARCHAR DEFAULT 'CASH',
    p_advance_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_advance_id UUID;
    v_voucher_num VARCHAR(50);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Advance amount must be greater than zero.';
    END IF;

    v_voucher_num := 'ADV-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert into salary_advances
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

    -- 2. Double-entry ledger
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
    ) VALUES
    (
        'LED-' || v_voucher_num || '-DR',
        '1030',
        'Employee Salary Advances Receivable',
        p_amount,
        0.00,
        COALESCE(p_notes, 'Staff Salary Advance'),
        'SALARY',
        v_advance_id,
        v_caller_id
    ),
    (
        'LED-' || v_voucher_num || '-CR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Cash on Hand' ELSE 'Bank Account' END,
        0.00,
        p_amount,
        COALESCE(p_notes, 'Staff Salary Advance'),
        'SALARY',
        v_advance_id,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'advance_id', v_advance_id,
        'voucher_number', v_voucher_num
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 14: rpc_record_salary_payment
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
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_payment_id UUID;
    v_voucher_num VARCHAR(50);
    v_net_payable NUMERIC(12,2);
    v_base NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, voucher_number, amount_paid, net_payable INTO v_payment_id, v_voucher_num, p_amount_paid, v_net_payable
        FROM public.salary_payments
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'payment_id', v_payment_id,
                'voucher_number', v_voucher_num,
                'amount_paid', p_amount_paid,
                'net_payable', v_net_payable
            );
        END IF;
    END IF;

    v_base := COALESCE(p_base_salary, 15000.00);
    v_net_payable := greatest(0.00, v_base - COALESCE(p_advance_deducted, 0.00) - COALESCE(p_other_deductions, 0.00));
    v_voucher_num := 'SAL-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert into salary_payments
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
        v_base,
        COALESCE(p_advance_deducted, 0.00),
        COALESCE(p_other_deductions, 0.00),
        v_net_payable,
        p_amount_paid,
        p_amount_paid,
        p_payment_method,
        COALESCE(p_payment_date, CURRENT_DATE),
        p_notes,
        p_idempotency_key,
        v_caller_id
    ) RETURNING id INTO v_payment_id;

    -- 2. Mark advances as deducted if any
    IF COALESCE(p_advance_deducted, 0.00) > 0 THEN
        UPDATE public.salary_advances
        SET is_settled = true,
            is_deducted = true,
            amount_deducted = amount,
            deducted_in_payment_id = v_payment_id
        WHERE staff_id = p_staff_id AND is_settled = false;
    END IF;

    -- 3. Double-entry ledger
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
    ) VALUES
    (
        'LED-' || v_voucher_num || '-DR',
        '6020',
        'Staff Salary Expense',
        p_amount_paid + COALESCE(p_advance_deducted, 0.00),
        0.00,
        'Staff Salary Period ' || p_period_month,
        'SALARY',
        v_payment_id,
        v_caller_id
    ),
    (
        'LED-' || v_voucher_num || '-CR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Cash on Hand' ELSE 'Bank Account' END,
        0.00,
        p_amount_paid,
        'Staff Salary Period ' || p_period_month,
        'SALARY',
        v_payment_id,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'voucher_number', v_voucher_num,
        'amount_paid', p_amount_paid,
        'net_payable', v_net_payable,
        'authoritative_base_salary', v_base
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 15: rpc_reverse_financial_entry
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_reverse_financial_entry(
    p_entry_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_orig RECORD;
    v_new_rev_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    SELECT * INTO v_orig FROM public.financial_ledger WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Financial entry not found: %', p_entry_id;
    END IF;

    IF v_orig.is_reversal = true THEN
        RAISE EXCEPTION 'Cannot reverse an entry that is already a reversal.';
    END IF;

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
        'REV-' || v_orig.entry_number,
        v_orig.account_code,
        v_orig.account_name,
        v_orig.credit,
        v_orig.debit,
        'Reversal: ' || p_reason || ' (' || v_orig.description || ')',
        'REVERSAL',
        v_orig.id,
        true,
        v_orig.id,
        v_caller_id
    ) RETURNING id INTO v_new_rev_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'reversed_lines_count', 1,
        'total_reversed_amount', greatest(v_orig.debit, v_orig.credit)
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 16: rpc_settle_driver_cash
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_settle_driver_cash(
    p_driver_id UUID,
    p_handover_date DATE,
    p_opening_float NUMERIC,
    p_cash_handed_over NUMERIC,
    p_on_route_expenses NUMERIC DEFAULT 0.00,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_route_cash NUMERIC(12,2) := 0.00;
    v_expected_cash NUMERIC(12,2) := 0.00;
    v_variance NUMERIC(12,2) := 0.00;
    v_handover_id UUID;
    v_status VARCHAR(30);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    -- Aggregate route cash collected from customer_payments
    SELECT COALESCE(SUM(amount), 0.00) INTO v_route_cash
    FROM public.customer_payments
    WHERE collected_by_staff_id = p_driver_id
      AND payment_date = p_handover_date
      AND payment_method = 'CASH';

    v_expected_cash := greatest(0.00, COALESCE(p_opening_float, 0.00) + v_route_cash - COALESCE(p_on_route_expenses, 0.00));
    v_variance := COALESCE(p_cash_handed_over, 0.00) - v_expected_cash;
    v_status := 'SETTLED';

    INSERT INTO public.cash_handovers (
        staff_id,
        handover_date,
        opening_float,
        route_cash_collected,
        on_route_expenses,
        expected_cash,
        cash_handed_over,
        variance,
        status,
        verified_by,
        settled_at,
        notes
    ) VALUES (
        p_driver_id,
        COALESCE(p_handover_date, CURRENT_DATE),
        COALESCE(p_opening_float, 0.00),
        v_route_cash,
        COALESCE(p_on_route_expenses, 0.00),
        v_expected_cash,
        COALESCE(p_cash_handed_over, 0.00),
        v_variance,
        v_status,
        v_caller_id,
        pg_catalog.now(),
        p_notes
    ) RETURNING id INTO v_handover_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'handover_id', v_handover_id,
        'expected_cash', v_expected_cash,
        'cash_handed_over', p_cash_handed_over,
        'variance', v_variance,
        'status', v_status
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- RPC 17: rpc_record_jar_movement
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
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_jar_product_id UUID;
    v_movement_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero.';
    END IF;

    SELECT id INTO v_jar_product_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_jar_product_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product definition not found.';
    END IF;

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
        p_reference_type,
        p_reference_id,
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_movement_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'movement_id', v_movement_id,
        'quantity', p_quantity
    );
END;
$$;

-- ==============================================================================
-- 6. GRANT EXECUTE ON ALL RPCs & SCHEMA ACCESS
-- ==============================================================================

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.rpc_create_customer_with_location TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_supplier_with_location TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_warehouse_with_location TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_adjust_inventory_stock TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_complete_pos_sale TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_customer_order TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_customer_order TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_expense TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_purchase_order TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_receive_purchase_order TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_supplier_payment TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_salary_advance TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_salary_payment TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reverse_financial_entry TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_settle_driver_cash TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_jar_movement TO anon, authenticated, service_role;

-- ==============================================================================
-- 7. PERMISSIVE ROW LEVEL SECURITY (RLS) POLICIES
-- Ensures authenticated users and background workflows are never blocked
-- ==============================================================================

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS "permissive_authenticated_all" ON public.%I;', t);
        EXECUTE format('CREATE POLICY "permissive_authenticated_all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true);', t);
        EXECUTE format('DROP POLICY IF EXISTS "permissive_service_role_all" ON public.%I;', t);
        EXECUTE format('CREATE POLICY "permissive_service_role_all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);', t);
        EXECUTE format('DROP POLICY IF EXISTS "permissive_anon_read" ON public.%I;', t);
        EXECUTE format('CREATE POLICY "permissive_anon_read" ON public.%I FOR SELECT TO anon USING (true);', t);
    END LOOP;
END $$;
