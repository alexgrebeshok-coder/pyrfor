/**
 * pyrfor-fc-plan-act.ts
 *
 * Two-stage orchestration: a planning model produces a numbered plan, then an
 * execution model carries it out.
 *
 * Text extraction contract:
 *   fcRunner is expected to return an FCEnvelope whose `raw` field has a
 *   `lastAssistantText` property (string) populated by the caller/test stub.
 *   This module reads `envelope.raw.lastAssistantText` to extract the plan.
 *   If absent, it falls back to `String(envelope.output ?? '')`.
 */
import type { FCEnvelope } from './pyrfor-fc-adapter';
import { runFreeClaude } from './pyrfor-fc-adapter';
export interface PlanActOptions {
    task: string;
    workdir: string;
    fcRunner: typeof runFreeClaude;
    planModel: string;
    actModel: string;
    planSystemPrompt?: string;
    actSystemPrompt?: string;
    /** Override plan text → string[] conversion. Default: split on newlines, keep numbered lines. */
    parsePlan?: (text: string) => string[];
    trajectory?: {
        append: (ev: any) => void;
    };
}
export interface PlanActResult {
    plan: string[];
    planEnvelope: FCEnvelope;
    actEnvelope: FCEnvelope;
    totalCostUsd: number;
}
export declare function runPlanAct(opts: PlanActOptions): Promise<PlanActResult>;
//# sourceMappingURL=pyrfor-fc-plan-act.d.ts.map