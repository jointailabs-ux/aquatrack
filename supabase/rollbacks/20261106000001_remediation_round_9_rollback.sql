-- ==============================================================================
-- AquaTrack ERP — Database Migration Round 9 Rollback
-- File: supabase/rollbacks/20261106000001_remediation_round_9_rollback.sql
-- Date: 2026-11-06
-- Objective: Safely roll back Round 9 changes and restore Round 8 definitions.
-- ==============================================================================

BEGIN;

-- 1. Remove Round 9 Audit Table
DROP TABLE IF EXISTS public.historical_order_reconciliation_flags CASCADE;

-- 2. Restore Round 8 Policy on delivery_stop_items
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'delivery_stop_items' AND policyname = 'dsi_modify'
    ) THEN
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

-- 3. Restore Round 8 rpc_execute_delivery_stop
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

    SELECT order_id INTO v_order_id FROM public.delivery_stops WHERE id = p_stop_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop not found: %', p_stop_id;
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = v_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent order % not found.', v_order_id;
    END IF;

    SELECT * INTO v_stop FROM public.delivery_stops WHERE id = p_stop_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop not found: %', p_stop_id;
    END IF;

    IF v_caller_role != 'owner' AND v_stop.assigned_staff_id != v_caller_id THEN
        RAISE EXCEPTION 'Access denied: staff can only execute stops assigned to them.';
    END IF;

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

    SELECT id, location_id INTO v_default_wh, v_wh_location 
    FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL OR v_wh_location IS NULL THEN
        RAISE EXCEPTION 'Canonical warehouse configuration is missing.';
    END IF;

    PERFORM 1 FROM public.order_items WHERE order_id = v_order.id ORDER BY id FOR UPDATE;

    PERFORM 1 FROM public.inventory_balances 
    WHERE warehouse_id = v_default_wh 
      AND product_id IN (SELECT product_id FROM public.order_items WHERE order_id = v_order.id)
    ORDER BY product_id FOR UPDATE;

    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer % not found.', v_order.customer_id;
    END IF;

    IF p_failure_reason IS NOT NULL AND p_actual_delivered = 0 THEN
        UPDATE public.delivery_stops
        SET status = 'FAILED',
            failure_reason = p_failure_reason,
            executed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_stop_id;

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

    PERFORM public._internal_establish_rpc_context('rpc_execute_delivery_stop', 'DELIVERY_STOP_EXECUTION');

    UPDATE public.customers
    SET total_full_jars_holding = v_new_full_holding,
        total_empty_jars_holding = v_new_empty_holding,
        total_damaged_jars_holding = v_new_damaged_holding,
        updated_at = pg_catalog.now()
    WHERE id = v_customer.id;

    IF p_items IS NOT NULL AND pg_catalog.jsonb_array_length(p_items) > 0 THEN
        FOR v_parsed_item IN 
            SELECT (val->>'product_id')::UUID AS product_id, (val->>'quantity_delivered')::INT AS qty
            FROM pg_catalog.jsonb_array_elements(p_items) AS val
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

                UPDATE public.inventory_balances
                SET quantity_on_hand = pg_catalog.greatest(0, quantity_on_hand - v_parsed_item.qty),
                    quantity_reserved = pg_catalog.greatest(0, quantity_reserved - v_parsed_item.qty),
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

    PERFORM public._internal_clear_rpc_context();

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

-- 4. Restore Round 8 rpc_cancel_customer_order
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

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found.', p_order_id;
    END IF;

    IF v_order.status IN ('DELIVERED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Order % cannot be cancelled in "%" status.', p_order_id, v_order.status;
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location 
    FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        RAISE EXCEPTION 'Default central warehouse not found.';
    END IF;

    PERFORM 1 FROM public.delivery_stops WHERE order_id = v_order.id ORDER BY id FOR UPDATE;
    PERFORM 1 FROM public.order_items WHERE order_id = v_order.id ORDER BY id FOR UPDATE;

    PERFORM 1 FROM public.inventory_balances 
    WHERE warehouse_id = v_default_wh 
      AND product_id IN (SELECT product_id FROM public.order_items WHERE order_id = v_order.id)
    ORDER BY product_id FOR UPDATE;

    PERFORM 1 FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    SELECT * INTO v_invoice FROM public.invoices WHERE order_id = v_order.id FOR UPDATE;

    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v_order.id ORDER BY product_id
    LOOP
        v_remaining_res := pg_catalog.greatest(0, v_item.quantity - COALESCE(v_item.delivered_quantity, 0));

        IF v_remaining_res > 0 THEN
            UPDATE public.inventory_balances
            SET quantity_reserved = pg_catalog.greatest(0, quantity_reserved - v_remaining_res),
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;

            v_released_reservations_count := v_released_reservations_count + 1;
        END IF;

        v_line_cancelled_subtotal := v_remaining_res * v_item.unit_price;
        v_line_cancelled_tax := pg_catalog.round(v_line_cancelled_subtotal * (v_item.tax_rate / 100.0), 2);
        v_cancelled_subtotal := v_cancelled_subtotal + v_line_cancelled_subtotal;
        v_cancelled_tax := v_cancelled_tax + v_line_cancelled_tax;

        v_line_delivered_subtotal := COALESCE(v_item.delivered_quantity, 0) * v_item.unit_price;
        v_line_delivered_tax := pg_catalog.round(v_line_delivered_subtotal * (v_item.tax_rate / 100.0), 2);
        v_delivered_subtotal := v_delivered_subtotal + v_line_delivered_subtotal;
        v_delivered_tax := v_delivered_tax + v_line_delivered_tax;
    END LOOP;

    v_cancelled_total := v_cancelled_subtotal + v_cancelled_tax;
    v_delivered_total := v_delivered_subtotal + v_delivered_tax;

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

    IF v_invoice.id IS NOT NULL THEN
        SELECT COALESCE(SUM(amount), 0.00) INTO v_previously_paid
        FROM public.customer_payments
        WHERE invoice_id = v_invoice.id;

        IF v_previously_paid = 0.00 AND v_invoice.status IN ('PAID', 'PARTIALLY_PAID') THEN
            v_previously_paid := pg_catalog.greatest(0.00, v_invoice.total_amount - v_invoice.balance_due);
        END IF;

        IF v_cancelled_total > 0 THEN
            PERFORM public._internal_establish_rpc_context('rpc_cancel_customer_order', 'CUSTOMER_ORDER_BALANCE_ONLY');

            UPDATE public.customers
            SET current_balance = current_balance - v_cancelled_total,
                updated_at = pg_catalog.now()
            WHERE id = v_order.customer_id;

            PERFORM public._internal_clear_rpc_context();

            v_entry_num := 'REV-' || v_order.order_number;

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

        IF v_delivered_total = 0.00 THEN
            UPDATE public.invoices
            SET status = 'CANCELLED',
                balance_due = 0.00,
                subtotal = 0.00,
                tax_amount = 0.00,
                total_amount = 0.00,
                updated_at = pg_catalog.now()
            WHERE id = v_invoice.id;
        ELSE
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

REVOKE ALL ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT, JSONB) TO authenticated, service_role;

COMMIT;

