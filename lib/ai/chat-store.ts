import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import {
  AI_PROVIDER_DEFINITIONS,
  type AISettingsPayload,
  type AIStoredConversation,
  type AIStoredConversationMessage,
  type AIUsageTotals,
  type AIUserChatSettings,
  createEmptyUsageSummary,
  createEmptyUsageTotals,
  DEFAULT_AI_CHAT_FEATURES,
  getConversationMemoryKey,
  getDefaultSelectedProvider,
  getUserAISettingsMemoryKey,
  type SupportedAIProvider,
} from "@/lib/ai/chat-config";
import { calculateCost } from "@/lib/ai/cost-tracker";
import { getServerAIStatus } from "@/lib/ai/server-runs";
import { prisma } from "@/lib/prisma";

const CONVERSATION_MESSAGE_LIMIT = 24;

type AIProviderRecord = Awaited<ReturnType<typeof prisma.aIProvider.findMany>>[number];
type MemoryRecord = Awaited<ReturnType<typeof prisma.memory.findFirst>>;

function isMissingTableError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

function parseModels(value: string | null | undefined, fallback: string[]) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      const models = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (models.length > 0) {
        return models;
      }
    }
  } catch {
    // Ignore invalid JSON and fall back to CSV parsing.
  }

  const csvModels = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return csvModels.length > 0 ? csvModels : fallback;
}

function maskApiKey(apiKey: string | null | undefined) {
  if (!apiKey) {
    return null;
  }

  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return "••••••••";
  }

  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

function normalizeFeatures(value: unknown) {
  if (!value || typeof value !== "object") {
    return DEFAULT_AI_CHAT_FEATURES;
  }

  const candidate = value as Partial<typeof DEFAULT_AI_CHAT_FEATURES>;

  return {
    projectAssistant:
      typeof candidate.projectAssistant === "boolean"
        ? candidate.projectAssistant
        : DEFAULT_AI_CHAT_FEATURES.projectAssistant,
    taskSuggestions:
      typeof candidate.taskSuggestions === "boolean"
        ? candidate.taskSuggestions
        : DEFAULT_AI_CHAT_FEATURES.taskSuggestions,
    riskAnalysis:
      typeof candidate.riskAnalysis === "boolean"
        ? candidate.riskAnalysis
        : DEFAULT_AI_CHAT_FEATURES.riskAnalysis,
    budgetForecast:
      typeof candidate.budgetForecast === "boolean"
        ? candidate.budgetForecast
        : DEFAULT_AI_CHAT_FEATURES.budgetForecast,
  };
}

function normalizeUsageTotals(value: unknown): AIUsageTotals {
  if (!value || typeof value !== "object") {
    return createEmptyUsageTotals();
  }

  const candidate = value as Partial<AIUsageTotals>;

  return {
    inputTokens:
      typeof candidate.inputTokens === "number" && Number.isFinite(candidate.inputTokens)
        ? Math.max(0, Math.round(candidate.inputTokens))
        : 0,
    outputTokens:
      typeof candidate.outputTokens === "number" && Number.isFinite(candidate.outputTokens)
        ? Math.max(0, Math.round(candidate.outputTokens))
        : 0,
    estimatedCostUsd:
      typeof candidate.estimatedCostUsd === "number" && Number.isFinite(candidate.estimatedCostUsd)
        ? Math.max(0, candidate.estimatedCostUsd)
        : 0,
  };
}

function parseConversationMessage(value: unknown): AIStoredConversationMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<AIStoredConversationMessage>;
  if (
    (record.role !== "assistant" && record.role !== "system" && record.role !== "user") ||
    typeof record.content !== "string" ||
    record.content.trim().length === 0 ||
    typeof record.id !== "string" ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: record.id,
    role: record.role,
    content: record.content,
    createdAt: record.createdAt,
    provider:
      record.provider === "local" ||
      record.provider === "openai" ||
      record.provider === "openrouter" ||
      record.provider === "zai"
        ? record.provider
        : null,
    model: typeof record.model === "string" && record.model.trim().length > 0 ? record.model : null,
    usage: normalizeUsageTotals(record.usage),
  };
}

function parseConversationValue(value: string, key: string, userId: string, conversationId: string): AIStoredConversation | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .map((message) => parseConversationMessage(message))
          .filter((message): message is AIStoredConversationMessage => message !== null)
      : [];

    return {
      userId,
      conversationId,
      projectId: typeof parsed.projectId === "string" && parsed.projectId.length > 0 ? parsed.projectId : null,
      title:
        typeof parsed.title === "string" && parsed.title.trim().length > 0
          ? parsed.title
          : key,
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt.length > 0
          ? parsed.updatedAt
          : new Date().toISOString(),
      messages,
      totals: normalizeUsageTotals(parsed.totals),
    };
  } catch {
    return null;
  }
}

async function findLatestMemoryByKey(key: string): Promise<MemoryRecord> {
  try {
    return await prisma.memory.findFirst({
      where: { key },
      orderBy: { updatedAt: "desc" },
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return null;
    }

    throw error;
  }
}

async function saveMemoryRecord(key: string, data: {
  category: string;
  source: string;
  type: string;
  value: unknown;
}) {
  const existing = await findLatestMemoryByKey(key);
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
}

async function listStoredProviders() {
  try {
    return await prisma.aIProvider.findMany({
      where: {
        name: {
          in: ["openrouter", "zai", "openai"],
        },
      },
      orderBy: { priority: "asc" },
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return [] satisfies AIProviderRecord[];
    }

    throw error;
  }
}

export async function getAIProviderRegistry() {
  const providerRows = await listStoredProviders();

  return (["openrouter", "zai", "openai"] as const).map((providerId, index) => {
    const defaults = AI_PROVIDER_DEFINITIONS[providerId];
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
        ? ("database" as const)
        : envApiKey
          ? ("environment" as const)
          : ("default" as const),
    };
  });
}

export async function resolveChatProviderConfig(providerId: SupportedAIProvider) {
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

export async function getUserAISettings(userId: string): Promise<AIUserChatSettings> {
  const providers = await getAIProviderRegistry();
  const fallbackProvider = getDefaultSelectedProvider(providers);
  const fallbackModel =
    providers.find((provider) => provider.id === fallbackProvider)?.defaultModel ??
    AI_PROVIDER_DEFINITIONS[fallbackProvider].defaultModel;
  const key = getUserAISettingsMemoryKey(userId);
  const record = await findLatestMemoryByKey(key);

  if (!record) {
    return {
      selectedProvider: fallbackProvider,
      selectedModel: fallbackModel,
      features: DEFAULT_AI_CHAT_FEATURES,
      updatedAt: null,
    };
  }

  try {
    const parsed = JSON.parse(record.value) as Record<string, unknown>;
    const selectedProvider =
      parsed.selectedProvider === "openai" ||
      parsed.selectedProvider === "openrouter" ||
      parsed.selectedProvider === "zai" ||
      parsed.selectedProvider === "local"
        ? parsed.selectedProvider
        : fallbackProvider;
    const selectedModel =
      typeof parsed.selectedModel === "string" && parsed.selectedModel.trim().length > 0
        ? parsed.selectedModel
        : providers.find((provider) => provider.id === selectedProvider)?.defaultModel ??
          AI_PROVIDER_DEFINITIONS[selectedProvider].defaultModel;

    return {
      selectedProvider,
      selectedModel,
      features: normalizeFeatures(parsed.features),
      updatedAt: record.updatedAt.toISOString(),
    };
  } catch {
    return {
      selectedProvider: fallbackProvider,
      selectedModel: fallbackModel,
      features: DEFAULT_AI_CHAT_FEATURES,
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

export async function saveUserAISettings(
  userId: string,
  input: {
    features?: Partial<AIUserChatSettings["features"]>;
    selectedModel?: string;
    selectedProvider?: AIUserChatSettings["selectedProvider"];
  }
) {
  const current = await getUserAISettings(userId);
  const nextProvider = input.selectedProvider ?? current.selectedProvider;
  const nextModel =
    input.selectedModel?.trim() ||
    current.selectedModel ||
    AI_PROVIDER_DEFINITIONS[nextProvider].defaultModel;
  const nextSettings: AIUserChatSettings = {
    selectedProvider: nextProvider,
    selectedModel: nextModel,
    features: input.features
      ? normalizeFeatures({ ...current.features, ...input.features })
      : current.features,
    updatedAt: new Date().toISOString(),
  };

  await saveMemoryRecord(getUserAISettingsMemoryKey(userId), {
    type: "procedural",
    category: "ai_settings",
    source: "user",
    value: nextSettings,
  });

  return nextSettings;
}

export async function saveAIProviderSettings(
  providers: Array<{
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
    enabled?: boolean;
    id: Exclude<SupportedAIProvider, "local">;
    models?: string[];
  }>
) {
  for (const provider of providers) {
    const defaults = AI_PROVIDER_DEFINITIONS[provider.id];
    const existing = await prisma.aIProvider.findUnique({
      where: { name: provider.id },
    }).catch((error) => {
      if (isMissingTableError(error)) {
        return null;
      }

      throw error;
    });

    const trimmedApiKey = provider.apiKey?.trim();
    const nextApiKey =
      trimmedApiKey && trimmedApiKey.length > 0
        ? trimmedApiKey
        : existing?.apiKey || process.env[defaults.apiKeyEnvVar ?? ""] || "";
    const nextModels = provider.models && provider.models.length > 0
      ? provider.models
      : parseModels(existing?.models, defaults.models);

    if (!existing) {
      await prisma.aIProvider.create({
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

    await prisma.aIProvider.update({
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

export async function getWorkspaceAIUsageSummary(workspaceId: string) {
  const empty = createEmptyUsageSummary();
  const now = Date.now();
  const since24Hours = new Date(now - 24 * 60 * 60 * 1000);
  const since7Days = new Date(now - 7 * 24 * 60 * 60 * 1000);

  try {
    const [raw24Hours, raw7Days, providerBreakdown] = await Promise.all([
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
  } catch (error) {
    if (!isMissingTableError(error)) {
      console.warn("[AI settings] Failed to load usage summary", error);
    }

    return empty;
  }
}

export async function getAISettingsPayload(userId: string, workspaceId: string): Promise<AISettingsPayload> {
  const [providers, settings, usage] = await Promise.all([
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
}

export async function loadConversation(
  userId: string,
  projectId?: string | null,
  conversationId?: string | null
): Promise<AIStoredConversation> {
  const resolvedConversationId = conversationId || (projectId ? `project:${projectId}` : "portfolio");
  const key = getConversationMemoryKey(userId, resolvedConversationId);
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
      totals: createEmptyUsageTotals(),
    };
  }

  return (
    parseConversationValue(record.value, fallbackTitle, userId, resolvedConversationId) ?? {
      userId,
      conversationId: resolvedConversationId,
      projectId: projectId ?? null,
      title: fallbackTitle,
      updatedAt: record.updatedAt.toISOString(),
      messages: [],
      totals: createEmptyUsageTotals(),
    }
  );
}

export async function appendConversationTurn(input: {
  assistantContent: string;
  conversationId: string;
  inputTokens: number;
  model: string;
  outputTokens: number;
  projectId?: string | null;
  provider: SupportedAIProvider;
  userContent: string;
  userId: string;
}) {
  const current = await loadConversation(input.userId, input.projectId, input.conversationId);
  const usage = calculateCost(input.provider, input.model, input.inputTokens, input.outputTokens);
  const timestamp = new Date().toISOString();
  const nextMessages = [
    ...current.messages,
    {
      id: `user-${randomUUID()}`,
      role: "user" as const,
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
      role: "assistant" as const,
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

  const nextConversation: AIStoredConversation = {
    ...current,
    projectId: input.projectId ?? current.projectId ?? null,
    title:
      current.title && current.title.trim().length > 0
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

  await saveMemoryRecord(getConversationMemoryKey(input.userId, input.conversationId), {
    type: "episodic",
    category: "chat",
    source: "system",
    value: nextConversation,
  });

  return nextConversation;
}
