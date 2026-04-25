import type { VerifyResult } from './verify-engine.js';
export interface RalphSpec {
    agent: string;
    task: string;
    maxIterations: number;
    scoreThreshold: number;
    promptTemplate: string;
    commands: Record<string, string>;
    exitToken: string;
    scoring?: {
        tests?: number;
        lint?: number;
        typecheck?: number;
        custom?: Record<string, number>;
    };
    cwd?: string;
    env?: Record<string, string>;
}
export declare function parseRalphMd(text: string): RalphSpec;
export declare function renderPrompt(spec: RalphSpec, ctx: {
    iteration: number;
    lastScore?: number;
    lastVerify?: VerifyResult;
    progress?: string;
    lessons?: string;
}): string;
//# sourceMappingURL=ralph-spec.d.ts.map