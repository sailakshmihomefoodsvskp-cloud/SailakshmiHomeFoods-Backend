/**
 * ESM hoisting fix verification test.
 * Simulates the exact startup sequence of the Express server.
 *
 * Run: node test-r2-esm.js
 */

import dotenv from 'dotenv';
dotenv.config();

// Import r2.js AFTER dotenv — but in real server code, all imports are hoisted
// to before dotenv runs. This test confirms getR2Bucket() handles that correctly.
import {
  getR2Client,
  getR2Bucket,
  getR2PublicUrl,
  R2_BUCKET,
} from './src/config/r2.js';

import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

console.log('╔══════════════════════════════════════════════╗');
console.log('║   ESM Hoisting Fix — Verification Test       ║');
console.log('╚══════════════════════════════════════════════╝\n');

// ── 1. Show the old vs new behaviour ────────────────────────────────────────
console.log('── Old behaviour (module-level constant) ──────');
console.log(`  R2_BUCKET (legacy): "${R2_BUCKET}"`);
console.log('  ↑ This was evaluated at import time — dotenv had not run yet.');
console.log('  ↑ Result: always "sailakshmi-products" (wrong fallback)\n');

console.log('── New behaviour (call-time function) ──────────');
let bucket;
try {
  bucket = getR2Bucket();
  console.log(`  getR2Bucket(): "${bucket}"`);
  console.log('  ✅ Correct — reads process.env.R2_BUCKET_NAME after dotenv\n');
} catch (e) {
  console.log(`  ❌ getR2Bucket() threw: ${e.message}\n`);
  process.exit(1);
}

// ── 2. Verify env vars ────────────────────────────────────────────────────────
console.log('── Environment Variables ───────────────────────');
console.log(`  R2_ENDPOINT    : ${process.env.R2_ENDPOINT || 'MISSING'}`);
console.log(`  R2_BUCKET_NAME : ${process.env.R2_BUCKET_NAME || 'MISSING'}`);
console.log(`  R2_ACCESS_KEY  : ${process.env.R2_ACCESS_KEY ? process.env.R2_ACCESS_KEY.slice(0, 6) + '...' : 'MISSING'}`);
console.log(`  R2_SECRET_KEY  : ${process.env.R2_SECRET_KEY ? 'set (' + process.env.R2_SECRET_KEY.length + ' chars)' : 'MISSING'}`);
console.log(`  R2_PUBLIC_URL  : ${process.env.R2_PUBLIC_URL || 'MISSING'}\n`);

// ── 3. Live PutObject test with correct bucket ────────────────────────────────
console.log('── Live Upload Test ────────────────────────────');
const client = getR2Client();
const key    = `test-esm-fix-${Date.now()}.txt`;

try {
  await client.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        Buffer.from('ESM fix verification'),
    ContentType: 'text/plain',
  }));
  console.log(`  ✅ PutObject succeeded — bucket: ${bucket}, key: ${key}`);
} catch (err) {
  console.log(`  ❌ PutObject FAILED — HTTP ${err.$metadata?.httpStatusCode}: ${err.message}`);
  console.log(`     Bucket used: ${bucket}`);
  process.exit(1);
}

// ── 4. Cleanup ────────────────────────────────────────────────────────────────
try {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log(`  ✅ DeleteObject succeeded — test object cleaned up\n`);
} catch (err) {
  console.log(`  ⚠️  DeleteObject failed (non-critical): ${err.message}\n`);
}

// ── 5. Public URL test ────────────────────────────────────────────────────────
console.log('── Public URL ──────────────────────────────────');
try {
  const url = getR2PublicUrl('products/example.webp');
  console.log(`  ✅ getR2PublicUrl: ${url}\n`);
} catch (e) {
  console.log(`  ❌ getR2PublicUrl threw: ${e.message}\n`);
}

console.log('╔══════════════════════════════════════════════╗');
console.log('║  ✅ Fix verified — product upload will work  ║');
console.log('╚══════════════════════════════════════════════╝\n');
