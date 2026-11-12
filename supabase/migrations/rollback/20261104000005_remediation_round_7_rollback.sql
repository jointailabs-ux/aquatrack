-- ==============================================================================
-- AquaTrack ERP — Migration Rollback: Round 7 Remediation
-- Version: 20261104000005_remediation_round_7_rollback.sql
-- Description:
--   Restores verified Round 6 definitions for:
--   1. rpc_record_jar_movement
--   2. rpc_create_customer_order
--   3. rpc_execute_delivery_stop
--   4. check_customer_privileged_updates & trg_protect_customer_privileged_fields
--   5. check_supplier_privileged_updates & trg_protect_supplier_privileged_fields
--   6. Drops Round 7 rpc_cancel_customer_order
--   7. Drops Round 7 internal RPC authorization context functions and table
--   8. Drops Round 7 singleton warehouse constraint
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. DROP ROUND 7 NEW OBJECTS
-- ------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.rpc_cancel_customer_order(UUID, TEXT);
DROP FUNCTION IF EXISTS public._internal_clear_rpc_context();
DROP FUNCTION IF EXISTS public._internal_establish_rpc_context(VARCHAR, VARCHAR);
DROP TABLE IF EXISTS public.internal_rpc_auth_tokens;

ALTER TABLE public.warehouses DROP CONSTRAINT IF EXISTS chk_single_default_warehouse;
DROP INDEX IF EXISTS public.uq_singleton_warehouse;

-- ------------------------------------------------------------------------------
-- 2. RESTORE ROUND 6 TRIGGER: check_customer_privileged_updates
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_customer_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_stack TEXT;
BEGIN
    v_caller_id := auth.uid();

    GET DIAGNOSTICS v_stack = PG_CONTEXT;

    IF v_stack LIKE '%rpc_record_jar_movement%' THEN
        IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
           (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
            RAISE EXCEPTION 'Access Denied: Jar movement operations cannot modify financial balances or deposits.';
        END IF;
        RETURN NEW;
    END IF;

    IF v_stack LIKE '%rpc_create_customer_order%' THEN
        IF (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
           (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
           (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
           (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
           (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
           (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
            RAISE EXCEPTION 'Access Denied: Order creation cannot directly modify jar holdings or deposit held.';
        END IF;
        RETURN NEW;
    END IF;

    IF v_stack LIKE '%rpc_execute_delivery_stop%' OR v_stack LIKE '%rpc_record_customer_payment%' THEN
        RETURN NEW;
    END IF;

    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
               (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
               (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
               (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
                RAISE EXCEPTION 'Access Denied: Customer financial balances and jar holdings cannot be directly modified. Use approved transactional workflows.';
            END IF;
        ELSIF TG_OP = 'INSERT' THEN
            IF (NEW.current_balance IS DISTINCT FROM 0.00) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_empty_clean_holding IS DISTINCT FROM 0) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_scrap_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_deposit_held IS DISTINCT FROM 0.00) THEN
                RAISE EXCEPTION 'Access Denied: New customer records must initialize with zero financial balances and jar holdings.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    IF current_setting('request.jwt.claim.sub', true) IS NULL AND 
       current_setting('request.jwt.claim.role', true) IS NULL THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access Denied: Unauthenticated modification of customer records.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_customer_privileged_fields ON public.customers;
CREATE TRIGGER trg_protect_customer_privileged_fields
    BEFORE INSERT OR UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_customer_privileged_updates();

-- ------------------------------------------------------------------------------
-- 3. RESTORE ROUND 6 TRIGGER: check_supplier_privileged_updates
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_supplier_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_stack TEXT;
BEGIN
    v_caller_id := auth.uid();

    GET DIAGNOSTICS v_stack = PG_CONTEXT;

    IF v_stack LIKE '%rpc_record_jar_movement%' THEN
        IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) THEN
            RAISE EXCEPTION 'Access Denied: Jar movements cannot modify supplier payable balances.';
        END IF;
        RETURN NEW;
    END IF;

    IF v_stack LIKE '%rpc_receive_purchase_order%' OR 
       v_stack LIKE '%rpc_record_supplier_payment%' THEN
        RETURN NEW;
    END IF;

    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) OR
               (NEW.jars_in_custody IS DISTINCT FROM OLD.jars_in_custody) THEN
                RAISE EXCEPTION 'Access Denied: Supplier payable balances and jar custody cannot be directly modified. Direct updates are prohibited.';
            END IF;
        ELSIF TG_OP = 'INSERT' THEN
            IF (NEW.current_payable IS DISTINCT FROM 0.00) OR
               (NEW.jars_in_custody IS DISTINCT FROM 0) THEN
                RAISE EXCEPTION 'Access Denied: New supplier records must initialize with zero payable and custody.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    IF current_setting('request.jwt.claim.sub', true) IS NULL AND 
       current_setting('request.jwt.claim.role', true) IS NULL THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Access Denied: Unauthenticated modification of supplier records.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_supplier_privileged_fields ON public.suppliers;
CREATE TRIGGER trg_protect_supplier_privileged_fields
    BEFORE INSERT OR UPDATE ON public.suppliers
    FOR EACH ROW
    EXECUTE FUNCTION public.check_supplier_privileged_updates();

-- ------------------------------------------------------------------------------
-- 4. RESTORE ROUND 6 rpc_record_jar_movement
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
    v_po RECORD;
    v_po_item RECORD;
    v_remaining_qty INT;
    v_inserted_movement_type VARCHAR(40);
    v_inserted_ref_type VARCHAR(30);
    v_stock_m_type VARCHAR(40);
    v_stock_ref_type VARCHAR(30);
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

    IF p_movement_type NOT IN (
        'CUSTOMER_DELIVERY', 'CUSTOMER_EMPTY_RETURN', 'DAMAGED_COLLECTED',
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL',
        'REPAIR_CYCLE', 'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT',
        'DISPATCH_TO_VEHICLE', 'VEHICLE_RETURN_TO_WAREHOUSE',
        'SUPPLIER_PURCHASE', 'RETURN_TO_SUPPLIER', 'OPENING_STOCK'
    ) THEN
        RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
    END IF;

    IF p_condition_from = 'DAMAGED_SCRAP' AND p_condition_to != 'DAMAGED_SCRAP' THEN
        RAISE EXCEPTION 'Scrapped jars cannot be restored to usable or repairable condition. Scrap is terminal.';
    END IF;

    IF p_movement_type = 'WASHING_CYCLE_DIRTY_TO_CLEAN' THEN
        IF p_condition_from != 'EMPTY_DIRTY' OR p_condition_to != 'EMPTY_CLEAN' THEN
            RAISE EXCEPTION 'Washing cycle requires EMPTY_DIRTY -> EMPTY_CLEAN transition.';
        END IF;
    END IF;

    IF p_movement_type = 'FILLING_CYCLE_CLEAN_TO_FULL' THEN
        IF p_condition_from != 'EMPTY_CLEAN' OR p_condition_to != 'FULL_USABLE' THEN
            RAISE EXCEPTION 'Filling cycle requires EMPTY_CLEAN -> FULL_USABLE transition.';
        END IF;
    END IF;

    IF p_movement_type = 'REPAIR_CYCLE' THEN
        IF p_condition_from != 'DAMAGED_REPAIRABLE' OR p_condition_to NOT IN ('EMPTY_CLEAN', 'DAMAGED_SCRAP') THEN
            RAISE EXCEPTION 'Repair cycle requires DAMAGED_REPAIRABLE -> EMPTY_CLEAN or DAMAGED_SCRAP transition.';
        END IF;
    END IF;

    IF p_movement_type = 'SCRAP_WRITEOFF' THEN
        IF p_condition_from NOT IN ('DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') OR p_condition_to != 'DAMAGED_SCRAP' THEN
            RAISE EXCEPTION 'Scrap writeoff requires DAMAGED_REPAIRABLE/DAMAGED_SCRAP -> DAMAGED_SCRAP transition.';
        END IF;
    END IF;

    IF p_condition_from != p_condition_to AND p_movement_type NOT IN (
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL', 'REPAIR_CYCLE', 'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT'
    ) THEN
        RAISE EXCEPTION 'Condition transition from % to % is not permitted under movement type %.',
            p_condition_from, p_condition_to, p_movement_type;
    END IF;

    IF p_movement_type = 'INTERNAL_ADJUSTMENT' AND p_condition_from != p_condition_to THEN
        IF NOT (p_condition_from = 'DAMAGED_REPAIRABLE' AND p_condition_to IN ('EMPTY_CLEAN', 'DAMAGED_SCRAP')) THEN
            RAISE EXCEPTION 'Internal adjustment cannot perform arbitrary condition conversion from % to %.',
                p_condition_from, p_condition_to;
        END IF;
    END IF;

    SELECT id INTO v_jar_product_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_jar_product_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;

    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh_id IS NULL THEN
        RAISE EXCEPTION 'Default warehouse configuration is missing.';
    END IF;

    IF p_source_location_id = p_destination_location_id THEN
        SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
        v_dst_loc := v_src_loc;
    ELSE
        IF p_source_location_id < p_destination_location_id THEN
            SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
            SELECT * INTO v_dst_loc FROM public.locations WHERE id = p_destination_location_id FOR UPDATE;
        ELSE
            SELECT * INTO v_dst_loc FROM public.locations WHERE id = p_destination_location_id FOR UPDATE;
            SELECT * INTO v_src_loc FROM public.locations WHERE id = p_source_location_id FOR UPDATE;
        END IF;
    END IF;

    IF v_src_loc.id IS NULL THEN
        RAISE EXCEPTION 'Source location % does not exist.', p_source_location_id;
    END IF;
    IF v_dst_loc.id IS NULL THEN
        RAISE EXCEPTION 'Destination location % does not exist.', p_destination_location_id;
    END IF;

    IF p_movement_type = 'SUPPLIER_PURCHASE' THEN
        IF v_src_loc.type != 'SUPPLIER' THEN
            RAISE EXCEPTION 'Supplier purchase source must be a supplier location. Location % is %.',
                p_source_location_id, v_src_loc.type;
        END IF;

        IF v_dst_loc.type != 'WAREHOUSE' THEN
            RAISE EXCEPTION 'Supplier purchase destination must be a warehouse location. Location % is %.',
                p_destination_location_id, v_dst_loc.type;
        END IF;

        IF p_reference_id IS NULL THEN
            RAISE EXCEPTION 'Supplier purchase requires a mandatory purchase reference ID.';
        END IF;

        SELECT * INTO v_supp FROM public.suppliers WHERE location_id = p_source_location_id FOR UPDATE;
        IF v_supp.id IS NULL THEN
            RAISE EXCEPTION 'Supplier record not found for location %.', p_source_location_id;
        END IF;

        SELECT * INTO v_po FROM public.purchases WHERE id = p_reference_id FOR UPDATE;
        IF v_po.id IS NULL THEN
            RAISE EXCEPTION 'Purchase order % not found.', p_reference_id;
        END IF;

        IF v_po.supplier_id != v_supp.id THEN
            RAISE EXCEPTION 'Purchase order % does not belong to supplier %.', p_reference_id, v_supp.id;
        END IF;

        IF v_po.status = 'CANCELLED' THEN
            RAISE EXCEPTION 'Cannot receive jars against cancelled purchase order %.', p_reference_id;
        END IF;

        SELECT * INTO v_po_item FROM public.purchase_items
        WHERE purchase_id = v_po.id AND product_id = v_jar_product_id
        FOR UPDATE;

        IF v_po_item.id IS NULL THEN
            RAISE EXCEPTION 'Purchase order % does not contain jar product %.', p_reference_id, v_jar_product_id;
        END IF;

        v_remaining_qty := v_po_item.quantity_ordered - v_po_item.quantity_received;
        IF p_quantity > v_remaining_qty THEN
            RAISE EXCEPTION 'Cannot receive % jars: remaining receivable quantity on purchase order % is % (ordered: %, received: %).',
                p_quantity, p_reference_id, v_remaining_qty, v_po_item.quantity_ordered, v_po_item.quantity_received;
        END IF;

        UPDATE public.purchase_items
        SET quantity_received = quantity_received + p_quantity
        WHERE id = v_po_item.id;

        IF NOT EXISTS (
            SELECT 1 FROM public.purchase_items
            WHERE purchase_id = v_po.id AND quantity_received < quantity_ordered
        ) THEN
            UPDATE public.purchases
            SET status = 'RECEIVED',
                received_at = pg_catalog.now(),
                updated_at = pg_catalog.now()
            WHERE id = v_po.id;
        END IF;

        v_inserted_ref_type := 'PURCHASE';

    ELSIF p_movement_type = 'OPENING_STOCK' THEN
        IF v_caller_role != 'owner' THEN
            RAISE EXCEPTION 'Only the business owner can record initial opening stock entries.';
        END IF;
        IF v_dst_loc.type != 'WAREHOUSE' THEN
            RAISE EXCEPTION 'Opening stock destination must be a warehouse location.';
        END IF;

        v_inserted_ref_type := 'AUDIT';

    ELSE
        IF v_src_loc.type = 'CUSTOMER' THEN
            SELECT * INTO v_cust FROM public.customers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_cust.id IS NULL THEN
                RAISE EXCEPTION 'Customer at location % not found.', p_source_location_id;
            END IF;

            IF p_condition_from = 'FULL_USABLE' AND v_cust.total_full_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient full jars. Available: %, Requested: %.', v_cust.total_full_jars_holding, p_quantity;
            ELSIF p_condition_from = 'EMPTY_CLEAN' AND COALESCE(v_cust.total_empty_clean_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient clean empty jars. Available: %, Requested: %.', COALESCE(v_cust.total_empty_clean_holding, 0), p_quantity;
            ELSIF p_condition_from = 'EMPTY_DIRTY' AND v_cust.total_empty_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient dirty empty jars. Available: %, Requested: %.', v_cust.total_empty_jars_holding, p_quantity;
            ELSIF p_condition_from = 'DAMAGED_REPAIRABLE' AND COALESCE(v_cust.total_damaged_jars_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient damaged repairable jars. Available: %, Requested: %.', COALESCE(v_cust.total_damaged_jars_holding, 0), p_quantity;
            ELSIF p_condition_from = 'DAMAGED_SCRAP' AND COALESCE(v_cust.total_scrap_jars_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient scrap jars. Available: %, Requested: %.', COALESCE(v_cust.total_scrap_jars_holding, 0), p_quantity;
            END IF;

            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_from = 'FULL_USABLE' THEN total_full_jars_holding - p_quantity ELSE total_full_jars_holding END,
                total_empty_clean_holding = CASE WHEN p_condition_from = 'EMPTY_CLEAN' THEN total_empty_clean_holding - p_quantity ELSE total_empty_clean_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_from = 'EMPTY_DIRTY' THEN total_empty_jars_holding - p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding - p_quantity ELSE total_damaged_jars_holding END,
                total_scrap_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_SCRAP' THEN total_scrap_jars_holding - p_quantity ELSE total_scrap_jars_holding END,
                updated_at = pg_catalog.now()
            WHERE id = v_cust.id;

        ELSIF v_src_loc.type = 'SUPPLIER' THEN
            SELECT * INTO v_supp FROM public.suppliers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_supp.id IS NULL THEN
                RAISE EXCEPTION 'Supplier at location % not found.', p_source_location_id;
            END IF;

            IF v_supp.jars_in_custody < p_quantity THEN
                RAISE EXCEPTION 'Supplier has insufficient jars in custody. Available: %, Requested: %.', v_supp.jars_in_custody, p_quantity;
            END IF;

            UPDATE public.suppliers
            SET jars_in_custody = jars_in_custody - p_quantity,
                updated_at = pg_catalog.now()
            WHERE id = v_supp.id;

        ELSIF v_src_loc.type = 'WAREHOUSE' THEN
            IF p_condition_from = 'FULL_USABLE' THEN
                SELECT quantity_on_hand INTO v_src_wh_full
                FROM public.inventory_balances
                WHERE warehouse_id = v_default_wh_id AND product_id = v_jar_product_id
                FOR UPDATE;

                IF COALESCE(v_src_wh_full, 0) < p_quantity THEN
                    RAISE EXCEPTION 'Warehouse has insufficient full usable jars. Available: %, Requested: %.', COALESCE(v_src_wh_full, 0), p_quantity;
                END IF;

                UPDATE public.inventory_balances
                SET quantity_on_hand = quantity_on_hand - p_quantity,
                    updated_at = pg_catalog.now()
                WHERE warehouse_id = v_default_wh_id AND product_id = v_jar_product_id;
            ELSE
                SELECT COALESCE(
                    (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = p_condition_from)
                    -
                    (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = p_condition_from),
                    0
                ) INTO v_avail_wh_cond;

                IF v_avail_wh_cond < p_quantity THEN
                    RAISE EXCEPTION 'Warehouse has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_wh_cond, p_quantity;
                END IF;
            END IF;

        ELSIF v_src_loc.type = 'VEHICLE' THEN
            SELECT COALESCE(
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = p_condition_from)
                -
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = p_condition_from),
                0
            ) INTO v_avail_veh_cond;

            IF v_avail_veh_cond < p_quantity THEN
                RAISE EXCEPTION 'Staff vehicle has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_veh_cond, p_quantity;
            END IF;
        END IF;

        v_inserted_ref_type := CASE
            WHEN p_reference_type IN ('PURCHASE_ORDER', 'PURCHASE') THEN 'PURCHASE'
            WHEN p_reference_type IN ('ORDER') THEN 'ORDER'
            WHEN p_reference_type IN ('DELIVERY_STOP', 'DELIVERY') THEN 'DELIVERY_STOP'
            WHEN p_reference_type IN ('BATCH_WASH') THEN 'BATCH_WASH'
            WHEN p_reference_type IN ('AUDIT') THEN 'AUDIT'
            ELSE NULL
        END;
    END IF;

    IF v_dst_loc.type = 'CUSTOMER' THEN
        SELECT * INTO v_dst_cust FROM public.customers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_cust.id IS NOT NULL THEN
            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_to = 'FULL_USABLE' THEN total_full_jars_holding + p_quantity ELSE total_full_jars_holding END,
                total_empty_clean_holding = CASE WHEN p_condition_to = 'EMPTY_CLEAN' THEN total_empty_clean_holding + p_quantity ELSE total_empty_clean_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_to = 'EMPTY_DIRTY' THEN total_empty_jars_holding + p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding + p_quantity ELSE total_damaged_jars_holding END,
                total_scrap_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_SCRAP' THEN total_scrap_jars_holding + p_quantity ELSE total_scrap_jars_holding END,
                updated_at = pg_catalog.now()
            WHERE id = v_dst_cust.id;
        END IF;

    ELSIF v_dst_loc.type = 'SUPPLIER' THEN
        SELECT * INTO v_dst_supp FROM public.suppliers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_supp.id IS NOT NULL THEN
            UPDATE public.suppliers
            SET jars_in_custody = jars_in_custody + p_quantity,
                updated_at = pg_catalog.now()
            WHERE id = v_dst_supp.id;
        END IF;

    ELSIF v_dst_loc.type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
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
    END IF;

    v_inserted_movement_type := CASE 
        WHEN p_movement_type = 'OPENING_STOCK' THEN 'INTERNAL_ADJUSTMENT'
        WHEN p_movement_type = 'REPAIR_CYCLE' THEN 'INTERNAL_ADJUSTMENT'
        ELSE p_movement_type
    END;

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
        v_inserted_movement_type,
        v_inserted_ref_type,
        p_reference_id,
        COALESCE(p_notes, 'Round 6 jar custody movement'),
        v_caller_id
    ) RETURNING id INTO v_movement_id;

    IF (v_src_loc.type = 'WAREHOUSE' AND p_condition_from = 'FULL_USABLE') OR
       (v_dst_loc.type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE') OR
       (p_movement_type = 'SCRAP_WRITEOFF') THEN

        v_stock_m_type := CASE
            WHEN p_movement_type = 'SUPPLIER_PURCHASE' THEN 'PURCHASE_RECEIPT'
            WHEN p_movement_type = 'CUSTOMER_DELIVERY' THEN 'DELIVERY_DISPATCH'
            WHEN p_movement_type = 'CUSTOMER_EMPTY_RETURN' THEN 'DELIVERY_RETURN'
            WHEN p_movement_type = 'SCRAP_WRITEOFF' THEN 'SCRAP_WRITEOFF'
            WHEN p_movement_type = 'DISPATCH_TO_VEHICLE' THEN 'DELIVERY_DISPATCH'
            WHEN p_movement_type = 'VEHICLE_RETURN_TO_WAREHOUSE' THEN 'DELIVERY_RETURN'
            WHEN p_movement_type = 'OPENING_STOCK' THEN 'ADJUSTMENT_IN'
            WHEN v_dst_loc.type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' THEN 'ADJUSTMENT_IN'
            WHEN v_src_loc.type = 'WAREHOUSE' AND p_condition_from = 'FULL_USABLE' THEN 'ADJUSTMENT_OUT'
            ELSE 'ADJUSTMENT_OUT'
        END;

        v_stock_ref_type := CASE
            WHEN p_movement_type = 'SUPPLIER_PURCHASE' THEN 'PURCHASE'
            WHEN p_movement_type = 'OPENING_STOCK' THEN 'AUDIT'
            WHEN p_movement_type = 'SCRAP_WRITEOFF' THEN 'AUDIT'
            WHEN p_movement_type IN ('DISPATCH_TO_VEHICLE', 'VEHICLE_RETURN_TO_WAREHOUSE') THEN 'DELIVERY_STOP'
            WHEN p_reference_type IN ('PURCHASE', 'PURCHASE_ORDER') THEN 'PURCHASE'
            WHEN p_reference_type IN ('ORDER') THEN 'ORDER'
            WHEN p_reference_type IN ('DELIVERY_STOP', 'DELIVERY') THEN 'DELIVERY_STOP'
            WHEN p_reference_type IN ('AUDIT') THEN 'AUDIT'
            ELSE 'AUDIT'
        END;

        INSERT INTO public.stock_movements (
            product_id,
            source_location_id,
            destination_location_id,
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
            p_quantity,
            v_stock_m_type,
            v_stock_ref_type,
            p_reference_id,
            COALESCE(p_notes, 'Round 6 stock ledger movement'),
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'movement_id', v_movement_id,
        'movement_type', p_movement_type,
        'quantity', p_quantity,
        'condition_from', p_condition_from,
        'condition_to', p_condition_to,
        'source_location_id', p_source_location_id,
        'destination_location_id', p_destination_location_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_record_jar_movement(UUID, UUID, VARCHAR, VARCHAR, INT, VARCHAR, VARCHAR, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_record_jar_movement(UUID, UUID, VARCHAR, VARCHAR, INT, VARCHAR, VARCHAR, UUID, TEXT) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 5. RESTORE ROUND 6 rpc_create_customer_order
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
    v_target_date DATE;
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

    v_target_date := COALESCE(p_delivery_date, CURRENT_DATE);

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

        SELECT id, name, default_sale_price, gst_rate INTO v_product
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
        WHERE customer_id = p_customer_id 
          AND product_id = v_item.product_id 
          AND effective_from <= v_target_date
          AND (effective_to IS NULL OR effective_to >= v_target_date)
        ORDER BY effective_from DESC
        LIMIT 1;

        v_base_unit_price := COALESCE(v_special_price, v_product.default_sale_price);

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
        v_target_date,
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
        SELECT id, name, default_sale_price, gst_rate INTO v_product 
        FROM public.products 
        WHERE id = v_item.product_id;

        SELECT special_price INTO v_special_price 
        FROM public.customer_special_prices 
        WHERE customer_id = p_customer_id 
          AND product_id = v_item.product_id 
          AND effective_from <= v_target_date
          AND (effective_to IS NULL OR effective_to >= v_target_date)
        ORDER BY effective_from DESC
        LIMIT 1;

        v_base_unit_price := COALESCE(v_special_price, v_product.default_sale_price);

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
        invoice_date
    ) VALUES (
        v_invoice_num,
        v_order_id,
        p_customer_id,
        v_subtotal,
        v_tax_total,
        v_total_amount,
        v_total_amount,
        'UNPAID',
        CURRENT_DATE
    ) RETURNING id INTO v_invoice_id;

    UPDATE public.customers
    SET current_balance = current_balance + v_total_amount,
        updated_at = pg_catalog.now()
    WHERE id = p_customer_id;

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
        'LED-' || v_invoice_num || '-DR',
        '1110',
        'Accounts Receivable',
        v_total_amount,
        0.00,
        'Accrual invoice for order ' || v_order_num,
        'INVOICE',
        v_invoice_id,
        v_caller_id
    );

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
        'LED-' || v_invoice_num || '-CR-REV',
        '4010',
        'Water Sales Revenue',
        0.00,
        v_subtotal,
        'Revenue from order ' || v_order_num,
        'INVOICE',
        v_invoice_id,
        v_caller_id
    );

    IF v_tax_total > 0 THEN
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
            'LED-' || v_invoice_num || '-CR-TAX',
            '2110',
            'GST Output Payable',
            0.00,
            v_tax_total,
            'GST liability from order ' || v_order_num,
            'INVOICE',
            v_invoice_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'order_number', v_order_num,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_num,
        'subtotal', v_subtotal,
        'tax_total', v_tax_total,
        'total_amount', v_total_amount,
        'status', CASE WHEN p_assigned_staff_id IS NOT NULL THEN 'ASSIGNED' ELSE 'PENDING' END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB, VARCHAR, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB, VARCHAR, TEXT) TO authenticated, service_role;
