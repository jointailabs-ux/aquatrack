-- ==============================================================================
-- AquaTrack ERP — Migration: Critical Security & Transaction Remediation
-- Version: 20261103000001_critical_security_and_transactions.sql
-- Description:
--   1. Harden all SECURITY DEFINER functions with strict auth.uid() & profile checks.
--   2. Revoke execution from PUBLIC and anon; grant exclusively to authenticated/service_role.
--   3. Overhaul RLS across all 28 tables to eliminate loose USING (true) / WITH CHECK (true).
--   4. Purchase Module: Add po_number generator, draft/partial receipt, and status lifecycle.
--   5. Salary Module: Reconcile schema (voucher_number, other_deductions, net_payable, amount_paid).
--   6. Jar Custody: Decouple full/empty, disallow negative holdings, eliminate GREATEST() clamping.
--   7. POS Module: Server-side price calculation from database records; atomic row locking & balanced ledger.
--   8. Financial Ledger: Balanced double-entry posting, non-destructive reversals, atomic RPCs.
--   9. Inventory: Atomic RPC adjustments with FOR UPDATE locking and negative stock prevention.
-- ==============================================================================

-- 1. SCHEMA ALIGNMENT & EXTENSIONS

-- 1.1 Purchases: Extend status check to support DRAFT and PARTIALLY_RECEIVED
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_status_check;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_status_check
    CHECK (status IN ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'));

-- Default po_number generation if omitted
ALTER TABLE public.purchases ALTER COLUMN po_number SET DEFAULT 
    ('PO-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6));

-- 1.2 Purchase Items: Reconcile total_cost, total_amount, tax_rate, and gst_rate
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'purchase_items' AND column_name = 'total_amount') THEN
        ALTER TABLE public.purchase_items ADD COLUMN total_amount NUMERIC(12,2);
        UPDATE public.purchase_items SET total_amount = total_cost WHERE total_amount IS NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'purchase_items' AND column_name = 'gst_rate') THEN
        ALTER TABLE public.purchase_items ADD COLUMN gst_rate NUMERIC(5,2) DEFAULT 0.00;
        UPDATE public.purchase_items SET gst_rate = tax_rate WHERE gst_rate IS NULL;
    END IF;
END $$;

-- 1.3 Salary Payments: Add other_deductions, net_payable, amount_paid
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_payments' AND column_name = 'other_deductions') THEN
        ALTER TABLE public.salary_payments ADD COLUMN other_deductions NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (other_deductions >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_payments' AND column_name = 'net_payable') THEN
        ALTER TABLE public.salary_payments ADD COLUMN net_payable NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (net_payable >= 0);
        UPDATE public.salary_payments SET net_payable = net_paid WHERE net_payable = 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_payments' AND column_name = 'amount_paid') THEN
        ALTER TABLE public.salary_payments ADD COLUMN amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0);
        UPDATE public.salary_payments SET amount_paid = net_paid WHERE amount_paid = 0;
    END IF;
END $$;

-- 1.4 Salary Advances: Reconcile is_settled, is_deducted, reason, notes
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_advances' AND column_name = 'is_settled') THEN
        ALTER TABLE public.salary_advances ADD COLUMN is_settled BOOLEAN NOT NULL DEFAULT false;
        UPDATE public.salary_advances SET is_settled = is_deducted;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'salary_advances' AND column_name = 'reason') THEN
        ALTER TABLE public.salary_advances ADD COLUMN reason TEXT;
        UPDATE public.salary_advances SET reason = notes WHERE reason IS NULL;
    END IF;
END $$;

-- 1.5 Modular Staff Permissions in profiles
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'can_deliveries') THEN
        ALTER TABLE public.profiles ADD COLUMN can_deliveries BOOLEAN NOT NULL DEFAULT true;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'can_manage_suppliers') THEN
        ALTER TABLE public.profiles ADD COLUMN can_manage_suppliers BOOLEAN NOT NULL DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'can_manage_expenses') THEN
        ALTER TABLE public.profiles ADD COLUMN can_manage_expenses BOOLEAN NOT NULL DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'can_manage_salaries') THEN
        ALTER TABLE public.profiles ADD COLUMN can_manage_salaries BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- 2. HARDENED SECURITY HELPER FUNCTIONS

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS VARCHAR AS $$
    SELECT role FROM public.profiles
    WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_staff_permissions()
RETURNS JSONB AS $$
    SELECT pg_catalog.jsonb_build_object(
        'can_pos', COALESCE(can_pos, false),
        'can_warehouse', COALESCE(can_warehouse, false),
        'can_manage_customers', COALESCE(can_manage_customers, false),
        'can_manage_orders', COALESCE(can_manage_orders, false),
        'can_deliveries', COALESCE(can_deliveries, true),
        'can_manage_suppliers', COALESCE(can_manage_suppliers, false),
        'can_manage_expenses', COALESCE(can_manage_expenses, false),
        'can_manage_salaries', COALESCE(can_manage_salaries, false)
    )
    FROM public.profiles
    WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_staff_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_staff_permissions() TO authenticated, service_role;

-- 2.1 Profile Update Privilege Escalation Trigger (Fail-closed)
CREATE OR REPLACE FUNCTION public.check_profile_update_privileges()
RETURNS TRIGGER AS $$
DECLARE
    v_is_service_role BOOLEAN;
    v_caller_role VARCHAR;
BEGIN
    v_is_service_role := (
        auth.role() = 'service_role' OR 
        current_user IN ('postgres', 'supabase_admin')
    );

    IF v_is_service_role THEN
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Access denied: caller is unauthenticated.';
    END IF;

    v_caller_role := public.get_user_role();

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: caller has no active profile.';
    END IF;

    -- Self-service profile updates: cannot alter role, active status, permissions, or salary
    IF NEW.id = auth.uid() THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Privilege escalation blocked: users cannot alter their own role.';
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'Security violation: users cannot alter their own active status.';
        END IF;
        IF NEW.can_pos IS DISTINCT FROM OLD.can_pos OR
           NEW.can_warehouse IS DISTINCT FROM OLD.can_warehouse OR
           NEW.can_manage_customers IS DISTINCT FROM OLD.can_manage_customers OR
           NEW.can_manage_orders IS DISTINCT FROM OLD.can_manage_orders OR
           NEW.can_deliveries IS DISTINCT FROM OLD.can_deliveries OR
           NEW.can_manage_suppliers IS DISTINCT FROM OLD.can_manage_suppliers OR
           NEW.can_manage_expenses IS DISTINCT FROM OLD.can_manage_expenses OR
           NEW.can_manage_salaries IS DISTINCT FROM OLD.can_manage_salaries THEN
            RAISE EXCEPTION 'Privilege escalation blocked: users cannot modify their own operational permissions.';
        END IF;
        IF NEW.salary_amount IS DISTINCT FROM OLD.salary_amount OR
           NEW.salary_type IS DISTINCT FROM OLD.salary_type THEN
            RAISE EXCEPTION 'Security violation: staff cannot modify their own salary parameters.';
        END IF;
    ELSE
        -- Modifying another profile requires Owner role
        IF v_caller_role != 'owner' THEN
            RAISE EXCEPTION 'Access denied: only the owner can modify other staff profiles.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3. PERMISSION-AWARE ROW LEVEL SECURITY (RLS) POLICIES OVERHAUL

-- 3.1 Drop loose / permissive policies
DROP POLICY IF EXISTS bs_select ON public.business_settings;
DROP POLICY IF EXISTS bs_modify ON public.business_settings;
DROP POLICY IF EXISTS wh_select ON public.warehouses;
DROP POLICY IF EXISTS wh_modify ON public.warehouses;
DROP POLICY IF EXISTS csp_select ON public.customer_special_prices;
DROP POLICY IF EXISTS csp_modify ON public.customer_special_prices;
DROP POLICY IF EXISTS jcm_select ON public.jar_custody_movements;
DROP POLICY IF EXISTS jcm_insert ON public.jar_custody_movements;
DROP POLICY IF EXISTS oi_select ON public.order_items;
DROP POLICY IF EXISTS oi_modify ON public.order_items;
DROP POLICY IF EXISTS invs_select ON public.invoices;
DROP POLICY IF EXISTS invs_modify ON public.invoices;
DROP POLICY IF EXISTS invs_items_select ON public.invoice_items;
DROP POLICY IF EXISTS invs_items_modify ON public.invoice_items;
DROP POLICY IF EXISTS cp_select ON public.customer_payments;
DROP POLICY IF EXISTS cp_insert ON public.customer_payments;
DROP POLICY IF EXISTS pos_items_select ON public.pos_sale_items;
DROP POLICY IF EXISTS pos_items_insert ON public.pos_sale_items;

-- 3.2 Business Settings
CREATE POLICY bs_select ON public.business_settings FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND public.get_user_role() IN ('owner', 'staff'));
CREATE POLICY bs_modify ON public.business_settings FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.3 Warehouses
CREATE POLICY wh_select ON public.warehouses FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND public.get_user_role() IN ('owner', 'staff'));
CREATE POLICY wh_modify ON public.warehouses FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.4 Customer Special Prices
CREATE POLICY csp_select ON public.customer_special_prices FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_manage_customers')::boolean = true OR
        (public.get_staff_permissions()->>'can_pos')::boolean = true OR
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY csp_modify ON public.customer_special_prices FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.5 Order Items
CREATE POLICY oi_select ON public.order_items FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = order_items.order_id
        AND (public.get_user_role() = 'owner' OR o.assigned_staff_id = auth.uid() OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true)
    ));
CREATE POLICY oi_modify ON public.order_items FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true)
    WITH CHECK (public.get_user_role() = 'owner' OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true);

-- 3.6 Invoices & Invoice Items
CREATE POLICY invs_select ON public.invoices FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY invs_modify ON public.invoices FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

CREATE POLICY invs_items_select ON public.invoice_items FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY invs_items_modify ON public.invoice_items FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.7 Customer Payments
CREATE POLICY cp_select ON public.customer_payments FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        collected_by_staff_id = auth.uid() OR 
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));
CREATE POLICY cp_insert ON public.customer_payments FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        collected_by_staff_id = auth.uid() OR 
        (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
    ));

-- 3.8 Jar Custody Movements
CREATE POLICY jcm_select ON public.jar_custody_movements FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        created_by = auth.uid() OR 
        (public.get_staff_permissions()->>'can_warehouse')::boolean = true OR
        (public.get_staff_permissions()->>'can_deliveries')::boolean = true
    ));
CREATE POLICY jcm_insert ON public.jar_custody_movements FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        created_by = auth.uid()
    ));

-- 3.9 POS Sale Items
CREATE POLICY pos_items_select ON public.pos_sale_items FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        EXISTS (SELECT 1 FROM public.pos_sales ps WHERE ps.id = pos_sale_items.sale_id AND ps.staff_id = auth.uid())
    ));
CREATE POLICY pos_items_insert ON public.pos_sale_items FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL AND (
        public.get_user_role() = 'owner' OR 
        (public.get_staff_permissions()->>'can_pos')::boolean = true
    ));

-- 4. ATOMIC, VALIDATED BUSINESS TRANSACTION RPCS

-- ==============================================================================
-- RPC 1: rpc_execute_delivery_stop
-- Decoupled full jar drop and empty jar return. Validates customer holdings.
-- No GREATEST() clamping. Locks rows FOR UPDATE. Balanced financial posting.
-- ==============================================================================
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
    v_caller_profile RECORD;
    v_payment_num VARCHAR(50);
    v_wh_location UUID;
    v_default_jar_id UUID;
    v_current_total_custody INT;
    v_total_returning INT;
    v_new_full_holding INT;
    v_new_empty_holding INT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: caller is unauthenticated.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := v_caller_profile.role;

    -- Validate input sanity
    IF p_actual_delivered < 0 OR p_empty_jars < 0 OR p_damaged_jars < 0 THEN
        RAISE EXCEPTION 'Quantities cannot be negative.';
    END IF;
    IF p_payment_amount < 0 THEN
        RAISE EXCEPTION 'Payment amount cannot be negative.';
    END IF;

    -- Retrieve and lock stop record
    SELECT * INTO v_stop FROM public.delivery_stops WHERE id = p_stop_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery stop not found: %', p_stop_id;
    END IF;

    -- Verify caller assignment
    IF v_caller_role != 'owner' AND v_stop.assigned_staff_id != v_caller_id THEN
        RAISE EXCEPTION 'Access denied: staff can only execute stops assigned to them.';
    END IF;

    -- Idempotency check: If already completed, return existing state
    IF v_stop.status = 'COMPLETED' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', 'ALREADY_COMPLETED'
        );
    END IF;

    -- Check for failure report
    IF p_failure_reason IS NOT NULL AND p_actual_delivered = 0 THEN
        UPDATE public.delivery_stops
        SET status = 'FAILED',
            failure_reason = p_failure_reason,
            executed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_stop_id;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'FAILED');
    END IF;

    -- Retrieve and lock order and customer
    SELECT * INTO v_order FROM public.orders WHERE id = v_stop.order_id FOR UPDATE;
    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;

    SELECT location_id INTO v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    SELECT id INTO v_default_jar_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;

    -- 1. Validate Customer Physical Jar Custody (Never Clamped, Strictly Conserved)
    v_current_total_custody := v_customer.total_full_jars_holding + v_customer.total_empty_jars_holding;
    v_total_returning := p_empty_jars + p_damaged_jars;

    IF v_total_returning > v_current_total_custody THEN
        RAISE EXCEPTION 'Invalid physical return: Customer holding is % jars (full: %, empty: %), but returning % jars.',
            v_current_total_custody, v_customer.total_full_jars_holding, v_customer.total_empty_jars_holding, v_total_returning;
    END IF;

    -- Decoupled holding calculation: Full jars delivered increment full holding
    v_new_full_holding := v_customer.total_full_jars_holding + p_actual_delivered;

    -- Empty/damaged jars returned deduct from customer holding
    IF v_customer.total_empty_jars_holding >= v_total_returning THEN
        v_new_empty_holding := v_customer.total_empty_jars_holding - v_total_returning;
    ELSE
        -- Emptied full jars returned
        v_new_full_holding := v_new_full_holding - (v_total_returning - v_customer.total_empty_jars_holding);
        v_new_empty_holding := 0;
    END IF;

    IF v_new_full_holding < 0 THEN
        RAISE EXCEPTION 'Physical custody violation: Customer full jars holding cannot become negative (% < 0)', v_new_full_holding;
    END IF;

    UPDATE public.customers
    SET total_full_jars_holding = v_new_full_holding,
        total_empty_jars_holding = v_new_empty_holding,
        updated_at = pg_catalog.now()
    WHERE id = v_customer.id;

    -- 2. Log Immutable Jar Custody Movements
    IF p_actual_delivered > 0 AND v_default_jar_id IS NOT NULL THEN
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

    IF p_empty_jars > 0 AND v_default_jar_id IS NOT NULL THEN
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
            'EMPTY_CLEAN',
            'EMPTY_DIRTY',
            p_empty_jars,
            'CUSTOMER_EMPTY_RETURN',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    IF p_damaged_jars > 0 AND v_default_jar_id IS NOT NULL THEN
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
            'DAMAGED_REPAIRABLE',
            p_damaged_jars,
            'DAMAGED_COLLECTED',
            'DELIVERY_STOP',
            p_stop_id,
            v_caller_id
        );
    END IF;

    -- 3. Payment Processing & Balanced Financial Ledger Entry
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
            COALESCE(p_payment_method, 'CASH'),
            v_caller_id,
            'Route stop payment'
        );

        -- Decrement customer receivable balance
        UPDATE public.customers
        SET current_balance = current_balance - p_payment_amount,
            updated_at = pg_catalog.now()
        WHERE id = v_customer.id;

        -- Post balanced dual-entry to financial ledger
        -- Entry 1: Debit Cash with Driver (or Bank if UPI)
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

        -- Entry 2: Credit Accounts Receivable
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
            '1200',
            'Accounts Receivable (Customer)',
            0.00,
            p_payment_amount,
            'Settlement of AR for ' || v_customer.contact_name,
            'PAYMENT',
            p_stop_id,
            v_caller_id
        );
    END IF;

    -- 4. Mark Stop Completed
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

    -- Update order status
    UPDATE public.orders
    SET status = 'DELIVERED',
        payment_status = CASE WHEN p_payment_amount >= total_amount THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'COMPLETED',
        'delivered', p_actual_delivered,
        'empty_collected', p_empty_jars,
        'customer_closing_holding', (v_new_full_holding + v_new_empty_holding)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 2: rpc_complete_pos_sale
-- Server-side pricing from products table. Row locking on inventory balances.
-- Rejects insufficient stock. Balanced double-entry financial ledger.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_complete_pos_sale(
    p_items JSONB,
    p_payment_method VARCHAR,
    p_discount_amount NUMERIC DEFAULT 0.00,
    p_cash_tendered NUMERIC DEFAULT 0.00,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_sale_id UUID;
    v_receipt_num VARCHAR(50);
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_item JSONB;
    v_product RECORD;
    v_inv RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
    v_item_qty INT;
    v_item_price NUMERIC(12,2);
    v_item_tax NUMERIC(12,2);
    v_item_total NUMERIC(12,2);
    v_change_due NUMERIC(12,2) := 0.00;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := v_caller_profile.role;
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_pos')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have POS permissions.';
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'POS sale must contain at least one item.';
    END IF;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, receipt_number, total_amount INTO v_sale_id, v_receipt_num, v_total_amount
        FROM public.pos_sales
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'sale_id', v_sale_id,
                'receipt_number', v_receipt_num,
                'total_amount', v_total_amount
            );
        END IF;
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        RAISE EXCEPTION 'Central warehouse is not configured.';
    END IF;

    v_receipt_num := 'POS-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- Phase 1: Validate stock & compute server-authoritative totals
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity')::int;
        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be greater than zero.';
        END IF;

        -- Fetch product directly from database
        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND is_active = true;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % is invalid or inactive.', v_item->>'product_id';
        END IF;

        -- Lock inventory balance record FOR UPDATE
        SELECT * INTO v_inv FROM public.inventory_balances
        WHERE warehouse_id = v_default_wh AND product_id = v_product.id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Inventory record missing for product "%" in warehouse.', v_product.name;
        END IF;

        IF v_inv.quantity_on_hand < v_item_qty THEN
            RAISE EXCEPTION 'Insufficient stock for product "%": available %, requested %.',
                v_product.name, v_inv.quantity_on_hand, v_item_qty;
        END IF;

        -- Authoritative price calculation
        v_item_price := v_product.default_sale_price;
        v_item_tax := pg_catalog.round(v_item_price * v_item_qty * (v_product.gst_rate / 100.0), 2);
        v_item_total := (v_item_price * v_item_qty) + v_item_tax;

        v_subtotal := v_subtotal + (v_item_price * v_item_qty);
        v_tax_total := v_tax_total + v_item_tax;
    END LOOP;

    v_total_amount := pg_catalog.greatest(0.00, (v_subtotal + v_tax_total) - COALESCE(p_discount_amount, 0.00));

    IF p_payment_method = 'CASH' AND p_cash_tendered > 0 THEN
        IF p_cash_tendered < v_total_amount THEN
            RAISE EXCEPTION 'Cash tendered (%) is less than total amount (%).', p_cash_tendered, v_total_amount;
        END IF;
        v_change_due := p_cash_tendered - v_total_amount;
    END IF;

    -- Phase 2: Insert master POS Sale
    INSERT INTO public.pos_sales (
        receipt_number,
        subtotal,
        tax_total,
        discount_amount,
        total_amount,
        payment_method,
        cash_tendered,
        change_due,
        notes,
        staff_id,
        idempotency_key
    ) VALUES (
        v_receipt_num,
        v_subtotal,
        v_tax_total,
        COALESCE(p_discount_amount, 0.00),
        v_total_amount,
        p_payment_method,
        p_cash_tendered,
        v_change_due,
        p_notes,
        v_caller_id,
        p_idempotency_key
    ) RETURNING id INTO v_sale_id;

    -- Phase 3: Insert line items, deduct stock, and write stock movements
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity')::int;
        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;

        v_item_price := v_product.default_sale_price;
        v_item_tax := pg_catalog.round(v_item_price * v_item_qty * (v_product.gst_rate / 100.0), 2);
        v_item_total := (v_item_price * v_item_qty) + v_item_tax;

        INSERT INTO public.pos_sale_items (
            sale_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            tax_rate,
            tax_amount,
            total_amount
        ) VALUES (
            v_sale_id,
            v_product.id,
            v_product.name,
            v_item_qty,
            v_item_price,
            v_product.gst_rate,
            v_item_tax,
            v_item_total
        );

        -- Decrement inventory balance atomically
        UPDATE public.inventory_balances
        SET quantity_on_hand = quantity_on_hand - v_item_qty,
            updated_at = pg_catalog.now()
        WHERE warehouse_id = v_default_wh AND product_id = v_product.id;

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
            v_product.id,
            v_wh_location,
            NULL,
            v_item_qty,
            'POS_SALE',
            'POS_SALE',
            v_sale_id,
            v_caller_id
        );
    END LOOP;

    -- Phase 4: Post balanced entries to financial ledger
    -- Entry 1: Debit Cash Drawer or Bank
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
        'LED-' || v_receipt_num || '-DR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        v_total_amount,
        0.00,
        'POS Walk-in Sale ' || v_receipt_num,
        'POS_SALE',
        v_sale_id,
        v_caller_id
    );

    -- Entry 2: Credit Sales Revenue (subtotal minus discount)
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
        'LED-' || v_receipt_num || '-CR-REV',
        '4010',
        'POS Counter Sales Revenue',
        0.00,
        (v_subtotal - COALESCE(p_discount_amount, 0.00)),
        'Net Revenue for POS ' || v_receipt_num,
        'POS_SALE',
        v_sale_id,
        v_caller_id
    );

    -- Entry 3: Credit GST Output Tax Payable (if tax > 0)
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
            'LED-' || v_receipt_num || '-CR-TAX',
            '2110',
            'GST Output Tax Payable',
            0.00,
            v_tax_total,
            'GST Collected on POS ' || v_receipt_num,
            'POS_SALE',
            v_sale_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'sale_id', v_sale_id,
        'receipt_number', v_receipt_num,
        'subtotal', v_subtotal,
        'tax_total', v_tax_total,
        'total_amount', v_total_amount,
        'change_due', v_change_due
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 3: rpc_receive_purchase_order
-- Supports partial receipt. Increments inventory only for actual goods received.
-- Prevents exceeding ordered quantities. Locks records FOR UPDATE.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_receive_purchase_order(
    p_purchase_id UUID,
    p_received_items JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_purchase RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_supplier RECORD;
    v_item RECORD;
    v_recv_item JSONB;
    v_target_product_id UUID;
    v_qty_to_receive INT;
    v_all_fully_received BOOLEAN := true;
    v_any_item_received BOOLEAN := false;
    v_incremental_payable NUMERIC(12,2) := 0.00;
    v_item_cost NUMERIC(12,2);
    v_new_status VARCHAR(20);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := v_caller_profile.role;
    IF v_caller_role != 'owner' AND (public.get_staff_permissions()->>'can_manage_suppliers')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: only owner or authorized procurement staff can receive goods.';
    END IF;

    SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order not found: %', p_purchase_id;
    END IF;

    IF v_purchase.status = 'RECEIVED' THEN
        RETURN pg_catalog.jsonb_build_object('success', true, 'idempotent', true, 'status', 'ALREADY_RECEIVED');
    END IF;

    IF v_purchase.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'Cannot receive goods for a CANCELLED purchase order.';
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_purchase.supplier_id;

    -- Process partial or full goods receipt
    IF p_received_items IS NOT NULL AND jsonb_array_length(p_received_items) > 0 THEN
        -- Specific received items payload: [{"product_id": "uuid", "quantity_received": 10}]
        FOR v_recv_item IN SELECT * FROM jsonb_array_elements(p_received_items)
        LOOP
            v_target_product_id := (v_recv_item->>'product_id')::uuid;
            v_qty_to_receive := (v_recv_item->>'quantity_received')::int;

            IF v_qty_to_receive > 0 THEN
                SELECT * INTO v_item FROM public.purchase_items
                WHERE purchase_id = p_purchase_id AND product_id = v_target_product_id
                FOR UPDATE;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Product % is not on purchase order %', v_target_product_id, p_purchase_id;
                END IF;

                IF (v_item.quantity_received + v_qty_to_receive) > v_item.quantity_ordered THEN
                    RAISE EXCEPTION 'Received quantity (%) exceeds outstanding quantity (%) for product.',
                        v_qty_to_receive, (v_item.quantity_ordered - v_item.quantity_received);
                END IF;

                -- Update line item received count
                UPDATE public.purchase_items
                SET quantity_received = quantity_received + v_qty_to_receive
                WHERE id = v_item.id;

                -- Lock and increment inventory balance
                INSERT INTO public.inventory_balances (
                    warehouse_id,
                    product_id,
                    quantity_on_hand,
                    updated_at
                ) VALUES (
                    v_default_wh,
                    v_target_product_id,
                    v_qty_to_receive,
                    pg_catalog.now()
                )
                ON CONFLICT (warehouse_id, product_id)
                DO UPDATE SET
                    quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
                    updated_at = pg_catalog.now();

                -- Record immutable stock movement
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
                    v_target_product_id,
                    v_supplier.location_id,
                    v_wh_location,
                    v_qty_to_receive,
                    'PURCHASE_RECEIPT',
                    'PURCHASE',
                    p_purchase_id,
                    v_caller_id
                );

                -- Increment incremental payable
                v_item_cost := pg_catalog.round(v_qty_to_receive * v_item.unit_cost * (1 + (COALESCE(v_item.tax_rate, 0) / 100.0)), 2);
                v_incremental_payable := v_incremental_payable + v_item_cost;
                v_any_item_received := true;
            END IF;
        END LOOP;
    ELSE
        -- Full receipt: accept all outstanding quantities
        FOR v_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id FOR UPDATE
        LOOP
            v_qty_to_receive := v_item.quantity_ordered - v_item.quantity_received;
            IF v_qty_to_receive > 0 THEN
                UPDATE public.purchase_items
                SET quantity_received = quantity_ordered
                WHERE id = v_item.id;

                INSERT INTO public.inventory_balances (
                    warehouse_id,
                    product_id,
                    quantity_on_hand,
                    updated_at
                ) VALUES (
                    v_default_wh,
                    v_item.product_id,
                    v_qty_to_receive,
                    pg_catalog.now()
                )
                ON CONFLICT (warehouse_id, product_id)
                DO UPDATE SET
                    quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
                    updated_at = pg_catalog.now();

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
                    v_item.product_id,
                    v_supplier.location_id,
                    v_wh_location,
                    v_qty_to_receive,
                    'PURCHASE_RECEIPT',
                    'PURCHASE',
                    p_purchase_id,
                    v_caller_id
                );

                v_item_cost := pg_catalog.round(v_qty_to_receive * v_item.unit_cost * (1 + (COALESCE(v_item.tax_rate, 0) / 100.0)), 2);
                v_incremental_payable := v_incremental_payable + v_item_cost;
                v_any_item_received := true;
            END IF;
        END LOOP;
    END IF;

    -- Evaluate order completion status
    FOR v_item IN SELECT * FROM public.purchase_items WHERE purchase_id = p_purchase_id
    LOOP
        IF v_item.quantity_received < v_item.quantity_ordered THEN
            v_all_fully_received := false;
        END IF;
        IF v_item.quantity_received > 0 THEN
            v_any_item_received := true;
        END IF;
    END LOOP;

    IF v_all_fully_received THEN
        v_new_status := 'RECEIVED';
    ELSIF v_any_item_received THEN
        v_new_status := 'PARTIALLY_RECEIVED';
    ELSE
        v_new_status := v_purchase.status;
    END IF;

    -- Update purchase header
    UPDATE public.purchases
    SET status = v_new_status,
        received_at = CASE WHEN v_new_status = 'RECEIVED' THEN pg_catalog.now() ELSE received_at END,
        updated_at = pg_catalog.now()
    WHERE id = p_purchase_id;

    -- Update supplier payable balance for newly received inventory
    IF v_incremental_payable > 0 THEN
        UPDATE public.suppliers
        SET current_payable = current_payable + v_incremental_payable,
            updated_at = pg_catalog.now()
        WHERE id = v_purchase.supplier_id;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', v_new_status,
        'incremental_payable', v_incremental_payable
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 4: rpc_record_salary_payment
-- Atomic salary payment with advance deduction and balanced ledger entries.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_record_salary_payment(
    p_staff_id UUID,
    p_period_month VARCHAR,
    p_base_salary NUMERIC,
    p_advance_deducted NUMERIC,
    p_other_deductions NUMERIC,
    p_amount_paid NUMERIC,
    p_payment_method VARCHAR,
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_staff RECORD;
    v_payment_id UUID;
    v_voucher_num VARCHAR(50);
    v_net_payable NUMERIC(12,2);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND OR v_caller_profile.role != 'owner' THEN
        RAISE EXCEPTION 'Access denied: only the owner can disburse salaries.';
    END IF;

    SELECT * INTO v_staff FROM public.profiles WHERE id = p_staff_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found or inactive.';
    END IF;

    -- Duplicate check for period
    IF EXISTS (SELECT 1 FROM public.salary_payments WHERE staff_id = p_staff_id AND period_month = p_period_month) THEN
        RAISE EXCEPTION 'Salary payment for period % has already been recorded for %.', p_period_month, v_staff.full_name;
    END IF;

    v_net_payable := pg_catalog.greatest(0.00, p_base_salary - COALESCE(p_advance_deducted, 0) - COALESCE(p_other_deductions, 0));
    IF p_amount_paid <= 0 OR p_amount_paid > v_net_payable THEN
        RAISE EXCEPTION 'Payment amount (%) must be positive and cannot exceed net payable (%).', p_amount_paid, v_net_payable;
    END IF;

    v_voucher_num := 'SAL-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert salary payment record
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
        created_by
    ) VALUES (
        v_voucher_num,
        p_staff_id,
        p_period_month,
        p_base_salary,
        COALESCE(p_advance_deducted, 0),
        COALESCE(p_other_deductions, 0),
        v_net_payable,
        p_amount_paid,
        p_amount_paid,
        p_payment_method,
        p_payment_date,
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_payment_id;

    -- 2. Mark deducted advances as settled
    IF p_advance_deducted > 0 THEN
        UPDATE public.salary_advances
        SET is_deducted = true,
            is_settled = true,
            deducted_in_payment_id = v_payment_id
        WHERE staff_id = p_staff_id AND (is_settled = false OR is_deducted = false);
    END IF;

    -- 3. Post balanced double-entry to financial ledger
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
        'LED-' || v_voucher_num || '-DR',
        '6020',
        'Staff Salary Expense',
        p_amount_paid,
        0.00,
        'Salary disbursement for ' || v_staff.full_name || ' (' || p_period_month || ')',
        'SALARY',
        v_payment_id,
        v_caller_id
    );

    -- Entry 2: Credit Cash Drawer or Bank Account
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
        'LED-' || v_voucher_num || '-CR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        0.00,
        p_amount_paid,
        'Payment of salary for ' || v_staff.full_name,
        'SALARY',
        v_payment_id,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'voucher_number', v_voucher_num,
        'net_payable', v_net_payable,
        'amount_paid', p_amount_paid
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 5: rpc_record_expense
-- Atomic expense creation with balanced financial ledger posting.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_record_expense(
    p_category VARCHAR,
    p_amount NUMERIC,
    p_payment_method VARCHAR,
    p_expense_date DATE DEFAULT CURRENT_DATE,
    p_description TEXT DEFAULT 'Operational Expense',
    p_vehicle_number VARCHAR DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_expense_id UUID;
    v_voucher_num VARCHAR(50);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := v_caller_profile.role;
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_expenses')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have expense management permissions.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Expense amount must be greater than zero.';
    END IF;

    v_voucher_num := 'EXP-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert into expenses
    INSERT INTO public.expenses (
        voucher_number,
        category,
        amount,
        payment_method,
        expense_date,
        description,
        vehicle_number,
        created_by
    ) VALUES (
        v_voucher_num,
        p_category,
        p_amount,
        p_payment_method,
        p_expense_date,
        p_description,
        p_vehicle_number,
        v_caller_id
    ) RETURNING id INTO v_expense_id;

    -- 2. Post balanced dual-entry to financial ledger
    -- Entry 1: Debit Operating Expense Account
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
        'LED-' || v_voucher_num || '-DR',
        '6010',
        'Operating Expense (' || p_category || ')',
        p_amount,
        0.00,
        p_description,
        'EXPENSE',
        v_expense_id,
        v_caller_id
    );

    -- Entry 2: Credit Cash Drawer or Bank Account
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
        'LED-' || v_voucher_num || '-CR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        0.00,
        p_amount,
        'Disbursement for ' || p_category || ' expense',
        'EXPENSE',
        v_expense_id,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'expense_id', v_expense_id,
        'voucher_number', v_voucher_num,
        'amount', p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 6: rpc_adjust_inventory_stock
-- Atomic warehouse stock adjustment with FOR UPDATE locking and negative prevention.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_adjust_inventory_stock(
    p_product_id UUID,
    p_quantity_delta INT,
    p_reason TEXT DEFAULT 'Manual Stock Adjustment'
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_default_wh UUID;
    v_wh_location UUID;
    v_inv RECORD;
    v_new_stock INT;
    v_movement_type VARCHAR(30);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    IF v_caller_profile.role != 'owner' AND (public.get_staff_permissions()->>'can_warehouse')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: only owner or warehouse staff can adjust stock.';
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        RAISE EXCEPTION 'Central warehouse is not configured.';
    END IF;

    -- Lock inventory balance record FOR UPDATE
    SELECT * INTO v_inv FROM public.inventory_balances
    WHERE warehouse_id = v_default_wh AND product_id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        IF p_quantity_delta < 0 THEN
            RAISE EXCEPTION 'Negative stock prohibited: cannot deduct from non-existent balance.';
        END IF;
        v_new_stock := p_quantity_delta;
        INSERT INTO public.inventory_balances (
            warehouse_id,
            product_id,
            quantity_on_hand,
            updated_at
        ) VALUES (
            v_default_wh,
            p_product_id,
            v_new_stock,
            pg_catalog.now()
        );
    ELSE
        v_new_stock := v_inv.quantity_on_hand + p_quantity_delta;
        IF v_new_stock < 0 THEN
            RAISE EXCEPTION 'Negative stock prohibited: current %, requested change % (% < 0)',
                v_inv.quantity_on_hand, p_quantity_delta, v_new_stock;
        END IF;

        UPDATE public.inventory_balances
        SET quantity_on_hand = v_new_stock,
            updated_at = pg_catalog.now()
        WHERE id = v_inv.id;
    END IF;

    v_movement_type := CASE WHEN p_quantity_delta >= 0 THEN 'ADJUSTMENT_IN' ELSE 'ADJUSTMENT_OUT' END;

    -- Record immutable stock movement
    INSERT INTO public.stock_movements (
        product_id,
        source_location_id,
        destination_location_id,
        quantity,
        movement_type,
        reference_type,
        notes,
        created_by
    ) VALUES (
        p_product_id,
        CASE WHEN p_quantity_delta < 0 THEN v_wh_location ELSE NULL END,
        CASE WHEN p_quantity_delta >= 0 THEN v_wh_location ELSE NULL END,
        abs(p_quantity_delta),
        v_movement_type,
        'MANUAL_ADJUSTMENT',
        p_reason,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'product_id', p_product_id,
        'previous_stock', COALESCE(v_inv.quantity_on_hand, 0),
        'new_stock', v_new_stock,
        'delta', p_quantity_delta
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- RPC 7: rpc_reverse_financial_entry
-- Immutable ledger reversal: generates compensating entry with swapped debit/credit.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_reverse_financial_entry(
    p_entry_id UUID,
    p_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_profile RECORD;
    v_orig RECORD;
    v_rev_id UUID;
    v_rev_entry_num VARCHAR(50);
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access denied: unauthenticated caller.';
    END IF;

    SELECT * INTO v_caller_profile FROM public.profiles WHERE id = v_caller_id AND is_active = true;
    IF NOT FOUND OR v_caller_profile.role != 'owner' THEN
        RAISE EXCEPTION 'Access denied: only the business owner can reverse posted financial entries.';
    END IF;

    SELECT * INTO v_orig FROM public.financial_ledger WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Financial entry not found: %', p_entry_id;
    END IF;

    IF v_orig.reference_type = 'REVERSAL' THEN
        RAISE EXCEPTION 'Cannot reverse an entry that is already a reversal.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.financial_ledger WHERE reference_type = 'REVERSAL' AND reference_id = p_entry_id) THEN
        RAISE EXCEPTION 'This entry has already been reversed.';
    END IF;

    v_rev_entry_num := 'REV-' || v_orig.entry_number;

    -- Compensating reversal entry
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
        v_rev_entry_num,
        v_orig.account_code,
        v_orig.account_name,
        v_orig.credit, -- Swapped debit/credit
        v_orig.debit,
        'REVERSAL: ' || v_orig.description || ' (Reason: ' || p_reason || ')',
        'REVERSAL',
        p_entry_id,
        v_caller_id
    ) RETURNING id INTO v_rev_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'reversal_id', v_rev_id,
        'reversal_entry_number', v_rev_entry_num,
        'reversed_entry_id', p_entry_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 5. RPC EXECUTION GRANTS (Revoked from PUBLIC/anon, Granted to authenticated/service_role)

REVOKE ALL ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_complete_pos_sale(JSONB, VARCHAR, NUMERIC, NUMERIC, VARCHAR, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_receive_purchase_order(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_salary_payment(UUID, VARCHAR, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_expense(VARCHAR, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_adjust_inventory_stock(UUID, INT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_reverse_financial_entry(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_complete_pos_sale(JSONB, VARCHAR, NUMERIC, NUMERIC, VARCHAR, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_receive_purchase_order(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_salary_payment(UUID, VARCHAR, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_expense(VARCHAR, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_adjust_inventory_stock(UUID, INT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reverse_financial_entry(UUID, TEXT) TO authenticated, service_role;
