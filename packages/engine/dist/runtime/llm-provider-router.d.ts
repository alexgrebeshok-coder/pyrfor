/**
 * llm-provider-router.ts — Pyrfor intelligent LLM provider router.
 *
 * Smart multi-provider LLM router featuring:
 *   - Rolling-window health tracking (success rate + avg latency per provider)
 *   - Circuit breaker: N consecutive failures → open for cooldownMs
 *   - Half-open probing: one trial after cooldown; success closes, failure re-opens
 *   - Capability-based provider filtering (chat/tools/vision/audio/embedding)
 *   - Cost-aware sorting: preferCheapFor='simple' selects cheapest provider first
 *   - Concurrency caps: maxConcurrent skips saturated providers
 *   - AbortSignal propagation; abort errors are not counted as health failures
 *   - Event system: callStart / callEnd / callError / circuitOpen / circuitClose
 *   - External health recording for out-of-band calls
 *
 * Pure TS, ESM-only, no external dependencies.
 */
export type ProviderId = string;
export type Capability = 'chat' | 'tools' | 'vision' | 'audio' | 'embedding';
export type ProviderConfig = {
    id: ProviderId;
    /** Relative preference weight (default 1). Higher = preferred in health ranking. */
    weight?: number;
    /** Cost per 1 000 tokens. Used for cost-aware sorting when preferCheapFor='simple'. */
    costPerKToken?: number;
    /** Modalities supported. If omitted, provider matches all requests with no `needs`. */
    capabilities?: Capability[];
    /** Maximum simultaneous in-flight calls. Undefined = unlimited. */
    maxConcurrent?: number;
    /** The actual LLM call implementation. */
    call: (req: LlmRequest) => Promise<LlmResponse>;
};
export type LlmRequest = {
    messages: {
        role: string;
        content: any;
    }[];
    tools?: any[];
    /** Required capabilities. Only providers supporting ALL listed caps are tried. */
    needs?: Capability[];
    maxTokens?: number;
    temperature?: number;
    /**
     * 'simple'  → sort by costPerKToken ascending (cheapest first).
     * 'complex' → health-based ranking (no cost optimisation).
     */
    preferCheapFor?: 'simple' | 'complex';
    signal?: AbortSignal;
};
export type LlmResponse = {
    provider: ProviderId;
    text: string;
    toolCalls?: any[];
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
    };
    latencyMs: number;
};
export type ProviderStatus = {
    id: ProviderId;
    /** False when the circuit is open (provider currently in cooldown). */
    healthy: boolean;
    /** Epoch ms until which the circuit remains open. Only present when > 0. */
    circuitOpenUntil?: number;
    successRate: number;
    avgLatencyMs: number;
    activeCalls: number;
};
export type RouterEvent = 'callStart' | 'callEnd' | 'callError' | 'circuitOpen' | 'circuitClose';
export type RouterEventCallback = (meta: any) => void;
export interface RouterOptions {
    /** Size of the rolling health window (default 50). */
    healthWindow?: number;
    /** Consecutive failures before opening circuit (default 5). */
    circuitFailures?: number;
    /** How long the circuit stays open in ms (default 30 000). */
    circuitCooldownMs?: number;
    /** Custom clock for deterministic testing. Defaults to Date.now. */
    clock?: () => number;
    /** Optional structured logger. */
    logger?: (msg: string, meta?: any) => void;
}
export interface LlmProviderRouter {
    register(cfg: ProviderConfig): void;
    unregister(id: ProviderId): void;
    listProviders(): ProviderStatus[];
    call(req: LlmRequest, opts?: {
        order?: ProviderId[];
        maxAttempts?: number;
    }): Promise<LlmResponse>;
    recordExternal(providerId: ProviderId, ok: boolean, latencyMs: number): void;
    resetHealth(providerId?: ProviderId): void;
    on(event: RouterEvent, cb: RouterEventCallback): () => void;
}
export declare function createProviderRouter(opts?: RouterOptions): LlmProviderRouter;
//# sourceMappingURL=llm-provider-router.d.ts.map