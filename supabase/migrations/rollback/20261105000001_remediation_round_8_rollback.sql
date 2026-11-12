-- ==============================================================================
-- AquaTrack ERP — Migration Rollback Round 8
-- File: supabase/migrations/rollback/20261105000001_remediation_round_8_rollback.sql
-- Target Migration: 20261105000001_remediation_round_8.sql
-- ==============================================================================
-- ROLLBACK IMPACT ASSESSMENT:
-- 1. Table public.delivery_stop_items contains granular delivery records. Dropping
--    this table removes per-product delivery breakdown for multi-product deliveries
--    recorded during Round 8 operation.
-- 2. Column order_items.delivered_quantity will be dropped.
-- 3. Functions rpc_execute_delivery_stop and rpc_cancel_customer_order will be
--    restored to their Round 7 signatures.
-- ==============================================================================

BEGIN;

-- Precondition Verification: Ensure Round 8 objects exist before rolling back
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'delivery_stop_items'
    ) THEN
        RAISE EXCEPTION 'Rollback aborted: Table public.delivery_stop_items does not exist.';
    END IF;

    RAISE NOTICE 'Precondition passed: Round 8 objects found. Proceeding with safe rollback.';
END $$;

-- 1. DROP DELIVERY STOP ITEMS TABLE & POLICIES
DROP TABLE IF EXISTS public.delivery_stop_items CASCADE;

-- 2. REMOVE COLUMN delivered_quantity FROM order_items IF EXISTS
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'order_items' 
          AND column_name = 'delivered_quantity'
    ) THEN
        ALTER TABLE public.order_items DROP COLUMN delivered_quantity;
    END IF;
END $$;

-- 3. RESTORE ROUND 7 SIGNATURES FOR RPC FUNCTIONS
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
    v_item RECORD;
    v_delivered_qty INT := 0;
    v_remaining_res INT := 0;
    v_invoice RECORD;
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

    SELECT id INTO v_default_wh FROM public.warehouses WHERE is_default = true LIMIT 1;

    SELECT COALESCE(SUM(actual_delivered_quantity), 0) INTO v_delivered_qty
    FROM public.delivery_stops
    WHERE order_id = v_order.id AND status = 'COMPLETED';

    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v_order.id
    LOOP
        v_remaining_res := pg_catalog.greatest(0, v_item.quantity - v_delivered_qty);
        IF v_remaining_res > 0 THEN
            UPDATE public.inventory_balances
            SET quantity_reserved = pg_catalog.greatest(0, quantity_reserved - v_remaining_res),
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;
        END IF;
    END LOOP;

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

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', 'CANCELLED',
        'released_reservation', true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_cancel_customer_order(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_cancel_customer_order(UUID, TEXT) TO authenticated, service_role;

-- 4. POST-ROLLBACK VERIFICATION BLOCK
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'delivery_stop_items'
    ) THEN
        RAISE EXCEPTION 'Rollback verification failed: Table delivery_stop_items still exists.';
    END IF;

    RAISE NOTICE 'SUCCESS: Round 8 rollback completed and verified.';
END $$;

COMMIT;

