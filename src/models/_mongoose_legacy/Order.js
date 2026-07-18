import mongoose from 'mongoose';
import { ORDER_STATUS, PAYMENT_STATUS } from '../config/orderStatus.js';

/**
 * Order Item Schema
 * Stores complete product details for order history display
 */
const orderItemSchema = new mongoose.Schema({
  productId: {
    type: Number,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  image: {
    type: String,
    required: false,
    default: ''
  },
  weight: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true
  },
  total: {
    type: Number,
    required: true
  }
});

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    required: false  // Generated in pre-validate hook
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  firebaseUid: {
    type: String,
    required: true
  },
  customer: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    mobile: { type: String, required: true },
    address: { type: String, required: true },
    state: { type: String, default: '' },
    country: { type: String, default: 'India' },
    pincode: { type: String, required: true }
  },
  items: [orderItemSchema],
  subtotal: {
    type: Number,
    required: true
  },
  discount: {
    type: Number,
    default: 0
  },
  couponCode: {
    type: String,
    default: null
  },
  deliveryCharge: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  payment: {
    method: {
      type: String,
      enum: ['razorpay', 'cod'],
      default: 'razorpay'
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    status: {
      type: String,
      enum: PAYMENT_STATUS,
      default: 'pending'
    },
    paidAt: Date
  },
  orderStatus: {
    type: String,
    enum: ORDER_STATUS,
    default: 'pending'
  },
  statusHistory: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    note: String
  }],
  
  // Email tracking flags - prevent duplicate emails
  emailsSent: {
    paymentConfirmation: { type: Boolean, default: false },
    orderReceived: { type: Boolean, default: false },
    outForDelivery: { type: Boolean, default: false },
    delivered: { type: Boolean, default: false }
  },
  
  notes: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Generate unique order ID BEFORE validation
orderSchema.pre('validate', async function(next) {
  if (this.isNew && !this.orderId) {
    const date = new Date();
    const prefix = 'SF';
    const datePart = date.toISOString().slice(2, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    this.orderId = `${prefix}${datePart}${random}`;
  }
  next();
});

// Update timestamp on save
orderSchema.pre('save', async function(next) {
  this.updatedAt = Date.now();
  next();
});

// Add status to history
orderSchema.methods.addStatusHistory = function(status, note = '') {
  this.statusHistory.push({ status, note, timestamp: new Date() });
  this.orderStatus = status;
};

// Create indexes for better query performance
orderSchema.index({ firebaseUid: 1, createdAt: -1 });
orderSchema.index({ orderId: 1 });
orderSchema.index({ 'payment.razorpayOrderId': 1 });

const Order = mongoose.model('Order', orderSchema);

export default Order;
