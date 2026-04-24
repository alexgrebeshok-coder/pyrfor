/**
 * Agent Store - Session management for AI agents
 * Tracks agent runs, costs, tokens
 */
export interface AgentSession {
    id: string;
    agentId: string;
    status: 'idle' | 'running' | 'completed' | 'failed';
    task?: string;
    result?: unknown;
    model?: string;
    provider?: string;
    tokens: number;
    cost: number;
    startedAt?: string;
    endedAt?: string;
    createdAt: string;
}
export interface AgentConfig {
    id: string;
    name: string;
    role: string;
    model: string;
    provider: string;
    description: string;
}
export declare const AGENT_CONFIGS: AgentConfig[];
export declare class AgentSessionManager {
    /**
     * Create new session
     */
    createSession(data: {
        agentId: string;
        task?: string;
        model?: string;
        provider?: string;
    }): Promise<AgentSession>;
    /**
     * Start session
     */
    startSession(id: string): Promise<AgentSession | null>;
    /**
     * Complete session
     */
    completeSession(id: string, result: unknown, tokens: number, cost: number): Promise<AgentSession | null>;
    /**
     * Fail session
     */
    failSession(id: string, error: string): Promise<AgentSession | null>;
    /**
     * Get session by ID
     */
    getSession(id: string): Promise<AgentSession | null>;
    /**
     * Get recent sessions
     */
    getRecentSessions(limit?: number): Promise<AgentSession[]>;
    /**
     * Get sessions by agent
     */
    getSessionsByAgent(agentId: string, limit?: number): Promise<AgentSession[]>;
    /**
     * Get agent stats
     */
    getAgentStats(agentId: string): Promise<{
        total: number;
        completed: number;
        failed: number;
        totalTokens: number;
        totalCost: number;
    }>;
    /**
     * Clear old sessions (older than days)
     */
    clearOldSessions(days?: number): Promise<number>;
}
export declare function getAgentSessionManager(): AgentSessionManager;
//# sourceMappingURL=agent-store.d.ts.map