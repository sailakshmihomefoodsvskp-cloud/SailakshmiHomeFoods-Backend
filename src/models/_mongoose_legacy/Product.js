import mongoose from 'mongoose';

/**
 * Product Schema
 * Single source of truth for all product data
 * Note: Images are NOT stored in database - handled by frontend
 */
const productSchema = new mongoose.Schema({
  productId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: ['Veg Pickles', 'Non Veg Pickles', 'Podis', 'Snacks', 'Sweets']
  },
  pricePerKg: {
    type: Number,
    required: true,
    min: 0
  },
  inStock: {
    type: Boolean,
    default: true
  },
  stockQuantity: {
    type: Number,
    default: null // null means unlimited
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Query-performance indexes for product APIs.
// Single field indexes for common filters
productSchema.index({ productId: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ category: 1 });
productSchema.index({ createdAt: -1 });

// Compound indexes for common query patterns
productSchema.index({ isActive: 1, category: 1, createdAt: -1 }); // List products by category
productSchema.index({ isActive: 1, productId: 1 }); // Find active product by ID
productSchema.index({ isActive: 1, inStock: 1, category: 1 }); // Filter by stock and category
productSchema.index({ name: 'text', category: 'text' }); // Text search index

// Calculate weight prices based on pricePerKg
productSchema.methods.getWeightPrices = function() {
  return {
    '250gm': Math.floor(this.pricePerKg * 0.25),
    '500gm': Math.floor(this.pricePerKg * 0.5),
    '1kg': this.pricePerKg,
    '2kg': this.pricePerKg * 2
  };
};

// Virtual for display price (250gm price)
productSchema.virtual('price').get(function() {
  return Math.floor(this.pricePerKg * 0.25);
});

// Ensure virtuals are included in JSON
productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

// Static method to get formatted product for API response
productSchema.statics.formatForAPI = function(product) {
  const pricePerKg = product.pricePerKg;
  return {
    id: product.productId,
    productId: product.productId,
    name: product.name,
    category: product.category,
    pricePerKg,
    price: Math.floor(pricePerKg * 0.25),
    weights: ['250gm', '500gm', '1kg', '2kg'],
    weightPrices: {
      '250gm': Math.floor(pricePerKg * 0.25),
      '500gm': Math.floor(pricePerKg * 0.5),
      '1kg': pricePerKg,
      '2kg': pricePerKg * 2
    },
    inStock: product.inStock,
    stockQuantity: product.stockQuantity,
    isActive: product.isActive,
    updatedAt: product.updatedAt,
    createdAt: product.createdAt
  };
};

const Product = mongoose.model('Product', productSchema);

export default Product;
