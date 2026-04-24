/**
 * Main Agent - Orchestrator and communicator
 * Delegates tasks to workers, doesn't execute itself
 */
import { BaseAgent, AgentContext, AgentResult } from './base-agent';
export declare class MainAgent extends BaseAgent {
    id: string;
    name: string;
    role: string;
    description: string;
    constructor();
    getSystemPrompt(context?: AgentContext): string;
    execute(task: string, context?: AgentContext): Promise<AgentResult>;
    private parseRecommendation;
}
//# sourceMappingURL=main-agent.d.ts.map