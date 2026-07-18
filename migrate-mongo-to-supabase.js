/**
 * MongoDB → Supabase Migration Script
 *
 * Run ONCE after setting up Supabase and running supabase-schema.sql:
 *
 *   node migrate-mongo-to-supabase.js
 *
 * Prerequisites:
 *  1. SUPABASE_URL and SUPABASE_SERVICE_ROLE set in .env
 *  2. MONGO_URI set in .env (or hardcode temporarily)
 *  3. supabase-schema.sql already executed in Supabase SQL Editor
 *
 * What it migrates:
 *  - users
 *  - products
 *  - coupons
 *  - orders + order_items + order_status_history
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { createClient } from '@supabase/supabase-js';

// ── Supabase client ──────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── MongoDB connection ───────────────────────────────────────────────────────

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI not set in .env — cannot migrate');
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE) {
  console.error('❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE not set');
  process.exit(1);
}

// ── Minimal Mongoose schemas for reading ────────────────────────────────────

const userSchema = new mongoose.Schema({}, { strict: false });
const productSchema = new mongoose.Schema({}, { strict: false });
const orderSchema = new mongoose.Schema({}, { strict: false });
const couponSchema = new mongoose.Schema({}, { strict: false });

const MongoUser    = mongoose.model('User',    userSchema);
const MongoProduct = mongoose.model('Product', productSchema);
const MongoOrder   = mongoose.model('Order',   orderSchema);
const MongoCoupon  = mongoose.model('Coupon',  couponSchema);

// ── Helpers ──────────────────────────────────────────────────────────────────

const chunk = (arr, size) => {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
};

const safe = (v) => (v === undefined ? null : v);

// ── Migration functions ──────────────────────────────────────────────────────

async function migrateUsers() {
  console.log('\n📦 Migrating users...');
  const users = await MongoUser.find({}).lean();
  console.log(`   Found ${users.length} users in MongoDB`);

  if (users.length === 0) return;

  const rows = users.map((u) => ({
    firebase_uid:  safe(u.firebaseUid),
    name:          u.name || 'Unknown',
    email:         (u.email || '').toLowerCase(),
    phone:         safe(u.phone) || '',
    mobile_number: safe(u.mobileNumber) || '',
    address:       safe(u.address) || '',
    state:         safe(u.state) || '',
    country:       u.country || 'India',
    pincode:       safe(u.pincode) || '',
    password_hash: safe(u.password) || null,
    auth_provider: u.authProvider || 'email',
    created_at:    u.createdAt || new Date(),
    updated_at:    u.updatedAt || new Date(),
  }));

  let inserted = 0;
  for (const batch of chunk(rows, 50)) {
    const { error } = await supabase
      .from('users')
      .upsert(batch, { onConflict: 'email', ignoreDuplicates: false });
    if (error) console.error('   User batch error:', error.message);
    else inserted += batch.length;
  }
  console.log(`   ✅ Migrated ${inserted} users`);
}

async function migrateProducts() {
  console.log('\n📦 Migrating products...');
  const products = await MongoProduct.find({}).lean();
  console.log(`   Found ${products.length} products in MongoDB`);

  if (products.length === 0) {
    console.log('   ℹ️  No products in MongoDB — will auto-seed from defaults on first API call');
    return;
  }

  const rows = products.map((p) => ({
    product_id:     p.productId,
    name:           p.name,
    slug:           p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    category:       p.category,
    price_per_kg:   p.pricePerKg,
    in_stock:       p.inStock !== false,
    stock_quantity: safe(p.stockQuantity),
    is_active:      p.isActive !== false,
    image_url:      null,  // images will be uploaded to R2 separately
    image_key:      null,
    created_at:     p.createdAt || new Date(),
    updated_at:     p.updatedAt || new Date(),
  }));

  const { error } = await supabase
    .from('products')
    .upsert(rows, { onConflict: 'product_id', ignoreDuplicates: false });

  if (error) {
    console.error('   Products migration error:', error.message);
  } else {
    console.log(`   ✅ Migrated ${rows.length} products`);
  }
}

async function migrateCoupons() {
  console.log('\n📦 Migrating coupons...');
  const coupons = await MongoCoupon.find({}).lean();
  console.log(`   Found ${coupons.length} coupons in MongoDB`);

  if (coupons.length === 0) return;

  const rows = coupons.map((c) => ({
    code:                  c.code?.toUpperCase(),
    description:           safe(c.description) || '',
    discount_type:         c.discountType || 'percentage',
    discount_value:        Number(c.discountValue) || 0,
    min_order_amount:      Number(c.minOrderAmount) || 0,
    max_discount_amount:   c.maxDiscountAmount != null ? Number(c.maxDiscountAmount) : null,
    applicable_products:   c.applicableProducts?.length ? c.applicableProducts : null,
    applicable_categories: c.applicableCategories?.length ? c.applicableCategories : null,
    usage_limit:           c.usageLimit != null ? Number(c.usageLimit) : null,
    used_count:            Number(c.usedCount) || 0,
    usage_limit_per_user:  Number(c.usageLimitPerUser) || 1,
    valid_from:            c.validFrom || new Date(),
    valid_until:           c.validUntil,
    is_active:             c.isActive !== false,
    created_at:            c.createdAt || new Date(),
    updated_at:            c.updatedAt || new Date(),
  }));

  const { error } = await supabase
    .from('coupons')
    .upsert(rows, { onConflict: 'code', ignoreDuplicates: false });

  if (error) {
    console.error('   Coupons migration error:', error.message);
  } else {
    console.log(`   ✅ Migrated ${rows.length} coupons`);
  }
}

async function migrateOrders() {
  console.log('\n📦 Migrating orders...');
  const orders = await MongoOrder.find({}).lean();
  console.log(`   Found ${orders.length} orders in MongoDB`);

  if (orders.length === 0) return;

  // Build user id map (mongo ObjectId → supabase UUID)
  const { data: supabaseUsers } = await supabase.from('users').select('id, firebase_uid, email');
  const userByFirebase = new Map((supabaseUsers || []).map((u) => [u.firebase_uid, u.id]));
  const userByEmail    = new Map((supabaseUsers || []).map((u) => [u.email, u.id]));

  let ordersMigrated = 0;
  let itemsMigrated  = 0;

  for (const o of orders) {
    try {
      const userId = userByFirebase.get(o.firebaseUid) ||
                     userByEmail.get(o.customer?.email?.toLowerCase()) ||
                     null;

      // Insert order row
      const { data: insertedOrder, error: orderError } = await supabase
        .from('orders')
        .upsert({
          order_id:                   o.orderId,
          user_id:                    userId,
          firebase_uid:               o.firebaseUid,
          customer_name:              o.customer?.name || '',
          customer_email:             o.customer?.email || '',
          customer_mobile:            o.customer?.mobile || '',
          customer_address:           o.customer?.address || '',
          customer_state:             o.customer?.state || '',
          customer_country:           o.customer?.country || 'India',
          customer_pincode:           o.customer?.pincode || '',
          subtotal:                   Number(o.subtotal) || 0,
          discount:                   Number(o.discount) || 0,
          coupon_code:                safe(o.couponCode),
          delivery_charge:            Number(o.deliveryCharge) || 0,
          total_amount:               Number(o.totalAmount) || 0,
          payment_method:             o.payment?.method || 'razorpay',
          razorpay_order_id:          safe(o.payment?.razorpayOrderId),
          razorpay_payment_id:        safe(o.payment?.razorpayPaymentId),
          razorpay_signature:         safe(o.payment?.razorpaySignature),
          payment_status:             o.payment?.status || 'pending',
          paid_at:                    safe(o.payment?.paidAt),
          order_status:               o.orderStatus || 'pending',
          email_payment_confirmation: !!o.emailsSent?.paymentConfirmation,
          email_order_received:       !!o.emailsSent?.orderReceived,
          email_out_for_delivery:     !!o.emailsSent?.outForDelivery,
          email_delivered:            !!o.emailsSent?.delivered,
          notes:                      safe(o.notes) || '',
          created_at:                 o.createdAt || new Date(),
          updated_at:                 o.updatedAt || new Date(),
        }, { onConflict: 'order_id', ignoreDuplicates: false })
        .select('id, order_id')
        .single();

      if (orderError) {
        console.error(`   Order ${o.orderId} error:`, orderError.message);
        continue;
      }

      ordersMigrated++;

      // Insert order items
      if (Array.isArray(o.items) && o.items.length > 0) {
        // Delete existing items first to avoid duplicates
        await supabase.from('order_items').delete().eq('order_id', insertedOrder.id);

        const itemRows = o.items.map((item) => ({
          order_id:   insertedOrder.id,
          product_id: item.productId || 0,
          name:       item.name || '',
          category:   item.category || '',
          image:      item.image || '',
          weight:     item.weight || '',
          quantity:   Number(item.quantity) || 1,
          price:      Number(item.price) || 0,
          total:      Number(item.total) || 0,
        }));

        const { error: itemsError } = await supabase.from('order_items').insert(itemRows);
        if (itemsError) {
          console.error(`   Items for order ${o.orderId} error:`, itemsError.message);
        } else {
          itemsMigrated += itemRows.length;
        }
      }

      // Insert status history
      if (Array.isArray(o.statusHistory) && o.statusHistory.length > 0) {
        await supabase.from('order_status_history').delete().eq('order_id', insertedOrder.id);
        const histRows = o.statusHistory.map((h) => ({
          order_id:   insertedOrder.id,
          status:     h.status,
          note:       h.note || '',
          created_at: h.timestamp || new Date(),
        }));
        await supabase.from('order_status_history').insert(histRows);
      }
    } catch (err) {
      console.error(`   Unexpected error migrating order ${o.orderId}:`, err.message);
    }
  }

  console.log(`   ✅ Migrated ${ordersMigrated} orders, ${itemsMigrated} items`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     MongoDB → Supabase Migration                       ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Connect to MongoDB
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB connected');

  await migrateUsers();
  await migrateProducts();
  await migrateCoupons();
  await migrateOrders();

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║     ✅ Migration Complete!                              ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
