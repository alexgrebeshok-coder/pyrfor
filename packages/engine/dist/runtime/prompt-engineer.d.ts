/**
 * prompt-engineer.ts — Pyrfor G+10: automated A/B testing harness for system-prompt variants.
 *
 * Captures per-session metrics (success, latency, tokens), assigns variants via
 * weighted random sampling, declares winners, and persists per-project experiment
 * profiles atomically.
 *
 * PERSISTENCE MODEL:
 *   Experiments stored in a single JSON file (default ~/.pyrfor/prompt-experiments.json).
 *   load() reads the file; save() uses an atomic tmp-then-rename pattern.
 *   Both are synchronous to keep the interface simple.
 *
 * VARIANT SAMPLING:
 *   Weighted random sampling via rng (default Math.random).
 *   Weight=0 variants are excluded from sampling.
 *   If all weights are 0, falls back to uniform distribution (treat each as weight=1).
 *
 * EVALUATION CRITERIA:
 *   success_rate : highest successes/sessions wins if delta >= significanceDelta
 *   latency      : lowest avg latency wins if (worst−best)/worst >= significanceDelta
 *   cost         : same as latency on totalCostUsd/sessions
 *   composite    : score = 0.6·successRate − 0.2·latencyNorm − 0.2·costNorm;
 *                  latencyNorm and costNorm are min-max normalised across variants;
 *                  highest score wins if delta >= significanceDelta
 *
 * STATUS SEMANTICS:
 *   won          = a non-control variant beat the control
 *   lost         = control beat every challenger
 *   inconclusive = no variant reached the significance threshold
 *   archived     = soft-deleted; excluded from default list() results
 *
 * NO-OP RULES:
 *   recordOutcome on archived / won / lost experiment returns current state unchanged.
 */
export type ExperimentStatus = 'draft' | 'running' | 'won' | 'lost' | 'inconclusive' | 'archived';
export interface PromptVariant {
    id: string;
    label: string;
    prompt: string;
    weight: number;
    createdAt: string;
}
export interface ExperimentMetrics {
    sessions: number;
    successes: number;
    failures: number;
    totalLatencyMs: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalCostUsd: number;
}
export interface PromptExperiment {
    id: string;
    project: string;
    agent?: string;
    hypothesis: string;
    status: ExperimentStatus;
    variants: PromptVariant[];
    metrics: Record<string, ExperimentMetrics>;
    minSamplesPerVariant: number;
    successCriterion: 'success_rate' | 'latency' | 'cost' | 'composite';
    significanceDelta: number;
    createdAt: string;
    decidedAt?: string;
    winner?: string;
}
export interface CreateExperimentInput {
    project: string;
    agent?: string;
    hypothesis: string;
    variants: Array<{
        label: string;
        prompt: string;
        weight?: number;
    }>;
    minSamplesPerVariant?: number;
    successCriterion?: PromptExperiment['successCriterion'];
    significanceDelta?: number;
}
export interface SessionOutcome {
    success: boolean;
    latencyMs: number;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
}
export interface PromptEngineer {
    createExperiment(input: CreateExperimentInput): PromptExperiment;
    start(experimentId: string): PromptExperiment | null;
    archive(experimentId: string): PromptExperiment | null;
    pickVariant(opts: {
        project: string;
        agent?: string;
        rng?: () => number;
    }): {
        experimentId: string;
        variantId: string;
        prompt: string;
    } | null;
    recordOutcome(experimentId: string, variantId: string, outcome: SessionOutcome): PromptExperiment | null;
    evaluate(experimentId: string): {
        decided: boolean;
        status: ExperimentStatus;
        winner?: string;
        reason: string;
    };
    list(filter?: {
        project?: string;
        status?: ExperimentStatus | ExperimentStatus[];
    }): PromptExperiment[];
    get(experimentId: string): PromptExperiment | null;
    load(): void;
    save(): void;
}
export interface PromptEngineerOptions {
    filePath?: string;
}
export declare function createPromptEngineer(opts?: PromptEngineerOptions): PromptEngineer;
//# sourceMappingURL=prompt-engineer.d.ts.map