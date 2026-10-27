import { systemClock, type Clock } from './clock';

/**
 * Fixed-window counter held in process memory. Good enough for a single server instance; if the app is ever scaled
 * to several instances this must move to the database. Used for endpoints that bypass Better Auth's own limiter
 * (it does not apply to server-side auth.api calls), e.g. registration (BR-M01-09).
 */
export function createRateLimiter(clock: Clock = systemClock) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    /** Returns true when the call is allowed, false when `key` exceeded `max` within `windowMs`. */
    allow(key: string, max: number, windowMs: number): boolean {
      const now = clock.now().getTime();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
        return true;
      }
      bucket.count += 1;
      return bucket.count <= max;
    },
  };
}

export const limiter = createRateLimiter();
