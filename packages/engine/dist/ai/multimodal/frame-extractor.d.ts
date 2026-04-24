/**
 * Server-side video frame extractor.
 *
 * Uses a local `ffmpeg` binary to pull a single JPEG keyframe from a
 * video URL (http/https/file path). Returns the frame as a base64
 * string, which vision providers can accept via `ImageSource { kind:
 * "base64", data, mimeType }`.
 *
 * ## Runtime requirements
 * - `ffmpeg` must be on the PATH on the server that runs this code
 *   (e.g. in the Vercel build image or your self-hosted runner). In
 *   sandboxed / edge runtimes this module is unusable — use the
 *   `isFrameExtractionAvailable()` probe to gate callers.
 * - Network access to the video URL.
 * - `ENABLE_VIDEO_FRAME_EXTRACTION=true` must be set to opt in. When
 *   the env var is off the extractor is a no-op that returns null.
 *
 * ## Why we gate on an env flag
 * Running `ffmpeg` on untrusted URLs has resource implications (CPU,
 * memory, disk, egress). We want operators to consciously turn this on
 * once they've verified their runtime can host ffmpeg. See
 * `docs/multi-agent-review-2026-04-21.md` for rollout guidance.
 */
import type { ImageSource, VisionRouter, VisionVerifyResult } from "./vision";
/**
 * Shape of a successfully extracted frame. `data` is base64-encoded
 * JPEG bytes, `mimeType` is always `image/jpeg`.
 */
export interface ExtractedFrame {
    data: string;
    mimeType: "image/jpeg";
    timestampSeconds: number;
    sizeBytes: number;
    /**
     * Stable cache key under which the frame was stored (when caching
     * is enabled). Lets downstream code persist a pointer in evidence
     * metadata so reviewers can replay the exact frame via
     * `/api/ai/frames/<cacheKey>`.
     */
    cacheKey?: string;
}
export interface FrameExtractionOptions {
    /**
     * Offset into the video (seconds) where the keyframe should be
     * grabbed. Defaults to 1 second — enough to skip the splash frame
     * in typical construction-site clips while still representing the
     * start of the observation.
     */
    timestampSeconds?: number;
    /**
     * Hard byte cap on the extracted JPEG. The extractor aborts if
     * ffmpeg emits more data than this. Defaults to 2 MiB, which is
     * large enough for 1080p stills but small enough to keep vision
     * token costs sane.
     */
    maxBytes?: number;
    /**
     * Hard wall-clock timeout for the ffmpeg process. Defaults to 8s —
     * if the source URL is slow we want to fall back to the metadata
     * heuristic rather than block the API request indefinitely.
     */
    timeoutMs?: number;
    /**
     * Optional target scaling for the output frame, matching ffmpeg's
     * `scale=` syntax (e.g. `"640:-2"`). Keeping the image small reduces
     * vision input cost. Defaults to `640:-2`.
     */
    scale?: string;
    /**
     * When true (default), the extracted frame is kept in an in-process
     * short-TTL cache so reviewers can replay it via
     * `/api/ai/frames/<cacheKey>` without re-running ffmpeg. Set to
     * false for one-off calls where caching would be wasteful.
     */
    cache?: boolean;
    /**
     * Cache TTL override (ms). Defaults to the frame-cache default.
     */
    cacheTtlMs?: number;
}
export declare const VIDEO_EXTENSIONS: ReadonlySet<string>;
export declare function isFrameExtractionEnabled(): boolean;
export declare function looksLikeVideoUrl(url: string, mimeType: string | null): boolean;
export declare function asImageSource(frame: ExtractedFrame): ImageSource;
/**
 * Spawn ffmpeg and pull one JPEG keyframe from `url`. Returns `null`
 * when the extractor is disabled by env, or when ffmpeg fails for any
 * reason (callers fall back to the metadata heuristic).
 */
export declare function extractKeyFrame(url: string, options?: FrameExtractionOptions): Promise<ExtractedFrame | null>;
export interface MultiFrameOptions {
    /**
     * Approximate clip length in seconds. The extractor picks offsets
     * at ~10% / ~50% / ~90% of the duration when this is known; when
     * it's not, it falls back to 1 s / 5 s / 15 s which covers most
     * short-form construction clips.
     */
    durationSeconds?: number;
    /**
     * How many frames to sample. Defaults to 3. Caller pays the cost of
     * spawning ffmpeg N times sequentially.
     */
    sampleCount?: number;
    /**
     * Forwarded to each underlying `extractKeyFrame` call.
     */
    perFrame?: Omit<FrameExtractionOptions, "timestampSeconds">;
}
export interface SampledFrame extends ExtractedFrame {
    offsetIndex: number;
}
/**
 * Pick reasonable offsets (in seconds) for N sample frames. When a
 * `durationSeconds` is supplied the offsets are spread across the
 * clip; otherwise a fixed fallback is used.
 */
export declare function pickSampleOffsets(sampleCount: number, durationSeconds?: number): number[];
/**
 * Extract up to `sampleCount` keyframes at spread-out offsets. Frames
 * are pulled sequentially (ffmpeg is CPU-bound, parallelising gains
 * little and risks OOM on the Vercel runner). Returns only the frames
 * that ffmpeg actually produced — callers must tolerate 0..N results.
 */
export declare function extractSampleFrames(url: string, options?: MultiFrameOptions): Promise<SampledFrame[]>;
export interface MultiFrameVisionResult {
    verdict: VisionVerifyResult;
    sampledFrames: number;
    perFrameVerdicts: Array<{
        offsetIndex: number;
        timestampSeconds: number;
        verdict: VisionVerifyResult["verdict"];
        confidence: number;
        /**
         * Opaque cache key for the underlying JPEG — use with
         * `/api/ai/frames/<cacheKey>` to fetch the exact pixels the
         * classifier saw. `null` when caching was disabled or the
         * extractor's cache insert failed.
         */
        cacheKey?: string | null;
    }>;
}
/**
 * Run `router.verify` against each sampled frame and pick the
 * strongest verdict using the ranking in `VERDICT_WEIGHT`. When a
 * single verdict type dominates the confidence is averaged across
 * agreeing frames; otherwise we return the single best verdict so
 * callers see a faithful upper-bound of what vision actually saw.
 */
export declare function verifyClipWithVision(url: string, claim: string, router: VisionRouter, options?: MultiFrameOptions & {
    maxTokens?: number;
}): Promise<MultiFrameVisionResult | null>;
//# sourceMappingURL=frame-extractor.d.ts.map