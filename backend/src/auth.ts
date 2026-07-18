import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import type { CookieOptions, NextFunction, Request, Response } from "express";
import config from "./config.ts";

export interface AuthPayload extends JwtPayload {
  username: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

interface AttemptRecord {
  attempts: number;
  lockoutUntil: number | null;
}

interface RateLimitStatus {
  allowed: boolean;
  remainingSeconds?: number;
}

const loginAttempts = new Map<string, AttemptRecord>();

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts) {
    if (!record.lockoutUntil || record.lockoutUntil <= now) {
      loginAttempts.delete(ip);
    }
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref?.();

function getClientIp(req: Request): string {
  return req.ip || "unknown-ip";
}

export function checkLoginRateLimit(req: Request): RateLimitStatus {
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

  if (record.lockoutUntil && record.lockoutUntil <= now) {
    loginAttempts.delete(ip);
  }

  return { allowed: true };
}

export function recordFailedLogin(req: Request): { blocked: boolean } {
  const ip = getClientIp(req);
  const now = Date.now();
  let record = loginAttempts.get(ip);

  if (!record) {
    record = { attempts: 0, lockoutUntil: null };
    loginAttempts.set(ip, record);
  }

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

export function recordSuccessfulLogin(req: Request): void {
  const ip = getClientIp(req);
  loginAttempts.delete(ip);
}

export function issueToken(username: string): string {
  return jwt.sign({ username }, config.JWT_SECRET, {
    expiresIn: "7d",
    algorithm: "HS256",
  });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] }) as AuthPayload;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.authToken;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function credentialsAreValid(username: string, password: string): boolean {
  const userOk = constantTimeEquals(username, config.ADMIN_USERNAME);
  const passOk = constantTimeEquals(password, config.ADMIN_PASSWORD);
  return userOk && passOk;
}

export function cookieOptions(): CookieOptions {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: config.BASE_PATH,
  };
}
