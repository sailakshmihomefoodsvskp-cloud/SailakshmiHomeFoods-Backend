/**
 * Image Service
 *
 * Pipeline:
 *   Upload buffer
 *     → Validate (mime type + magic bytes)
 *     → Resize   (max 1200px width, preserve aspect ratio)
 *     → Compress (WebP, auto-reduce quality until ≤ 300 KB)
 *     → Upload   (Cloudflare R2)
 *     → Return   { url, key, sizeKb }
 *
 * All environment variables are read at call time (never at module load)
 * to avoid the ES module hoisting issue where module-level process.env
 * reads execute before dotenv.config() in the entry file.
 */

import sharp from 'sharp';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getR2Client, getR2Bucket, getR2PublicUrl } from '../config/r2.js';

const MAX_WIDTH       = 1200;
const TARGET_BYTES    = 300 * 1024; // 300 KB
const INITIAL_QUALITY = 85;
const MIN_QUALITY     = 30;
const QUALITY_STEP    = 5;

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// ── Validation ────────────────────────────────────────────────────────────────

const validateImageBuffer = (buffer, mimetype) => {
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    throw new Error(
      `Invalid file type: ${mimetype}. Only JPEG, PNG, and WebP are allowed.`
    );
  }

  const header = buffer.slice(0, 12);
  const isJpeg = header[0] === 0xff && header[1] === 0xd8;
  const isPng  = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
  const isWebP = header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;

  if (!isJpeg && !isPng && !isWebP) {
    throw new Error(
      'File content does not match an allowed image format (JPEG, PNG, WebP).'
    );
  }
};

// ── Image processing ──────────────────────────────────────────────────────────

/**
 * Resize, strip EXIF, and compress to WebP ≤ 300 KB.
 */
export const processImage = async (inputBuffer, mimetype) => {
  validateImageBuffer(inputBuffer, mimetype);

  let quality = INITIAL_QUALITY;
  let outputBuffer;

  // Phase 1: reduce quality until ≤ 300 KB
  do {
    outputBuffer = await sharp(inputBuffer)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .rotate()                    // auto-orient from EXIF
      .withMetadata({ exif: {} })  // strip all metadata
      .webp({ quality })
      .toBuffer();

    if (outputBuffer.length <= TARGET_BYTES) break;
    quality -= QUALITY_STEP;
  } while (quality >= MIN_QUALITY);

  // Phase 2: if still over limit, shrink dimensions as well
  if (outputBuffer.length > TARGET_BYTES) {
    let width = Math.floor(MAX_WIDTH * 0.75);
    while (outputBuffer.length > TARGET_BYTES && width >= 400) {
      outputBuffer = await sharp(inputBuffer)
        .resize({ width, withoutEnlargement: true })
        .rotate()
        .withMetadata({ exif: {} })
        .webp({ quality: MIN_QUALITY })
        .toBuffer();
      width = Math.floor(width * 0.85);
    }
  }

  return outputBuffer;
};

// ── Key generation ────────────────────────────────────────────────────────────

export const generateImageKey = (prefix = 'product') => {
  const slug =
    prefix
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'product';

  return `products/${slug}-${Date.now()}.webp`;
};

// ── R2 operations ─────────────────────────────────────────────────────────────

/**
 * Upload a WebP buffer to Cloudflare R2.
 * Bucket name is read at call time via getR2Bucket() to avoid ESM hoisting.
 */
export const uploadToR2 = async (buffer, key) => {
  const client = getR2Client();
  const bucket = getR2Bucket(); // ← call-time read, after dotenv has run

  console.log(
    `[R2] PutObject → bucket: ${bucket}, key: ${key}, ` +
    `size: ${Math.round(buffer.length / 1024)} KB`
  );

  const command = new PutObjectCommand({
    Bucket:       bucket,
    Key:          key,
    Body:         buffer,
    ContentType:  'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  });

  try {
    await client.send(command);
  } catch (err) {
    const status = err.$metadata?.httpStatusCode;

    console.error('[R2] PutObject FAILED');
    console.error(`     Bucket    : ${bucket}`);
    console.error(`     Key       : ${key}`);
    console.error(`     HTTP      : ${status}`);
    console.error(`     Code      : ${err.Code || err.code || err.name}`);
    console.error(`     Message   : ${err.message}`);
    console.error(`     Endpoint  : ${process.env.R2_ENDPOINT || '(from R2_ACCOUNT_ID)'}`);
    console.error(`     AccessKey : ${process.env.R2_ACCESS_KEY?.slice(0, 6) ?? 'MISSING'}...`);

    if (status === 403) {
      console.error(
        '\n     ⚠️  403 AccessDenied — most likely causes:\n' +
        `       1. R2 API token lacks Object:Write on bucket "${bucket}"\n` +
        `       2. Bucket name mismatch (bucket in use: "${bucket}")\n` +
        '       3. Run: node test-r2.js  — to verify credentials independently'
      );
    } else if (status === 404) {
      console.error(`\n     ⚠️  404 — bucket "${bucket}" does not exist`);
    }

    throw err;
  }

  const url = getR2PublicUrl(key);
  console.log(`[R2] PutObject OK → ${url}`);
  return { url, key };
};

/**
 * Delete an R2 object. Throws on failure so callers can roll back.
 */
export const deleteFromR2 = async (key) => {
  if (!key) {
    console.warn('[R2] deleteFromR2: empty key — skipping');
    return;
  }

  const client = getR2Client();
  const bucket = getR2Bucket(); // ← call-time read

  console.log(`[R2] DeleteObject → bucket: ${bucket}, key: ${key}`);

  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log(`[R2] DeleteObject OK → ${key}`);
  } catch (err) {
    console.error('[R2] DeleteObject FAILED');
    console.error(`     Bucket  : ${bucket}`);
    console.error(`     Key     : ${key}`);
    console.error(`     HTTP    : ${err.$metadata?.httpStatusCode}`);
    console.error(`     Code    : ${err.Code || err.code || err.name}`);
    console.error(`     Message : ${err.message}`);
    throw err;
  }
};

// ── Full pipeline ─────────────────────────────────────────────────────────────

/**
 * validate → process → upload
 * Returns { url, key, sizeKb }
 */
export const uploadProductImage = async (buffer, mimetype, namePrefix = 'product') => {
  console.log(`[imageService] Processing image — prefix: "${namePrefix}", mime: ${mimetype}`);

  const processed = await processImage(buffer, mimetype);
  const sizeKb    = Math.round(processed.length / 1024);
  console.log(`[imageService] Sharp output: ${sizeKb} KB WebP`);

  const key     = generateImageKey(namePrefix);
  const { url } = await uploadToR2(processed, key);

  console.log(`[imageService] Upload complete — ${sizeKb} KB → ${url}`);
  return { url, key, sizeKb };
};
