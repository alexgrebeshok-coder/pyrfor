/**
 * verifier-lane.ts - independent verifier and deterministic eval harness.
 *
 * Worker self-reports are inputs. This lane owns the verdict that decides
 * pass/rework/block/user-review for orchestration.
 */
import type { AcpEvent } from './acp-client.js';
import { type DagNode } from './durable-dag';
import { EventLedger, type LedgerEvent } from './event-ledger';
import { type GateDecision, type QualityGate } from './quality-gate';
import type { RunRecord } from './run-lifecycle';
import { RunLedger } from './run-ledger';
import { type StepValidator, type ValidatorContext, type ValidatorResult } from './step-validator';
import { type VerifyCheck, type VerifyResult } from './verify-engine';
export type VerificationStatus = 'passed' | 'warning' | 'needs_rework' | 'blocked' | 'user_required';
export interface VerifierSubject {
    runId: string;
    subjectId: string;
    subjectType: string;
    event: AcpEvent;
}
export interface VerifierLaneOptions {
    ledger?: EventLedger;
    runLedger?: RunLedger;
    validators?: StepValidator[];
    qualityGate?: QualityGate;
    replayStoreDir?: string;
    dagStorePath?: string;
    workspaceId?: string;
    repoId?: string;
    owner?: string;
    leaseTtlMs?: number;
}
export interface VerifierReplayInput {
    parentRunId: string;
    acpEvents: AcpEvent[];
    cwd: string;
    validators?: StepValidator[];
    qualityGate?: QualityGate;
    verifyChecks?: VerifyCheck[];
    replayStoreDir?: string;
    dagStorePath?: string;
    verifierRunId?: string;
    workspaceId?: string;
    repoId?: string;
    owner?: string;
    leaseTtlMs?: number;
}
export interface VerificationReport {
    runId: string;
    subjectId: string;
    subjectType: string;
    status: VerificationStatus;
    gateDecision: GateDecision;
    results: ValidatorResult[];
}
export interface VerifierStepRecord extends VerificationReport {
    eventIndex: number;
    eventType: string;
}
export interface VerifierLaneResult {
    parentRunId: string;
    verifierRunId: string;
    status: VerificationStatus;
    replayArtifactRef: string;
    replayArtifactPath: string;
    steps: VerifierStepRecord[];
    verifyResult?: VerifyResult;
    dagNodes: DagNode[];
    reconstructedRun?: RunRecord;
}
export declare class VerifierLane {
    private readonly ledger;
    private readonly runLedger;
    private readonly validators;
    private readonly qualityGate;
    private readonly replayStoreDir;
    private readonly dagStorePath;
    private readonly workspaceId;
    private readonly repoId;
    private readonly owner;
    private readonly leaseTtlMs;
    constructor(options: VerifierLaneOptions);
    verify(subject: VerifierSubject, ctx: ValidatorContext): Promise<VerificationReport>;
    run(input: VerifierReplayInput): Promise<VerifierLaneResult>;
    private verifyWith;
    private createVerifierRun;
    private persistAcpReplay;
}
export interface OrchestrationEvalCase {
    name: string;
    runId: string;
    events: LedgerEvent[];
    assertions: Array<{
        name: string;
        check(events: LedgerEvent[]): boolean;
    }>;
}
export interface OrchestrationEvalResult {
    suite: string;
    passed: number;
    failed: number;
    cases: Array<{
        name: string;
        passed: boolean;
        failures: string[];
    }>;
}
export declare function runOrchestrationEvalSuite(suite: string, cases: OrchestrationEvalCase[], ledger?: EventLedger): Promise<OrchestrationEvalResult>;
//# sourceMappingURL=verifier-lane.d.ts.map