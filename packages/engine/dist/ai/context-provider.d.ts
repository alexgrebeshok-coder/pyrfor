import { type ReactNode } from "react";
import type { AIProviderRegistryEntry, AIStoredConversationMessage, AIUsageTotals, AIUserChatSettings, AIWorkspaceUsageSummary } from './chat-config';
import type { AIConfidenceSummary, AIEvidenceFact } from './types';
interface ClientConversationMessage extends AIStoredConversationMessage {
    confidence?: AIConfidenceSummary;
    facts?: AIEvidenceFact[];
    pending?: boolean;
}
interface ClientConversationState {
    conversationId: string;
    messages: ClientConversationMessage[];
    projectId: string | null;
    title: string;
    totals: AIUsageTotals;
    updatedAt: string;
}
interface AssistantTarget {
    id: string | null;
    name: string;
}
interface AIContextValue {
    activeConversation: ClientConversationState | null;
    activeTarget: AssistantTarget | null;
    closeAssistant: () => void;
    features: AIUserChatSettings["features"];
    isAssistantOpen: boolean;
    isReady: boolean;
    isSavingSettings: boolean;
    isSending: boolean;
    providerRegistry: AIProviderRegistryEntry[];
    runPreset: (kind: "budgetForecast" | "riskAnalysis" | "taskSuggestions", target?: {
        id?: string | null;
        name?: string | null;
    }) => Promise<void>;
    saveSettings: (input: {
        features?: Partial<AIUserChatSettings["features"]>;
        providers?: Array<{
            apiKey?: string;
            baseUrl?: string;
            defaultModel?: string;
            enabled?: boolean;
            id: "openai" | "openrouter" | "zai";
            models?: string[];
        }>;
        selectedModel?: string;
        selectedProvider?: AIUserChatSettings["selectedProvider"];
    }) => Promise<void>;
    selectedModel: string;
    selectedProvider: AIUserChatSettings["selectedProvider"];
    sendMessage: (content: string) => Promise<void>;
    setSelectedModel: (model: string) => Promise<void>;
    setSelectedProvider: (provider: AIUserChatSettings["selectedProvider"]) => Promise<void>;
    openAssistant: (target?: {
        id?: string | null;
        name?: string | null;
    }) => Promise<void>;
    usageSummary: AIWorkspaceUsageSummary;
}
export declare function AIContextProvider({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
export declare function useAIContext(): AIContextValue;
export {};
//# sourceMappingURL=context-provider.d.ts.map