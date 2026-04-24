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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import "server-only";
import { logger } from '../../observability/logger';
// ============================================
// OpenAI Whisper provider
// ============================================
const OPENAI_STT_BASE_URL = "https://api.openai.com/v1";
const OPENAI_STT_DEFAULT_MODEL = "whisper-1";
export class OpenAISTTProvider {
    constructor(apiKey, baseUrl = OPENAI_STT_BASE_URL) {
        var _a;
        this.name = "openai";
        this.apiKey = (_a = apiKey !== null && apiKey !== void 0 ? apiKey : process.env.OPENAI_API_KEY) !== null && _a !== void 0 ? _a : "";
        this.baseUrl = baseUrl;
    }
    isAvailable() {
        return Boolean(this.apiKey);
    }
    transcribe(audio_1, filename_1) {
        return __awaiter(this, arguments, void 0, function* (audio, filename, options = {}) {
            var _a, _b;
            if (!this.apiKey) {
                throw new Error("OPENAI_API_KEY not set");
            }
            const form = new FormData();
            const blob = audio instanceof Blob
                ? audio
                : new Blob([audio], { type: guessMimeFromFilename(filename) });
            form.append("file", blob, filename);
            form.append("model", (_a = options.model) !== null && _a !== void 0 ? _a : OPENAI_STT_DEFAULT_MODEL);
            if (options.language)
                form.append("language", options.language);
            if (options.prompt)
                form.append("prompt", options.prompt);
            form.append("response_format", "verbose_json");
            const res = yield fetch(`${this.baseUrl}/audio/transcriptions`, {
                method: "POST",
                headers: { Authorization: `Bearer ${this.apiKey}` },
                body: form,
                signal: options.signal,
            });
            if (!res.ok) {
                const body = yield res.text().catch(() => "");
                throw new Error(`OpenAI STT API error: ${res.status} - ${body.slice(0, 400)}`);
            }
            const data = (yield res.json());
            return {
                text: typeof data.text === "string" ? data.text : "",
                language: data.language,
                durationSeconds: data.duration,
                provider: this.name,
                model: (_b = options.model) !== null && _b !== void 0 ? _b : OPENAI_STT_DEFAULT_MODEL,
            };
        });
    }
}
// ============================================
// Mock provider (tests / degraded mode)
// ============================================
export class MockSTTProvider {
    constructor() {
        this.name = "mock";
    }
    isAvailable() {
        return true;
    }
    transcribe(_audio_1, filename_1) {
        return __awaiter(this, arguments, void 0, function* (_audio, filename, options = {}) {
            var _a, _b;
            return {
                text: `[mock transcription of ${filename}]`,
                language: (_a = options.language) !== null && _a !== void 0 ? _a : "en",
                provider: this.name,
                model: (_b = options.model) !== null && _b !== void 0 ? _b : "mock-stt",
            };
        });
    }
}
// ============================================
// Router
// ============================================
export class STTRouter {
    constructor(providers) {
        this.providers = providers !== null && providers !== void 0 ? providers : [new OpenAISTTProvider(), new MockSTTProvider()];
    }
    /**
     * Providers that currently advertise availability. Mock is always
     * listed last as a guaranteed fallback in non-production environments.
     */
    getAvailableProviders() {
        return this.providers
            .filter((p) => p.isAvailable())
            .map((p) => p.name);
    }
    transcribe(audio_1, filename_1) {
        return __awaiter(this, arguments, void 0, function* (audio, filename, options = {}) {
            const isProd = process.env.NODE_ENV === "production";
            const preferred = options.provider;
            const candidates = this.providers.filter((p) => {
                if (!p.isAvailable())
                    return false;
                if (isProd && p.name === "mock")
                    return false;
                if (preferred && preferred !== p.name)
                    return false;
                return true;
            });
            if (preferred && candidates.length === 0) {
                throw new Error(`STT provider "${preferred}" is not available`);
            }
            if (candidates.length === 0) {
                throw new Error("No STT provider is available. Set OPENAI_API_KEY or disable production mode.");
            }
            let lastError;
            for (const provider of candidates) {
                try {
                    return yield provider.transcribe(audio, filename, options);
                }
                catch (err) {
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
        });
    }
}
let _router = null;
export function getSTTRouter() {
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
function guessMimeFromFilename(filename) {
    var _a;
    const ext = (_a = filename.toLowerCase().split(".").pop()) !== null && _a !== void 0 ? _a : "";
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
