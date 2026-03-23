/**
 * AI Chat API - context-aware, local-first
 */

import { type NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  buildAIChatContextBundle,
  buildAIChatMessages,
  type AIChatMessage,
} from "@/lib/ai/context-builder";
import { buildChatGrounding } from "@/lib/ai/grounding";
import { consumeAiQuota } from "@/lib/billing";
import { logger } from "@/lib/logger";

interface ChatRequestBody {
  locale?: unknown;
  message?: unknown;
  messages?: unknown;
  provider?: unknown;
  projectId?: unknown;
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

    logger.info(
      `[AI Chat] scope=${contextBundle.scope} focus=${contextBundle.focus} source=${contextBundle.source} provider=${requestedProvider ?? "auto"}`
    );

    for (const provider of providerOrder) {
      try {
        const result = await attemptProvider(provider, augmentedMessages, modelVersion);
        if (result) {
          return NextResponse.json({
            success: true,
            response: result.content,
            provider: result.provider,
            model: result.model,
            facts: grounding.facts,
            confidence: grounding.confidence,
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
  modelVersion: string
) {
  switch (provider) {
    case "local":
      return attemptLocalModel(messages, modelVersion);
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
      });
    default:
      return null;
  }
}

async function attemptLocalModel(messages: AIChatMessage[], modelVersion: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_MODEL_TIMEOUT);

  try {
    const response = await fetch(LOCAL_MODEL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelVersion,
        messages,
        max_tokens: 700,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`local error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("Empty response from local model");
    }

    return {
      provider: "local" as const,
      model: modelVersion,
      content,
    };
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
}) {
  const response = await fetch(input.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      max_tokens: 700,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${input.provider} error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error(`Empty response from ${input.provider}`);
  }

  return {
    provider: input.provider,
    model: input.model,
    content,
  };
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
