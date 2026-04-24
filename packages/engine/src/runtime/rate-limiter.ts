/**
 * RateLimiter — token bucket + sliding window per-key.
 *
 * No external dependencies; inject clock/setTimer/clearTimer for deterministic tests.
 */

export interface BucketConfig { capacity: number; refillPerSec: number; }
export interface WindowConfig { limit: number; windowMs: number; }

type SetTimer = (cb: () => void, ms: number) => unknown;
type ClearTimer = (h: unknown) => void;

// ---------------------------------------------------------------------------
// Token Bucket
// ---------------------------------------------------------------------------

export interface TokenBucket {
  tryConsume(n?: number): boolean;
  consume(n?: number, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void>;
  available(): number;
  reset(): void;
}

export function createTokenBucket(opts: {
  capacity: number;
  refillPerSec: number;
  clock?: () => number;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
}): TokenBucket {
  const { capacity, refillPerSec } = opts;
  const clock = opts.clock ?? Date.now;
  const setTimer: SetTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer: ClearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let tokens = capacity;
  let lastRefill = clock();

  function refill(): void {
    const now = clock();
    const elapsed = (now - lastRefill) / 1000;
    if (elapsed > 0) {
      tokens = Math.min(capacity, tokens + elapsed * refillPerSec);
      lastRefill = now;
    }
  }

  return {
    tryConsume(n = 1): boolean {
      if (n > capacity) return false;
      refill();
      if (tokens >= n) {
        tokens -= n;
        return true;
      }
      return false;
    },

    available(): number {
      refill();
      return tokens;
    },

    reset(): void {
      tokens = capacity;
      lastRefill = clock();
    },

    consume(n = 1, consumeOpts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void> {
      if (n > capacity) {
        return Promise.reject(new Error('RATE_LIMIT_TIMEOUT'));
      }

      return new Promise<void>((resolve, reject) => {
        const signal = consumeOpts?.signal;
        const timeoutMs = consumeOpts?.timeoutMs;
        let settled = false;
        let timerHandle: unknown;
        let timeoutHandle: unknown;

        function cleanup(): void {
          if (timerHandle !== undefined) { clearTimer(timerHandle); timerHandle = undefined; }
          if (timeoutHandle !== undefined) { clearTimer(timeoutHandle); timeoutHandle = undefined; }
        }

        function doResolve(): void {
          if (settled) return;
          settled = true;
          cleanup();
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }

        function doReject(err: Error): void {
          if (settled) return;
          settled = true;
          cleanup();
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        }

        function onAbort(): void {
          doReject(new Error('RATE_LIMIT_ABORTED'));
        }

        function attempt(): void {
          if (settled) return;
          if (signal?.aborted) { doReject(new Error('RATE_LIMIT_ABORTED')); return; }
          refill();
          if (tokens >= n) {
            tokens -= n;
            doResolve();
            return;
          }
          const deficit = n - tokens;
          const waitMs = Math.max(1, Math.ceil((deficit / refillPerSec) * 1000));
          timerHandle = setTimer(attempt, waitMs);
        }

        if (signal?.aborted) { reject(new Error('RATE_LIMIT_ABORTED')); return; }
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        if (timeoutMs !== undefined) {
          timeoutHandle = setTimer(() => doReject(new Error('RATE_LIMIT_TIMEOUT')), timeoutMs);
        }

        attempt();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Sliding Window
// ---------------------------------------------------------------------------

export interface SlidingWindow {
  tryHit(): boolean;
  hit(opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void>;
  count(): number;
  reset(): void;
}

export function createSlidingWindow(opts: {
  limit: number;
  windowMs: number;
  clock?: () => number;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
}): SlidingWindow {
  const { limit, windowMs } = opts;
  const clock = opts.clock ?? Date.now;
  const setTimer: SetTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer: ClearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let timestamps: number[] = [];

  function prune(now: number): void {
    const cutoff = now - windowMs;
    timestamps = timestamps.filter(t => t > cutoff);
  }

  return {
    tryHit(): boolean {
      const now = clock();
      prune(now);
      if (timestamps.length < limit) {
        timestamps.push(now);
        return true;
      }
      return false;
    },

    count(): number {
      prune(clock());
      return timestamps.length;
    },

    reset(): void {
      timestamps = [];
    },

    hit(hitOpts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const signal = hitOpts?.signal;
        const timeoutMs = hitOpts?.timeoutMs;
        let settled = false;
        let timerHandle: unknown;
        let timeoutHandle: unknown;

        function cleanup(): void {
          if (timerHandle !== undefined) { clearTimer(timerHandle); timerHandle = undefined; }
          if (timeoutHandle !== undefined) { clearTimer(timeoutHandle); timeoutHandle = undefined; }
        }

        function doResolve(): void {
          if (settled) return;
          settled = true;
          cleanup();
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }

        function doReject(err: Error): void {
          if (settled) return;
          settled = true;
          cleanup();
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        }

        function onAbort(): void {
          doReject(new Error('RATE_LIMIT_ABORTED'));
        }

        function attempt(): void {
          if (settled) return;
          if (signal?.aborted) { doReject(new Error('RATE_LIMIT_ABORTED')); return; }
          const now = clock();
          prune(now);
          if (timestamps.length < limit) {
            timestamps.push(now);
            doResolve();
            return;
          }
          // Wait until oldest entry expires
          const oldest = timestamps[0];
          const waitMs = Math.max(1, oldest + windowMs - now + 1);
          timerHandle = setTimer(attempt, waitMs);
        }

        if (signal?.aborted) { reject(new Error('RATE_LIMIT_ABORTED')); return; }
        if (signal) signal.addEventListener('abort', onAbort, { once: true });

        if (timeoutMs !== undefined) {
          timeoutHandle = setTimer(() => doReject(new Error('RATE_LIMIT_TIMEOUT')), timeoutMs);
        }

        attempt();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// LRU Map (internal helper)
// ---------------------------------------------------------------------------

class LRUMap<K, V> {
  private map = new Map<K, V>();

  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  getOrCreate(key: K, factory: () => V): V {
    const existing = this.get(key);
    if (existing !== undefined) return existing;
    if (this.map.size >= this.maxSize) {
      const lruKey = this.map.keys().next().value as K;
      this.map.delete(lruKey);
    }
    const val = factory();
    this.map.set(key, val);
    return val;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  keys(): K[] {
    return [...this.map.keys()];
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// Multi-Key Limiter
// ---------------------------------------------------------------------------

export interface MultiKeyLimiter<K extends string | number> {
  tryConsume(key: K, n?: number): boolean;
  consume(key: K, n?: number, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void>;
  available(key: K): number;
  reset(key?: K): void;
  keys(): K[];
}

export function createMultiKeyLimiter<K extends string | number>(opts: {
  bucket?: BucketConfig;
  window?: WindowConfig;
  maxKeys?: number;
  clock?: () => number;
  setTimer?: SetTimer;
  clearTimer?: ClearTimer;
}): MultiKeyLimiter<K> {
  const maxKeys = opts.maxKeys ?? 10_000;
  const buckets = new LRUMap<K, TokenBucket>(maxKeys);
  const windows = opts.window ? new LRUMap<K, SlidingWindow>(maxKeys) : null;

  function getBucket(key: K): TokenBucket {
    return buckets.getOrCreate(key, () =>
      createTokenBucket({
        capacity: opts.bucket!.capacity,
        refillPerSec: opts.bucket!.refillPerSec,
        clock: opts.clock,
        setTimer: opts.setTimer,
        clearTimer: opts.clearTimer,
      }),
    );
  }

  function getWindow(key: K): SlidingWindow {
    return windows!.getOrCreate(key, () =>
      createSlidingWindow({
        limit: opts.window!.limit,
        windowMs: opts.window!.windowMs,
        clock: opts.clock,
        setTimer: opts.setTimer,
        clearTimer: opts.clearTimer,
      }),
    );
  }

  return {
    tryConsume(key: K, n?: number): boolean {
      if (opts.bucket && !getBucket(key).tryConsume(n)) return false;
      if (opts.window && !getWindow(key).tryHit()) return false;
      return true;
    },

    async consume(key: K, n?: number, consumeOpts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void> {
      if (opts.bucket) await getBucket(key).consume(n, consumeOpts);
      if (opts.window) await getWindow(key).hit(consumeOpts);
    },

    available(key: K): number {
      if (opts.bucket) return getBucket(key).available();
      return Infinity;
    },

    reset(key?: K): void {
      if (key !== undefined) {
        if (opts.bucket) { const b = buckets.get(key); b?.reset(); }
        if (opts.window && windows) { const w = windows.get(key); w?.reset(); }
      } else {
        for (const k of buckets.keys()) { buckets.get(k)?.reset(); }
        if (windows) for (const k of windows.keys()) { windows.get(k)?.reset(); }
      }
    },

    keys(): K[] {
      const ks = new Set<K>(buckets.keys());
      if (windows) for (const k of windows.keys()) ks.add(k);
      return [...ks];
    },
  };
}
