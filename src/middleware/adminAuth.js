/**
 * Admin Authentication Middleware
 *
 * Credentials are loaded from environment variables.
 * ALL required variables MUST be set — no insecure fallbacks in production.
 *
 * Required .env variables:
 *   ADMIN_MOBILE    — admin login mobile number
 *   ADMIN_PASSWORD  — admin login password
 *   JWT_SECRET      — secret used to sign/verify admin JWT tokens
 *
 * If JWT_SECRET changes (e.g. redeployment), all existing admin sessions
 * are invalidated and admin must log in again to get a fresh token.
 */

import jwt from 'jsonwebtoken';

// Read credentials from environment — NO insecure hardcoded fallbacks
const getAdminCredentials = () => {
  const mobile   = process.env.ADMIN_MOBILE;
  const password = process.env.ADMIN_PASSWORD;
  if (!mobile || !password) {
    throw new Error('ADMIN_MOBILE and ADMIN_PASSWORD environment variables are required');
  }
  return { mobile, password };
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
};

const JWT_EXPIRES_IN = '7d';

// ── Verify admin JWT token middleware ─────────────────────────────────────────

export const verifyAdminToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'Invalid token format' });
    }

    let secret;
    try {
      secret = getJwtSecret();
    } catch (err) {
      console.error('[adminAuth] JWT secret missing:', err.message);
      return res.status(500).json({ success: false, message: 'Server configuration error' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please login again.',
        });
      }
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    if (!decoded.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.',
      });
    }

    req.admin = decoded;
    next();
  } catch (error) {
    console.error('Admin auth error:', error.message);
    return res.status(500).json({ success: false, message: 'Authentication failed' });
  }
};

// ── Admin login function ──────────────────────────────────────────────────────

export const adminLogin = (mobile, password) => {
  let creds;
  try {
    creds = getAdminCredentials();
  } catch (err) {
    console.error('[adminAuth] Configuration error:', err.message);
    return { success: false, message: 'Server configuration error' };
  }

  if (mobile === creds.mobile && password === creds.password) {
    let secret;
    try {
      secret = getJwtSecret();
    } catch (err) {
      console.error('[adminAuth] JWT secret missing:', err.message);
      return { success: false, message: 'Server configuration error' };
    }

    const token = jwt.sign(
      {
        mobile:   creds.mobile,
        isAdmin:  true,
        loginAt:  new Date().toISOString(),
      },
      secret,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return {
      success: true,
      token,
      admin: { mobile: creds.mobile, name: 'Admin' },
    };
  }

  return { success: false, message: 'Invalid credentials' };
};
