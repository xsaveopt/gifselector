interface UserBucket {
  count: number;
  resetAt: number;
}

export interface QuotaDecision {
  allowed: number;
  retryAfterSeconds: number;
}

export interface UserRateLimiter {
  take(userId: string, requested: number, now?: number): QuotaDecision;
  reset(): void;
}

export function createUserRateLimiter(max: number, windowMs: number): UserRateLimiter {
  const buckets = new Map<string, UserBucket>();

  return {
    take(userId, requested, now = Date.now()) {
      let bucket = buckets.get(userId);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(userId, bucket);
      }

      for (const [key, entry] of buckets) {
        if (entry.resetAt <= now) {
          buckets.delete(key);
        }
      }

      const remaining = Math.max(0, max - bucket.count);
      const allowed = Math.min(requested, remaining);
      bucket.count += allowed;

      return {
        allowed,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    },
    reset() {
      buckets.clear();
    },
  };
}
