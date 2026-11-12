-- ==============================================================================
-- AquaTrack ERP — Rollback Migration: Remediation Round 3
-- Version: 20261104000001_remediation_round_3_rollback.sql
-- Description:
--   Rollback script restoring the exact state prior to Remediation Round 3
--   (restores Round 2 function definitions, policies, and triggers).
-- ==============================================================================

-- 1. Drop Triggers and Functions Introduced in Round 3
DROP TRIGGER IF EXISTS trg_protect_customer_privileged_fields ON public.customers;
DROP FUNCTION IF EXISTS public.check_customer_privileged_updates();

DROP TRIGGER IF EXISTS trg_protect_supplier_privileged_fields ON public.suppliers;
DROP FUNCTION IF EXISTS public.check_supplier_privileged_updates();

DROP FUNCTION IF EXISTS public.rpc_create_customer_with_location(VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, VARCHAR, NUMERIC, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.rpc_record_jar_movement(UUID, UUID, VARCHAR, VARCHAR, INT, VARCHAR, VARCHAR, UUID, TEXT);
DROP FUNCTION IF EXISTS public.rpc_create_customer_order(UUID, TEXT, DATE, UUID, TEXT, JSONB);

-- 2. Restore Round 2 Policies on Purchases, Purchase Items, and Jar Movements
DROP POLICY IF EXISTS purch_select ON public.purchases;
DROP POLICY IF EXISTS purch_owner_modify ON public.purchases;
DROP POLICY IF EXISTS purch_all ON public.purchases;

CREATE POLICY purch_all ON public.purchases FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    );

DROP POLICY IF EXISTS purch_items_select ON public.purchase_items;
DROP POLICY IF EXISTS purch_items_owner_modify ON public.purchase_items;
DROP POLICY IF EXISTS purch_items_all ON public.purchase_items;

CREATE POLICY purch_items_all ON public.purchase_items FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    );

DROP POLICY IF EXISTS jcm_select ON public.jar_custody_movements;
DROP POLICY IF EXISTS jcm_owner_insert ON public.jar_custody_movements;
DROP POLICY IF EXISTS jcm_insert ON public.jar_custody_movements;

CREATE POLICY jcm_select ON public.jar_custody_movements FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true OR
            (public.get_staff_permissions()->>'can_deliveries')::boolean = true
        )
    );

CREATE POLICY jcm_insert ON public.jar_custody_movements FOR INSERT TO authenticated
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true
        )
    );
