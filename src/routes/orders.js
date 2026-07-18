/**
 * Orders Routes — Supabase version
 *
 * Endpoints:
 *  GET  /products          — Public product listing
 *  POST /coupon/validate   — Validate coupon code
 *  GET  /my-orders         — Authenticated user's orders
 *  GET  /my-orders/:id     — Single order (owner-only)
 *  DELETE /my-orders/:id   — Delete delivered order (owner-only)
 *
 * NOTE: Order creation and payment verification live in /api/payment/*
 */

import express from 'express';
import { verifyToken } from '../middleware/auth.js';
import { getProducts as getPublicProducts } from '../controllers/productController.js';
import {
  findCouponByCode,
  validateCoupon,
  calculateDiscount,
} from '../models/couponModel.js';
import {
  findOrdersByFirebaseUid,
  findOrderByOrderId,
  deleteOrderByOrderId,
} from '../models/orderModel.js';

const router = express.Router();

// ── GET /products (public) ───────────────────────────────────────────────────

router.get('/products', (req, res) => {
  req.query.page  = req.query.page  || '1';
  req.query.limit = req.query.limit || '100';
  return getPublicProducts(req, res);
});

// ── POST /coupon/validate ────────────────────────────────────────────────────

router.post('/coupon/validate', verifyToken, async (req, res) => {
  try {
    const { code, orderAmount } = req.body;

    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ success: false, message: 'Coupon code is required' });
    }

    const coupon     = await findCouponByCode(code.trim());
    const validation = validateCoupon(coupon, Number(orderAmount) || 0);

    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const discount = calculateDiscount(coupon, Number(orderAmount) || 0);

    return res.json({
      success: true,
      coupon: {
        code:          coupon.code,
        discountType:  coupon.discount_type,
        discountValue: coupon.discount_value,
        discount,
      },
    });
  } catch (error) {
    console.error('[orders] Validate coupon error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to validate coupon' });
  }
});

// ── GET /my-orders ───────────────────────────────────────────────────────────

router.get('/my-orders', verifyToken, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));

    const { orders, total } = await findOrdersByFirebaseUid(req.user.uid, { page, limit });

    return res.json({
      success: true,
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('[orders] Get orders error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// ── GET /my-orders/:orderId ──────────────────────────────────────────────────

router.get('/my-orders/:orderId', verifyToken, async (req, res) => {
  try {
    const order = await findOrderByOrderId(req.params.orderId);

    // Only the order owner can see their order
    if (!order || order.firebaseUid !== req.user.uid) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.json({ success: true, order });
  } catch (error) {
    console.error('[orders] Get order error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

// ── DELETE /my-orders/:orderId ───────────────────────────────────────────────

router.delete('/my-orders/:orderId', verifyToken, async (req, res) => {
  try {
    const order = await findOrderByOrderId(req.params.orderId);

    // Only the order owner can delete their order
    if (!order || order.firebaseUid !== req.user.uid) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.orderStatus !== 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Only delivered orders can be deleted',
      });
    }

    await deleteOrderByOrderId(req.params.orderId);
    return res.json({ success: true, message: 'Order deleted successfully' });
  } catch (error) {
    console.error('[orders] Delete order error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to delete order' });
  }
});

export default router;
