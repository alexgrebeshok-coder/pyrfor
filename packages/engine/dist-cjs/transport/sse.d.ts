/**
 * SSE broadcast helper — shared module for emitting events to connected clients.
 */
type SSEClient = {
    id: string;
    controller: ReadableStreamDefaultController;
    lastPing: number;
};
export declare const sseClients: Map<string, SSEClient>;
/**
 * Broadcast an event to all connected SSE clients.
 * Call from any API route after mutations.
 */
export declare function broadcastSSE(event: string, data: Record<string, unknown>): void;
export {};
//# sourceMappingURL=sse.d.ts.map