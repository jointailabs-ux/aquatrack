-- ==============================================================================
-- Migration: 20261115000003_seamless_jar_custody_reconciliation.sql
-- Description: Physical custody reconciliation on delivery:
--              New customer jars = GREATEST(0, Previous Total Jars + Delivered - Collected)
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
    v_payment_num VARCHAR(50);
    v_prev_total_custody INT := 0;
    v_new_custody INT := 0;
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

        -- Calculate previous total jars present with customer (full + empty)
        SELECT (total_full_jars_holding + total_empty_jars_holding) INTO v_prev_total_custody
        FROM public.customers WHERE id = v_order.customer_id;

        -- Seamless physical custody formula:
        -- Customer has (Previous Jars + Delivered - Collected)
        v_new_custody := greatest(0, COALESCE(v_prev_total_custody, 0) + p_actual_delivered - p_empty_jars);

        -- Update customer jar holdings and balance
        UPDATE public.customers
        SET total_full_jars_holding = v_new_custody,
            total_empty_jars_holding = 0,
            total_damaged_jars_holding = total_damaged_jars_holding + p_damaged_jars,
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
        'customer_closing_holding', v_new_custody
    );
END;
$function$;

