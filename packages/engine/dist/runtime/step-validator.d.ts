import type { AcpEvent } from './acp-client.js';
export type ValidatorVerdict = 'pass' | 'warn' | 'correct' | 'block';
export interface ValidatorContext {
    cwd: string;
    task?: string;
    scopeFiles?: string[];
    abortSignal?: AbortSignal;
    llmFn?: (prompt: string) => Promise<string>;
    shellTimeoutMs?: number;
}
export interface ValidatorResult {
    validator: string;
    verdict: ValidatorVerdict;
    message: string;
    details?: Record<string, unknown>;
    remediation?: string;
    durationMs: number;
}
export interface StepValidator {
    name: string;
    appliesTo(event: AcpEvent): boolean;
    validate(event: AcpEvent, ctx: ValidatorContext): Promise<ValidatorResult>;
}
export interface RunValidatorsOptions {
    validators: StepValidator[];
    event: AcpEvent;
    ctx: ValidatorContext;
    parallel?: boolean;
}
export interface RunValidatorsResult {
    verdict: ValidatorVerdict;
    results: ValidatorResult[];
}
export declare const VERDICT_RANK: Record<ValidatorVerdict, number>;
export declare function strongestVerdict(verdicts: ValidatorVerdict[]): ValidatorVerdict;
export declare function runValidators(opts: RunValidatorsOptions): Promise<RunValidatorsResult>;
export interface ShellResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
}
export declare function runShell(cmd: string, opts?: {
    cwd?: string;
    timeoutMs?: number;
    abortSignal?: AbortSignal;
}): Promise<ShellResult>;
export declare function extractTouchedPaths(event: AcpEvent): string[];
//# sourceMappingURL=step-validator.d.ts.map