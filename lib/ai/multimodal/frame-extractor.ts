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
import { logger } from "@/lib/logger";
import type { ImageSource } from "./vision";

/**
 * Shape of a successfully extracted frame. `data` is base64-encoded
 * JPEG bytes, `mimeType` is always `image/jpeg`.
 */
export interface ExtractedFrame {
  data: string;
  mimeType: "image/jpeg";
  timestampSeconds: number;
  sizeBytes: number;
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
      finish({
        data: buf.toString("base64"),
        mimeType: "image/jpeg",
        timestampSeconds: ts,
        sizeBytes: buf.length,
      });
    });
  });
}
