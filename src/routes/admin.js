/**
 * Admin Routes — Supabase + Cloudflare R2 version
 *
 * Changes vs MongoDB version:
 *  - All DB operations use Supabase models
 *  - Products now support full CRUD with R2 image upload/replace/delete
 *  - Admin credentials + JWT logic are UNCHANGED
 */

import express from 'express';
import { adminLogin, verifyAdminToken } from '../middleware/adminAuth.js';
import { ORDER_STATUS, isValidOrderStatus } from '../config/orderStatus.js';
import { clearResponseCacheByPrefix } from '../middleware/cache.js';
import { handleUpload } from '../middleware/upload.js';
import { uploadProductImage, deleteFromR2 } from '../services/imageService.js';
import {
  sendOrderReceivedEmail,
  sendOutForDeliveryEmail,
  sendDeliveredEmail,
  sendProductUpdateEmail,
} from '../services/emailService.js';
import {
  listAllProductsAdmin,
  findProductByProductIdAdmin,
  createProduct,
  updateProduct,
  deleteProduct,
  countProducts,
} from '../models/productModel.js';
import {
  getOrderStats,
  listOrdersAdmin,
  findOrderByOrderId,
  updateOrderStatus,
  getRecentOrdersAdmin,
  markEmailSent,
  getOrderStatusDistribution,
  getDeliveryDistribution,
  getDailyRevenue,
  getTopProducts,
  getMonthlyRevenue,
} from '../models/orderModel.js';
import {
  listCoupons,
  findCouponByCode,
  findCouponById,
  createCoupon,
  updateCoupon,
  deleteCoupon,
} from '../models/couponModel.js';

const router = express.Router();

const clearProductCache = () => clearResponseCacheByPrefix('products:');

// ============================================================
// ADMIN AUTH
// ============================================================

router.post('/login', (req, res) => {
  try {
    const { mobile, password } = req.body;
    if (!mobile || !password) {
      return res.status(400).json({ success: false, message: 'Mobile and password are required' });
    }
    const result = adminLogin(mobile, password);
    return result.success ? res.json(result) : res.status(401).json(result);
  } catch (error) {
    console.error('Admin login error:', error);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
});

router.get('/verify', verifyAdminToken, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// ============================================================
// DASHBOARD
// ============================================================

router.get('/dashboard', verifyAdminToken, async (req, res) => {
  try {
    const [stats, recentOrders, statusDistribution, deliveryDistribution, dailyRevenue, topProducts, monthlyRevenue] = await Promise.all([
      getOrderStats(),
      getRecentOrdersAdmin(5),
      getOrderStatusDistribution(),
      getDeliveryDistribution(),
      getDailyRevenue(7),
      getTopProducts(5),
      getMonthlyRevenue(),
    ]);

    return res.json({
      success: true,
      stats,
      recentOrders,
      charts: {
        statusDistribution,
        deliveryDistribution,
        dailyRevenue,
        topProducts,
        monthlyRevenue,
      },
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard data' });
  }
});

// ============================================================
// ORDER MANAGEMENT
// ============================================================

router.get('/orders', verifyAdminToken, async (req, res) => {
  try {
    const { status, deliveryMethod, page = 1, limit = 20 } = req.query;
    const { orders, total } = await listOrdersAdmin({
      status,
      deliveryMethod,
      page:  parseInt(page, 10),
      limit: parseInt(limit, 10),
    });

    return res.json({
      success: true,
      orders,
      pagination: {
        page:  parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        pages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (error) {
    console.error('Get orders error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

router.get('/orders/:orderId', verifyAdminToken, async (req, res) => {
  try {
    const order = await findOrderByOrderId(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    return res.json({ success: true, order });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

router.put('/orders/:orderId/status', verifyAdminToken, async (req, res) => {
  try {
    const { status, note } = req.body;

    if (!status || typeof status !== 'string' || status.trim() === '') {
      return res.status(400).json({
        success: false,
        message: `Status is required. Valid values: ${ORDER_STATUS.join(', ')}`,
      });
    }

    const normalized = status.trim().toLowerCase();
    if (!isValidOrderStatus(normalized)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status: "${status}". Valid values: ${ORDER_STATUS.join(', ')}`,
      });
    }

    const order = await updateOrderStatus(req.params.orderId, normalized, note || '');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // Send status emails (non-blocking)
    sendStatusEmail(order, normalized);

    return res.json({ success: true, message: 'Order status updated', order });
  } catch (error) {
    console.error('Update order status error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});

async function sendStatusEmail(order, status) {
  try {
    const emailMap = {
      confirmed:       { fn: sendOrderReceivedEmail,   flag: 'orderReceived'  },
      processing:      { fn: sendOrderReceivedEmail,   flag: 'orderReceived'  },
      out_for_delivery:{ fn: sendOutForDeliveryEmail,  flag: 'outForDelivery' },
      delivered:       { fn: sendDeliveredEmail,       flag: 'delivered'      },
    };
    const config = emailMap[status];
    if (!config) return;
    if (order.emailsSent?.[config.flag]) return;

    const result = await config.fn(order);
    if (result.success) {
      await markEmailSent(order.orderId, config.flag);
    }
  } catch (error) {
    console.error('[admin] sendStatusEmail error:', error.message);
  }
}

// ============================================================
// PRODUCTS — Full CRUD + R2 Image Upload
// ============================================================

// Seed products (disabled — manage all products through the Admin Panel)
router.post('/products/seed', verifyAdminToken, async (req, res) => {
  return res.status(400).json({
    success: false,
    message: 'Auto-seeding is disabled. Please create products through the Admin Panel.',
  });
});

// GET all products (admin — shows inactive too)
router.get('/products', verifyAdminToken, async (req, res) => {
  try {
    const products = await listAllProductsAdmin();
    return res.json({ success: true, products });
  } catch (error) {
    console.error('Get products error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch products: ' + error.message });
  }
});

// POST — Create new product (with optional image upload)
router.post('/products', verifyAdminToken, handleUpload, async (req, res) => {
  let uploadedKey = null; // track for rollback

  try {
    const { name, category, pricePerKg, inStock, isActive, description, shortDescription, featured } = req.body;

    if (!name || !category || !pricePerKg) {
      return res.status(400).json({
        success: false,
        message: 'name, category, and pricePerKg are required',
      });
    }

    const price = parseInt(pricePerKg, 10);
    if (isNaN(price) || price <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid pricePerKg' });
    }

    // Generate a unique product_id
    const allProducts = await listAllProductsAdmin();
    const maxId = allProducts.reduce((m, p) => Math.max(m, p.productId || 0), 0);
    const newProductId = maxId + 1;

    // Process + upload image if provided
    let imageUrl = null;
    let imageKey = null;

    if (req.file) {
      const result = await uploadProductImage(req.file.buffer, req.file.mimetype, name);
      imageUrl    = result.url;
      imageKey    = result.key;
      uploadedKey = result.key;
    }

    // Insert into Supabase — if this fails, roll back the R2 upload
    let product;
    try {
      product = await createProduct({
        productId:        newProductId,
        name:             name.trim(),
        category:         category.trim(),
        pricePerKg:       price,
        inStock:          inStock !== 'false' && inStock !== false,
        isActive:         isActive !== 'false' && isActive !== false,
        imageUrl,
        imageKey,
        description:      description      || '',
        shortDescription: shortDescription || '',
        featured:         featured === 'true' || featured === true,
      });
    } catch (dbErr) {
      // Supabase failed — delete the R2 object we already uploaded
      if (uploadedKey) {
        deleteFromR2(uploadedKey).catch((e) =>
          console.error('[admin] R2 rollback failed:', e.message)
        );
      }
      throw dbErr;
    }

    clearProductCache();

    return res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product,
    });
  } catch (error) {
    console.error('[admin] Create product error:', error.message);
    const status  = error.$metadata?.httpStatusCode;
    const errCode = error.Code || error.code || error.name;

    // Return structured error (dev-mode includes detail, prod hides it)
    return res.status(500).json({
      success: false,
      message:  'Failed to create product',
      step:     errCode === 'AccessDenied' ? 'Cloudflare R2 Upload' : 'Product Creation',
      error:    process.env.NODE_ENV !== 'production' ? error.message : undefined,
      details:  status === 403
        ? 'The R2 API credentials do not have write access to the configured bucket.'
        : undefined,
    });
  }
});

// PUT — Update product (with optional image replacement)
router.put('/products/:productId', verifyAdminToken, handleUpload, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (isNaN(productId) || productId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    const body = req.body || {};

    // Build validated update object
    const updates = {};

    if ('name'           in body && String(body.name).trim())          updates.name          = String(body.name).trim();
    if ('category'       in body && String(body.category).trim())      updates.category      = String(body.category).trim();
    if ('description'    in body)                                       updates.description   = body.description;
    if ('shortDescription' in body)                                     updates.shortDescription = body.shortDescription;
    if ('featured'       in body) updates.featured = body.featured === true || body.featured === 'true';

    if ('pricePerKg' in body) {
      const p = Number(body.pricePerKg);
      if (!isNaN(p) && p > 0) updates.pricePerKg = p;
    }

    if ('inStock' in body) {
      updates.inStock = body.inStock === true || body.inStock === 'true' || body.inStock === 1;
    }

    if ('isActive' in body) {
      updates.isActive = body.isActive === true || body.isActive === 'true' || body.isActive === 1;
    }

    if ('stockQuantity' in body) {
      updates.stockQuantity = body.stockQuantity === null || body.stockQuantity === ''
        ? null
        : Number(body.stockQuantity);
    }

    // Handle image upload / replacement
    if (req.file) {
      // Fetch current product to get old imageKey for deletion
      const current = await findProductByProductIdAdmin(productId);
      const oldKey  = current?.imageKey;

      // Upload new image
      const result = await uploadProductImage(req.file.buffer, req.file.mimetype, body.name || String(productId));
      updates.imageUrl = result.url;
      updates.imageKey = result.key;

      // Delete old R2 image after successful upload
      if (oldKey && oldKey !== result.key) {
        deleteFromR2(oldKey).catch((err) =>
          console.error(`[admin] Failed to delete old R2 image ${oldKey}:`, err.message)
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields provided for update',
      });
    }

    const updated = await updateProduct(productId, updates);
    clearProductCache();

    // Notify admin of stock/price changes
    if ('inStock' in updates || 'pricePerKg' in updates || 'stockQuantity' in updates) {
      sendProductUpdateEmail(updated, updates).catch(() => {});
    }

    return res.json({
      success: true,
      message: 'Product updated successfully',
      product: updated,
      updatedFields: Object.keys(updates),
    });
  } catch (error) {
    console.error('Update product error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update product: ' + error.message });
  }
});

// DELETE — Remove product + R2 image
router.delete('/products/:productId', verifyAdminToken, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (isNaN(productId) || productId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    // Fetch first to get image key
    const existing = await findProductByProductIdAdmin(productId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const imageKey = existing.imageKey;

    // Delete from DB first
    await deleteProduct(productId);
    clearProductCache();

    // Delete from R2 (best-effort — log failure but don't block response)
    if (imageKey) {
      deleteFromR2(imageKey).catch((err) =>
        console.error(`[admin] R2 deletion failed for key ${imageKey}:`, err.message)
      );
    }

    return res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete product: ' + error.message });
  }
});

// POST — Upload/Replace product image only
router.post('/products/:productId/image', verifyAdminToken, handleUpload, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (isNaN(productId) || productId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const current = await findProductByProductIdAdmin(productId);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const oldKey = current.imageKey;
    const result = await uploadProductImage(req.file.buffer, req.file.mimetype, current.name);
    const updated = await updateProduct(productId, { imageUrl: result.url, imageKey: result.key });

    // Delete old image from R2
    if (oldKey && oldKey !== result.key) {
      deleteFromR2(oldKey).catch((err) =>
        console.error(`[admin] R2 old image deletion failed: ${oldKey}:`, err.message)
      );
    }

    clearProductCache();

    return res.json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl: result.url,
      imageKey: result.key,
      sizeKb:   result.sizeKb,
      product:  updated,
    });
  } catch (error) {
    console.error('Image upload error:', error);
    return res.status(500).json({ success: false, message: 'Image upload failed: ' + error.message });
  }
});

// DELETE product image only (keep product row)
router.delete('/products/:productId/image', verifyAdminToken, async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    const current   = await findProductByProductIdAdmin(productId);
    if (!current) return res.status(404).json({ success: false, message: 'Product not found' });

    if (current.imageKey) {
      await deleteFromR2(current.imageKey);
    }

    const updated = await updateProduct(productId, { imageUrl: null, imageKey: null });
    clearProductCache();

    return res.json({ success: true, message: 'Image removed', product: updated });
  } catch (error) {
    console.error('Delete image error:', error);
    return res.status(500).json({ success: false, message: 'Failed to remove image: ' + error.message });
  }
});

// Debug DB connection
router.get('/debug/db', verifyAdminToken, async (req, res) => {
  try {
    const count = await countProducts({ onlyActive: false });
    return res.json({
      success: true,
      database: { type: 'supabase', status: 'connected' },
      products: { count },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================
// COUPONS
// ============================================================

router.get('/coupons', verifyAdminToken, async (req, res) => {
  try {
    const coupons = await listCoupons();
    return res.json({ success: true, coupons });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch coupons' });
  }
});

router.post('/coupons', verifyAdminToken, async (req, res) => {
  try {
    const { code, description, discountType, discountValue, minOrderAmount, maxDiscountAmount,
            applicableProducts, applicableCategories, usageLimit, usageLimitPerUser, validFrom, validUntil } = req.body;

    if (!code || !discountValue || !validUntil) {
      return res.status(400).json({
        success: false,
        message: 'Code, discount value, and expiry date are required',
      });
    }

    const existing = await findCouponByCode(code);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Coupon code already exists' });
    }

    const coupon = await createCoupon({
      code,
      description:          description          || '',
      discountType:         discountType         || 'percentage',
      discountValue:        Number(discountValue),
      minOrderAmount:       Number(minOrderAmount) || 0,
      maxDiscountAmount:    maxDiscountAmount     || null,
      applicableProducts:   applicableProducts   || null,
      applicableCategories: applicableCategories || null,
      usageLimit:           usageLimit           || null,
      usageLimitPerUser:    usageLimitPerUser     || 1,
      validFrom:            validFrom            || new Date().toISOString(),
      validUntil:           new Date(validUntil).toISOString(),
    });

    return res.status(201).json({ success: true, message: 'Coupon created', coupon });
  } catch (error) {
    console.error('Create coupon error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create coupon' });
  }
});

router.put('/coupons/:id', verifyAdminToken, async (req, res) => {
  try {
    const coupon = await findCouponById(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });

    const updates = {};
    const body    = req.body;
    if ('isActive'          in body) updates.isActive         = body.isActive;
    if ('discountValue'     in body) updates.discountValue    = Number(body.discountValue);
    if ('minOrderAmount'    in body) updates.minOrderAmount   = Number(body.minOrderAmount);
    if ('maxDiscountAmount' in body) updates.maxDiscountAmount = body.maxDiscountAmount;
    if ('usageLimit'        in body) updates.usageLimit       = body.usageLimit;
    if ('validUntil'        in body) updates.validUntil       = body.validUntil;
    if ('description'       in body) updates.description      = body.description;

    const updated = await updateCoupon(req.params.id, updates);
    return res.json({ success: true, message: 'Coupon updated', coupon: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update coupon' });
  }
});

router.delete('/coupons/:id', verifyAdminToken, async (req, res) => {
  try {
    const coupon = await findCouponById(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });

    await deleteCoupon(req.params.id);
    return res.json({ success: true, message: 'Coupon deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete coupon' });
  }
});

router.patch('/coupons/:id/toggle', verifyAdminToken, async (req, res) => {
  try {
    const coupon = await findCouponById(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });

    const updated = await updateCoupon(req.params.id, { isActive: !coupon.is_active });
    return res.json({
      success: true,
      message: `Coupon ${updated.is_active ? 'activated' : 'deactivated'}`,
      coupon:  updated,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to toggle coupon' });
  }
});

export default router;
