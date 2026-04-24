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
export interface CachedFrame {
    /** Opaque stable key — also the URL path segment for the serve route. */
    key: string;
    /** base64-encoded JPEG bytes. */
    data: string;
    mimeType: "image/jpeg";
    /** Offset into the original video in seconds. */
    timestampSeconds: number;
    /** Original video URL — for audit / debugging only. */
    sourceUrl: string;
    /** ffmpeg scale directive used to produce this frame. */
    scale: string;
    /** Raw JPEG byte length. */
    sizeBytes: number;
    /** ms since epoch at which this entry was cached. */
    cachedAt: number;
    /** ms since epoch at which the entry will be evicted. */
    expiresAt: number;
}
export interface FrameCacheKeyParts {
    url: string;
    timestampSeconds: number;
    scale?: string;
}
/**
 * Derive a stable key from the fields that fully identify a sampled
 * frame. We hash rather than concatenate so the key is URL-safe and
 * fixed length — handy for use as an API path segment.
 */
export declare function buildFrameCacheKey(parts: FrameCacheKeyParts): string;
/** Returns the live entry if present and not yet expired. */
export declare function getCachedFrame(key: string): CachedFrame | null;
export interface CacheFrameOptions {
    ttlMs?: number;
    scale?: string;
}
/**
 * Insert or replace a cache entry. Returns the canonical record so
 * callers can reference the stable key and `expiresAt`.
 */
export declare function cacheFrame(input: {
    url: string;
    timestampSeconds: number;
    data: string;
    sizeBytes: number;
}, options?: CacheFrameOptions): CachedFrame;
/**
 * Return a snapshot of recent (non-expired) entries, most recent
 * first. Sensitive fields (`data`) are omitted so this view is safe
 * to surface from the Ops dashboard.
 */
export declare function listRecentCachedFrames(): Array<Omit<CachedFrame, "data">>;
/** For tests only. */
export declare function __resetFrameCacheForTest(): void;
/** Configurable defaults expose for tests / future tuning. */
export declare const FRAME_CACHE_DEFAULTS: {
    ttlMs: number;
    maxEntries: number;
};
//# sourceMappingURL=frame-cache.d.ts.map