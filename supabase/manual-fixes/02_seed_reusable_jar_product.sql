-- ==============================================================================
-- AquaTrack ERP — Manual Database Correction 02
-- File: supabase/manual-fixes/02_seed_reusable_jar_product.sql
-- Status: PREPARED FOR REVIEW (NOT EXECUTED)
-- Target: Live Supabase PostgreSQL Database (bplpyitmcqqebpdyochz)
-- Objective: Safely seed the initial canonical reusable 20L water jar product
--            and initialize a zero-quantity inventory balance at the central warehouse.
-- ==============================================================================
--
-- BUSINESS CONFIGURATION ALIGNMENT:
-- 1. Business Profile: 'AquaTrack Water Distribution' (Bangalore, Karnataka)
-- 2. GSTIN: '29ABCDE1234F1Z5' (Karnataka State Code 29). Intra-state sales apply
--    equal CGST and SGST rates satisfying chk_products_gst_balance (gst_rate = cgst + sgst).
-- 3. Default Deposit: Dynamically resolved from public.business_settings.default_jar_deposit (150.00 INR).
-- 4. Standard HSN: '22011010' (Purified drinking water packaged in containers/jars).
-- 5. Sale Price: Default baseline 80.00 INR (as configured in test fixtures and POS defaults).
--    The business owner can modify v_default_sale_price below prior to execution.
-- 6. Cost Price: Baseline 0.00 INR (until established via supplier purchase invoices).
-- 7. Zero Stock Fabrication: The inventory balance is initialized with quantity_on_hand = 0
--    and quantity_reserved = 0. Physical opening stock must be entered through authorized
--    count verification, not fabricated here.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
    -- Owner Configurable Business Parameters
    v_sku                   VARCHAR(50)   := 'JAR-20L-REFILL';
    v_name                  VARCHAR(150)  := '20L Polycarbonate Water Jar Refill';
    v_category              VARCHAR(30)   := 'REFILLABLE_WATER';
    v_uom                   VARCHAR(20)   := 'UNIT';
    v_default_sale_price    NUMERIC(12,2) := 80.00;   -- Owner: adjust to desired base selling price
    v_cost_price            NUMERIC(12,2) := 0.00;    -- Owner: adjust if standard procurement cost is known
    v_hsn_code              VARCHAR(20)   := '22011010';
    v_gst_rate              NUMERIC(5,2)  := 18.00;   -- Standard packaged water GST
    v_cgst_rate             NUMERIC(5,2)  := 9.00;    -- Intra-state Karnataka CGST (50% of GST)
    v_sgst_rate             NUMERIC(5,2)  := 9.00;    -- Intra-state Karnataka SGST (50% of GST)
    v_igst_rate             NUMERIC(5,2)  := 0.00;
    v_cess_rate             NUMERIC(5,2)  := 0.00;

    -- Dynamic Resolution Variables
    v_deposit_amount        NUMERIC(12,2);
    v_product_id            UUID;
    v_default_wh_id         UUID;
    v_existing_count        INT;
BEGIN
    -- 1. Verify GST Balance Invariant
    IF v_gst_rate != (v_cgst_rate + v_sgst_rate) THEN
        RAISE EXCEPTION 'GST balance constraint violated: gst_rate (%) must equal cgst_rate (%) + sgst_rate (%).',
            v_gst_rate, v_cgst_rate, v_sgst_rate;
    END IF;

    -- 2. Resolve Default Deposit from Verified Business Settings
    SELECT default_jar_deposit INTO v_deposit_amount
    FROM public.business_settings
    WHERE is_singleton = true
    LIMIT 1;

    IF v_deposit_amount IS NULL THEN
        v_deposit_amount := 150.00; -- Fallback default deposit
        RAISE NOTICE 'Business settings not found; falling back to default deposit: % INR', v_deposit_amount;
    ELSE
        RAISE NOTICE 'Resolved default jar deposit from business settings: % INR', v_deposit_amount;
    END IF;

    -- 3. Check for Existing Reusable Jar Products (Prevent Duplication)
    SELECT COUNT(*) INTO v_existing_count
    FROM public.products
    WHERE sku = v_sku OR is_reusable_jar = true;

    IF v_existing_count > 0 THEN
        RAISE NOTICE 'Product with SKU % or reusable jar already exists. Skipping insertion.', v_sku;
        SELECT id INTO v_product_id FROM public.products WHERE sku = v_sku OR is_reusable_jar = true LIMIT 1;
    ELSE
        -- 4. Insert Canonical Product
        INSERT INTO public.products (
            sku,
            name,
            category,
            unit_of_measure,
            default_sale_price,
            deposit_amount,
            cost_price,
            hsn_code,
            gst_rate,
            cgst_rate,
            sgst_rate,
            igst_rate,
            cess_rate,
            is_reusable_jar,
            is_active
        ) VALUES (
            v_sku,
            v_name,
            v_category,
            v_uom,
            v_default_sale_price,
            v_deposit_amount,
            v_cost_price,
            v_hsn_code,
            v_gst_rate,
            v_cgst_rate,
            v_sgst_rate,
            v_igst_rate,
            v_cess_rate,
            true,   -- is_reusable_jar = true (Required by rpc_record_jar_movement)
            true    -- is_active = true
        )
        RETURNING id INTO v_product_id;

        RAISE NOTICE 'Created reusable jar product: % (ID: %)', v_name, v_product_id;
    END IF;

    -- 5. Safe Zero-Quantity Inventory Balance Initialization (Task 3 Compliance)
    -- Resolve Canonical Central Warehouse
    SELECT id INTO v_default_wh_id
    FROM public.warehouses
    WHERE is_default = true
    LIMIT 1;

    IF v_default_wh_id IS NULL THEN
        RAISE EXCEPTION 'Default central warehouse not found. Cannot initialize inventory balance.';
    END IF;

    -- Ensure an inventory balance row exists with exactly 0 stock (NO FABRICATION)
    INSERT INTO public.inventory_balances (
        warehouse_id,
        product_id,
        quantity_on_hand,
        quantity_reserved
    ) VALUES (
        v_default_wh_id,
        v_product_id,
        0,  -- ZERO opening stock (Owner must record physical count separately)
        0   -- ZERO reserved stock
    )
    ON CONFLICT (warehouse_id, product_id) DO NOTHING;

    RAISE NOTICE 'Initialized zero-quantity inventory balance for warehouse % and product %.',
        v_default_wh_id, v_product_id;
END $$;

COMMIT;

-- ==============================================================================
-- POST-EXECUTION VERIFICATION QUERY:
-- SELECT 
--     p.id, p.sku, p.name, p.category, p.unit_of_measure,
--     p.default_sale_price, p.deposit_amount, p.gst_rate,
--     p.is_reusable_jar, p.is_active,
--     ib.quantity_on_hand, ib.quantity_reserved
-- FROM public.products p
-- LEFT JOIN public.inventory_balances ib ON ib.product_id = p.id
-- WHERE p.is_reusable_jar = true;
-- ==============================================================================

