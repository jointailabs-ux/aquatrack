-- ==============================================================================
-- AquaTrack ERP — Migration: Round 7 Remediation
-- Version: 20261104000005_remediation_round_7.sql
-- Description:
--   1. Real Warehouse Identity: Enforce singleton canonical warehouse constraint
--      and reject any mismatched warehouse locations across all stock operations.
--   2. Scrap-Yard Stock Conservation: Prevent stock fabrication from SCRAP_YARD.
--      Every source location (WAREHOUSE, VEHICLE, CUSTOMER, SUPPLIER, SCRAP_YARD)
--      locks and validates available source balance before any outgoing movement.
--      Scrapped jars are strictly terminal.
--   3. Destination Relationship Validation: CUSTOMER and SUPPLIER destination
--      locations must reference real, active business records; transactions reject
--      with explicit exceptions instead of silently skipping balance updates.
--   4. Order Inventory Lifecycle & Reservation: rpc_create_customer_order locks
--      inventory_balances rows in deterministic order and reserves stock
--      (quantity_reserved) to prevent overselling. Delivery stop completion
--      deducts quantity_on_hand and releases quantity_reserved. Cancelled orders
--      release reserved inventory atomically.
--   5. Internal RPC Authorization & Trigger Security: Dedicated, non-accessible
--      table public.internal_rpc_auth_tokens tied to txid_current() and auth.uid()
--      with strict domain scoping. Completely prevents direct table bypass while
--      safely permitting authorized transactional RPCs.
--   6. Strict Supplier Purchase Validation: Mandatory purchase order reference,
--      supplier location matching, remaining receivable quantity limit enforcement,
--      and automatic PO status updates.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ENFORCE REAL WAREHOUSE IDENTITY (Singleton Database Enforcement)
-- ------------------------------------------------------------------------------

-- Ensure public.warehouses strictly enforces exactly one canonical central warehouse
CREATE UNIQUE INDEX IF NOT EXISTS uq_singleton_warehouse ON public.warehouses ((true));

ALTER TABLE public.warehouses DROP CONSTRAINT IF EXISTS chk_single_default_warehouse;
ALTER TABLE public.warehouses ADD CONSTRAINT chk_single_default_warehouse CHECK (is_default = true);

-- Ensure all custody condition balance columns exist on public.customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_damaged_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_damaged_jars_holding >= 0);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_empty_clean_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_empty_clean_holding >= 0);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_scrap_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_scrap_jars_holding >= 0);


-- ------------------------------------------------------------------------------
-- 2. INTERNAL RPC AUTHORIZATION INFRASTRUCTURE (Unforgeable Domain Tokens)
-- ------------------------------------------------------------------------------

-- Internal table to store transaction-scoped RPC execution tokens
-- Strictly inaccessible to ordinary callers (even authenticated) via direct PostgREST/SQL
CREATE TABLE IF NOT EXISTS public.internal_rpc_auth_tokens (
    token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    txid BIGINT NOT NULL,
    rpc_name VARCHAR(80) NOT NULL,
    authorized_user_id UUID NOT NULL,
    allowed_scope VARCHAR(80) NOT NULL, -- 'JAR_CUSTODY_ONLY', 'CUSTOMER_ORDER_BALANCE_ONLY', 'DELIVERY_STOP_EXECUTION', 'SUPPLIER_PAYABLE_ONLY'
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_internal_rpc_auth_txid ON public.internal_rpc_auth_tokens (txid, authorized_user_id);

-- Enforce RLS and revoke ALL direct access from public, anon, and authenticated roles
ALTER TABLE public.internal_rpc_auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_rpc_auth_tokens FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.internal_rpc_auth_tokens FROM PUBLIC, anon, authenticated;

-- Trusted helper to establish internal RPC authorization context
CREATE OR REPLACE FUNCTION public._internal_establish_rpc_context(
    p_rpc_name VARCHAR,
    p_allowed_scope VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller UUID;
    v_txid BIGINT;
BEGIN
    v_caller := auth.uid();
    IF v_caller IS NULL THEN
        -- Allow internal superuser / migration scripts executing without PostgREST headers
        IF current_setting('request.jwt.claim.sub', true) IS NULL AND
           current_setting('request.jwt.claim.role', true) IS NULL THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'Cannot establish internal RPC authorization context for unauthenticated caller.';
    END IF;

    v_txid := txid_current();

    -- Clean up any historical tokens older than 10 minutes
    DELETE FROM public.internal_rpc_auth_tokens WHERE created_at < clock_timestamp() - INTERVAL '10 minutes';

    INSERT INTO public.internal_rpc_auth_tokens (
        txid,
        rpc_name,
        authorized_user_id,
        allowed_scope
    ) VALUES (
        v_txid,
        p_rpc_name,
        v_caller,
        p_allowed_scope
    );
END;
$$;

REVOKE ALL ON FUNCTION public._internal_establish_rpc_context(VARCHAR, VARCHAR) FROM PUBLIC, anon, authenticated;

-- Trusted helper to clear internal RPC authorization context
CREATE OR REPLACE FUNCTION public._internal_clear_rpc_context()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    DELETE FROM public.internal_rpc_auth_tokens WHERE txid = txid_current();
END;
$$;

REVOKE ALL ON FUNCTION public._internal_clear_rpc_context() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. HARDENED TRIGGER: check_customer_privileged_updates
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
    v_auth_scope VARCHAR;
    v_auth_rpc VARCHAR;
BEGIN
    v_caller_id := auth.uid();

    -- Check for an active, unforgeable transaction token in internal_rpc_auth_tokens
    SELECT allowed_scope, rpc_name INTO v_auth_scope, v_auth_rpc
    FROM public.internal_rpc_auth_tokens
    WHERE txid = txid_current() AND authorized_user_id = v_caller_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_auth_scope IS NOT NULL THEN
        -- 1. JAR_CUSTODY_ONLY: Can ONLY modify jar custody holdings, NEVER financial balance or deposit!
        IF v_auth_scope = 'JAR_CUSTODY_ONLY' THEN
            IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
               (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
                RAISE EXCEPTION 'Access Denied: Jar custody operations cannot modify financial balances or deposits.';
            END IF;
            RETURN NEW;
        END IF;

        -- 2. CUSTOMER_ORDER_BALANCE_ONLY: Can ONLY update current_balance, NEVER jar holdings or deposit held!
        IF v_auth_scope = 'CUSTOMER_ORDER_BALANCE_ONLY' THEN
            IF (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
               (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
               (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
               (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
                RAISE EXCEPTION 'Access Denied: Customer order creation cannot modify jar holdings or deposit held.';
            END IF;
            RETURN NEW;
        END IF;

        -- 3. DELIVERY_STOP_EXECUTION: Permitted to update delivered custody holdings and route payments
        IF v_auth_scope = 'DELIVERY_STOP_EXECUTION' THEN
            RETURN NEW;
        END IF;
    END IF;

    -- If caller is authenticated, check their role in public.profiles
    IF v_caller_id IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.profiles
        WHERE id = v_caller_id AND is_active = true;

        -- Business owner accounts have administrative override permissions
        IF v_caller_role = 'owner' THEN
            RETURN NEW;
        END IF;

        -- For ordinary staff and direct table writes, strictly prohibit modification of privileged fields
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
               (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
               (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
               (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
                RAISE EXCEPTION 'Access Denied: Customer financial balances and jar holdings cannot be directly modified. Direct updates are prohibited.';
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
-- 4. HARDENED TRIGGER: check_supplier_privileged_updates
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
    v_auth_scope VARCHAR;
    v_auth_rpc VARCHAR;
BEGIN
    v_caller_id := auth.uid();

    SELECT allowed_scope, rpc_name INTO v_auth_scope, v_auth_rpc
    FROM public.internal_rpc_auth_tokens
    WHERE txid = txid_current() AND authorized_user_id = v_caller_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_auth_scope IS NOT NULL THEN
        -- 1. JAR_CUSTODY_ONLY: Can ONLY modify jars_in_custody, NEVER current_payable!
        IF v_auth_scope = 'JAR_CUSTODY_ONLY' THEN
            IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) THEN
                RAISE EXCEPTION 'Access Denied: Jar custody operations cannot modify supplier payable balances.';
            END IF;
            RETURN NEW;
        END IF;

        -- 2. PURCHASE_RECEIPT: Can modify jars_in_custody and current_payable atomically
        IF v_auth_scope = 'PURCHASE_RECEIPT' THEN
            RETURN NEW;
        END IF;
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
-- 5. HARDENED JAR MOVEMENT RPC (rpc_record_jar_movement)
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
    v_avail_scrapyr_cond INT := 0;
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

    -- Staff authorization: only owner, warehouse staff, or delivery drivers
    IF v_caller_role != 'owner' AND 
       (v_perms->>'can_warehouse')::boolean != true AND
       (v_perms->>'can_deliveries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have jar movement authority.';
    END IF;

    -- Strict non-negative, non-zero quantity validation
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero. Submitted: %.', p_quantity;
    END IF;

    -- Validate all 5 allowed physical jar conditions
    IF p_condition_from NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_from: %', p_condition_from;
    END IF;
    IF p_condition_to NOT IN ('FULL_USABLE', 'EMPTY_CLEAN', 'EMPTY_DIRTY', 'DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Invalid condition_to: %', p_condition_to;
    END IF;

    -- Validate supported movement types
    IF p_movement_type NOT IN (
        'CUSTOMER_DELIVERY', 'CUSTOMER_EMPTY_RETURN', 'DAMAGED_COLLECTED',
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL',
        'REPAIR_CYCLE', 'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT',
        'DISPATCH_TO_VEHICLE', 'VEHICLE_RETURN_TO_WAREHOUSE',
        'SUPPLIER_PURCHASE', 'RETURN_TO_SUPPLIER', 'OPENING_STOCK'
    ) THEN
        RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
    END IF;

    -- Strict condition transition matrix:
    -- 1. Scrapped jars are terminal: can NEVER be restored to usable or repairable condition
    IF p_condition_from = 'DAMAGED_SCRAP' AND p_condition_to != 'DAMAGED_SCRAP' THEN
        RAISE EXCEPTION 'Scrapped jars cannot be restored to usable or repairable condition. Scrap is terminal.';
    END IF;

    -- 2. Washing cycle requires dirty -> clean
    IF p_movement_type = 'WASHING_CYCLE_DIRTY_TO_CLEAN' THEN
        IF p_condition_from != 'EMPTY_DIRTY' OR p_condition_to != 'EMPTY_CLEAN' THEN
            RAISE EXCEPTION 'Washing cycle requires EMPTY_DIRTY -> EMPTY_CLEAN transition.';
        END IF;
    END IF;

    -- 3. Filling cycle requires clean -> full
    IF p_movement_type = 'FILLING_CYCLE_CLEAN_TO_FULL' THEN
        IF p_condition_from != 'EMPTY_CLEAN' OR p_condition_to != 'FULL_USABLE' THEN
            RAISE EXCEPTION 'Filling cycle requires EMPTY_CLEAN -> FULL_USABLE transition.';
        END IF;
    END IF;

    -- 4. Repair cycle requires repairable -> clean or scrap
    IF p_movement_type = 'REPAIR_CYCLE' THEN
        IF p_condition_from != 'DAMAGED_REPAIRABLE' OR p_condition_to NOT IN ('EMPTY_CLEAN', 'DAMAGED_SCRAP') THEN
            RAISE EXCEPTION 'Repair cycle requires DAMAGED_REPAIRABLE -> EMPTY_CLEAN or DAMAGED_SCRAP transition.';
        END IF;
    END IF;

    -- 5. Scrap write-off requires terminal scrap destination and owner authorization
    IF p_movement_type = 'SCRAP_WRITEOFF' THEN
        IF v_caller_role != 'owner' THEN
            RAISE EXCEPTION 'Only the business owner can authorize scrap write-off entries.';
        END IF;
        IF p_condition_from NOT IN ('DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') OR p_condition_to != 'DAMAGED_SCRAP' THEN
            RAISE EXCEPTION 'Scrap writeoff requires DAMAGED_REPAIRABLE/DAMAGED_SCRAP -> DAMAGED_SCRAP transition.';
        END IF;
    END IF;

    -- 6. Disallow condition changes on ordinary movements (asset conservation invariant)
    IF p_condition_from != p_condition_to AND p_movement_type NOT IN (
        'WASHING_CYCLE_DIRTY_TO_CLEAN', 'FILLING_CYCLE_CLEAN_TO_FULL', 'REPAIR_CYCLE', 'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT'
    ) THEN
        RAISE EXCEPTION 'Condition transition from % to % is not permitted under movement type %.',
            p_condition_from, p_condition_to, p_movement_type;
    END IF;

    -- 7. Disallow arbitrary condition jumping through generic adjustments
    IF p_movement_type = 'INTERNAL_ADJUSTMENT' AND p_condition_from != p_condition_to THEN
        IF NOT (p_condition_from = 'DAMAGED_REPAIRABLE' AND p_condition_to IN ('EMPTY_CLEAN', 'DAMAGED_SCRAP')) THEN
            RAISE EXCEPTION 'Internal adjustment cannot perform arbitrary condition conversion from % to %.',
                p_condition_from, p_condition_to;
        END IF;
    END IF;

    -- Resolve reusable jar product
    SELECT id INTO v_jar_product_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_jar_product_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;

    -- Resolve canonical single warehouse
    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id 
    FROM public.warehouses 
    WHERE is_default = true 
    LIMIT 1;

    IF v_default_wh_id IS NULL OR v_wh_location_id IS NULL THEN
        RAISE EXCEPTION 'Default central warehouse configuration is missing.';
    END IF;

    -- 1. Deadlock-free locking of physical locations (Deterministic UUID ordering)
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

    -- 2. Enforce Real Warehouse Identity (Reject arbitrary second warehouse locations)
    IF v_src_loc.type = 'WAREHOUSE' AND p_source_location_id != v_wh_location_id THEN
        RAISE EXCEPTION 'Invalid warehouse location: % does not match the canonical central warehouse location (%).',
            p_source_location_id, v_wh_location_id;
    END IF;
    IF v_dst_loc.type = 'WAREHOUSE' AND p_destination_location_id != v_wh_location_id THEN
        RAISE EXCEPTION 'Invalid warehouse location: % does not match the canonical central warehouse location (%).',
            p_destination_location_id, v_wh_location_id;
    END IF;

    -- Establish internal unforgeable token for authorized trigger updates
    PERFORM public._internal_establish_rpc_context('rpc_record_jar_movement', 'JAR_CUSTODY_ONLY');

    -- 3. Strict Supplier Purchase & Inflow Validation
    IF p_movement_type = 'SUPPLIER_PURCHASE' THEN
        IF v_src_loc.type != 'SUPPLIER' THEN
            RAISE EXCEPTION 'Supplier purchase source must be a supplier location. Location % is %.',
                p_source_location_id, v_src_loc.type;
        END IF;

        IF v_dst_loc.type != 'WAREHOUSE' THEN
            RAISE EXCEPTION 'Supplier purchase destination must be the central warehouse. Location % is %.',
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

        -- Check remaining receivable quantity on purchase order item
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

        -- Update purchase order item received count
        UPDATE public.purchase_items
        SET quantity_received = quantity_received + p_quantity
        WHERE id = v_po_item.id;

        -- If all items fully received, mark purchase order as RECEIVED
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
        -- 4. Authoritative Source Balance Verification for ALL 5 Location Types (Prevents Stock Fabrication)
        IF v_src_loc.type = 'CUSTOMER' THEN
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

        ELSIF v_src_loc.type = 'SCRAP_YARD' THEN
            -- Strictly validate available stock in scrap yard (no stock fabrication)
            IF p_condition_from != 'DAMAGED_SCRAP' THEN
                RAISE EXCEPTION 'Scrap yard only holds DAMAGED_SCRAP jars. Requested condition: %.', p_condition_from;
            END IF;

            SELECT COALESCE(
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE destination_location_id = p_source_location_id AND condition_to = 'DAMAGED_SCRAP')
                -
                (SELECT SUM(quantity) FROM public.jar_custody_movements WHERE source_location_id = p_source_location_id AND condition_from = 'DAMAGED_SCRAP'),
                0
            ) INTO v_avail_scrapyr_cond;

            IF v_avail_scrapyr_cond < p_quantity THEN
                RAISE EXCEPTION 'Scrap yard has insufficient % jars. Available: %, Requested: %.', p_condition_from, v_avail_scrapyr_cond, p_quantity;
            END IF;
        END IF;

        -- Normalize reference type for ordinary movements
        v_inserted_ref_type := CASE
            WHEN p_reference_type IN ('PURCHASE_ORDER', 'PURCHASE') THEN 'PURCHASE'
            WHEN p_reference_type IN ('ORDER') THEN 'ORDER'
            WHEN p_reference_type IN ('DELIVERY_STOP', 'DELIVERY') THEN 'DELIVERY_STOP'
            WHEN p_reference_type IN ('BATCH_WASH') THEN 'BATCH_WASH'
            WHEN p_reference_type IN ('AUDIT') THEN 'AUDIT'
            ELSE NULL
        END;
    END IF;

    -- 5. Mandatory Destination Relationship Validation (Never silently skip balance updates)
    IF v_dst_loc.type = 'CUSTOMER' THEN
        SELECT * INTO v_dst_cust FROM public.customers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_cust.id IS NULL THEN
            RAISE EXCEPTION 'Destination customer record not found for location %. Balance update cannot be skipped.',
                p_destination_location_id;
        END IF;

        UPDATE public.customers
        SET total_full_jars_holding = CASE WHEN p_condition_to = 'FULL_USABLE' THEN total_full_jars_holding + p_quantity ELSE total_full_jars_holding END,
            total_empty_clean_holding = CASE WHEN p_condition_to = 'EMPTY_CLEAN' THEN total_empty_clean_holding + p_quantity ELSE total_empty_clean_holding END,
            total_empty_jars_holding = CASE WHEN p_condition_to = 'EMPTY_DIRTY' THEN total_empty_jars_holding + p_quantity ELSE total_empty_jars_holding END,
            total_damaged_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding + p_quantity ELSE total_damaged_jars_holding END,
            total_scrap_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_SCRAP' THEN total_scrap_jars_holding + p_quantity ELSE total_scrap_jars_holding END,
            updated_at = pg_catalog.now()
        WHERE id = v_dst_cust.id;

    ELSIF v_dst_loc.type = 'SUPPLIER' THEN
        SELECT * INTO v_dst_supp FROM public.suppliers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_supp.id IS NULL THEN
            RAISE EXCEPTION 'Destination supplier record not found for location %. Balance update cannot be skipped.',
                p_destination_location_id;
        END IF;

        UPDATE public.suppliers
        SET jars_in_custody = jars_in_custody + p_quantity,
            updated_at = pg_catalog.now()
        WHERE id = v_dst_supp.id;

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

    ELSIF v_dst_loc.type = 'SCRAP_YARD' THEN
        IF p_condition_to != 'DAMAGED_SCRAP' THEN
            RAISE EXCEPTION 'Destination scrap yard only accepts DAMAGED_SCRAP condition. Received: %.', p_condition_to;
        END IF;
    END IF;

    -- 6. Insert into jar_custody_movements (Mapping to Accepted Foundation Check Constraints)
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
        COALESCE(p_notes, 'Round 7 jar custody movement'),
        v_caller_id
    ) RETURNING id INTO v_movement_id;

    -- 7. Dual-Entry Stock Movements Ledger Update (Preserving Physical Stock Movements Invariant)
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
            COALESCE(p_notes, 'Round 7 stock ledger movement'),
            v_caller_id
        );
    END IF;

    -- Clear transaction context before returning
    PERFORM public._internal_clear_rpc_context();

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
-- 6. HARDENED ORDER CREATION RPC (rpc_create_customer_order with Inventory Reservation)
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
    v_default_wh_id UUID;
    v_wh_location_id UUID;
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
    v_inv RECORD;
    v_avail_stock INT;
    v_req_item RECORD;
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

    -- Resolve canonical warehouse
    SELECT id, location_id INTO v_default_wh_id, v_wh_location_id 
    FROM public.warehouses 
    WHERE is_default = true 
    LIMIT 1;

    IF v_default_wh_id IS NULL OR v_wh_location_id IS NULL THEN
        RAISE EXCEPTION 'Canonical warehouse configuration is missing.';
    END IF;

    v_target_date := COALESCE(p_delivery_date, CURRENT_DATE);

    -- Lock customer record FOR UPDATE
    SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found or inactive.';
    END IF;

    -- 1. DETERMINISTIC INVENTORY ROW LOCKING & AVAILABILITY VALIDATION (Part 5)
    -- Group requested quantities by product_id to handle multiple line items of same SKU
    FOR v_req_item IN 
        SELECT (x.product_id)::UUID as product_id, SUM(x.quantity)::INT as total_req_qty
        FROM jsonb_to_recordset(p_items) AS x(product_id UUID, quantity INT)
        GROUP BY x.product_id
        ORDER BY x.product_id ASC
    LOOP
        IF v_req_item.total_req_qty <= 0 THEN
            RAISE EXCEPTION 'Quantity for product % must be greater than zero.', v_req_item.product_id;
        END IF;

        -- Deterministically lock warehouse inventory row FOR UPDATE
        SELECT * INTO v_inv
        FROM public.inventory_balances
        WHERE warehouse_id = v_default_wh_id AND product_id = v_req_item.product_id
        FOR UPDATE;

        IF NOT FOUND THEN
            -- If no inventory record exists, available stock is 0
            SELECT name INTO v_product FROM public.products WHERE id = v_req_item.product_id;
            RAISE EXCEPTION 'Insufficient available inventory for product "%". Requested: %, Available: 0 (No warehouse stock record).',
                COALESCE(v_product.name, v_req_item.product_id::text), v_req_item.total_req_qty;
        END IF;

        v_avail_stock := v_inv.quantity_on_hand - v_inv.quantity_reserved;
        IF v_avail_stock < v_req_item.total_req_qty THEN
            SELECT name INTO v_product FROM public.products WHERE id = v_req_item.product_id;
            RAISE EXCEPTION 'Insufficient available inventory for product "%". Requested: %, Available: % (On-hand: %, Reserved: %).',
                COALESCE(v_product.name, v_req_item.product_id::text), v_req_item.total_req_qty, v_avail_stock, v_inv.quantity_on_hand, v_inv.quantity_reserved;
        END IF;

        -- Atomically reserve inventory to prevent concurrent orders from overselling
        UPDATE public.inventory_balances
        SET quantity_reserved = quantity_reserved + v_req_item.total_req_qty,
            updated_at = pg_catalog.now()
        WHERE id = v_inv.id;
    END LOOP;

    -- 2. Calculate order totals using authoritative pricing and GST configuration
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
        WHERE id = v_item.product_id AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found or inactive.', v_item.product_id;
        END IF;

        -- Authoritative GST rate validation
        v_client_tax := COALESCE(v_item.tax_rate, v_item.gst_rate);
        IF v_client_tax IS NOT NULL AND v_client_tax != v_product.gst_rate THEN
            RAISE EXCEPTION 'Invalid tax rate submitted (%). Authoritative tax rate is %.',
                v_client_tax, v_product.gst_rate;
        END IF;

        -- Active date-range special price
        SELECT special_price INTO v_special_price
        FROM public.customer_special_prices
        WHERE customer_id = p_customer_id 
          AND product_id = v_item.product_id 
          AND effective_from <= v_target_date
          AND (effective_to IS NULL OR effective_to >= v_target_date)
        ORDER BY effective_from DESC
        LIMIT 1;

        v_base_unit_price := COALESCE(v_special_price, v_product.default_sale_price);

        -- Owner-only price overrides with mandatory reason validation
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

    -- 3. Insert master order record
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

    -- 4. Insert line items with pricing audit trail
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

    -- 5. Create delivery stop if assigned to driver
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

    -- 6. Create Accrual Sales Invoice matching exact order totals
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

    -- 7. Establish internal RPC context for customer balance update
    PERFORM public._internal_establish_rpc_context('rpc_create_customer_order', 'CUSTOMER_ORDER_BALANCE_ONLY');

    UPDATE public.customers
    SET current_balance = current_balance + v_total_amount,
        updated_at = pg_catalog.now()
    WHERE id = p_customer_id;

    -- Clear context
    PERFORM public._internal_clear_rpc_context();

    -- 8. Balanced Financial Ledger Accrual Entries
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

-- ------------------------------------------------------------------------------
-- 7. HARDENED DELIVERY EXECUTION RPC (rpc_execute_delivery_stop)
-- ------------------------------------------------------------------------------

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
    v_item RECORD;
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

    -- Lock delivery stop row FOR UPDATE
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

    -- Resolve canonical warehouse
    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL OR v_wh_location IS NULL THEN
        RAISE EXCEPTION 'Canonical warehouse configuration is missing.';
    END IF;

    -- Lock parent order and customer records FOR UPDATE
    SELECT * INTO v_order FROM public.orders WHERE id = v_stop.order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent order % not found.', v_stop.order_id;
    END IF;

    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer % not found.', v_order.customer_id;
    END IF;

    -- Handle explicit failure report: release reserved inventory for order items if stop cancelled/failed
    IF p_failure_reason IS NOT NULL AND p_actual_delivered = 0 THEN
        UPDATE public.delivery_stops
        SET status = 'FAILED',
            failure_reason = p_failure_reason,
            executed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_stop_id;

        -- Release reserved stock back to available pool
        FOR v_item IN SELECT * FROM public.order_items WHERE order_id = v_order.id
        LOOP
            UPDATE public.inventory_balances
            SET quantity_reserved = pg_catalog.greatest(0, quantity_reserved - v_item.quantity),
                updated_at = pg_catalog.now()
            WHERE warehouse_id = v_default_wh AND product_id = v_item.product_id;
        END LOOP;

        UPDATE public.orders
        SET status = 'CANCELLED',
            updated_at = pg_catalog.now()
        WHERE id = v_order.id;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'FAILED');
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

    SELECT id INTO v_default_jar_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;
    IF v_default_jar_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;

    -- 3. Physical Jar Custody Conservation & Validation
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

    -- Update customer holdings
    UPDATE public.customers
    SET total_full_jars_holding = v_new_full_holding,
        total_empty_jars_holding = v_new_empty_holding,
        total_damaged_jars_holding = v_new_damaged_holding,
        updated_at = pg_catalog.now()
    WHERE id = v_customer.id;

    -- 4. Deduct Inventory Balances and Release Reservation (Part 5 Single Inventory Lifecycle)
    IF p_actual_delivered > 0 THEN
        -- Deduct delivered stock from on_hand and release from quantity_reserved
        UPDATE public.inventory_balances
        SET quantity_on_hand = pg_catalog.greatest(0, quantity_on_hand - p_actual_delivered),
            quantity_reserved = pg_catalog.greatest(0, quantity_reserved - p_actual_delivered),
            updated_at = pg_catalog.now()
        WHERE warehouse_id = v_default_wh AND product_id = v_default_jar_id;

        -- Record stock movement
        INSERT INTO public.stock_movements (
            product_id,
            source_location_id,
            destination_location_id,
            quantity,
            movement_type,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_default_jar_id,
            v_wh_location,
            v_customer.location_id,
            p_actual_delivered,
            'DELIVERY_DISPATCH',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );

        -- Record jar custody movements
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

    -- Clear internal auth token
    PERFORM public._internal_clear_rpc_context();

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
-- 8. ORDER CANCELLATION RPC (rpc_cancel_customer_order with Reservation Release)
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

    -- Lock order row FOR UPDATE
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found.', p_order_id;
    END IF;

    IF v_order.status IN ('DELIVERED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Order % cannot be cancelled in "%" status.', p_order_id, v_order.status;
    END IF;

    -- Resolve canonical warehouse
    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;

    -- Calculate previously delivered quantity
    SELECT COALESCE(SUM(actual_delivered_quantity), 0) INTO v_delivered_qty
    FROM public.delivery_stops
    WHERE order_id = v_order.id AND status = 'COMPLETED';

    -- 1. Atomically release reserved inventory for undelivered items
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

    -- 2. Mark order and pending stops as CANCELLED
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

    -- 3. Adjust customer accounts receivable balance if invoice was unpaid
    SELECT * INTO v_invoice FROM public.invoices WHERE order_id = v_order.id LIMIT 1;
    IF v_invoice.id IS NOT NULL AND v_invoice.status = 'UNPAID' THEN
        PERFORM public._internal_establish_rpc_context('rpc_cancel_customer_order', 'CUSTOMER_ORDER_BALANCE_ONLY');

        UPDATE public.customers
        SET current_balance = pg_catalog.greatest(0.00, current_balance - v_invoice.balance_due),
            updated_at = pg_catalog.now()
        WHERE id = v_order.customer_id;

        PERFORM public._internal_clear_rpc_context();

        UPDATE public.invoices
        SET status = 'CANCELLED',
            balance_due = 0.00,
            updated_at = pg_catalog.now()
        WHERE id = v_invoice.id;
    END IF;

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
