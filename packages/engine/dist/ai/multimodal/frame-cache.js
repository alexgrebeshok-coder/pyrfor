/**
 * Short-TTL cache for sampled video frames.
 *
 * When the multi-frame vision path verifies a clip it captures N JPEG
 * stills via ffmpeg and hands them to the vision router. Reviewers
 * who later read the evidence record need to be able to replay the
 * exact frames the model saw — without re-running ffmpeg (expensive,
 * rate-limited, possibly broken if the original URL expired).
 *
 * This module keeps those frames in-process for a short TTL (default
 * 10 minutes). Lookup uses a stable key derived from the original
 * URL + timestamp + scale, so `visionSampledFrames` metadata can
 * point directly at cached entries. When the TTL lapses the frame is
 * evicted and callers fall back to re-extraction.
 *
 * The cache is intentionally simple:
 *   • Map-based, bounded by `MAX_ENTRIES` (LRU eviction).
 *   • No persistence — each Node worker owns its own copy. Good
 *     enough for a minute-scale replay window; a Redis-backed cache
 *     is tracked as future work.
 *   • Exposes a `listRecent()` view for the Ops UI so operators can
 *     see how much replay surface is currently available.
 */
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { createHash } from "node:crypto";
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ENTRIES = 128;
const cache = new Map();
/**
 * Derive a stable key from the fields that fully identify a sampled
 * frame. We hash rather than concatenate so the key is URL-safe and
 * fixed length — handy for use as an API path segment.
 */
export function buildFrameCacheKey(parts) {
    var _a;
    const scale = (_a = parts.scale) !== null && _a !== void 0 ? _a : "default";
    const raw = `${parts.url}|${parts.timestampSeconds.toFixed(3)}|${scale}`;
    return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}
/** Returns the live entry if present and not yet expired. */
export function getCachedFrame(key) {
    const entry = cache.get(key);
    if (!entry)
        return null;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }
    // Touch for LRU ordering.
    cache.delete(key);
    cache.set(key, entry);
    return entry;
}
/**
 * Insert or replace a cache entry. Returns the canonical record so
 * callers can reference the stable key and `expiresAt`.
 */
export function cacheFrame(input, options = {}) {
    var _a, _b;
    const scale = (_a = options.scale) !== null && _a !== void 0 ? _a : "default";
    const key = buildFrameCacheKey({
        url: input.url,
        timestampSeconds: input.timestampSeconds,
        scale,
    });
    const now = Date.now();
    const ttl = Math.max(1000, (_b = options.ttlMs) !== null && _b !== void 0 ? _b : DEFAULT_TTL_MS);
    const entry = {
        key,
        data: input.data,
        mimeType: "image/jpeg",
        timestampSeconds: input.timestampSeconds,
        sourceUrl: input.url,
        scale,
        sizeBytes: input.sizeBytes,
        cachedAt: now,
        expiresAt: now + ttl,
    };
    cache.set(key, entry);
    enforceCapacity();
    return entry;
}
function enforceCapacity() {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (entry.expiresAt <= now)
            cache.delete(key);
    }
    if (cache.size <= MAX_ENTRIES)
        return;
    // Map iteration order is insertion order; drop the oldest extras.
    const excess = cache.size - MAX_ENTRIES;
    const iterator = cache.keys();
    for (let i = 0; i < excess; i++) {
        const next = iterator.next();
        if (next.done)
            break;
        cache.delete(next.value);
    }
}
/**
 * Return a snapshot of recent (non-expired) entries, most recent
 * first. Sensitive fields (`data`) are omitted so this view is safe
 * to surface from the Ops dashboard.
 */
export function listRecentCachedFrames() {
    const now = Date.now();
    const out = [];
    for (const entry of cache.values()) {
        if (entry.expiresAt <= now)
            continue;
        const { data: _omit } = entry, rest = __rest(entry, ["data"]);
        void _omit;
        out.push(rest);
    }
    // Most recent first.
    out.sort((a, b) => b.cachedAt - a.cachedAt);
    return out;
}
/** For tests only. */
export function __resetFrameCacheForTest() {
    cache.clear();
}
/** Configurable defaults expose for tests / future tuning. */
export const FRAME_CACHE_DEFAULTS = {
    ttlMs: DEFAULT_TTL_MS,
    maxEntries: MAX_ENTRIES,
};
