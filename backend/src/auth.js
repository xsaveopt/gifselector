const jwt = require('jsonwebtoken');
const config = require('./config');

function issueToken(username) {
  return jwt.sign({ username }, config.JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  return jwt.verify(token, config.JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.authToken;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = verifyToken(token);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function credentialsAreValid(username, password) {
  return username === config.ADMIN_USERNAME && password === config.ADMIN_PASSWORD;
}

function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: config.BASE_PATH
  };
}

module.exports = {
  issueToken,
  verifyToken,
  authMiddleware,
  credentialsAreValid,
  cookieOptions
};
