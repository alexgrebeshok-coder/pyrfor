/**
 * Token-bucket rate limiter — pure, no I/O, no timers.
 *
 * Each key gets its own bucket. Tokens refill continuously based on elapsed
 * wall-clock time measured lazily on each tryConsume call.
 * Buckets idle for more than GC_IDLE_MS are garbage-collected lazily.
 */

const GC_IDLE_MS = 5 * 60 * 1000; // 5 minutes

interface Bucket {
  tokens: number;
  lastRefillAt: number; // ms timestamp (Date.now())
  lastUsedAt: number;   // ms timestamp for GC purposes
}

export interface RateLimiter {
  tryConsume(key: string, n?: number): { allowed: boolean; retryAfterMs: number };
  /** Exposed for testing only — do not use in production code. */
  __internalState(): ReadonlyMap<string, Readonly<Bucket>>;
}

export interface RateLimiterOptions {
  capacity: number;
  refillPerSec: number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { capacity, refillPerSec } = opts;

  if (capacity <= 0) throw new RangeError('capacity must be positive');
  if (refillPerSec <= 0) throw new RangeError('refillPerSec must be positive');

  const buckets = new Map<string, Bucket>();

  function getOrCreate(key: string, now: number): Bucket {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefillAt: now, lastUsedAt: now };
      buckets.set(key, bucket);
    }
    return bucket;
  }

  function refill(bucket: Bucket, now: number): void {
    const elapsedSec = (now - bucket.lastRefillAt) / 1000;
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
      bucket.lastRefillAt = now;
    }
  }

  function gc(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastUsedAt > GC_IDLE_MS) {
        buckets.delete(key);
      }
    }
  }

  return {
    tryConsume(key: string, n = 1): { allowed: boolean; retryAfterMs: number } {
      const now = Date.now();
      gc(now);

      const bucket = getOrCreate(key, now);
      refill(bucket, now);
      bucket.lastUsedAt = now;

      if (bucket.tokens >= n) {
        bucket.tokens -= n;
        return { allowed: true, retryAfterMs: 0 };
      }

      // How many ms until we have enough tokens?
      const deficit = n - bucket.tokens;
      const retryAfterMs = Math.ceil((deficit / refillPerSec) * 1000);
      return { allowed: false, retryAfterMs };
    },

    __internalState(): ReadonlyMap<string, Readonly<Bucket>> {
      return buckets;
    },
  };
}
