import { admin, isFirebaseInitialized } from '../config/firebase.js';

// Verify Firebase ID Token Middleware
export const verifyToken = async (req, res, next) => {
  try {
    // Check if Firebase is initialized
    if (!isFirebaseInitialized()) {
      return res.status(500).json({ 
        success: false, 
        message: 'Server configuration error' 
      });
    }

    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authorization header required' 
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid authorization format. Use: Bearer <token>' 
      });
    }

    const token = authHeader.split(' ')[1];
    
    if (!token || token === 'undefined' || token === 'null' || token.length < 100) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token provided' 
      });
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      // Attach user info to request — include picture for user upsert
      req.user = {
        uid:     decodedToken.uid,
        email:   decodedToken.email,
        name:    decodedToken.name || decodedToken.email?.split('@')[0] || 'User',
        picture: decodedToken.picture || null,
      };
      
      next();
      
    } catch (firebaseError) {
      // Only log the error code, never the token or user data
      if (process.env.NODE_ENV !== 'production') {
        console.error('[auth] Token verification failed:', firebaseError.code);
      }
      
      let message = 'Invalid or expired token';
      
      if (firebaseError.code === 'auth/id-token-expired') {
        message = 'Token has expired. Please sign in again.';
      } else if (firebaseError.code === 'auth/argument-error') {
        message = 'Invalid token format.';
      } else if (firebaseError.code === 'auth/id-token-revoked') {
        message = 'Token has been revoked. Please sign in again.';
      } else if (firebaseError.message?.includes('Firebase ID token has incorrect')) {
        message = 'Token project mismatch. Check your configuration.';
      }
      
      return res.status(401).json({ 
        success: false, 
        message,
        code: firebaseError.code
      });
    }
    
  } catch (error) {
    console.error('[auth] Middleware unexpected error:', error.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Authentication failed' 
    });
  }
};

// Optional auth - continues even without token
export const optionalAuth = async (req, res, next) => {
  try {
    if (!isFirebaseInitialized()) {
      return next();
    }

    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    
    if (!token || token === 'undefined' || token === 'null') {
      return next();
    }
    
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.user = {
        uid:     decodedToken.uid,
        email:   decodedToken.email,
        name:    decodedToken.name || decodedToken.email?.split('@')[0],
        picture: decodedToken.picture || null,
      };
    } catch {
      // Token invalid but continue anyway for optional auth
    }
    
    next();
  } catch (error) {
    next();
  }
};
