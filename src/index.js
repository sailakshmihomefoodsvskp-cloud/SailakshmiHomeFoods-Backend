/**
 * Sai Lakshmi Home Foods — API Server
 *
 * Architecture:
 *  - Firebase Admin SDK  → Authentication (unchanged)
 *  - Supabase PostgreSQL → Database (replaces MongoDB)
 *  - Cloudflare R2       → Product image storage
 *  - Razorpay            → Payments (unchanged)
 *  - Nodemailer          → Transactional email (unchanged)
 *
 * NOTE: In ESM, import statements are hoisted. To ensure environment variables
 * are available, all env-dependent modules use lazy reads (functions that read
 * process.env at call-time rather than module-level constants).
 * The server start script should use: node --env-file=.env src/index.js
 * OR dotenv is called here before dynamic imports.
 */

import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { initializeFirebase, isFirebaseInitialized } from './config/firebase.js';
import getSupabase from './config/supabase.js';
import authRoutes    from './routes/auth.js';
import userRoutes    from './routes/user.js';
import adminRoutes   from './routes/admin.js';
import orderRoutes   from './routes/orders.js';
import paymentRoutes from './routes/payment.js';
import webhookRoutes from './routes/webhook.js';
import productRoutes from './routes/productRoutes.js';
import { apiCompression } from './middleware/compression.js';
import { runSmtpTest } from './utils/smtpTest.js';

// ── STEP 1: Firebase Admin ───────────────────────────────────────────────────

const firebaseReady = initializeFirebase();
if (!firebaseReady) {
  console.warn('[startup] WARNING: Firebase Admin SDK failed to initialize — Auth will not work.');
}

// ── DEV-ONLY: Startup config verification (no secrets logged) ────────────────
if (process.env.NODE_ENV !== 'production') {
  console.log('[startup] ENV CHECK:');
  console.log('  FIREBASE_PROJECT_ID :', process.env.FIREBASE_PROJECT_ID || '❌ MISSING');
  console.log('  FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL
    ? process.env.FIREBASE_CLIENT_EMAIL.replace(/^(.{6}).*(@.*)$/, '$1...$2')
    : '❌ MISSING');
  console.log('  FIREBASE_PRIVATE_KEY :', process.env.FIREBASE_PRIVATE_KEY ? '✅ Present' : '❌ MISSING');
  console.log('  R2_ENDPOINT          :', process.env.R2_ENDPOINT || '❌ MISSING');
  console.log('  SUPABASE_URL         :', process.env.SUPABASE_URL || '❌ MISSING');
  console.log('  ADMIN_MOBILE         :', process.env.ADMIN_MOBILE ? '✅ Set' : '❌ MISSING');
  console.log('  JWT_SECRET           :', process.env.JWT_SECRET ? '✅ Set' : '❌ MISSING');
}

// ── STEP 2: Verify Supabase connectivity ─────────────────────────────────────

(async () => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('products').select('id').limit(1);
    if (error) throw error;
    console.log('[startup] Supabase connected successfully.');
  } catch (err) {
    console.error('[startup] Supabase connection error:', err.message);
  }
})();

// ── STEP 3: Express App Setup ────────────────────────────────────────────────

const app  = express();
const PORT = process.env.PORT || 5000;
app.set('etag', 'strong');

// ── Security headers ─────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ── CORS ─────────────────────────────────────────────────────────────────────
//
// Origin allowlist.  FRONTEND_URL (set in Vercel env vars) is the primary
// source — it is a comma-separated list of origins.  The hardcoded fallback
// covers all known production + dev origins so the server works even if the
// env var is not yet configured on Vercel.
//
// IMPORTANT: never use "*" — credentials (Authorization header, cookies) are
// sent on every authenticated request, and browsers block "*" + credentials.

const PRODUCTION_ORIGINS = [
  'https://www.sailakshmihomefoods.in',
  'https://sailakshmihomefoods.in',
  'https://sailakshmi-home-foods-frontend.vercel.app',
];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((u) => u.trim()).filter(Boolean)
  : [...PRODUCTION_ORIGINS, ...DEV_ORIGINS];

// Always ensure the production domain is present, even if FRONTEND_URL is set
// (guards against an accidental omission in the Vercel dashboard)
for (const origin of PRODUCTION_ORIGINS) {
  if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
}

console.log('[startup] CORS allowed origins:', allowedOrigins);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server / curl / Postman (no Origin header)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`[CORS] Blocked request from origin: ${origin}`);
    callback(new Error(`CORS: origin '${origin}' is not allowed.`));
  },
  credentials: true,
  methods:  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type'],
  optionsSuccessStatus: 200, // IE11 chokes on 204
  maxAge: 86400,             // Cache preflight for 24 h
};

// Mount CORS before every other middleware so preflight OPTIONS requests
// are handled immediately and never reach route handlers or rate limiters.
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ── CRITICAL: Webhook needs raw body BEFORE express.json() ───────────────────
app.use('/api/webhook/razorpay', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(apiCompression);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging (dev only — avoid noisy logs in production)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    const ts = new Date().toISOString().substring(11, 19);
    console.log(`[${ts}] ${req.method} ${req.path}`);
    next();
  });
}

// ── STEP 4: Routes ────────────────────────────────────────────────────────────

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many payment requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit admin login attempts
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth',        authRoutes);
app.use('/api/user',        userRoutes);
app.use('/api/admin/login', adminLoginLimiter);
app.use('/api/admin',       adminRoutes);
app.use('/api/orders',      orderRoutes);
app.use('/api/payment',     paymentLimiter, paymentRoutes);
app.use('/api/products',    productRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status:      'ok',
    timestamp:   new Date().toISOString(),
    uptime:      process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    firebase: {
      initialized: isFirebaseInitialized(),
      status:      isFirebaseInitialized() ? '✅ Ready' : '❌ Not Initialized',
    },
    database: 'supabase',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('❌ Server error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    error:   process.env.NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString(),
  });
});

// ── STEP 5: Start ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[startup] Server running on port ${PORT} | Firebase: ${isFirebaseInitialized() ? 'Ready' : 'NOT Ready'}`);

  if (process.env.NODE_ENV !== 'production') {
    runSmtpTest().catch((err) => {
      console.error('[smtp] Test error:', err.message);
    });
  }
});
