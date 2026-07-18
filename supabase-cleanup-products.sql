-- ============================================================
-- PRODUCT CATALOG CLEANUP — Run in Supabase SQL Editor
--
-- Authorised products (kept):
--   1   Mango Avakaya
--   2   Gongura Pickle
--   7   Kandi Podi
--   8   Karvepaku Podi
--   101 Mixture
--   208 Mysore Pak
--   212 Sunnunda
--
-- All other rows are permanently deleted.
-- ============================================================

-- Step 1: Preview rows that will be deleted
SELECT product_id, name, category, image_key
FROM products
WHERE product_id NOT IN (1, 2, 7, 8, 101, 208, 212)
ORDER BY category, product_id;

-- Step 2: Delete unauthorised products
DELETE FROM products
WHERE product_id NOT IN (1, 2, 7, 8, 101, 208, 212);

-- Step 3: Verify — must return exactly 7 rows
SELECT product_id, name, category, in_stock, is_active
FROM products
ORDER BY category, product_id;

-- Step 4: Confirm count = 7
SELECT COUNT(*) AS total_products FROM products;
