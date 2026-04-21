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

import "server-only";

import { logger } from "@/lib/logger";

export type ImageSource =
  | { kind: "url"; url: string }
  | { kind: "base64"; data: string; mimeType: string };

export interface VisionDescribeOptions {
  /** Max tokens in the textual response. Defaults to 512. */
  maxTokens?: number;
  /** Force a specific vision-capable model. */
  model?: string;
  /** Optional instruction / question to seed the description. */
  prompt?: string;
  /** Language hint for the response. */
  language?: string;
  signal?: AbortSignal;
}

export interface VisionDescribeResult {
  description: string;
  provider: string;
  model: string;
}

export type VisionVerdict = "confirmed" | "refuted" | "uncertain";

export interface VisionVerifyOptions extends VisionDescribeOptions {
  /** Human-readable claim about the image to verify. */
  claim: string;
}

export interface VisionVerifyResult {
  verdict: VisionVerdict;
  confidence: number; // 0..1
  reason: string;
  provider: string;
  model: string;
}

export interface VisionProvider {
  readonly name: string;
  isAvailable(): boolean;
  describe(
    image: ImageSource,
    options?: VisionDescribeOptions
  ): Promise<VisionDescribeResult>;
  verify(
    image: ImageSource,
    options: VisionVerifyOptions
  ): Promise<VisionVerifyResult>;
}

// ============================================
// OpenAI (gpt-4o) provider
// ============================================

const OPENAI_VISION_BASE_URL = "https://api.openai.com/v1";
const OPENAI_VISION_DEFAULT_MODEL = "gpt-4o-mini";

interface OpenAIVisionMessage {
  role: "user" | "system";
  content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
}

function imageSourceToUrl(image: ImageSource): string {
  if (image.kind === "url") return image.url;
  return `data:${image.mimeType};base64,${image.data}`;
}

export class OpenAIVisionProvider implements VisionProvider {
  readonly name = "openai";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey?: string, baseUrl: string = OPENAI_VISION_BASE_URL) {
    this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl = baseUrl;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async describe(
    image: ImageSource,
    options: VisionDescribeOptions = {}
  ): Promise<VisionDescribeResult> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY not set");

    const language = options.language ?? "en";
    const prompt =
      options.prompt ??
      `Describe this image in ${language}. Focus on objects, people, text, and any unsafe or abnormal conditions visible. Keep the response concise (max 6 sentences).`;

    const messages: OpenAIVisionMessage[] = [
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
      throw new Error(
        `OpenAI Vision API error: ${res.status} - ${errBody.slice(0, 400)}`
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const description = data.choices?.[0]?.message?.content?.trim() ?? "";

    return {
      description,
      provider: this.name,
      model: body.model,
    };
  }

  async verify(
    image: ImageSource,
    options: VisionVerifyOptions
  ): Promise<VisionVerifyResult> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY not set");

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

    const messages: OpenAIVisionMessage[] = [
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
      response_format: { type: "json_object" as const },
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
      throw new Error(
        `OpenAI Vision API error: ${res.status} - ${errBody.slice(0, 400)}`
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    return {
      ...parseVerifyResponse(raw),
      provider: this.name,
      model: body.model,
    };
  }
}

function parseVerifyResponse(raw: string): {
  verdict: VisionVerdict;
  confidence: number;
  reason: string;
} {
  try {
    const parsed = JSON.parse(raw) as Partial<{
      verdict: string;
      confidence: number;
      reason: string;
    }>;
    const verdict = (parsed.verdict ?? "uncertain").toLowerCase();
    const normalizedVerdict: VisionVerdict =
      verdict === "confirmed" || verdict === "refuted" ? verdict : "uncertain";
    const confidence =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;
    const reason = typeof parsed.reason === "string" ? parsed.reason : "";
    return { verdict: normalizedVerdict, confidence, reason };
  } catch {
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

export class MockVisionProvider implements VisionProvider {
  readonly name = "mock";
  isAvailable(): boolean {
    return true;
  }
  async describe(
    _image: ImageSource,
    options: VisionDescribeOptions = {}
  ): Promise<VisionDescribeResult> {
    return {
      description: "[mock vision] An image was received but no real analysis was performed.",
      provider: this.name,
      model: options.model ?? "mock-vision",
    };
  }
  async verify(
    _image: ImageSource,
    options: VisionVerifyOptions
  ): Promise<VisionVerifyResult> {
    return {
      verdict: "uncertain",
      confidence: 0,
      reason: `[mock vision] unable to verify claim: "${options.claim}"`,
      provider: this.name,
      model: options.model ?? "mock-vision",
    };
  }
}

// ============================================
// Router
// ============================================

export class VisionRouter {
  private readonly providers: VisionProvider[];

  constructor(providers?: VisionProvider[]) {
    this.providers =
      providers ?? [new OpenAIVisionProvider(), new MockVisionProvider()];
  }

  getAvailableProviders(): string[] {
    return this.providers.filter((p) => p.isAvailable()).map((p) => p.name);
  }

  private pickProvider(preferred?: string): VisionProvider[] {
    const isProd = process.env.NODE_ENV === "production";
    return this.providers.filter((p) => {
      if (!p.isAvailable()) return false;
      if (isProd && p.name === "mock") return false;
      if (preferred && preferred !== p.name) return false;
      return true;
    });
  }

  async describe(
    image: ImageSource,
    options: VisionDescribeOptions & { provider?: string } = {}
  ): Promise<VisionDescribeResult> {
    const candidates = this.pickProvider(options.provider);
    if (candidates.length === 0) {
      throw new Error("No vision provider is available");
    }
    let lastError: unknown;
    for (const provider of candidates) {
      try {
        return await provider.describe(image, options);
      } catch (err) {
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
  }

  async verify(
    image: ImageSource,
    options: VisionVerifyOptions & { provider?: string }
  ): Promise<VisionVerifyResult> {
    const candidates = this.pickProvider(options.provider);
    if (candidates.length === 0) {
      throw new Error("No vision provider is available");
    }
    let lastError: unknown;
    for (const provider of candidates) {
      try {
        return await provider.verify(image, options);
      } catch (err) {
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
  }
}

let _visionRouter: VisionRouter | null = null;

export function getVisionRouter(): VisionRouter {
  if (!_visionRouter) {
    _visionRouter = new VisionRouter();
  }
  return _visionRouter;
}

/** @internal */
export function __resetVisionRouterForTests() {
  _visionRouter = null;
}
