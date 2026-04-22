import "server-only";

import type { AIChatMessage } from './context-builder';
import { resolveChatProviderConfig } from './chat-store';
import type { SupportedAIProvider } from './chat-config';
import type { AIToolCall, AIToolDefinition } from './tools';

const PROVIDER_TIMEOUT_MS = 30_000;

export interface AIChatCompletionResult {
  content: string | null;
  model: string;
  provider: SupportedAIProvider;
  toolCalls?: AIToolCall[];
}

interface ChatCompletionInput {
  maxTokens?: number;
  messages: AIChatMessage[];
  model?: string | null;
  providerOrder: SupportedAIProvider[];
  temperature?: number;
  tools?: readonly AIToolDefinition[];
}

interface ProviderResponseShape {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
    message?: {
      content?: string | null;
      tool_calls?: AIToolCall[];
    };
  }>;
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

function buildProviderHeaders(provider: SupportedAIProvider, apiKey?: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_APP_URL || "https://ceoclaw.com";
    headers["X-Title"] = "CEOClaw";
  }

  return headers;
}

function resolveModel(provider: SupportedAIProvider, selectedProvider: SupportedAIProvider | undefined, selectedModel: string | null | undefined, fallbackModel: string) {
  if (selectedProvider === provider && selectedModel && selectedModel.trim().length > 0) {
    return selectedModel.trim();
  }

  return fallbackModel;
}

function parseCompletionResponse(
  data: ProviderResponseShape,
  provider: SupportedAIProvider,
  model: string
): AIChatCompletionResult | null {
  const choice = data.choices?.[0];
  const message = choice?.message;
  if (!message) {
    return null;
  }

  const content = message.content ?? null;
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : undefined;

  if (!content && (!toolCalls || toolCalls.length === 0)) {
    return null;
  }

  return {
    provider,
    model,
    content,
    toolCalls,
  };
}

async function fetchCompletion(
  provider: SupportedAIProvider,
  input: {
    apiKey?: string | null;
    baseUrl: string;
    maxTokens: number;
    messages: AIChatMessage[];
    model: string;
    temperature: number;
    tools?: readonly AIToolDefinition[];
  }
) {
  const requestBody: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
  };

  if (input.tools && input.tools.length > 0) {
    requestBody.tools = input.tools;
    requestBody.tool_choice = "auto";
  }

  const { signal, cleanup } = createTimeoutSignal(PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(input.baseUrl, {
      method: "POST",
      headers: buildProviderHeaders(provider, input.apiKey),
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      throw new Error(`${provider} error: ${response.status} - ${await response.text()}`);
    }

    return (await response.json()) as ProviderResponseShape;
  } finally {
    cleanup();
  }
}

export async function requestAIChatCompletion(input: ChatCompletionInput): Promise<AIChatCompletionResult> {
  const maxTokens = input.maxTokens ?? 1_200;
  const temperature = input.temperature ?? 0.4;
  const selectedProvider = input.providerOrder[0];
  let lastError: Error | null = null;

  for (const provider of input.providerOrder) {
    const config = await resolveChatProviderConfig(provider);
    if (!config.enabled) {
      continue;
    }
    if (provider !== "local" && !config.apiKey) {
      continue;
    }

    const model = resolveModel(provider, selectedProvider, input.model, config.defaultModel);

    try {
      const data = await fetchCompletion(provider, {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        maxTokens,
        messages: input.messages,
        model,
        temperature,
        tools: input.tools,
      });
      const result = parseCompletionResponse(data, provider, model);

      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("No AI provider is currently available.");
}

async function* consumeSseResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Provider returned an empty SSE body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        continue;
      }

      try {
        const data = JSON.parse(payload) as ProviderResponseShape;
        const content = data.choices?.[0]?.delta?.content;
        if (content) {
          yield content;
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    }
  }
}

async function streamCompletion(
  provider: SupportedAIProvider,
  input: {
    apiKey?: string | null;
    baseUrl: string;
    maxTokens: number;
    messages: AIChatMessage[];
    model: string;
    temperature: number;
  }
) {
  const { signal, cleanup } = createTimeoutSignal(PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(input.baseUrl, {
      method: "POST",
      headers: buildProviderHeaders(provider, input.apiKey),
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        stream: true,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`${provider} stream error: ${response.status} - ${await response.text()}`);
    }

    return consumeSseResponse(response);
  } finally {
    cleanup();
  }
}

export async function createAIChatStream(input: ChatCompletionInput) {
  const maxTokens = input.maxTokens ?? 1_200;
  const temperature = input.temperature ?? 0.4;
  const selectedProvider = input.providerOrder[0];
  let lastError: Error | null = null;

  for (const provider of input.providerOrder) {
    const config = await resolveChatProviderConfig(provider);
    if (!config.enabled) {
      continue;
    }
    if (provider !== "local" && !config.apiKey) {
      continue;
    }

    const model = resolveModel(provider, selectedProvider, input.model, config.defaultModel);

    try {
      return {
        provider,
        model,
        stream: await streamCompletion(provider, {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          maxTokens,
          messages: input.messages,
          model,
          temperature,
        }),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("No streaming AI provider is currently available.");
}
