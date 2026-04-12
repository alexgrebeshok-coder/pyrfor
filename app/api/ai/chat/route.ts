import { type NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { checkAIChatRateLimit } from "@/lib/ai/chat-rate-limit";
import {
  getConversationId,
  isSupportedAIProvider,
  type SupportedAIProvider,
} from "@/lib/ai/chat-config";
import { createAIChatStream, requestAIChatCompletion } from "@/lib/ai/chat-service";
import {
  appendConversationTurn,
  getAISettingsPayload,
  getUserAISettings,
  loadConversation,
} from "@/lib/ai/chat-store";
import type { AIChatMessage } from "@/lib/ai/context-builder";
import { buildChatGrounding } from "@/lib/ai/grounding";
import { buildKernelChatContext } from "@/lib/ai/kernel-context-stack";
import {
  executeAIKernelToolCalls,
  getAIKernelToolDefinitions,
} from "@/lib/ai/kernel-tool-plane";
import type { AIToolResult } from "@/lib/ai/tools";
import { calculateCost, estimateMessagesTokens, estimateTokens } from "@/lib/ai/cost-tracker";
import { consumeAiQuota } from "@/lib/billing";
import { logger } from "@/lib/logger";

interface ChatRequestBody {
  conversationId?: unknown;
  enableTools?: unknown;
  loadMemory?: unknown;
  locale?: unknown;
  message?: unknown;
  messages?: unknown;
  model?: unknown;
  projectId?: unknown;
  provider?: unknown;
  stream?: unknown;
  agentId?: unknown;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveProviderOrder(preferredProvider: SupportedAIProvider): SupportedAIProvider[] {
  const providerOrder: SupportedAIProvider[] = [];

  const add = (provider: SupportedAIProvider) => {
    if (!providerOrder.includes(provider)) {
      providerOrder.push(provider);
    }
  };

  add(preferredProvider);
  add("openrouter");
  add("zai");
  add("openai");
  add("local");

  return providerOrder;
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeProvider(value: unknown) {
  return isSupportedAIProvider(value) ? value : undefined;
}

function normalizeChatMessages(body: ChatRequestBody): AIChatMessage[] {
  if (Array.isArray(body.messages)) {
    const normalized = body.messages
      .map((candidate) => normalizeMessageCandidate(candidate))
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

  const candidate = value as { content?: unknown; role?: unknown };
  const content = normalizeString(candidate.content);
  if (!content) {
    return null;
  }

  const role =
    candidate.role === "assistant" || candidate.role === "system"
      ? candidate.role
      : "user";

  return {
    role,
    content,
  };
}

function getLatestUserMessage(messages: AIChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function buildConversationMessages(
  storedMessages: Array<{ content: string; role: "assistant" | "system" | "user" }>,
  requestMessages: AIChatMessage[]
) {
  if (requestMessages.length > 1) {
    return requestMessages;
  }

  const history = storedMessages.map((message) => ({
    role: message.role,
    content: message.content,
  })) as AIChatMessage[];

  return [...history.slice(-10), ...requestMessages];
}

function createSseResponse(
  handler: (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>
) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await handler(controller);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function writeSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: Record<string, unknown>
) {
  controller.enqueue(
    new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
  );
}

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "RUN_AI_ACTIONS",
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const { searchParams } = new URL(request.url);
    const projectId = normalizeString(searchParams.get("projectId"));
    const conversationId =
      normalizeString(searchParams.get("conversationId")) ?? getConversationId(projectId);
    const [settingsPayload, conversation] = await Promise.all([
      getAISettingsPayload(authResult.accessProfile.userId, authResult.workspace.id),
      projectId || searchParams.has("conversationId")
        ? loadConversation(authResult.accessProfile.userId, projectId, conversationId)
        : Promise.resolve(null),
    ]);
    const { providers, settings, aiStatus } = settingsPayload;

    return NextResponse.json({
      status: "ok",
      providers: providers.map((provider) => provider.id),
      models: providers.flatMap((provider) =>
        provider.models.map((model) => ({
          provider: provider.id,
          model,
        }))
      ),
      default: settings.selectedProvider,
      providerRegistry: providers,
      settings,
      conversation,
      aiStatus,
    });
  } catch (error) {
    logger.error("[AI Chat] GET error", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await authorizeRequest(request, {
      permission: "RUN_AI_ACTIONS",
    });

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = (await request.json()) as ChatRequestBody;
    const requestMessages = normalizeChatMessages(body);

    if (requestMessages.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Messages required",
        },
        { status: 400 }
      );
    }

    const rateLimit = checkAIChatRateLimit(authResult.accessProfile.userId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: "AI chat rate limit exceeded.",
          code: "RATE_LIMIT_EXCEEDED",
          resetAt: rateLimit.resetAt,
        },
        { status: 429 }
      );
    }

    const billingLimit = await consumeAiQuota({
      organizationSlug: authResult.accessProfile.organizationSlug,
    });

    if (billingLimit) {
      return billingLimit;
    }

    const userSettings = await getUserAISettings(authResult.accessProfile.userId);
    const projectId = normalizeString(body.projectId);
    const locale = normalizeString(body.locale);
    const agentId = normalizeString(body.agentId);
    const requestedProvider = normalizeProvider(body.provider) ?? userSettings.selectedProvider;
    const requestedModel = normalizeString(body.model) ?? userSettings.selectedModel;
    const stream = normalizeBoolean(body.stream);
    const enableTools = normalizeBoolean(body.enableTools, true) && !stream;
    const shouldLoadMemory = normalizeBoolean(body.loadMemory, true);
    const conversationId =
      normalizeString(body.conversationId) ?? getConversationId(projectId);
    const storedConversation =
      shouldLoadMemory && requestMessages.length <= 1
        ? await loadConversation(
            authResult.accessProfile.userId,
            projectId,
            conversationId
          )
        : null;
    const baseMessages = storedConversation
      ? buildConversationMessages(storedConversation.messages, requestMessages)
      : requestMessages;
    const contextResult = await buildKernelChatContext({
      messages: baseMessages,
      agentId,
      projectId,
      locale,
      workspaceId: authResult.workspace.id,
    });
    const grounding = buildChatGrounding(contextResult.bundle);
    const messages = contextResult.messages ?? baseMessages;
    const preferredProvider =
      requestedProvider === "local"
        ? "local"
        : requestedProvider;
    const providerOrder = resolveProviderOrder(preferredProvider);
    const latestUserMessage = getLatestUserMessage(requestMessages);
    const tools = enableTools ? getAIKernelToolDefinitions() : undefined;

    logger.info(
      `[AI Chat] scope=${contextResult.bundle.scope} focus=${contextResult.bundle.focus} provider=${preferredProvider} memory=${Boolean(storedConversation?.messages.length)} stream=${stream}`
    );

    if (stream) {
      return createSseResponse(async (controller) => {
        writeSse(controller, {
          type: "ready",
          conversationId,
          facts: grounding.facts,
          confidence: grounding.confidence,
          context: {
            scope: contextResult.bundle.scope,
            focus: contextResult.bundle.focus,
            source: contextResult.bundle.source,
            projectId: contextResult.bundle.projectId,
            projectName: contextResult.bundle.projectName,
          },
        });

        try {
          const streamResult = await createAIChatStream({
            messages,
            model: requestedModel,
            providerOrder,
          });
          const inputTokens = estimateMessagesTokens(messages);
          let outputText = "";

          for await (const chunk of streamResult.stream) {
            outputText += chunk;
            writeSse(controller, {
              type: "token",
              content: chunk,
            });
          }

          const outputTokens = estimateTokens(outputText);
          const usage = calculateCost(
            streamResult.provider,
            streamResult.model,
            inputTokens,
            outputTokens
          );

          const conversation = await appendConversationTurn({
            userId: authResult.accessProfile.userId,
            conversationId,
            projectId,
            provider: streamResult.provider,
            model: streamResult.model,
            userContent: latestUserMessage,
            assistantContent: outputText,
            inputTokens,
            outputTokens,
          });

          writeSse(controller, {
            type: "done",
            provider: streamResult.provider,
            model: streamResult.model,
            response: outputText,
            usage: {
              inputTokens,
              outputTokens,
              estimatedCostUsd: usage.costUsd,
            },
            conversation,
          });
        } catch (error) {
          writeSse(controller, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }

    const result = await requestAIChatCompletion({
      messages,
      model: requestedModel,
      providerOrder,
      tools,
    });
    let toolResults: AIToolResult[] | null = null;
    let responseText = result.content ?? "";

    if (result.toolCalls && result.toolCalls.length > 0) {
      toolResults = await executeAIKernelToolCalls(result.toolCalls);
      const toolMessages = toolResults.map((toolResult) => toolResult.displayMessage);
      responseText = responseText
        ? `${responseText}\n\n${toolMessages.join("\n\n")}`
        : toolMessages.join("\n\n");
    }

    const inputTokens = estimateMessagesTokens(messages);
    const outputTokens = estimateTokens(responseText);
    const usage = calculateCost(result.provider, result.model, inputTokens, outputTokens);
    const conversation = await appendConversationTurn({
      userId: authResult.accessProfile.userId,
      conversationId,
      projectId,
      provider: result.provider,
      model: result.model,
      userContent: latestUserMessage,
      assistantContent: responseText,
      inputTokens,
      outputTokens,
    });

    return NextResponse.json({
      success: true,
      response: responseText,
      provider: result.provider,
      model: result.model,
      facts: grounding.facts,
      confidence: grounding.confidence,
      toolResults,
      conversationId,
      conversation,
      usage: {
        inputTokens,
        outputTokens,
        estimatedCostUsd: usage.costUsd,
      },
      context: {
        scope: contextResult.bundle.scope,
        focus: contextResult.bundle.focus,
        source: contextResult.bundle.source,
        projectId: contextResult.bundle.projectId,
        projectName: contextResult.bundle.projectName,
        summary: contextResult.bundle.summary,
        alertCount: contextResult.bundle.alertFeed.summary.total,
        evidenceCount: contextResult.bundle.evidence.summary.total,
      },
    });
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

    logger.error("[AI Chat] POST error", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
