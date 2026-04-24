export const AI_PROVIDER_DEFINITIONS = {
    local: {
        id: "local",
        label: "Local",
        baseUrl: "http://localhost:8000/v1/chat/completions",
        defaultModel: "v11",
        models: ["v11", "v10"],
    },
    openai: {
        id: "openai",
        label: "OpenAI",
        apiKeyEnvVar: "OPENAI_API_KEY",
        baseUrl: "https://api.openai.com/v1/chat/completions",
        defaultModel: "gpt-5.2",
        models: ["gpt-5.2", "gpt-5.1", "gpt-4o"],
    },
    openrouter: {
        id: "openrouter",
        label: "OpenRouter",
        apiKeyEnvVar: "OPENROUTER_API_KEY",
        baseUrl: "https://openrouter.ai/api/v1/chat/completions",
        defaultModel: "openai/gpt-4o-mini",
        models: [
            "openai/gpt-4o-mini",
            "google/gemma-3-27b-it:free",
            "google/gemma-3-12b-it:free",
            "google/gemma-3-4b-it:free",
        ],
    },
    zai: {
        id: "zai",
        label: "ZAI",
        apiKeyEnvVar: "ZAI_API_KEY",
        baseUrl: "https://api.z.ai/api/coding/paas/v4/chat/completions",
        defaultModel: "glm-5",
        models: ["glm-5", "glm-4.7", "glm-4.7-flash"],
    },
};
export const SUPPORTED_CHAT_PROVIDERS = ["openrouter", "zai", "openai"];
export const DEFAULT_AI_CHAT_FEATURES = {
    projectAssistant: true,
    taskSuggestions: true,
    riskAnalysis: true,
    budgetForecast: true,
};
export function createEmptyUsageTotals() {
    return {
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
    };
}
export function createEmptyUsageSummary() {
    return {
        last24Hours: {
            requestCount: 0,
            outputTokens: 0,
            costUsd: 0,
        },
        last7Days: {
            requestCount: 0,
            outputTokens: 0,
            costUsd: 0,
        },
        providerBreakdown: [],
    };
}
export function getConversationId(projectId) {
    return projectId ? `project:${projectId}` : "portfolio";
}
export function getConversationMemoryKey(userId, conversationId) {
    return `ai:conversation:${userId}:${conversationId}`;
}
export function getUserAISettingsMemoryKey(userId) {
    return `ai:user-settings:${userId}`;
}
export function getDefaultSelectedProvider(providers) {
    var _a;
    const firstConfiguredProvider = providers.find((provider) => provider.id !== "local" && provider.enabled && provider.hasApiKey);
    return (_a = firstConfiguredProvider === null || firstConfiguredProvider === void 0 ? void 0 : firstConfiguredProvider.id) !== null && _a !== void 0 ? _a : "openrouter";
}
export function getProviderDefinition(provider) {
    return AI_PROVIDER_DEFINITIONS[provider];
}
export function isSupportedAIProvider(value) {
    return typeof value === "string" && value in AI_PROVIDER_DEFINITIONS;
}
