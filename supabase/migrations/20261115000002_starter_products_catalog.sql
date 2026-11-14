-- ==============================================================================
-- Migration: 20261115000002_starter_products_catalog.sql
-- Description: Standardize 3 primary starter products:
--              1. 20L Packaged Water Jar (reusable jar asset)
--              2. 1L Packaged Water Bottle (₹20)
--              3. 500ml Packaged Water Bottle (₹10)
-- ==============================================================================

-- 1. Deactivate old/clutter products
UPDATE public.products 
SET is_active = false 
WHERE sku NOT IN ('JAR-20L', 'BOT-500ML', 'BOT-1L');

-- 2. Update 20L Packaged Water Jar
UPDATE public.products 
SET name = '20L Packaged Water Jar',
    category = 'REFILLABLE_WATER',
    is_reusable_jar = true,
    default_sale_price = 80.00,
    cost_price = 30.00,
    gst_rate = 18.00,
    cgst_rate = 9.00,
    sgst_rate = 9.00,
    igst_rate = 0.00,
    hsn_code = '22011010',
    is_active = true
WHERE sku = 'JAR-20L';

-- 3. Upsert ₹10 product (500ml)
INSERT INTO public.products (
    id, name, sku, category, is_reusable_jar, default_sale_price, cost_price, hsn_code, gst_rate, cgst_rate, sgst_rate, igst_rate, is_active
) VALUES (
    'a1000000-0000-0000-0000-000000000010',
    '500ml Packaged Water Bottle (₹10)',
    'BOT-500ML',
    'PACKAGED_WATER',
    false,
    10.00,
    6.00,
    '22011010',
    18.00,
    9.00,
    9.00,
    0.00,
    true
) ON CONFLICT (sku) DO UPDATE 
SET name = EXCLUDED.name,
    category = EXCLUDED.category,
    is_reusable_jar = false,
    default_sale_price = 10.00,
    cost_price = 6.00,
    is_active = true;

-- 4. Upsert ₹20 product (1L)
INSERT INTO public.products (
    id, name, sku, category, is_reusable_jar, default_sale_price, cost_price, hsn_code, gst_rate, cgst_rate, sgst_rate, igst_rate, is_active
) VALUES (
    'a2000000-0000-0000-0000-000000000020',
    '1L Packaged Water Bottle (₹20)',
    'BOT-1L',
    'PACKAGED_WATER',
    false,
    20.00,
    12.00,
    '22011010',
    18.00,
    9.00,
    9.00,
    0.00,
    true
) ON CONFLICT (sku) DO UPDATE 
SET name = EXCLUDED.name,
    category = EXCLUDED.category,
    is_reusable_jar = false,
    default_sale_price = 20.00,
    cost_price = 12.00,
    is_active = true;

-- 5. Seed stock in central warehouse
INSERT INTO public.inventory_balances (warehouse_id, product_id, quantity_on_hand, quantity_reserved)
SELECT '4523e58e-9a30-47a5-a698-3181f182468e', p.id, 200, 0
FROM public.products p
WHERE p.sku IN ('JAR-20L', 'BOT-500ML', 'BOT-1L')
ON CONFLICT (warehouse_id, product_id) DO UPDATE
SET quantity_on_hand = GREATEST(public.inventory_balances.quantity_on_hand, 100);

