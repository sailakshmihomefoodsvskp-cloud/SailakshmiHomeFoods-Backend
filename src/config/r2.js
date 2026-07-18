/**
 * Cloudflare R2 Client Configuration
 * R2 is S3-compatible — we use the AWS SDK v3.
 *
 * ── IMPORTANT: ES Module timing ──────────────────────────────────────────────
 * In Node.js ESM, all import statements are hoisted and resolved BEFORE any
 * code in the importing file runs — including dotenv.config(). This means
 * module-level expressions like:
 *
 *   export const R2_BUCKET = process.env.R2_BUCKET_NAME || 'fallback';
 *
 * evaluate BEFORE dotenv loads the .env file, so process.env.R2_BUCKET_NAME
 * is always undefined and the fallback is always used.
 *
 * All environment variable reads MUST happen inside functions, not at the
 * module top level. This file uses getter functions for that reason.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Endpoint resolution priority:
 *  1. R2_ENDPOINT   — full S3 endpoint URL from the R2 dashboard
 *                     e.g. https://cdbb6e498c4c747b9f78c0f734c15ba4.r2.cloudflarestorage.com
 *  2. R2_ACCOUNT_ID — the account ID; endpoint is derived automatically
 *
 * You only need ONE of the two. R2_ENDPOINT takes priority.
 */

import { S3Client } from '@aws-sdk/client-s3';

let r2Client = null;

// ── Lazy client — reads env vars at first call, not at module load ────────────

export const getR2Client = () => {
  if (!r2Client) {
    const accessKey = process.env.R2_ACCESS_KEY;
    const secretKey = process.env.R2_SECRET_KEY;

    if (!accessKey || !secretKey) {
      throw new Error(
        'Cloudflare R2 credentials missing. ' +
        'Set R2_ACCESS_KEY and R2_SECRET_KEY in your .env file.\n' +
        `  R2_ACCESS_KEY : ${accessKey ? 'set' : 'MISSING'}\n` +
        `  R2_SECRET_KEY : ${secretKey ? 'set' : 'MISSING'}`
      );
    }

    let endpoint = process.env.R2_ENDPOINT;

    if (!endpoint) {
      const accountId = process.env.R2_ACCOUNT_ID;
      if (!accountId || accountId === 'your-cloudflare-account-id') {
        throw new Error(
          'Cloudflare R2 endpoint not configured.\n' +
          'Set R2_ENDPOINT (e.g. https://<account-id>.r2.cloudflarestorage.com) ' +
          'or R2_ACCOUNT_ID in your .env file.'
        );
      }
      endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    }

    console.log('[R2] Initialising client');
    console.log(`[R2]   Endpoint  : ${endpoint}`);
    console.log(`[R2]   Bucket    : ${process.env.R2_BUCKET_NAME || '(not set — will use fallback)'}`);
    console.log(`[R2]   AccessKey : ${accessKey.slice(0, 6)}...`);

    r2Client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId:     accessKey,
        secretAccessKey: secretKey,
      },
    });
  }
  return r2Client;
};

/**
 * Returns the bucket name — reads process.env at call time.
 * Never use a module-level constant for this value in ESM.
 */
export const getR2Bucket = () => {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error(
      'R2_BUCKET_NAME is not set in .env. ' +
      'Add R2_BUCKET_NAME=<your-bucket-name> to your .env file.'
    );
  }
  return bucket;
};

/**
 * Build the public URL for an R2 object.
 * Reads R2_PUBLIC_URL at call time.
 */
export const getR2PublicUrl = (key) => {
  const base = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
  if (!base) {
    throw new Error(
      'R2_PUBLIC_URL is not set in .env. ' +
      'Add R2_PUBLIC_URL=https://your-public-domain.com to your .env file.'
    );
  }
  return `${base}/${key}`;
};

// ── Legacy export — kept for backward compatibility ───────────────────────────
// This is still a module-level constant, so it evaluates BEFORE dotenv runs.
// Do NOT use R2_BUCKET in any code — use getR2Bucket() instead.
// This export exists only to avoid breaking any external code that imports it.
/** @deprecated Use getR2Bucket() instead */
export const R2_BUCKET = 'USE_GET_R2_BUCKET_FUNCTION';
