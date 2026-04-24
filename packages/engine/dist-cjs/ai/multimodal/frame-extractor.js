"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIDEO_EXTENSIONS = void 0;
exports.isFrameExtractionEnabled = isFrameExtractionEnabled;
exports.looksLikeVideoUrl = looksLikeVideoUrl;
exports.asImageSource = asImageSource;
exports.extractKeyFrame = extractKeyFrame;
exports.pickSampleOffsets = pickSampleOffsets;
exports.extractSampleFrames = extractSampleFrames;
exports.verifyClipWithVision = verifyClipWithVision;
const node_child_process_1 = require("node:child_process");
const logger_1 = require("../../observability/logger");
const frame_cache_1 = require("./frame-cache");
const DEFAULT_TIMESTAMP = 1;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_SCALE = "640:-2";
exports.VIDEO_EXTENSIONS = new Set([
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
function isFrameExtractionEnabled() {
    const value = process.env.ENABLE_VIDEO_FRAME_EXTRACTION?.toLowerCase();
    return value === "1" || value === "true" || value === "yes";
}
function looksLikeVideoUrl(url, mimeType) {
    if (mimeType && mimeType.toLowerCase().startsWith("video/")) {
        return true;
    }
    try {
        const ext = new URL(url).pathname.split(".").pop()?.toLowerCase();
        if (ext && exports.VIDEO_EXTENSIONS.has(ext))
            return true;
    }
    catch {
        // ignore
    }
    return false;
}
function asImageSource(frame) {
    return { kind: "base64", data: frame.data, mimeType: frame.mimeType };
}
/**
 * Spawn ffmpeg and pull one JPEG keyframe from `url`. Returns `null`
 * when the extractor is disabled by env, or when ffmpeg fails for any
 * reason (callers fall back to the metadata heuristic).
 */
async function extractKeyFrame(url, options = {}) {
    if (!isFrameExtractionEnabled())
        return null;
    if (!url)
        return null;
    const ts = Math.max(0, options.timestampSeconds ?? DEFAULT_TIMESTAMP);
    const maxBytes = Math.max(64 * 1024, options.maxBytes ?? DEFAULT_MAX_BYTES);
    const timeoutMs = Math.max(1000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
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
    return new Promise((resolve) => {
        let child;
        try {
            child = (0, node_child_process_1.spawn)("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
        }
        catch (err) {
            logger_1.logger.warn("frame-extractor: spawn failed", {
                error: err instanceof Error ? err.message : String(err),
            });
            resolve(null);
            return;
        }
        const stdoutChunks = [];
        let stdoutBytes = 0;
        let stderrBuf = "";
        let settled = false;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            try {
                child.kill("SIGKILL");
            }
            catch {
                // ignore
            }
            resolve(value);
        };
        const timer = setTimeout(() => {
            logger_1.logger.warn("frame-extractor: timeout", { url, timeoutMs });
            finish(null);
        }, timeoutMs);
        child.stdout?.on("data", (chunk) => {
            stdoutBytes += chunk.length;
            if (stdoutBytes > maxBytes) {
                logger_1.logger.warn("frame-extractor: oversize frame aborted", {
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
        child.stderr?.on("data", (chunk) => {
            if (stderrBuf.length < 4000) {
                stderrBuf += chunk.toString("utf8");
            }
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            logger_1.logger.warn("frame-extractor: ffmpeg error", {
                url,
                error: err instanceof Error ? err.message : String(err),
            });
            finish(null);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (settled)
                return;
            if (code !== 0 || stdoutBytes === 0) {
                logger_1.logger.warn("frame-extractor: ffmpeg exited non-zero", {
                    url,
                    exitCode: code,
                    stderr: stderrBuf.trim().slice(0, 400),
                });
                finish(null);
                return;
            }
            const buf = Buffer.concat(stdoutChunks, stdoutBytes);
            const base64 = buf.toString("base64");
            let cacheKey;
            if (options.cache !== false) {
                try {
                    const cached = (0, frame_cache_1.cacheFrame)({
                        url,
                        timestampSeconds: ts,
                        data: base64,
                        sizeBytes: buf.length,
                    }, { scale, ttlMs: options.cacheTtlMs });
                    cacheKey = cached.key;
                }
                catch (err) {
                    logger_1.logger.warn("frame-extractor: cache insert failed", {
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
/**
 * Pick reasonable offsets (in seconds) for N sample frames. When a
 * `durationSeconds` is supplied the offsets are spread across the
 * clip; otherwise a fixed fallback is used.
 */
function pickSampleOffsets(sampleCount, durationSeconds) {
    const count = Math.max(1, Math.min(sampleCount, 5));
    if (durationSeconds && durationSeconds > 0 && Number.isFinite(durationSeconds)) {
        if (count === 1)
            return [Math.min(1, durationSeconds * 0.5)];
        const offsets = [];
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
async function extractSampleFrames(url, options = {}) {
    if (!isFrameExtractionEnabled())
        return [];
    if (!url)
        return [];
    const sampleCount = Math.max(1, options.sampleCount ?? 3);
    const offsets = pickSampleOffsets(sampleCount, options.durationSeconds);
    const frames = [];
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
/**
 * Ranking weight for each verdict — "confirmed" wins over "uncertain"
 * wins over "refuted" when confidences are equal. Within the same
 * verdict bucket we pick the highest-confidence frame.
 */
const VERDICT_WEIGHT = {
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
async function verifyClipWithVision(url, claim, router, options = {}) {
    const frames = await extractSampleFrames(url, options);
    if (frames.length === 0)
        return null;
    const perFrameVerdicts = [];
    const verdicts = [];
    for (const frame of frames) {
        try {
            const res = await router.verify({ kind: "base64", data: frame.data, mimeType: frame.mimeType }, { claim, maxTokens: options.maxTokens ?? 256 });
            verdicts.push(res);
            perFrameVerdicts.push({
                offsetIndex: frame.offsetIndex,
                timestampSeconds: frame.timestampSeconds,
                verdict: res.verdict,
                confidence: res.confidence,
                cacheKey: frame.cacheKey ?? null,
            });
        }
        catch (err) {
            logger_1.logger.warn("frame-extractor: per-frame verify failed", {
                url,
                offsetIndex: frame.offsetIndex,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    if (verdicts.length === 0)
        return null;
    // Pick strongest verdict (rank first, then confidence).
    let best = verdicts[0];
    for (const v of verdicts.slice(1)) {
        const bestRank = VERDICT_WEIGHT[best.verdict] ?? 0;
        const candidateRank = VERDICT_WEIGHT[v.verdict] ?? 0;
        if (candidateRank > bestRank ||
            (candidateRank === bestRank && v.confidence > best.confidence)) {
            best = v;
        }
    }
    // If >1 frame agrees with the winning verdict, average the confidences.
    const agreeing = verdicts.filter((v) => v.verdict === best.verdict);
    if (agreeing.length > 1) {
        const avg = agreeing.reduce((acc, v) => acc + v.confidence, 0) / agreeing.length;
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
