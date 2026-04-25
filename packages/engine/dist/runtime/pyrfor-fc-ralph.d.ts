import type { FCEnvelope } from './pyrfor-fc-adapter.js';
import { runFreeClaude } from './pyrfor-fc-adapter.js';
import type { EarlyStopPredicate } from './pyrfor-fc-early-stop.js';
import type { StruggleDetector } from './pyrfor-fc-struggle-detect.js';
export interface IterationResult {
    iter: number;
    envelope: FCEnvelope;
    score: {
        total: number;
        breakdown: any;
    };
    durationMs: number;
    filesTouched: string[];
    costUsd: number;
    abortReason?: 'struggle' | 'max-iter' | 'threshold-reached' | 'fatal';
}
export interface RalphFcOptions {
    prompt: string;
    workdir: string;
    maxIterations: number;
    scoreThreshold: number;
    fcRunner: typeof runFreeClaude;
    scoreFn: (envelope: FCEnvelope, workdir: string) => Promise<{
        total: number;
        breakdown: any;
    }>;
    buildContextForIteration?: (iter: number, history: IterationResult[]) => Promise<{
        appendSystemPrompt?: string;
        resumeSessionId?: string;
    }>;
    onIteration?: (r: IterationResult) => void;
    struggleDetector?: StruggleDetector;
    earlyStop?: EarlyStopPredicate;
    trajectory?: {
        append: (ev: any) => void;
    };
    fcModel?: string;
}
export interface RalphFcResult {
    finalIter: number;
    bestIter: IterationResult;
    history: IterationResult[];
    stoppedReason: 'threshold-reached' | 'max-iter' | 'struggle' | 'fatal';
    totalCostUsd: number;
}
export declare function runRalphFc(opts: RalphFcOptions): Promise<RalphFcResult>;
//# sourceMappingURL=pyrfor-fc-ralph.d.ts.map