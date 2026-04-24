export type SupportedAIProvider = "openrouter" | "zai" | "openai" | "local";
export interface AIProviderDefinition {
    id: SupportedAIProvider;
    apiKeyEnvVar?: string;
    baseUrl: string;
    defaultModel: string;
    label: string;
    models: string[];
}
export interface AIChatFeatureFlags {
    projectAssistant: boolean;
    taskSuggestions: boolean;
    riskAnalysis: boolean;
    budgetForecast: boolean;
}
export interface AIUsageTotals {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
}
export interface AIStoredConversationMessage {
    content: string;
    createdAt: string;
    id: string;
    model?: string | null;
    provider?: SupportedAIProvider | null;
    role: "assistant" | "system" | "user";
    usage?: AIUsageTotals | null;
}
export interface AIStoredConversation {
    conversationId: string;
    messages: AIStoredConversationMessage[];
    projectId: string | null;
    title: string;
    totals: AIUsageTotals;
    updatedAt: string;
    userId: string;
}
export interface AIProviderRegistryEntry {
    apiKeyMasked: string | null;
    baseUrl: string;
    defaultModel: string;
    enabled: boolean;
    hasApiKey: boolean;
    id: SupportedAIProvider;
    label: string;
    models: string[];
    priority: number;
    source: "database" | "default" | "environment";
}
export interface AIUserChatSettings {
    features: AIChatFeatureFlags;
    selectedModel: string;
    selectedProvider: SupportedAIProvider;
    updatedAt: string | null;
}
export interface AIWorkspaceUsageSummary {
    last24Hours: {
        costUsd: number;
        outputTokens: number;
        requestCount: number;
    };
    last7Days: {
        costUsd: number;
        outputTokens: number;
        requestCount: number;
    };
    providerBreakdown: Array<{
        costUsd: number;
        provider: string;
        requestCount: number;
    }>;
}
export interface AISettingsPayload {
    aiStatus: {
        gatewayAvailable: boolean;
        gatewayKind: "local" | "missing" | "remote";
        isProduction: boolean;
        mode: "gateway" | "mock" | "provider" | "unavailable";
        providerAvailable: boolean;
        unavailableReason: string | null;
    };
    providers: AIProviderRegistryEntry[];
    settings: AIUserChatSettings;
    usage: AIWorkspaceUsageSummary;
}
export declare const AI_PROVIDER_DEFINITIONS: Record<SupportedAIProvider, AIProviderDefinition>;
export declare const SUPPORTED_CHAT_PROVIDERS: readonly ["openrouter", "zai", "openai"];
export declare const DEFAULT_AI_CHAT_FEATURES: AIChatFeatureFlags;
export declare function createEmptyUsageTotals(): AIUsageTotals;
export declare function createEmptyUsageSummary(): AIWorkspaceUsageSummary;
export declare function getConversationId(projectId?: string | null): string;
export declare function getConversationMemoryKey(userId: string, conversationId: string): string;
export declare function getUserAISettingsMemoryKey(userId: string): string;
export declare function getDefaultSelectedProvider(providers: Array<Pick<AIProviderRegistryEntry, "enabled" | "hasApiKey" | "id">>): SupportedAIProvider;
export declare function getProviderDefinition(provider: SupportedAIProvider): AIProviderDefinition;
export declare function isSupportedAIProvider(value: unknown): value is SupportedAIProvider;
//# sourceMappingURL=chat-config.d.ts.map