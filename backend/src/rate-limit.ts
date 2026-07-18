import type { RequestHandler } from "express";

interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter({ windowMs, max }: RateLimiterOptions): RequestHandler {
  const hits = new Map<string, RateBucket>();

  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of hits) {
      if (bucket.resetAt <= now) {
        hits.delete(key);
      }
    }
  }, windowMs);
  sweepTimer.unref?.();

  return function rateLimit(req, res, next) {
    const key = req.ip || "unknown-ip";
    const now = Date.now();
    let bucket = hits.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      hits.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Too many requests." });
      return;
    }
    next();
  };
}
