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
 * Result schema returned by Upstash's pipelined REST endpoint.
 * Each element follows `{ result: <value>, error?: string }`.
 */
interface UpstashPipelineEntry {
  result?: unknown;
  error?: string;
}

function fetchWithTimeout(
  impl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return impl(url, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Parses a single pipeline entry defensively. Upstash may return the
 * entry as `{ result: <value> }` or, on older accounts, as a bare
 * value — we tolerate both.
 */
function pipelineNumber(entry: UpstashPipelineEntry | number | null | undefined): number {
  if (typeof entry === "number") return entry;
  if (!entry || typeof entry !== "object") return 0;
  const raw = (entry as UpstashPipelineEntry).result;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
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
export function createUpstashRateLimitStore(options: UpstashOptions): RateLimitStore {
  const baseUrl = options.url.replace(/\/+$/, "");
  const token = options.token;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2000;

  return {
    async incrementWindow(key, windowMs) {
      const pipelineUrl = `${baseUrl}/pipeline`;
      const body = JSON.stringify([
        ["INCR", key],
        ["PEXPIRE", key, String(windowMs), "NX"],
        ["PTTL", key],
      ]);

      const response = await fetchWithTimeout(
        fetchImpl,
        pipelineUrl,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body,
        },
        timeoutMs
      );

      if (!response.ok) {
        throw new Error(
          `Upstash pipeline failed: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as unknown;
      if (!Array.isArray(data) || data.length < 3) {
        throw new Error("Upstash pipeline returned unexpected payload");
      }

      const count = pipelineNumber(data[0] as UpstashPipelineEntry);
      const pttl = pipelineNumber(data[2] as UpstashPipelineEntry);
      // `PTTL` returns -1 when the key has no TTL and -2 when the key
      // no longer exists. Both are treated as "window is about to
      // reset" for safety.
      const ttlMs = pttl > 0 ? pttl : windowMs;
      return { count, ttlMs };
    },
  };
}

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
export function createIoredisRateLimitStore(
  client: IoredisLikeClient
): RateLimitStore {
  return {
    async incrementWindow(key, windowMs) {
      const pipeline = client
        .multi()
        .incr(key)
        .pexpire(key, windowMs, "NX")
        .pttl(key);
      const results = await pipeline.exec();
      if (!results || results.length < 3) {
        throw new Error("ioredis pipeline returned no results");
      }

      const [incrErr, incrVal] = results[0];
      if (incrErr) throw incrErr;
      const [, pttlVal] = results[2];

      const count = typeof incrVal === "number" ? incrVal : Number(incrVal) || 0;
      const pttl = typeof pttlVal === "number" ? pttlVal : Number(pttlVal) || 0;
      const ttlMs = pttl > 0 ? pttl : windowMs;
      return { count, ttlMs };
    },
  };
}

/**
 * Reads Upstash REST credentials from environment variables and
 * returns a ready-to-use store. Returns `null` when either env var is
 * missing so the kernel can fall back to the in-process limiter.
 */
export function createRateLimitStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env
): RateLimitStore | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return createUpstashRateLimitStore({ url, token });
}
