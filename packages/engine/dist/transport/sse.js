/**
 * SSE broadcast helper — shared module for emitting events to connected clients.
 */
export const sseClients = new Map();
/**
 * Broadcast an event to all connected SSE clients.
 * Call from any API route after mutations.
 */
export function broadcastSSE(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [id, client] of sseClients) {
        try {
            client.controller.enqueue(new TextEncoder().encode(payload));
        }
        catch (_a) {
            sseClients.delete(id);
        }
    }
}
