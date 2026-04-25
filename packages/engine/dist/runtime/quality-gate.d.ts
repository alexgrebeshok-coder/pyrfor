/**
 * Pyrfor Coding Supervisor — Quality Gate
 *
 * Consumes ValidatorResults, decides whether to continue, inject a correction
 * prompt, block, or hand off to the user. Tracks per-event and session-wide
 * attempt budgets.
 */
import type { AcpEvent } from './acp-client.js';
export type ValidatorVerdict = 'pass' | 'warn' | 'correct' | 'block';
export interface ValidatorResult {
    validator: string;
    verdict: ValidatorVerdict;
    message: string;
    details?: any;
    remediation?: string;
    durationMs: number;
}
export type GateAction = 'continue' | 'inject_correction' | 'block' | 'request_user';
export interface QualityGateConfig {
    /** Default 3 */
    maxCorrectAttemptsPerEvent?: number;
    /** Default 10 */
    maxCorrectAttemptsPerSession?: number;
    /** Soft token cap; default 100_000 */
    budgetTokens?: number;
    /** Whether a 'warn' verdict is treated as 'correct'; default false */
    warnIsCorrection?: boolean;
    injectionTemplate?: (input: InjectionContext) => string;
    /** Optional context blob injected into correction prompts */
    ceoClawContext?: () => Promise<string> | string;
    /** Optional LLM call used to enrich remediation text */
    llmFn?: (prompt: string) => Promise<string>;
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
}
export interface InjectionContext {
    event: AcpEvent;
    results: ValidatorResult[];
    attempt: number;
    ceoContext?: string;
}
export interface GateDecision {
    action: GateAction;
    injection?: string;
    reason: string;
    results: ValidatorResult[];
    attempt: number;
    remainingPerEvent: number;
    remainingPerSession: number;
}
export interface QualityGateState {
    sessionId: string;
    totalCorrections: number;
    /** keyed by stable event id */
    perEventAttempts: Map<string, number>;
    tokensUsed: number;
    blocked: boolean;
    history: GateDecision[];
}
export interface QualityGate {
    evaluate(event: AcpEvent, results: ValidatorResult[], opts?: {
        eventId?: string;
        tokensUsed?: number;
    }): Promise<GateDecision>;
    state(): QualityGateState;
    reset(): void;
    override(action: 'unblock' | 'reset_event_attempts', payload?: any): void;
}
export interface CreateQualityGateOptions extends QualityGateConfig {
    sessionId: string;
}
/** Returns the most severe verdict from a list. */
export declare function strongestVerdict(verdicts: ValidatorVerdict[]): ValidatorVerdict;
/** Default correction-prompt template. */
export declare function defaultInjectionTemplate(input: InjectionContext): string;
export declare function createQualityGate(opts: CreateQualityGateOptions): QualityGate;
//# sourceMappingURL=quality-gate.d.ts.map