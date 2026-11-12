-- ==============================================================================
-- AquaTrack ERP — Rollback Migration: Remediation Round 2
-- Version: 20261103000002_remediation_round_2_rollback.sql
-- Description:
--   Comprehensive rollback restoring the database state prior to Remediation Round 2
--   (restores function definitions and RLS policies from 20261103000001).
-- ==============================================================================

-- 1. Drop Round 2 Introduced Functions
DROP FUNCTION IF EXISTS public.rpc_record_salary_advance(UUID, NUMERIC, VARCHAR, DATE, TEXT);
DROP FUNCTION IF EXISTS public.rpc_record_supplier_payment(UUID, UUID, NUMERIC, VARCHAR, DATE, VARCHAR, TEXT);
DROP FUNCTION IF EXISTS public.rpc_create_purchase_order(UUID, DATE, VARCHAR, VARCHAR, JSONB, TEXT, VARCHAR);

-- 2. Drop Round 2 Indexes
DROP INDEX IF EXISTS public.idx_financial_ledger_ref;
DROP INDEX IF EXISTS public.idx_financial_ledger_reversed;
DROP INDEX IF EXISTS public.uq_salary_payments_idempotency;

-- 3. Restore Pre-Round-2 Functions from 20261103000001
CREATE OR REPLACE FUNCTION public.rpc_reverse_financial_entry(
    p_original_entry_id UUID,
    p_reversal_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_orig RECORD;
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_rev_entry_num VARCHAR(50);
    v_rev_entry_id UUID;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    IF v_caller_role != 'owner' THEN
        RAISE EXCEPTION 'Access denied: only owner accounts can execute ledger reversals.';
    END IF;

    SELECT * INTO v_orig FROM public.financial_ledger WHERE id = p_original_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original ledger entry % not found.', p_original_entry_id;
    END IF;

    IF v_orig.is_reversed THEN
        RAISE EXCEPTION 'Ledger entry % has already been reversed.', p_original_entry_id;
    END IF;

    v_rev_entry_num := 'REV-' || v_orig.entry_number;

    INSERT INTO public.financial_ledger (
        entry_number,
        account_code,
        account_name,
        debit,
        credit,
        description,
        reference_type,
        reference_id,
        reversal_of_id,
        created_by
    ) VALUES (
        v_rev_entry_num,
        v_orig.account_code,
        v_orig.account_name,
        v_orig.credit,
        v_orig.debit,
        'REVERSAL: ' || COALESCE(p_reversal_reason, 'Correction') || ' (Reverses ' || v_orig.entry_number || ')',
        v_orig.reference_type,
        v_orig.reference_id,
        v_orig.id,
        v_caller_id
    ) RETURNING id INTO v_rev_entry_id;

    UPDATE public.financial_ledger
    SET is_reversed = true,
        reversal_entry_id = v_rev_entry_id
    WHERE id = v_orig.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'original_entry_id', v_orig.id,
        'reversal_entry_id', v_rev_entry_id,
        'reversal_entry_number', v_rev_entry_num
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.rpc_reverse_financial_entry(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_reverse_financial_entry(UUID, TEXT) TO authenticated, service_role;

-- 4. Document Forward-Recovery vs Rollback Notice
-- Columns amount_deducted on salary_advances, total_damaged_jars_holding on customers,
-- and idempotency_key on salary_payments are kept intact to prevent loss of existing data.
