/**
 * a2a-client.ts — Pyrfor A2A (Agent-to-Agent) protocol client.
 *
 * Allows Pyrfor to discover, register, and call remote agents over HTTP/JSON.
 *
 * Protocol endpoints expected on each remote agent:
 *   GET  {baseUrl}/.well-known/a2a-card       → { name, version, skills[] }
 *   POST {baseUrl}/skills/{skill}/invoke       → { output } | { error }
 *
 * Mirrors the structural patterns of acp-client.ts and mcp-client.ts but uses
 * Node global fetch (Node 20+) instead of stdio transports.
 */
export interface A2AAgentConfig {
    name: string;
    baseUrl: string;
    headers?: Record<string, string>;
    authToken?: string;
    startupTimeoutMs?: number;
    callTimeoutMs?: number;
}
export interface A2ASkillDescriptor {
    agentName: string;
    skill: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
}
export interface A2ACallResult {
    ok: boolean;
    output?: any;
    raw?: unknown;
    error?: string;
    durationMs: number;
    retries: number;
}
export interface A2AClient {
    register(cfg: A2AAgentConfig): Promise<void>;
    unregister(name: string): Promise<void>;
    shutdown(): Promise<void>;
    listAgents(): string[];
    listSkills(agentName?: string): A2ASkillDescriptor[];
    call(agentName: string, skill: string, input: Record<string, unknown>): Promise<A2ACallResult>;
    isRegistered(name: string): boolean;
    on(event: 'register' | 'unregister' | 'skill' | 'call', cb: (payload: any) => void): () => void;
}
export interface CreateA2AClientOptions {
    fetchImpl?: typeof fetch;
    retries?: number;
    retryBackoffMs?: number;
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
    clock?: () => number;
}
export declare function createA2AClient(opts?: CreateA2AClientOptions): A2AClient;
//# sourceMappingURL=a2a-client.d.ts.map