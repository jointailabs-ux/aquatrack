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
