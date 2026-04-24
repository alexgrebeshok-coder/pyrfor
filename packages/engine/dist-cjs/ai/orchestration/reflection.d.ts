/**
 * Agent Self-Reflection Loop
 *
 * Implements a Reflexion-style self-evaluation pattern:
 * 1. Agent produces initial response
 * 2. Reflection evaluator scores the response on quality criteria
 * 3. If score < threshold, agent is asked to revise
 * 4. Up to MAX_REFLECTION_ROUNDS revisions
 *
 * Quality criteria:
 * - Completeness: Did the agent answer all parts of the request?
 * - Specificity: Are recommendations concrete with numbers/names/dates?
 * - Actionability: Can the user act on the output immediately?
 * - Consistency: Does the output contradict the context?
 *
 * When to use:
 * - High-stakes reports (status reports, budget analysis)
 * - Multi-part complex requests
 * - When collaborative mode is not triggered
 */
import { getRouter } from '../providers';
import type { Message } from '../providers';
export interface ReflectionScore {
    completeness: number;
    specificity: number;
    actionability: number;
    consistency: number;
    overall: number;
    critique: string;
    suggestions: string[];
}
export interface ReflectionResult {
    finalResponse: string;
    roundsCompleted: number;
    scores: ReflectionScore[];
    improved: boolean;
}
export interface ReflectionOptions {
    router?: ReturnType<typeof getRouter>;
    provider?: string;
    model?: string;
    maxRounds?: number;
    qualityThreshold?: number;
    verbose?: boolean;
    /** Forwarded to AIRouter for cost attribution and circuit breaker metrics */
    agentId?: string;
    runId?: string;
    workspaceId?: string;
}
export declare function parseReflectionScore(raw: string): ReflectionScore | null;
export declare function runWithReflection(messages: Message[], options?: ReflectionOptions): Promise<ReflectionResult>;
/**
 * Determine if a request warrants reflection.
 * Reflection is expensive (2-3x API calls) — use selectively.
 */
export declare function shouldReflect(prompt: string, agentId: string): boolean;
//# sourceMappingURL=reflection.d.ts.map