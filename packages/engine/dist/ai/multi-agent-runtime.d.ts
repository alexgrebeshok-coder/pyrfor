import "server-only";
import { AIRouter } from './providers';
import type { AIRunInput, AIRunResult, AIMultiAgentRuntime, AIMultiAgentStep } from './types';
export type CollaborationStrategy = "gateway" | "provider";
export interface CollaborativeCallOutcome {
    result: AIRunResult;
    runtime: AIMultiAgentRuntime;
}
export interface CollaborativeExecutionOptions {
    router?: AIRouter;
    onStep?: (step: AIMultiAgentStep) => void;
    forceCollaborative?: boolean;
    /**
     * Max number of support-agent requests executed in parallel.
     * Defaults to MULTI_AGENT_SUPPORT_CONCURRENCY env (or 3).
     */
    supportConcurrency?: number;
}
interface CollaborationFocus {
    agentId: string;
    focus: string;
}
export declare function shouldUseCollaborativeRun(input: AIRunInput): boolean;
export declare function buildCollaborativePlan(input: AIRunInput): {
    collaborative: boolean;
    leaderAgentId: string;
    leaderAgentName: string;
    support: CollaborationFocus[];
    reason: string;
};
export declare function resolveProjectId(input: AIRunInput): string | undefined;
export declare function buildAugmentedPromptForTest(input: AIRunInput, basePrompt: string): Promise<string>;
export declare function rememberResultForTest(input: AIRunInput, result: AIRunResult): Promise<void>;
export declare function executeCollaborativeRun(input: AIRunInput, runId: string, strategy: CollaborationStrategy, options?: CollaborativeExecutionOptions): Promise<AIRunResult>;
export {};
//# sourceMappingURL=multi-agent-runtime.d.ts.map