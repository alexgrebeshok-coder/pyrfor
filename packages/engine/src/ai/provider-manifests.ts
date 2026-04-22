import OpenAI from "openai";

import { logger } from "@/lib/logger";
import type { ChatOptions, Message } from "@/lib/ai/providers";

type RuntimeEnv = NodeJS.ProcessEnv;

export const AI_PROVIDER_MANIFESTS_ENV = "CEOCLAW_AI_PROVIDER_MANIFESTS";

export interface AIProviderManifest {
  name: string;
  baseURL: string;
  apiKeyEnvVar: string;
  defaultModel: string;
  models?: string[];
  displayName?: string;
  description?: string;
  timeoutMs?: number;
}

export interface AIProviderManifestProvider {
  name: string;
  models: string[];
  chat(messages: Message[], options?: ChatOptions): Promise<string>;
  chatStream?(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown>;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeProviderManifest(value: unknown, index: number): AIProviderManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    logger.warn("Skipping invalid AI provider manifest entry", {
      index,
      reason: "not an object",
    });
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const baseURL = typeof record.baseURL === "string" ? record.baseURL.trim() : "";
  const apiKeyEnvVar =
    typeof record.apiKeyEnvVar === "string" ? record.apiKeyEnvVar.trim() : "";
  const defaultModel =
    typeof record.defaultModel === "string" ? record.defaultModel.trim() : "";
  const models = normalizeStringArray(record.models);
  const displayName =
    typeof record.displayName === "string" ? record.displayName.trim() : undefined;
  const description =
    typeof record.description === "string" ? record.description.trim() : undefined;
  const timeoutMs =
    typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs)
      ? record.timeoutMs
      : undefined;

  if (!name || !baseURL || !apiKeyEnvVar || !defaultModel) {
    logger.warn("Skipping invalid AI provider manifest entry", {
      index,
      name: name || null,
      reason: "missing required fields",
    });
    return null;
  }

  return {
    name,
    baseURL,
    apiKeyEnvVar,
    defaultModel,
    models: models.length > 0 ? models : [defaultModel],
    displayName,
    description,
    timeoutMs,
  };
}

export function loadConfiguredAIProviderManifests(
  env: RuntimeEnv = process.env
): AIProviderManifest[] {
  const raw = env[AI_PROVIDER_MANIFESTS_ENV];
  if (!raw?.trim()) {
    return [];
  }

  const parsed = tryParseJson(raw);
  if (!Array.isArray(parsed)) {
    logger.warn("AI provider manifests must be a JSON array", {
      envVar: AI_PROVIDER_MANIFESTS_ENV,
    });
    return [];
  }

  return parsed
    .map((item, index) => normalizeProviderManifest(item, index))
    .filter((item): item is AIProviderManifest => Boolean(item));
}

export function createConfiguredAIProvider(
  manifest: AIProviderManifest,
  env: RuntimeEnv = process.env
): AIProviderManifestProvider {
  const getApiKey = () => env[manifest.apiKeyEnvVar]?.trim() || "";

  return {
    name: manifest.name,
    models: manifest.models ?? [manifest.defaultModel],
    async chat(messages: Message[], options?: ChatOptions): Promise<string> {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error(`${manifest.apiKeyEnvVar} not set`);
      }

      const client = new OpenAI({
        apiKey,
        baseURL: manifest.baseURL,
        timeout: manifest.timeoutMs ?? 30_000,
      });

      const response = await client.chat.completions.create({
        model: options?.model || manifest.defaultModel,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
      });

      return response.choices[0]?.message?.content ?? "";
    },
    async *chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string, void, unknown> {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error(`${manifest.apiKeyEnvVar} not set`);
      }

      const client = new OpenAI({
        apiKey,
        baseURL: manifest.baseURL,
        timeout: manifest.timeoutMs ?? 30_000,
      });

      const stream = await client.chat.completions.create({
        model: options?.model || manifest.defaultModel,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield content;
        }
      }
    },
  };
}
