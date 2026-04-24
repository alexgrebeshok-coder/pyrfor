/**
 * Rate-limit store adapters.
 *
 * The core `AgentRateLimiter` only knows about the minimal
 * `RateLimitStore` interface (a single `incrementWindow` method). This
 * file contains adapters that turn popular Redis offerings into that
 * shape without pulling a new npm dependency into the kernel:
 *
 *   • `createUpstashRateLimitStore({ url, token })` — talks to the
 *     Upstash REST API via `fetch`. Multi-command pipelines are used
 *     so increment + PEXPIRE + PTTL happen atomically server-side.
 *
 *   • `createIoredisRateLimitStore(client)` — duck-typed adapter for
 *     an `ioredis`-compatible client that exposes `multi()`,
 *     `incr`, `pexpire`, `pttl`, and `exec`. We do not import
 *     `ioredis` so the package stays optional; callers pass their
 *     configured client.
 *
 *   • `createRateLimitStoreFromEnv()` — convenience for the common
 *     Upstash path, driven by `UPSTASH_REDIS_REST_URL` /
 *     `UPSTASH_REDIS_REST_TOKEN`. Returns `null` when either env var
 *     is missing so callers can fall back to in-process mode.
 */
import type { RateLimitStore } from "./rate-limiter";
export interface UpstashOptions {
    /** Upstash REST URL, e.g. `https://us1-abc.upstash.io`. */
    url: string;
    /** REST auth token (read/write). */
    token: string;
    /** Optional `fetch` override — useful for tests. */
    fetchImpl?: typeof fetch;
    /** Request timeout per call in ms (default 2000). */
    timeoutMs?: number;
}
/**
 * Upstash REST adapter. Uses a single pipeline call per request:
 *   1. `INCR key`
 *   2. `PEXPIRE key windowMs NX`  (first request seeds the TTL)
 *   3. `PTTL key`                 (so we can surface waitTime)
 *
 * `NX` on `PEXPIRE` ensures a late-arriving request can't extend the
 * window past its original boundary.
 */
export declare function createUpstashRateLimitStore(options: UpstashOptions): RateLimitStore;
/**
 * Minimal shape of an `ioredis`-compatible client. We only need the
 * MULTI pipeline surface — everything else (connection, auth, TLS) is
 * the caller's responsibility.
 */
export interface IoredisLikeClient {
    multi: () => IoredisLikePipeline;
}
export interface IoredisLikePipeline {
    incr: (key: string) => IoredisLikePipeline;
    pexpire: (key: string, ms: number, mode?: string) => IoredisLikePipeline;
    pttl: (key: string) => IoredisLikePipeline;
    exec: () => Promise<Array<[Error | null, unknown]> | null>;
}
/**
 * ioredis-style adapter. Uses `MULTI` so all three commands land in
 * the same transaction and the TTL seed is guaranteed to apply before
 * we read `PTTL`.
 */
export declare function createIoredisRateLimitStore(client: IoredisLikeClient): RateLimitStore;
/**
 * Reads Upstash REST credentials from environment variables and
 * returns a ready-to-use store. Returns `null` when either env var is
 * missing so the kernel can fall back to the in-process limiter.
 */
export declare function createRateLimitStoreFromEnv(env?: NodeJS.ProcessEnv): RateLimitStore | null;
//# sourceMappingURL=rate-limit-stores.d.ts.map