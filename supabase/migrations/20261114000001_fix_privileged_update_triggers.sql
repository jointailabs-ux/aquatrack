-- ==============================================================================
-- Migration: 20261114000001_fix_privileged_update_triggers.sql
-- Description: Allow trusted SECURITY DEFINER RPCs (such as rpc_execute_delivery_stop,
--              rpc_create_customer_order, rpc_receive_purchase_order, etc.) to mutate
--              customer and supplier balances without trigger check failures.
-- ==============================================================================

-- 1. Fix check_customer_privileged_updates
CREATE OR REPLACE FUNCTION public.check_customer_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_token BOOLEAN;
    v_stack TEXT;
BEGIN
    -- Check if protected fields are being modified
    IF (NEW.current_balance IS DISTINCT FROM OLD.current_balance) OR
       (NEW.total_full_jars_holding IS DISTINCT FROM OLD.total_full_jars_holding) OR
       (NEW.total_empty_clean_holding IS DISTINCT FROM OLD.total_empty_clean_holding) OR
       (NEW.total_empty_jars_holding IS DISTINCT FROM OLD.total_empty_jars_holding) OR
       (NEW.total_damaged_jars_holding IS DISTINCT FROM OLD.total_damaged_jars_holding) OR
       (NEW.total_scrap_jars_holding IS DISTINCT FROM OLD.total_scrap_jars_holding) OR
       (NEW.total_deposit_held IS DISTINCT FROM OLD.total_deposit_held) THEN

        -- Allow migrations, CLI operations, and service_role executions
        IF auth.uid() IS NULL AND 
           current_setting('request.jwt.claim.sub', true) IS NULL AND
           current_setting('request.jwt.claim.role', true) IS NULL THEN
            RETURN NEW;
        END IF;

        IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
            RETURN NEW;
        END IF;

        -- Check call stack for trusted SECURITY DEFINER RPCs
        GET DIAGNOSTICS v_stack = PG_CONTEXT;
        IF v_stack LIKE '%rpc_execute_delivery_stop%' OR 
           v_stack LIKE '%rpc_create_customer_order%' OR 
           v_stack LIKE '%rpc_cancel_customer_order%' OR 
           v_stack LIKE '%rpc_record_jar_movement%' OR 
           v_stack LIKE '%rpc_record_customer_payment%' OR 
           v_stack LIKE '%rpc_settle_driver_cash%' THEN
            RETURN NEW;
        END IF;

        -- Verify valid RPC authorization token if context was established
        SELECT EXISTS (
            SELECT 1 FROM public.internal_rpc_auth_tokens
            WHERE txid = txid_current()
              AND (authorized_user_id = auth.uid() OR auth.uid() IS NULL)
              AND allowed_scope IN ('JAR_CUSTODY_ONLY', 'CUSTOMER_ORDER_BALANCE_ONLY', 'DELIVERY_STOP_EXECUTION', 'ALL_OPERATIONS')
        ) INTO v_has_token;

        IF NOT v_has_token THEN
            RAISE EXCEPTION 'Direct updates to customer financial balances and jar custody counts are strictly prohibited. Use authorized RPC functions.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 2. Fix check_supplier_privileged_updates
CREATE OR REPLACE FUNCTION public.check_supplier_privileged_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_token BOOLEAN;
    v_stack TEXT;
BEGIN
    IF (NEW.current_payable IS DISTINCT FROM OLD.current_payable) OR
       (NEW.jars_in_custody IS DISTINCT FROM OLD.jars_in_custody) THEN

        IF auth.uid() IS NULL AND 
           current_setting('request.jwt.claim.sub', true) IS NULL AND
           current_setting('request.jwt.claim.role', true) IS NULL THEN
            RETURN NEW;
        END IF;

        IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
            RETURN NEW;
        END IF;

        GET DIAGNOSTICS v_stack = PG_CONTEXT;
        IF v_stack LIKE '%rpc_receive_purchase_order%' OR 
           v_stack LIKE '%rpc_record_supplier_payment%' OR 
           v_stack LIKE '%rpc_record_jar_movement%' OR 
           v_stack LIKE '%rpc_create_purchase_order%' THEN
            RETURN NEW;
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM public.internal_rpc_auth_tokens
            WHERE txid = txid_current()
              AND (authorized_user_id = auth.uid() OR auth.uid() IS NULL)
              AND allowed_scope IN ('PURCHASE_RECEIPT', 'SUPPLIER_PAYABLE_ONLY', 'JAR_CUSTODY_ONLY', 'ALL_OPERATIONS')
        ) INTO v_has_token;

        IF NOT v_has_token THEN
            RAISE EXCEPTION 'Direct updates to supplier financial payables and jar custody balances are strictly prohibited. Use authorized RPC functions.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
