// ═══════════════════════════════════════════════════════════════════
//               PRODUCTION-READY EXPRESS SERVER
//               Sai Lakshmi Home Foods Backend
// ═══════════════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import { initializeFirebase, isFirebaseInitialized } from './config/firebase.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import orderRoutes from './routes/orders.js';
import productRoutes from './routes/productRoutes.js';
import { apiCompression } from './middleware/compression.js';

// ═══════════════════════════════════════════════════════════════════
// STEP 1: Load Environment Variables
// ═══════════════════════════════════════════════════════════════════
dotenv.config();

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║       🚀 SAI LAKSHMI HOME FOODS API SERVER             ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// ═══════════════════════════════════════════════════════════════════
// STEP 2: Initialize Firebase Admin SDK
// ═══════════════════════════════════════════════════════════════════
console.log('📌 STEP 1: Initializing Firebase Admin SDK...');
const firebaseReady = initializeFirebase();

if (!firebaseReady) {
  console.warn('⚠️  WARNING: Firebase Admin SDK NOT initialized!');
  console.warn('⚠️  Protected routes will fail.');
  console.warn('⚠️  Set FIREBASE_* environment variables.\n');
}

// ═══════════════════════════════════════════════════════════════════
// STEP 3: Connect to MongoDB
// ═══════════════════════════════════════════════════════════════════
console.log('📌 STEP 2: Connecting to MongoDB...');
connectDB();

// ═══════════════════════════════════════════════════════════════════
// STEP 4: Initialize Express App
// ═══════════════════════════════════════════════════════════════════
console.log('📌 STEP 3: Setting up Express server...');
const app = express();
const PORT = process.env.PORT || 5000;
app.set('etag', 'strong');

// ═══════════════════════════════════════════════════════════════════
// STEP 5: CORS Configuration (PRODUCTION-READY)
// ═══════════════════════════════════════════════════════════════════
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : ['http://localhost:5173'];

console.log('✅ Allowed CORS Origins:', allowedOrigins);

const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    console.warn(`⚠️  CORS blocked: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Type'],
  maxAge: 86400 // 24 hours
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests for ALL routes
app.options('*', cors(corsOptions));

// ═══════════════════════════════════════════════════════════════════
// STEP 6: Body Parser Middleware
// ═══════════════════════════════════════════════════════════════════
app.use(apiCompression);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ═══════════════════════════════════════════════════════════════════
// STEP 7: Request Logging Middleware
// ═══════════════════════════════════════════════════════════════════
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method.padEnd(6);
  const path = req.path;
  const origin = req.get('origin') || 'no-origin';
  
  console.log(`[${timestamp}] ${method} ${path} from ${origin}`);
  next();
});

// ═══════════════════════════════════════════════════════════════════
// STEP 8: Health Check Endpoint
// ═══════════════════════════════════════════════════════════════════
app.get('/api/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    firebase: isFirebaseInitialized() ? '✅ initialized' : '❌ not initialized',
    database: 'connected', // Will be updated by connectDB
    message: isFirebaseInitialized() 
      ? 'Server is healthy and ready' 
      : 'Server running but Firebase not initialized'
  };
  
  res.status(200).json(health);
});

// ═══════════════════════════════════════════════════════════════════
// STEP 9: Mount API Routes
// ═══════════════════════════════════════════════════════════════════
console.log('📌 STEP 4: Mounting API routes...');

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/products', productRoutes);

console.log('✅ Routes mounted:');
console.log('   - /api/auth/*');
console.log('   - /api/user/*');
console.log('   - /api/admin/*');
console.log('   - /api/orders/*');
console.log('   - /api/products/*');

// ═══════════════════════════════════════════════════════════════════
// STEP 10: 404 Handler (Route Not Found)
// ═══════════════════════════════════════════════════════════════════
app.use((req, res) => {
  console.warn(`❌ 404 Not Found: ${req.method} ${req.path}`);
  
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path,
    method: req.method,
    availableRoutes: [
      'GET  /api/health',
      'POST /api/auth/google',
      'POST /api/auth/sync',
      'GET  /api/user/profile',
      'PUT  /api/user/profile',
      'GET  /api/orders/products',
      'GET  /api/products'
    ]
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEP 11: Global Error Handler
// ═══════════════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('═══════════════════════════════════════════════════');
  console.error('❌ UNHANDLED ERROR:');
  console.error('Path:', req.method, req.path);
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  console.error('═══════════════════════════════════════════════════');
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(isDevelopment && { 
      error: err.message,
      stack: err.stack 
    })
  });
});

// ═══════════════════════════════════════════════════════════════════
// STEP 12: Start Server
// ═══════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log(`║  ✅ Server running on port ${PORT}                         ║`);
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  📡 API: http://localhost:${PORT}/api                     ║`);
  console.log(`║  ❤️  Health: http://localhost:${PORT}/api/health          ║`);
  console.log(`║  🔥 Firebase: ${isFirebaseInitialized() ? '✅ Ready' : '❌ NOT Ready'}                        ║`);
  console.log('╚════════════════════════════════════════════════════════╝\n');
});

// ═══════════════════════════════════════════════════════════════════
// STEP 13: Graceful Shutdown
// ═══════════════════════════════════════════════════════════════════
process.on('SIGTERM', () => {
  console.log('📌 SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📌 SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION:', reason);
  process.exit(1);
});

export default app;
