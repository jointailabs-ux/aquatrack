-- ==============================================================================
-- Migration: 20261115000004_non_reusable_orders_and_staff_jar_returns.sql
-- Description: 
--   1. Fix rpc_execute_delivery_stop to only adjust jar custody if the order has reusable jars.
--   2. Implement rpc_return_staff_jars_to_stock so staff can return collected jars back to godown stock.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.rpc_execute_delivery_stop(
    p_stop_id uuid,
    p_actual_delivered integer,
    p_empty_jars integer,
    p_damaged_jars integer,
    p_payment_amount numeric DEFAULT 0.00,
    p_payment_method character varying DEFAULT NULL::character varying,
    p_notes text DEFAULT NULL::text,
    p_failure_reason text DEFAULT NULL::text,
    p_items jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_stop RECORD;
    v_order RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_reusable_jar_id UUID;
    v_order_jar_qty INT := 0;
    v_jars_delivered INT := 0;
    v_payment_num VARCHAR(50);
    v_prev_total_custody INT := 0;
    v_new_custody INT := 0;
    v_caller_id UUID;
    v_item RECORD;
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

    -- Calculate how many reusable jars were in the order items
    SELECT COALESCE(SUM(oi.quantity), 0) INTO v_order_jar_qty
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = v_order.id AND p.is_reusable_jar = true;

    -- If order had no reusable jars, 0 jars are delivered regardless of package count
    IF v_order_jar_qty = 0 THEN
        v_jars_delivered := 0;
    ELSE
        v_jars_delivered := p_actual_delivered;
    END IF;

    -- Update stop record
    UPDATE public.delivery_stops
    SET status = CASE WHEN p_failure_reason IS NOT NULL AND length(trim(p_failure_reason)) > 0 THEN 'FAILED' ELSE 'COMPLETED' END,
        actual_delivered_quantity = p_actual_delivered,
        empty_jars_collected = COALESCE(p_empty_jars, 0),
        damaged_jars_collected = COALESCE(p_damaged_jars, 0),
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

        -- Calculate previous total jars present with customer (full + empty)
        SELECT (COALESCE(total_full_jars_holding, 0) + COALESCE(total_empty_jars_holding, 0)) INTO v_prev_total_custody
        FROM public.customers WHERE id = v_order.customer_id;

        -- Physical custody formula: Customer Total Jars = Previous + Delivered Jars - Collected Jars
        v_new_custody := greatest(0, COALESCE(v_prev_total_custody, 0) + v_jars_delivered - COALESCE(p_empty_jars, 0));

        -- Update customer jar holdings and balance
        UPDATE public.customers
        SET total_full_jars_holding = v_new_custody,
            total_empty_jars_holding = 0,
            total_damaged_jars_holding = total_damaged_jars_holding + COALESCE(p_damaged_jars, 0),
            current_balance = greatest(0.00, current_balance - COALESCE(p_payment_amount, 0.00)),
            updated_at = pg_catalog.now()
        WHERE id = v_order.customer_id;

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

        -- Decrement inventory balances for all products in the order
        FOR v_item IN SELECT product_id, quantity FROM public.order_items WHERE order_id = v_order.id LOOP
            IF v_default_wh IS NOT NULL THEN
                UPDATE public.inventory_balances
                SET quantity_on_hand = greatest(0, quantity_on_hand - v_item.quantity),
                    quantity_reserved = greatest(0, quantity_reserved - v_item.quantity),
                    updated_at = pg_catalog.now()
                WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;
            END IF;
        END LOOP;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', CASE WHEN p_failure_reason IS NOT NULL THEN 'FAILED' ELSE 'COMPLETED' END,
        'customer_closing_holding', v_new_custody
    );
END;
$function$;

-- ==============================================================================
-- Function: rpc_return_staff_jars_to_stock
-- Description: Return empty jars collected by staff from delivery routes into godown stock.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_return_staff_jars_to_stock(
    p_staff_id uuid,
    p_quantity integer,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_default_wh UUID;
    v_wh_location UUID;
    v_staff_loc UUID;
    v_reusable_jar_id UUID;
    v_caller_id UUID;
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero.';
    END IF;

    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        SELECT id INTO v_caller_id FROM public.profiles WHERE is_active = true ORDER BY (role = 'owner') DESC LIMIT 1;
    END IF;

    -- Get default warehouse and location
    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses LIMIT 1;
    END IF;

    -- Get staff vehicle location
    SELECT id INTO v_staff_loc FROM public.locations WHERE type = 'VEHICLE' LIMIT 1;
    IF v_staff_loc IS NULL THEN
        v_staff_loc := v_wh_location;
    END IF;

    -- Get reusable jar product id
    SELECT id INTO v_reusable_jar_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;

    -- Increase godown inventory balance for empty / reusable jars
    IF v_default_wh IS NOT NULL AND v_reusable_jar_id IS NOT NULL THEN
        INSERT INTO public.inventory_balances (warehouse_id, product_id, quantity_on_hand, quantity_reserved)
        VALUES (v_default_wh, v_reusable_jar_id, p_quantity, 0)
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET quantity_on_hand = inventory_balances.quantity_on_hand + p_quantity,
                      updated_at = pg_catalog.now();
    END IF;

    -- Record immutable jar custody movement
    IF v_reusable_jar_id IS NOT NULL AND v_wh_location IS NOT NULL AND v_staff_loc IS NOT NULL THEN
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
            v_reusable_jar_id,
            v_staff_loc,
            v_wh_location,
            'EMPTY_CLEAN',
            'EMPTY_CLEAN',
            p_quantity,
            'VEHICLE_RETURN_TO_WAREHOUSE',
            'AUDIT',
            p_staff_id,
            COALESCE(p_notes, 'Staff returned jars to godown stock'),
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'returned_quantity', p_quantity,
        'message', 'Successfully returned ' || p_quantity || ' jars to godown stock.'
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop(uuid, integer, integer, integer, numeric, character varying, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_return_staff_jars_to_stock(uuid, integer, text) TO authenticated, service_role;

