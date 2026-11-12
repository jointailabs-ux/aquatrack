-- ==============================================================================
-- AquaTrack ERP — Manual Database Correction 01
-- File: supabase/manual-fixes/01_remove_legacy_order_rpc.sql
-- Status: PREPARED FOR REVIEW (NOT EXECUTED)
-- Target: Live Supabase PostgreSQL Database (bplpyitmcqqebpdyochz)
-- Objective: Drop obsolete 6-parameter overload of rpc_create_customer_order
-- ==============================================================================
--
-- CONTEXT & ROOT CAUSE ANALYSIS:
-- In Migration 20261104000001_remediation_round_3.sql, rpc_create_customer_order
-- was defined with 6 parameters:
--   public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB)
--
-- In Migration 20261104000002_remediation_round_4.sql and hardened in Round 7
-- (20261104000005_remediation_round_7.sql), two new parameters were added:
--   p_idempotency_key VARCHAR DEFAULT NULL,
--   p_price_override_reason TEXT DEFAULT NULL
--
-- In PostgreSQL, CREATE OR REPLACE FUNCTION with a different parameter list
-- creates a distinct overloaded function rather than replacing the existing one.
-- Because no previous migration issued a DROP FUNCTION on the 6-parameter signature,
-- both versions currently coexist in public schema.
--
-- SYMPTOMS:
-- When PostgREST processes calls to /rest/v1/rpc/rpc_create_customer_order that
-- omit optional parameters (e.g. from automated tests or direct callers), it
-- cannot choose between the 6-param candidate and the 8-param candidate with
-- defaults, returning HTTP 300 Multiple Choices (PGRST203).
--
-- SAFETY & DEPENDENCY AUDIT:
-- 1. No foreign keys, views, or tables depend on this function.
-- 2. Triggers (check_customer_privileged_updates) inspect call stack strings
--    (v_stack LIKE '%rpc_create_customer_order%') and session auth tokens,
--    not the 6-parameter OID.
-- 3. The Next.js application service (src/modules/orders/order.service.ts)
--    explicitly passes all 8 arguments, targeting the hardened Round 7 version.
-- 4. Dropping the 6-parameter function leaves the 8-parameter function as the
--    sole candidate, enabling PostgREST to automatically use defaults when
--    optional parameters are omitted.
-- ==============================================================================

BEGIN;

-- 1. DROP THE OBSOLETE 6-PARAMETER FUNCTION
DROP FUNCTION IF EXISTS public.rpc_create_customer_order(
    UUID,   -- p_customer_id
    TEXT,   -- p_delivery_address
    DATE,   -- p_delivery_date
    UUID,   -- p_assigned_staff_id
    TEXT,   -- p_notes
    JSONB   -- p_items
);

-- 2. VERIFY THAT EXACTLY ONE FUNCTION REMAINS (8-PARAMETER ROUND 7 HARDENED)
DO $$
DECLARE
    v_func_count INT;
BEGIN
    SELECT COUNT(*) INTO v_func_count
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' 
      AND p.proname = 'rpc_create_customer_order';

    IF v_func_count != 1 THEN
        RAISE EXCEPTION 'Verification failed: Expected exactly 1 rpc_create_customer_order, found %.', v_func_count;
    END IF;

    RAISE NOTICE 'SUCCESS: Exactly 1 rpc_create_customer_order function remains in public schema.';
END $$;

COMMIT;

-- ==============================================================================
-- POST-EXECUTION VERIFICATION QUERY:
-- Run the following SELECT in Supabase SQL Editor to inspect the active signature:
--
-- SELECT 
--     p.proname AS function_name,
--     pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
--     pg_catalog.pg_get_function_result(p.oid) AS return_type,
--     p.prosecdef AS is_security_definer
-- FROM pg_catalog.pg_proc p
-- JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'rpc_create_customer_order';
--
-- Expected Output:
-- function_name             | rpc_create_customer_order
-- arguments                 | p_customer_id uuid, p_delivery_address text, p_delivery_date date, p_assigned_staff_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_idempotency_key character varying DEFAULT NULL::character varying, p_price_override_reason text DEFAULT NULL::text
-- return_type               | jsonb
-- is_security_definer       | true
-- ==============================================================================

