-- ==============================================================================
-- AquaTrack ERP — Migration: 20261106000002_task7_rpc_settle_driver_cash.sql
-- Module: Delivery Operations & Cash Handover Settlement
-- Purpose: Hardened Atomic Driver Cash Settlement RPC with strict search_path,
--          staff driver role validation, safe expense verification,
--          ledger uniqueness index, and full transaction rollback.
--
-- STATUS: READY FOR EXECUTION IN SUPABASE SQL EDITOR
-- ==============================================================================

-- 1. DUPLICATE PROTECTION: Ensure unique constraint on cash_handovers
-- Guarantees at most one handover row exists per driver per date
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_staff_daily_handover'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'uq_staff_daily_handover'
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_daily_handover
        ON public.cash_handovers (staff_id, handover_date);
    END IF;
END $$;


-- 2. DUPLICATE PROTECTION: Database-Enforced Unique Index on financial_ledger
-- Ensures that for any single handover, at most one non-reversal debit entry
-- (Account 1010) and one non-reversal credit entry (Account 1015) can ever exist.
DO $$
BEGIN
    IF EXISTS (
        SELECT reference_id, account_code, pg_catalog.count(*)
        FROM public.financial_ledger
        WHERE reference_type = 'HANDOVER' AND is_reversal = false
        GROUP BY reference_id, account_code
        HAVING pg_catalog.count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot create unique index uq_ledger_handover_account: duplicate HANDOVER ledger entries already exist in financial_ledger.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_handover_account
ON public.financial_ledger (reference_id, account_code)
WHERE reference_type = 'HANDOVER' AND is_reversal = false;


-- 3. ATOMIC SETTLEMENT RPC
CREATE OR REPLACE FUNCTION public.rpc_settle_driver_cash(
    p_driver_id pg_catalog.uuid,
    p_handover_date pg_catalog.date,
    p_opening_float pg_catalog.numeric,
    p_cash_handed_over pg_catalog.numeric,
    p_on_route_expenses pg_catalog.numeric DEFAULT 0.00,
    p_notes pg_catalog.text DEFAULT NULL
)
RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id pg_catalog.uuid;
    v_caller_role pg_catalog.varchar;
    v_driver_record RECORD;
    v_existing_handover RECORD;
    v_actual_route_cash pg_catalog.numeric(12,2) := 0.00;
    v_actual_upi_collected pg_catalog.numeric(12,2) := 0.00;
    v_recorded_driver_expenses pg_catalog.numeric(12,2) := 0.00;
    v_effective_expenses pg_catalog.numeric(12,2) := 0.00;
    v_expected_cash pg_catalog.numeric(12,2) := 0.00;
    v_variance pg_catalog.numeric(12,2) := 0.00;
    v_status pg_catalog.varchar(20);
    v_handover_id pg_catalog.uuid;
    v_has_ledger_entry pg_catalog.bool := false;
    v_entry_num pg_catalog.varchar(60);
BEGIN
    -- 1. AUTHENTICATION & AUTHORIZATION: Strictly authenticated active owner only
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT role INTO v_caller_role
    FROM public.profiles
    WHERE id = v_caller_id AND is_active = true;

    IF v_caller_role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'Access denied: Only business owners can settle driver cash handovers.';
    END IF;

    -- 2. DRIVER AUTHORIZATION: Target profile must exist, be active, and have role 'staff'
    SELECT id, full_name, role, is_active
    INTO v_driver_record
    FROM public.profiles
    WHERE id = p_driver_id AND role = 'staff' AND is_active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid driver: Target profile % does not exist, is not active, or does not have role staff.', p_driver_id;
    END IF;

    -- 3. INPUT BOUNDARY VALIDATIONS
    IF p_handover_date > CURRENT_DATE THEN
        RAISE EXCEPTION 'Settlement date cannot be in the future (Date: %).', p_handover_date;
    END IF;

    -- Note on Opening Float: Opening float is declared and verified by the business owner
    -- at settlement (or morning vehicle dispatch) and is not independently derived from
    -- banking telemetry.
    IF p_opening_float < 0 THEN
        RAISE EXCEPTION 'Opening float cannot be negative (Provided: %).', p_opening_float;
    END IF;

    IF p_cash_handed_over < 0 THEN
        RAISE EXCEPTION 'Cash handed over cannot be negative (Provided: %).', p_cash_handed_over;
    END IF;

    IF p_on_route_expenses IS NOT NULL AND p_on_route_expenses < 0 THEN
        RAISE EXCEPTION 'On-route expenses cannot be negative (Provided: %).', p_on_route_expenses;
    END IF;

    -- 4. ROW-LEVEL LOCKING & IDEMPOTENCY / IMMUTABILITY CHECK
    -- Lock existing handover row if one exists to serialize concurrent settlements
    SELECT id, status, opening_float, cash_handed_over
    INTO v_existing_handover
    FROM public.cash_handovers
    WHERE staff_id = p_driver_id AND handover_date = p_handover_date
    FOR UPDATE;

    IF FOUND THEN
        -- Completed settlements are strictly immutable through this RPC
        IF v_existing_handover.status = 'SETTLED' THEN
            RAISE EXCEPTION 'Cash handover for driver % on date % has already been settled and is immutable.', p_driver_id, p_handover_date;
        END IF;

        -- Prevent repeated settlement attempts on a DISCREPANCY record that already posted ledger vouchers
        SELECT EXISTS (
            SELECT 1 FROM public.financial_ledger
            WHERE reference_type = 'HANDOVER' AND reference_id = v_existing_handover.id
        ) INTO v_has_ledger_entry;

        IF v_has_ledger_entry THEN
            IF v_existing_handover.status = 'DISCREPANCY' THEN
                RAISE EXCEPTION 'Cash handover for driver % on date % was already posted with a DISCREPANCY. Corrections must be made via explicit journal adjustment vouchers or reversal.', p_driver_id, p_handover_date;
            ELSE
                RAISE EXCEPTION 'Financial ledger entry already exists for handover %. Duplicate posting prevented.', v_existing_handover.id;
            END IF;
        END IF;
    END IF;

    -- 5. PAYMENT AGGREGATION: Eligible customer collections (Cash vs UPI isolation)
    -- Aggregates only customer payments collected by this driver for this date.
    -- Customer balances, invoices, orders and payment records are preserved strictly untouched.
    SELECT
        pg_catalog.coalesce(pg_catalog.sum(CASE WHEN payment_method = 'CASH' THEN amount ELSE 0.00 END), 0.00),
        pg_catalog.coalesce(pg_catalog.sum(CASE WHEN payment_method = 'UPI' THEN amount ELSE 0.00 END), 0.00)
    INTO v_actual_route_cash, v_actual_upi_collected
    FROM public.customer_payments
    WHERE collected_by_staff_id = p_driver_id
      AND payment_date = p_handover_date;

    -- 6. EXPENSE VERIFICATION: Safe owner-verification approach
    -- The schema has no approval column on public.expenses. Drivers record cash expenses on route.
    -- To ensure financial integrity without phantom deductions:
    -- a) Query total cash expenses created by this driver for this date.
    -- b) Enforce that the owner-approved amount (p_on_route_expenses) cannot exceed recorded expenses.
    -- c) If driver recorded 0 expenses, p_on_route_expenses must be 0.
    -- d) If owner approves a partial amount (e.g. invalid receipt disallowed), the owner-verified
    --    effective amount is used in the reconciliation equation.
    SELECT pg_catalog.coalesce(pg_catalog.sum(amount), 0.00)
    INTO v_recorded_driver_expenses
    FROM public.expenses
    WHERE created_by = p_driver_id
      AND expense_date = p_handover_date
      AND payment_method = 'CASH';

    v_effective_expenses := pg_catalog.coalesce(p_on_route_expenses, 0.00);

    IF v_effective_expenses > v_recorded_driver_expenses THEN
        RAISE EXCEPTION 'Approved on-route expenses (₹%) exceeds total driver cash expenses recorded in system (₹%) for date %. Owner must verify against recorded expense vouchers.', v_effective_expenses, v_recorded_driver_expenses, p_handover_date;
    END IF;

    -- 7. RECONCILIATION EQUATION:
    -- Expected Cash = Opening Float + Route Cash Collections - Approved On-Route Expenses
    -- Variance = Cash Handed Over - Expected Cash
    v_expected_cash := p_opening_float + v_actual_route_cash - v_effective_expenses;
    IF v_expected_cash < 0 THEN
        RAISE EXCEPTION 'Expected cash cannot be negative (Calculated: ₹%). Review opening float, cash collections, or on-route expenses.', v_expected_cash;
    END IF;

    v_variance := pg_catalog.round(p_cash_handed_over - v_expected_cash, 2);
    v_status := CASE WHEN v_variance = 0.00 THEN 'SETTLED' ELSE 'DISCREPANCY' END;

    -- 8. CREATE OR UPDATE HANDOVER RECORD
    IF v_existing_handover.id IS NOT NULL THEN
        UPDATE public.cash_handovers SET
            opening_float = p_opening_float,
            route_cash_collected = v_actual_route_cash,
            on_route_expenses = v_effective_expenses,
            expected_cash = v_expected_cash,
            cash_handed_over = p_cash_handed_over,
            upi_collected = v_actual_upi_collected,
            variance = v_variance,
            status = v_status,
            verified_by = v_caller_id,
            settled_at = pg_catalog.now()
        WHERE id = v_existing_handover.id
        RETURNING id INTO v_handover_id;
    ELSE
        -- Insert new handover protected by uq_staff_daily_handover unique constraint
        BEGIN
            INSERT INTO public.cash_handovers (
                staff_id,
                handover_date,
                opening_float,
                route_cash_collected,
                on_route_expenses,
                expected_cash,
                cash_handed_over,
                upi_collected,
                variance,
                status,
                verified_by,
                settled_at
            ) VALUES (
                p_driver_id,
                p_handover_date,
                p_opening_float,
                v_actual_route_cash,
                v_effective_expenses,
                v_expected_cash,
                p_cash_handed_over,
                v_actual_upi_collected,
                v_variance,
                v_status,
                v_caller_id,
                pg_catalog.now()
            )
            RETURNING id INTO v_handover_id;
        EXCEPTION
            WHEN unique_violation THEN
                RAISE EXCEPTION 'Concurrent settlement attempt detected for driver % on date %.', p_driver_id, p_handover_date;
        END;
    END IF;

    -- 9. ACCOUNTING CORRECTNESS: BALANCED DUAL-ENTRY FINANCIAL LEDGER TRANSFER
    -- Upon stop collection, delivery stop already debited Account 1015 (Cash Float with Driver)
    -- and credited Account 1110 (Accounts Receivable).
    -- Here, evening handover transfers physical cash from Driver Float (1015) to Vault / Cash in Hand (1010).
    -- UPI was routed to Bank Account 1020 upon customer payment and is NEVER posted as cash handover.
    IF p_cash_handed_over > 0 THEN
        v_entry_num := 'LED-HO-' || pg_catalog.to_char(p_handover_date, 'YYYYMMDD') || '-' || pg_catalog.substr(v_handover_id::text, 1, 8);

        -- Entry 1: Debit Cash in Hand (1010)
        INSERT INTO public.financial_ledger (
            entry_number,
            entry_date,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_entry_num || '-DR',
            p_handover_date,
            '1010',
            'Cash in Hand',
            p_cash_handed_over,
            0.00,
            'Driver evening cash handover surrender (Driver: ' || v_driver_record.full_name || ')',
            'HANDOVER',
            v_handover_id,
            v_caller_id
        );

        -- Entry 2: Credit Cash Float with Driver (1015)
        INSERT INTO public.financial_ledger (
            entry_number,
            entry_date,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            created_by
        ) VALUES (
            v_entry_num || '-CR',
            p_handover_date,
            '1015',
            'Cash Float with Driver',
            0.00,
            p_cash_handed_over,
            'Driver evening cash handover surrender (Driver: ' || v_driver_record.full_name || ')',
            'HANDOVER',
            v_handover_id,
            v_caller_id
        );
    END IF;

    -- 10. IMMUTABLE AUDIT LOGGING
    INSERT INTO public.audit_logs (
        table_name,
        record_id,
        action,
        old_data,
        new_data,
        performed_by
    ) VALUES (
        'cash_handovers',
        v_handover_id,
        CASE WHEN v_existing_handover.id IS NOT NULL THEN 'UPDATE' ELSE 'INSERT' END,
        CASE WHEN v_existing_handover.id IS NOT NULL THEN pg_catalog.jsonb_build_object(
            'id', v_existing_handover.id,
            'status', v_existing_handover.status,
            'opening_float', v_existing_handover.opening_float,
            'cash_handed_over', v_existing_handover.cash_handed_over
        ) ELSE NULL END,
        pg_catalog.jsonb_build_object(
            'staff_id', p_driver_id,
            'driver_name', v_driver_record.full_name,
            'handover_date', p_handover_date,
            'opening_float', p_opening_float,
            'route_cash_collected', v_actual_route_cash,
            'on_route_expenses', v_effective_expenses,
            'expected_cash', v_expected_cash,
            'cash_handed_over', p_cash_handed_over,
            'upi_collected', v_actual_upi_collected,
            'variance', v_variance,
            'status', v_status,
            'notes', p_notes,
            'verified_by', v_caller_id,
            'settled_at', pg_catalog.now()
        ),
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'handover_id', v_handover_id,
        'expected_cash', v_expected_cash,
        'cash_handed_over', p_cash_handed_over,
        'route_cash_collected', v_actual_route_cash,
        'upi_collected', v_actual_upi_collected,
        'on_route_expenses', v_effective_expenses,
        'variance', v_variance,
        'status', v_status
    );
END;
$$;

-- Restrict function execution permissions: revoke from public/anon, grant only to authenticated
REVOKE ALL ON FUNCTION public.rpc_settle_driver_cash(pg_catalog.uuid, pg_catalog.date, pg_catalog.numeric, pg_catalog.numeric, pg_catalog.numeric, pg_catalog.text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_settle_driver_cash(pg_catalog.uuid, pg_catalog.date, pg_catalog.numeric, pg_catalog.numeric, pg_catalog.numeric, pg_catalog.text) TO authenticated;
