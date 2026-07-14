import Product from '../models/Product.js';

const PRODUCT_SELECT_FIELDS = 'productId name category pricePerKg inStock stockQuantity isActive createdAt updatedAt';
const DEFAULT_PAGE = 1;
const DEFAULT_LIST_LIMIT = 12;
const DEFAULT_BEST_SELLER_LIMIT = 8;
const DEFAULT_RECOMMENDATION_LIMIT = 6;
const DEFAULT_SEARCH_LIMIT = 6;
const MAX_LIMIT = 100;

const INITIAL_PRODUCTS = [
  // ── Only products with real photos ──────────────────────────────────────────
  { productId: 1,   name: 'Mango Avakaya',   category: 'Veg Pickles', pricePerKg: 800 },
  { productId: 2,   name: 'Gongura Pickle',  category: 'Veg Pickles', pricePerKg: 800 },
  { productId: 7,   name: 'Kandi Podi',      category: 'Podis',       pricePerKg: 1400 },
  { productId: 8,   name: 'Karvepaku Podi',  category: 'Podis',       pricePerKg: 1400 },
  { productId: 101, name: 'Mixture',         category: 'Snacks',      pricePerKg: 600 },
  { productId: 208, name: 'Mysore Pak',      category: 'Sweets',      pricePerKg: 900 },
  { productId: 212, name: 'Sunnunda',        category: 'Sweets',      pricePerKg: 900 },
];

const BEST_SELLER_IDS = [1, 2, 7, 8, 101, 208, 212];
const YOU_MAY_ALSO_LIKE_IDS = [1, 2, 7, 8, 101, 208, 212];

let hasCheckedSeedState = false;

const calculateWeightPrices = (pricePerKg) => ({
  '250gm': Math.floor(pricePerKg * 0.25),
  '500gm': Math.floor(pricePerKg * 0.5),
  '1kg': pricePerKg,
  '2kg': pricePerKg * 2,
});

const formatProduct = (product) => ({
  id: product.productId,
  productId: product.productId,
  name: product.name,
  category: product.category,
  pricePerKg: product.pricePerKg,
  price: Math.floor(product.pricePerKg * 0.25),
  weights: ['250gm', '500gm', '1kg', '2kg'],
  weightPrices: calculateWeightPrices(product.pricePerKg),
  inStock: product.inStock,
  stockQuantity: product.stockQuantity,
  isActive: product.isActive,
  updatedAt: product.updatedAt,
  createdAt: product.createdAt,
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toIntWithBounds = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const getPaginationParams = (query, defaultLimit = DEFAULT_LIST_LIMIT) => {
  const page = toIntWithBounds(query.page, DEFAULT_PAGE, 1, Number.MAX_SAFE_INTEGER);
  const limit = toIntWithBounds(query.limit, defaultLimit, 1, MAX_LIMIT);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const getPaginationMeta = (page, limit, total) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

const setCachingHeaders = (res, maxAgeInSeconds) => {
  res.set('Cache-Control', `public, max-age=${maxAgeInSeconds}, s-maxage=${maxAgeInSeconds}, stale-while-revalidate=${maxAgeInSeconds * 2}`);
  res.set('Vary', 'Accept-Encoding');
};

const ensureProductsSeeded = async () => {
  if (hasCheckedSeedState) return;

  const existingCount = await Product.countDocuments();
  if (existingCount > 0) {
    hasCheckedSeedState = true;
    return;
  }

  try {
    await Product.insertMany(
      INITIAL_PRODUCTS.map((product) => ({
        ...product,
        inStock: true,
        isActive: true,
      })),
      { ordered: false }
    );
  } catch (error) {
    // Duplicate-key errors can happen in concurrent startups and are safe to ignore.
    if (error?.code !== 11000) {
      throw error;
    }
  }

  hasCheckedSeedState = true;
};

const fetchProductsByIdsInOrder = async (ids) => {
  if (!ids.length) return [];

  const products = await Product.find({
    isActive: true,
    productId: { $in: ids },
  })
    .select(PRODUCT_SELECT_FIELDS)
    .lean();

  const productsById = new Map(products.map((product) => [product.productId, product]));
  return ids
    .map((id) => productsById.get(id))
    .filter(Boolean)
    .map(formatProduct);
};

export const getProducts = async (req, res) => {
  try {
    await ensureProductsSeeded();

    const { page, limit, skip } = getPaginationParams(req.query, DEFAULT_LIST_LIMIT);
    const query = { isActive: true };

    if (typeof req.query.category === 'string' && req.query.category.trim()) {
      query.category = req.query.category.trim();
    }

    if (req.query.inStock === 'true') {
      query.inStock = true;
    } else if (req.query.inStock === 'false') {
      query.inStock = false;
    }

    if (typeof req.query.ids === 'string' && req.query.ids.trim()) {
      const ids = req.query.ids
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter(Number.isFinite);

      if (ids.length === 0) {
        return res.status(200).json({
          success: true,
          products: [],
          count: 0,
          pagination: getPaginationMeta(page, limit, 0),
        });
      }

      query.productId = { $in: ids };
    }

    const [products, total] = await Promise.all([
      Product.find(query)
        .select(PRODUCT_SELECT_FIELDS)
        .sort({ category: 1, productId: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);

    setCachingHeaders(res, 60);
    res.status(200).json({
      success: true,
      products: products.map(formatProduct),
      count: products.length,
      pagination: getPaginationMeta(page, limit, total),
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products',
    });
  }
};

export const getBestSellers = async (req, res) => {
  try {
    await ensureProductsSeeded();

    const { page, limit } = getPaginationParams(req.query, DEFAULT_BEST_SELLER_LIMIT);
    const start = (page - 1) * limit;
    const paginatedIds = BEST_SELLER_IDS.slice(start, start + limit);
    const products = await fetchProductsByIdsInOrder(paginatedIds);

    setCachingHeaders(res, 120);
    res.status(200).json({
      success: true,
      products,
      count: products.length,
      pagination: getPaginationMeta(page, limit, BEST_SELLER_IDS.length),
    });
  } catch (error) {
    console.error('Get best sellers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch best sellers',
    });
  }
};

export const getYouMayAlsoLike = async (req, res) => {
  try {
    await ensureProductsSeeded();

    const { page, limit } = getPaginationParams(req.query, DEFAULT_RECOMMENDATION_LIMIT);
    const start = (page - 1) * limit;
    const paginatedIds = YOU_MAY_ALSO_LIKE_IDS.slice(start, start + limit);
    const products = await fetchProductsByIdsInOrder(paginatedIds);

    setCachingHeaders(res, 120);
    res.status(200).json({
      success: true,
      products,
      count: products.length,
      pagination: getPaginationMeta(page, limit, YOU_MAY_ALSO_LIKE_IDS.length),
    });
  } catch (error) {
    console.error('Get you may also like error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recommendations',
    });
  }
};

export const getProductById = async (req, res) => {
  try {
    await ensureProductsSeeded();

    const productId = Number.parseInt(req.params.productId, 10);
    if (!Number.isFinite(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product ID',
      });
    }

    const product = await Product.findOne({
      productId,
      isActive: true,
    })
      .select(PRODUCT_SELECT_FIELDS)
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
      });
    }

    setCachingHeaders(res, 180);
    res.status(200).json({
      success: true,
      product: formatProduct(product),
    });
  } catch (error) {
    console.error('Get product by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product',
    });
  }
};

export const searchProducts = async (req, res) => {
  try {
    await ensureProductsSeeded();

    const searchQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = toIntWithBounds(req.query.limit, DEFAULT_SEARCH_LIMIT, 1, 20);

    if (searchQuery.length < 2) {
      setCachingHeaders(res, 30);
      return res.status(200).json({
        success: true,
        products: [],
        count: 0,
      });
    }

    // Use efficient text search with regex for small dataset
    // For larger datasets, consider full-text search index
    const products = await Product.find({
      isActive: true,
      $or: [
        { name: { $regex: searchQuery, $options: 'i' } },
        { category: { $regex: searchQuery, $options: 'i' } },
      ],
    })
      .select(PRODUCT_SELECT_FIELDS)
      .sort({ productId: 1 })
      .limit(limit)
      .lean();

    setCachingHeaders(res, 30);
    res.status(200).json({
      success: true,
      products: products.map(formatProduct),
      count: products.length,
    });
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search products',
    });
  }
};

