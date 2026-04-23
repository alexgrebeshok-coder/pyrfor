"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import type {
  AIProviderRegistryEntry,
  AIStoredConversation,
  AIStoredConversationMessage,
  AIUsageTotals,
  AIUserChatSettings,
  AIWorkspaceUsageSummary,
} from './chat-config';
import { getConversationId } from './chat-config';
import type { AIConfidenceSummary, AIEvidenceFact } from './types';

type ConversationKey = string;

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
  runPreset: (
    kind: "budgetForecast" | "riskAnalysis" | "taskSuggestions",
    target?: { id?: string | null; name?: string | null }
  ) => Promise<void>;
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
  openAssistant: (target?: { id?: string | null; name?: string | null }) => Promise<void>;
  usageSummary: AIWorkspaceUsageSummary;
}

interface AISettingsResponse {
  providers?: AIProviderRegistryEntry[];
  settings?: AIUserChatSettings;
  usage?: AIWorkspaceUsageSummary;
}

interface AIChatGetResponse {
  conversation?: AIStoredConversation | null;
}

interface AIStreamDonePayload {
  conversation?: AIStoredConversation;
  model?: string;
  provider?: string;
  response?: string;
  usage?: AIUsageTotals;
}

const AIContext = createContext<AIContextValue | null>(null);

function buildConversationTitle(target: AssistantTarget | null) {
  if (!target) {
    return "Portfolio";
  }

  return target.name;
}

function toClientConversationMessage(message: AIStoredConversationMessage): ClientConversationMessage {
  return {
    ...message,
  };
}

function toClientConversation(
  target: AssistantTarget | null,
  conversation?: AIStoredConversation | null
): ClientConversationState {
  return {
    conversationId:
      conversation?.conversationId ?? getConversationId(target?.id ?? null),
    projectId: conversation?.projectId ?? target?.id ?? null,
    title: conversation?.title ?? buildConversationTitle(target),
    updatedAt: conversation?.updatedAt ?? new Date().toISOString(),
    totals: conversation?.totals ?? {
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    },
    messages: conversation?.messages.map((message) => toClientConversationMessage(message)) ?? [],
  };
}

function parseSseEvent(raw: string) {
  const normalized = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");

  if (!normalized) {
    return null;
  }

  try {
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function streamChatResponse(
  response: Response,
  handlers: {
    onDone: (payload: AIStreamDonePayload) => void;
    onError: (message: string) => void;
    onToken: (token: string) => void;
  }
) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Empty AI stream response.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const payload = parseSseEvent(chunk);
      if (!payload) {
        continue;
      }

      if (payload.type === "token" && typeof payload.content === "string") {
        handlers.onToken(payload.content);
      }

      if (payload.type === "done") {
        handlers.onDone(payload as unknown as AIStreamDonePayload);
      }

      if (payload.type === "error" && typeof payload.message === "string") {
        handlers.onError(payload.message);
      }
    }
  }
}

function buildPresetPrompt(target: AssistantTarget | null, kind: "budgetForecast" | "riskAnalysis" | "taskSuggestions") {
  const subject = target?.id ? `the project "${target.name}"` : "the current portfolio";

  switch (kind) {
    case "taskSuggestions":
      return `Suggest the next 3 high-leverage tasks for ${subject}. Include the reason, suggested owner profile, and an actionable due-date window.`;
    case "riskAnalysis":
      return `Run a concise risk analysis for ${subject}. Identify the top risks, likely triggers, impact, and immediate mitigations.`;
    case "budgetForecast":
      return `Create a budget forecast for ${subject}. Explain expected variance, confidence level, and what actions would most improve the outcome.`;
    default:
      return `Analyze ${subject}.`;
  }
}

export function AIContextProvider({ children }: { children: ReactNode }) {
  const [providerRegistry, setProviderRegistry] = useState<AIProviderRegistryEntry[]>([]);
  const [settings, setSettings] = useState<AIUserChatSettings | null>(null);
  const [usageSummary, setUsageSummary] = useState<AIWorkspaceUsageSummary>({
    last24Hours: { requestCount: 0, outputTokens: 0, costUsd: 0 },
    last7Days: { requestCount: 0, outputTokens: 0, costUsd: 0 },
    providerBreakdown: [],
  });
  const [isReady, setIsReady] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [activeTarget, setActiveTarget] = useState<AssistantTarget | null>(null);
  const [conversationMap, setConversationMap] = useState<Record<ConversationKey, ClientConversationState>>({});

  const activeConversationKey = useMemo(
    () => getConversationId(activeTarget?.id ?? null),
    [activeTarget]
  );
  const activeConversation = conversationMap[activeConversationKey] ?? null;

  const hydrateSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/settings");
      if (!response.ok) {
        throw new Error("Failed to load AI settings.");
      }

      const payload = (await response.json()) as AISettingsResponse;
      setProviderRegistry(payload.providers ?? []);
      setSettings(payload.settings ?? null);
      if (payload.usage) {
        setUsageSummary(payload.usage);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load AI settings."
      );
    } finally {
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    void hydrateSettings();
  }, [hydrateSettings]);

  const saveSettings = useCallback(
    async (input: {
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
    }) => {
      setIsSavingSettings(true);

      try {
        const response = await fetch("/api/ai/settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          throw new Error("Failed to save AI settings.");
        }

        const payload = (await response.json()) as AISettingsResponse;
        setProviderRegistry(payload.providers ?? []);
        setSettings(payload.settings ?? null);
        if (payload.usage) {
          setUsageSummary(payload.usage);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to save AI settings."
        );
        throw error;
      } finally {
        setIsSavingSettings(false);
      }
    },
    []
  );

  const openAssistant = useCallback(
    async (target?: { id?: string | null; name?: string | null }) => {
      const nextTarget: AssistantTarget = {
        id: target?.id ?? null,
        name: target?.name?.trim() || "Portfolio",
      };
      const conversationId = getConversationId(nextTarget.id);

      setActiveTarget(nextTarget);
      setIsAssistantOpen(true);

      if (conversationMap[conversationId]) {
        return;
      }

      try {
        const params = new URLSearchParams({
          conversationId,
        });

        if (nextTarget.id) {
          params.set("projectId", nextTarget.id);
        }

        const response = await fetch(`/api/ai/chat?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Failed to load AI conversation.");
        }

        const payload = (await response.json()) as AIChatGetResponse;
        setConversationMap((current) => ({
          ...current,
          [conversationId]: toClientConversation(nextTarget, payload.conversation),
        }));
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to load AI conversation."
        );
      }
    },
    [conversationMap]
  );

  const closeAssistant = useCallback(() => {
    setIsAssistantOpen(false);
  }, []);

  const sendMessageToTarget = useCallback(
    async (content: string, targetOverride?: AssistantTarget | null) => {
      if (!content.trim() || !settings || isSending) {
        return;
      }

      const target = targetOverride ?? activeTarget ?? { id: null, name: "Portfolio" };
      const conversationId = getConversationId(target.id);
      const timestamp = new Date().toISOString();
      const userMessage: ClientConversationMessage = {
        id: `user-${timestamp}`,
        role: "user",
        content: content.trim(),
        createdAt: timestamp,
        provider: null,
        model: null,
        usage: null,
      };
      const assistantMessageId = `assistant-${timestamp}`;

      setConversationMap((current) => {
        const existing = current[conversationId] ?? toClientConversation(target, null);
        return {
          ...current,
          [conversationId]: {
            ...existing,
            updatedAt: timestamp,
            messages: [
              ...existing.messages,
              userMessage,
              {
                id: assistantMessageId,
                role: "assistant",
                content: "",
                createdAt: timestamp,
                provider: settings.selectedProvider,
                model: settings.selectedModel,
                usage: null,
                pending: true,
              },
            ],
          },
        };
      });

      setIsSending(true);

      try {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: content.trim(),
            projectId: target.id,
            conversationId,
            provider: settings.selectedProvider,
            model: settings.selectedModel,
            stream: true,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Failed to send AI message.");
        }

        await streamChatResponse(response, {
          onToken: (token) => {
            setConversationMap((current) => {
              const existing = current[conversationId] ?? toClientConversation(target, null);
              return {
                ...current,
                [conversationId]: {
                  ...existing,
                  messages: existing.messages.map((message) =>
                    message.id === assistantMessageId
                      ? {
                          ...message,
                          content: `${message.content}${token}`,
                        }
                      : message
                  ),
                },
              };
            });
          },
          onDone: (payload) => {
            setConversationMap((current) => ({
              ...current,
              [conversationId]: toClientConversation(target, payload.conversation ?? null),
            }));
            if (payload.conversation?.totals) {
              setUsageSummary((current) => ({
                ...current,
                last24Hours: {
                  ...current.last24Hours,
                  requestCount: current.last24Hours.requestCount + 1,
                  outputTokens:
                    current.last24Hours.outputTokens +
                    (payload.usage?.outputTokens ?? 0),
                  costUsd:
                    current.last24Hours.costUsd +
                    (payload.usage?.estimatedCostUsd ?? 0),
                },
                last7Days: {
                  ...current.last7Days,
                  requestCount: current.last7Days.requestCount + 1,
                  outputTokens:
                    current.last7Days.outputTokens +
                    (payload.usage?.outputTokens ?? 0),
                  costUsd:
                    current.last7Days.costUsd +
                    (payload.usage?.estimatedCostUsd ?? 0),
                },
              }));
            }
          },
          onError: (message) => {
            setConversationMap((current) => {
              const existing = current[conversationId] ?? toClientConversation(target, null);
              return {
                ...current,
                [conversationId]: {
                  ...existing,
                  messages: existing.messages.map((item) =>
                    item.id === assistantMessageId
                      ? {
                          ...item,
                          content: message,
                          pending: false,
                        }
                      : item
                  ),
                },
              };
            });
            throw new Error(message);
          },
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to send AI message."
        );
      } finally {
        setIsSending(false);
      }
    },
    [activeTarget, isSending, settings]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      await sendMessageToTarget(content);
    },
    [sendMessageToTarget]
  );

  const setSelectedProvider = useCallback(
    async (provider: AIUserChatSettings["selectedProvider"]) => {
      await saveSettings({
        selectedProvider: provider,
      });
    },
    [saveSettings]
  );

  const setSelectedModel = useCallback(
    async (model: string) => {
      await saveSettings({
        selectedModel: model,
      });
    },
    [saveSettings]
  );

  const runPreset = useCallback(
    async (
      kind: "budgetForecast" | "riskAnalysis" | "taskSuggestions",
      target?: { id?: string | null; name?: string | null }
    ) => {
      const resolvedTarget = target
        ? {
            id: target.id ?? null,
            name: target.name?.trim() || "Portfolio",
          }
        : activeTarget;

      await sendMessageToTarget(buildPresetPrompt(resolvedTarget ?? null, kind), resolvedTarget);
    },
    [activeTarget, sendMessageToTarget]
  );

  const value = useMemo<AIContextValue>(
    () => ({
      providerRegistry,
      selectedProvider: settings?.selectedProvider ?? "openrouter",
      selectedModel: settings?.selectedModel ?? "",
      features: settings?.features ?? {
        projectAssistant: true,
        taskSuggestions: true,
        riskAnalysis: true,
        budgetForecast: true,
      },
      usageSummary,
      isReady,
      isSavingSettings,
      isSending,
      activeTarget,
      activeConversation,
      isAssistantOpen,
      saveSettings,
      setSelectedProvider,
      setSelectedModel,
      openAssistant,
      closeAssistant,
      sendMessage,
      runPreset,
    }),
    [
      activeConversation,
      activeTarget,
      closeAssistant,
      isAssistantOpen,
      isReady,
      isSavingSettings,
      isSending,
      openAssistant,
      providerRegistry,
      runPreset,
      saveSettings,
      sendMessage,
      setSelectedModel,
      setSelectedProvider,
      settings,
      usageSummary,
    ]
  );

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

export function useAIContext() {
  const context = useContext(AIContext);
  if (!context) {
    throw new Error("useAIContext must be used within AIContextProvider");
  }

  return context;
}
