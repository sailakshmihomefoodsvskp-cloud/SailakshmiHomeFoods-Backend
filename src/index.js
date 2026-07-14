import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import connectDB from './config/db.js';
import { initializeFirebase, isFirebaseInitialized } from './config/firebase.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payment.js';
import webhookRoutes from './routes/webhook.js';
import productRoutes from './routes/productRoutes.js';
import { apiCompression } from './middleware/compression.js';
import { runSmtpTest } from './utils/smtpTest.js';

// Load environment variables FIRST
dotenv.config();

console.log('\n');
console.log('╔════════════════════════════════════════════════════════╗');
console.log('║       🚀 SAI LAKSHMI HOME FOODS API SERVER             ║');
console.log('╚════════════════════════════════════════════════════════╝');
console.log('\n');

// STEP 1: Initialize Firebase Admin FIRST (before anything else)
console.log('📌 STEP 1: Initializing Firebase Admin SDK...');
const firebaseReady = initializeFirebase();

if (!firebaseReady) {
  console.log('\n');
  console.log('⚠️  ════════════════════════════════════════════════════════');
  console.log('⚠️  WARNING: Firebase Admin SDK FAILED to initialize!');
  console.log('⚠️  Authentication will NOT work.');
  console.log('⚠️  ════════════════════════════════════════════════════════');
  console.log('\n');
  console.log('📋 REQUIRED: Place serviceAccountKey.json at:');
  console.log('   backend/src/config/serviceAccountKey.json');
  console.log('\n');
} else {
  console.log('');
}

// STEP 2: Connect to MongoDB
console.log('📌 STEP 2: Connecting to MongoDB...');
connectDB();

// STEP 3: Initialize Express
console.log('📌 STEP 3: Setting up Express server...');
const app = express();
const PORT = process.env.PORT || 5000;
app.set('etag', 'strong');

// Middleware - CORS configuration (PRODUCTION READY)
const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

console.log('✅ Allowed CORS Origins:', allowedOrigins);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman, etc.)
    if (!origin) {
      console.log('   ℹ️  Request with no origin (Postman/curl) - ALLOWED');
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      console.log(`   ✅ CORS allowed for origin: ${origin}`);
      callback(null, true);
    } else {
      console.warn(`   ⚠️  CORS blocked request from unauthorized origin: ${origin}`);
      console.warn(`   📋 Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error(`Not allowed by CORS. Origin '${origin}' is not in the allowed list.`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type']
}));

// Handle preflight requests
app.options('*', cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
}));

// CRITICAL: Webhook route MUST be mounted BEFORE express.json()
// Razorpay webhook needs raw body for signature verification
app.use('/api/webhook/razorpay', express.raw({ type: 'application/json' }), webhookRoutes);

// Compress JSON/API responses to reduce payload transfer time.
app.use(apiCompression);

// CRITICAL: Parse JSON bodies - must be before other routes
app.use(express.json({ limit: '10mb' }));

// Also parse URL-encoded bodies (for form submissions)
app.use(express.urlencoded({ extended: true }));

// Request logging middleware with body debugging for PUT/POST
app.use((req, res, next) => {
  const timestamp = new Date().toISOString().substring(11, 19);
  console.log(`[${timestamp}] 📨 ${req.method} ${req.path}`);
  
  // Debug body for PUT/POST requests (helps diagnose empty body issues)
  if ((req.method === 'PUT' || req.method === 'POST') && req.path.includes('/products')) {
    console.log('   📦 Content-Type:', req.headers['content-type']);
    console.log('   📦 Body exists:', !!req.body);
    console.log('   📦 Body keys:', Object.keys(req.body || {}));
    console.log('   📦 Raw body:', JSON.stringify(req.body));
  }
  
  next();
});

// STEP 4: Mount Routes
console.log('📌 STEP 4: Mounting API routes...');

// Rate limiting for payment endpoints (10 requests per 15 minutes)
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { 
    success: false, 
    message: 'Too many payment requests. Please try again later.' 
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentLimiter, paymentRoutes);
app.use('/api/products', productRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  const firebaseStatus = isFirebaseInitialized();
  
  res.json({ 
    status: firebaseStatus ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    firebase: {
      initialized: firebaseStatus,
      status: firebaseStatus ? '✅ Ready' : '❌ Not Initialized',
      message: firebaseStatus 
        ? 'Firebase Admin SDK is operational' 
        : 'Firebase Admin SDK failed to initialize - check environment variables'
    },
    database: 'connected', // Will be updated by MongoDB connection
    message: firebaseStatus 
      ? 'Server is fully operational' 
      : 'WARNING: Firebase not initialized - authentication will not work'
  });
});

// Debug endpoint - detailed Firebase status
app.get('/api/debug/firebase', (req, res) => {
  const envVarsPresent = {
    FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
    FIREBASE_PRIVATE_KEY_LENGTH: process.env.FIREBASE_PRIVATE_KEY?.length || 0
  };

  res.json({
    initialized: isFirebaseInitialized(),
    environmentVariables: envVarsPresent,
    allEnvVarsPresent: envVarsPresent.FIREBASE_PROJECT_ID && 
                       envVarsPresent.FIREBASE_CLIENT_EMAIL && 
                       envVarsPresent.FIREBASE_PRIVATE_KEY,
    message: isFirebaseInitialized() 
      ? '✅ Firebase Admin SDK is ready and working' 
      : '❌ Firebase Admin SDK NOT initialized',
    troubleshooting: !isFirebaseInitialized() ? {
      step1: 'Check Render environment variables are set',
      step2: 'Verify FIREBASE_PRIVATE_KEY includes -----BEGIN and -----END lines',
      step3: 'Ensure private key is wrapped in quotes with \\n for newlines',
      step4: 'Redeploy service after setting environment variables'
    } : null
  });
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.path}`);
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler - MUST send JSON response
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  console.error('   Path:', req.path);
  console.error('   Method:', req.method);
  console.error('   Stack:', err.stack);
  
  // Always send JSON response, never leave hanging
  res.status(err.status || 500).json({ 
    success: false, 
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString()
  });
});

// STEP 5: Start server
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log(`║  ✅ Server running on port ${PORT}                         ║`);
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  📡 API Base:    http://localhost:${PORT}/api              ║`);
  console.log(`║  ❤️  Health:      http://localhost:${PORT}/api/health       ║`);
  console.log(`║  🔥 Firebase:    ${isFirebaseInitialized() ? '✅ Ready' : '❌ NOT Ready'}                        ║`);
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');

  // Run SMTP connectivity test (non-blocking, for debugging)
  runSmtpTest().catch(err => {
    console.error('SMTP test encountered an error:', err.message);
  });
});
