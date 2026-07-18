/**
 * User Model — Supabase PostgreSQL
 *
 * Upsert strategy:
 *  - New user  → INSERT with all fields
 *  - Existing  → UPDATE only: last_login, name, photo_url, phone
 *                Never overwrite email, firebase_uid, auth_provider, created_at
 *
 * Unique identifiers: firebase_uid (primary), email (fallback)
 */

import bcrypt from 'bcryptjs';
import getSupabase from '../config/supabase.js';

const TABLE = 'users';

// ── READ ─────────────────────────────────────────────────────────────────────

export const findUserByFirebaseUid = async (firebaseUid) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('firebase_uid', firebaseUid)
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const findUserByEmail = async (email) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const findUserById = async (id) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
};

// ── WRITE ────────────────────────────────────────────────────────────────────

/**
 * Create a new user row (insert only — caller must check for existing first).
 */
export const createUser = async ({
  firebaseUid = null,
  name,
  email,
  phone      = '',
  photoUrl   = null,
  password   = null,
  authProvider = 'email',
  role       = 'customer',
}) => {
  let hashedPassword = null;
  if (password) {
    const salt = await bcrypt.genSalt(10);
    hashedPassword = await bcrypt.hash(password, salt);
  }

  const now = new Date().toISOString();

  const { data, error } = await getSupabase()
    .from(TABLE)
    .insert({
      firebase_uid:  firebaseUid,
      name:          name.trim(),
      email:         email.toLowerCase().trim(),
      phone:         phone || '',
      photo_url:     photoUrl,
      password_hash: hashedPassword,
      auth_provider: authProvider,
      role,
      last_login:    now,
      created_at:    now,
      updated_at:    now,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
};

/**
 * Update the fields that should change on every login:
 *   last_login, name (display name can change), photo_url, phone
 * Never duplicates; never overwrites identity fields.
 */
export const touchUserOnLogin = async (id, { name, photoUrl, phone } = {}) => {
  const updates = {
    last_login: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (name)     updates.name      = name.trim();
  if (photoUrl) updates.photo_url = photoUrl;
  if (phone)    updates.phone     = phone;

  const { data, error } = await getSupabase()
    .from(TABLE)
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
};

/**
 * Link a firebase_uid to an existing user that was found by email.
 */
export const linkFirebaseUid = async (userId, firebaseUid) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .update({ firebase_uid: firebaseUid, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
};

/**
 * Full upsert for Google / sync login:
 *  1. Find by firebase_uid
 *  2. If found → touchUserOnLogin (update last_login + display fields)
 *  3. If not found by UID → find by email
 *     a. Found by email → link UID + touchUserOnLogin
 *     b. Not found → createUser
 *
 * Returns the final user row. Never creates duplicates.
 */
export const upsertUserFromFirebase = async ({
  uid,
  email,
  name,
  photoUrl  = null,
  phone     = '',
  authProvider = 'google',
}) => {
  // 1. Try by firebase_uid first (fastest path for returning users)
  let user = await findUserByFirebaseUid(uid);
  if (user) {
    return touchUserOnLogin(user.id, { name, photoUrl, phone });
  }

  // 2. Try by email (handles users who registered before Google login)
  user = await findUserByEmail(email);
  if (user) {
    // Link the firebase_uid so future lookups are fast
    user = await linkFirebaseUid(user.id, uid);
    return touchUserOnLogin(user.id, { name, photoUrl, phone });
  }

  // 3. Brand-new user — create
  return createUser({ firebaseUid: uid, email, name, photoUrl, phone, authProvider });
};

/**
 * Update arbitrary profile fields by firebase_uid (profile edit screen).
 */
export const updateUserProfile = async (firebaseUid, updates) => {
  const { data, error } = await getSupabase()
    .from(TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('firebase_uid', firebaseUid)
    .select('*')
    .single();

  if (error) throw error;
  return data;
};

// ── UTILS ────────────────────────────────────────────────────────────────────

export const verifyPassword = async (plainPassword, passwordHash) => {
  if (!passwordHash) return false;
  return bcrypt.compare(plainPassword, passwordHash);
};

/**
 * Strip sensitive columns before sending to client.
 */
export const sanitizeUser = (user) => {
  if (!user) return null;
  // eslint-disable-next-line no-unused-vars
  const { password_hash, ...safeUser } = user;
  return safeUser;
};
