/**
 * AI Chat API - context-aware, local-first, with native function calling
 */

import { type NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  buildAIChatContextBundle,
  buildAIChatMessages,
  type AIChatMessage,
} from "@/lib/ai/context-builder";
import { buildChatGrounding } from "@/lib/ai/grounding";
import { AI_TOOLS, type AIToolCall, type AIToolResult } from "@/lib/ai/tools";
import { executeToolCalls } from "@/lib/ai/tool-executor";
import { consumeAiQuota } from "@/lib/billing";
import { logger } from "@/lib/logger";

interface ChatRequestBody {
  locale?: unknown;
  message?: unknown;
  messages?: unknown;
  provider?: unknown;
  projectId?: unknown;
  enableTools?: unknown;
}

interface ProviderResult {
  provider: string;
  model: string;
  content: string | null;
  toolCalls?: AIToolCall[];
}

type ChatProvider = "local" | "zai" | "openrouter";

const LOCAL_MODEL_URL = "http://localhost:8000/v1/chat/completions";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const ZAI_API_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const ZAI_API_KEY = process.env.ZAI_API_KEY || "";
const LOCAL_MODEL_TIMEOUT = 10_000;

export async function POST(request: NextRequest) {
  try {
    const authResult = await authorizeRequest(request, {
      permission: "RUN_AI_ACTIONS",
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = (await request.json()) as ChatRequestBody;
    const messages = normalizeChatMessages(body);

    if (messages.length === 0) {
      return NextResponse.json({ error: "Messages required" }, { status: 400 });
    }

    const billingLimit = await consumeAiQuota({
      organizationSlug: authResult.accessProfile.organizationSlug,
    });

    if (billingLimit) {
      return billingLimit;
    }

    const projectId = normalizeString(body.projectId);
    const requestedProvider = normalizeProvider(body.provider);
    const contextBundle = await buildAIChatContextBundle({
      messages,
      projectId,
      locale: normalizeString(body.locale),
    });
    const grounding = buildChatGrounding(contextBundle);
    const augmentedMessages = buildAIChatMessages(messages, contextBundle);
    const modelVersion = contextBundle.focus === "financial" ? "v11" : "v10";
    const providerOrder = resolveProviderOrder(requestedProvider);
    const enableTools = body.enableTools !== false; // default: enabled

    logger.info(
      `[AI Chat] scope=${contextBundle.scope} focus=${contextBundle.focus} source=${contextBundle.source} provider=${requestedProvider ?? "auto"} tools=${enableTools}`
    );

    for (const provider of providerOrder) {
      try {
        const result = await attemptProvider(provider, augmentedMessages, modelVersion, enableTools);
        if (result) {
          // Handle tool calls: execute them and return results
          let toolResults: AIToolResult[] | undefined;
          let responseText = result.content ?? "";

          if (result.toolCalls && result.toolCalls.length > 0) {
            logger.info(
              `[AI Chat] Executing ${result.toolCalls.length} tool call(s): ${result.toolCalls.map((c) => c.function.name).join(", ")}`
            );
            toolResults = await executeToolCalls(result.toolCalls);

            // Build display text from tool results
            const toolMessages = toolResults.map((r) => r.displayMessage);
            responseText = responseText
              ? `${responseText}\n\n${toolMessages.join("\n\n")}`
              : toolMessages.join("\n\n");
          }

          return NextResponse.json({
            success: true,
            response: responseText,
            provider: result.provider,
            model: result.model,
            facts: grounding.facts,
            confidence: grounding.confidence,
            toolResults: toolResults ?? null,
            context: {
              scope: contextBundle.scope,
              focus: contextBundle.focus,
              source: contextBundle.source,
              projectId: contextBundle.projectId,
              projectName: contextBundle.projectName,
              summary: contextBundle.summary,
              alertCount: contextBundle.alertFeed.summary.total,
              evidenceCount: contextBundle.evidence.summary.total,
            },
          });
        }
      } catch (error) {
        logger.warn(
          `[AI Chat] ${provider} provider failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "No AI provider available (local model failed and cloud fallbacks are not configured)",
      },
      { status: 503 }
    );
  } catch (error) {
    if (error instanceof Error && /^Project ".*" was not found\.$/.test(error.message)) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: "PROJECT_NOT_FOUND",
        },
        { status: 404 }
      );
    }

    logger.error("[AI Chat] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    provider: "local-first",
    fallback: "zai",
  });
}

async function attemptProvider(
  provider: ChatProvider,
  messages: AIChatMessage[],
  modelVersion: string,
  enableTools: boolean,
): Promise<ProviderResult | null> {
  const tools = enableTools ? AI_TOOLS : undefined;

  switch (provider) {
    case "local":
      return attemptLocalModel(messages, modelVersion, tools);
    case "zai":
      if (!ZAI_API_KEY) {
        return null;
      }
      return attemptOpenAICompatibleProvider({
        apiKey: ZAI_API_KEY,
        apiUrl: ZAI_API_URL,
        model: "glm-5",
        messages,
        provider: "zai",
        tools,
      });
    case "openrouter":
      if (!OPENROUTER_API_KEY) {
        return null;
      }
      return attemptOpenAICompatibleProvider({
        apiKey: OPENROUTER_API_KEY,
        apiUrl: OPENROUTER_API_URL,
        model: "openai/gpt-4o-mini",
        messages,
        provider: "openrouter",
        tools,
      });
    default:
      return null;
  }
}

async function attemptLocalModel(
  messages: AIChatMessage[],
  modelVersion: string,
  tools?: typeof AI_TOOLS,
): Promise<ProviderResult | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_MODEL_TIMEOUT);

  try {
    const requestBody: Record<string, unknown> = {
      model: modelVersion,
      messages,
      max_tokens: 1200,
      temperature: 0.4,
    };

    if (tools) {
      requestBody.tools = tools;
      requestBody.tool_choice = "auto";
    }

    const response = await fetch(LOCAL_MODEL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`local error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return parseProviderResponse(data, "local", modelVersion);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function attemptOpenAICompatibleProvider(input: {
  apiKey: string;
  apiUrl: string;
  model: string;
  messages: AIChatMessage[];
  provider: "zai" | "openrouter";
  tools?: typeof AI_TOOLS;
}): Promise<ProviderResult | null> {
  const requestBody: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    max_tokens: 1200,
    temperature: 0.4,
  };

  if (input.tools) {
    requestBody.tools = input.tools;
    requestBody.tool_choice = "auto";
  }

  const response = await fetch(input.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${input.provider} error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return parseProviderResponse(data, input.provider, input.model);
}

function parseProviderResponse(
  data: Record<string, unknown>,
  provider: string,
  model: string,
): ProviderResult | null {
  const choices = data.choices as Array<{
    message?: {
      content?: string | null;
      tool_calls?: AIToolCall[];
    };
  }> | undefined;

  const message = choices?.[0]?.message;
  if (!message) return null;

  const content = message.content ?? null;
  const toolCalls = message.tool_calls;

  // Must have either content or tool_calls
  if (!content && (!toolCalls || toolCalls.length === 0)) {
    return null;
  }

  return { provider, model, content, toolCalls };
}

function resolveProviderOrder(requestedProvider: ChatProvider | null): ChatProvider[] {
  const defaults: ChatProvider[] = ["local", "zai", "openrouter"];

  if (!requestedProvider) {
    return defaults;
  }

  return [
    requestedProvider,
    ...defaults.filter((provider) => provider !== requestedProvider),
  ];
}

function normalizeChatMessages(body: ChatRequestBody): AIChatMessage[] {
  if (Array.isArray(body.messages)) {
    const normalized = body.messages
      .map((message) => normalizeMessageCandidate(message))
      .filter((message): message is AIChatMessage => message !== null);

    if (normalized.length > 0) {
      return normalized;
    }
  }

  const shortcut = normalizeString(body.message);
  if (!shortcut) {
    return [];
  }

  return [{ role: "user", content: shortcut }];
}

function normalizeMessageCandidate(value: unknown): AIChatMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const message = value as { content?: unknown; role?: unknown };
  const content = normalizeString(message.content);
  if (!content) {
    return null;
  }

  const role =
    message.role === "system" || message.role === "assistant" ? message.role : "user";

  return {
    role,
    content,
  };
}

function normalizeProvider(value: unknown): ChatProvider | null {
  const provider = normalizeString(value)?.toLowerCase();

  if (provider === "local" || provider === "zai" || provider === "openrouter") {
    return provider;
  }

  return null;
}

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
