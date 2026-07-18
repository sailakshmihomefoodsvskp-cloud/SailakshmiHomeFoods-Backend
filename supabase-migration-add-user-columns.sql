-- ============================================================
-- MIGRATION: Add missing columns to users table
-- Run this in Supabase → SQL Editor if you already ran supabase-schema.sql
-- Safe to run multiple times (uses IF NOT EXISTS / DO blocks)
-- ============================================================

-- Add photo_url column
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Add role column with default 'customer'
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer';

-- Add last_login column
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;

-- Back-fill last_login for existing rows
UPDATE users SET last_login = created_at WHERE last_login IS NULL;
