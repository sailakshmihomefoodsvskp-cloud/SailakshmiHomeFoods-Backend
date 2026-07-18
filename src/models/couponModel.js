/**
 * Coupon Model — Supabase PostgreSQL
 * Replaces: src/models/Coupon.js (Mongoose)
 *
 * Maps to: public.coupons table
 */

import getSupabase from '../config/supabase.js';

const TABLE = 'coupons';

// ── READ ─────────────────────────────────────────────────────────────────────

export const findCouponByCode = async (code) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('code', code.toUpperCase())
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const listCoupons = async () => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

export const findCouponById = async (id) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
};

// ── VALIDATION ───────────────────────────────────────────────────────────────

/**
 * Validate a coupon row against current usage rules.
 * Pure function — no DB side effects.
 */
export const validateCoupon = (coupon, orderAmount = 0) => {
  if (!coupon) return { valid: false, message: 'Invalid coupon code' };
  if (!coupon.is_active) return { valid: false, message: 'Coupon is not active' };

  const now = new Date();
  if (now < new Date(coupon.valid_from))  return { valid: false, message: 'Coupon is not yet valid' };
  if (now > new Date(coupon.valid_until)) return { valid: false, message: 'Coupon has expired' };

  if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) {
    return { valid: false, message: 'Coupon usage limit reached' };
  }

  if (orderAmount < Number(coupon.min_order_amount)) {
    return {
      valid:   false,
      message: `Minimum order amount is ₹${coupon.min_order_amount}`,
    };
  }

  return { valid: true, message: 'Coupon is valid' };
};

/**
 * Calculate discount amount from a coupon row.
 */
export const calculateDiscount = (coupon, orderAmount) => {
  let discount = 0;

  if (coupon.discount_type === 'percentage') {
    discount = (orderAmount * Number(coupon.discount_value)) / 100;
  } else {
    discount = Number(coupon.discount_value);
  }

  if (coupon.max_discount_amount !== null && discount > Number(coupon.max_discount_amount)) {
    discount = Number(coupon.max_discount_amount);
  }

  return Math.floor(discount);
};

// ── WRITE ────────────────────────────────────────────────────────────────────

export const createCoupon = async ({
  code,
  description = '',
  discountType = 'percentage',
  discountValue,
  minOrderAmount = 0,
  maxDiscountAmount = null,
  applicableProducts = null,
  applicableCategories = null,
  usageLimit = null,
  usageLimitPerUser = 1,
  validFrom,
  validUntil,
  isActive = true,
}) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .insert({
      code:                  code.toUpperCase(),
      description,
      discount_type:         discountType,
      discount_value:        discountValue,
      min_order_amount:      minOrderAmount,
      max_discount_amount:   maxDiscountAmount,
      applicable_products:   applicableProducts,
      applicable_categories: applicableCategories,
      usage_limit:           usageLimit,
      usage_limit_per_user:  usageLimitPerUser,
      valid_from:            validFrom,
      valid_until:           validUntil,
      is_active:             isActive,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
};

export const updateCoupon = async (id, updates) => {
  const dbUpdates = {};
  if ('isActive'           in updates) dbUpdates.is_active            = updates.isActive;
  if ('discountValue'      in updates) dbUpdates.discount_value       = updates.discountValue;
  if ('minOrderAmount'     in updates) dbUpdates.min_order_amount     = updates.minOrderAmount;
  if ('maxDiscountAmount'  in updates) dbUpdates.max_discount_amount  = updates.maxDiscountAmount;
  if ('usageLimit'         in updates) dbUpdates.usage_limit          = updates.usageLimit;
  if ('validUntil'         in updates) dbUpdates.valid_until          = updates.validUntil;
  if ('description'        in updates) dbUpdates.description          = updates.description;

  const { data, error } = await getSupabase()
    .from(TABLE)
    .update(dbUpdates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
};

export const deleteCoupon = async (id) => {
  const { error } = await getSupabase().from(TABLE).delete().eq('id', id);
  if (error) throw error;
};

/**
 * Atomically increment the used_count counter.
 */
export const incrementCouponUsage = async (code) => {
  // Use RPC for atomic increment to avoid race conditions
  const { error } = await getSupabase().rpc('increment_coupon_usage', { coupon_code: code });
  if (error) {
    // Fallback: non-atomic increment (acceptable for low-concurrency)
    const coupon = await findCouponByCode(code);
    if (coupon) {
      await getSupabase()
        .from(TABLE)
        .update({ used_count: (coupon.used_count || 0) + 1 })
        .eq('code', code.toUpperCase());
    }
  }
};
