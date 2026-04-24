"use strict";
/**
 * SSE broadcast helper — shared module for emitting events to connected clients.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sseClients = void 0;
exports.broadcastSSE = broadcastSSE;
exports.sseClients = new Map();
/**
 * Broadcast an event to all connected SSE clients.
 * Call from any API route after mutations.
 */
function broadcastSSE(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [id, client] of exports.sseClients) {
        try {
            client.controller.enqueue(new TextEncoder().encode(payload));
        }
        catch {
            exports.sseClients.delete(id);
        }
    }
}
