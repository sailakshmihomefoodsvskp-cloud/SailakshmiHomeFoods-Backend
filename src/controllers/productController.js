/**
 * Product Controller — Supabase version
 *
 * Products are managed entirely through the Admin Panel.
 * No hardcoded product catalog or seed data exists here.
 * Add, update, or remove products exclusively via the admin dashboard.
 */

import {
  listProducts,
  findProductByProductId,
  searchProducts as searchProductsDB,
} from '../models/productModel.js';

// ── Pagination helpers ───────────────────────────────────────────────────────

const DEFAULT_PAGE  = 1;
const DEFAULT_LIMIT = 12;
const MAX_LIMIT     = 100;

const getPaginationParams = (query, defaultLimit = DEFAULT_LIMIT) => {
  const page  = Math.max(1, parseInt(query.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit };
};

const getPaginationMeta = (page, limit, total) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 };
};

const setCachingHeaders = (res, maxAge) => {
  res.set('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
  res.set('Vary', 'Accept-Encoding');
};

// ── Route Handlers ───────────────────────────────────────────────────────────

export const getProducts = async (req, res) => {
  try {
    const { page, limit } = getPaginationParams(req.query);

    const filters = {};
    if (req.query.category) filters.category = req.query.category.trim();
    if (req.query.inStock === 'true')  filters.inStock = true;
    if (req.query.inStock === 'false') filters.inStock = false;
    if (req.query.ids) {
      const requested = req.query.ids.split(',').map(Number).filter(Number.isFinite);
      if (requested.length > 0) filters.ids = requested;
    }

    const { products, total } = await listProducts({ ...filters, page, limit });

    setCachingHeaders(res, 60);
    return res.status(200).json({
      success: true,
      products,
      count: products.length,
      pagination: getPaginationMeta(page, limit, total),
    });
  } catch (error) {
    console.error('[productController] getProducts error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
};

export const getBestSellers = async (req, res) => {
  try {
    const { page, limit } = getPaginationParams(req.query, 8);

    // Fetch products marked as featured (best sellers) from the database.
    // If no products are flagged as featured, return an empty list.
    // Never fall back to all products — that would display unintended items.
    const { products, total } = await listProducts({
      featured: true,
      inStock: true,
      page,
      limit,
    });

    setCachingHeaders(res, 120);
    return res.status(200).json({
      success: true,
      products,
      count: products.length,
      pagination: getPaginationMeta(page, limit, total),
    });
  } catch (error) {
    console.error('[productController] getBestSellers error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch best sellers' });
  }
};

export const getYouMayAlsoLike = async (req, res) => {
  try {
    // Always return exactly 4 products for "You May Also Like"
    const limit = 4;
    const page  = 1;

    // excludeId: the currently viewed product to exclude
    const excludeId = req.query.excludeId ? parseInt(req.query.excludeId, 10) : null;
    // category: prefer same-category products
    const category  = typeof req.query.category === 'string' ? req.query.category.trim() : null;

    let products = [];

    // Step 1 — try same category first (excluding current product)
    if (category) {
      const sameCategory = await listProducts({
        category,
        inStock: true,
        page: 1,
        limit: limit + (excludeId ? 1 : 0), // fetch one extra to allow exclusion
      });
      products = (sameCategory.products || []).filter(
        (p) => !excludeId || (p.productId !== excludeId && p.id !== excludeId)
      );
    }

    // Step 2 — if not enough from same category, pad with other products
    if (products.length < limit) {
      const needed = limit - products.length;
      const existingIds = new Set([
        ...products.map((p) => p.productId || p.id),
        ...(excludeId ? [excludeId] : []),
      ]);

      const others = await listProducts({
        inStock: true,
        page: 1,
        limit: needed + existingIds.size + 5, // generous fetch to allow filtering
      });

      const filtered = (others.products || []).filter(
        (p) => !existingIds.has(p.productId) && !existingIds.has(p.id)
      );

      products = [...products, ...filtered].slice(0, limit);
    }

    // Trim to limit
    products = products.slice(0, limit);

    setCachingHeaders(res, 120);
    return res.status(200).json({
      success: true,
      products,
      count: products.length,
      pagination: getPaginationMeta(page, limit, products.length),
    });
  } catch (error) {
    console.error('[productController] getYouMayAlsoLike error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch recommendations' });
  }
};

export const getProductById = async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (!Number.isFinite(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    const product = await findProductByProductId(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    setCachingHeaders(res, 180);
    return res.status(200).json({ success: true, product });
  } catch (error) {
    console.error('[productController] getProductById error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch product' });
  }
};

export const searchProducts = async (req, res) => {
  try {
    const q     = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 6));

    if (q.length < 2) {
      setCachingHeaders(res, 30);
      return res.status(200).json({ success: true, products: [], count: 0 });
    }

    const products = await searchProductsDB(q, limit);

    setCachingHeaders(res, 30);
    return res.status(200).json({ success: true, products, count: products.length });
  } catch (error) {
    console.error('[productController] searchProducts error:', error);
    return res.status(500).json({ success: false, message: 'Failed to search products' });
  }
};
