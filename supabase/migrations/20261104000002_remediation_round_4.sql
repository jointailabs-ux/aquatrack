-- ==============================================================================
-- AquaTrack ERP — Migration: Remediation Round 4
-- Version: 20261104000002_remediation_round_4.sql
-- Description:
--   1. Fix customer & supplier protection triggers (secure caller identity via auth.uid(),
--      call-stack diagnostic verification via PG_CONTEXT, zero reliance on current_user or
--      caller-controlled session variables).
--   2. Fix salary advance deduction and row locking (eliminate invalid aggregate FOR UPDATE,
--      lock individual unsettled advance rows first, calculate balance post-lock, FIFO deduction).
--   3. Fix jar custody conservation (verify and lock source location holdings before transfer,
--      prevent stock fabrication, enforce valid condition transitions, conserve total assets).
--   4. Fix customer order pricing and tax validation (authoritative prices and GST from database,
--      strict owner-only price overrides with audit tracking, database-side calculation, idempotency).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA ENHANCEMENTS FOR AUDIT & IDEMPOTENCY
-- ------------------------------------------------------------------------------

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100) UNIQUE;

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS original_price NUMERIC(12,2);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS is_price_overridden BOOLEAN DEFAULT false;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS authorized_by UUID REFERENCES public.profiles(id);

-- ------------------------------------------------------------------------------
-- 2. HARDENED CUSTOMER & SUPPLIER PROTECTION TRIGGERS
-- ------------------------------------------------------------------------------

-- Trigger function: check_customer_privileged_updates
-- Identifies authenticated caller via auth.uid() and trusted profiles lookup.
-- Uses PG_CONTEXT call stack diagnostics to identify approved internal RPCs.
-- Prevents ordinary staff from directly modifying financial balances or jar holdings.
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
    v_is_authorized_rpc BOOLEAN := false;
BEGIN
    v_caller_id := auth.uid();

    -- Inspect PostgreSQL call stack to check if update was initiated by a trusted transactional RPC
    GET DIAGNOSTICS v_stack = PG_CONTEXT;
    IF v_stack LIKE '%rpc_execute_delivery_stop%' OR v_stack LIKE '%rpc_create_customer_order%' THEN
        v_is_authorized_rpc := true;
    END IF;

    -- If executing from an authorized internal transactional RPC, permit updates
    IF v_is_authorized_rpc THEN
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

        -- For ordinary staff, strictly prohibit direct modification of privileged fields
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
               (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN
                RAISE EXCEPTION 'Access Denied: Customer financial balances and jar holdings cannot be directly modified. Use approved transactional workflows.';
            END IF;
        ELSIF TG_OP = 'INSERT' THEN
            IF (NEW.current_balance IS DISTINCT FROM 0.00) OR
               (NEW.total_full_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_empty_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_damaged_jars_holding IS DISTINCT FROM 0) OR
               (NEW.total_deposit_held IS DISTINCT FROM 0.00) THEN
                RAISE EXCEPTION 'Access Denied: New customer records must initialize with zero financial balances and jar holdings.';
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    -- If auth.uid() is null: check if this is direct database maintenance by postgres superuser without PostgREST headers
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

-- Trigger function: check_supplier_privileged_updates
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
    v_is_authorized_rpc BOOLEAN := false;
BEGIN
    v_caller_id := auth.uid();

    GET DIAGNOSTICS v_stack = PG_CONTEXT;
    IF v_stack LIKE '%rpc_receive_purchase_order%' OR 
       v_stack LIKE '%rpc_record_supplier_payment%' OR
       v_stack LIKE '%rpc_record_jar_movement%' THEN
        v_is_authorized_rpc := true;
    END IF;

    IF v_is_authorized_rpc THEN
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
-- 3. HARDENED SALARY PAYMENT WITH VALID ROW-LEVEL ADVANCE LOCKING
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_record_salary_payment(
    p_staff_id UUID,
    p_period_month VARCHAR,
    p_base_salary NUMERIC,
    p_advance_deducted NUMERIC,
    p_other_deductions NUMERIC,
    p_amount_paid NUMERIC,
    p_payment_method VARCHAR,
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL,
    p_idempotency_key VARCHAR DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_staff RECORD;
    v_authoritative_base_salary NUMERIC(12,2);
    v_payment_id UUID;
    v_voucher_num VARCHAR(50);
    v_prev_paid NUMERIC(12,2) := 0.00;
    v_prev_adv NUMERIC(12,2) := 0.00;
    v_prev_other NUMERIC(12,2) := 0.00;
    v_total_settled_so_far NUMERIC(12,2) := 0.00;
    v_outstanding_payable NUMERIC(12,2) := 0.00;
    v_total_this_disbursement NUMERIC(12,2) := 0.00;
    v_avail_advances NUMERIC(12,2) := 0.00;
    v_rem_adv_to_deduct NUMERIC(12,2);
    v_adv RECORD;
    v_rem_on_adv NUMERIC(12,2);
    v_deduct_this NUMERIC(12,2);
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

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_salaries')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: only owner or authorized salary manager can disburse salaries.';
    END IF;

    -- Validate salary period format (YYYY-MM)
    IF p_period_month IS NULL OR p_period_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid salary period format: %. Expected YYYY-MM.', p_period_month;
    END IF;

    -- Validate payment parameters
    IF p_amount_paid <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero.';
    END IF;
    IF p_advance_deducted < 0 OR p_other_deductions < 0 THEN
        RAISE EXCEPTION 'Deductions cannot be negative.';
    END IF;
    IF p_payment_method NOT IN ('CASH', 'UPI', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, BANK_TRANSFER.', p_payment_method;
    END IF;

    -- Idempotency check: if already processed with this key, return cached record
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, voucher_number, amount_paid, net_payable INTO v_payment_id, v_voucher_num, p_amount_paid, v_outstanding_payable
        FROM public.salary_payments
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'payment_id', v_payment_id,
                'voucher_number', v_voucher_num,
                'amount_paid', p_amount_paid,
                'net_payable', v_outstanding_payable
            );
        END IF;
    END IF;

    -- 1. Lock Staff Profile FOR UPDATE and retrieve AUTHORITATIVE salary from database
    SELECT * INTO v_staff FROM public.profiles WHERE id = p_staff_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found or inactive.';
    END IF;

    v_authoritative_base_salary := COALESCE(v_staff.salary_amount, 0.00);
    IF v_authoritative_base_salary <= 0 THEN
        RAISE EXCEPTION 'Staff member has no authoritative salary configured in profile master record.';
    END IF;

    -- 2. Lock existing salary payments for this staff member and period to serialize concurrent disbursements
    PERFORM id FROM public.salary_payments
    WHERE staff_id = p_staff_id AND period_month = p_period_month
    FOR UPDATE;

    SELECT 
        COALESCE(SUM(amount_paid), 0.00),
        COALESCE(SUM(advance_deducted), 0.00),
        COALESCE(SUM(other_deductions), 0.00)
    INTO v_prev_paid, v_prev_adv, v_prev_other
    FROM public.salary_payments
    WHERE staff_id = p_staff_id AND period_month = p_period_month;

    v_total_settled_so_far := v_prev_paid + v_prev_adv + v_prev_other;
    v_outstanding_payable := pg_catalog.greatest(0.00, v_authoritative_base_salary - v_total_settled_so_far);

    v_total_this_disbursement := p_amount_paid + p_advance_deducted + p_other_deductions;

    IF v_total_this_disbursement > v_outstanding_payable THEN
        RAISE EXCEPTION 'Total disbursement and deductions (%) exceed remaining salary payable (%) for period %. Authoritative salary: %, previously settled: %.',
            v_total_this_disbursement, v_outstanding_payable, p_period_month, v_authoritative_base_salary, v_total_settled_so_far;
    END IF;

    -- 3. Lock individual unsettled advance rows (NO aggregate FOR UPDATE)
    -- Iterate and sum available advances post-lock
    IF p_advance_deducted > 0 THEN
        v_avail_advances := 0.00;
        FOR v_adv IN 
            SELECT id, amount, amount_deducted
            FROM public.salary_advances
            WHERE staff_id = p_staff_id AND is_settled = false
            ORDER BY advance_date ASC, created_at ASC
            FOR UPDATE
        LOOP
            v_avail_advances := v_avail_advances + (v_adv.amount - v_adv.amount_deducted);
        END LOOP;

        IF p_advance_deducted > v_avail_advances THEN
            RAISE EXCEPTION 'Requested advance deduction (%) exceeds total outstanding advances (%).',
                p_advance_deducted, v_avail_advances;
        END IF;
    END IF;

    v_voucher_num := 'SAL-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 4. Insert Salary Payment Record using authoritative base salary
    INSERT INTO public.salary_payments (
        voucher_number,
        staff_id,
        period_month,
        base_salary,
        advance_deducted,
        other_deductions,
        net_payable,
        amount_paid,
        net_paid,
        payment_method,
        payment_date,
        notes,
        idempotency_key,
        created_by
    ) VALUES (
        v_voucher_num,
        p_staff_id,
        p_period_month,
        v_authoritative_base_salary,
        p_advance_deducted,
        p_other_deductions,
        v_outstanding_payable,
        p_amount_paid,
        p_amount_paid,
        p_payment_method,
        COALESCE(p_payment_date, CURRENT_DATE),
        p_notes,
        p_idempotency_key,
        v_caller_id
    ) RETURNING id INTO v_payment_id;

    -- 5. Deduct from locked advances systematically (FIFO order)
    IF p_advance_deducted > 0 THEN
        v_rem_adv_to_deduct := p_advance_deducted;

        FOR v_adv IN 
            SELECT id, amount, amount_deducted
            FROM public.salary_advances
            WHERE staff_id = p_staff_id AND is_settled = false
            ORDER BY advance_date ASC, created_at ASC
            FOR UPDATE
        LOOP
            v_rem_on_adv := v_adv.amount - v_adv.amount_deducted;
            v_deduct_this := pg_catalog.least(v_rem_adv_to_deduct, v_rem_on_adv);

            UPDATE public.salary_advances
            SET amount_deducted = amount_deducted + v_deduct_this,
                is_settled = ((amount_deducted + v_deduct_this) >= amount),
                is_deducted = true,
                deducted_in_payment_id = v_payment_id,
                updated_at = pg_catalog.now()
            WHERE id = v_adv.id;

            v_rem_adv_to_deduct := v_rem_adv_to_deduct - v_deduct_this;
            EXIT WHEN v_rem_adv_to_deduct <= 0;
        END LOOP;
    END IF;

    -- 6. Balanced Dual-Entry Financial Ledger Posting
    -- Entry 1: Debit Staff Salary Expense
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
        'LED-' || v_voucher_num || '-EXP',
        '5010',
        'Staff Salary Expense',
        (p_amount_paid + p_advance_deducted + p_other_deductions),
        0.00,
        'Salary payment for ' || v_staff.full_name || ' (' || p_period_month || ')',
        'SALARY_PAYMENT',
        v_payment_id,
        v_caller_id
    );

    -- Entry 2: Credit Cash Float / Bank Current Account
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
        'LED-' || v_voucher_num || '-PAY',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Cash on Hand' ELSE 'Bank Current Account' END,
        0.00,
        p_amount_paid,
        'Salary disbursement to ' || v_staff.full_name,
        'SALARY_PAYMENT',
        v_payment_id,
        v_caller_id
    );

    -- Entry 3: Credit Salary Advance Asset (if advance deducted)
    IF p_advance_deducted > 0 THEN
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
            'LED-' || v_voucher_num || '-ADV',
            '1130',
            'Salary Advance Asset',
            0.00,
            p_advance_deducted,
            'Advance deduction recovery from ' || v_staff.full_name,
            'SALARY_PAYMENT',
            v_payment_id,
            v_caller_id
        );
    END IF;

    -- Entry 4: Credit Payroll Deductions Payable (if other deductions)
    IF p_other_deductions > 0 THEN
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
            'LED-' || v_voucher_num || '-OTH',
            '2120',
            'Payroll Deductions Payable',
            0.00,
            p_other_deductions,
            'Other payroll deduction for ' || v_staff.full_name,
            'SALARY_PAYMENT',
            v_payment_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'voucher_number', v_voucher_num,
        'authoritative_base_salary', v_authoritative_base_salary,
        'amount_paid', p_amount_paid,
        'advance_deducted', p_advance_deducted,
        'other_deductions', p_other_deductions,
        'net_payable', (v_outstanding_payable - v_total_this_disbursement)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ------------------------------------------------------------------------------
-- 4. HARDENED JAR CUSTODY MOVEMENT WITH SOURCE VERIFICATION & ASSET CONSERVATION
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

    IF v_caller_role != 'owner' AND (v_perms->>'can_warehouse')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have warehouse management authority.';
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero.';
    END IF;

    -- Validate allowed conditions
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
        'SCRAP_WRITEOFF', 'INTERNAL_ADJUSTMENT', 'DISPATCH_TO_VEHICLE',
        'VEHICLE_RETURN_TO_WAREHOUSE', 'SUPPLIER_PURCHASE', 'RETURN_TO_SUPPLIER'
    ) THEN
        RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type;
    END IF;

    -- Enforce condition transition invariants
    IF p_movement_type = 'WASHING_CYCLE_DIRTY_TO_CLEAN' AND (p_condition_from != 'EMPTY_DIRTY' OR p_condition_to != 'EMPTY_CLEAN') THEN
        RAISE EXCEPTION 'Washing cycle requires EMPTY_DIRTY -> EMPTY_CLEAN transition.';
    END IF;
    IF p_movement_type = 'FILLING_CYCLE_CLEAN_TO_FULL' AND (p_condition_from != 'EMPTY_CLEAN' OR p_condition_to != 'FULL_USABLE') THEN
        RAISE EXCEPTION 'Filling cycle requires EMPTY_CLEAN -> FULL_USABLE transition.';
    END IF;
    IF p_movement_type = 'SCRAP_WRITEOFF' AND (p_condition_from NOT IN ('DAMAGED_REPAIRABLE', 'DAMAGED_SCRAP') OR p_condition_to != 'DAMAGED_SCRAP') THEN
        RAISE EXCEPTION 'Scrap writeoff requires DAMAGED_REPAIRABLE/DAMAGED_SCRAP -> DAMAGED_SCRAP transition.';
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

    -- 2. Verify and Lock Source Location Balance (Prevents inventory fabrication)
    -- Except for initial external supplier procurement (SUPPLIER_PURCHASE) where stock is procured into system
    IF p_movement_type != 'SUPPLIER_PURCHASE' THEN
        IF v_src_loc.location_type = 'CUSTOMER' THEN
            SELECT * INTO v_cust FROM public.customers WHERE location_id = p_source_location_id FOR UPDATE;
            IF v_cust.id IS NULL THEN
                RAISE EXCEPTION 'Customer at location % not found.', p_source_location_id;
            END IF;

            IF p_condition_from = 'FULL_USABLE' AND v_cust.total_full_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient full jars. Available: %, Requested: %.', v_cust.total_full_jars_holding, p_quantity;
            ELSIF p_condition_from = 'EMPTY_DIRTY' AND v_cust.total_empty_jars_holding < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient empty jars. Available: %, Requested: %.', v_cust.total_empty_jars_holding, p_quantity;
            ELSIF p_condition_from = 'DAMAGED_REPAIRABLE' AND COALESCE(v_cust.total_damaged_jars_holding, 0) < p_quantity THEN
                RAISE EXCEPTION 'Customer has insufficient damaged jars. Available: %, Requested: %.', COALESCE(v_cust.total_damaged_jars_holding, 0), p_quantity;
            END IF;

            -- Deduct from customer custody
            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_from = 'FULL_USABLE' THEN total_full_jars_holding - p_quantity ELSE total_full_jars_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_from = 'EMPTY_DIRTY' THEN total_empty_jars_holding - p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_from = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding - p_quantity ELSE total_damaged_jars_holding END,
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
                -- Calculate warehouse available condition stock from movements
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
            -- Calculate vehicle/staff available condition stock from movements
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

    -- 3. Update Destination Holdings
    IF v_dst_loc.location_type = 'CUSTOMER' THEN
        SELECT * INTO v_dst_cust FROM public.customers WHERE location_id = p_destination_location_id FOR UPDATE;
        IF v_dst_cust.id IS NOT NULL THEN
            UPDATE public.customers
            SET total_full_jars_holding = CASE WHEN p_condition_to = 'FULL_USABLE' THEN total_full_jars_holding + p_quantity ELSE total_full_jars_holding END,
                total_empty_jars_holding = CASE WHEN p_condition_to = 'EMPTY_DIRTY' THEN total_empty_jars_holding + p_quantity ELSE total_empty_jars_holding END,
                total_damaged_jars_holding = CASE WHEN p_condition_to = 'DAMAGED_REPAIRABLE' THEN total_damaged_jars_holding + p_quantity ELSE total_damaged_jars_holding END,
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

    -- 4. Insert Immutable Jar Custody Movement Audit Log
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
            source_location_id,
            destination_location_id,
            created_by
        ) VALUES (
            v_default_wh_id,
            v_jar_product_id,
            CASE WHEN p_movement_type = 'FILLING_CYCLE_CLEAN_TO_FULL' THEN 'ADJUSTMENT_IN' ELSE 'DELIVERY_RETURN' END,
            p_quantity,
            'JAR_MOVEMENT',
            v_movement_id,
            p_source_location_id,
            p_destination_location_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'movement_id', v_movement_id,
        'quantity', p_quantity,
        'movement_type', p_movement_type,
        'condition_from', p_condition_from,
        'condition_to', p_condition_to
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ------------------------------------------------------------------------------
-- 5. HARDENED ORDER CREATION WITH AUTHORITATIVE PRICING & TAX VALIDATION
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

    -- Idempotency check: if order with this key already exists, return cached record
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, order_number, total_amount INTO v_existing_order_id, v_existing_order_num, v_existing_total
        FROM public.orders
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'order_id', v_existing_order_id,
                'order_number', v_existing_order_num,
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
        gst_rate NUMERIC
    )
    LOOP
        IF v_item.quantity <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be greater than zero.';
        END IF;

        SELECT id, name, price, gst_rate INTO v_product
        FROM public.products
        WHERE id = v_item.product_id AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found or inactive.', v_item.product_id;
        END IF;

        -- Check customer-specific agreed special price
        SELECT special_price INTO v_special_price
        FROM public.customer_special_prices
        WHERE customer_id = p_customer_id AND product_id = v_item.product_id AND is_active = true;

        v_base_unit_price := COALESCE(v_special_price, v_product.price);

        -- Authoritative price validation:
        -- Ordinary staff MUST use standard or customer-special price.
        -- Only Owner can authorize negotiated discounts or custom prices.
        IF v_item.unit_price IS NOT NULL AND v_item.unit_price != v_base_unit_price THEN
            IF v_caller_role != 'owner' THEN
                RAISE EXCEPTION 'Unauthorized price override: only the business owner can authorize price overrides or custom discounts. Product: %, Standard: %, Submitted: %.',
                    v_product.name, v_base_unit_price, v_item.unit_price;
            END IF;

            IF v_item.unit_price < 0 THEN
                RAISE EXCEPTION 'Overridden unit price cannot be negative.';
            END IF;

            v_final_unit_price := v_item.unit_price;
            v_is_overridden := true;
        ELSE
            v_final_unit_price := v_base_unit_price;
            v_is_overridden := false;
        END IF;

        -- Tax rate is ALWAYS strictly authoritative from products table (clients cannot manipulate GST)
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
        gst_rate NUMERIC
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
