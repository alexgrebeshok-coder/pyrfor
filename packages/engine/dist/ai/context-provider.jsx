"use client";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createContext, useCallback, useContext, useEffect, useMemo, useState, } from "react";
import { toast } from "sonner";
import { getConversationId } from './chat-config';
const AIContext = createContext(null);
function buildConversationTitle(target) {
    if (!target) {
        return "Portfolio";
    }
    return target.name;
}
function toClientConversationMessage(message) {
    return Object.assign({}, message);
}
function toClientConversation(target, conversation) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return {
        conversationId: (_a = conversation === null || conversation === void 0 ? void 0 : conversation.conversationId) !== null && _a !== void 0 ? _a : getConversationId((_b = target === null || target === void 0 ? void 0 : target.id) !== null && _b !== void 0 ? _b : null),
        projectId: (_d = (_c = conversation === null || conversation === void 0 ? void 0 : conversation.projectId) !== null && _c !== void 0 ? _c : target === null || target === void 0 ? void 0 : target.id) !== null && _d !== void 0 ? _d : null,
        title: (_e = conversation === null || conversation === void 0 ? void 0 : conversation.title) !== null && _e !== void 0 ? _e : buildConversationTitle(target),
        updatedAt: (_f = conversation === null || conversation === void 0 ? void 0 : conversation.updatedAt) !== null && _f !== void 0 ? _f : new Date().toISOString(),
        totals: (_g = conversation === null || conversation === void 0 ? void 0 : conversation.totals) !== null && _g !== void 0 ? _g : {
            inputTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
        },
        messages: (_h = conversation === null || conversation === void 0 ? void 0 : conversation.messages.map((message) => toClientConversationMessage(message))) !== null && _h !== void 0 ? _h : [],
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
    catch (_a) {
        return null;
    }
}
function streamChatResponse(response, handlers) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const reader = (_a = response.body) === null || _a === void 0 ? void 0 : _a.getReader();
        if (!reader) {
            throw new Error("Empty AI stream response.");
        }
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
            const { done, value } = yield reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = (_b = chunks.pop()) !== null && _b !== void 0 ? _b : "";
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
    });
}
function buildPresetPrompt(target, kind) {
    const subject = (target === null || target === void 0 ? void 0 : target.id) ? `the project "${target.name}"` : "the current portfolio";
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
export function AIContextProvider({ children }) {
    var _a;
    const [providerRegistry, setProviderRegistry] = useState([]);
    const [settings, setSettings] = useState(null);
    const [usageSummary, setUsageSummary] = useState({
        last24Hours: { requestCount: 0, outputTokens: 0, costUsd: 0 },
        last7Days: { requestCount: 0, outputTokens: 0, costUsd: 0 },
        providerBreakdown: [],
    });
    const [isReady, setIsReady] = useState(false);
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isAssistantOpen, setIsAssistantOpen] = useState(false);
    const [activeTarget, setActiveTarget] = useState(null);
    const [conversationMap, setConversationMap] = useState({});
    const activeConversationKey = useMemo(() => { var _a; return getConversationId((_a = activeTarget === null || activeTarget === void 0 ? void 0 : activeTarget.id) !== null && _a !== void 0 ? _a : null); }, [activeTarget]);
    const activeConversation = (_a = conversationMap[activeConversationKey]) !== null && _a !== void 0 ? _a : null;
    const hydrateSettings = useCallback(() => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const response = yield fetch("/api/ai/settings");
            if (!response.ok) {
                throw new Error("Failed to load AI settings.");
            }
            const payload = (yield response.json());
            setProviderRegistry((_a = payload.providers) !== null && _a !== void 0 ? _a : []);
            setSettings((_b = payload.settings) !== null && _b !== void 0 ? _b : null);
            if (payload.usage) {
                setUsageSummary(payload.usage);
            }
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to load AI settings.");
        }
        finally {
            setIsReady(true);
        }
    }), []);
    useEffect(() => {
        void hydrateSettings();
    }, [hydrateSettings]);
    const saveSettings = useCallback((input) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        setIsSavingSettings(true);
        try {
            const response = yield fetch("/api/ai/settings", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(input),
            });
            if (!response.ok) {
                throw new Error("Failed to save AI settings.");
            }
            const payload = (yield response.json());
            setProviderRegistry((_a = payload.providers) !== null && _a !== void 0 ? _a : []);
            setSettings((_b = payload.settings) !== null && _b !== void 0 ? _b : null);
            if (payload.usage) {
                setUsageSummary(payload.usage);
            }
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to save AI settings.");
            throw error;
        }
        finally {
            setIsSavingSettings(false);
        }
    }), []);
    const openAssistant = useCallback((target) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const nextTarget = {
            id: (_a = target === null || target === void 0 ? void 0 : target.id) !== null && _a !== void 0 ? _a : null,
            name: ((_b = target === null || target === void 0 ? void 0 : target.name) === null || _b === void 0 ? void 0 : _b.trim()) || "Portfolio",
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
            const response = yield fetch(`/api/ai/chat?${params.toString()}`);
            if (!response.ok) {
                throw new Error("Failed to load AI conversation.");
            }
            const payload = (yield response.json());
            setConversationMap((current) => (Object.assign(Object.assign({}, current), { [conversationId]: toClientConversation(nextTarget, payload.conversation) })));
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to load AI conversation.");
        }
    }), [conversationMap]);
    const closeAssistant = useCallback(() => {
        setIsAssistantOpen(false);
    }, []);
    const sendMessageToTarget = useCallback((content, targetOverride) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (!content.trim() || !settings || isSending) {
            return;
        }
        const target = (_a = targetOverride !== null && targetOverride !== void 0 ? targetOverride : activeTarget) !== null && _a !== void 0 ? _a : { id: null, name: "Portfolio" };
        const conversationId = getConversationId(target.id);
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
            var _a;
            const existing = (_a = current[conversationId]) !== null && _a !== void 0 ? _a : toClientConversation(target, null);
            return Object.assign(Object.assign({}, current), { [conversationId]: Object.assign(Object.assign({}, existing), { updatedAt: timestamp, messages: [
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
                    ] }) });
        });
        setIsSending(true);
        try {
            const response = yield fetch("/api/ai/chat", {
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
                const payload = (yield response.json().catch(() => null));
                throw new Error((_b = payload === null || payload === void 0 ? void 0 : payload.error) !== null && _b !== void 0 ? _b : "Failed to send AI message.");
            }
            yield streamChatResponse(response, {
                onToken: (token) => {
                    setConversationMap((current) => {
                        var _a;
                        const existing = (_a = current[conversationId]) !== null && _a !== void 0 ? _a : toClientConversation(target, null);
                        return Object.assign(Object.assign({}, current), { [conversationId]: Object.assign(Object.assign({}, existing), { messages: existing.messages.map((message) => message.id === assistantMessageId
                                    ? Object.assign(Object.assign({}, message), { content: `${message.content}${token}` }) : message) }) });
                    });
                },
                onDone: (payload) => {
                    var _a;
                    setConversationMap((current) => {
                        var _a;
                        return (Object.assign(Object.assign({}, current), { [conversationId]: toClientConversation(target, (_a = payload.conversation) !== null && _a !== void 0 ? _a : null) }));
                    });
                    if ((_a = payload.conversation) === null || _a === void 0 ? void 0 : _a.totals) {
                        setUsageSummary((current) => {
                            var _a, _b, _c, _d, _e, _f, _g, _h;
                            return (Object.assign(Object.assign({}, current), { last24Hours: Object.assign(Object.assign({}, current.last24Hours), { requestCount: current.last24Hours.requestCount + 1, outputTokens: current.last24Hours.outputTokens +
                                        ((_b = (_a = payload.usage) === null || _a === void 0 ? void 0 : _a.outputTokens) !== null && _b !== void 0 ? _b : 0), costUsd: current.last24Hours.costUsd +
                                        ((_d = (_c = payload.usage) === null || _c === void 0 ? void 0 : _c.estimatedCostUsd) !== null && _d !== void 0 ? _d : 0) }), last7Days: Object.assign(Object.assign({}, current.last7Days), { requestCount: current.last7Days.requestCount + 1, outputTokens: current.last7Days.outputTokens +
                                        ((_f = (_e = payload.usage) === null || _e === void 0 ? void 0 : _e.outputTokens) !== null && _f !== void 0 ? _f : 0), costUsd: current.last7Days.costUsd +
                                        ((_h = (_g = payload.usage) === null || _g === void 0 ? void 0 : _g.estimatedCostUsd) !== null && _h !== void 0 ? _h : 0) }) }));
                        });
                    }
                },
                onError: (message) => {
                    setConversationMap((current) => {
                        var _a;
                        const existing = (_a = current[conversationId]) !== null && _a !== void 0 ? _a : toClientConversation(target, null);
                        return Object.assign(Object.assign({}, current), { [conversationId]: Object.assign(Object.assign({}, existing), { messages: existing.messages.map((item) => item.id === assistantMessageId
                                    ? Object.assign(Object.assign({}, item), { content: message, pending: false }) : item) }) });
                    });
                    throw new Error(message);
                },
            });
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to send AI message.");
        }
        finally {
            setIsSending(false);
        }
    }), [activeTarget, isSending, settings]);
    const sendMessage = useCallback((content) => __awaiter(this, void 0, void 0, function* () {
        yield sendMessageToTarget(content);
    }), [sendMessageToTarget]);
    const setSelectedProvider = useCallback((provider) => __awaiter(this, void 0, void 0, function* () {
        yield saveSettings({
            selectedProvider: provider,
        });
    }), [saveSettings]);
    const setSelectedModel = useCallback((model) => __awaiter(this, void 0, void 0, function* () {
        yield saveSettings({
            selectedModel: model,
        });
    }), [saveSettings]);
    const runPreset = useCallback((kind, target) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const resolvedTarget = target
            ? {
                id: (_a = target.id) !== null && _a !== void 0 ? _a : null,
                name: ((_b = target.name) === null || _b === void 0 ? void 0 : _b.trim()) || "Portfolio",
            }
            : activeTarget;
        yield sendMessageToTarget(buildPresetPrompt(resolvedTarget !== null && resolvedTarget !== void 0 ? resolvedTarget : null, kind), resolvedTarget);
    }), [activeTarget, sendMessageToTarget]);
    const value = useMemo(() => {
        var _a, _b, _c;
        return ({
            providerRegistry,
            selectedProvider: (_a = settings === null || settings === void 0 ? void 0 : settings.selectedProvider) !== null && _a !== void 0 ? _a : "openrouter",
            selectedModel: (_b = settings === null || settings === void 0 ? void 0 : settings.selectedModel) !== null && _b !== void 0 ? _b : "",
            features: (_c = settings === null || settings === void 0 ? void 0 : settings.features) !== null && _c !== void 0 ? _c : {
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
        });
    }, [
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
export function useAIContext() {
    const context = useContext(AIContext);
    if (!context) {
        throw new Error("useAIContext must be used within AIContextProvider");
    }
    return context;
}
