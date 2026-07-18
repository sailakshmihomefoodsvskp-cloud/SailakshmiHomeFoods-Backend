import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: [true, 'Coupon code is required'],
    unique: true,
    uppercase: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    default: 'percentage'
  },
  discountValue: {
    type: Number,
    required: [true, 'Discount value is required'],
    min: 0
  },
  minOrderAmount: {
    type: Number,
    default: 0
  },
  maxDiscountAmount: {
    type: Number,
    default: null // null means no limit
  },
  applicableProducts: [{
    type: Number // Product IDs
  }],
  applicableCategories: [{
    type: String
  }],
  usageLimit: {
    type: Number,
    default: null // null means unlimited
  },
  usedCount: {
    type: Number,
    default: 0
  },
  usageLimitPerUser: {
    type: Number,
    default: 1
  },
  validFrom: {
    type: Date,
    default: Date.now
  },
  validUntil: {
    type: Date,
    required: [true, 'Expiry date is required']
  },
  isActive: {
    type: Boolean,
    default: true
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

// Update timestamp
couponSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Check if coupon is valid
couponSchema.methods.isValid = function(orderAmount = 0, productIds = []) {
  const now = new Date();
  
  // Check if active
  if (!this.isActive) {
    return { valid: false, message: 'Coupon is not active' };
  }
  
  // Check date validity
  if (now < this.validFrom) {
    return { valid: false, message: 'Coupon is not yet valid' };
  }
  
  if (now > this.validUntil) {
    return { valid: false, message: 'Coupon has expired' };
  }
  
  // Check usage limit
  if (this.usageLimit !== null && this.usedCount >= this.usageLimit) {
    return { valid: false, message: 'Coupon usage limit reached' };
  }
  
  // Check minimum order amount
  if (orderAmount < this.minOrderAmount) {
    return { valid: false, message: `Minimum order amount is ₹${this.minOrderAmount}` };
  }
  
  // Check applicable products if specified
  if (this.applicableProducts && this.applicableProducts.length > 0) {
    const hasApplicableProduct = productIds.some(id => 
      this.applicableProducts.includes(id)
    );
    if (!hasApplicableProduct) {
      return { valid: false, message: 'Coupon not applicable to selected products' };
    }
  }
  
  return { valid: true, message: 'Coupon is valid' };
};

// Calculate discount
couponSchema.methods.calculateDiscount = function(orderAmount) {
  let discount = 0;
  
  if (this.discountType === 'percentage') {
    discount = (orderAmount * this.discountValue) / 100;
  } else {
    discount = this.discountValue;
  }
  
  // Apply max discount limit if set
  if (this.maxDiscountAmount !== null && discount > this.maxDiscountAmount) {
    discount = this.maxDiscountAmount;
  }
  
  return Math.floor(discount);
};

const Coupon = mongoose.model('Coupon', couponSchema);

export default Coupon;
