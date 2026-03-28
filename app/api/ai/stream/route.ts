/**
 * /api/ai/stream — Server-Sent Events streaming endpoint
 *
 * Streams AI responses token-by-token via SSE.
 * Clients subscribe with EventSource or fetch + ReadableStream.
 *
 * POST /api/ai/stream
 * Body: { messages, provider?, model?, agentId?, projectId? }
 *
 * SSE event format:
 *   data: {"type":"token","content":"..."}\n\n
 *   data: {"type":"done","usage":{"inputTokens":N,"outputTokens":N}}\n\n
 *   data: {"type":"error","message":"..."}\n\n
 */

import { type NextRequest } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getRouter } from "@/lib/ai/providers";
import type { Message } from "@/lib/ai/providers";
import { estimateMessagesTokens, estimateTokens } from "@/lib/ai/cost-tracker";
import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";

interface StreamRequestBody {
  messages?: unknown;
  message?: unknown;
  provider?: unknown;
  model?: unknown;
  agentId?: unknown;
  projectId?: unknown;
}

interface SSEMessage {
  type: "token" | "done" | "error" | "ping";
  content?: string;
  message?: string;
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}

function isMessageRole(value: unknown): value is Message["role"] {
  return value === "system" || value === "assistant" || value === "user";
}

function sseChunk(data: SSEMessage): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function sseStream(
  handler: (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>
): Response {
  const encoder = new TextEncoder();
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
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function normalizeMessages(
  body: StreamRequestBody
): Message[] | null {
  if (Array.isArray(body.messages)) {
    const msgs = body.messages
      .filter(
        (m): m is { role: string; content: string } =>
          typeof m === "object" &&
          m !== null &&
          typeof (m as Record<string, unknown>).content === "string"
      )
      .map((m): Message => ({
        role: isMessageRole(m.role) ? m.role : "user",
        content: (m as Record<string, unknown>).content as string,
      }));
    if (msgs.length > 0) return msgs;
  }
  if (typeof body.message === "string" && body.message.trim()) {
    return [{ role: "user", content: body.message.trim() }];
  }
  return null;
}

export async function POST(request: NextRequest): Promise<Response> {
  const authResult = await authorizeRequest(request, { permission: "RUN_AI_ACTIONS" });
  if (authResult instanceof NextResponse) return authResult;

  let body: StreamRequestBody;
  try {
    body = (await request.json()) as StreamRequestBody;
  } catch {
    return new Response(sseChunk({ type: "error", message: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const messages = normalizeMessages(body);
  if (!messages) {
    return new Response(sseChunk({ type: "error", message: "messages required" }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const provider = typeof body.provider === "string" ? body.provider : undefined;
  const model = typeof body.model === "string" ? body.model : undefined;
  const agentId = typeof body.agentId === "string" ? body.agentId : undefined;

  const router = getRouter();
  const streamingProvider = router.getStreamingProvider(provider);

  // Fall back to non-streaming if no streaming provider available
  if (!streamingProvider?.chatStream) {
    return sseStream(async (controller) => {
      const encoder = new TextEncoder();
      const write = (data: SSEMessage) =>
        controller.enqueue(encoder.encode(sseChunk(data)));

      try {
        write({ type: "ping" });
        const result = await router.chat(messages, { provider, model, agentId });
        // Simulate streaming by chunking the result
        const words = result.split(" ");
        for (const word of words) {
          write({ type: "token", content: word + " " });
        }
        write({
          type: "done",
          usage: {
            inputTokens: estimateMessagesTokens(messages),
            outputTokens: estimateTokens(result),
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("stream: non-streaming fallback failed", { error: msg });
        write({ type: "error", message: msg });
      }
    });
  }

  return sseStream(async (controller) => {
    const encoder = new TextEncoder();
    const write = (data: SSEMessage) =>
      controller.enqueue(encoder.encode(sseChunk(data)));

    try {
      write({ type: "ping" });
      let outputText = "";

      for await (const chunk of streamingProvider.chatStream!(messages, { model })) {
        outputText += chunk;
        write({ type: "token", content: chunk });
      }

      write({
        type: "done",
        usage: {
          inputTokens: estimateMessagesTokens(messages),
          outputTokens: estimateTokens(outputText),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("stream: SSE generator error", { error: msg, agentId });
      write({ type: "error", message: msg });
    }
  });
}
