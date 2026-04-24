"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAIProviderRegistry = getAIProviderRegistry;
exports.resolveChatProviderConfig = resolveChatProviderConfig;
exports.getUserAISettings = getUserAISettings;
exports.saveUserAISettings = saveUserAISettings;
exports.saveAIProviderSettings = saveAIProviderSettings;
exports.getWorkspaceAIUsageSummary = getWorkspaceAIUsageSummary;
exports.getAISettingsPayload = getAISettingsPayload;
exports.loadConversation = loadConversation;
exports.appendConversationTurn = appendConversationTurn;
require("server-only");
const node_crypto_1 = require("node:crypto");
const client_1 = require("@prisma/client");
const chat_config_1 = require("./chat-config");
const cost_tracker_1 = require("./cost-tracker");
const server_runs_1 = require("./server-runs");
const prisma_1 = require("../prisma");
const CONVERSATION_MESSAGE_LIMIT = 24;
function isMissingTableError(error) {
    return error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === "P2021";
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
    catch {
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
        return chat_config_1.DEFAULT_AI_CHAT_FEATURES;
    }
    const candidate = value;
    return {
        projectAssistant: typeof candidate.projectAssistant === "boolean"
            ? candidate.projectAssistant
            : chat_config_1.DEFAULT_AI_CHAT_FEATURES.projectAssistant,
        taskSuggestions: typeof candidate.taskSuggestions === "boolean"
            ? candidate.taskSuggestions
            : chat_config_1.DEFAULT_AI_CHAT_FEATURES.taskSuggestions,
        riskAnalysis: typeof candidate.riskAnalysis === "boolean"
            ? candidate.riskAnalysis
            : chat_config_1.DEFAULT_AI_CHAT_FEATURES.riskAnalysis,
        budgetForecast: typeof candidate.budgetForecast === "boolean"
            ? candidate.budgetForecast
            : chat_config_1.DEFAULT_AI_CHAT_FEATURES.budgetForecast,
    };
}
function normalizeUsageTotals(value) {
    if (!value || typeof value !== "object") {
        return (0, chat_config_1.createEmptyUsageTotals)();
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
    catch {
        return null;
    }
}
async function findLatestMemoryByKey(key) {
    try {
        return await prisma_1.prisma.memory.findFirst({
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
}
async function saveMemoryRecord(key, data) {
    const existing = await findLatestMemoryByKey(key);
    const serializedValue = JSON.stringify(data.value);
    if (existing) {
        return prisma_1.prisma.memory.update({
            where: { id: existing.id },
            data: {
                category: data.category,
                source: data.source,
                type: data.type,
                value: serializedValue,
            },
        });
    }
    return prisma_1.prisma.memory.create({
        data: {
            id: (0, node_crypto_1.randomUUID)(),
            key,
            category: data.category,
            source: data.source,
            type: data.type,
            value: serializedValue,
        },
    });
}
async function listStoredProviders() {
    try {
        return await prisma_1.prisma.aIProvider.findMany({
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
}
async function getAIProviderRegistry() {
    const providerRows = await listStoredProviders();
    return ["openrouter", "zai", "openai"].map((providerId, index) => {
        const defaults = chat_config_1.AI_PROVIDER_DEFINITIONS[providerId];
        const row = providerRows.find((item) => item.name === providerId);
        const envApiKey = defaults.apiKeyEnvVar
            ? process.env[defaults.apiKeyEnvVar]?.trim() ?? ""
            : "";
        const databaseApiKey = row?.apiKey?.trim() ?? "";
        const effectiveApiKey = databaseApiKey || envApiKey;
        return {
            id: providerId,
            label: defaults.label,
            enabled: row?.enabled ?? Boolean(effectiveApiKey),
            hasApiKey: effectiveApiKey.length > 0,
            apiKeyMasked: maskApiKey(databaseApiKey || envApiKey),
            baseUrl: row?.baseUrl?.trim() || defaults.baseUrl,
            defaultModel: row?.defaultModel?.trim() || defaults.defaultModel,
            models: parseModels(row?.models, defaults.models),
            priority: row?.priority ?? index,
            source: row
                ? "database"
                : envApiKey
                    ? "environment"
                    : "default",
        };
    });
}
async function resolveChatProviderConfig(providerId) {
    const defaults = chat_config_1.AI_PROVIDER_DEFINITIONS[providerId];
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
    const providerRows = await listStoredProviders();
    const row = providerRows.find((item) => item.name === providerId);
    const envApiKey = defaults.apiKeyEnvVar
        ? process.env[defaults.apiKeyEnvVar]?.trim() ?? ""
        : "";
    const databaseApiKey = row?.apiKey?.trim() ?? "";
    const apiKey = databaseApiKey || envApiKey || null;
    return {
        id: providerId,
        apiKey,
        baseUrl: row?.baseUrl?.trim() || defaults.baseUrl,
        defaultModel: row?.defaultModel?.trim() || defaults.defaultModel,
        enabled: row?.enabled ?? Boolean(apiKey),
        models: parseModels(row?.models, defaults.models),
    };
}
async function getUserAISettings(userId) {
    const providers = await getAIProviderRegistry();
    const fallbackProvider = (0, chat_config_1.getDefaultSelectedProvider)(providers);
    const fallbackModel = providers.find((provider) => provider.id === fallbackProvider)?.defaultModel ??
        chat_config_1.AI_PROVIDER_DEFINITIONS[fallbackProvider].defaultModel;
    const key = (0, chat_config_1.getUserAISettingsMemoryKey)(userId);
    const record = await findLatestMemoryByKey(key);
    if (!record) {
        return {
            selectedProvider: fallbackProvider,
            selectedModel: fallbackModel,
            features: chat_config_1.DEFAULT_AI_CHAT_FEATURES,
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
            : providers.find((provider) => provider.id === selectedProvider)?.defaultModel ??
                chat_config_1.AI_PROVIDER_DEFINITIONS[selectedProvider].defaultModel;
        return {
            selectedProvider,
            selectedModel,
            features: normalizeFeatures(parsed.features),
            updatedAt: record.updatedAt.toISOString(),
        };
    }
    catch {
        return {
            selectedProvider: fallbackProvider,
            selectedModel: fallbackModel,
            features: chat_config_1.DEFAULT_AI_CHAT_FEATURES,
            updatedAt: record.updatedAt.toISOString(),
        };
    }
}
async function saveUserAISettings(userId, input) {
    const current = await getUserAISettings(userId);
    const nextProvider = input.selectedProvider ?? current.selectedProvider;
    const nextModel = input.selectedModel?.trim() ||
        current.selectedModel ||
        chat_config_1.AI_PROVIDER_DEFINITIONS[nextProvider].defaultModel;
    const nextSettings = {
        selectedProvider: nextProvider,
        selectedModel: nextModel,
        features: input.features
            ? normalizeFeatures({ ...current.features, ...input.features })
            : current.features,
        updatedAt: new Date().toISOString(),
    };
    await saveMemoryRecord((0, chat_config_1.getUserAISettingsMemoryKey)(userId), {
        type: "procedural",
        category: "ai_settings",
        source: "user",
        value: nextSettings,
    });
    return nextSettings;
}
async function saveAIProviderSettings(providers) {
    for (const provider of providers) {
        const defaults = chat_config_1.AI_PROVIDER_DEFINITIONS[provider.id];
        const existing = await prisma_1.prisma.aIProvider.findUnique({
            where: { name: provider.id },
        }).catch((error) => {
            if (isMissingTableError(error)) {
                return null;
            }
            throw error;
        });
        const trimmedApiKey = provider.apiKey?.trim();
        const nextApiKey = trimmedApiKey && trimmedApiKey.length > 0
            ? trimmedApiKey
            : existing?.apiKey || process.env[defaults.apiKeyEnvVar ?? ""] || "";
        const nextModels = provider.models && provider.models.length > 0
            ? provider.models
            : parseModels(existing?.models, defaults.models);
        if (!existing) {
            await prisma_1.prisma.aIProvider.create({
                data: {
                    id: provider.id,
                    name: provider.id,
                    apiKey: nextApiKey,
                    baseUrl: provider.baseUrl?.trim() || defaults.baseUrl,
                    defaultModel: provider.defaultModel?.trim() || defaults.defaultModel,
                    enabled: provider.enabled ?? true,
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
        await prisma_1.prisma.aIProvider.update({
            where: { id: existing.id },
            data: {
                apiKey: nextApiKey,
                baseUrl: provider.baseUrl?.trim() || existing.baseUrl || defaults.baseUrl,
                defaultModel: provider.defaultModel?.trim() || existing.defaultModel || defaults.defaultModel,
                enabled: provider.enabled ?? existing.enabled,
                models: JSON.stringify(nextModels),
            },
        }).catch((error) => {
            if (!isMissingTableError(error)) {
                throw error;
            }
        });
    }
}
async function getWorkspaceAIUsageSummary(workspaceId) {
    const empty = (0, chat_config_1.createEmptyUsageSummary)();
    const now = Date.now();
    const since24Hours = new Date(now - 24 * 60 * 60 * 1000);
    const since7Days = new Date(now - 7 * 24 * 60 * 60 * 1000);
    try {
        const [raw24Hours, raw7Days, providerBreakdown] = await Promise.all([
            prisma_1.prisma.aIRunCost.aggregate({
                where: { workspaceId, createdAt: { gte: since24Hours } },
                _sum: { costUsd: true, outputTokens: true },
                _count: true,
            }),
            prisma_1.prisma.aIRunCost.aggregate({
                where: { workspaceId, createdAt: { gte: since7Days } },
                _sum: { costUsd: true, outputTokens: true },
                _count: true,
            }),
            prisma_1.prisma.aIRunCost.groupBy({
                by: ["provider"],
                where: { workspaceId, createdAt: { gte: since7Days } },
                _sum: { costUsd: true },
                _count: true,
            }),
        ]);
        return {
            last24Hours: {
                requestCount: typeof raw24Hours._count === "number" ? raw24Hours._count : 0,
                outputTokens: raw24Hours._sum.outputTokens ?? 0,
                costUsd: raw24Hours._sum.costUsd ?? 0,
            },
            last7Days: {
                requestCount: typeof raw7Days._count === "number" ? raw7Days._count : 0,
                outputTokens: raw7Days._sum.outputTokens ?? 0,
                costUsd: raw7Days._sum.costUsd ?? 0,
            },
            providerBreakdown: providerBreakdown.map((entry) => ({
                provider: entry.provider,
                requestCount: typeof entry._count === "number" ? entry._count : 0,
                costUsd: entry._sum.costUsd ?? 0,
            })),
        };
    }
    catch (error) {
        if (!isMissingTableError(error)) {
            console.warn("[AI settings] Failed to load usage summary", error);
        }
        return empty;
    }
}
async function getAISettingsPayload(userId, workspaceId) {
    const [providers, settings, usage] = await Promise.all([
        getAIProviderRegistry(),
        getUserAISettings(userId),
        getWorkspaceAIUsageSummary(workspaceId),
    ]);
    return {
        providers,
        settings,
        usage,
        aiStatus: (0, server_runs_1.getServerAIStatus)(),
    };
}
async function loadConversation(userId, projectId, conversationId) {
    const resolvedConversationId = conversationId || (projectId ? `project:${projectId}` : "portfolio");
    const key = (0, chat_config_1.getConversationMemoryKey)(userId, resolvedConversationId);
    const record = await findLatestMemoryByKey(key);
    const fallbackTitle = projectId ? `Project ${projectId}` : "Portfolio";
    if (!record) {
        return {
            userId,
            conversationId: resolvedConversationId,
            projectId: projectId ?? null,
            title: fallbackTitle,
            updatedAt: new Date().toISOString(),
            messages: [],
            totals: (0, chat_config_1.createEmptyUsageTotals)(),
        };
    }
    return (parseConversationValue(record.value, fallbackTitle, userId, resolvedConversationId) ?? {
        userId,
        conversationId: resolvedConversationId,
        projectId: projectId ?? null,
        title: fallbackTitle,
        updatedAt: record.updatedAt.toISOString(),
        messages: [],
        totals: (0, chat_config_1.createEmptyUsageTotals)(),
    });
}
async function appendConversationTurn(input) {
    const current = await loadConversation(input.userId, input.projectId, input.conversationId);
    const usage = (0, cost_tracker_1.calculateCost)(input.provider, input.model, input.inputTokens, input.outputTokens);
    const timestamp = new Date().toISOString();
    const nextMessages = [
        ...current.messages,
        {
            id: `user-${(0, node_crypto_1.randomUUID)()}`,
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
            id: `assistant-${(0, node_crypto_1.randomUUID)()}`,
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
    const nextConversation = {
        ...current,
        projectId: input.projectId ?? current.projectId ?? null,
        title: current.title && current.title.trim().length > 0
            ? current.title
            : input.userContent.replace(/\s+/g, " ").trim().slice(0, 48),
        updatedAt: timestamp,
        messages: nextMessages,
        totals: {
            inputTokens: current.totals.inputTokens + input.inputTokens,
            outputTokens: current.totals.outputTokens + input.outputTokens,
            estimatedCostUsd: Number((current.totals.estimatedCostUsd + usage.costUsd).toFixed(6)),
        },
    };
    await saveMemoryRecord((0, chat_config_1.getConversationMemoryKey)(input.userId, input.conversationId), {
        type: "episodic",
        category: "chat",
        source: "system",
        value: nextConversation,
    });
    return nextConversation;
}
