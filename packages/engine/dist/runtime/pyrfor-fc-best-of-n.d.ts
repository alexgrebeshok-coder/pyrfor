/**
 * pyrfor-fc-best-of-n.ts
 *
 * Orchestration strategy: spawn N parallel FreeClaude branches and pick the
 * winner by score.
 *
 * Each branch runs in its own workdir (default `${workdir}/.bestofn/branch-${i}`).
 * Parallelism is capped via a simple semaphore (default = n).
 * Failed branches receive score 0 and do not block the others.
 * Ties are broken by earliest index.
 */
import type { FCEnvelope } from './pyrfor-fc-adapter';
import { runFreeClaude } from './pyrfor-fc-adapter';
export interface BestOfNOptions {
    prompt: string;
    workdir: string;
    n: number;
    fcRunner: typeof runFreeClaude;
    scoreFn: (env: FCEnvelope, workdir: string) => Promise<{
        total: number;
        breakdown: any;
    }>;
    /** Override per-branch workdir. Default: `${workdir}/.bestofn/branch-${i}` */
    branchWorkdir?: (i: number) => string;
    /** Per-branch model override (length = n). */
    models?: string[];
    /**
     * Per-branch temperature (length = n).
     * NOTE: FCRunOptions does not expose a `temperature` field, so this value is
     * stored in BranchResult for caller reference but is NOT forwarded to fcRunner.
     */
    temperatures?: number[];
    /** Max concurrent branches. Defaults to n. */
    parallelism?: number;
    onBranchComplete?: (i: number, res: BranchResult) => void;
}
export interface BranchResult {
    i: number;
    envelope: FCEnvelope;
    score: {
        total: number;
        breakdown: any;
    };
    workdir: string;
    durationMs: number;
    error?: string;
}
export interface BestOfNResult {
    winner: BranchResult;
    branches: BranchResult[];
    totalCostUsd: number;
}
export declare function runBestOfN(opts: BestOfNOptions): Promise<BestOfNResult>;
//# sourceMappingURL=pyrfor-fc-best-of-n.d.ts.map