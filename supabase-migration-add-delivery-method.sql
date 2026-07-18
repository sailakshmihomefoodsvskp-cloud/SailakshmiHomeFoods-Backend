-- ============================================================
-- MIGRATION: Add delivery_method column to orders table
-- Run this in Supabase → SQL Editor (New Query)
-- ============================================================

-- Add delivery_method column with a default of 'local'
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'local'
    CHECK (delivery_method IN ('in_store', 'local', 'outside'));

-- Create an index for filtering by delivery method
CREATE INDEX IF NOT EXISTS idx_orders_delivery_method ON orders(delivery_method);

-- Backfill existing orders based on delivery_charge patterns
-- This is a best-effort fix for historical data
UPDATE orders
SET delivery_method = CASE
    WHEN delivery_charge = 0 AND (
        customer_address = '' OR customer_address IS NULL OR customer_address ILIKE '%pickup%'
    ) THEN 'in_store'
    WHEN delivery_charge > 50 THEN 'outside'
    ELSE 'local'
END
WHERE delivery_method = 'local'; -- only update rows that have the default
