/**
 * Worker Agents - Specialized agents for different tasks
 */
import { BaseAgent, AgentContext, AgentResult } from './base-agent';
export declare class WorkerAgent extends BaseAgent {
    id: string;
    name: string;
    role: string;
    description: string;
    constructor();
    getSystemPrompt(context?: AgentContext): string;
    execute(task: string, context?: AgentContext): Promise<AgentResult>;
}
export declare class ResearchAgent extends BaseAgent {
    id: string;
    name: string;
    role: string;
    description: string;
    constructor();
    getSystemPrompt(context?: AgentContext): string;
    execute(task: string, context?: AgentContext): Promise<AgentResult>;
}
export declare class CoderAgent extends BaseAgent {
    id: string;
    name: string;
    role: string;
    description: string;
    constructor();
    getSystemPrompt(context?: AgentContext): string;
    execute(task: string, context?: AgentContext): Promise<AgentResult>;
}
export declare class WriterAgent extends BaseAgent {
    id: string;
    name: string;
    role: string;
    description: string;
    constructor();
    getSystemPrompt(context?: AgentContext): string;
    execute(task: string, context?: AgentContext): Promise<AgentResult>;
}
export declare class PlannerAgent extends BaseAgent {
    id: string;
    name: string;
    role: string;
    description: string;
    constructor();
    getSystemPrompt(context?: AgentContext): string;
    execute(task: string, context?: AgentContext): Promise<AgentResult>;
}
export declare class ReviewerAgent extends BaseAgent {
    id: string;
    name: string;
    role: string;
    description: string;
    constructor();
    getSystemPrompt(context?: AgentContext): string;
    execute(task: string, context?: AgentContext): Promise<AgentResult>;
}
//# sourceMappingURL=worker-agents.d.ts.map