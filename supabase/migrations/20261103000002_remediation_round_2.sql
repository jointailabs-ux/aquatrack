-- ==============================================================================
-- AquaTrack ERP — Migration: Remediation Round 2
-- Version: 20261103000002_remediation_round_2.sql
-- Description:
--   1. RLS & Policy Hardening: Enumerate and drop all unsafe foundation/legacy policies
--      across all 28 tables. Disallow direct writes to financial ledger, stock movements,
--      inventory balances, jar custody movements, delivery stops, and customer payments.
--   2. Delivery Stop & Jar Custody: Physical custody strict conservation, decoupled drops/returns,
--      row locking (FOR UPDATE), condition tracking without fabricated transitions,
--      and validation that customer jar holdings never become negative.
--   3. POS Module: Aggregate line quantities by product before stock check, row-locking FOR UPDATE,
--      strict payment method allowlist, server-side pricing/taxes, and stable idempotency keys.
--   4. Purchases Module: Atomic purchase order creation (rpc_create_purchase_order),
--      partial goods receipt with empty-array rejection, over-receipt prevention,
--      and atomic supplier payment with ledger posting (rpc_record_supplier_payment).
--   5. Salary Module: Partial advance deduction (FIFO), remove uq_staff_salary_period to support
--      legitimate partial salary disbursements, atomic advance disbursement (rpc_record_salary_advance),
--      and balanced accrual ledger entries.
--   6. Financial Ledger: Multi-line atomic journal reversal (rpc_reverse_financial_entry),
--      guaranteeing balanced debits and credits and linking to original transactions.
-- ==============================================================================

-- 1. SCHEMA REFINEMENTS & EXTENSIONS

-- 1.1 Support partial salary advance deductions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'salary_advances' AND column_name = 'amount_deducted'
    ) THEN
        ALTER TABLE public.salary_advances ADD COLUMN amount_deducted NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (amount_deducted >= 0);
        UPDATE public.salary_advances SET amount_deducted = amount WHERE is_settled = true OR is_deducted = true;
    END IF;
END $$;

-- 1.2 Remove single-payment restriction per period to support partial salary payments
ALTER TABLE public.salary_payments DROP CONSTRAINT IF EXISTS uq_staff_salary_period;

-- 1.3 Add idempotency key support to salary payments
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'salary_payments' AND column_name = 'idempotency_key'
    ) THEN
        ALTER TABLE public.salary_payments ADD COLUMN idempotency_key VARCHAR(100);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_salary_payments_idempotency ON public.salary_payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
    END IF;
END $$;

-- 1.4 Customer damaged jars holding tracking
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'total_damaged_jars_holding'
    ) THEN
        ALTER TABLE public.customers ADD COLUMN total_damaged_jars_holding INTEGER NOT NULL DEFAULT 0 CHECK (total_damaged_jars_holding >= 0);
    END IF;
END $$;

-- 1.5 Indexes on financial ledger for fast batch journal lookup
CREATE INDEX IF NOT EXISTS idx_financial_ledger_ref ON public.financial_ledger(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_reversed ON public.financial_ledger(reversed_entry_id);

-- 2. HARDENED SECURITY HELPER FUNCTIONS

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_active = true
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

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

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_staff_permissions() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_staff_permissions() TO authenticated, service_role;

-- 3. COMPLETE RLS POLICIES OVERHAUL ACROSS ALL 28 TABLES
-- Eradicate all loose USING (true) / WITH CHECK (true) policies and prevent direct-write bypasses.

-- Drop all existing policies
DROP POLICY IF EXISTS bs_select ON public.business_settings;
DROP POLICY IF EXISTS bs_modify ON public.business_settings;
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;
DROP POLICY IF EXISTS profiles_delete ON public.profiles;
DROP POLICY IF EXISTS loc_select ON public.locations;
DROP POLICY IF EXISTS loc_modify ON public.locations;
DROP POLICY IF EXISTS wh_select ON public.warehouses;
DROP POLICY IF EXISTS wh_modify ON public.warehouses;
DROP POLICY IF EXISTS cust_select ON public.customers;
DROP POLICY IF EXISTS cust_insert ON public.customers;
DROP POLICY IF EXISTS cust_update ON public.customers;
DROP POLICY IF EXISTS cust_delete ON public.customers;
DROP POLICY IF EXISTS supp_select ON public.suppliers;
DROP POLICY IF EXISTS supp_modify ON public.suppliers;
DROP POLICY IF EXISTS prod_select ON public.products;
DROP POLICY IF EXISTS prod_modify ON public.products;
DROP POLICY IF EXISTS csp_select ON public.customer_special_prices;
DROP POLICY IF EXISTS csp_modify ON public.customer_special_prices;
DROP POLICY IF EXISTS inv_select ON public.inventory_balances;
DROP POLICY IF EXISTS inv_modify ON public.inventory_balances;
DROP POLICY IF EXISTS sm_select ON public.stock_movements;
DROP POLICY IF EXISTS sm_insert ON public.stock_movements;
DROP POLICY IF EXISTS jcm_select ON public.jar_custody_movements;
DROP POLICY IF EXISTS jcm_insert ON public.jar_custody_movements;
DROP POLICY IF EXISTS orders_select ON public.orders;
DROP POLICY IF EXISTS orders_insert ON public.orders;
DROP POLICY IF EXISTS orders_update ON public.orders;
DROP POLICY IF EXISTS oi_select ON public.order_items;
DROP POLICY IF EXISTS oi_modify ON public.order_items;
DROP POLICY IF EXISTS ds_select ON public.delivery_stops;
DROP POLICY IF EXISTS ds_update ON public.delivery_stops;
DROP POLICY IF EXISTS ds_modify ON public.delivery_stops;
DROP POLICY IF EXISTS invs_select ON public.invoices;
DROP POLICY IF EXISTS invs_modify ON public.invoices;
DROP POLICY IF EXISTS invs_items_select ON public.invoice_items;
DROP POLICY IF EXISTS invs_items_modify ON public.invoice_items;
DROP POLICY IF EXISTS cp_select ON public.customer_payments;
DROP POLICY IF EXISTS cp_insert ON public.customer_payments;
DROP POLICY IF EXISTS pos_select ON public.pos_sales;
DROP POLICY IF EXISTS pos_insert ON public.pos_sales;
DROP POLICY IF EXISTS pos_items_select ON public.pos_sale_items;
DROP POLICY IF EXISTS pos_items_insert ON public.pos_sale_items;
DROP POLICY IF EXISTS purch_all ON public.purchases;
DROP POLICY IF EXISTS purch_items_all ON public.purchase_items;
DROP POLICY IF EXISTS supp_pay_all ON public.supplier_payments;
DROP POLICY IF EXISTS exp_select ON public.expenses;
DROP POLICY IF EXISTS exp_modify ON public.expenses;
DROP POLICY IF EXISTS sal_adv_select ON public.salary_advances;
DROP POLICY IF EXISTS sal_adv_modify ON public.salary_advances;
DROP POLICY IF EXISTS sal_pay_select ON public.salary_payments;
DROP POLICY IF EXISTS sal_pay_modify ON public.salary_payments;
DROP POLICY IF EXISTS ch_select ON public.cash_handovers;
DROP POLICY IF EXISTS ch_modify ON public.cash_handovers;
DROP POLICY IF EXISTS ledger_select ON public.financial_ledger;
DROP POLICY IF EXISTS audit_select ON public.audit_logs;

-- Enable and Force RLS on all tables
ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_special_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_special_prices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.jar_custody_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jar_custody_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_stops FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sales FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.salary_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_advances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_handovers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- 3.1 Business Settings
CREATE POLICY bs_select ON public.business_settings FOR SELECT TO authenticated
    USING (public.is_active_user());
CREATE POLICY bs_modify ON public.business_settings FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.2 Profiles
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
    USING (public.is_active_user() AND (public.get_user_role() = 'owner' OR id = auth.uid()));
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role() = 'owner');
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
    USING (public.is_active_user() AND (public.get_user_role() = 'owner' OR id = auth.uid()))
    WITH CHECK (public.is_active_user() AND (public.get_user_role() = 'owner' OR id = auth.uid()));
CREATE POLICY profiles_delete ON public.profiles FOR DELETE TO authenticated
    USING (public.get_user_role() = 'owner');

-- 3.3 Locations
CREATE POLICY loc_select ON public.locations FOR SELECT TO authenticated
    USING (public.is_active_user());
CREATE POLICY loc_modify ON public.locations FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.4 Warehouses
CREATE POLICY wh_select ON public.warehouses FOR SELECT TO authenticated
    USING (public.is_active_user());
CREATE POLICY wh_modify ON public.warehouses FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.5 Customers (Strict Permission-Aware Access)
CREATE POLICY cust_select ON public.customers FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR
            (public.get_staff_permissions()->>'can_manage_customers')::boolean = true OR
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true OR
            (public.get_staff_permissions()->>'can_deliveries')::boolean = true OR
            (public.get_staff_permissions()->>'can_pos')::boolean = true
        )
    );
CREATE POLICY cust_insert ON public.customers FOR INSERT TO authenticated
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_customers')::boolean = true
        )
    );
CREATE POLICY cust_update ON public.customers FOR UPDATE TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_customers')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_customers')::boolean = true
        )
    );
CREATE POLICY cust_delete ON public.customers FOR DELETE TO authenticated
    USING (public.get_user_role() = 'owner');

-- 3.6 Suppliers
CREATE POLICY supp_select ON public.suppliers FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true OR
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true
        )
    );
CREATE POLICY supp_modify ON public.suppliers FOR ALL TO authenticated
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

-- 3.7 Products
CREATE POLICY prod_select ON public.products FOR SELECT TO authenticated
    USING (public.is_active_user());
CREATE POLICY prod_modify ON public.products FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.8 Customer Special Prices
CREATE POLICY csp_select ON public.customer_special_prices FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_customers')::boolean = true OR
            (public.get_staff_permissions()->>'can_pos')::boolean = true OR
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY csp_modify ON public.customer_special_prices FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.9 Inventory Balances (Read Only for Authorized Roles; Direct Writes Disallowed)
CREATE POLICY inv_select ON public.inventory_balances FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true OR
            (public.get_staff_permissions()->>'can_pos')::boolean = true
        )
    );
-- No direct INSERT, UPDATE, or DELETE policy for authenticated staff. Updates handled exclusively via RPCs.

-- 3.10 Stock Movements (Read Only; Direct Writes Disallowed)
CREATE POLICY sm_select ON public.stock_movements FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_warehouse')::boolean = true
        )
    );
-- No direct INSERT, UPDATE, or DELETE policy for authenticated staff. Movements recorded exclusively via validated RPCs.

-- 3.11 Jar Custody Movements
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
-- No UPDATE or DELETE policy. Jar custody ledger is immutable append-only.

-- 3.12 Customer Orders & Order Items
CREATE POLICY orders_select ON public.orders FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            assigned_staff_id = auth.uid() OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY orders_insert ON public.orders FOR INSERT TO authenticated
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY orders_update ON public.orders FOR UPDATE TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );

CREATE POLICY oi_select ON public.order_items FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_items.order_id
            AND (public.get_user_role() = 'owner' OR o.assigned_staff_id = auth.uid() OR (public.get_staff_permissions()->>'can_manage_orders')::boolean = true)
        )
    );
CREATE POLICY oi_modify ON public.order_items FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );

-- 3.13 Delivery Stops
CREATE POLICY ds_select ON public.delivery_stops FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            assigned_staff_id = auth.uid() OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY ds_insert ON public.delivery_stops FOR INSERT TO authenticated
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY ds_modify ON public.delivery_stops FOR UPDATE TO authenticated
    USING (public.is_active_user() AND public.get_user_role() = 'owner')
    WITH CHECK (public.is_active_user() AND public.get_user_role() = 'owner');
-- Staff execution of delivery stops is strictly governed by rpc_execute_delivery_stop.

-- 3.14 Invoices & Invoice Items
CREATE POLICY invs_select ON public.invoices FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY invs_modify ON public.invoices FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );

CREATE POLICY invs_items_select ON public.invoice_items FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
CREATE POLICY invs_items_modify ON public.invoice_items FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );

-- 3.15 Customer Payments
CREATE POLICY cp_select ON public.customer_payments FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            collected_by_staff_id = auth.uid() OR 
            (public.get_staff_permissions()->>'can_manage_orders')::boolean = true
        )
    );
-- Direct client inserts disallowed. Customer payments recorded exclusively via RPC or owner.
CREATE POLICY cp_modify ON public.customer_payments FOR ALL TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');

-- 3.16 POS Sales & Items
CREATE POLICY pos_select ON public.pos_sales FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid()
        )
    );
-- Direct inserts disallowed; POS completed exclusively via rpc_complete_pos_sale.

CREATE POLICY pos_items_select ON public.pos_sale_items FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            EXISTS (SELECT 1 FROM public.pos_sales ps WHERE ps.id = pos_sale_items.sale_id AND ps.staff_id = auth.uid())
        )
    );
-- Direct inserts disallowed; line items created exclusively via rpc_complete_pos_sale.

-- 3.17 Purchases & Purchase Items
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

-- 3.18 Supplier Payments
CREATE POLICY supp_pay_select ON public.supplier_payments FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_suppliers')::boolean = true
        )
    );
-- Direct inserts disallowed; recorded atomically via rpc_record_supplier_payment.

-- 3.19 Expenses
CREATE POLICY exp_select ON public.expenses FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            (public.get_staff_permissions()->>'can_manage_expenses')::boolean = true
        )
    );
CREATE POLICY exp_modify ON public.expenses FOR UPDATE TO authenticated
    USING (public.get_user_role() = 'owner') WITH CHECK (public.get_user_role() = 'owner');
-- Direct inserts disallowed; created exclusively via rpc_record_expense.

-- 3.20 Salary Advances & Salary Payments
CREATE POLICY sal_adv_select ON public.salary_advances FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid() OR
            (public.get_staff_permissions()->>'can_manage_salaries')::boolean = true
        )
    );
-- Direct inserts disallowed; advances created via rpc_record_salary_advance.

CREATE POLICY sal_pay_select ON public.salary_payments FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid() OR
            (public.get_staff_permissions()->>'can_manage_salaries')::boolean = true
        )
    );
-- Direct inserts disallowed; disbursements created via rpc_record_salary_payment.

-- 3.21 Driver Cash Handovers
CREATE POLICY ch_select ON public.cash_handovers FOR SELECT TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid()
        )
    );
CREATE POLICY ch_modify ON public.cash_handovers FOR ALL TO authenticated
    USING (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid()
        )
    )
    WITH CHECK (
        public.is_active_user() AND (
            public.get_user_role() = 'owner' OR 
            staff_id = auth.uid()
        )
    );

-- 3.22 Financial Ledger & Audit Logs (Strictly Owner Only; Immutable)
CREATE POLICY ledger_select ON public.financial_ledger FOR SELECT TO authenticated
    USING (public.is_active_user() AND public.get_user_role() = 'owner');
-- No INSERT, UPDATE, or DELETE policy for authenticated. Entries posted strictly via validated RPCs.

CREATE POLICY audit_select ON public.audit_logs FOR SELECT TO authenticated
    USING (public.is_active_user() AND public.get_user_role() = 'owner');
-- No INSERT, UPDATE, or DELETE policy for authenticated.

-- ==============================================================================
-- 4. ATOMIC, VALIDATED BUSINESS TRANSACTION RPCS
-- ==============================================================================

-- 4.1 RPC: rpc_execute_delivery_stop
-- Strictly enforces jar physical conservation, row-locking (FOR UPDATE),
-- non-negative customer holdings, actual condition tracking, and balanced ledger.
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
    v_current_total_custody INT := 0;
    v_total_returning INT := 0;
    v_new_full_holding INT := 0;
    v_new_empty_holding INT := 0;
    v_new_damaged_holding INT := 0;
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

    -- Validate input non-negativity
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

    -- Verify assignment: assigned staff can only execute their own stops
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

    -- Handle explicit failure report
    IF p_failure_reason IS NOT NULL AND p_actual_delivered = 0 THEN
        UPDATE public.delivery_stops
        SET status = 'FAILED',
            failure_reason = p_failure_reason,
            executed_at = pg_catalog.now(),
            updated_at = pg_catalog.now()
        WHERE id = p_stop_id;

        RETURN pg_catalog.jsonb_build_object('success', true, 'status', 'FAILED');
    END IF;

    -- Lock order and customer records FOR UPDATE
    SELECT * INTO v_order FROM public.orders WHERE id = v_stop.order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent order % not found.', v_stop.order_id;
    END IF;

    SELECT * INTO v_customer FROM public.customers WHERE id = v_order.customer_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer % not found.', v_order.customer_id;
    END IF;

    -- Validate delivered quantity against order items remaining
    SELECT COALESCE(SUM(quantity), 0) INTO v_total_ordered_qty
    FROM public.order_items WHERE order_id = v_order.id;

    IF p_actual_delivered > v_total_ordered_qty THEN
        RAISE EXCEPTION 'Delivered quantity (%) exceeds remaining ordered quantity (%).',
            p_actual_delivered, v_total_ordered_qty;
    END IF;

    -- Validate payment method and amount
    IF p_payment_amount > 0 THEN
        IF p_payment_method IS NULL OR p_payment_method NOT IN ('CASH', 'UPI', 'CREDIT') THEN
            RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, CREDIT.', p_payment_method;
        END IF;
        IF p_payment_method = 'CREDIT' THEN
            RAISE EXCEPTION 'Payment amount cannot be positive when payment method is CREDIT.';
        END IF;
        IF p_payment_amount > v_order.total_amount THEN
            RAISE EXCEPTION 'Payment amount (%) exceeds order total amount (%).', p_payment_amount, v_order.total_amount;
        END IF;
    END IF;

    -- Resolve required custody entities
    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    SELECT id INTO v_default_jar_id FROM public.products WHERE is_reusable_jar = true LIMIT 1;

    IF v_default_jar_id IS NULL THEN
        RAISE EXCEPTION 'Reusable jar product configuration is missing.';
    END IF;
    IF v_wh_location IS NULL THEN
        RAISE EXCEPTION 'Central warehouse location is not configured.';
    END IF;
    IF v_customer.location_id IS NULL THEN
        RAISE EXCEPTION 'Customer physical location is not configured.';
    END IF;

    -- 1. Physical Jar Custody Conservation & Validation
    v_current_total_custody := v_customer.total_full_jars_holding + v_customer.total_empty_jars_holding + COALESCE(v_customer.total_damaged_jars_holding, 0);
    v_total_returning := p_empty_jars + p_damaged_jars;

    IF v_total_returning > v_current_total_custody THEN
        RAISE EXCEPTION 'Invalid physical return: customer holds % jars, but attempted to return % jars.',
            v_current_total_custody, v_total_returning;
    END IF;

    -- Customer full holding increases with fresh drops
    v_new_full_holding := v_customer.total_full_jars_holding + p_actual_delivered;

    -- Empty/damaged jars returned deduct from customer custody
    IF v_customer.total_empty_jars_holding >= p_empty_jars THEN
        v_new_empty_holding := v_customer.total_empty_jars_holding - p_empty_jars;
    ELSE
        -- Emptied full jars returned
        v_new_full_holding := v_new_full_holding - (p_empty_jars - v_customer.total_empty_jars_holding);
        v_new_empty_holding := 0;
    END IF;

    -- Damaged jars deduction
    v_new_damaged_holding := COALESCE(v_customer.total_damaged_jars_holding, 0);
    IF p_damaged_jars > 0 THEN
        IF v_new_damaged_holding >= p_damaged_jars THEN
            v_new_damaged_holding := v_new_damaged_holding - p_damaged_jars;
        ELSE
            -- Damaged during customer usage: deduct remainder from empty/full holding
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

    -- Update customer holdings atomically
    UPDATE public.customers
    SET total_full_jars_holding = v_new_full_holding,
        total_empty_jars_holding = v_new_empty_holding,
        total_damaged_jars_holding = v_new_damaged_holding,
        updated_at = pg_catalog.now()
    WHERE id = v_customer.id;

    -- 2. Log Immutable Jar Custody Movements
    IF p_actual_delivered > 0 THEN
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
        -- Condition from customer is DAMAGED_REPAIRABLE; no fabricated EMPTY_DIRTY transition
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
            p_payment_method,
            v_caller_id,
            'Route stop payment'
        );

        UPDATE public.customers
        SET current_balance = current_balance - p_payment_amount,
            updated_at = pg_catalog.now()
        WHERE id = v_customer.id;

        -- Balanced dual-entry posting
        -- Entry 1: Debit Cash Float with Driver (or Bank Current Account if UPI)
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

    -- 4. Finalize stop and order records
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

    UPDATE public.orders
    SET status = 'DELIVERED',
        payment_status = CASE 
            WHEN p_payment_amount >= total_amount THEN 'PAID'
            WHEN p_payment_amount > 0 THEN 'PARTIALLY_PAID'
            ELSE payment_status 
        END,
        updated_at = pg_catalog.now()
    WHERE id = v_order.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', 'COMPLETED',
        'delivered', p_actual_delivered,
        'empty_collected', p_empty_jars,
        'damaged_collected', p_damaged_jars,
        'customer_closing_holding', (v_new_full_holding + v_new_empty_holding + v_new_damaged_holding)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.2 RPC: rpc_complete_pos_sale
-- Aggregates quantities by product before stock checks to prevent multi-line stock bypass.
-- Locks inventory balances FOR UPDATE. Strictly validates payment allowlist, recalculates
-- server-side prices/taxes, and balances the financial ledger.
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
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_agg RECORD;
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
    v_change_due NUMERIC(12,2) := 0.00;
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

    IF v_caller_role != 'owner' AND (v_perms->>'can_pos')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have POS execution authority.';
    END IF;

    -- Strict payment method allowlist
    IF p_payment_method NOT IN ('CASH', 'UPI', 'CARD') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, CARD.', p_payment_method;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'POS sale must contain at least one item.';
    END IF;

    -- Idempotency protection against network retries
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, receipt_number, total_amount, subtotal, tax_total, change_due
        INTO v_sale_id, v_receipt_num, v_total_amount, v_subtotal, v_tax_total, v_change_due
        FROM public.pos_sales
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'sale_id', v_sale_id,
                'receipt_number', v_receipt_num,
                'subtotal', v_subtotal,
                'tax_total', v_tax_total,
                'total_amount', v_total_amount,
                'change_due', v_change_due
            );
        END IF;
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        RAISE EXCEPTION 'Central warehouse is not configured.';
    END IF;

    -- PHASE 1: AGGREGATE QUANTITIES BY PRODUCT AND LOCK INVENTORY BALANCES FOR UPDATE
    -- Prevents multi-line bypass where multiple lines individually pass stock checks.
    FOR v_agg IN 
        SELECT 
            (elem->>'product_id')::uuid AS product_id,
            SUM((elem->>'quantity')::int) AS total_qty
        FROM jsonb_array_elements(p_items) AS elem
        GROUP BY (elem->>'product_id')::uuid
    LOOP
        IF v_agg.total_qty <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be greater than zero.';
        END IF;

        -- Verify product from master catalog
        SELECT * INTO v_product FROM public.products WHERE id = v_agg.product_id AND is_active = true;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % is invalid or inactive.', v_agg.product_id;
        END IF;

        -- Lock inventory balance record FOR UPDATE
        SELECT * INTO v_inv FROM public.inventory_balances
        WHERE warehouse_id = v_default_wh AND product_id = v_product.id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Inventory record missing for product "%" in warehouse.', v_product.name;
        END IF;

        IF v_inv.quantity_on_hand < v_agg.total_qty THEN
            RAISE EXCEPTION 'Insufficient stock for product "%": available %, requested %.',
                v_product.name, v_inv.quantity_on_hand, v_agg.total_qty;
        END IF;
    END LOOP;

    -- PHASE 2: SERVER-SIDE AUTHORITATIVE PRICING & TAX CALCULATION
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity')::int;
        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item quantity must be greater than zero.';
        END IF;

        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
        v_item_price := v_product.default_sale_price;
        IF v_item_price < 0 THEN
            RAISE EXCEPTION 'Product sale price cannot be negative.';
        END IF;

        v_item_tax := pg_catalog.round(v_item_price * v_item_qty * (COALESCE(v_product.gst_rate, 0.00) / 100.0), 2);
        v_subtotal := v_subtotal + (v_item_price * v_item_qty);
        v_tax_total := v_tax_total + v_item_tax;
    END LOOP;

    IF p_discount_amount < 0 THEN
        RAISE EXCEPTION 'Discount amount cannot be negative.';
    END IF;

    IF p_discount_amount > v_subtotal THEN
        RAISE EXCEPTION 'Discount amount (%) cannot exceed subtotal (%).', p_discount_amount, v_subtotal;
    END IF;

    v_total_amount := (v_subtotal + v_tax_total) - COALESCE(p_discount_amount, 0.00);
    IF v_total_amount < 0 THEN
        RAISE EXCEPTION 'Sale total amount cannot be negative.';
    END IF;

    -- Validate cash tendered
    IF p_payment_method = 'CASH' THEN
        IF p_cash_tendered < v_total_amount THEN
            RAISE EXCEPTION 'Cash tendered (%) is less than total amount (%).', p_cash_tendered, v_total_amount;
        END IF;
        v_change_due := p_cash_tendered - v_total_amount;
    ELSE
        p_cash_tendered := v_total_amount;
        v_change_due := 0.00;
    END IF;

    v_receipt_num := 'POS-' || pg_catalog.to_char(pg_catalog.now(), 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- PHASE 3: INSERT MASTER POS SALE RECORD
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

    -- PHASE 4: INSERT LINE ITEMS, ATOMICALLY DEDUCT INVENTORY, AND LOG MOVEMENTS
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity')::int;
        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
        v_item_price := v_product.default_sale_price;
        v_item_tax := pg_catalog.round(v_item_price * v_item_qty * (COALESCE(v_product.gst_rate, 0.00) / 100.0), 2);

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
            COALESCE(v_product.gst_rate, 0.00),
            v_item_tax,
            (v_item_price * v_item_qty) + v_item_tax
        );

        -- Atomically decrement warehouse stock
        UPDATE public.inventory_balances
        SET quantity_on_hand = quantity_on_hand - v_item_qty,
            updated_at = pg_catalog.now()
        WHERE warehouse_id = v_default_wh AND product_id = v_product.id;

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

    -- PHASE 5: BALANCED DOUBLE-ENTRY FINANCIAL LEDGER POSTING
    -- Entry 1: Debit Cash Drawer or Bank Current Account
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

-- 4.3 RPC: rpc_create_purchase_order
-- Atomically inserts purchase order header and line items within a single database transaction.
CREATE OR REPLACE FUNCTION public.rpc_create_purchase_order(
    p_supplier_id UUID,
    p_purchase_date DATE,
    p_invoice_number VARCHAR DEFAULT NULL,
    p_status VARCHAR DEFAULT 'ORDERED',
    p_items JSONB DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_po_number VARCHAR DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_purchase_id UUID;
    v_po_number VARCHAR(50);
    v_supplier RECORD;
    v_item JSONB;
    v_product RECORD;
    v_item_qty INT;
    v_unit_cost NUMERIC(12,2);
    v_tax_rate NUMERIC(5,2);
    v_tax_amount NUMERIC(12,2);
    v_line_total NUMERIC(12,2);
    v_subtotal NUMERIC(12,2) := 0.00;
    v_tax_total NUMERIC(12,2) := 0.00;
    v_total_amount NUMERIC(12,2) := 0.00;
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

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_suppliers')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have purchase management authority.';
    END IF;

    SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_supplier_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Supplier % not found or inactive.', p_supplier_id;
    END IF;

    IF p_status NOT IN ('DRAFT', 'ORDERED') THEN
        RAISE EXCEPTION 'Initial purchase status must be DRAFT or ORDERED, received %.', p_status;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Purchase order must contain at least one item.';
    END IF;

    -- Validate line items & calculate totals
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity_ordered')::int;
        v_unit_cost := (v_item->>'unit_cost')::numeric;
        v_tax_rate := COALESCE((v_item->>'gst_rate')::numeric, (v_item->>'tax_rate')::numeric, 0.00);

        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Item ordered quantity must be greater than zero.';
        END IF;
        IF v_unit_cost < 0 THEN
            RAISE EXCEPTION 'Item unit cost cannot be negative.';
        END IF;

        SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND is_active = true;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % is invalid or inactive.', v_item->>'product_id';
        END IF;

        v_tax_amount := pg_catalog.round((v_item_qty * v_unit_cost) * (v_tax_rate / 100.0), 2);
        v_line_total := (v_item_qty * v_unit_cost) + v_tax_amount;

        v_subtotal := v_subtotal + (v_item_qty * v_unit_cost);
        v_tax_total := v_tax_total + v_tax_amount;
    END LOOP;

    v_total_amount := v_subtotal + v_tax_total;

    v_po_number := COALESCE(
        p_po_number,
        'PO-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6)
    );

    -- 1. Insert Master Purchase Header
    INSERT INTO public.purchases (
        po_number,
        supplier_id,
        invoice_number,
        status,
        payment_status,
        subtotal,
        tax_total,
        total_amount,
        total_cost,
        amount_paid,
        balance_due,
        purchase_date,
        notes,
        created_by
    ) VALUES (
        v_po_number,
        p_supplier_id,
        p_invoice_number,
        p_status,
        'UNPAID',
        v_subtotal,
        v_tax_total,
        v_total_amount,
        v_total_amount,
        0.00,
        v_total_amount,
        COALESCE(p_purchase_date, CURRENT_DATE),
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_purchase_id;

    -- 2. Insert Purchase Line Items Atomically
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_qty := (v_item->>'quantity_ordered')::int;
        v_unit_cost := (v_item->>'unit_cost')::numeric;
        v_tax_rate := COALESCE((v_item->>'gst_rate')::numeric, (v_item->>'tax_rate')::numeric, 0.00);
        v_tax_amount := pg_catalog.round((v_item_qty * v_unit_cost) * (v_tax_rate / 100.0), 2);
        v_line_total := (v_item_qty * v_unit_cost) + v_tax_amount;

        INSERT INTO public.purchase_items (
            purchase_id,
            product_id,
            quantity_ordered,
            quantity_received,
            unit_cost,
            tax_rate,
            gst_rate,
            tax_amount,
            total_cost,
            total_amount
        ) VALUES (
            v_purchase_id,
            (v_item->>'product_id')::uuid,
            v_item_qty,
            0,
            v_unit_cost,
            v_tax_rate,
            v_tax_rate,
            v_tax_amount,
            v_line_total,
            v_line_total
        );
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'purchase_id', v_purchase_id,
        'po_number', v_po_number,
        'total_amount', v_total_amount,
        'status', p_status
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.4 RPC: rpc_receive_purchase_order
-- Supports partial or full goods receipt. Rejects empty receipt arrays.
-- Enforces row-locking, increments inventory only for actual received quantities,
-- prevents over-receipt, records stock movements, updates supplier payable,
-- and posts balanced inventory / accounts payable ledger entries.
CREATE OR REPLACE FUNCTION public.rpc_receive_purchase_order(
    p_purchase_id UUID,
    p_received_items JSONB DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_purchase RECORD;
    v_caller_role VARCHAR;
    v_caller_id UUID;
    v_perms JSONB;
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

    IF NOT public.is_active_user() THEN
        RAISE EXCEPTION 'Access denied: caller does not have an active profile.';
    END IF;

    v_caller_role := public.get_user_role();
    v_perms := public.get_staff_permissions();

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_suppliers')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have goods receipt authority.';
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

    -- Strict rejection of empty receipt array
    IF p_received_items IS NOT NULL AND jsonb_array_length(p_received_items) = 0 THEN
        RAISE EXCEPTION 'Receipt items list cannot be empty. Specify items and quantities to receive.';
    END IF;

    SELECT id, location_id INTO v_default_wh, v_wh_location FROM public.warehouses WHERE is_default = true LIMIT 1;
    IF v_default_wh IS NULL THEN
        RAISE EXCEPTION 'Central warehouse is not configured.';
    END IF;

    SELECT * INTO v_supplier FROM public.suppliers WHERE id = v_purchase.supplier_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Supplier % not found.', v_purchase.supplier_id;
    END IF;

    IF p_received_items IS NOT NULL THEN
        -- Specific received items payload
        FOR v_recv_item IN SELECT * FROM jsonb_array_elements(p_received_items)
        LOOP
            v_target_product_id := (v_recv_item->>'product_id')::uuid;
            v_qty_to_receive := (v_recv_item->>'quantity_received')::int;

            IF v_qty_to_receive <= 0 THEN
                RAISE EXCEPTION 'Received quantity must be greater than zero.';
            END IF;

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

    -- Update supplier payable balance
    IF v_incremental_payable > 0 THEN
        UPDATE public.suppliers
        SET current_payable = current_payable + v_incremental_payable,
            updated_at = pg_catalog.now()
        WHERE id = v_purchase.supplier_id;

        -- Post balanced double-entry accounting to financial ledger
        -- Entry 1: Debit Warehouse Inventory Asset
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
            'LED-PO-' || pg_catalog.substr(p_purchase_id::text, 1, 8) || '-RECV-' || pg_catalog.substr(gen_random_uuid()::text, 1, 4) || '-DR',
            '1040',
            'Warehouse Inventory Asset',
            v_incremental_payable,
            0.00,
            'Inventory receipt for PO ' || v_purchase.po_number,
            'PURCHASE',
            p_purchase_id,
            v_caller_id
        );

        -- Entry 2: Credit Accounts Payable (Supplier Liability)
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
            'LED-PO-' || pg_catalog.substr(p_purchase_id::text, 1, 8) || '-RECV-' || pg_catalog.substr(gen_random_uuid()::text, 1, 4) || '-CR',
            '2010',
            'Accounts Payable',
            0.00,
            v_incremental_payable,
            'Supplier liability for PO ' || v_purchase.po_number || ' (' || v_supplier.name || ')',
            'PURCHASE',
            p_purchase_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'status', v_new_status,
        'incremental_payable', v_incremental_payable
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.5 RPC: rpc_record_supplier_payment
-- Atomically registers supplier payment, decrements current_payable, updates purchase balance,
-- and posts balanced double-entry entries to the financial ledger.
CREATE OR REPLACE FUNCTION public.rpc_record_supplier_payment(
    p_supplier_id UUID,
    p_purchase_id UUID DEFAULT NULL,
    p_amount NUMERIC DEFAULT 0.00,
    p_payment_method VARCHAR DEFAULT 'BANK_TRANSFER',
    p_payment_date DATE DEFAULT CURRENT_DATE,
    p_reference_number VARCHAR DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_supplier RECORD;
    v_purchase RECORD;
    v_payment_id UUID;
    v_payment_num VARCHAR(50);
    v_new_paid NUMERIC(12,2);
    v_new_balance NUMERIC(12,2);
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

    IF v_caller_role != 'owner' AND (v_perms->>'can_manage_suppliers')::boolean != true THEN
        RAISE EXCEPTION 'Access denied: caller does not have supplier payment authority.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero.';
    END IF;

    IF p_payment_method NOT IN ('CASH', 'UPI', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, BANK_TRANSFER.', p_payment_method;
    END IF;

    -- Lock supplier record FOR UPDATE
    SELECT * INTO v_supplier FROM public.suppliers WHERE id = p_supplier_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Supplier % not found.', p_supplier_id;
    END IF;

    v_payment_num := 'SPAY-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert Supplier Payment Record
    INSERT INTO public.supplier_payments (
        payment_number,
        supplier_id,
        purchase_id,
        amount,
        payment_method,
        payment_date,
        reference_number,
        notes,
        created_by
    ) VALUES (
        v_payment_num,
        p_supplier_id,
        p_purchase_id,
        p_amount,
        p_payment_method,
        COALESCE(p_payment_date, CURRENT_DATE),
        p_reference_number,
        p_notes,
        v_caller_id
    ) RETURNING id INTO v_payment_id;

    -- 2. Decrement supplier payable balance
    UPDATE public.suppliers
    SET current_payable = pg_catalog.greatest(0.00, current_payable - p_amount),
        updated_at = pg_catalog.now()
    WHERE id = p_supplier_id;

    -- 3. If tied to a specific purchase order, update amount_paid & balance_due
    IF p_purchase_id IS NOT NULL THEN
        SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
        IF FOUND THEN
            v_new_paid := v_purchase.amount_paid + p_amount;
            v_new_balance := pg_catalog.greatest(0.00, v_purchase.total_amount - v_new_paid);

            UPDATE public.purchases
            SET amount_paid = v_new_paid,
                balance_due = v_new_balance,
                payment_status = CASE 
                    WHEN v_new_paid >= total_amount THEN 'PAID'
                    ELSE 'PARTIALLY_PAID'
                END,
                updated_at = pg_catalog.now()
            WHERE id = p_purchase_id;
        END IF;
    END IF;

    -- 4. Balanced double-entry financial ledger posting
    -- Entry 1: Debit Accounts Payable (reduces supplier liability)
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
        '2010',
        'Accounts Payable',
        p_amount,
        0.00,
        'Payment to supplier ' || v_supplier.name || ' (' || v_payment_num || ')',
        'PURCHASE',
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
        'LED-' || v_payment_num || '-CR',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        0.00,
        p_amount,
        'Disbursement for supplier payment ' || v_payment_num,
        'PURCHASE',
        v_payment_id,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'payment_number', v_payment_num,
        'amount', p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.6 RPC: rpc_record_salary_advance
-- Atomically registers a staff salary advance and writes balanced double-entry ledger impact.
CREATE OR REPLACE FUNCTION public.rpc_record_salary_advance(
    p_staff_id UUID,
    p_amount NUMERIC,
    p_payment_method VARCHAR DEFAULT 'CASH',
    p_advance_date DATE DEFAULT CURRENT_DATE,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_perms JSONB;
    v_staff RECORD;
    v_advance_id UUID;
    v_voucher_num VARCHAR(50);
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
        RAISE EXCEPTION 'Access denied: only owner or salary manager can disburse advances.';
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Advance amount must be greater than zero.';
    END IF;

    IF p_payment_method NOT IN ('CASH', 'UPI', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, BANK_TRANSFER.', p_payment_method;
    END IF;

    SELECT * INTO v_staff FROM public.profiles WHERE id = p_staff_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member % not found or inactive.', p_staff_id;
    END IF;

    v_voucher_num := 'ADV-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert Salary Advance Record
    INSERT INTO public.salary_advances (
        staff_id,
        amount,
        amount_deducted,
        payment_method,
        advance_date,
        reason,
        notes,
        is_settled,
        is_deducted,
        created_by
    ) VALUES (
        p_staff_id,
        p_amount,
        0.00,
        p_payment_method,
        COALESCE(p_advance_date, CURRENT_DATE),
        p_notes,
        p_notes,
        false,
        false,
        v_caller_id
    ) RETURNING id INTO v_advance_id;

    -- 2. Balanced Double-Entry Financial Ledger Posting
    -- Entry 1: Debit Staff Advance Receivable Asset
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
        '1310',
        'Staff Advance Receivable',
        p_amount,
        0.00,
        'Advance disbursed to ' || v_staff.full_name,
        'SALARY',
        v_advance_id,
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
        'Disbursement of advance ' || v_voucher_num,
        'SALARY',
        v_advance_id,
        v_caller_id
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'advance_id', v_advance_id,
        'voucher_number', v_voucher_num,
        'amount', p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.7 RPC: rpc_record_salary_payment
-- Supports legitimate partial salary payments within the same month.
-- Deducts salary advances accurately via FIFO row-locking without blanket settlement.
-- Enforces idempotency, locks outstanding advances, and writes balanced double-entry postings.
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
    v_payment_id UUID;
    v_voucher_num VARCHAR(50);
    v_prev_paid NUMERIC(12,2) := 0.00;
    v_prev_adv NUMERIC(12,2) := 0.00;
    v_prev_other NUMERIC(12,2) := 0.00;
    v_total_settled_so_far NUMERIC(12,2) := 0.00;
    v_outstanding_payable NUMERIC(12,2) := 0.00;
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

    SELECT * INTO v_staff FROM public.profiles WHERE id = p_staff_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found or inactive.';
    END IF;

    -- Idempotency check
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

    IF p_amount_paid <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be greater than zero.';
    END IF;
    IF p_advance_deducted < 0 OR p_other_deductions < 0 THEN
        RAISE EXCEPTION 'Deductions cannot be negative.';
    END IF;
    IF p_payment_method NOT IN ('CASH', 'UPI', 'BANK_TRANSFER') THEN
        RAISE EXCEPTION 'Invalid payment method: %. Allowed methods are CASH, UPI, BANK_TRANSFER.', p_payment_method;
    END IF;

    -- Calculate total previously settled for this period to support partial payments
    SELECT 
        COALESCE(SUM(amount_paid), 0.00),
        COALESCE(SUM(advance_deducted), 0.00),
        COALESCE(SUM(other_deductions), 0.00)
    INTO v_prev_paid, v_prev_adv, v_prev_other
    FROM public.salary_payments
    WHERE staff_id = p_staff_id AND period_month = p_period_month;

    v_total_settled_so_far := v_prev_paid + v_prev_adv + v_prev_other;
    v_outstanding_payable := pg_catalog.greatest(0.00, p_base_salary - v_total_settled_so_far);

    IF (p_amount_paid + p_advance_deducted + p_other_deductions) > v_outstanding_payable THEN
        RAISE EXCEPTION 'Total disbursement and deductions (%) exceed remaining salary payable (%) for period %.',
            (p_amount_paid + p_advance_deducted + p_other_deductions), v_outstanding_payable, p_period_month;
    END IF;

    -- Validate and allocate advance deductions using FIFO row locking
    IF p_advance_deducted > 0 THEN
        SELECT COALESCE(SUM(amount - amount_deducted), 0.00) INTO v_avail_advances
        FROM public.salary_advances
        WHERE staff_id = p_staff_id AND is_settled = false;

        IF p_advance_deducted > v_avail_advances THEN
            RAISE EXCEPTION 'Requested advance deduction (%) exceeds total outstanding advances (%).',
                p_advance_deducted, v_avail_advances;
        END IF;
    END IF;

    v_voucher_num := 'SAL-' || pg_catalog.to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 6);

    -- 1. Insert Salary Payment Record
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
        p_base_salary,
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

    -- 2. Systematically deduct from advances (FIFO)
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
                deducted_in_payment_id = v_payment_id
            WHERE id = v_adv.id;

            v_rem_adv_to_deduct := v_rem_adv_to_deduct - v_deduct_this;
            EXIT WHEN v_rem_adv_to_deduct <= 0;
        END LOOP;
    END IF;

    -- 3. Balanced Dual-Entry Financial Ledger Posting
    -- Entry 1: Debit Staff Salary Expense (Gross compensation recognized in this disbursement)
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
        (p_amount_paid + p_advance_deducted),
        0.00,
        'Salary disbursement for ' || v_staff.full_name || ' (' || p_period_month || ')',
        'SALARY',
        v_payment_id,
        v_caller_id
    );

    -- Entry 2: Credit Cash Drawer or Bank Account for cash disbursed
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
        'LED-' || v_voucher_num || '-CR-CASH',
        CASE WHEN p_payment_method = 'CASH' THEN '1010' ELSE '1020' END,
        CASE WHEN p_payment_method = 'CASH' THEN 'Central Depot Cash Drawer' ELSE 'Bank Current Account' END,
        0.00,
        p_amount_paid,
        'Net payment to ' || v_staff.full_name,
        'SALARY',
        v_payment_id,
        v_caller_id
    );

    -- Entry 3: Credit Staff Advance Receivable for advance deduction (clears asset)
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
            'LED-' || v_voucher_num || '-CR-ADV',
            '1310',
            'Staff Advance Receivable',
            0.00,
            p_advance_deducted,
            'Advance recovery for ' || v_staff.full_name,
            'SALARY',
            v_payment_id,
            v_caller_id
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'voucher_number', v_voucher_num,
        'amount_paid', p_amount_paid,
        'advance_deducted', p_advance_deducted,
        'net_payable', (v_outstanding_payable - (p_amount_paid + p_advance_deducted + p_other_deductions))
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4.8 RPC: rpc_reverse_financial_entry
-- Multi-line atomic journal reversal. Reverses ALL debit and credit lines of the complete
-- journal transaction together, maintaining double-entry balance. Rejects already reversed entries.
CREATE OR REPLACE FUNCTION public.rpc_reverse_financial_entry(
    p_entry_id UUID,
    p_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role VARCHAR;
    v_orig RECORD;
    v_line RECORD;
    v_batch_ref_type VARCHAR(30);
    v_batch_ref_id UUID;
    v_total_dr NUMERIC(12,2) := 0.00;
    v_total_cr NUMERIC(12,2) := 0.00;
    v_reversal_count INT := 0;
    v_new_rev_id UUID;
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
        RAISE EXCEPTION 'Access denied: only the business owner can reverse posted financial entries.';
    END IF;

    IF p_reason IS NULL OR pg_catalog.length(pg_catalog.trim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'Reversal reason is required.';
    END IF;

    -- Lock target entry FOR UPDATE
    SELECT * INTO v_orig FROM public.financial_ledger WHERE id = p_entry_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Financial entry not found: %', p_entry_id;
    END IF;

    IF v_orig.is_reversal = true OR v_orig.reference_type = 'REVERSAL' THEN
        RAISE EXCEPTION 'Cannot reverse an entry that is already a reversal.';
    END IF;

    IF v_orig.reversed_entry_id IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.financial_ledger 
        WHERE reversed_entry_id = v_orig.id OR (reference_type = 'REVERSAL' AND reference_id = v_orig.id)
    ) THEN
        RAISE EXCEPTION 'This transaction has already been reversed.';
    END IF;

    v_batch_ref_type := v_orig.reference_type;
    v_batch_ref_id := v_orig.reference_id;

    -- Validate that complete original journal is balanced
    IF v_batch_ref_id IS NOT NULL THEN
        SELECT COALESCE(SUM(debit), 0.00), COALESCE(SUM(credit), 0.00)
        INTO v_total_dr, v_total_cr
        FROM public.financial_ledger
        WHERE reference_type = v_batch_ref_type 
          AND reference_id = v_batch_ref_id 
          AND is_reversal = false;
    ELSE
        v_total_dr := v_orig.debit;
        v_total_cr := v_orig.credit;
    END IF;

    IF v_total_dr != v_total_cr THEN
        RAISE EXCEPTION 'Original journal transaction is unbalanced (Debits: %, Credits: %); cannot reverse partially.',
            v_total_dr, v_total_cr;
    END IF;

    -- Reverse every debit and credit line in the journal transaction atomically
    IF v_batch_ref_id IS NOT NULL THEN
        FOR v_line IN 
            SELECT * FROM public.financial_ledger
            WHERE reference_type = v_batch_ref_type 
              AND reference_id = v_batch_ref_id 
              AND is_reversal = false
            FOR UPDATE
        LOOP
            INSERT INTO public.financial_ledger (
                entry_number,
                account_code,
                account_name,
                debit,
                credit,
                description,
                reference_type,
                reference_id,
                is_reversal,
                reversed_entry_id,
                created_by
            ) VALUES (
                'REV-' || v_line.entry_number || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 4),
                v_line.account_code,
                v_line.account_name,
                v_line.credit, -- Swapped debit/credit
                v_line.debit,
                'REVERSAL: ' || v_line.description || ' (Reason: ' || p_reason || ')',
                'REVERSAL',
                v_line.id,
                true,
                v_line.id,
                v_caller_id
            ) RETURNING id INTO v_new_rev_id;

            UPDATE public.financial_ledger
            SET reversed_entry_id = v_new_rev_id
            WHERE id = v_line.id;

            v_reversal_count := v_reversal_count + 1;
        END LOOP;
    ELSE
        -- Single entry reversal if reference_id is null
        INSERT INTO public.financial_ledger (
            entry_number,
            account_code,
            account_name,
            debit,
            credit,
            description,
            reference_type,
            reference_id,
            is_reversal,
            reversed_entry_id,
            created_by
        ) VALUES (
            'REV-' || v_orig.entry_number || '-' || pg_catalog.substr(gen_random_uuid()::text, 1, 4),
            v_orig.account_code,
            v_orig.account_name,
            v_orig.credit,
            v_orig.debit,
            'REVERSAL: ' || v_orig.description || ' (Reason: ' || p_reason || ')',
            'REVERSAL',
            v_orig.id,
            true,
            v_orig.id,
            v_caller_id
        ) RETURNING id INTO v_new_rev_id;

        UPDATE public.financial_ledger
        SET reversed_entry_id = v_new_rev_id
        WHERE id = v_orig.id;

        v_reversal_count := 1;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'reversed_lines_count', v_reversal_count,
        'total_reversed_amount', v_total_dr,
        'target_entry_id', p_entry_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ==============================================================================
-- 5. FUNCTION EXECUTION PRIVILEGES (Revoke from PUBLIC/anon; Grant authenticated/service_role)
-- ==============================================================================

REVOKE ALL ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_complete_pos_sale(JSONB, VARCHAR, NUMERIC, NUMERIC, VARCHAR, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_create_purchase_order(UUID, DATE, VARCHAR, VARCHAR, JSONB, TEXT, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_receive_purchase_order(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_supplier_payment(UUID, UUID, NUMERIC, VARCHAR, DATE, VARCHAR, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_salary_advance(UUID, NUMERIC, VARCHAR, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_salary_payment(UUID, VARCHAR, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_record_expense(VARCHAR, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_adjust_inventory_stock(UUID, INT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_reverse_financial_entry(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_execute_delivery_stop(UUID, INT, INT, INT, NUMERIC, VARCHAR, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_complete_pos_sale(JSONB, VARCHAR, NUMERIC, NUMERIC, VARCHAR, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_create_purchase_order(UUID, DATE, VARCHAR, VARCHAR, JSONB, TEXT, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_receive_purchase_order(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_supplier_payment(UUID, UUID, NUMERIC, VARCHAR, DATE, VARCHAR, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_salary_advance(UUID, NUMERIC, VARCHAR, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_salary_payment(UUID, VARCHAR, NUMERIC, NUMERIC, NUMERIC, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_record_expense(VARCHAR, NUMERIC, VARCHAR, DATE, TEXT, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_adjust_inventory_stock(UUID, INT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reverse_financial_entry(UUID, TEXT) TO authenticated, service_role;
