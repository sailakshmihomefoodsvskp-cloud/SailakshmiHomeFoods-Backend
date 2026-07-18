/**
 * Product Model — Supabase PostgreSQL
 * Replaces: src/models/Product.js (Mongoose)
 *
 * Maps to: public.products table
 */

import getSupabase from '../config/supabase.js';

const TABLE = 'products';

// ── HELPERS ──────────────────────────────────────────────────────────────────

const calculateWeightPrices = (pricePerKg) => ({
  '250gm': Math.floor(pricePerKg * 0.25),
  '500gm': Math.floor(pricePerKg * 0.5),
  '1kg':   pricePerKg,
  '2kg':   pricePerKg * 2,
});

/**
 * Format a raw DB row into the shape expected by all API consumers.
 * Preserves exact response structure so frontend needs NO changes.
 */
export const formatProduct = (row) => {
  if (!row) return null;
  const pricePerKg = row.price_per_kg;
  return {
    id:            row.product_id,
    productId:     row.product_id,
    _uuid:         row.id,
    name:          row.name,
    slug:          row.slug,
    category:      row.category,
    pricePerKg,
    price:         Math.floor(pricePerKg * 0.25),
    weights:       ['250gm', '500gm', '1kg', '2kg'],
    weightPrices:  calculateWeightPrices(pricePerKg),
    inStock:       row.in_stock,
    stockQuantity: row.stock_quantity,
    isActive:      row.is_active,
    imageUrl:      row.image_url || null,
    imageKey:      row.image_key || null,
    description:   row.description || '',
    shortDescription: row.short_description || '',
    tags:          row.tags || [],
    featured:      row.featured || false,
    updatedAt:     row.updated_at,
    createdAt:     row.created_at,
  };
};

// ── READ ─────────────────────────────────────────────────────────────────────

/**
 * List active products with optional filters.
 */
export const listProducts = async ({
  category,
  inStock,
  ids,
  featured,
  page = 1,
  limit = 12,
  sortBy = 'category',
  sortDir = 'asc',
} = {}) => {
  let query = getSupabase()
    .from(TABLE)
    .select('*', { count: 'exact' })
    .eq('is_active', true);

  if (category) query = query.eq('category', category);
  if (inStock === true)  query = query.eq('in_stock', true);
  if (inStock === false) query = query.eq('in_stock', false);
  if (featured === true) query = query.eq('featured', true);
  if (ids && ids.length > 0) query = query.in('product_id', ids);

  const from = (page - 1) * limit;
  const to   = from + limit - 1;

  query = query
    .order(sortBy === 'name' ? 'name' : 'product_id', { ascending: sortDir !== 'desc' })
    .range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    products: (data || []).map(formatProduct),
    total: count || 0,
  };
};

/**
 * Get products by IDs in the exact order of the ids array.
 */
export const getProductsByIds = async (ids) => {
  if (!ids || ids.length === 0) return [];

  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('is_active', true)
    .in('product_id', ids);

  if (error) throw error;

  // Preserve requested order
  const map = new Map((data || []).map((r) => [r.product_id, r]));
  return ids.map((id) => map.get(id)).filter(Boolean).map(formatProduct);
};

/**
 * Find one active product by its numeric product_id.
 */
export const findProductByProductId = async (productId) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('product_id', productId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  return data ? formatProduct(data) : null;
};

/**
 * Find one product by its numeric product_id (admin — ignores is_active).
 */
export const findProductByProductIdAdmin = async (productId) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('product_id', productId)
    .maybeSingle();

  if (error) throw error;
  return data ? formatProduct(data) : null;
};

/**
 * Search products by name or category (for autocomplete / search bar).
 */
export const searchProducts = async (searchQuery, limit = 6) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('is_active', true)
    .or(`name.ilike.%${searchQuery}%,category.ilike.%${searchQuery}%`)
    .order('product_id', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data || []).map(formatProduct);
};

/**
 * Count all products (active or all, for admin dashboard).
 */
export const countProducts = async ({ onlyActive = false } = {}) => {
  let query = getSupabase().from(TABLE).select('*', { count: 'exact', head: true });
  if (onlyActive) query = query.eq('is_active', true);

  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
};

/**
 * Get ALL products (admin list — no is_active filter).
 */
export const listAllProductsAdmin = async () => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .order('category', { ascending: true })
    .order('product_id', { ascending: true });

  if (error) throw error;
  return (data || []).map(formatProduct);
};

// ── WRITE ────────────────────────────────────────────────────────────────────

/**
 * Insert a new product row.
 */
export const createProduct = async ({
  productId,
  name,
  category,
  pricePerKg,
  inStock = true,
  isActive = true,
  stockQuantity = null,
  imageUrl = null,
  imageKey = null,
  description = '',
  shortDescription = '',
  tags = [],
  featured = false,
}) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const { data, error } = await getSupabase()
    .from(TABLE)
    .insert({
      product_id:        productId,
      name,
      slug,
      category,
      price_per_kg:      pricePerKg,
      in_stock:          inStock,
      is_active:         isActive,
      stock_quantity:    stockQuantity,
      image_url:         imageUrl,
      image_key:         imageKey,
      description,
      short_description: shortDescription,
      tags,
      featured,
    })
    .select('*')
    .single();

  if (error) throw error;
  return formatProduct(data);
};

/**
 * Update specific fields of a product by numeric product_id.
 * Returns the updated formatted product.
 */
export const updateProduct = async (productId, updates) => {
  // Map camelCase → snake_case for DB
  const dbUpdates = {};
  if ('name'           in updates) dbUpdates.name            = updates.name;
  if ('category'       in updates) dbUpdates.category        = updates.category;
  if ('pricePerKg'     in updates) dbUpdates.price_per_kg    = updates.pricePerKg;
  if ('inStock'        in updates) dbUpdates.in_stock        = updates.inStock;
  if ('isActive'       in updates) dbUpdates.is_active       = updates.isActive;
  if ('stockQuantity'  in updates) dbUpdates.stock_quantity  = updates.stockQuantity;
  if ('imageUrl'       in updates) dbUpdates.image_url       = updates.imageUrl;
  if ('imageKey'       in updates) dbUpdates.image_key       = updates.imageKey;
  if ('description'    in updates) dbUpdates.description     = updates.description;
  if ('shortDescription' in updates) dbUpdates.short_description = updates.shortDescription;
  if ('tags'           in updates) dbUpdates.tags            = updates.tags;
  if ('featured'       in updates) dbUpdates.featured        = updates.featured;

  if (Object.keys(dbUpdates).length === 0) {
    throw new Error('No valid fields to update');
  }

  const { data, error } = await getSupabase()
    .from(TABLE)
    .update(dbUpdates)
    .eq('product_id', productId)
    .select('*')
    .single();

  if (error) throw error;
  return formatProduct(data);
};

/**
 * Delete a product by numeric product_id.
 * Returns the deleted row (so caller can clean up R2 image).
 */
export const deleteProduct = async (productId) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq('product_id', productId)
    .select('*')
    .single();

  if (error) throw error;
  return data; // raw row — has image_key
};

/**
 * Bulk insert products — kept only as an emergency admin utility.
 * This function is NOT called automatically anywhere.
 * Use only if explicitly needed via a manual admin script.
 */
export const seedProducts = async (products) => {
  const rows = products.map((p) => ({
    product_id:     p.productId,
    name:           p.name,
    slug:           p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    category:       p.category,
    price_per_kg:   p.pricePerKg,
    in_stock:       true,
    is_active:      true,
    stock_quantity: null,
    image_url:      p.imageUrl || null,
    image_key:      p.imageKey || null,
  }));

  const { error } = await getSupabase()
    .from(TABLE)
    .upsert(rows, { onConflict: 'product_id', ignoreDuplicates: true });

  if (error) throw error;
};
