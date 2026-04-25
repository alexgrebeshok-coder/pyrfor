export interface ScoringInputs {
    tests?: {
        passed: number;
        total: number;
    } | {
        skipped: true;
        reason?: string;
    };
    build?: {
        ok: boolean;
        reason?: string;
    };
    lint?: {
        errors: number;
        warnings: number;
    } | {
        skipped: true;
        reason?: string;
    };
    regressedFiles?: string[];
}
export interface ScoringBreakdown {
    tests: {
        score: number;
        max: 40;
        detail: string;
    };
    build: {
        score: number;
        max: 20;
        detail: string;
    };
    lint: {
        score: number;
        max: 20;
        detail: string;
    };
    noRegress: {
        score: number;
        max: 20;
        detail: string;
    };
    total: number;
    passed: boolean;
    threshold: number;
}
export interface ScoringRunOptions {
    workdir: string;
    testCommand?: string;
    buildCommand?: string;
    lintCommand?: string;
    testParser?: 'vitest-json' | 'jest-json' | 'tap' | 'simple-counts' | ((stdout: string, exitCode: number) => {
        passed: number;
        total: number;
    });
    lintParser?: 'eslint-json' | 'simple-counts' | ((stdout: string, exitCode: number) => {
        errors: number;
        warnings: number;
    });
    baselineFailures?: string[];
    currentFailures?: string[];
    threshold?: number;
    timeoutSec?: number;
    execFn?: (cmd: string, opts: {
        cwd: string;
        timeoutSec: number;
    }) => Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
}
export declare function computeScore(inputs: ScoringInputs, opts?: {
    threshold?: number;
}): ScoringBreakdown;
export declare function scoreWorkdir(opts: ScoringRunOptions): Promise<ScoringBreakdown>;
//# sourceMappingURL=pyrfor-scoring.d.ts.map