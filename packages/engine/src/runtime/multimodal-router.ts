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

// ── Public types ──────────────────────────────────────────────────────────────

export type ModalityKind =
  | 'text'
  | 'voice'
  | 'photo'
  | 'document'
  | 'video'
  | 'sticker'
  | 'unknown';

export type ReplyPreference = 'text' | 'voice' | 'document' | 'photo';

export interface InboundMessage {
  kind: ModalityKind;
  text?: string;
  voice?: {
    durationMs: number;
    transcript?: string;
    sampleRateHz?: number;
    bytes?: number;
  };
  photo?: { bytes?: number; caption?: string; mimeType?: string };
  document?: { bytes?: number; mimeType?: string; filename?: string };
  video?: { durationMs?: number; bytes?: number };
  ts?: number;
  userId?: string;
}

export interface VoiceSentiment {
  label: 'pos' | 'neu' | 'neg';
  /** Continuous arousal score 0..1. */
  arousal: number;
  rateWpm?: number;
  reasons: string[];
}

export interface ReplyDecision {
  preferred: ReplyPreference;
  rationale: string;
  ttsHint?: 'fast' | 'normal' | 'slow';
  attachOriginalTranscript?: boolean;
}

export interface ModalityStats {
  totalsByKind: Record<ModalityKind, number>;
  lastInbound?: { kind: ModalityKind; ts: number };
  voiceUserHistory: Array<{
    ts: number;
    durationMs: number;
    sentiment: VoiceSentiment['label'];
  }>;
}

export interface MultimodalRouterOptions {
  /** Characters threshold above which preferred reply switches to 'document'. Default 1 500. */
  defaultLongTextChars?: number;
  /** Mirror voice input with voice reply. Default true. */
  voiceReplyOnVoice?: boolean;
  /** Global override — always prefer text. */
  preferText?: boolean;
  /** Metadata only — TTS model name hint for consumers. */
  ttsModel?: string;
  voiceTranscriber?: (
    input: NonNullable<InboundMessage['voice']>,
  ) => Promise<string>;
  voiceSentimentFn?: (
    input: NonNullable<InboundMessage['voice']>,
  ) => Promise<VoiceSentiment> | VoiceSentiment;
  photoCaptioner?: (
    photo: NonNullable<InboundMessage['photo']>,
    bytesBase64?: string,
  ) => Promise<string>;
  videoSummariser?: (
    video: NonNullable<InboundMessage['video']>,
  ) => Promise<string>;
  documentExtractor?: (
    doc: NonNullable<InboundMessage['document']>,
  ) => Promise<string>;
  /** Override wall clock (epoch ms). Useful for testing. */
  clock?: () => number;
}

export interface MultimodalRouter {
  observe(msg: InboundMessage): void;
  decideReply(input: {
    inbound: InboundMessage;
    replyText: string;
    energy?: 'low' | 'medium' | 'high';
  }): ReplyDecision;
  inferVoiceSentiment(
    voice: NonNullable<InboundMessage['voice']>,
  ): Promise<VoiceSentiment>;
  enrich(
    msg: InboundMessage,
    opts?: { fetchBytesBase64?: () => Promise<string> },
  ): Promise<{ msg: InboundMessage; facts: string[] }>;
  stats(): ModalityStats;
  reset(): void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_KINDS: ModalityKind[] = [
  'text',
  'voice',
  'photo',
  'document',
  'video',
  'sticker',
  'unknown',
];

const DEFAULT_LONG_TEXT_CHARS = 1_500;
const VOICE_HISTORY_CAP = 200;

/** Baseline wpm assumed when no transcript is available. */
const BASELINE_WPM = 150;

/** Arousal lower bound for wpm axis (0 arousal at this wpm). */
const WPM_FLOOR = 90;

/** Arousal ramp size: arousal reaches 1 at WPM_FLOOR + WPM_RAMP. */
const WPM_RAMP = 80;

/** Duration threshold (ms) distinguishing short (enthusiastic) from long (stressed) fast speech. */
const SHORT_VOICE_MS = 3_000;

// ── Internal helpers ──────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function makeEmptyTotals(): Record<ModalityKind, number> {
  return Object.fromEntries(ALL_KINDS.map((k) => [k, 0])) as Record<
    ModalityKind,
    number
  >;
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
export function detectKindFromMime(mime: string | undefined): ModalityKind {
  if (!mime) return 'unknown';
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('audio/')) return 'voice';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('application/')) return 'document';
  return 'unknown';
}

/**
 * Heuristic voice sentiment from duration and optional transcript.
 * See module-level comment for the full formula.
 */
export function defaultVoiceSentiment(
  voice: NonNullable<InboundMessage['voice']>,
): VoiceSentiment {
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

  let rateWpm: number;
  const reasons: string[] = [];

  if (transcript && transcript.trim().length > 0) {
    const wordCount = transcript.trim().split(/\s+/).length;
    rateWpm = wordCount / (durationMs / 60_000);
    reasons.push(
      `${wordCount} word(s) in ${(durationMs / 1_000).toFixed(1)} s → ${rateWpm.toFixed(0)} wpm`,
    );
  } else {
    rateWpm = BASELINE_WPM;
    reasons.push(`no transcript — using ${BASELINE_WPM} wpm baseline`);
  }

  const arousal = clamp01((rateWpm - WPM_FLOOR) / WPM_RAMP);

  let label: VoiceSentiment['label'];
  if (arousal > 0.65) {
    if (durationMs <= SHORT_VOICE_MS) {
      label = 'pos';
      reasons.push('fast rate + short burst → enthusiastic positive');
    } else {
      label = 'neg';
      reasons.push('fast rate + long message → stressed / excited negative');
    }
  } else if (arousal < 0.3) {
    label = 'neu';
    reasons.push('slow rate → calm / neutral');
  } else {
    label = 'pos';
    reasons.push('moderate rate → positive');
  }

  return { label, arousal, rateWpm, reasons };
}

// ── createMultimodalRouter ────────────────────────────────────────────────────

export function createMultimodalRouter(
  opts?: MultimodalRouterOptions,
): MultimodalRouter {
  const defaultLongTextChars =
    opts?.defaultLongTextChars ?? DEFAULT_LONG_TEXT_CHARS;
  const voiceReplyOnVoice = opts?.voiceReplyOnVoice ?? true;
  const preferText = opts?.preferText ?? false;
  const clock = opts?.clock ?? (() => Date.now());

  let _totalsByKind: Record<ModalityKind, number> = makeEmptyTotals();
  let _lastInbound: { kind: ModalityKind; ts: number } | undefined;
  let _voiceUserHistory: Array<{
    ts: number;
    durationMs: number;
    sentiment: VoiceSentiment['label'];
  }> = [];

  // ── observe ───────────────────────────────────────────────────────────────

  function observe(msg: InboundMessage): void {
    _totalsByKind[msg.kind]++;
    _lastInbound = { kind: msg.kind, ts: msg.ts ?? clock() };

    if (msg.kind === 'voice' && msg.voice) {
      // Synchronous heuristic; voiceSentimentFn (async) is for inferVoiceSentiment.
      const sentiment = defaultVoiceSentiment(msg.voice);
      _voiceUserHistory.push({
        ts: msg.ts ?? clock(),
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

  function decideReply(input: {
    inbound: InboundMessage;
    replyText: string;
    energy?: 'low' | 'medium' | 'high';
  }): ReplyDecision {
    const { inbound, replyText, energy } = input;

    // Global override: always reply with text.
    if (preferText) {
      return { preferred: 'text', rationale: 'preferText override active' };
    }

    // Voice mirror: inbound was voice → reply with voice.
    // This intentionally wins over the long-text document rule (see module comment).
    if (inbound.kind === 'voice' && voiceReplyOnVoice) {
      const ttsHint: ReplyDecision['ttsHint'] =
        energy === 'high' ? 'fast' : energy === 'low' ? 'slow' : 'normal';
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

  async function inferVoiceSentiment(
    voice: NonNullable<InboundMessage['voice']>,
  ): Promise<VoiceSentiment> {
    if (opts?.voiceSentimentFn) {
      return await opts.voiceSentimentFn(voice);
    }
    return defaultVoiceSentiment(voice);
  }

  // ── enrich ────────────────────────────────────────────────────────────────

  async function enrich(
    msg: InboundMessage,
    enrichOpts?: { fetchBytesBase64?: () => Promise<string> },
  ): Promise<{ msg: InboundMessage; facts: string[] }> {
    const facts: string[] = [];
    // Shallow clone — only mutated when transcript is added.
    let enriched: InboundMessage = { ...msg };

    // Photo: captioner + optional raw bytes.
    if (msg.kind === 'photo' && msg.photo && opts?.photoCaptioner) {
      try {
        let base64: string | undefined;
        if (enrichOpts?.fetchBytesBase64) {
          try {
            base64 = await enrichOpts.fetchBytesBase64();
          } catch {
            // best-effort bytes; proceed without
          }
        }
        const caption = await opts.photoCaptioner(msg.photo, base64);
        facts.push(caption);
      } catch {
        // swallow — fact simply omitted
      }
    }

    // Document: extractor → text fact (capped at 4 000 chars).
    if (msg.kind === 'document' && msg.document && opts?.documentExtractor) {
      try {
        const text = await opts.documentExtractor(msg.document);
        facts.push(text.slice(0, 4_000));
      } catch {
        // swallow
      }
    }

    // Video: summariser.
    if (msg.kind === 'video' && msg.video && opts?.videoSummariser) {
      try {
        const summary = await opts.videoSummariser(msg.video);
        facts.push(summary);
      } catch {
        // swallow
      }
    }

    // Voice: transcribe if transcript absent.
    if (
      msg.kind === 'voice' &&
      msg.voice &&
      !msg.voice.transcript &&
      opts?.voiceTranscriber
    ) {
      try {
        const transcript = await opts.voiceTranscriber(msg.voice);
        enriched = { ...enriched, voice: { ...msg.voice, transcript } };
        facts.push(`transcript: ${transcript}`);
      } catch {
        // swallow
      }
    }

    return { msg: enriched, facts };
  }

  // ── stats ─────────────────────────────────────────────────────────────────

  function stats(): ModalityStats {
    return {
      totalsByKind: { ..._totalsByKind },
      lastInbound: _lastInbound ? { ..._lastInbound } : undefined,
      voiceUserHistory: [..._voiceUserHistory],
    };
  }

  // ── reset ─────────────────────────────────────────────────────────────────

  function reset(): void {
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
