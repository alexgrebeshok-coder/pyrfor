/**
 * Agent Orchestrator - Coordinates all agents
 */
import { BaseAgent, AgentContext, AgentResult } from './base-agent';
export interface OrchestratorResult {
    agentId: string;
    agentName: string;
    result: AgentResult;
    duration: number;
}
export interface ParallelResult {
    success: boolean;
    results: OrchestratorResult[];
    totalDuration: number;
    totalTokens: number;
    totalCost: number;
}
export declare function getOrchestrator(): AgentOrchestrator;
export declare class AgentOrchestrator {
    private agents;
    private sessions;
    constructor();
    /**
     * Initialize all agents
     */
    private initializeAgents;
    /**
     * Get agent by ID
     */
    getAgent(agentId: string): BaseAgent | undefined;
    /**
     * Get all agents
     */
    getAllAgents(): BaseAgent[];
    /**
     * Execute single agent
     */
    execute(agentId: string, task: string, context?: AgentContext): Promise<OrchestratorResult>;
    /**
     * Execute multiple agents in parallel
     */
    executeParallel(tasks: {
        agentId: string;
        task: string;
    }[], context?: AgentContext): Promise<ParallelResult>;
    /**
     * Smart delegation - Main agent decides which worker to use
     */
    smartExecute(task: string, context?: AgentContext): Promise<OrchestratorResult>;
    /**
     * Get agent stats
     */
    getStats(agentId?: string): Promise<{
        total: number;
        completed: number;
        failed: number;
        totalTokens: number;
        totalCost: number;
    } | Record<string, {
        total: number;
        completed: number;
        failed: number;
        totalTokens: number;
        totalCost: number;
    }>>;
    /**
     * Get recent sessions
     */
    getRecentSessions(limit?: number): Promise<import("./agent-store").AgentSession[]>;
}
//# sourceMappingURL=orchestrator.d.ts.map