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

import { logger } from "@/lib/logger";

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
  transcribe(
    audio: Blob | Buffer | ArrayBuffer,
    filename: string,
    options?: TranscribeOptions
  ): Promise<TranscribeResult>;
}

// ============================================
// OpenAI Whisper provider
// ============================================

const OPENAI_STT_BASE_URL = "https://api.openai.com/v1";
const OPENAI_STT_DEFAULT_MODEL = "whisper-1";

export class OpenAISTTProvider implements STTProvider {
  readonly name = "openai";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey?: string, baseUrl: string = OPENAI_STT_BASE_URL) {
    this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl = baseUrl;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async transcribe(
    audio: Blob | Buffer | ArrayBuffer,
    filename: string,
    options: TranscribeOptions = {}
  ): Promise<TranscribeResult> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY not set");
    }

    const form = new FormData();
    const blob =
      audio instanceof Blob
        ? audio
        : new Blob([audio as ArrayBuffer], { type: guessMimeFromFilename(filename) });
    form.append("file", blob, filename);
    form.append("model", options.model ?? OPENAI_STT_DEFAULT_MODEL);
    if (options.language) form.append("language", options.language);
    if (options.prompt) form.append("prompt", options.prompt);
    form.append("response_format", "verbose_json");

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: options.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `OpenAI STT API error: ${res.status} - ${body.slice(0, 400)}`
      );
    }

    const data = (await res.json()) as {
      text?: string;
      language?: string;
      duration?: number;
    };

    return {
      text: typeof data.text === "string" ? data.text : "",
      language: data.language,
      durationSeconds: data.duration,
      provider: this.name,
      model: options.model ?? OPENAI_STT_DEFAULT_MODEL,
    };
  }
}

// ============================================
// Mock provider (tests / degraded mode)
// ============================================

export class MockSTTProvider implements STTProvider {
  readonly name = "mock";
  isAvailable(): boolean {
    return true;
  }
  async transcribe(
    _audio: Blob | Buffer | ArrayBuffer,
    filename: string,
    options: TranscribeOptions = {}
  ): Promise<TranscribeResult> {
    return {
      text: `[mock transcription of ${filename}]`,
      language: options.language ?? "en",
      provider: this.name,
      model: options.model ?? "mock-stt",
    };
  }
}

// ============================================
// Router
// ============================================

export class STTRouter {
  private readonly providers: STTProvider[];

  constructor(providers?: STTProvider[]) {
    this.providers = providers ?? [new OpenAISTTProvider(), new MockSTTProvider()];
  }

  /**
   * Providers that currently advertise availability. Mock is always
   * listed last as a guaranteed fallback in non-production environments.
   */
  getAvailableProviders(): string[] {
    return this.providers
      .filter((p) => p.isAvailable())
      .map((p) => p.name);
  }

  async transcribe(
    audio: Blob | Buffer | ArrayBuffer,
    filename: string,
    options: TranscribeOptions & { provider?: string } = {}
  ): Promise<TranscribeResult> {
    const isProd = process.env.NODE_ENV === "production";
    const preferred = options.provider;

    const candidates = this.providers.filter((p) => {
      if (!p.isAvailable()) return false;
      if (isProd && p.name === "mock") return false;
      if (preferred && preferred !== p.name) return false;
      return true;
    });

    if (preferred && candidates.length === 0) {
      throw new Error(`STT provider "${preferred}" is not available`);
    }

    if (candidates.length === 0) {
      throw new Error(
        "No STT provider is available. Set OPENAI_API_KEY or disable production mode."
      );
    }

    let lastError: unknown;
    for (const provider of candidates) {
      try {
        return await provider.transcribe(audio, filename, options);
      } catch (err) {
        lastError = err;
        logger.warn("stt-router: provider failed, trying next", {
          provider: provider.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("All STT providers failed");
  }
}

let _router: STTRouter | null = null;

export function getSTTRouter(): STTRouter {
  if (!_router) {
    _router = new STTRouter();
  }
  return _router;
}

/**
 * Reset the STT router singleton. Used by tests to re-read env vars.
 * @internal
 */
export function __resetSTTRouterForTests() {
  _router = null;
}

function guessMimeFromFilename(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "m4a":
      return "audio/mp4";
    case "ogg":
    case "oga":
      return "audio/ogg";
    case "webm":
      return "audio/webm";
    case "flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}
