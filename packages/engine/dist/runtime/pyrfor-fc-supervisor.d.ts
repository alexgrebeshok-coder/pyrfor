/**
 * pyrfor-fc-supervisor.ts
 *
 * Orchestrates FreeClaude (FC) event supervision:
 *   raw FCEvent → FcEventReader → FcEvent[] → FcAcpBridge → AcpEvent[]
 *   → runValidators → ValidatorResult[] → QualityGate → GateDecision
 *
 * The supervisor wires together the existing `step-validator` and
 * `quality-gate` modules with the FC event stream, providing a single
 * `FcSupervisor` interface for callers.
 */
import type { FCEvent, FCEnvelope } from './pyrfor-fc-adapter';
import type { StepValidator, ValidatorResult, ValidatorVerdict } from './step-validator';
import type { QualityGate, GateDecision } from './quality-gate';
import type { AcpEvent } from './acp-client';
export interface SupervisorOptions {
    sessionId: string;
    cwd: string;
    task?: string;
    validators: StepValidator[];
    qualityGate: QualityGate;
    scopeFiles?: string[];
    abortSignal?: AbortSignal;
    /**
     * Called for every gate decision whose action is NOT 'continue'.
     * Callers can use this to inject corrections, block the agent, etc.
     * 'continue' decisions are intentionally omitted to reduce noise.
     */
    onGateDecision?: (decision: GateDecision) => void | Promise<void>;
    /** Called whenever validators emit results for an AcpEvent. */
    onValidatorResult?: (results: ValidatorResult[], verdict: ValidatorVerdict) => void;
    /** Optional structured logger; defaults to no-op. */
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}
export interface SupervisorRunStats {
    /** Number of AcpEvents that had at least one applicable validator. */
    validatorRuns: number;
    /** Total ValidatorResult objects across all events. */
    totalResults: number;
    /** Result count per verdict level. */
    byVerdict: Record<ValidatorVerdict, number>;
    /** All gate decisions that were NOT 'continue' (mirrors onGateDecision calls). */
    gateDecisions: GateDecision[];
    /** Final verdict from `finalize()`, if called. */
    finalEnvelopeVerdict?: ValidatorVerdict;
}
export interface FcSupervisor {
    /**
     * Feed each raw FCEvent as it arrives from the FC stream.
     * Returns the AcpEvents derived (for trajectory recording) plus validation
     * results and the gate decision (if action !== 'continue').
     */
    observe(raw: FCEvent): Promise<{
        acp: AcpEvent[];
        results: ValidatorResult[];
        gateDecision?: GateDecision;
    }>;
    /**
     * Call once after the FC run completes.  Synthesises session-level AcpEvents
     * from the FCEnvelope (diff over filesTouched, terminal summary for
     * commandsRun) so diff-size / scope validators can do a final pass.
     */
    finalize(envelope: FCEnvelope): Promise<{
        results: ValidatorResult[];
        verdict: ValidatorVerdict;
        gateDecision?: GateDecision;
    }>;
    /** Aggregated stats collected since the supervisor was created. */
    stats(): SupervisorRunStats;
}
export declare function createFcSupervisor(opts: SupervisorOptions): FcSupervisor;
//# sourceMappingURL=pyrfor-fc-supervisor.d.ts.map