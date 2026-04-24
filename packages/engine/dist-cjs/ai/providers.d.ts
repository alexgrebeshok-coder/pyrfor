/**
 * AI Providers - Multi-provider support
 * OpenRouter + ZAI + OpenAI
 */
import "server-only";
/**
 * Identify errors that should trigger AIRouter cross-provider fallback
 * instead of bubbling up to the caller. Covers:
 *  - explicit provider-level failures ("API error", "not set", "not available")
 *  - network/DNS/socket errors (ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, socket hang up)
 *  - timeouts and aborts
 *  - 5xx-class error messages surfaced by providers
 *  - anything tagged with `transient: true` (see OpenRouter httpsPost)
 */
export declare function isTransientProviderError(err: unknown): boolean;
export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
}
/**
 * OpenAI-compatible tool definition used for native function-calling paths.
 * Shape matches `lib/ai/tools.ts#AIToolDefinition` so providers can forward
 * it verbatim into their request body.
 */
export interface ProviderToolDefinition {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
export interface ProviderToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}
export interface ChatWithToolsOptions extends ChatOptions {
    tools: readonly ProviderToolDefinition[];
    toolChoice?: "auto" | "required" | "none";
}
export interface ChatWithToolsResult {
    /** Assistant content — may be empty when the model only emitted tool calls. */
    content: string;
    /** Structured tool calls extracted from the provider's native response. */
    toolCalls: ProviderToolCall[];
    /** Convenience flag indicating whether any tool calls were produced. */
    hasToolCalls: boolean;
    /** Model actually used (providers may fall back inside the provider). */
    model: string;
    /** finish_reason surfaced by the provider, if any. */
    finishReason?: string;
}
export interface AIProvider {
    name: string;
    models: string[];
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    chatStream?(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
    /**
     * Optional native tool-calling path. Providers that implement this return
     * structured tool calls from the model's response, avoiding brittle
     * text/JSON parsing. Providers without function-calling capability should
     * simply not implement this method — callers can fall back to `.chat()`
     * and parse tool calls from the string.
     */
    chatWithTools?(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult>;
    /**
     * Whether this provider supports native tool calling. Used by the router
     * to decide which provider to route a tool-enabled request to first.
     */
    supportsToolCalls?: boolean;
}
export declare class OpenRouterProvider implements AIProvider {
    name: string;
    models: string[];
    /** Models on OpenRouter that reliably support OpenAI-compatible tool calls. */
    private readonly toolCapableModels;
    supportsToolCalls: boolean;
    private apiKey;
    constructor(apiKey?: string);
    /**
     * Low-level POST using Node's https module to avoid undici/IPv6 DNS issues
     * inside Next.js. Returns the structured response directly so callers
     * don't pay a JSON stringify/parse round-trip.
     *
     * Network failures (ECONNRESET, ETIMEDOUT, socket hang up, DNS errors) are
     * reject()ed with the original error message preserved so the AIRouter
     * fallback chain can recognise them as transient provider failures.
     */
    private httpsPost;
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    /**
     * Native OpenAI-compatible tool-calling path. Forwards the model-provided
     * `tools` array and returns structured tool calls instead of asking the
     * caller to parse JSON out of free text.
     *
     * Falls back across tool-capable models only — if the preferred model is
     * not in `toolCapableModels`, we prefer `openai/gpt-4o-mini` which is the
     * cheapest reliable OpenRouter tool-calling model at time of writing.
     */
    chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult>;
    /** Stream tokens from OpenRouter as an async generator */
    chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
    /** Inner streaming method for a single model (used by chatStream fallback) */
    private _streamModel;
    /** Merge system messages into the first user message for models that don't support system role */
    private mergeSystemIntoUser;
}
export declare class ZAIProvider implements AIProvider {
    name: string;
    models: string[];
    supportsToolCalls: boolean;
    private readonly toolCapableModels;
    private apiKey;
    private baseUrl;
    constructor(apiKey?: string);
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult>;
}
export declare class OpenAIProvider implements AIProvider {
    name: string;
    models: string[];
    supportsToolCalls: boolean;
    private readonly toolCapableModels;
    private apiKey;
    private baseUrl;
    constructor(apiKey?: string);
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult>;
}
export declare class AIJoraProvider implements AIProvider {
    name: string;
    models: string[];
    supportsToolCalls: boolean;
    private readonly toolCapableModels;
    private apiKey;
    private baseUrl;
    constructor(apiKey?: string);
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult>;
}
export declare class PolzaProvider implements AIProvider {
    name: string;
    models: string[];
    supportsToolCalls: boolean;
    private readonly toolCapableModels;
    private apiKey;
    private baseUrl;
    constructor(apiKey?: string);
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult>;
}
export declare class BothubProvider implements AIProvider {
    name: string;
    models: string[];
    supportsToolCalls: boolean;
    private readonly toolCapableModels;
    private apiKey;
    private baseUrl;
    constructor(apiKey?: string);
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult>;
}
export declare class GigaChatProvider implements AIProvider {
    name: string;
    models: string[];
    /**
     * Models with native function/tool calling. Sber's `functions` API is
     * compatible with the pre-`tools` OpenAI format; we map it to our
     * ChatWithToolsResult in `chatWithTools`.
     */
    supportsToolCalls: boolean;
    private readonly toolCapableModels;
    private clientId;
    private clientSecret;
    private accessToken;
    private tokenExpiresAt;
    private tokenRefreshPromise;
    constructor(clientId?: string, clientSecret?: string);
    private getToken;
    private refreshToken;
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    /**
     * Native tool calling via Sber's `functions` API. Response shape matches
     * the legacy OpenAI `function_call` format: the assistant message has a
     * `function_call: { name, arguments }` field when the model decided to
     * invoke a tool. We normalise it into a single-element `toolCalls` array
     * for parity with OpenAI-compatible providers.
     *
     * Runtime note: Sber endpoints use a Russian Trusted Root CA that isn't
     * in Node's default trust store. To keep this method testable via
     * `fetch`/`undici`, we rely on the standard runtime. Deployments must
     * either (a) set `NODE_EXTRA_CA_CERTS=/path/to/russian_trusted_root.pem`,
     * or (b) route GigaChat through a trusted proxy. The legacy `chat()`
     * method above uses `rejectUnauthorized: false` for convenience; once
     * the CA is installed we can migrate it to `fetch` as well.
     */
    chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult>;
}
export declare class YandexGPTProvider implements AIProvider {
    name: string;
    models: string[];
    /**
     * Yandex Foundation Models supports function calling on the flagship
     * `yandexgpt` model. The response shape differs from OpenAI (see
     * `chatWithTools`), so we normalise it to `ChatWithToolsResult`.
     */
    supportsToolCalls: boolean;
    private readonly toolCapableModels;
    private apiKey;
    private folderId;
    constructor(apiKey?: string, folderId?: string);
    chat(messages: Message[], options?: ChatOptions): Promise<string>;
    /**
     * Native function calling for YandexGPT 5+. The Yandex API uses `text`
     * instead of OpenAI's `content`, and returns tool calls via
     * `message.toolCallList.toolCalls[].functionCall` where `arguments`
     * is an object (not a string). We normalise everything into
     * `ChatWithToolsResult` for parity with OpenAI-compatible providers.
     */
    chatWithTools(messages: Message[], options: ChatWithToolsOptions): Promise<ChatWithToolsResult>;
}
export declare class AIRouter {
    private providers;
    private defaultProvider;
    private providerPriority;
    constructor();
    /**
     * Chat with AI — with circuit breaker protection and cross-provider fallback.
     *
     * If the requested provider's circuit is open or the call fails, automatically
     * tries the next provider in priority order. Tracks cost for every successful call.
     */
    chat(messages: Message[], options?: {
        provider?: string;
        model?: string;
        agentId?: string;
        runId?: string;
        workspaceId?: string;
    }): Promise<string>;
    /**
     * Tool-aware chat — routes to the first provider that supports native
     * function calling (`provider.chatWithTools`) with circuit breaker and
     * cross-provider fallback. If no tool-capable provider is available (or
     * they all fail transiently), degrades gracefully by calling `.chat()` on
     * the regular provider chain and returning content with `toolCalls: []`
     * so the caller can fall back to text-level JSON parsing.
     */
    chatWithTools(messages: Message[], options: {
        provider?: string;
        model?: string;
        agentId?: string;
        runId?: string;
        workspaceId?: string;
        temperature?: number;
        maxTokens?: number;
        tools: readonly ProviderToolDefinition[];
        toolChoice?: "auto" | "required" | "none";
    }): Promise<ChatWithToolsResult>;
    /** Does any registered provider advertise native tool-call support? */
    hasToolCapableProvider(): boolean;
    /**
     * Build ordered fallback chain starting from the requested provider,
     * followed by all remaining providers in priority order.
     */
    private buildFallbackChain;
    /**
     * Like buildFallbackChain but filtered to providers that expose
     * chatWithTools / supportsToolCalls. The requested provider is kept first
     * if capable; otherwise skipped.
     */
    private buildToolFallbackChain;
    /**
     * Get available providers
     */
    getAvailableProviders(): string[];
    /**
     * Get available models
     */
    getAvailableModels(): {
        provider: string;
        model: string;
    }[];
    /**
     * Get provider instance (for streaming or direct access)
     */
    getProviderInstance(providerName?: string): AIProvider;
    /**
     * Get first provider that supports streaming (chatStream method)
     * Priority: openrouter > aijora > polza > any
     */
    getStreamingProvider(preferredName?: string): AIProvider | null;
    /**
     * Check if provider is available
     */
    hasProvider(name: string): boolean;
}
export declare function getRouter(): AIRouter;
/**
 * Check if any AI provider is available
 */
export declare function hasAvailableProvider(): Promise<boolean>;
/**
 * Get the default provider name
 */
export declare function getProviderName(): string | null;
export declare const aiRouter: AIRouter;
//# sourceMappingURL=providers.d.ts.map