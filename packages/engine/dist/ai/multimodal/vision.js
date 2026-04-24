/**
 * Server-side vision helpers with pluggable providers.
 *
 * Provides a small, router-style abstraction for describing, classifying,
 * and verifying images via chat-completions-with-vision endpoints.
 * Today the only implementation is OpenAI (gpt-4o), but the router is
 * designed so OpenRouter / other vision-capable providers can be added
 * without touching call sites.
 *
 * Typical use cases:
 *   - `describeImage(url)`: free-form description for UI previews or
 *     agent context enrichment.
 *   - `verifyImage(url, claim)`: returns a structured `{ verdict,
 *     confidence, reason }` — intended for the forthcoming
 *     video-fact verification pipeline (see `lib/video-facts/service.ts`).
 *
 * Server-only; callers in client components should go through an API
 * route such as `/api/ai/vision/describe`.
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
// OpenAI (gpt-4o) provider
// ============================================
const OPENAI_VISION_BASE_URL = "https://api.openai.com/v1";
const OPENAI_VISION_DEFAULT_MODEL = "gpt-4o-mini";
function imageSourceToUrl(image) {
    if (image.kind === "url")
        return image.url;
    return `data:${image.mimeType};base64,${image.data}`;
}
export class OpenAIVisionProvider {
    constructor(apiKey, baseUrl = OPENAI_VISION_BASE_URL) {
        var _a;
        this.name = "openai";
        this.apiKey = (_a = apiKey !== null && apiKey !== void 0 ? apiKey : process.env.OPENAI_API_KEY) !== null && _a !== void 0 ? _a : "";
        this.baseUrl = baseUrl;
    }
    isAvailable() {
        return Boolean(this.apiKey);
    }
    describe(image_1) {
        return __awaiter(this, arguments, void 0, function* (image, options = {}) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j;
            if (!this.apiKey)
                throw new Error("OPENAI_API_KEY not set");
            const language = (_a = options.language) !== null && _a !== void 0 ? _a : "en";
            const prompt = (_b = options.prompt) !== null && _b !== void 0 ? _b : `Describe this image in ${language}. Focus on objects, people, text, and any unsafe or abnormal conditions visible. Keep the response concise (max 6 sentences).`;
            const messages = [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: imageSourceToUrl(image) } },
                    ],
                },
            ];
            const body = {
                model: (_c = options.model) !== null && _c !== void 0 ? _c : OPENAI_VISION_DEFAULT_MODEL,
                messages,
                max_tokens: (_d = options.maxTokens) !== null && _d !== void 0 ? _d : 512,
                temperature: 0.2,
            };
            const res = yield fetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
                signal: options.signal,
            });
            if (!res.ok) {
                const errBody = yield res.text().catch(() => "");
                throw new Error(`OpenAI Vision API error: ${res.status} - ${errBody.slice(0, 400)}`);
            }
            const data = (yield res.json());
            const description = (_j = (_h = (_g = (_f = (_e = data.choices) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.message) === null || _g === void 0 ? void 0 : _g.content) === null || _h === void 0 ? void 0 : _h.trim()) !== null && _j !== void 0 ? _j : "";
            return {
                description,
                provider: this.name,
                model: body.model,
            };
        });
    }
    verify(image, options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            if (!this.apiKey)
                throw new Error("OPENAI_API_KEY not set");
            const language = (_a = options.language) !== null && _a !== void 0 ? _a : "en";
            const prompt = `You are verifying a claim against an image.

Claim: "${options.claim}"

Respond ONLY with compact JSON of the form:
{ "verdict": "confirmed" | "refuted" | "uncertain", "confidence": <number 0..1>, "reason": "<one-sentence justification in ${language}>" }

Rules:
- "confirmed" — the image clearly supports the claim.
- "refuted" — the image clearly contradicts the claim.
- "uncertain" — not enough visual evidence to decide either way.
- Do NOT include any other text, only the JSON object.`;
            const messages = [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: imageSourceToUrl(image) } },
                    ],
                },
            ];
            const body = {
                model: (_b = options.model) !== null && _b !== void 0 ? _b : OPENAI_VISION_DEFAULT_MODEL,
                messages,
                max_tokens: (_c = options.maxTokens) !== null && _c !== void 0 ? _c : 256,
                temperature: 0,
                response_format: { type: "json_object" },
            };
            const res = yield fetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
                signal: options.signal,
            });
            if (!res.ok) {
                const errBody = yield res.text().catch(() => "");
                throw new Error(`OpenAI Vision API error: ${res.status} - ${errBody.slice(0, 400)}`);
            }
            const data = (yield res.json());
            const raw = (_h = (_g = (_f = (_e = (_d = data.choices) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.message) === null || _f === void 0 ? void 0 : _f.content) === null || _g === void 0 ? void 0 : _g.trim()) !== null && _h !== void 0 ? _h : "";
            return Object.assign(Object.assign({}, parseVerifyResponse(raw)), { provider: this.name, model: body.model });
        });
    }
}
function parseVerifyResponse(raw) {
    var _a;
    try {
        const parsed = JSON.parse(raw);
        const verdict = ((_a = parsed.verdict) !== null && _a !== void 0 ? _a : "uncertain").toLowerCase();
        const normalizedVerdict = verdict === "confirmed" || verdict === "refuted" ? verdict : "uncertain";
        const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0.5;
        const reason = typeof parsed.reason === "string" ? parsed.reason : "";
        return { verdict: normalizedVerdict, confidence, reason };
    }
    catch (_b) {
        return {
            verdict: "uncertain",
            confidence: 0,
            reason: raw.slice(0, 200) || "Vision provider returned unparseable response.",
        };
    }
}
// ============================================
// Mock provider
// ============================================
export class MockVisionProvider {
    constructor() {
        this.name = "mock";
    }
    isAvailable() {
        return true;
    }
    describe(_image_1) {
        return __awaiter(this, arguments, void 0, function* (_image, options = {}) {
            var _a;
            return {
                description: "[mock vision] An image was received but no real analysis was performed.",
                provider: this.name,
                model: (_a = options.model) !== null && _a !== void 0 ? _a : "mock-vision",
            };
        });
    }
    verify(_image, options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            return {
                verdict: "uncertain",
                confidence: 0,
                reason: `[mock vision] unable to verify claim: "${options.claim}"`,
                provider: this.name,
                model: (_a = options.model) !== null && _a !== void 0 ? _a : "mock-vision",
            };
        });
    }
}
// ============================================
// Router
// ============================================
export class VisionRouter {
    constructor(providers) {
        this.providers =
            providers !== null && providers !== void 0 ? providers : [new OpenAIVisionProvider(), new MockVisionProvider()];
    }
    getAvailableProviders() {
        return this.providers.filter((p) => p.isAvailable()).map((p) => p.name);
    }
    pickProvider(preferred) {
        const isProd = process.env.NODE_ENV === "production";
        return this.providers.filter((p) => {
            if (!p.isAvailable())
                return false;
            if (isProd && p.name === "mock")
                return false;
            if (preferred && preferred !== p.name)
                return false;
            return true;
        });
    }
    describe(image_1) {
        return __awaiter(this, arguments, void 0, function* (image, options = {}) {
            const candidates = this.pickProvider(options.provider);
            if (candidates.length === 0) {
                throw new Error("No vision provider is available");
            }
            let lastError;
            for (const provider of candidates) {
                try {
                    return yield provider.describe(image, options);
                }
                catch (err) {
                    lastError = err;
                    logger.warn("vision-router: describe failed, trying next", {
                        provider: provider.name,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            throw lastError instanceof Error
                ? lastError
                : new Error("All vision providers failed");
        });
    }
    verify(image, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const candidates = this.pickProvider(options.provider);
            if (candidates.length === 0) {
                throw new Error("No vision provider is available");
            }
            let lastError;
            for (const provider of candidates) {
                try {
                    return yield provider.verify(image, options);
                }
                catch (err) {
                    lastError = err;
                    logger.warn("vision-router: verify failed, trying next", {
                        provider: provider.name,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            throw lastError instanceof Error
                ? lastError
                : new Error("All vision providers failed");
        });
    }
}
let _visionRouter = null;
export function getVisionRouter() {
    if (!_visionRouter) {
        _visionRouter = new VisionRouter();
    }
    return _visionRouter;
}
/** @internal */
export function __resetVisionRouterForTests() {
    _visionRouter = null;
}
