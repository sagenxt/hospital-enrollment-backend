const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const tokenCache = require('../lib/tokenCache');

const SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

exports.login = (req, res) => {
  const { username, password } = req.body;
  if (username === 'Admin' && password === 'DeptAdm!n@2025') {
    // Generate a unique jti for the token and sign token valid for 1 hour
    const jti = randomUUID();
    // Do not include jti in the payload when also passing jwtid option (jsonwebtoken will add jti)
    const token = jwt.sign({ username }, SECRET, { expiresIn: '1h', jwtid: jti });
    return res.json({ success: true, message: 'Login successful', token, jti });
  }
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
};

// Logout: revoke token by storing its jti in local cache for 30 minutes
exports.logout = (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(400).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.payload) {
      return res.status(400).json({ success: false, message: 'Invalid token' });
    }
    const payload = decoded.payload;
    const jti = payload.jti || (decoded.header && decoded.header.jti);
    if (!jti) {
      return res.status(400).json({ success: false, message: 'Token has no jti; cannot revoke' });
    }

    // Store revoked jti in in-memory cache for 30 minutes (1800 seconds)
    tokenCache.setRevoked(jti, 1800);
    return res.json({ success: true, message: 'Logged out, token revoked' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
