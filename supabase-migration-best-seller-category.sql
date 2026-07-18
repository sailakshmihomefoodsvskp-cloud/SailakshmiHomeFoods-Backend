-- ============================================================
-- MIGRATION: Best Seller toggle + Remove Non Veg Pickles
-- Run in Supabase → SQL Editor
-- ============================================================

-- 1. The `featured` column already exists on products with default false.
--    This confirms the default and adds a descriptive index.
ALTER TABLE products
  ALTER COLUMN featured SET DEFAULT false;

-- Add index for efficient Best Sellers queries (if not already present)
CREATE INDEX IF NOT EXISTS idx_products_featured_stock
  ON products(featured, in_stock)
  WHERE is_active = true;

-- 2. Remove Non Veg Pickles from the categories table
DELETE FROM categories WHERE slug = 'non-veg-pickles';

-- 3. Reorder remaining categories: Sweets first, then Snacks, Veg Pickles, Podis
UPDATE categories SET sort_order = 1 WHERE slug = 'sweets';
UPDATE categories SET sort_order = 2 WHERE slug = 'snacks';
UPDATE categories SET sort_order = 3 WHERE slug = 'veg-pickles';
UPDATE categories SET sort_order = 4 WHERE slug = 'podis';

-- 4. (Optional) Reassign any existing Non Veg Pickles products to Veg Pickles
--    Uncomment if you want to keep those products visible:
-- UPDATE products SET category = 'Veg Pickles' WHERE category = 'Non Veg Pickles';

-- Verify
SELECT name, slug, sort_order FROM categories ORDER BY sort_order;
