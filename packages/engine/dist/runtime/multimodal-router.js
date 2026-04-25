/**
 * multimodal-router.ts — Pyrfor Multimodal Intelligence (G+12).
 *
 * Pluggable modality router that decides whether to reply via text/voice/document,
 * infers voice sentiment heuristically, and exposes hooks for video/photo facts
 * integration.
 *
 * VOICE SENTIMENT HEURISTIC (defaultVoiceSentiment):
 *   Words-per-minute (wpm) is derived from the voice message:
 *     - If a transcript is provided: wpm = wordCount / (durationMs / 60 000).
 *     - Otherwise: wpm = 150 (speech-rate baseline).
 *   Arousal = clamp(0, 1, (wpm − 90) / 80)
 *     → 0 at 90 wpm (very slow), 1 at 170 wpm (very fast).
 *   Sentiment label:
 *     - arousal > 0.65 && durationMs > 3 000 ms → 'neg' (excited/stressed, long message).
 *     - arousal > 0.65 && durationMs ≤ 3 000 ms → 'pos' (enthusiastic short burst).
 *     - arousal < 0.30                          → 'neu' (slow / calm).
 *     - otherwise                               → 'pos'.
 *   Edge: durationMs = 0 → arousal = 0, label = 'neu'.
 *
 * MODALITY MIRROR POLICY (decideReply):
 *   Voice mirroring beats reply-length checks.  When inbound.kind === 'voice' and
 *   voiceReplyOnVoice is true (default), the preferred reply is always 'voice'.
 *   The 'document' fallback only applies when the input was text/document/photo/etc.
 *   and the reply text exceeds defaultLongTextChars (default 1 500).
 *
 * ENRICH ERROR POLICY:
 *   Any exception thrown by an optional handler (photoCaptioner, documentExtractor,
 *   videoSummariser, voiceTranscriber) is silently swallowed; that fact is simply
 *   omitted.  The function never throws.
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
// ── Constants ─────────────────────────────────────────────────────────────────
const ALL_KINDS = [
    'text',
    'voice',
    'photo',
    'document',
    'video',
    'sticker',
    'unknown',
];
const DEFAULT_LONG_TEXT_CHARS = 1500;
const VOICE_HISTORY_CAP = 200;
/** Baseline wpm assumed when no transcript is available. */
const BASELINE_WPM = 150;
/** Arousal lower bound for wpm axis (0 arousal at this wpm). */
const WPM_FLOOR = 90;
/** Arousal ramp size: arousal reaches 1 at WPM_FLOOR + WPM_RAMP. */
const WPM_RAMP = 80;
/** Duration threshold (ms) distinguishing short (enthusiastic) from long (stressed) fast speech. */
const SHORT_VOICE_MS = 3000;
// ── Internal helpers ──────────────────────────────────────────────────────────
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}
function makeEmptyTotals() {
    return Object.fromEntries(ALL_KINDS.map((k) => [k, 0]));
}
// ── Exported helpers ──────────────────────────────────────────────────────────
/**
 * Classify a MIME type string into a ModalityKind.
 *
 *   image/*       → photo
 *   audio/*       → voice
 *   video/*       → video
 *   application/* → document  (including application/pdf)
 *   undefined     → unknown
 *   anything else → unknown
 */
export function detectKindFromMime(mime) {
    if (!mime)
        return 'unknown';
    if (mime.startsWith('image/'))
        return 'photo';
    if (mime.startsWith('audio/'))
        return 'voice';
    if (mime.startsWith('video/'))
        return 'video';
    if (mime.startsWith('application/'))
        return 'document';
    return 'unknown';
}
/**
 * Heuristic voice sentiment from duration and optional transcript.
 * See module-level comment for the full formula.
 */
export function defaultVoiceSentiment(voice) {
    const { durationMs, transcript } = voice;
    // Edge: zero duration → arousal=0, label='neu'.
    if (durationMs === 0) {
        return {
            label: 'neu',
            arousal: 0,
            rateWpm: 0,
            reasons: ['zero duration — no speech signal'],
        };
    }
    let rateWpm;
    const reasons = [];
    if (transcript && transcript.trim().length > 0) {
        const wordCount = transcript.trim().split(/\s+/).length;
        rateWpm = wordCount / (durationMs / 60000);
        reasons.push(`${wordCount} word(s) in ${(durationMs / 1000).toFixed(1)} s → ${rateWpm.toFixed(0)} wpm`);
    }
    else {
        rateWpm = BASELINE_WPM;
        reasons.push(`no transcript — using ${BASELINE_WPM} wpm baseline`);
    }
    const arousal = clamp01((rateWpm - WPM_FLOOR) / WPM_RAMP);
    let label;
    if (arousal > 0.65) {
        if (durationMs <= SHORT_VOICE_MS) {
            label = 'pos';
            reasons.push('fast rate + short burst → enthusiastic positive');
        }
        else {
            label = 'neg';
            reasons.push('fast rate + long message → stressed / excited negative');
        }
    }
    else if (arousal < 0.3) {
        label = 'neu';
        reasons.push('slow rate → calm / neutral');
    }
    else {
        label = 'pos';
        reasons.push('moderate rate → positive');
    }
    return { label, arousal, rateWpm, reasons };
}
// ── createMultimodalRouter ────────────────────────────────────────────────────
export function createMultimodalRouter(opts) {
    var _a, _b, _c, _d;
    const defaultLongTextChars = (_a = opts === null || opts === void 0 ? void 0 : opts.defaultLongTextChars) !== null && _a !== void 0 ? _a : DEFAULT_LONG_TEXT_CHARS;
    const voiceReplyOnVoice = (_b = opts === null || opts === void 0 ? void 0 : opts.voiceReplyOnVoice) !== null && _b !== void 0 ? _b : true;
    const preferText = (_c = opts === null || opts === void 0 ? void 0 : opts.preferText) !== null && _c !== void 0 ? _c : false;
    const clock = (_d = opts === null || opts === void 0 ? void 0 : opts.clock) !== null && _d !== void 0 ? _d : (() => Date.now());
    let _totalsByKind = makeEmptyTotals();
    let _lastInbound;
    let _voiceUserHistory = [];
    // ── observe ───────────────────────────────────────────────────────────────
    function observe(msg) {
        var _a, _b;
        _totalsByKind[msg.kind]++;
        _lastInbound = { kind: msg.kind, ts: (_a = msg.ts) !== null && _a !== void 0 ? _a : clock() };
        if (msg.kind === 'voice' && msg.voice) {
            // Synchronous heuristic; voiceSentimentFn (async) is for inferVoiceSentiment.
            const sentiment = defaultVoiceSentiment(msg.voice);
            _voiceUserHistory.push({
                ts: (_b = msg.ts) !== null && _b !== void 0 ? _b : clock(),
                durationMs: msg.voice.durationMs,
                sentiment: sentiment.label,
            });
            // Cap history to VOICE_HISTORY_CAP (trim oldest entries).
            if (_voiceUserHistory.length > VOICE_HISTORY_CAP) {
                _voiceUserHistory.splice(0, _voiceUserHistory.length - VOICE_HISTORY_CAP);
            }
        }
    }
    // ── decideReply ───────────────────────────────────────────────────────────
    function decideReply(input) {
        const { inbound, replyText, energy } = input;
        // Global override: always reply with text.
        if (preferText) {
            return { preferred: 'text', rationale: 'preferText override active' };
        }
        // Voice mirror: inbound was voice → reply with voice.
        // This intentionally wins over the long-text document rule (see module comment).
        if (inbound.kind === 'voice' && voiceReplyOnVoice) {
            const ttsHint = energy === 'high' ? 'fast' : energy === 'low' ? 'slow' : 'normal';
            return {
                preferred: 'voice',
                rationale: 'user spoke; mirror modality',
                ttsHint,
                attachOriginalTranscript: true,
            };
        }
        // Long text fallback: send as document file.
        if (replyText.length > defaultLongTextChars) {
            return {
                preferred: 'document',
                rationale: 'long content; attach as file',
            };
        }
        return { preferred: 'text', rationale: 'default text reply' };
    }
    // ── inferVoiceSentiment ───────────────────────────────────────────────────
    function inferVoiceSentiment(voice) {
        return __awaiter(this, void 0, void 0, function* () {
            if (opts === null || opts === void 0 ? void 0 : opts.voiceSentimentFn) {
                return yield opts.voiceSentimentFn(voice);
            }
            return defaultVoiceSentiment(voice);
        });
    }
    // ── enrich ────────────────────────────────────────────────────────────────
    function enrich(msg, enrichOpts) {
        return __awaiter(this, void 0, void 0, function* () {
            const facts = [];
            // Shallow clone — only mutated when transcript is added.
            let enriched = Object.assign({}, msg);
            // Photo: captioner + optional raw bytes.
            if (msg.kind === 'photo' && msg.photo && (opts === null || opts === void 0 ? void 0 : opts.photoCaptioner)) {
                try {
                    let base64;
                    if (enrichOpts === null || enrichOpts === void 0 ? void 0 : enrichOpts.fetchBytesBase64) {
                        try {
                            base64 = yield enrichOpts.fetchBytesBase64();
                        }
                        catch (_a) {
                            // best-effort bytes; proceed without
                        }
                    }
                    const caption = yield opts.photoCaptioner(msg.photo, base64);
                    facts.push(caption);
                }
                catch (_b) {
                    // swallow — fact simply omitted
                }
            }
            // Document: extractor → text fact (capped at 4 000 chars).
            if (msg.kind === 'document' && msg.document && (opts === null || opts === void 0 ? void 0 : opts.documentExtractor)) {
                try {
                    const text = yield opts.documentExtractor(msg.document);
                    facts.push(text.slice(0, 4000));
                }
                catch (_c) {
                    // swallow
                }
            }
            // Video: summariser.
            if (msg.kind === 'video' && msg.video && (opts === null || opts === void 0 ? void 0 : opts.videoSummariser)) {
                try {
                    const summary = yield opts.videoSummariser(msg.video);
                    facts.push(summary);
                }
                catch (_d) {
                    // swallow
                }
            }
            // Voice: transcribe if transcript absent.
            if (msg.kind === 'voice' &&
                msg.voice &&
                !msg.voice.transcript &&
                (opts === null || opts === void 0 ? void 0 : opts.voiceTranscriber)) {
                try {
                    const transcript = yield opts.voiceTranscriber(msg.voice);
                    enriched = Object.assign(Object.assign({}, enriched), { voice: Object.assign(Object.assign({}, msg.voice), { transcript }) });
                    facts.push(`transcript: ${transcript}`);
                }
                catch (_e) {
                    // swallow
                }
            }
            return { msg: enriched, facts };
        });
    }
    // ── stats ─────────────────────────────────────────────────────────────────
    function stats() {
        return {
            totalsByKind: Object.assign({}, _totalsByKind),
            lastInbound: _lastInbound ? Object.assign({}, _lastInbound) : undefined,
            voiceUserHistory: [..._voiceUserHistory],
        };
    }
    // ── reset ─────────────────────────────────────────────────────────────────
    function reset() {
        _totalsByKind = makeEmptyTotals();
        _lastInbound = undefined;
        _voiceUserHistory = [];
    }
    return {
        observe,
        decideReply,
        inferVoiceSentiment,
        enrich,
        stats,
        reset,
    };
}
