import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/sailakshmi';
    console.log('🔌 Connecting to MongoDB...');
    console.log('   URI:', uri.includes('@') ? uri.replace(/:([^:@]+)@/, ':***@') : uri);
    
    const conn = await mongoose.connect(uri);
    
    console.log('✅ MongoDB Connected!');
    console.log('   Host:', conn.connection.host);
    console.log('   Database:', conn.connection.name);
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    console.log('\n📋 To fix this:');
    console.log('   1. Make sure MongoDB is running');
    console.log('   2. Check MONGODB_URI in .env file');
    console.log('   3. Default: mongodb://localhost:27017/sailakshmi\n');
    process.exit(1);
  }
};

export default connectDB;
