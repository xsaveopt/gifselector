const jwt = require("jsonwebtoken");
const config = require("./config");

const loginAttempts = new Map();

function getClientIp(req) {
  // express 'trust proxy' setting handles x-forwarded-for
  return req.ip;
}

function checkLoginRateLimit(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record) {
    return { allowed: true };
  }

  if (record.lockoutUntil && record.lockoutUntil > now) {
    const remainingSeconds = Math.ceil((record.lockoutUntil - now) / 1000);
    return { allowed: false, remainingSeconds };
  }

  // If lockout has expired, remove the record so they start fresh
  if (record.lockoutUntil && record.lockoutUntil <= now) {
    loginAttempts.delete(ip);
  }

  return { allowed: true };
}

function recordFailedLogin(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  let record = loginAttempts.get(ip);

  if (!record) {
    record = { attempts: 0, lockoutUntil: null };
    loginAttempts.set(ip, record);
  }

  // If previously locked out and expired (though checkLoginRateLimit handles deletion), ensure clean state
  if (record.lockoutUntil && record.lockoutUntil <= now) {
    record.attempts = 0;
    record.lockoutUntil = null;
  }

  record.attempts += 1;

  if (record.attempts >= config.MAX_LOGIN_ATTEMPTS) {
    record.lockoutUntil = now + config.LOCKOUT_DURATION_MS;
    return { blocked: true };
  }

  return { blocked: false };
}

function recordSuccessfulLogin(req) {
  const ip = getClientIp(req);
  loginAttempts.delete(ip);
}

function issueToken(username) {
  return jwt.sign({ username }, config.JWT_SECRET, { expiresIn: "7d" });
}

function verifyToken(token) {
  return jwt.verify(token, config.JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.authToken;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = verifyToken(token);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

function credentialsAreValid(username, password) {
  return (
    username === config.ADMIN_USERNAME && password === config.ADMIN_PASSWORD
  );
}

function cookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: config.BASE_PATH,
  };
}

module.exports = {
  issueToken,
  verifyToken,
  authMiddleware,
  credentialsAreValid,
  cookieOptions,
  checkLoginRateLimit,
  recordFailedLogin,
  recordSuccessfulLogin,
};
