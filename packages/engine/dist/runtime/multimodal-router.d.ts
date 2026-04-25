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
export type ModalityKind = 'text' | 'voice' | 'photo' | 'document' | 'video' | 'sticker' | 'unknown';
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
    photo?: {
        bytes?: number;
        caption?: string;
        mimeType?: string;
    };
    document?: {
        bytes?: number;
        mimeType?: string;
        filename?: string;
    };
    video?: {
        durationMs?: number;
        bytes?: number;
    };
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
    lastInbound?: {
        kind: ModalityKind;
        ts: number;
    };
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
    voiceTranscriber?: (input: NonNullable<InboundMessage['voice']>) => Promise<string>;
    voiceSentimentFn?: (input: NonNullable<InboundMessage['voice']>) => Promise<VoiceSentiment> | VoiceSentiment;
    photoCaptioner?: (photo: NonNullable<InboundMessage['photo']>, bytesBase64?: string) => Promise<string>;
    videoSummariser?: (video: NonNullable<InboundMessage['video']>) => Promise<string>;
    documentExtractor?: (doc: NonNullable<InboundMessage['document']>) => Promise<string>;
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
    inferVoiceSentiment(voice: NonNullable<InboundMessage['voice']>): Promise<VoiceSentiment>;
    enrich(msg: InboundMessage, opts?: {
        fetchBytesBase64?: () => Promise<string>;
    }): Promise<{
        msg: InboundMessage;
        facts: string[];
    }>;
    stats(): ModalityStats;
    reset(): void;
}
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
export declare function detectKindFromMime(mime: string | undefined): ModalityKind;
/**
 * Heuristic voice sentiment from duration and optional transcript.
 * See module-level comment for the full formula.
 */
export declare function defaultVoiceSentiment(voice: NonNullable<InboundMessage['voice']>): VoiceSentiment;
export declare function createMultimodalRouter(opts?: MultimodalRouterOptions): MultimodalRouter;
//# sourceMappingURL=multimodal-router.d.ts.map