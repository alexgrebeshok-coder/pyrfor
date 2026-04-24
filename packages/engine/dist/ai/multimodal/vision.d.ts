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
export type ImageSource = {
    kind: "url";
    url: string;
} | {
    kind: "base64";
    data: string;
    mimeType: string;
};
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
    confidence: number;
    reason: string;
    provider: string;
    model: string;
}
export interface VisionProvider {
    readonly name: string;
    isAvailable(): boolean;
    describe(image: ImageSource, options?: VisionDescribeOptions): Promise<VisionDescribeResult>;
    verify(image: ImageSource, options: VisionVerifyOptions): Promise<VisionVerifyResult>;
}
export declare class OpenAIVisionProvider implements VisionProvider {
    readonly name = "openai";
    private readonly apiKey;
    private readonly baseUrl;
    constructor(apiKey?: string, baseUrl?: string);
    isAvailable(): boolean;
    describe(image: ImageSource, options?: VisionDescribeOptions): Promise<VisionDescribeResult>;
    verify(image: ImageSource, options: VisionVerifyOptions): Promise<VisionVerifyResult>;
}
export declare class MockVisionProvider implements VisionProvider {
    readonly name = "mock";
    isAvailable(): boolean;
    describe(_image: ImageSource, options?: VisionDescribeOptions): Promise<VisionDescribeResult>;
    verify(_image: ImageSource, options: VisionVerifyOptions): Promise<VisionVerifyResult>;
}
export declare class VisionRouter {
    private readonly providers;
    constructor(providers?: VisionProvider[]);
    getAvailableProviders(): string[];
    private pickProvider;
    describe(image: ImageSource, options?: VisionDescribeOptions & {
        provider?: string;
    }): Promise<VisionDescribeResult>;
    verify(image: ImageSource, options: VisionVerifyOptions & {
        provider?: string;
    }): Promise<VisionVerifyResult>;
}
export declare function getVisionRouter(): VisionRouter;
/** @internal */
export declare function __resetVisionRouterForTests(): void;
//# sourceMappingURL=vision.d.ts.map