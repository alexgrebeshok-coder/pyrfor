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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
function fetchWithTimeout(impl, url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return impl(url, Object.assign(Object.assign({}, init), { signal: controller.signal })).finally(() => {
        clearTimeout(timer);
    });
}
/**
 * Parses a single pipeline entry defensively. Upstash may return the
 * entry as `{ result: <value> }` or, on older accounts, as a bare
 * value — we tolerate both.
 */
function pipelineNumber(entry) {
    if (typeof entry === "number")
        return entry;
    if (!entry || typeof entry !== "object")
        return 0;
    const raw = entry.result;
    if (typeof raw === "number")
        return raw;
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
export function createUpstashRateLimitStore(options) {
    var _a, _b;
    const baseUrl = options.url.replace(/\/+$/, "");
    const token = options.token;
    const fetchImpl = (_a = options.fetchImpl) !== null && _a !== void 0 ? _a : fetch;
    const timeoutMs = (_b = options.timeoutMs) !== null && _b !== void 0 ? _b : 2000;
    return {
        incrementWindow(key, windowMs) {
            return __awaiter(this, void 0, void 0, function* () {
                const pipelineUrl = `${baseUrl}/pipeline`;
                const body = JSON.stringify([
                    ["INCR", key],
                    ["PEXPIRE", key, String(windowMs), "NX"],
                    ["PTTL", key],
                ]);
                const response = yield fetchWithTimeout(fetchImpl, pipelineUrl, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        authorization: `Bearer ${token}`,
                    },
                    body,
                }, timeoutMs);
                if (!response.ok) {
                    throw new Error(`Upstash pipeline failed: ${response.status} ${response.statusText}`);
                }
                const data = (yield response.json());
                if (!Array.isArray(data) || data.length < 3) {
                    throw new Error("Upstash pipeline returned unexpected payload");
                }
                const count = pipelineNumber(data[0]);
                const pttl = pipelineNumber(data[2]);
                // `PTTL` returns -1 when the key has no TTL and -2 when the key
                // no longer exists. Both are treated as "window is about to
                // reset" for safety.
                const ttlMs = pttl > 0 ? pttl : windowMs;
                return { count, ttlMs };
            });
        },
    };
}
/**
 * ioredis-style adapter. Uses `MULTI` so all three commands land in
 * the same transaction and the TTL seed is guaranteed to apply before
 * we read `PTTL`.
 */
export function createIoredisRateLimitStore(client) {
    return {
        incrementWindow(key, windowMs) {
            return __awaiter(this, void 0, void 0, function* () {
                const pipeline = client
                    .multi()
                    .incr(key)
                    .pexpire(key, windowMs, "NX")
                    .pttl(key);
                const results = yield pipeline.exec();
                if (!results || results.length < 3) {
                    throw new Error("ioredis pipeline returned no results");
                }
                const [incrErr, incrVal] = results[0];
                if (incrErr)
                    throw incrErr;
                const [, pttlVal] = results[2];
                const count = typeof incrVal === "number" ? incrVal : Number(incrVal) || 0;
                const pttl = typeof pttlVal === "number" ? pttlVal : Number(pttlVal) || 0;
                const ttlMs = pttl > 0 ? pttl : windowMs;
                return { count, ttlMs };
            });
        },
    };
}
/**
 * Reads Upstash REST credentials from environment variables and
 * returns a ready-to-use store. Returns `null` when either env var is
 * missing so the kernel can fall back to the in-process limiter.
 */
export function createRateLimitStoreFromEnv(env = process.env) {
    var _a, _b;
    const url = (_a = env.UPSTASH_REDIS_REST_URL) === null || _a === void 0 ? void 0 : _a.trim();
    const token = (_b = env.UPSTASH_REDIS_REST_TOKEN) === null || _b === void 0 ? void 0 : _b.trim();
    if (!url || !token)
        return null;
    return createUpstashRateLimitStore({ url, token });
}
