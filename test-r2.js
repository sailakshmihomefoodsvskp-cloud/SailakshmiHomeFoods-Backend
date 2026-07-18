/**
 * Standalone R2 Connection Diagnostic
 * Run: node test-r2.js
 *
 * Tests: credentials load, endpoint resolution, PutObject, DeleteObject.
 * Never prints secret values — only their presence and length.
 */

import dotenv from 'dotenv';
dotenv.config();

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

// ── 1. Check environment variables ───────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════╗');
console.log('║   Cloudflare R2 Diagnostic                   ║');
console.log('╚══════════════════════════════════════════════╝\n');

const checks = {
  R2_ENDPOINT:    process.env.R2_ENDPOINT,
  R2_ACCOUNT_ID:  process.env.R2_ACCOUNT_ID,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  R2_ACCESS_KEY:  process.env.R2_ACCESS_KEY,
  R2_SECRET_KEY:  process.env.R2_SECRET_KEY,
  R2_PUBLIC_URL:  process.env.R2_PUBLIC_URL,
};

let hasError = false;

console.log('── Environment Variables ─────────────────────');
for (const [key, val] of Object.entries(checks)) {
  const isSecret = key === 'R2_ACCESS_KEY' || key === 'R2_SECRET_KEY';
  if (!val) {
    console.log(`  ❌ ${key}: MISSING`);
    hasError = true;
  } else if (isSecret) {
    console.log(`  ✅ ${key}: set (${val.length} chars)`);
  } else {
    console.log(`  ✅ ${key}: ${val}`);
  }
}

// ── 2. Resolve endpoint ───────────────────────────────────────────────────────

const endpoint = checks.R2_ENDPOINT ||
  (checks.R2_ACCOUNT_ID ? `https://${checks.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);

const bucket = checks.R2_BUCKET_NAME;

console.log('\n── Resolved Configuration ────────────────────');
console.log(`  Endpoint : ${endpoint || 'NONE — cannot proceed'}`);
console.log(`  Bucket   : ${bucket   || 'NONE — cannot proceed'}`);

if (!endpoint || !bucket || !checks.R2_ACCESS_KEY || !checks.R2_SECRET_KEY) {
  console.log('\n❌ Cannot test — required variables are missing.');
  process.exit(1);
}

// ── 3. Build client ───────────────────────────────────────────────────────────

const client = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId:     checks.R2_ACCESS_KEY,
    secretAccessKey: checks.R2_SECRET_KEY,
  },
});

// ── 4. Test: ListObjects (verifies read access) ───────────────────────────────

console.log('\n── Test 1: ListObjects (read access) ─────────');
try {
  const listCmd = new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 });
  const listRes = await client.send(listCmd);
  console.log(`  ✅ ListObjects succeeded`);
  console.log(`     Objects in bucket (first 1): ${listRes.KeyCount ?? 0}`);
} catch (err) {
  console.log(`  ❌ ListObjects FAILED`);
  console.log(`     Code    : ${err.Code || err.code || err.name}`);
  console.log(`     Message : ${err.message}`);
  console.log(`     Status  : ${err.$metadata?.httpStatusCode}`);
  console.log(`     Bucket  : ${bucket}`);
  console.log(`     Endpoint: ${endpoint}`);
  if (err.$metadata?.httpStatusCode === 403) {
    console.log('\n  ⚠️  403 = One of:');
    console.log('     a) API token does not have Object:Read on this bucket');
    console.log('     b) Bucket name is wrong (bucket exists but under different account)');
    console.log('     c) Access key belongs to wrong Cloudflare account');
  } else if (err.$metadata?.httpStatusCode === 404) {
    console.log('\n  ⚠️  404 = Bucket does not exist at this endpoint');
  }
}

// ── 5. Test: PutObject (verifies write access) ───────────────────────────────

console.log('\n── Test 2: PutObject (write access) ──────────');
const testKey = `r2-test-${Date.now()}.txt`;
try {
  const putCmd = new PutObjectCommand({
    Bucket:      bucket,
    Key:         testKey,
    Body:        Buffer.from('R2 connectivity test'),
    ContentType: 'text/plain',
  });
  await client.send(putCmd);
  console.log(`  ✅ PutObject succeeded — key: ${testKey}`);

  // ── 6. Test: DeleteObject (verifies delete access) ─────────────────────────
  console.log('\n── Test 3: DeleteObject (delete access) ──────');
  const delCmd = new DeleteObjectCommand({ Bucket: bucket, Key: testKey });
  await client.send(delCmd);
  console.log(`  ✅ DeleteObject succeeded — test object cleaned up`);

} catch (err) {
  console.log(`  ❌ PutObject FAILED`);
  console.log(`     Code    : ${err.Code || err.code || err.name}`);
  console.log(`     Message : ${err.message}`);
  console.log(`     Status  : ${err.$metadata?.httpStatusCode}`);
  console.log(`     Command : PutObject`);
  console.log(`     Bucket  : ${bucket}`);
  console.log(`     Key     : ${testKey}`);
  console.log(`     Endpoint: ${endpoint}`);
  if (err.$metadata?.httpStatusCode === 403) {
    console.log('\n  ⚠️  403 Access Denied means:');
    console.log('     → The API token EXISTS and is valid (auth passed)');
    console.log('     → But it LACKS "Object Write" permission on this bucket');
    console.log('     → Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens');
    console.log('     → Edit the token and enable: Object Read, Object Write, Object Delete');
    console.log('     → Scope it to the specific bucket:', bucket);
  }
}

console.log('\n── Summary ────────────────────────────────────');
console.log('  If all 3 tests pass → R2 is fully working.');
console.log('  If Test 1 fails with 403 → read permission missing.');
console.log('  If Test 2 fails with 403 → write permission missing.');
console.log('  If Test 2 fails with 404 → bucket name wrong.\n');
