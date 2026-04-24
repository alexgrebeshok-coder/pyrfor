/**
 * Server-side speech-to-text with pluggable providers.
 *
 * The previous STT implementation (`lib/voice/speech-to-text.ts`) runs only
 * in the browser via Web Speech API, which means agents, API routes,
 * meeting transcription, and any batch workflow cannot transcribe audio.
 * This module closes that gap with a small provider abstraction and an
 * OpenAI Whisper implementation that follows the same reliability
 * patterns as `lib/ai/providers.ts`:
 *
 *   - Single `AIRouter`-style `STTRouter` singleton.
 *   - Provider selection by availability (API key set) + optional
 *     explicit preference.
 *   - Errors surfaced as standard `Error` instances so the caller can
 *     fall back through the router.
 *
 * The module is server-only; the browser helper in `lib/voice/` is kept
 * for UI-side live transcription and is unrelated.
 */
import "server-only";
export interface TranscribeOptions {
    /** BCP-47 language hint, e.g. "ru" or "en". Optional. */
    language?: string;
    /** Optional prompt that biases the transcription towards known terms. */
    prompt?: string;
    /** Force a specific model (provider-dependent). */
    model?: string;
    /** Abort signal for cancellation. */
    signal?: AbortSignal;
}
export interface TranscribeResult {
    /** Transcribed text (may be empty for silent audio). */
    text: string;
    /** Detected / used language, if the provider reports it. */
    language?: string;
    /** Duration of the audio in seconds, if reported. */
    durationSeconds?: number;
    /** Provider that produced the transcript. */
    provider: string;
    /** Model actually used. */
    model: string;
}
export interface STTProvider {
    readonly name: string;
    /** Returns true if the provider has credentials + can be called. */
    isAvailable(): boolean;
    /**
     * Transcribe a binary audio blob. The provider is responsible for
     * wrapping the payload in whatever format its API expects.
     */
    transcribe(audio: Blob | Buffer | ArrayBuffer, filename: string, options?: TranscribeOptions): Promise<TranscribeResult>;
}
export declare class OpenAISTTProvider implements STTProvider {
    readonly name = "openai";
    private readonly apiKey;
    private readonly baseUrl;
    constructor(apiKey?: string, baseUrl?: string);
    isAvailable(): boolean;
    transcribe(audio: Blob | Buffer | ArrayBuffer, filename: string, options?: TranscribeOptions): Promise<TranscribeResult>;
}
export declare class MockSTTProvider implements STTProvider {
    readonly name = "mock";
    isAvailable(): boolean;
    transcribe(_audio: Blob | Buffer | ArrayBuffer, filename: string, options?: TranscribeOptions): Promise<TranscribeResult>;
}
export declare class STTRouter {
    private readonly providers;
    constructor(providers?: STTProvider[]);
    /**
     * Providers that currently advertise availability. Mock is always
     * listed last as a guaranteed fallback in non-production environments.
     */
    getAvailableProviders(): string[];
    transcribe(audio: Blob | Buffer | ArrayBuffer, filename: string, options?: TranscribeOptions & {
        provider?: string;
    }): Promise<TranscribeResult>;
}
export declare function getSTTRouter(): STTRouter;
/**
 * Reset the STT router singleton. Used by tests to re-read env vars.
 * @internal
 */
export declare function __resetSTTRouterForTests(): void;
//# sourceMappingURL=stt.d.ts.map