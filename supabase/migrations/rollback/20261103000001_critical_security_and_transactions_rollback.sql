-- ==============================================================================
-- AquaTrack ERP — Rollback Migration: Critical Security & Transaction Remediation
-- Version: 20261103000001_critical_security_and_transactions_rollback.sql
-- Description:
--   Rolls back functions, triggers, and schema alterations introduced in 20261103000001.
--   Strictly non-cascading and reverse-dependency order.
--   SECURITY MANDATE: Never restores unrestricted USING (true) or WITH CHECK (true) policies.
-- ==============================================================================

-- 1. Drop New Atomic RPCs introduced in 20261103000001
DROP FUNCTION IF EXISTS public.rpc_reverse_financial_entry(UUID, TEXT);
DROP FUNCTION IF EXISTS public.rpc_adjust_inventory_stock(UUID, INT, TEXT);
DROP FUNCTION IF EXISTS public.rpc_record_expense(VARCHAR, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR);
DROP FUNCTION IF EXISTS public.rpc_record_salary_payment(UUID, VARCHAR, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, DATE, TEXT);

-- 2. Restore Safe Authorized RLS Policies (Zero Unrestricted Policies)
DROP POLICY IF EXISTS bs_select ON public.business_settings;
DROP POLICY IF EXISTS bs_modify ON public.business_settings;
CREATE POLICY bs_select ON public.business_settings FOR SELECT TO authenticated 
    USING (auth.uid() IS NOT NULL);
CREATE POLICY bs_modify ON public.business_settings FOR ALL TO authenticated 
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

DROP POLICY IF EXISTS wh_select ON public.warehouses;
DROP POLICY IF EXISTS wh_modify ON public.warehouses;
CREATE POLICY wh_select ON public.warehouses FOR SELECT TO authenticated 
    USING (auth.uid() IS NOT NULL);
CREATE POLICY wh_modify ON public.warehouses FOR ALL TO authenticated 
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

DROP POLICY IF EXISTS csp_select ON public.customer_special_prices;
DROP POLICY IF EXISTS csp_modify ON public.customer_special_prices;
CREATE POLICY csp_select ON public.customer_special_prices FOR SELECT TO authenticated 
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_manage_customers')::boolean = true OR
        (public.get_staff_permissions()->>'can_pos')::boolean = true
    ));
CREATE POLICY csp_modify ON public.customer_special_prices FOR ALL TO authenticated 
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

DROP POLICY IF EXISTS oi_select ON public.order_items;
DROP POLICY IF EXISTS oi_modify ON public.order_items;
CREATE POLICY oi_select ON public.order_items FOR SELECT TO authenticated 
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY oi_modify ON public.order_items FOR ALL TO authenticated 
    USING (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true)
    WITH CHECK (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true);

DROP POLICY IF EXISTS invs_select ON public.invoices;
DROP POLICY IF EXISTS invs_modify ON public.invoices;
CREATE POLICY invs_select ON public.invoices FOR SELECT TO authenticated 
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY invs_modify ON public.invoices FOR ALL TO authenticated 
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

DROP POLICY IF EXISTS invs_items_select ON public.invoice_items;
DROP POLICY IF EXISTS invs_items_modify ON public.invoice_items;
CREATE POLICY invs_items_select ON public.invoice_items FOR SELECT TO authenticated 
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY invs_items_modify ON public.invoice_items FOR ALL TO authenticated 
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

DROP POLICY IF EXISTS cp_select ON public.customer_payments;
DROP POLICY IF EXISTS cp_insert ON public.customer_payments;
CREATE POLICY cp_select ON public.customer_payments FOR SELECT TO authenticated 
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        collected_by_staff_id = auth.uid() OR
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY cp_insert ON public.customer_payments FOR INSERT TO authenticated 
    WITH CHECK (public.get_user_role() = 'owner');

DROP POLICY IF EXISTS jcm_select ON public.jar_custody_movements;
DROP POLICY IF EXISTS jcm_insert ON public.jar_custody_movements;
CREATE POLICY jcm_select ON public.jar_custody_movements FOR SELECT TO authenticated 
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_warehouse')::boolean = true OR
        (public.get_staff_permissions()->>'can_deliveries')::boolean = true
    ));
CREATE POLICY jcm_insert ON public.jar_custody_movements FOR INSERT TO authenticated 
    WITH CHECK (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_warehouse')::boolean = true
    ));

DROP POLICY IF EXISTS pos_items_select ON public.pos_sale_items;
DROP POLICY IF EXISTS pos_items_insert ON public.pos_sale_items;
CREATE POLICY pos_items_select ON public.pos_sale_items FOR SELECT TO authenticated 
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        EXISTS (SELECT 1 FROM public.pos_sales ps WHERE ps.id = pos_sale_items.sale_id AND ps.staff_id = auth.uid())
    ));

-- 3. Restore Default Columns & Constraints
ALTER TABLE public.purchases ALTER COLUMN po_number DROP DEFAULT;
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_status_check
    CHECK (status IN ('ORDERED', 'RECEIVED', 'CANCELLED'));
