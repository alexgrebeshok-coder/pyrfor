/**
 * Base Agent - Abstract base class for all agents
 */
import { AIRouter, Message } from '../../ai/providers';
import { AgentSessionManager } from './agent-store';
export interface MemoryItem {
    type: string;
    category: string;
    key: string;
    value: unknown;
    confidence?: number;
    createdAt?: string;
}
type AgentContextMetadata = Record<string, unknown> & {
    toolInstructions?: string;
};
export interface AgentContext {
    projectId?: string;
    projectName?: string;
    tasks?: unknown[];
    risks?: unknown[];
    memory?: MemoryItem[] | {
        longTerm: MemoryItem[];
        recent: MemoryItem[];
    };
    metadata?: AgentContextMetadata;
}
export interface AgentResult {
    success: boolean;
    content: string;
    data?: unknown;
    tokens?: number;
    cost?: number;
    error?: string;
}
export declare abstract class BaseAgent {
    abstract id: string;
    abstract name: string;
    abstract role: string;
    abstract description: string;
    protected model: string;
    protected provider: string;
    protected router: AIRouter;
    protected sessions: AgentSessionManager;
    constructor(config: {
        model: string;
        provider: string;
    });
    /**
     * Execute agent task
     */
    abstract execute(task: string, context?: AgentContext): Promise<AgentResult>;
    /**
     * Get system prompt for this agent (used for streaming path)
     */
    abstract getSystemPrompt(context?: AgentContext): string;
    protected decorateSystemPrompt(basePrompt: string, context?: AgentContext): string;
    /**
     * Build messages array for direct provider streaming (bypasses execute())
     */
    buildMessages(task: string, context?: AgentContext): Message[];
    /**
     * Expose provider and model for streaming path
     */
    getModel(): string;
    getProvider(): string;
    /**
     * Chat with AI
     */
    protected chat(systemPrompt: string, userMessage: string, context?: AgentContext): Promise<string>;
    /**
     * Run agent with session tracking
     */
    run(task: string, context?: AgentContext): Promise<AgentResult>;
    /**
     * Estimate cost based on tokens
     */
    private estimateCost;
}
export {};
//# sourceMappingURL=base-agent.d.ts.map