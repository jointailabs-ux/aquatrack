-- ==============================================================================
-- AquaTrack ERP — Rollback Migration: Remediation Round 4
-- Version: 20261104000002_remediation_round_4_rollback.sql
-- Description:
--   Rollback script restoring the exact state prior to Remediation Round 4
--   (restores Round 3 function definitions and trigger functions without dropping data).
-- ==============================================================================

-- 1. Restore Round 3 Customer Protection Trigger Function
CREATE OR REPLACE FUNCTION public.check_customer_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF pg_catalog.current_setting('app.internal_rpc_context', true) = 'true' THEN
        RETURN NEW;
    END IF;

    IF current_user IN ('postgres', 'service_role') OR public.get_user_role() = 'owner' THEN
        RETURN NEW;
    END IF;

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
END;
$$;

-- 2. Restore Round 3 Supplier Protection Trigger Function
CREATE OR REPLACE FUNCTION public.check_supplier_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF pg_catalog.current_setting('app.internal_rpc_context', true) = 'true' THEN
        RETURN NEW;
    END IF;

    IF current_user IN ('postgres', 'service_role') OR public.get_user_role() = 'owner' THEN
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
END;
$$;

-- 3. Document Preservation of Round 4 Schema Additions
-- Note: Added audit columns (idempotency_key on orders, original_price/is_price_overridden on order_items)
-- are safely preserved to avoid data loss and preserve transaction history.
