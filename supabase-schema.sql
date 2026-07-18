-- ============================================================
-- SUPABASE POSTGRESQL SCHEMA
-- Sai Lakshmi Home Foods
-- Run this in Supabase → SQL Editor (New Query)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- FUNCTION: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLE: categories
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    slug        TEXT NOT NULL UNIQUE,
    image_url   TEXT,
    image_key   TEXT,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

-- Seed categories
INSERT INTO categories (name, slug, sort_order) VALUES
    ('Veg Pickles',     'veg-pickles',     1),
    ('Non Veg Pickles', 'non-veg-pickles', 2),
    ('Podis',           'podis',           3),
    ('Snacks',          'snacks',          4),
    ('Sweets',          'sweets',          5)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- TABLE: products
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id        INTEGER NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    slug              TEXT UNIQUE,
    category          TEXT NOT NULL,
    price_per_kg      INTEGER NOT NULL CHECK (price_per_kg > 0),
    in_stock          BOOLEAN NOT NULL DEFAULT true,
    stock_quantity    INTEGER,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    image_url         TEXT,
    image_key         TEXT,
    description       TEXT DEFAULT '',
    short_description TEXT DEFAULT '',
    tags              TEXT[] DEFAULT '{}',
    featured          BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_product_id      ON products(product_id);
CREATE INDEX IF NOT EXISTS idx_products_category        ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_is_active       ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_in_stock        ON products(in_stock);
CREATE INDEX IF NOT EXISTS idx_products_featured        ON products(featured);
CREATE INDEX IF NOT EXISTS idx_products_active_cat      ON products(is_active, category);

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid  TEXT UNIQUE,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    phone         TEXT DEFAULT '',
    mobile_number TEXT DEFAULT '',
    address       TEXT DEFAULT '',
    state         TEXT DEFAULT '',
    country       TEXT DEFAULT 'India',
    pincode       TEXT DEFAULT '',
    password_hash TEXT,
    photo_url     TEXT,
    role          TEXT NOT NULL DEFAULT 'customer',
    auth_provider TEXT NOT NULL DEFAULT 'email' CHECK (auth_provider IN ('email', 'google')),
    last_login    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: coupons
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                  TEXT NOT NULL UNIQUE,
    description           TEXT DEFAULT '',
    discount_type         TEXT NOT NULL DEFAULT 'percentage' CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value        NUMERIC(10,2) NOT NULL CHECK (discount_value >= 0),
    min_order_amount      NUMERIC(10,2) DEFAULT 0,
    max_discount_amount   NUMERIC(10,2),
    applicable_products   INTEGER[],
    applicable_categories TEXT[],
    usage_limit           INTEGER,
    used_count            INTEGER NOT NULL DEFAULT 0,
    usage_limit_per_user  INTEGER DEFAULT 1,
    valid_from            TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until           TIMESTAMPTZ NOT NULL,
    is_active             BOOLEAN NOT NULL DEFAULT true,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code      ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_is_active ON coupons(is_active);

DROP TRIGGER IF EXISTS trg_coupons_updated_at ON coupons;
CREATE TRIGGER trg_coupons_updated_at
    BEFORE UPDATE ON coupons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Atomic increment helper (used by couponModel.js)
CREATE OR REPLACE FUNCTION increment_coupon_usage(coupon_code TEXT)
RETURNS void AS $$
BEGIN
    UPDATE coupons SET used_count = used_count + 1 WHERE code = UPPER(coupon_code);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLE: orders
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id                    TEXT NOT NULL UNIQUE,
    user_id                     UUID REFERENCES users(id),
    firebase_uid                TEXT NOT NULL,

    customer_name               TEXT NOT NULL,
    customer_email              TEXT NOT NULL,
    customer_mobile             TEXT NOT NULL,
    customer_address            TEXT NOT NULL,
    customer_state              TEXT DEFAULT '',
    customer_country            TEXT DEFAULT 'India',
    customer_pincode            TEXT NOT NULL,

    subtotal                    NUMERIC(10,2) NOT NULL,
    discount                    NUMERIC(10,2) NOT NULL DEFAULT 0,
    coupon_code                 TEXT,
    delivery_charge             NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_amount                NUMERIC(10,2) NOT NULL,

    payment_method              TEXT NOT NULL DEFAULT 'razorpay'
                                    CHECK (payment_method IN ('razorpay', 'cod')),
    razorpay_order_id           TEXT,
    razorpay_payment_id         TEXT,
    razorpay_signature          TEXT,
    payment_status              TEXT NOT NULL DEFAULT 'pending'
                                    CHECK (payment_status IN ('pending','paid','failed','refunded')),
    paid_at                     TIMESTAMPTZ,

    order_status                TEXT NOT NULL DEFAULT 'pending'
                                    CHECK (order_status IN (
                                        'pending','confirmed','processing',
                                        'out_for_delivery','delivered','cancelled')),

    email_payment_confirmation  BOOLEAN NOT NULL DEFAULT false,
    email_order_received        BOOLEAN NOT NULL DEFAULT false,
    email_out_for_delivery      BOOLEAN NOT NULL DEFAULT false,
    email_delivered             BOOLEAN NOT NULL DEFAULT false,

    notes                       TEXT DEFAULT '',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_order_id            ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_firebase_uid        ON orders(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_orders_user_id             ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order_id   ON orders(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_status        ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status      ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at          ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_uid_created         ON orders(firebase_uid, created_at DESC);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- TABLE: order_items
-- ============================================================
CREATE TABLE IF NOT EXISTS order_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT '',
    image       TEXT DEFAULT '',
    weight      TEXT NOT NULL,
    quantity    INTEGER NOT NULL CHECK (quantity >= 1),
    price       NUMERIC(10,2) NOT NULL,
    total       NUMERIC(10,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- ============================================================
-- TABLE: order_status_history
-- ============================================================
CREATE TABLE IF NOT EXISTS order_status_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status      TEXT NOT NULL,
    note        TEXT DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_history_order_id ON order_status_history(order_id);

-- ============================================================
-- TABLE: admin_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action      TEXT NOT NULL,
    admin_id    TEXT NOT NULL,
    description TEXT,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY (disabled for service-role access from backend)
-- The backend uses the service-role key which bypasses RLS.
-- Enable RLS only if you add direct client-side Supabase access.
-- ============================================================
-- ALTER TABLE users    ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE orders   ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE products ENABLE ROW LEVEL SECURITY;
