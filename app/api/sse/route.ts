/**
 * SSE endpoint for real-time task/project updates.
 * Clients connect via EventSource and receive JSON events when
 * tasks or projects are created, updated, or deleted.
 *
 * Events: task_created, task_updated, project_updated, approval_created, approval_reviewed
 */

import { NextRequest } from "next/server";
import { sseClients } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cleanup stale clients every 30s
if (typeof globalThis !== "undefined") {
  const g = globalThis as unknown as { __sseCleanup?: ReturnType<typeof setInterval> };
  if (!g.__sseCleanup) {
    g.__sseCleanup = setInterval(() => {
      const now = Date.now();
      for (const [id, client] of sseClients) {
        if (now - client.lastPing > 60_000) {
          try { client.controller.close(); } catch { /* already closed */ }
          sseClients.delete(id);
        }
      }
    }, 30_000);
  }
}

export async function GET(request: NextRequest) {
  const clientId = `sse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const stream = new ReadableStream({
    start(controller) {
      sseClients.set(clientId, { id: clientId, controller, lastPing: Date.now() });

      // Send initial connection event
      const welcome = `event: connected\ndata: ${JSON.stringify({ clientId, connectedAt: new Date().toISOString() })}\n\n`;
      controller.enqueue(new TextEncoder().encode(welcome));

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(`: heartbeat ${Date.now()}\n\n`));
          const client = sseClients.get(clientId);
          if (client) client.lastPing = Date.now();
        } catch {
          clearInterval(heartbeat);
          sseClients.delete(clientId);
        }
      }, 15_000);

      // Cleanup on abort
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        sseClients.delete(clientId);
        try { controller.close(); } catch { /* ok */ }
      });
    },
    cancel() {
      sseClients.delete(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
