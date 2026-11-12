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

