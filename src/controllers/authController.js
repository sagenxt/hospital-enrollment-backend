const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

exports.login = (req, res) => {
  const { username, password } = req.body;
  if (username === 'Admin' && password === 'Admin') {
    // Generate JWT token valid for 1 hour
    const token = jwt.sign({ username }, SECRET, { expiresIn: '1h' });
    return res.json({ success: true, message: 'Login successful', token });
  }
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
};
