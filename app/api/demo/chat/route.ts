import { type NextRequest, NextResponse } from "next/server";

import { type AIChatMessage } from "@/lib/ai/context-builder";
import { buildDemoChatContext } from "@/lib/demo/context";
import { composeDemoChatResponse } from "@/lib/demo/chat";
import { logger } from "@/lib/logger";

interface DemoChatRequestBody {
  locale?: unknown;
  message?: unknown;
  messages?: unknown;
  projectId?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as DemoChatRequestBody;
    const messages = normalizeChatMessages(body);

    if (messages.length === 0) {
      return NextResponse.json({ error: "Messages required" }, { status: 400 });
    }

    const context = await buildDemoChatContext({
      messages,
      projectId: normalizeString(body.projectId),
      locale: normalizeString(body.locale),
    });
    const response = composeDemoChatResponse(context);

    logger.info(
      `[Demo Chat] scope=${context.scope} focus=${context.focus} source=${context.source}`
    );

    return NextResponse.json({
      success: true,
      response,
      context: {
        scope: context.scope,
        focus: context.focus,
        source: context.source,
        projectId: context.projectId,
        projectName: context.projectName,
        summary: context.summary,
        alertCount: context.alertFeed.summary.total,
        evidenceCount: context.evidence.summary.total,
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

    logger.error("[Demo Chat] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

function normalizeChatMessages(body: DemoChatRequestBody): AIChatMessage[] {
  if (Array.isArray(body.messages)) {
    return body.messages
      .map((message) => normalizeMessage(message))
      .filter((message): message is AIChatMessage => message !== null);
  }

  const message = normalizeString(body.message);
  if (!message) {
    return [];
  }

  return [{ role: "user" as const, content: message }];
}

function normalizeMessage(value: unknown): AIChatMessage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as { role?: unknown; content?: unknown };
  const role = candidate.role as AIChatMessage["role"] | undefined;
  const content = normalizeString(candidate.content);

  if (!content || (role !== "user" && role !== "assistant" && role !== "system")) {
    return null;
  }

  return {
    role,
    content,
  };
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
