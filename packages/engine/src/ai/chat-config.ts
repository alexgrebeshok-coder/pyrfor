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

export const AI_PROVIDER_DEFINITIONS: Record<SupportedAIProvider, AIProviderDefinition> = {
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

export const SUPPORTED_CHAT_PROVIDERS = ["openrouter", "zai", "openai"] as const;

export const DEFAULT_AI_CHAT_FEATURES: AIChatFeatureFlags = {
  projectAssistant: true,
  taskSuggestions: true,
  riskAnalysis: true,
  budgetForecast: true,
};

export function createEmptyUsageTotals(): AIUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
}

export function createEmptyUsageSummary(): AIWorkspaceUsageSummary {
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

export function getConversationId(projectId?: string | null) {
  return projectId ? `project:${projectId}` : "portfolio";
}

export function getConversationMemoryKey(userId: string, conversationId: string) {
  return `ai:conversation:${userId}:${conversationId}`;
}

export function getUserAISettingsMemoryKey(userId: string) {
  return `ai:user-settings:${userId}`;
}

export function getDefaultSelectedProvider(
  providers: Array<Pick<AIProviderRegistryEntry, "enabled" | "hasApiKey" | "id">>
): SupportedAIProvider {
  const firstConfiguredProvider = providers.find(
    (provider) => provider.id !== "local" && provider.enabled && provider.hasApiKey
  );

  return firstConfiguredProvider?.id ?? "openrouter";
}

export function getProviderDefinition(provider: SupportedAIProvider) {
  return AI_PROVIDER_DEFINITIONS[provider];
}

export function isSupportedAIProvider(value: unknown): value is SupportedAIProvider {
  return typeof value === "string" && value in AI_PROVIDER_DEFINITIONS;
}
