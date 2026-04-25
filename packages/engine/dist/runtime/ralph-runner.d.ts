import type { RalphSpec } from './ralph-spec.js';
import type { VerifyCheck, VerifyResult } from './verify-engine.js';
export interface RalphAgentRunner {
    run(prompt: string, opts: {
        iteration: number;
        abortSignal?: AbortSignal;
    }): Promise<{
        output: string;
        tokensIn?: number;
        tokensOut?: number;
    }>;
}
export interface RalphProgress {
    iteration: number;
    score: number;
    passed: boolean;
    output: string;
    verify: VerifyResult;
    ts: number;
}
export interface RalphRunOptions {
    spec: RalphSpec;
    agent: RalphAgentRunner;
    checks: VerifyCheck[];
    cwd?: string;
    abortSignal?: AbortSignal;
    onProgress?: (p: RalphProgress) => void;
    progressFile?: string;
    lessons?: string;
}
export interface RalphRunResult {
    status: 'completed' | 'max_iterations' | 'aborted' | 'error';
    iterations: RalphProgress[];
    finalScore: number;
    reason?: string;
}
export declare function runRalph(opts: RalphRunOptions): Promise<RalphRunResult>;
//# sourceMappingURL=ralph-runner.d.ts.map