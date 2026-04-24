"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIContextProvider = AIContextProvider;
exports.useAIContext = useAIContext;
const react_1 = require("react");
const sonner_1 = require("sonner");
const chat_config_1 = require("./chat-config");
const AIContext = (0, react_1.createContext)(null);
function buildConversationTitle(target) {
    if (!target) {
        return "Portfolio";
    }
    return target.name;
}
function toClientConversationMessage(message) {
    return {
        ...message,
    };
}
function toClientConversation(target, conversation) {
    return {
        conversationId: conversation?.conversationId ?? (0, chat_config_1.getConversationId)(target?.id ?? null),
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
function parseSseEvent(raw) {
    const normalized = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
    if (!normalized) {
        return null;
    }
    try {
        return JSON.parse(normalized);
    }
    catch {
        return null;
    }
}
async function streamChatResponse(response, handlers) {
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
                handlers.onDone(payload);
            }
            if (payload.type === "error" && typeof payload.message === "string") {
                handlers.onError(payload.message);
            }
        }
    }
}
function buildPresetPrompt(target, kind) {
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
function AIContextProvider({ children }) {
    const [providerRegistry, setProviderRegistry] = (0, react_1.useState)([]);
    const [settings, setSettings] = (0, react_1.useState)(null);
    const [usageSummary, setUsageSummary] = (0, react_1.useState)({
        last24Hours: { requestCount: 0, outputTokens: 0, costUsd: 0 },
        last7Days: { requestCount: 0, outputTokens: 0, costUsd: 0 },
        providerBreakdown: [],
    });
    const [isReady, setIsReady] = (0, react_1.useState)(false);
    const [isSavingSettings, setIsSavingSettings] = (0, react_1.useState)(false);
    const [isSending, setIsSending] = (0, react_1.useState)(false);
    const [isAssistantOpen, setIsAssistantOpen] = (0, react_1.useState)(false);
    const [activeTarget, setActiveTarget] = (0, react_1.useState)(null);
    const [conversationMap, setConversationMap] = (0, react_1.useState)({});
    const activeConversationKey = (0, react_1.useMemo)(() => (0, chat_config_1.getConversationId)(activeTarget?.id ?? null), [activeTarget]);
    const activeConversation = conversationMap[activeConversationKey] ?? null;
    const hydrateSettings = (0, react_1.useCallback)(async () => {
        try {
            const response = await fetch("/api/ai/settings");
            if (!response.ok) {
                throw new Error("Failed to load AI settings.");
            }
            const payload = (await response.json());
            setProviderRegistry(payload.providers ?? []);
            setSettings(payload.settings ?? null);
            if (payload.usage) {
                setUsageSummary(payload.usage);
            }
        }
        catch (error) {
            sonner_1.toast.error(error instanceof Error ? error.message : "Failed to load AI settings.");
        }
        finally {
            setIsReady(true);
        }
    }, []);
    (0, react_1.useEffect)(() => {
        void hydrateSettings();
    }, [hydrateSettings]);
    const saveSettings = (0, react_1.useCallback)(async (input) => {
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
            const payload = (await response.json());
            setProviderRegistry(payload.providers ?? []);
            setSettings(payload.settings ?? null);
            if (payload.usage) {
                setUsageSummary(payload.usage);
            }
        }
        catch (error) {
            sonner_1.toast.error(error instanceof Error ? error.message : "Failed to save AI settings.");
            throw error;
        }
        finally {
            setIsSavingSettings(false);
        }
    }, []);
    const openAssistant = (0, react_1.useCallback)(async (target) => {
        const nextTarget = {
            id: target?.id ?? null,
            name: target?.name?.trim() || "Portfolio",
        };
        const conversationId = (0, chat_config_1.getConversationId)(nextTarget.id);
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
            const payload = (await response.json());
            setConversationMap((current) => ({
                ...current,
                [conversationId]: toClientConversation(nextTarget, payload.conversation),
            }));
        }
        catch (error) {
            sonner_1.toast.error(error instanceof Error ? error.message : "Failed to load AI conversation.");
        }
    }, [conversationMap]);
    const closeAssistant = (0, react_1.useCallback)(() => {
        setIsAssistantOpen(false);
    }, []);
    const sendMessageToTarget = (0, react_1.useCallback)(async (content, targetOverride) => {
        if (!content.trim() || !settings || isSending) {
            return;
        }
        const target = targetOverride ?? activeTarget ?? { id: null, name: "Portfolio" };
        const conversationId = (0, chat_config_1.getConversationId)(target.id);
        const timestamp = new Date().toISOString();
        const userMessage = {
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
                const payload = (await response.json().catch(() => null));
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
                                messages: existing.messages.map((message) => message.id === assistantMessageId
                                    ? {
                                        ...message,
                                        content: `${message.content}${token}`,
                                    }
                                    : message),
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
                                outputTokens: current.last24Hours.outputTokens +
                                    (payload.usage?.outputTokens ?? 0),
                                costUsd: current.last24Hours.costUsd +
                                    (payload.usage?.estimatedCostUsd ?? 0),
                            },
                            last7Days: {
                                ...current.last7Days,
                                requestCount: current.last7Days.requestCount + 1,
                                outputTokens: current.last7Days.outputTokens +
                                    (payload.usage?.outputTokens ?? 0),
                                costUsd: current.last7Days.costUsd +
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
                                messages: existing.messages.map((item) => item.id === assistantMessageId
                                    ? {
                                        ...item,
                                        content: message,
                                        pending: false,
                                    }
                                    : item),
                            },
                        };
                    });
                    throw new Error(message);
                },
            });
        }
        catch (error) {
            sonner_1.toast.error(error instanceof Error ? error.message : "Failed to send AI message.");
        }
        finally {
            setIsSending(false);
        }
    }, [activeTarget, isSending, settings]);
    const sendMessage = (0, react_1.useCallback)(async (content) => {
        await sendMessageToTarget(content);
    }, [sendMessageToTarget]);
    const setSelectedProvider = (0, react_1.useCallback)(async (provider) => {
        await saveSettings({
            selectedProvider: provider,
        });
    }, [saveSettings]);
    const setSelectedModel = (0, react_1.useCallback)(async (model) => {
        await saveSettings({
            selectedModel: model,
        });
    }, [saveSettings]);
    const runPreset = (0, react_1.useCallback)(async (kind, target) => {
        const resolvedTarget = target
            ? {
                id: target.id ?? null,
                name: target.name?.trim() || "Portfolio",
            }
            : activeTarget;
        await sendMessageToTarget(buildPresetPrompt(resolvedTarget ?? null, kind), resolvedTarget);
    }, [activeTarget, sendMessageToTarget]);
    const value = (0, react_1.useMemo)(() => ({
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
    }), [
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
    ]);
    return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}
function useAIContext() {
    const context = (0, react_1.useContext)(AIContext);
    if (!context) {
        throw new Error("useAIContext must be used within AIContextProvider");
    }
    return context;
}
