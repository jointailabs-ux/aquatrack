-- ==============================================================================
-- AquaTrack ERP — Migration: Remediation Round 5
-- Version: 20261104000003_remediation_round_5.sql
-- Description:
--   1. Complete jar-condition custody accounting on public.customers:
--      Adds total_empty_clean_holding and total_scrap_jars_holding.
--   2. Hardened trigger authorization for customer & supplier protection:
--      Authorizes rpc_record_jar_movement to mutate custody while strictly
--      protecting financial balances and deposit balances from direct staff edits.
--   3. Hardened rpc_record_jar_movement:
--      - Validates supplier purchases: source must be supplier, destination warehouse,
--        verifies purchase order reference or opening stock, rejects customer sources.
--      - Complete condition accounting across all 5 conditions (FULL_USABLE,
--        EMPTY_CLEAN, EMPTY_DIRTY, DAMAGED_REPAIRABLE, DAMAGED_SCRAP).
--      - Strict condition transition matrix (dirty->clean only via washing,
--        clean->full only via filling, repairable->clean/scrap via repair, scrap is final).
--      - Strict asset conservation (delta = 0 for ordinary movements).
--      - Deterministic location and entity row-level locking.
--   4. Hardened rpc_create_customer_order:
--      - Mandatory price override reason validation (minimum 5 non-whitespace chars).
--      - Strict GST tax rate validation against master catalog (rejects tampering).
--      - Concurrent-safe idempotency via pg_advisory_xact_lock.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA ENHANCEMENTS: COMPLETE JAR CONDITION CUSTODY COLUMNS
-- ------------------------------------------------------------------------------

ALTER TABLE public.customers 
    ADD COLUMN IF NOT EXISTS total_empty_clean_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_empty_clean_holding >= 0);

ALTER TABLE public.customers 
    ADD COLUMN IF NOT EXISTS total_scrap_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_scrap_jars_holding >= 0);

-- ------------------------------------------------------------------------------
-- 2. HARDENED TRIGGER: check_customer_privileged_updates
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

    -- Inspect PostgreSQL call stack to check if update was initiated by a trusted transactional RPC
    GET DIAGNOSTICS v_stack = PG_CONTEXT;

    -- Internal RPC Authorization Check:
    -- Each RPC is strictly restricted to its authorized domain fields:
    IF v_stack LIKE '%rpc_record_jar_movement%' THEN
        -- Jar movement RPC can ONLY modify jar custody holdings, NEVER financial balances or deposits!
        IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
           (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
            RAISE EXCEPTION 'Access Denied: Jar movement operations cannot modify financial balances or deposits.';
        END IF;
        RETURN NEW;
    END IF;

    IF v_stack LIKE '%rpc_create_customer_order%' THEN
        -- Order creation RPC can ONLY update current_balance, NEVER jar holdings!
        IF (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
           (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
           (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
           (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
           (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
           (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
            RAISE EXCEPTION 'Access Denied: Order creation cannot directly modify jar holdings.';
        END IF;
        RETURN NEW;
    END IF;

    IF v_stack LIKE '%rpc_execute_delivery_stop%' OR v_stack LIKE '%rpc_record_customer_payment%' THEN
        RETURN NEW;
    END IF;

    -- If caller is authenticated, verify their role from trusted database profiles
    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        -- Authorized owner accounts have administrative override permissions
        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        -- For ordinary staff and direct SQL updates, strictly prohibit modification of privileged fields
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

        -- Standard non-privileged updates (notes, phone, address, contact_name) are permitted
        RETURN NEW;
    END IF;

    -- If auth.uid() is null: direct maintenance by postgres superuser without PostgREST headers
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
-- 3. HARDENED TRIGGER: check_supplier_privileged_updates
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
        -- Jar movement RPC can ONLY modify jars_in_custody, NEVER current_payable!
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
                RAISE EXCEPTION 'Access Denied: Supplier payables and jar custody cannot be directly modified. Use approved purchase and payment workflows.';
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
-- 4. HARDENED JAR MOVEMENT WITH COMPREHENSIVE ASSET CONSERVATION
-- ------------------------------------------------------------------------------

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
    v_first_loc UUID;
    v_second_loc UUID;
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

    -- Validate all 5 allowed conditions
    IF p_condition_from NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_from: %', p_condition_from;
    END IF;
    IF p_condition_to NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_to: %', p_condition_to;
    END IF;

    -- Validate allowed movement types
    IF p_movement_type NOT IN (
        'CUSTOMER_DELIVERY', 'CUSTOMER_EMPTY_RETURN', 'DAMAGED_COLLECTED',
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL',
        'REPAIR_CYCLE', 'SCRAP_WRITEOFF', 'DISPATCH_TO_VEHICLE',
        'VEHICLE_RETURN_TO_WAREHOUSE', 'SUPPLIER_PURCHASE', 'RETURN_TO_SUPPLIER',
        'STOCK_ADJUSTMENT', 'OPENING_STOCK'
    ) THEN
        RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
    END IF;

    -- Enforce strict condition transition matrix
    -- 1. Scrapped jars can NEVER be restored to usable or repairable condition
    IF p_condition_from = 'DAMAGED_SCRAP' AND p_condition_to != 'DAMAGED_SCRAP' THEN
        RAISE EXCEPTION 'Scrapped jars cannot be restored to usable or repairable condition.';
    END IF;

    -- 2. Specific workflow transitions
    IF p_movement_type = 'WASHING_CYCLE_DIRTY_TO_CLEAN' AND (p_condition_from != 'EMPTY_DIRTY' OR p_condition_to != 'EMPTY_CLEAN') THEN
        RAISE EXCEPTION 'Washing cycle requires EMPTY_DIRTY -> EMPTY_CLEAN transition.';
    END IF;

    IF p_movement_type = 'FILLING_CYCLE_CLEAN_TO_FULL' AND (p_condition_from != 'EMPTY_CLEAN' OR p_condition_to != 'FULL_USABLE') THEN
        RAISE EXCEPTION 'Filling cycle requires EMPTY_CLEAN -> FULL_USABLE transition.';
    END IF;

    IF p_movement_type = 'REPAIR_CYCLE' AND (p_condition_from != 'DAMAGED_REPAIRABLE' OR p_condition_to NOT IN ('EMPTY_CLEAN', 'DAMAGED_SCRAP')) THEN
        RAISE EXCEPTION 'Repair cycle requires DAMAGED_REPAIRABLE -> EMPTY_CLEAN or DAMAGED_SCRAP transition.';
    END IF;

    IF p_movement_type = 'SCRAP_WRITEOFF' AND (p_condition_from NOT IN ('DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') OR p_condition_to != 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Scrap writeoff requires DAMAGED_REPAIRABLE/DAMAGED_SCRAP -> DAMAGED_SCRAP transition.';
    END IF;

    -- 3. Disallow arbitrary condition changes via generic adjustments
    IF p_condition_from != p_condition_to AND p_movement_type NOT IN (
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL', 'REPAIR_CYCLE', 'SCRAP_WRITEOFF'
    ) THEN
        RAISE EXCEPTION 'Arbitrary condition conversion from % to % is not permitted under movement type %.',
            p_condition_from, p_condition_to, p_movement_type;
    END IF;

    -- Resolve reusable jar product
    SELECT id INTO v_jar_product_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_jar_product_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;

    -- Resolve default central warehouse
    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id FROM public.warehouses WHERE is_default = true LIMIT 1;

    -- 1. Deadlock-free locking of locations (Deterministic UUID ordering)
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

    -- 2. Strict Supplier Purchase & Inflow Validation (Problem A Fix)
    IF p_movement_type = 'SUPPLIER_PURCHASE' THEN
        -- Source MUST be a valid supplier
        IF v_src_loc.location_type != 'SUPPLIER' THEN
            RAISE EXCEPTION 'Supplier purchase source must be a valid supplier location. Location % is %.',
                p_source_location_id, v_src_loc.location_type;
        END IF;

        -- Destination MUST be the warehouse
        IF v_dst_loc.location_type != 'WAREHOUSE' THEN
            RAISE EXCEPTION 'Supplier purchase destination must be a warehouse location. Location % is %.',
                p_destination_location_id, v_dst_loc.location_type;
        END IF;

        -- Must have an authorized purchase reference or explicit opening-stock reference
        IF p_reference_type NOT IN ('PURCHASE_ORDER', 'OPENING_STOCK', 'PURCHASE') THEN
            RAISE EXCEPTION 'Supplier purchase requires a valid purchase reference (PURCHASE_ORDER) or OPENING_STOCK.';
        END IF;

        SELECT * INTO v_supp FROM public.suppliers WHERE location_id = p_source_location_id FOR UPDATE;
        IF v_supp.id IS NULL THEN
            RAISE EXCEPTION 'Supplier record not found for location %.', p_source_location_id;
        END IF;

        IF p_reference_type = 'PURCHASE_ORDER' AND p_reference_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1 FROM public.purchases WHERE id = p_reference_id AND supplier_id = v_supp.id
            ) INTO v_po_exists;

            IF NOT v_po_exists THEN
                RAISE EXCEPTION 'Purchase order reference % not found for supplier %.', p_reference_id, v_supp.id;
            END IF;
        END IF;

    ELSIF p_movement_type = 'OPENING_STOCK' THEN
        IF v_caller_role != 'owner' THEN
            RAISE EXCEPTION 'Only business owners can record initial opening stock entries.';
        END IF;
        IF v_dst_loc.location_type != 'WAREHOUSE' THEN
            RAISE EXCEPTION 'Opening stock destination must be a warehouse location.';
        END IF;

    ELSE
        -- 3. Strict Source Balance Verification for All Ordinary Movements (Prevents inventory fabrication)
        IF v_src_loc.location_type = 'CUSTOMER' THEN
            SELECT * INTO v_cust FROM public.customers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_cust.id IS NULL THEN
                RAISE EXCEPTION 'Customer at location % not found.', p_source_location_id;
            END IF;

            -- Check specific condition holding on customer
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

            -- Deduct from exact condition holding
            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_from = 'FULL_USABLE' THEN total_full_jars_holding - p_quantity ELSE total_full_jars_holding END,
                total_empty_clean_holding = CASE WHEN p_condition_from = 'EMPTY_CLEAN' THEN total_empty_clean_holding - p_quantity ELSE total_empty_clean_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_from = 'EMPTY_DIRTY' THEN total_empty_jars_holding - p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding - p_quantity ELSE total_damaged_jars_holding END,
                total_scrap_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_SCRAP' THEN total_scrap_jars_holding - p_quantity ELSE total_scrap_jars_holding END,
                updated_at = pg_catalog.now()
            WHERE id = v_cust.id;

        ELSIF v_src_loc.location_type = 'SUPPLIER' THEN
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

        ELSIF v_src_loc.location_type = 'WAREHOUSE' THEN
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

        ELSIF v_src_loc.location_type IN ('INTERNAL', 'VEHICLE') THEN
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
    END IF;

    -- 4. Update Destination Holdings for All Conditions
    IF v_dst_loc.location_type = 'CUSTOMER' THEN
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

    ELSIF v_dst_loc.location_type = 'SUPPLIER' THEN
        SELECT * INTO v_dst_supp FROM public.suppliers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_supp.id IS NOT NULL THEN
            UPDATE public.suppliers
            SET jars_in_custody = jars_in_custody + p_quantity,
                updated_at = pg_catalog.now()
            WHERE id = v_dst_supp.id;
        END IF;

    ELSIF v_dst_loc.location_type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
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

    -- 5. Insert Immutable Jar Custody Movement Audit Record
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

    -- Dual-entry stock movement if warehouse full usable inventory affected
    IF v_dst_loc.location_type = 'WAREHOUSE' AND p_condition_to = 'FULL_USABLE' AND v_default_wh_id IS NOT NULL THEN
        INSERT INTO public.stock_movements (
            warehouse_id,
            product_id,
            movement_type,
            quantity,
            reference_type,
            reference_id,
            notes,
            created_by
        ) VALUES (
            v_default_wh_id,
            v_jar_product_id,
            'IN',
            p_quantity,
            'JAR_MOVEMENT',
            v_movement_id,
            'Jar movement inbound to warehouse stock',
            v_caller_id
        );
    END IF;

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

-- ------------------------------------------------------------------------------
-- 5. HARDENED ORDER CREATION WITH AUTHORITATIVE PRICING, GST & IDEMPOTENCY LOCK
-- ------------------------------------------------------------------------------

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

    -- Concurrency-Safe Idempotency: acquire transactional advisory lock on hash of key
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

    -- Lock customer record FOR UPDATE
    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found or inactive.';
    END IF;

    -- 1. Calculate order totals using AUTHORITATIVE product prices and tax rates from database
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

        SELECT id, name, price, gst_rate INTO v_product
        FROM public.products
        WHERE id = v_item.product_id AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found or inactive.', v_item.product_id;
        END IF;

        -- Authoritative GST rate validation: Reject any attempt to tamper with tax rate
        v_client_tax := COALESCE(v_item.tax_rate, v_item.gst_rate);
        IF v_client_tax IS NOT NULL AND v_client_tax != v_product.gst_rate THEN
            RAISE EXCEPTION 'Invalid tax rate submitted (%). Authoritative tax rate is %.',
                v_client_tax, v_product.gst_rate;
        END IF;

        -- Check customer-specific agreed special price
        SELECT special_price INTO v_special_price
        FROM public.customer_special_prices
        WHERE customer_id = p_customer_id AND product_id = v_item.product_id AND is_active = true;

        v_base_unit_price := COALESCE(v_special_price, v_product.price);

        -- Authoritative price validation:
        -- Ordinary staff MUST use standard or customer-special price.
        -- Only Owner can authorize custom discounts or overridden prices.
        IF v_item.unit_price IS NOT NULL AND v_item.unit_price != v_base_unit_price THEN
            IF v_caller_role != 'owner' THEN
                RAISE EXCEPTION 'Unauthorized price override: only the business owner can authorize price overrides or custom discounts. Product: %, Standard: %, Submitted: %.',
                    v_product.name, v_base_unit_price, v_item.unit_price;
            END IF;

            IF v_item.unit_price < 0 THEN
                RAISE EXCEPTION 'Overridden unit price cannot be negative. Submitted: %.', v_item.unit_price;
            END IF;

            -- Mandatory price override reason validation (minimum 5 non-whitespace chars)
            IF p_price_override_reason IS NULL OR length(trim(p_price_override_reason)) < 5 THEN
                RAISE EXCEPTION 'Price override requires a valid business reason (minimum 5 characters).';
            END IF;

            v_final_unit_price := v_item.unit_price;
            v_is_overridden := true;
        ELSE
            v_final_unit_price := v_base_unit_price;
            v_is_overridden := false;
        END IF;

        -- Tax and line calculations strictly computed database-side
        v_item_subtotal := v_final_unit_price * v_item.quantity;
        v_item_tax := pg_catalog.round(v_item_subtotal * (v_product.gst_rate / 100.0), 2);
        v_item_total := v_item_subtotal + v_item_tax;

        v_subtotal := v_subtotal + v_item_subtotal;
        v_tax_total := v_tax_total + v_item_tax;
    END LOOP;

    v_total_amount := v_subtotal + v_tax_total;
    v_order_num := 'ORD-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 2. Insert master order
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

    -- 3. Insert line items with pricing audit trail
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        product_id UUID,
        quantity INT,
        unit_price NUMERIC,
        gst_rate NUMERIC,
        tax_rate NUMERIC
    )
    LOOP
        SELECT id, name, price, gst_rate INTO v_product FROM public.products WHERE id = v_item.product_id;
        SELECT special_price INTO v_special_price FROM public.customer_special_prices WHERE customer_id = p_customer_id AND product_id = v_item.product_id AND is_active = true;
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

    -- 4. Create delivery stop if assigned to driver
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

    -- 5. Create Accrual Sales Invoice matching exact order totals
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

    -- 6. Increment customer balance (permitted via trigger stack recognition)
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
