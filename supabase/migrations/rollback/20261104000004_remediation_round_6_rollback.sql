-- ==============================================================================
-- AquaTrack ERP — Migration Rollback: Remediation Round 6
-- Version: 20261104000004_remediation_round_6_rollback.sql
-- Description:
--   Restores the verified Round 5 baseline functions in reverse order.
--   Preserves schema columns and business data without data loss.
--   NEVER restores vulnerable Round 2 or Round 3 code.
-- ==============================================================================

-- 1. Restore Round 5 rpc_create_customer_order
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

    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found or inactive.';
    END IF;

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

        SELECT id, name, default_sale_price AS price, gst_rate INTO v_product
        FROM public.products
        WHERE id = v_item.product_id AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found or inactive.', v_item.product_id;
        END IF;

        v_client_tax := COALESCE(v_item.tax_rate, v_item.gst_rate);
        IF v_client_tax IS NOT NULL AND v_client_tax != v_product.gst_rate THEN
            RAISE EXCEPTION 'Invalid tax rate submitted (%). Authoritative tax rate is %.',
                v_client_tax, v_product.gst_rate;
        END IF;

        SELECT special_price INTO v_special_price
        FROM public.customer_special_prices
        WHERE customer_id = p_customer_id AND product_id = v_item.product_id;

        v_base_unit_price := COALESCE(v_special_price, v_product.price);

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

    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        quantity INT,
        unit_price NUMERIC,
        gst_rate NUMERIC,
        tax_rate NUMERIC
    )
    LOOP
        SELECT id, name, default_sale_price AS price, gst_rate INTO v_product FROM public.products WHERE id = v_item.product_id;
        SELECT special_price INTO v_special_price FROM public.customer_special_prices WHERE customer_id = p_customer_id AND product_id = v_item.product_id;
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

-- 2. Restore Round 5 rpc_record_jar_movement
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

    IF p_condition_from NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_from: %', p_condition_from;
    END IF;
    IF p_condition_to NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_to: %', p_condition_to;
    END IF;

    SELECT id INTO v_jar_product_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id FROM public.warehouses WHERE is_default = true LIMIT 1;

    SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id;
    SELECT * INTO v_dst_loc FROM public.locations WHERE id = p_destination_location_id;

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
        'ORDER',
        p_reference_id,
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_movement_id;

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
