const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const tokenCache = require('../lib/tokenCache');

module.exports = function (req, res, next) {
  // Allow preflight requests
  if (req.method === 'OPTIONS') return next();
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    // If token contains jti, ensure it's not revoked in the in-memory cache
    const jti = decoded && decoded.jti;
    if (jti && tokenCache.isRevoked(jti)) {
      return res.status(401).json({ success: false, message: 'Token revoked' });
    }

    req.user = decoded;
    next();
  });
};
