import "server-only";
import { type AISettingsPayload, type AIStoredConversation, type AIUserChatSettings, type SupportedAIProvider } from './chat-config';
export declare function getAIProviderRegistry(): Promise<{
    id: "openai" | "openrouter" | "zai";
    label: string;
    enabled: boolean;
    hasApiKey: boolean;
    apiKeyMasked: string | null;
    baseUrl: string;
    defaultModel: string;
    models: string[];
    priority: number;
    source: "default" | "database" | "environment";
}[]>;
export declare function resolveChatProviderConfig(providerId: SupportedAIProvider): Promise<{
    id: "local";
    apiKey: null;
    baseUrl: string;
    defaultModel: string;
    enabled: boolean;
    models: string[];
} | {
    id: "openai" | "openrouter" | "zai";
    apiKey: string | null;
    baseUrl: string;
    defaultModel: string;
    enabled: boolean;
    models: string[];
}>;
export declare function getUserAISettings(userId: string): Promise<AIUserChatSettings>;
export declare function saveUserAISettings(userId: string, input: {
    features?: Partial<AIUserChatSettings["features"]>;
    selectedModel?: string;
    selectedProvider?: AIUserChatSettings["selectedProvider"];
}): Promise<AIUserChatSettings>;
export declare function saveAIProviderSettings(providers: Array<{
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
    enabled?: boolean;
    id: Exclude<SupportedAIProvider, "local">;
    models?: string[];
}>): Promise<void>;
export declare function getWorkspaceAIUsageSummary(workspaceId: string): Promise<import("./chat-config").AIWorkspaceUsageSummary>;
export declare function getAISettingsPayload(userId: string, workspaceId: string): Promise<AISettingsPayload>;
export declare function loadConversation(userId: string, projectId?: string | null, conversationId?: string | null): Promise<AIStoredConversation>;
export declare function appendConversationTurn(input: {
    assistantContent: string;
    conversationId: string;
    inputTokens: number;
    model: string;
    outputTokens: number;
    projectId?: string | null;
    provider: SupportedAIProvider;
    userContent: string;
    userId: string;
}): Promise<AIStoredConversation>;
//# sourceMappingURL=chat-store.d.ts.map