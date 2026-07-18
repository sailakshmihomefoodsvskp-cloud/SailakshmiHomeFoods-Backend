/**
 * Order Model — Supabase PostgreSQL
 * Replaces: src/models/Order.js (Mongoose)
 *
 * Maps to: public.orders + public.order_items + public.order_status_history
 */

import getSupabase from '../config/supabase.js';

const TABLE         = 'orders';
const ITEMS_TABLE   = 'order_items';
const HISTORY_TABLE = 'order_status_history';

// ── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Generate a human-readable order ID: SF{YYMMDD}{4-digit-random}
 */
export const generateOrderId = () => {
  const d      = new Date();
  const date   = d.toISOString().slice(2, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `SF${date}${random}`;
};

/**
 * Assemble a full order object (order row + items + history).
 * Mirrors the shape previously returned by Mongoose's Order document.
 */
const assembleOrder = (row, items = [], history = []) => ({
  _id:           row.id,
  orderId:       row.order_id,
  userId:        row.user_id,
  firebaseUid:   row.firebase_uid,
  customer: {
    name:    row.customer_name,
    email:   row.customer_email,
    mobile:  row.customer_mobile,
    address: row.customer_address,
    state:   row.customer_state,
    country: row.customer_country,
    pincode: row.customer_pincode,
  },
  items,
  subtotal:       Number(row.subtotal),
  discount:       Number(row.discount),
  couponCode:     row.coupon_code,
  deliveryMethod: row.delivery_method || 'local',
  deliveryCharge: Number(row.delivery_charge),
  totalAmount:    Number(row.total_amount),
  payment: {
    method:              row.payment_method,
    razorpayOrderId:     row.razorpay_order_id,
    razorpayPaymentId:   row.razorpay_payment_id,
    razorpaySignature:   row.razorpay_signature,
    status:              row.payment_status,
    paidAt:              row.paid_at,
  },
  orderStatus: row.order_status,
  statusHistory: history,
  emailsSent: {
    paymentConfirmation: row.email_payment_confirmation,
    orderReceived:       row.email_order_received,
    outForDelivery:      row.email_out_for_delivery,
    delivered:           row.email_delivered,
  },
  notes:     row.notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Fetch items + history for a single order row and assemble.
 */
const enrichOrder = async (row) => {
  if (!row) return null;

  const [itemsResult, historyResult] = await Promise.all([
    getSupabase().from(ITEMS_TABLE).select('*').eq('order_id', row.id).order('id'),
    getSupabase().from(HISTORY_TABLE).select('*').eq('order_id', row.id).order('created_at'),
  ]);

  if (itemsResult.error)   throw itemsResult.error;
  if (historyResult.error) throw historyResult.error;

  const items = (itemsResult.data || []).map((i) => ({
    productId: i.product_id,
    name:      i.name,
    category:  i.category,
    image:     i.image,
    weight:    i.weight,
    quantity:  i.quantity,
    price:     Number(i.price),
    total:     Number(i.total),
  }));

  const history = (historyResult.data || []).map((h) => ({
    status:    h.status,
    note:      h.note,
    timestamp: h.created_at,
  }));

  return assembleOrder(row, items, history);
};

// ── READ ─────────────────────────────────────────────────────────────────────

export const findOrderByOrderId = async (orderId) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();

  if (error) throw error;
  return enrichOrder(data);
};

export const findOrderByRazorpayOrderId = async (razorpayOrderId) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('razorpay_order_id', razorpayOrderId)
    .maybeSingle();

  if (error) throw error;
  return enrichOrder(data);
};

export const findOrdersByFirebaseUid = async (firebaseUid, { page = 1, limit = 20 } = {}) => {
  const from = (page - 1) * limit;
  const to   = from + limit - 1;

  const { data, error, count } = await getSupabase()
    .from(TABLE)
    .select('*', { count: 'exact' })
    .eq('firebase_uid', firebaseUid)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) throw error;

  const orders = await Promise.all((data || []).map(enrichOrder));
  return { orders, total: count || 0 };
};

export const findOrderById = async (id) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return enrichOrder(data);
};

/**
 * Admin: list orders with optional status/delivery filter, pagination.
 */
export const listOrdersAdmin = async ({ status, deliveryMethod, page = 1, limit = 20 } = {}) => {
  const from = (page - 1) * limit;
  const to   = from + limit - 1;

  let query = getSupabase()
    .from(TABLE)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (status && status !== 'all') {
    query = query.eq('order_status', status);
  }

  if (deliveryMethod && deliveryMethod !== 'all') {
    query = query.eq('delivery_method', deliveryMethod);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  const orders = await Promise.all((data || []).map(enrichOrder));
  return { orders, total: count || 0 };
};

/**
 * Admin dashboard: recent 5 orders (lightweight, no items/history).
 */
export const getRecentOrdersAdmin = async (limitCount = 5) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('order_id, customer_name, total_amount, order_status, payment_status, created_at')
    .order('created_at', { ascending: false })
    .limit(limitCount);

  if (error) throw error;
  return (data || []).map((r) => ({
    orderId:       r.order_id,
    customerName:  r.customer_name,
    totalAmount:   Number(r.total_amount),
    orderStatus:   r.order_status,
    paymentStatus: r.payment_status,
    createdAt:     r.created_at,
  }));
};

// ── WRITE ────────────────────────────────────────────────────────────────────

/**
 * Create a new order (order row + items + initial status history).
 */
export const createOrder = async ({
  userId,
  firebaseUid,
  customer,
  items,
  subtotal,
  discount = 0,
  couponCode = null,
  deliveryMethod = 'local',
  deliveryCharge = 0,
  totalAmount,
  paymentMethod = 'razorpay',
  razorpayOrderId = null,
}) => {
  const supabase = getSupabase();
  const orderId  = generateOrderId();

  // Validate delivery method
  const validMethods = ['in_store', 'local', 'outside'];
  const safeMethod = validMethods.includes(deliveryMethod) ? deliveryMethod : 'local';

  // Insert order row
  const { data: orderRow, error: orderError } = await supabase
    .from(TABLE)
    .insert({
      order_id:         orderId,
      user_id:          userId || null,
      firebase_uid:     firebaseUid,
      customer_name:    customer.name,
      customer_email:   customer.email,
      customer_mobile:  customer.mobile,
      customer_address: customer.address,
      customer_state:   customer.state   || '',
      customer_country: customer.country || 'India',
      customer_pincode: customer.pincode,
      subtotal,
      discount,
      coupon_code:      couponCode,
      delivery_method:  safeMethod,
      delivery_charge:  deliveryCharge,
      total_amount:     totalAmount,
      payment_method:   paymentMethod,
      razorpay_order_id: razorpayOrderId,
      payment_status:   'pending',
      order_status:     'pending',
    })
    .select('*')
    .single();

  if (orderError) throw orderError;

  // Insert order items
  const itemRows = items.map((item) => ({
    order_id:   orderRow.id,
    product_id: item.productId,
    name:       item.name,
    category:   item.category || '',
    image:      item.image    || '',
    weight:     item.weight,
    quantity:   item.quantity,
    price:      item.price,
    total:      item.total,
  }));

  const { error: itemsError } = await supabase
    .from(ITEMS_TABLE)
    .insert(itemRows);

  if (itemsError) throw itemsError;

  // Insert initial status history entry
  const { error: historyError } = await supabase
    .from(HISTORY_TABLE)
    .insert({
      order_id: orderRow.id,
      status:   'pending',
      note:     'Order created, awaiting payment',
    });

  if (historyError) throw historyError;

  return enrichOrder(orderRow);
};

/**
 * Update order payment (after Razorpay verification or webhook).
 */
export const markOrderPaid = async (razorpayOrderId, {
  razorpayPaymentId,
  razorpaySignature,
  paidAt = new Date(),
} = {}) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .update({
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature:  razorpaySignature,
      payment_status:      'paid',
      paid_at:             paidAt,
      order_status:        'confirmed',
    })
    .eq('razorpay_order_id', razorpayOrderId)
    .select('*')
    .single();

  if (error) throw error;
  return enrichOrder(data);
};

export const markOrderPaymentFailed = async (razorpayOrderId, description = '') => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .update({ payment_status: 'failed' })
    .eq('razorpay_order_id', razorpayOrderId)
    .select('*')
    .single();

  if (error) throw error;
  return enrichOrder(data);
};

/**
 * Update order_status and append to history.
 */
export const updateOrderStatus = async (orderId, status, note = '') => {
  // Fetch order to get UUID
  const { data: row, error: fetchError } = await getSupabase()
    .from(TABLE)
    .select('id')
    .eq('order_id', orderId)
    .single();

  if (fetchError) throw fetchError;
  if (!row) throw new Error(`Order not found: ${orderId}`);

  const { error: updateError } = await getSupabase()
    .from(TABLE)
    .update({ order_status: status })
    .eq('id', row.id);

  if (updateError) throw updateError;

  // Append history
  const { error: histError } = await getSupabase()
    .from(HISTORY_TABLE)
    .insert({ order_id: row.id, status, note });

  if (histError) throw histError;

  return findOrderByOrderId(orderId);
};

/**
 * Mark an email flag as sent (idempotent).
 * flag: 'payment_confirmation' | 'order_received' | 'out_for_delivery' | 'delivered'
 */
export const markEmailSent = async (orderId, flag) => {
  const columnMap = {
    paymentConfirmation: 'email_payment_confirmation',
    orderReceived:       'email_order_received',
    outForDelivery:      'email_out_for_delivery',
    delivered:           'email_delivered',
  };

  const column = columnMap[flag];
  if (!column) {
    console.warn(`[orderModel] Unknown email flag: ${flag}`);
    return;
  }

  const { error } = await getSupabase()
    .from(TABLE)
    .update({ [column]: true })
    .eq('order_id', orderId);

  if (error) console.error(`[orderModel] markEmailSent error:`, error);
};

/**
 * Delete an order row (cascades to items + history).
 */
export const deleteOrderByOrderId = async (orderId) => {
  const { error } = await getSupabase()
    .from(TABLE)
    .delete()
    .eq('order_id', orderId);

  if (error) throw error;
};

// ── AGGREGATES (for admin dashboard) ─────────────────────────────────────────

export const getOrderStats = async () => {
  const supabase = getSupabase();
  const today    = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

  const [total, todayCount, monthCount, pending, completed, cancelled, revenue, todayRevenue] = await Promise.all([
    supabase.from(TABLE).select('*', { count: 'exact', head: true }),
    supabase.from(TABLE).select('*', { count: 'exact', head: true }).gte('created_at', todayISO),
    supabase.from(TABLE).select('*', { count: 'exact', head: true }).gte('created_at', thisMonth),
    supabase.from(TABLE).select('*', { count: 'exact', head: true })
      .in('order_status', ['pending', 'confirmed', 'processing']),
    supabase.from(TABLE).select('*', { count: 'exact', head: true })
      .eq('order_status', 'delivered'),
    supabase.from(TABLE).select('*', { count: 'exact', head: true })
      .eq('order_status', 'cancelled'),
    supabase.from(TABLE).select('total_amount').eq('payment_status', 'paid'),
    supabase.from(TABLE).select('total_amount').eq('payment_status', 'paid').gte('created_at', todayISO),
  ]);

  const totalRevenue = (revenue.data || []).reduce((s, r) => s + Number(r.total_amount), 0);
  const todayRev     = (todayRevenue.data || []).reduce((s, r) => s + Number(r.total_amount), 0);
  const totalOrders  = total.count || 0;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  return {
    totalOrders,
    todayOrders:     todayCount.count || 0,
    monthOrders:     monthCount.count || 0,
    pendingOrders:   pending.count    || 0,
    completedOrders: completed.count  || 0,
    cancelledOrders: cancelled.count  || 0,
    totalRevenue,
    todayRevenue:    todayRev,
    avgOrderValue,
  };
};

/**
 * Get order status distribution for charts.
 */
export const getOrderStatusDistribution = async () => {
  const supabase = getSupabase();
  const statuses = ['pending', 'confirmed', 'processing', 'out_for_delivery', 'delivered', 'cancelled'];
  
  const results = await Promise.all(
    statuses.map(status =>
      supabase.from(TABLE).select('*', { count: 'exact', head: true }).eq('order_status', status)
    )
  );

  return statuses.map((status, i) => ({
    status,
    count: results[i].count || 0,
  }));
};

/**
 * Get delivery method distribution for charts.
 */
export const getDeliveryDistribution = async () => {
  const supabase = getSupabase();
  
  const { data, error } = await supabase
    .from(TABLE)
    .select('delivery_method');
    
  if (error) throw error;
  
  let inStore = 0, local = 0, outside = 0;
  (data || []).forEach(order => {
    const method = order.delivery_method || 'local';
    if (method === 'in_store') inStore++;
    else if (method === 'outside') outside++;
    else local++;
  });

  return [
    { name: 'In-Store Pickup', value: inStore },
    { name: 'Local Delivery', value: local },
    { name: 'Outside Delivery', value: outside },
  ];
};

/**
 * Get daily revenue for the last N days.
 */
export const getDailyRevenue = async (days = 7) => {
  const supabase = getSupabase();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from(TABLE)
    .select('total_amount, created_at')
    .eq('payment_status', 'paid')
    .gte('created_at', startDate.toISOString())
    .order('created_at', { ascending: true });

  if (error) throw error;

  // Group by day
  const dailyMap = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const key = d.toISOString().slice(0, 10);
    dailyMap[key] = { date: key, revenue: 0, orders: 0 };
  }

  (data || []).forEach(row => {
    const key = row.created_at.slice(0, 10);
    if (dailyMap[key]) {
      dailyMap[key].revenue += Number(row.total_amount);
      dailyMap[key].orders += 1;
    }
  });

  return Object.values(dailyMap);
};

/**
 * Get top selling products.
 */
export const getTopProducts = async (limit = 5) => {
  const supabase = getSupabase();
  
  const { data, error } = await supabase
    .from(ITEMS_TABLE)
    .select('name, quantity');

  if (error) throw error;

  // Aggregate quantities by product name
  const productMap = {};
  (data || []).forEach(item => {
    if (!productMap[item.name]) productMap[item.name] = 0;
    productMap[item.name] += item.quantity;
  });

  return Object.entries(productMap)
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit);
};

/**
 * Get monthly revenue for the current year.
 */
export const getMonthlyRevenue = async () => {
  const supabase = getSupabase();
  const year = new Date().getFullYear();
  const startOfYear = new Date(year, 0, 1).toISOString();

  const { data, error } = await supabase
    .from(TABLE)
    .select('total_amount, created_at')
    .eq('payment_status', 'paid')
    .gte('created_at', startOfYear)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyData = months.map((name, idx) => ({ name, revenue: 0 }));

  (data || []).forEach(row => {
    const month = new Date(row.created_at).getMonth();
    monthlyData[month].revenue += Number(row.total_amount);
  });

  return monthlyData;
};
