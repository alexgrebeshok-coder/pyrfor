/**
 * ACP Client — Agent-Client-Protocol (JSON-RPC 2.0 over child-process stdio)
 *
 * Implements the March 2026 ACP spec for Pyrfor to supervise external coding
 * agents (FreeClaude, Codex CLI, ClaudeCode, Gemini CLI, Cursor).
 *
 * Wire format: line-delimited JSON  (each message ends with '\n').
 * Transport: child-process stdin (client→agent) / stdout (agent→client).
 *
 * Back-pressure note: The per-session EventQueue is unbounded. Events pile up
 * in a plain array if the consumer iterates slowly. For production with
 * high-throughput agents, cap the queue at ~1 000 events and apply flow
 * control at the transport layer.
 */
export type AcpEventType = 'plan' | 'agent_message_chunk' | 'tool_call' | 'tool_call_update' | 'diff' | 'terminal' | 'thought' | 'permission_request' | 'worker_frame';
export type AcpStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';
export type AcpToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other';
export interface AcpEvent {
    sessionId: string;
    type: AcpEventType;
    data: unknown;
    ts: number;
}
export interface AcpClientOptions {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    /** Default 10 000 ms */
    startupTimeoutMs?: number;
    /** Default 60 000 ms */
    requestTimeoutMs?: number;
    onEvent?: (e: AcpEvent) => void;
    onPermissionRequest?: (req: {
        sessionId: string;
        tool: string;
        args: unknown;
        kind: AcpToolKind;
    }) => Promise<'allow' | 'deny'> | 'allow' | 'deny';
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}
export interface AcpSession {
    id: string;
    cwd: string;
    prompt(text: string): Promise<{
        stopReason: AcpStopReason;
        events: AcpEvent[];
    }>;
    /** Send a mid-task injection; resolves when the agent acknowledges. */
    inject(text: string): Promise<void>;
    cancel(): Promise<void>;
    events(): AsyncIterable<AcpEvent>;
    close(): Promise<void>;
}
export interface AcpClient {
    initialize(): Promise<{
        protocolVersion: string;
        agentName: string;
    }>;
    newSession(opts?: {
        cwd?: string;
        meta?: Record<string, unknown>;
    }): Promise<AcpSession>;
    isAlive(): boolean;
    shutdown(): Promise<void>;
}
export declare class AcpTimeoutError extends Error {
    constructor(method: string, ms: number);
}
export declare function createAcpClient(opts: AcpClientOptions): AcpClient;
//# sourceMappingURL=acp-client.d.ts.map