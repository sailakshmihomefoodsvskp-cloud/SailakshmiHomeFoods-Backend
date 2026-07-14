import jwt from 'jsonwebtoken';

// Hardcoded admin credentials
const ADMIN_CREDENTIALS = {
  mobile: '9966539144',
  password: 'sailakshmihomefoods123'
};

// JWT Secret - should be in .env in production
const JWT_SECRET = process.env.JWT_SECRET || 'sailakshmi-admin-secret-key-2024';
const JWT_EXPIRES_IN = '7d';

// Verify admin JWT token middleware
export const verifyAdminToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Admin authentication required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token format'
      });
    }
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      if (!decoded.isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. Admin only.'
        });
      }
      
      req.admin = decoded;
      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please login again.'
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Admin login function
export const adminLogin = (mobile, password) => {
  if (mobile === ADMIN_CREDENTIALS.mobile && password === ADMIN_CREDENTIALS.password) {
    const token = jwt.sign(
      { 
        mobile: ADMIN_CREDENTIALS.mobile,
        isAdmin: true,
        loginAt: new Date().toISOString()
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    return {
      success: true,
      token,
      admin: {
        mobile: ADMIN_CREDENTIALS.mobile,
        name: 'Admin'
      }
    };
  }
  
  return {
    success: false,
    message: 'Invalid credentials'
  };
};

export { JWT_SECRET };
