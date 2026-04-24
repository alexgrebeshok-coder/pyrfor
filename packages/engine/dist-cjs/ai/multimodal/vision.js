"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisionRouter = exports.MockVisionProvider = exports.OpenAIVisionProvider = void 0;
exports.getVisionRouter = getVisionRouter;
exports.__resetVisionRouterForTests = __resetVisionRouterForTests;
require("server-only");
const logger_1 = require("../../observability/logger");
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
class OpenAIVisionProvider {
    constructor(apiKey, baseUrl = OPENAI_VISION_BASE_URL) {
        this.name = "openai";
        this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? "";
        this.baseUrl = baseUrl;
    }
    isAvailable() {
        return Boolean(this.apiKey);
    }
    async describe(image, options = {}) {
        if (!this.apiKey)
            throw new Error("OPENAI_API_KEY not set");
        const language = options.language ?? "en";
        const prompt = options.prompt ??
            `Describe this image in ${language}. Focus on objects, people, text, and any unsafe or abnormal conditions visible. Keep the response concise (max 6 sentences).`;
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
            model: options.model ?? OPENAI_VISION_DEFAULT_MODEL,
            messages,
            max_tokens: options.maxTokens ?? 512,
            temperature: 0.2,
        };
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: options.signal,
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new Error(`OpenAI Vision API error: ${res.status} - ${errBody.slice(0, 400)}`);
        }
        const data = (await res.json());
        const description = data.choices?.[0]?.message?.content?.trim() ?? "";
        return {
            description,
            provider: this.name,
            model: body.model,
        };
    }
    async verify(image, options) {
        if (!this.apiKey)
            throw new Error("OPENAI_API_KEY not set");
        const language = options.language ?? "en";
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
            model: options.model ?? OPENAI_VISION_DEFAULT_MODEL,
            messages,
            max_tokens: options.maxTokens ?? 256,
            temperature: 0,
            response_format: { type: "json_object" },
        };
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: options.signal,
        });
        if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new Error(`OpenAI Vision API error: ${res.status} - ${errBody.slice(0, 400)}`);
        }
        const data = (await res.json());
        const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
        return {
            ...parseVerifyResponse(raw),
            provider: this.name,
            model: body.model,
        };
    }
}
exports.OpenAIVisionProvider = OpenAIVisionProvider;
function parseVerifyResponse(raw) {
    try {
        const parsed = JSON.parse(raw);
        const verdict = (parsed.verdict ?? "uncertain").toLowerCase();
        const normalizedVerdict = verdict === "confirmed" || verdict === "refuted" ? verdict : "uncertain";
        const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0.5;
        const reason = typeof parsed.reason === "string" ? parsed.reason : "";
        return { verdict: normalizedVerdict, confidence, reason };
    }
    catch {
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
class MockVisionProvider {
    constructor() {
        this.name = "mock";
    }
    isAvailable() {
        return true;
    }
    async describe(_image, options = {}) {
        return {
            description: "[mock vision] An image was received but no real analysis was performed.",
            provider: this.name,
            model: options.model ?? "mock-vision",
        };
    }
    async verify(_image, options) {
        return {
            verdict: "uncertain",
            confidence: 0,
            reason: `[mock vision] unable to verify claim: "${options.claim}"`,
            provider: this.name,
            model: options.model ?? "mock-vision",
        };
    }
}
exports.MockVisionProvider = MockVisionProvider;
// ============================================
// Router
// ============================================
class VisionRouter {
    constructor(providers) {
        this.providers =
            providers ?? [new OpenAIVisionProvider(), new MockVisionProvider()];
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
    async describe(image, options = {}) {
        const candidates = this.pickProvider(options.provider);
        if (candidates.length === 0) {
            throw new Error("No vision provider is available");
        }
        let lastError;
        for (const provider of candidates) {
            try {
                return await provider.describe(image, options);
            }
            catch (err) {
                lastError = err;
                logger_1.logger.warn("vision-router: describe failed, trying next", {
                    provider: provider.name,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        throw lastError instanceof Error
            ? lastError
            : new Error("All vision providers failed");
    }
    async verify(image, options) {
        const candidates = this.pickProvider(options.provider);
        if (candidates.length === 0) {
            throw new Error("No vision provider is available");
        }
        let lastError;
        for (const provider of candidates) {
            try {
                return await provider.verify(image, options);
            }
            catch (err) {
                lastError = err;
                logger_1.logger.warn("vision-router: verify failed, trying next", {
                    provider: provider.name,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        throw lastError instanceof Error
            ? lastError
            : new Error("All vision providers failed");
    }
}
exports.VisionRouter = VisionRouter;
let _visionRouter = null;
function getVisionRouter() {
    if (!_visionRouter) {
        _visionRouter = new VisionRouter();
    }
    return _visionRouter;
}
/** @internal */
function __resetVisionRouterForTests() {
    _visionRouter = null;
}
