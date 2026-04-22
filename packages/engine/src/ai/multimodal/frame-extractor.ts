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

import { spawn } from "node:child_process";
import { logger } from '../../observability/logger';
import type { ImageSource, VisionRouter, VisionVerifyResult } from "./vision";
import { cacheFrame } from "./frame-cache";

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

const DEFAULT_TIMESTAMP = 1;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_SCALE = "640:-2";

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mkv",
  "avi",
  "mpg",
  "mpeg",
  "3gp",
  "ogv",
]);

export function isFrameExtractionEnabled(): boolean {
  const value = process.env.ENABLE_VIDEO_FRAME_EXTRACTION?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function looksLikeVideoUrl(url: string, mimeType: string | null): boolean {
  if (mimeType && mimeType.toLowerCase().startsWith("video/")) {
    return true;
  }
  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase();
    if (ext && VIDEO_EXTENSIONS.has(ext)) return true;
  } catch {
    // ignore
  }
  return false;
}

export function asImageSource(frame: ExtractedFrame): ImageSource {
  return { kind: "base64", data: frame.data, mimeType: frame.mimeType };
}

/**
 * Spawn ffmpeg and pull one JPEG keyframe from `url`. Returns `null`
 * when the extractor is disabled by env, or when ffmpeg fails for any
 * reason (callers fall back to the metadata heuristic).
 */
export async function extractKeyFrame(
  url: string,
  options: FrameExtractionOptions = {}
): Promise<ExtractedFrame | null> {
  if (!isFrameExtractionEnabled()) return null;
  if (!url) return null;

  const ts = Math.max(0, options.timestampSeconds ?? DEFAULT_TIMESTAMP);
  const maxBytes = Math.max(64 * 1024, options.maxBytes ?? DEFAULT_MAX_BYTES);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const scale = options.scale ?? DEFAULT_SCALE;

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-ss",
    String(ts),
    "-i",
    url,
    "-frames:v",
    "1",
    "-vf",
    `scale=${scale}`,
    "-f",
    "image2",
    "-vcodec",
    "mjpeg",
    "-q:v",
    "3",
    "pipe:1",
  ];

  return new Promise<ExtractedFrame | null>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      logger.warn("frame-extractor: spawn failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      resolve(null);
      return;
    }

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBuf = "";
    let settled = false;
    const finish = (value: ExtractedFrame | null) => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      logger.warn("frame-extractor: timeout", { url, timeoutMs });
      finish(null);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) {
        logger.warn("frame-extractor: oversize frame aborted", {
          url,
          maxBytes,
          stdoutBytes,
        });
        clearTimeout(timer);
        finish(null);
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBuf.length < 4_000) {
        stderrBuf += chunk.toString("utf8");
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      logger.warn("frame-extractor: ffmpeg error", {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      finish(null);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0 || stdoutBytes === 0) {
        logger.warn("frame-extractor: ffmpeg exited non-zero", {
          url,
          exitCode: code,
          stderr: stderrBuf.trim().slice(0, 400),
        });
        finish(null);
        return;
      }

      const buf = Buffer.concat(stdoutChunks, stdoutBytes);
      const base64 = buf.toString("base64");
      let cacheKey: string | undefined;
      if (options.cache !== false) {
        try {
          const cached = cacheFrame(
            {
              url,
              timestampSeconds: ts,
              data: base64,
              sizeBytes: buf.length,
            },
            { scale, ttlMs: options.cacheTtlMs }
          );
          cacheKey = cached.key;
        } catch (err) {
          logger.warn("frame-extractor: cache insert failed", {
            url,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      finish({
        data: base64,
        mimeType: "image/jpeg",
        timestampSeconds: ts,
        sizeBytes: buf.length,
        cacheKey,
      });
    });
  });
}

// ============================================================
// Multi-frame sampling (first / middle / last) and verdict blending
// ============================================================

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
export function pickSampleOffsets(
  sampleCount: number,
  durationSeconds?: number
): number[] {
  const count = Math.max(1, Math.min(sampleCount, 5));
  if (durationSeconds && durationSeconds > 0 && Number.isFinite(durationSeconds)) {
    if (count === 1) return [Math.min(1, durationSeconds * 0.5)];
    const offsets: number[] = [];
    for (let i = 0; i < count; i++) {
      // Spread across 10% → 90% so we never touch padding frames at 0/end.
      const fraction = 0.1 + (0.8 * i) / (count - 1);
      offsets.push(Number((durationSeconds * fraction).toFixed(2)));
    }
    return offsets;
  }

  // Unknown duration: use a fixed ladder that covers short clips.
  const fallback = [1, 5, 15, 30, 60];
  return fallback.slice(0, count);
}

/**
 * Extract up to `sampleCount` keyframes at spread-out offsets. Frames
 * are pulled sequentially (ffmpeg is CPU-bound, parallelising gains
 * little and risks OOM on the Vercel runner). Returns only the frames
 * that ffmpeg actually produced — callers must tolerate 0..N results.
 */
export async function extractSampleFrames(
  url: string,
  options: MultiFrameOptions = {}
): Promise<SampledFrame[]> {
  if (!isFrameExtractionEnabled()) return [];
  if (!url) return [];

  const sampleCount = Math.max(1, options.sampleCount ?? 3);
  const offsets = pickSampleOffsets(sampleCount, options.durationSeconds);

  const frames: SampledFrame[] = [];
  for (let i = 0; i < offsets.length; i++) {
    const ts = offsets[i];
    const frame = await extractKeyFrame(url, {
      ...(options.perFrame ?? {}),
      timestampSeconds: ts,
    });
    if (frame) {
      frames.push({ ...frame, offsetIndex: i });
    }
  }
  return frames;
}

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
 * Ranking weight for each verdict — "confirmed" wins over "uncertain"
 * wins over "refuted" when confidences are equal. Within the same
 * verdict bucket we pick the highest-confidence frame.
 */
const VERDICT_WEIGHT: Record<VisionVerifyResult["verdict"], number> = {
  confirmed: 3,
  uncertain: 2,
  refuted: 1,
};

/**
 * Run `router.verify` against each sampled frame and pick the
 * strongest verdict using the ranking in `VERDICT_WEIGHT`. When a
 * single verdict type dominates the confidence is averaged across
 * agreeing frames; otherwise we return the single best verdict so
 * callers see a faithful upper-bound of what vision actually saw.
 */
export async function verifyClipWithVision(
  url: string,
  claim: string,
  router: VisionRouter,
  options: MultiFrameOptions & { maxTokens?: number } = {}
): Promise<MultiFrameVisionResult | null> {
  const frames = await extractSampleFrames(url, options);
  if (frames.length === 0) return null;

  const perFrameVerdicts: MultiFrameVisionResult["perFrameVerdicts"] = [];
  const verdicts: VisionVerifyResult[] = [];

  for (const frame of frames) {
    try {
      const res = await router.verify(
        { kind: "base64", data: frame.data, mimeType: frame.mimeType } as ImageSource,
        { claim, maxTokens: options.maxTokens ?? 256 }
      );
      verdicts.push(res);
      perFrameVerdicts.push({
        offsetIndex: frame.offsetIndex,
        timestampSeconds: frame.timestampSeconds,
        verdict: res.verdict,
        confidence: res.confidence,
        cacheKey: frame.cacheKey ?? null,
      });
    } catch (err) {
      logger.warn("frame-extractor: per-frame verify failed", {
        url,
        offsetIndex: frame.offsetIndex,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (verdicts.length === 0) return null;

  // Pick strongest verdict (rank first, then confidence).
  let best = verdicts[0];
  for (const v of verdicts.slice(1)) {
    const bestRank = VERDICT_WEIGHT[best.verdict] ?? 0;
    const candidateRank = VERDICT_WEIGHT[v.verdict] ?? 0;
    if (
      candidateRank > bestRank ||
      (candidateRank === bestRank && v.confidence > best.confidence)
    ) {
      best = v;
    }
  }

  // If >1 frame agrees with the winning verdict, average the confidences.
  const agreeing = verdicts.filter((v) => v.verdict === best.verdict);
  if (agreeing.length > 1) {
    const avg =
      agreeing.reduce((acc, v) => acc + v.confidence, 0) / agreeing.length;
    best = {
      ...best,
      confidence: Math.max(0, Math.min(1, Number(avg.toFixed(3)))),
      reason: `${best.reason} (agreement across ${agreeing.length}/${verdicts.length} sampled frames)`,
    };
  }

  return {
    verdict: best,
    sampledFrames: frames.length,
    perFrameVerdicts,
  };
}
