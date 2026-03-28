/**
 * SSE broadcast helper — shared module for emitting events to connected clients.
 */

type SSEClient = {
  id: string;
  controller: ReadableStreamDefaultController;
  lastPing: number;
};

export const sseClients = new Map<string, SSEClient>();

/**
 * Broadcast an event to all connected SSE clients.
 * Call from any API route after mutations.
 */
export function broadcastSSE(event: string, data: Record<string, unknown>) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, client] of sseClients) {
    try {
      client.controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      sseClients.delete(id);
    }
  }
}
