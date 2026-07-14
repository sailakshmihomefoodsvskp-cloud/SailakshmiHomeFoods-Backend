import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const testMongoConnection = async () => {
  try {
    console.log('\n🧪 ===== MONGODB CONNECTION TEST =====\n');
    
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/sailakshmi';
    console.log('📍 Connection URI:', uri.includes('@') ? uri.replace(/:([^:@]+)@/, ':***@') : uri);
    
    console.log('\n🔌 Connecting...');
    const conn = await mongoose.connect(uri);
    
    console.log('✅ Connected successfully!');
    console.log('   Host:', conn.connection.host);
    console.log('   Database:', conn.connection.name);
    console.log('   Ready State:', conn.connection.readyState); // 1 = connected
    
    // Test ProductOverride model
    console.log('\n📦 Testing ProductOverride collection...');
    
    const ProductOverride = mongoose.model('ProductOverride', new mongoose.Schema({
      productId: Number,
      pricePerKg: Number,
      inStock: Boolean,
      updatedAt: Date
    }));
    
    const count = await ProductOverride.countDocuments();
    console.log('   Found', count, 'product overrides');
    
    if (count > 0) {
      const sample = await ProductOverride.findOne();
      console.log('\n📄 Sample override:');
      console.log('   Product ID:', sample.productId);
      console.log('   Price/kg:', sample.pricePerKg);
      console.log('   In Stock:', sample.inStock);
      console.log('   Updated:', sample.updatedAt);
    }
    
    // Test write operation
    console.log('\n✍️  Testing write operation...');
    const testOverride = await ProductOverride.findOneAndUpdate(
      { productId: 999 },
      {
        productId: 999,
        pricePerKg: 1234,
        inStock: true,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    
    console.log('✅ Write test successful!');
    console.log('   Created/Updated test override for product 999');
    
    // Clean up test data
    await ProductOverride.deleteOne({ productId: 999 });
    console.log('🧹 Test data cleaned up');
    
    console.log('\n✅ ===== ALL TESTS PASSED =====\n');
    
    await mongoose.connection.close();
    console.log('🔌 Connection closed');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ===== TEST FAILED =====');
    console.error('Error:', error.message);
    console.error('\n📋 Troubleshooting:');
    console.error('   1. Is MongoDB running?');
    console.error('      Windows: net start MongoDB');
    console.error('      Mac: brew services start mongodb-community');
    console.error('      Linux: sudo systemctl start mongod');
    console.error('   2. Check MONGODB_URI in .env file');
    console.error('   3. Verify connection string format');
    console.error('      Example: mongodb://localhost:27017/sailakshmi');
    console.error('\n');
    process.exit(1);
  }
};

testMongoConnection();
