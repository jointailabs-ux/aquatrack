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

