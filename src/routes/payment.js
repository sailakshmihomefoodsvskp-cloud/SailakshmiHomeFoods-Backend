/**
 * Payment Routes — Server-side price validation enforced
 *
 * SECURITY: All prices are recalculated on the server.
 * The frontend sends items + delivery method; we validate and compute totals.
 * Client-supplied price figures are NEVER trusted for order creation.
 */

import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { verifyToken } from '../middleware/auth.js';
import {
  createOrder,
  findOrderByOrderId,
  markOrderPaid,
  markOrderPaymentFailed,
  markEmailSent,
} from '../models/orderModel.js';
import {
  findUserByFirebaseUid,
  findUserByEmail,
  createUser,
} from '../models/userModel.js';
import {
  findProductByProductId,
} from '../models/productModel.js';
import {
  findCouponByCode,
  validateCoupon,
  calculateDiscount,
  incrementCouponUsage,
} from '../models/couponModel.js';
import { sendPaymentConfirmationEmail, sendAdminOrderNotification } from '../services/emailService.js';

const router = express.Router();

let razorpay = null;
const getRazorpay = () => {
  if (!razorpay) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error('Razorpay credentials not configured.');
    }
    razorpay = new Razorpay({
      key_id:     process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpay;
};

// ── Weight price helper ──────────────────────────────────────────────────────

const calcWeightPrice = (pricePerKg, weight) => {
  const map = {
    '250gm': Math.floor(pricePerKg * 0.25),
    '500gm': Math.floor(pricePerKg * 0.5),
    '1kg':   pricePerKg,
    '2kg':   pricePerKg * 2,
  };
  return map[weight] ?? null;
};

// ── POST /create-order ───────────────────────────────────────────────────────
// Server validates all items and recalculates totals from DB prices.

router.post('/create-order', verifyToken, async (req, res) => {
  try {
    const { items, customer, couponCode, deliveryMethod } = req.body;

    // Basic validation
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    if (!customer || !customer.name || !customer.mobile) {
      return res.status(400).json({ success: false, message: 'Customer details are required' });
    }

    const customerEmail = req.user?.email || customer?.email;
    if (!customerEmail) {
      return res.status(400).json({ success: false, message: 'Customer email is required' });
    }

    // For non-in-store orders, require delivery address
    const method = (typeof deliveryMethod === 'string' ? deliveryMethod : 'local').toLowerCase();
    if (method !== 'in_store' && (!customer.address || !customer.pincode)) {
      return res.status(400).json({ success: false, message: 'Delivery address and pincode are required' });
    }

    // ── Validate items and compute subtotal from DB prices ───────────────────
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const product = await findProductByProductId(item.productId);

      if (!product) {
        return res.status(400).json({
          success: false,
          message: `Product ${item.productId} not found or unavailable`,
        });
      }

      if (!product.inStock) {
        return res.status(400).json({
          success: false,
          message: `${product.name} is currently out of stock`,
        });
      }

      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        return res.status(400).json({ success: false, message: `Invalid quantity for ${product.name}` });
      }

      const itemPrice = calcWeightPrice(product.pricePerKg, item.weight);
      if (itemPrice === null) {
        return res.status(400).json({
          success: false,
          message: `Invalid weight "${item.weight}" for ${product.name}`,
        });
      }

      const itemTotal = itemPrice * qty;
      subtotal += itemTotal;

      validatedItems.push({
        productId: product.productId,
        name:      product.name,
        category:  product.category,
        image:     item.image || '',
        weight:    item.weight,
        quantity:  qty,
        price:     itemPrice,
        total:     itemTotal,
      });
    }

    // ── Apply coupon (server-side only) ──────────────────────────────────────
    let discount      = 0;
    let appliedCoupon = null;

    if (couponCode) {
      const coupon = await findCouponByCode(couponCode);
      if (coupon) {
        const v = validateCoupon(coupon, subtotal);
        if (v.valid) {
          discount      = calculateDiscount(coupon, subtotal);
          appliedCoupon = coupon.code;
        }
      }
    }

    // ── Delivery charge — three-tier rules (server-side) ─────────────────────
    // in_store : always ₹0
    // local    : ₹0 on ≥₹500, ₹50 below
    // outside  : ₹100 on ≥₹500, ₹150 below
    const discountedSubtotal = subtotal - discount;

    let deliveryCharge;
    if (method === 'in_store') {
      deliveryCharge = 0;
    } else if (method === 'outside') {
      deliveryCharge = discountedSubtotal >= 500 ? 100 : 150;
    } else {
      // Default: local (Visakhapatnam)
      deliveryCharge = discountedSubtotal >= 500 ? 0 : 50;
    }

    const totalAmount = discountedSubtotal + deliveryCharge;

    // ── Resolve or create user ───────────────────────────────────────────────
    const firebaseUid = req.user.uid;
    let user = await findUserByFirebaseUid(firebaseUid);
    if (!user) user = await findUserByEmail(customerEmail.toLowerCase());
    if (!user) {
      user = await createUser({
        firebaseUid,
        email: customerEmail.toLowerCase(),
        name:  customer.name,
        phone: customer.mobile,
      });
    }

    // ── Create Razorpay order (server-computed amount) ───────────────────────
    const rzpOrder = await getRazorpay().orders.create({
      amount:   Math.round(totalAmount * 100),
      currency: 'INR',
      receipt:  `receipt_${Date.now()}`,
      notes: {
        customerName:  customer.name,
        customerEmail,
        customerPhone: customer.mobile,
      },
    });

    // ── Persist order in DB ──────────────────────────────────────────────────
    const order = await createOrder({
      userId:          user.id,
      firebaseUid,
      customer: {
        name:    customer.name,
        email:   customerEmail,
        mobile:  customer.mobile,
        address: customer.address  || '',
        state:   customer.state    || '',
        country: customer.country  || 'India',
        pincode: customer.pincode  || '',
      },
      items:           validatedItems,
      subtotal,
      discount,
      couponCode:      appliedCoupon,
      deliveryMethod:  method,
      deliveryCharge,
      totalAmount,
      paymentMethod:   'razorpay',
      razorpayOrderId: rzpOrder.id,
    });

    return res.json({
      success: true,
      order: {
        id:       rzpOrder.id,
        amount:   rzpOrder.amount,
        currency: rzpOrder.currency,
        orderId:  order.orderId,
        // Return server-computed totals so UI can display accurate breakdown
        subtotal,
        discount,
        deliveryCharge,
        totalAmount,
      },
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('[payment] Create order error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// ── POST /verify ─────────────────────────────────────────────────────────────

router.post('/verify', verifyToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment verification data' });
    }

    // Verify HMAC signature — this is the only thing that proves Razorpay processed it
    const body     = razorpay_order_id + '|' + razorpay_payment_id;
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      // Mark as failed but don't expose why signature check failed
      await markOrderPaymentFailed(razorpay_order_id).catch(() => {});
      return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }

    const order = await markOrderPaid(razorpay_order_id, {
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      paidAt:            new Date(),
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Verify the authenticated user owns this order (prevents replay spoofing)
    if (order.firebaseUid !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'Order does not belong to this user' });
    }

    // Increment coupon usage if applied
    if (order.couponCode) {
      incrementCouponUsage(order.couponCode).catch(() => {});
    }

    // Send customer confirmation email (non-blocking)
    if (!order.emailsSent?.paymentConfirmation) {
      sendPaymentConfirmationEmail(order)
        .then(async (result) => {
          if (result.success) await markEmailSent(order.orderId, 'paymentConfirmation');
        })
        .catch((err) => console.error('[payment] Customer email error:', err.message));
    }

    // Send admin notification email (non-blocking, always sends on new payment)
    if (!order.emailsSent?.adminNotification) {
      sendAdminOrderNotification(order)
        .then(async (result) => {
          if (result.success) await markEmailSent(order.orderId, 'adminNotification');
        })
        .catch((err) => console.error('[payment] Admin notification email error:', err.message));
    }

    return res.json({
      success: true,
      message: 'Payment verified successfully',
      order: {
        orderId:     order.orderId,
        status:      order.orderStatus,
        payment:     order.payment.status,
        totalAmount: order.totalAmount,
      },
    });
  } catch (error) {
    console.error('[payment] Verify error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Payment verification failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// ── GET /order/:orderId ──────────────────────────────────────────────────────

router.get('/order/:orderId', verifyToken, async (req, res) => {
  try {
    const order = await findOrderByOrderId(req.params.orderId);

    if (!order || order.firebaseUid !== req.user.uid) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.json({
      success: true,
      order: {
        orderId:     order.orderId,
        status:      order.orderStatus,
        payment: {
          status:  order.payment.status,
          method:  order.payment.method,
          paidAt:  order.payment.paidAt,
        },
        items:       order.items,
        totalAmount: order.totalAmount,
        customer: {
          name:    order.customer.name,
          address: order.customer.address,
          pincode: order.customer.pincode,
        },
        createdAt: order.createdAt,
      },
    });
  } catch (error) {
    console.error('[payment] Get order error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

export default router;
