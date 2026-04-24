var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AI_PROVIDER_DEFINITIONS, createEmptyUsageSummary, createEmptyUsageTotals, DEFAULT_AI_CHAT_FEATURES, getConversationMemoryKey, getDefaultSelectedProvider, getUserAISettingsMemoryKey, } from './chat-config';
import { calculateCost } from './cost-tracker';
import { getServerAIStatus } from './server-runs';
import { prisma } from '../prisma';
const CONVERSATION_MESSAGE_LIMIT = 24;
function isMissingTableError(error) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}
function parseModels(value, fallback) {
    if (!value) {
        return fallback;
    }
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
            const models = parsed.filter((item) => typeof item === "string" && item.trim().length > 0);
            if (models.length > 0) {
                return models;
            }
        }
    }
    catch (_a) {
        // Ignore invalid JSON and fall back to CSV parsing.
    }
    const csvModels = value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    return csvModels.length > 0 ? csvModels : fallback;
}
function maskApiKey(apiKey) {
    if (!apiKey) {
        return null;
    }
    const trimmed = apiKey.trim();
    if (trimmed.length <= 8) {
        return "••••••••";
    }
    return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}
function normalizeFeatures(value) {
    if (!value || typeof value !== "object") {
        return DEFAULT_AI_CHAT_FEATURES;
    }
    const candidate = value;
    return {
        projectAssistant: typeof candidate.projectAssistant === "boolean"
            ? candidate.projectAssistant
            : DEFAULT_AI_CHAT_FEATURES.projectAssistant,
        taskSuggestions: typeof candidate.taskSuggestions === "boolean"
            ? candidate.taskSuggestions
            : DEFAULT_AI_CHAT_FEATURES.taskSuggestions,
        riskAnalysis: typeof candidate.riskAnalysis === "boolean"
            ? candidate.riskAnalysis
            : DEFAULT_AI_CHAT_FEATURES.riskAnalysis,
        budgetForecast: typeof candidate.budgetForecast === "boolean"
            ? candidate.budgetForecast
            : DEFAULT_AI_CHAT_FEATURES.budgetForecast,
    };
}
function normalizeUsageTotals(value) {
    if (!value || typeof value !== "object") {
        return createEmptyUsageTotals();
    }
    const candidate = value;
    return {
        inputTokens: typeof candidate.inputTokens === "number" && Number.isFinite(candidate.inputTokens)
            ? Math.max(0, Math.round(candidate.inputTokens))
            : 0,
        outputTokens: typeof candidate.outputTokens === "number" && Number.isFinite(candidate.outputTokens)
            ? Math.max(0, Math.round(candidate.outputTokens))
            : 0,
        estimatedCostUsd: typeof candidate.estimatedCostUsd === "number" && Number.isFinite(candidate.estimatedCostUsd)
            ? Math.max(0, candidate.estimatedCostUsd)
            : 0,
    };
}
function parseConversationMessage(value) {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value;
    if ((record.role !== "assistant" && record.role !== "system" && record.role !== "user") ||
        typeof record.content !== "string" ||
        record.content.trim().length === 0 ||
        typeof record.id !== "string" ||
        typeof record.createdAt !== "string") {
        return null;
    }
    return {
        id: record.id,
        role: record.role,
        content: record.content,
        createdAt: record.createdAt,
        provider: record.provider === "local" ||
            record.provider === "openai" ||
            record.provider === "openrouter" ||
            record.provider === "zai"
            ? record.provider
            : null,
        model: typeof record.model === "string" && record.model.trim().length > 0 ? record.model : null,
        usage: normalizeUsageTotals(record.usage),
    };
}
function parseConversationValue(value, key, userId, conversationId) {
    try {
        const parsed = JSON.parse(value);
        const messages = Array.isArray(parsed.messages)
            ? parsed.messages
                .map((message) => parseConversationMessage(message))
                .filter((message) => message !== null)
            : [];
        return {
            userId,
            conversationId,
            projectId: typeof parsed.projectId === "string" && parsed.projectId.length > 0 ? parsed.projectId : null,
            title: typeof parsed.title === "string" && parsed.title.trim().length > 0
                ? parsed.title
                : key,
            updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt.length > 0
                ? parsed.updatedAt
                : new Date().toISOString(),
            messages,
            totals: normalizeUsageTotals(parsed.totals),
        };
    }
    catch (_a) {
        return null;
    }
}
function findLatestMemoryByKey(key) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield prisma.memory.findFirst({
                where: { key },
                orderBy: { updatedAt: "desc" },
            });
        }
        catch (error) {
            if (isMissingTableError(error)) {
                return null;
            }
            throw error;
        }
    });
}
function saveMemoryRecord(key, data) {
    return __awaiter(this, void 0, void 0, function* () {
        const existing = yield findLatestMemoryByKey(key);
        const serializedValue = JSON.stringify(data.value);
        if (existing) {
            return prisma.memory.update({
                where: { id: existing.id },
                data: {
                    category: data.category,
                    source: data.source,
                    type: data.type,
                    value: serializedValue,
                },
            });
        }
        return prisma.memory.create({
            data: {
                id: randomUUID(),
                key,
                category: data.category,
                source: data.source,
                type: data.type,
                value: serializedValue,
            },
        });
    });
}
function listStoredProviders() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield prisma.aIProvider.findMany({
                where: {
                    name: {
                        in: ["openrouter", "zai", "openai"],
                    },
                },
                orderBy: { priority: "asc" },
            });
        }
        catch (error) {
            if (isMissingTableError(error)) {
                return [];
            }
            throw error;
        }
    });
}
export function getAIProviderRegistry() {
    return __awaiter(this, void 0, void 0, function* () {
        const providerRows = yield listStoredProviders();
        return ["openrouter", "zai", "openai"].map((providerId, index) => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const defaults = AI_PROVIDER_DEFINITIONS[providerId];
            const row = providerRows.find((item) => item.name === providerId);
            const envApiKey = defaults.apiKeyEnvVar
                ? (_b = (_a = process.env[defaults.apiKeyEnvVar]) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : ""
                : "";
            const databaseApiKey = (_d = (_c = row === null || row === void 0 ? void 0 : row.apiKey) === null || _c === void 0 ? void 0 : _c.trim()) !== null && _d !== void 0 ? _d : "";
            const effectiveApiKey = databaseApiKey || envApiKey;
            return {
                id: providerId,
                label: defaults.label,
                enabled: (_e = row === null || row === void 0 ? void 0 : row.enabled) !== null && _e !== void 0 ? _e : Boolean(effectiveApiKey),
                hasApiKey: effectiveApiKey.length > 0,
                apiKeyMasked: maskApiKey(databaseApiKey || envApiKey),
                baseUrl: ((_f = row === null || row === void 0 ? void 0 : row.baseUrl) === null || _f === void 0 ? void 0 : _f.trim()) || defaults.baseUrl,
                defaultModel: ((_g = row === null || row === void 0 ? void 0 : row.defaultModel) === null || _g === void 0 ? void 0 : _g.trim()) || defaults.defaultModel,
                models: parseModels(row === null || row === void 0 ? void 0 : row.models, defaults.models),
                priority: (_h = row === null || row === void 0 ? void 0 : row.priority) !== null && _h !== void 0 ? _h : index,
                source: row
                    ? "database"
                    : envApiKey
                        ? "environment"
                        : "default",
            };
        });
    });
}
export function resolveChatProviderConfig(providerId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const defaults = AI_PROVIDER_DEFINITIONS[providerId];
        if (providerId === "local") {
            return {
                id: providerId,
                apiKey: null,
                baseUrl: defaults.baseUrl,
                defaultModel: defaults.defaultModel,
                enabled: true,
                models: defaults.models,
            };
        }
        const providerRows = yield listStoredProviders();
        const row = providerRows.find((item) => item.name === providerId);
        const envApiKey = defaults.apiKeyEnvVar
            ? (_b = (_a = process.env[defaults.apiKeyEnvVar]) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : ""
            : "";
        const databaseApiKey = (_d = (_c = row === null || row === void 0 ? void 0 : row.apiKey) === null || _c === void 0 ? void 0 : _c.trim()) !== null && _d !== void 0 ? _d : "";
        const apiKey = databaseApiKey || envApiKey || null;
        return {
            id: providerId,
            apiKey,
            baseUrl: ((_e = row === null || row === void 0 ? void 0 : row.baseUrl) === null || _e === void 0 ? void 0 : _e.trim()) || defaults.baseUrl,
            defaultModel: ((_f = row === null || row === void 0 ? void 0 : row.defaultModel) === null || _f === void 0 ? void 0 : _f.trim()) || defaults.defaultModel,
            enabled: (_g = row === null || row === void 0 ? void 0 : row.enabled) !== null && _g !== void 0 ? _g : Boolean(apiKey),
            models: parseModels(row === null || row === void 0 ? void 0 : row.models, defaults.models),
        };
    });
}
export function getUserAISettings(userId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const providers = yield getAIProviderRegistry();
        const fallbackProvider = getDefaultSelectedProvider(providers);
        const fallbackModel = (_b = (_a = providers.find((provider) => provider.id === fallbackProvider)) === null || _a === void 0 ? void 0 : _a.defaultModel) !== null && _b !== void 0 ? _b : AI_PROVIDER_DEFINITIONS[fallbackProvider].defaultModel;
        const key = getUserAISettingsMemoryKey(userId);
        const record = yield findLatestMemoryByKey(key);
        if (!record) {
            return {
                selectedProvider: fallbackProvider,
                selectedModel: fallbackModel,
                features: DEFAULT_AI_CHAT_FEATURES,
                updatedAt: null,
            };
        }
        try {
            const parsed = JSON.parse(record.value);
            const selectedProvider = parsed.selectedProvider === "openai" ||
                parsed.selectedProvider === "openrouter" ||
                parsed.selectedProvider === "zai" ||
                parsed.selectedProvider === "local"
                ? parsed.selectedProvider
                : fallbackProvider;
            const selectedModel = typeof parsed.selectedModel === "string" && parsed.selectedModel.trim().length > 0
                ? parsed.selectedModel
                : (_d = (_c = providers.find((provider) => provider.id === selectedProvider)) === null || _c === void 0 ? void 0 : _c.defaultModel) !== null && _d !== void 0 ? _d : AI_PROVIDER_DEFINITIONS[selectedProvider].defaultModel;
            return {
                selectedProvider,
                selectedModel,
                features: normalizeFeatures(parsed.features),
                updatedAt: record.updatedAt.toISOString(),
            };
        }
        catch (_e) {
            return {
                selectedProvider: fallbackProvider,
                selectedModel: fallbackModel,
                features: DEFAULT_AI_CHAT_FEATURES,
                updatedAt: record.updatedAt.toISOString(),
            };
        }
    });
}
export function saveUserAISettings(userId, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const current = yield getUserAISettings(userId);
        const nextProvider = (_a = input.selectedProvider) !== null && _a !== void 0 ? _a : current.selectedProvider;
        const nextModel = ((_b = input.selectedModel) === null || _b === void 0 ? void 0 : _b.trim()) ||
            current.selectedModel ||
            AI_PROVIDER_DEFINITIONS[nextProvider].defaultModel;
        const nextSettings = {
            selectedProvider: nextProvider,
            selectedModel: nextModel,
            features: input.features
                ? normalizeFeatures(Object.assign(Object.assign({}, current.features), input.features))
                : current.features,
            updatedAt: new Date().toISOString(),
        };
        yield saveMemoryRecord(getUserAISettingsMemoryKey(userId), {
            type: "procedural",
            category: "ai_settings",
            source: "user",
            value: nextSettings,
        });
        return nextSettings;
    });
}
export function saveAIProviderSettings(providers) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        for (const provider of providers) {
            const defaults = AI_PROVIDER_DEFINITIONS[provider.id];
            const existing = yield prisma.aIProvider.findUnique({
                where: { name: provider.id },
            }).catch((error) => {
                if (isMissingTableError(error)) {
                    return null;
                }
                throw error;
            });
            const trimmedApiKey = (_a = provider.apiKey) === null || _a === void 0 ? void 0 : _a.trim();
            const nextApiKey = trimmedApiKey && trimmedApiKey.length > 0
                ? trimmedApiKey
                : (existing === null || existing === void 0 ? void 0 : existing.apiKey) || process.env[(_b = defaults.apiKeyEnvVar) !== null && _b !== void 0 ? _b : ""] || "";
            const nextModels = provider.models && provider.models.length > 0
                ? provider.models
                : parseModels(existing === null || existing === void 0 ? void 0 : existing.models, defaults.models);
            if (!existing) {
                yield prisma.aIProvider.create({
                    data: {
                        id: provider.id,
                        name: provider.id,
                        apiKey: nextApiKey,
                        baseUrl: ((_c = provider.baseUrl) === null || _c === void 0 ? void 0 : _c.trim()) || defaults.baseUrl,
                        defaultModel: ((_d = provider.defaultModel) === null || _d === void 0 ? void 0 : _d.trim()) || defaults.defaultModel,
                        enabled: (_e = provider.enabled) !== null && _e !== void 0 ? _e : true,
                        models: JSON.stringify(nextModels),
                        priority: 0,
                    },
                }).catch((error) => {
                    if (!isMissingTableError(error)) {
                        throw error;
                    }
                });
                continue;
            }
            yield prisma.aIProvider.update({
                where: { id: existing.id },
                data: {
                    apiKey: nextApiKey,
                    baseUrl: ((_f = provider.baseUrl) === null || _f === void 0 ? void 0 : _f.trim()) || existing.baseUrl || defaults.baseUrl,
                    defaultModel: ((_g = provider.defaultModel) === null || _g === void 0 ? void 0 : _g.trim()) || existing.defaultModel || defaults.defaultModel,
                    enabled: (_h = provider.enabled) !== null && _h !== void 0 ? _h : existing.enabled,
                    models: JSON.stringify(nextModels),
                },
            }).catch((error) => {
                if (!isMissingTableError(error)) {
                    throw error;
                }
            });
        }
    });
}
export function getWorkspaceAIUsageSummary(workspaceId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const empty = createEmptyUsageSummary();
        const now = Date.now();
        const since24Hours = new Date(now - 24 * 60 * 60 * 1000);
        const since7Days = new Date(now - 7 * 24 * 60 * 60 * 1000);
        try {
            const [raw24Hours, raw7Days, providerBreakdown] = yield Promise.all([
                prisma.aIRunCost.aggregate({
                    where: { workspaceId, createdAt: { gte: since24Hours } },
                    _sum: { costUsd: true, outputTokens: true },
                    _count: true,
                }),
                prisma.aIRunCost.aggregate({
                    where: { workspaceId, createdAt: { gte: since7Days } },
                    _sum: { costUsd: true, outputTokens: true },
                    _count: true,
                }),
                prisma.aIRunCost.groupBy({
                    by: ["provider"],
                    where: { workspaceId, createdAt: { gte: since7Days } },
                    _sum: { costUsd: true },
                    _count: true,
                }),
            ]);
            return {
                last24Hours: {
                    requestCount: typeof raw24Hours._count === "number" ? raw24Hours._count : 0,
                    outputTokens: (_a = raw24Hours._sum.outputTokens) !== null && _a !== void 0 ? _a : 0,
                    costUsd: (_b = raw24Hours._sum.costUsd) !== null && _b !== void 0 ? _b : 0,
                },
                last7Days: {
                    requestCount: typeof raw7Days._count === "number" ? raw7Days._count : 0,
                    outputTokens: (_c = raw7Days._sum.outputTokens) !== null && _c !== void 0 ? _c : 0,
                    costUsd: (_d = raw7Days._sum.costUsd) !== null && _d !== void 0 ? _d : 0,
                },
                providerBreakdown: providerBreakdown.map((entry) => {
                    var _a;
                    return ({
                        provider: entry.provider,
                        requestCount: typeof entry._count === "number" ? entry._count : 0,
                        costUsd: (_a = entry._sum.costUsd) !== null && _a !== void 0 ? _a : 0,
                    });
                }),
            };
        }
        catch (error) {
            if (!isMissingTableError(error)) {
                console.warn("[AI settings] Failed to load usage summary", error);
            }
            return empty;
        }
    });
}
export function getAISettingsPayload(userId, workspaceId) {
    return __awaiter(this, void 0, void 0, function* () {
        const [providers, settings, usage] = yield Promise.all([
            getAIProviderRegistry(),
            getUserAISettings(userId),
            getWorkspaceAIUsageSummary(workspaceId),
        ]);
        return {
            providers,
            settings,
            usage,
            aiStatus: getServerAIStatus(),
        };
    });
}
export function loadConversation(userId, projectId, conversationId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const resolvedConversationId = conversationId || (projectId ? `project:${projectId}` : "portfolio");
        const key = getConversationMemoryKey(userId, resolvedConversationId);
        const record = yield findLatestMemoryByKey(key);
        const fallbackTitle = projectId ? `Project ${projectId}` : "Portfolio";
        if (!record) {
            return {
                userId,
                conversationId: resolvedConversationId,
                projectId: projectId !== null && projectId !== void 0 ? projectId : null,
                title: fallbackTitle,
                updatedAt: new Date().toISOString(),
                messages: [],
                totals: createEmptyUsageTotals(),
            };
        }
        return ((_a = parseConversationValue(record.value, fallbackTitle, userId, resolvedConversationId)) !== null && _a !== void 0 ? _a : {
            userId,
            conversationId: resolvedConversationId,
            projectId: projectId !== null && projectId !== void 0 ? projectId : null,
            title: fallbackTitle,
            updatedAt: record.updatedAt.toISOString(),
            messages: [],
            totals: createEmptyUsageTotals(),
        });
    });
}
export function appendConversationTurn(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const current = yield loadConversation(input.userId, input.projectId, input.conversationId);
        const usage = calculateCost(input.provider, input.model, input.inputTokens, input.outputTokens);
        const timestamp = new Date().toISOString();
        const nextMessages = [
            ...current.messages,
            {
                id: `user-${randomUUID()}`,
                role: "user",
                content: input.userContent,
                createdAt: timestamp,
                provider: null,
                model: null,
                usage: {
                    inputTokens: input.inputTokens,
                    outputTokens: 0,
                    estimatedCostUsd: 0,
                },
            },
            {
                id: `assistant-${randomUUID()}`,
                role: "assistant",
                content: input.assistantContent,
                createdAt: timestamp,
                provider: input.provider,
                model: input.model,
                usage: {
                    inputTokens: input.inputTokens,
                    outputTokens: input.outputTokens,
                    estimatedCostUsd: usage.costUsd,
                },
            },
        ].slice(-CONVERSATION_MESSAGE_LIMIT);
        const nextConversation = Object.assign(Object.assign({}, current), { projectId: (_b = (_a = input.projectId) !== null && _a !== void 0 ? _a : current.projectId) !== null && _b !== void 0 ? _b : null, title: current.title && current.title.trim().length > 0
                ? current.title
                : input.userContent.replace(/\s+/g, " ").trim().slice(0, 48), updatedAt: timestamp, messages: nextMessages, totals: {
                inputTokens: current.totals.inputTokens + input.inputTokens,
                outputTokens: current.totals.outputTokens + input.outputTokens,
                estimatedCostUsd: Number((current.totals.estimatedCostUsd + usage.costUsd).toFixed(6)),
            } });
        yield saveMemoryRecord(getConversationMemoryKey(input.userId, input.conversationId), {
            type: "episodic",
            category: "chat",
            source: "system",
            value: nextConversation,
        });
        return nextConversation;
    });
}
