/**
 * R2 Image Cleanup Script
 *
 * Deletes Cloudflare R2 objects for products that are NOT in the
 * authorised catalog. Run BEFORE running supabase-cleanup-products.sql,
 * or pass --all to delete every R2 object not belonging to kept products.
 *
 * Usage:
 *   node cleanup-r2-images.js          — dry run (shows what would be deleted)
 *   node cleanup-r2-images.js --delete — actually deletes from R2
 *
 * Prerequisites:
 *   R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET_NAME in .env
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE in .env
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const DRY_RUN = !process.argv.includes('--delete');

const AUTHORISED_IDS = new Set([1, 2, 7, 8, 101, 208, 212]);

// ── Clients ──────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL.replace(/\/+$/, ''),
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getKeptImageKeys() {
  const { data, error } = await supabase
    .from('products')
    .select('product_id, image_key')
    .in('product_id', [...AUTHORISED_IDS])
    .not('image_key', 'is', null);

  if (error) throw error;
  return new Set((data || []).map((r) => r.image_key).filter(Boolean));
}

async function listAllR2Keys() {
  const keys = [];
  let continuationToken;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket:             BUCKET,
      ContinuationToken:  continuationToken,
    });
    const response = await r2.send(cmd);
    (response.Contents || []).forEach((obj) => keys.push(obj.Key));
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function deleteR2Objects(keys) {
  if (keys.length === 0) return;

  // R2 DeleteObjects supports up to 1000 keys per request
  const chunks = [];
  for (let i = 0; i < keys.length; i += 1000) {
    chunks.push(keys.slice(i, i + 1000));
  }

  for (const chunk of chunks) {
    const cmd = new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: false },
    });
    const result = await r2.send(cmd);
    if (result.Errors?.length) {
      console.error('R2 delete errors:', result.Errors);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     R2 Image Cleanup                         ║');
  console.log(`║     Mode: ${DRY_RUN ? 'DRY RUN (no changes)     ' : 'LIVE — WILL DELETE OBJECTS'}  ║`);
  console.log('╚══════════════════════════════════════════════╝\n');

  // 1. Get image keys of kept products
  const keptKeys = await getKeptImageKeys();
  console.log(`Kept product image keys (${keptKeys.size}):`, [...keptKeys]);

  // 2. List all objects in R2 bucket
  const allKeys = await listAllR2Keys();
  console.log(`\nTotal objects in R2 bucket "${BUCKET}": ${allKeys.length}`);

  // 3. Identify orphaned keys
  const toDelete = allKeys.filter((key) => !keptKeys.has(key));
  console.log(`\nObjects to delete: ${toDelete.length}`);
  toDelete.forEach((k) => console.log(`  DELETE → ${k}`));

  if (toDelete.length === 0) {
    console.log('\n✅ Nothing to delete — R2 is already clean.');
    return;
  }

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN — no objects deleted.');
    console.log('    Run with --delete flag to actually remove them:');
    console.log('    node cleanup-r2-images.js --delete');
    return;
  }

  // 4. Delete
  await deleteR2Objects(toDelete);
  console.log(`\n✅ Deleted ${toDelete.length} orphaned R2 object(s).`);
}

main().catch((err) => {
  console.error('\n❌ Cleanup failed:', err.message);
  process.exit(1);
});
