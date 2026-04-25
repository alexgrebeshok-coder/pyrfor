export interface VerifyCheck {
    name: string;
    command: string;
    weight: number;
    successPattern?: RegExp;
    timeoutMs?: number;
}
export interface VerifyCheckResult {
    name: string;
    passed: boolean;
    score: number;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
}
export interface VerifyResult {
    total: number;
    threshold: number;
    passed: boolean;
    checks: VerifyCheckResult[];
    ts: number;
}
export interface VerifyEngineOptions {
    cwd?: string;
    env?: Record<string, string>;
    threshold?: number;
    abortSignal?: AbortSignal;
    truncateOutputBytes?: number;
}
export declare function runVerify(checks: VerifyCheck[], opts?: VerifyEngineOptions): Promise<VerifyResult>;
//# sourceMappingURL=verify-engine.d.ts.map