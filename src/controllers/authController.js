/**
 * Auth Controller — Supabase version
 *
 * Google auth flow:
 *  1. Frontend sends Firebase ID token in request body
 *  2. Backend verifies it with Firebase Admin SDK
 *  3. upsertUserFromFirebase → find-or-create, update last_login
 *  4. Return sanitized user to frontend
 *
 * Firebase token verification is UNCHANGED from the original.
 * Only the database layer changed (MongoDB → Supabase).
 */

import { admin, isFirebaseInitialized } from '../config/firebase.js';
import {
  upsertUserFromFirebase,
  findUserByEmail,
  createUser,
  sanitizeUser,
  verifyPassword,
} from '../models/userModel.js';

// ── Google Authentication ────────────────────────────────────────────────────

export const googleAuth = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
      });
    }

    if (!isFirebaseInitialized()) {
      return res.status(500).json({
        success: false,
        message: 'Server configuration error',
      });
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch (verifyError) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
        code: verifyError.code,
      });
    }

    const user = await upsertUserFromFirebase({
      uid:         decoded.uid,
      email:       decoded.email,
      name:        decoded.name || decoded.email.split('@')[0],
      photoUrl:    decoded.picture || null,
      authProvider: 'google',
    });

    return res.status(200).json({
      success: true,
      message: 'Authentication successful',
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('[auth] Google auth error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ── Sync User (token in Authorization header, decoded by verifyToken middleware) ─

export const syncUser = async (req, res) => {
  try {
    const { uid, email, name, picture } = req.user;

    const user = await upsertUserFromFirebase({
      uid,
      email,
      name:        name || email.split('@')[0],
      photoUrl:    picture || null,
      authProvider: 'google',
    });

    return res.status(200).json({
      success: true,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('[auth] Sync user error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ── Email Registration ───────────────────────────────────────────────────────

export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email and password are required',
      });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }

    const user = await createUser({ name, email, password, authProvider: 'email' });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('❌ Registration error:', error.message);
    return res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

// ── Email Login ──────────────────────────────────────────────────────────────

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'No account found with this email',
      });
    }

    if (user.auth_provider === 'google' && !user.password_hash) {
      return res.status(401).json({
        success: false,
        message: 'This account uses Google Sign-In. Please use Google to login.',
      });
    }

    const isMatch = await verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('❌ Login error:', error.message);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
};
