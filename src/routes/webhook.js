/**
 * Razorpay Webhook Handler — Supabase version
 * Signature verification logic is UNCHANGED.
 * Only DB operations changed from Mongoose → Supabase.
 *
 * CRITICAL: Must be mounted BEFORE express.json() (needs raw body).
 */

import express from 'express';
import crypto from 'crypto';
import {
  findOrderByRazorpayOrderId,
  markOrderPaid,
  markOrderPaymentFailed,
  markEmailSent,
} from '../models/orderModel.js';
import { sendPaymentConfirmationEmail } from '../services/emailService.js';

const router = express.Router();

const verifyWebhookSignature = (rawBody, signature, secret) => {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
};

router.post('/', async (req, res) => {
  try {
    const signature    = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;

    if (!signature) {
      return res.status(400).json({ error: 'Missing signature' });
    }

    const rawBody = req.body;

    if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) {
      console.error('[webhook] Body is not raw — check middleware order');
      return res.status(400).json({ error: 'Invalid body format' });
    }

    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      console.error('[webhook] Signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const payload = JSON.parse(rawBody.toString());
    const event   = payload.event;
    const entity  = payload.payload?.payment?.entity || payload.payload?.order?.entity;

    switch (event) {
      case 'payment.captured':
        await handlePaymentCaptured(entity);
        break;
      case 'payment.failed':
        await handlePaymentFailed(entity);
        break;
      case 'order.paid':
        await handleOrderPaid(
          payload.payload.order.entity,
          payload.payload.payment.entity
        );
        break;
      default:
        // Silently ignore unhandled events
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('[webhook] Processing error:', error.message);
    return res.status(200).json({ received: true });
  }
});

async function handlePaymentCaptured(payment) {
  try {
    const { order_id: razorpayOrderId, id: razorpayPaymentId } = payment;

    const existing = await findOrderByRazorpayOrderId(razorpayOrderId);
    if (!existing) {
      console.warn(`[webhook] Order not found for ${razorpayOrderId}`);
      return;
    }
    if (existing.payment.status === 'paid') {
      return; // Already paid — idempotent
    }

    const order = await markOrderPaid(razorpayOrderId, {
      razorpayPaymentId,
      paidAt: new Date(),
    });

    console.log(`[webhook] Payment captured: ${order.orderId}`);

    if (!order.emailsSent?.paymentConfirmation) {
      sendPaymentConfirmationEmail(order)
        .then(async (r) => {
          if (r.success) await markEmailSent(order.orderId, 'paymentConfirmation');
        })
        .catch((e) => console.error('[webhook] Email error:', e.message));
    }
  } catch (error) {
    console.error('[webhook] handlePaymentCaptured error:', error.message);
  }
}

async function handlePaymentFailed(payment) {
  try {
    await markOrderPaymentFailed(payment.order_id, payment.error_description || '');
  } catch (error) {
    console.error('[webhook] handlePaymentFailed error:', error.message);
  }
}

async function handleOrderPaid(orderEntity, paymentEntity) {
  try {
    const razorpayOrderId = orderEntity.id;

    const existing = await findOrderByRazorpayOrderId(razorpayOrderId);
    if (!existing) return;
    if (existing.payment.status === 'paid') return;

    const order = await markOrderPaid(razorpayOrderId, {
      razorpayPaymentId: paymentEntity?.id,
      paidAt:            new Date(),
    });

    if (!order.emailsSent?.paymentConfirmation) {
      sendPaymentConfirmationEmail(order)
        .then(async (r) => {
          if (r.success) await markEmailSent(order.orderId, 'paymentConfirmation');
        })
        .catch((e) => console.error('[webhook] Email error:', e.message));
    }
  } catch (error) {
    console.error('[webhook] handleOrderPaid error:', error.message);
  }
}

export default router;
