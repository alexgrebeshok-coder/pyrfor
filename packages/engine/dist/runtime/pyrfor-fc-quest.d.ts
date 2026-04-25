/**
 * pyrfor-fc-quest.ts
 *
 * Quest Mode: orchestrate a chained series of FreeClaude invocations driven by
 * a QuestSpec. Steps run in order; each step can retry on failure.
 *
 * Template substitution supports:
 *   - {{varName}}              → from opts.templateVars
 *   - {{prev.lastFile}}        → last entry of previous envelope.filesTouched
 *   - {{prev.filesTouched}}    → comma-joined previous envelope.filesTouched
 *   - {{step.<id>.sessionId}}  → sessionId from a named prior step's envelope
 */
import type { FCEnvelope } from './pyrfor-fc-adapter';
import { runFreeClaude } from './pyrfor-fc-adapter';
export interface QuestStep {
    id: string;
    prompt: string;
    model?: string;
    successCriteria?: (env: FCEnvelope) => boolean | Promise<boolean>;
    retries?: number;
}
export interface QuestSpec {
    name: string;
    steps: QuestStep[];
}
export interface QuestStepResult {
    id: string;
    envelope: FCEnvelope;
    attempts: number;
    success: boolean;
}
export interface QuestResult {
    name: string;
    steps: QuestStepResult[];
    success: boolean;
    totalCostUsd: number;
}
export interface QuestOptions {
    spec: QuestSpec;
    workdir: string;
    fcRunner: typeof runFreeClaude;
    templateVars?: Record<string, string>;
    trajectory?: {
        append: (ev: any) => void;
    };
}
export declare function runQuest(opts: QuestOptions): Promise<QuestResult>;
//# sourceMappingURL=pyrfor-fc-quest.d.ts.map