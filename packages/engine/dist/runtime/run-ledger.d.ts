/**
 * run-ledger.ts — durable RunLifecycle facade backed by EventLedger.
 *
 * This is the M0 orchestration substrate: a small API that keeps the canonical
 * in-memory RunRecord in sync with append-only ledger events. Workers and
 * adapters should use this instead of mutating run state directly.
 */
import { EventLedger, type LedgerEvent } from './event-ledger';
import { type RunMode, type RunRecord, type RunStatus } from './run-lifecycle';
export interface RunLedgerCreateInput extends Partial<RunRecord> {
    workspace_id: string;
    repo_id: string;
    mode: RunMode;
    goal?: string;
}
export interface RunLedgerOptions {
    ledger: EventLedger;
}
export type RunTerminalStatus = 'completed' | 'failed' | 'cancelled';
export declare class RunLedger {
    private readonly ledger;
    private readonly records;
    constructor(options: RunLedgerOptions);
    createRun(input: RunLedgerCreateInput): Promise<RunRecord>;
    getRun(runId: string): RunRecord | undefined;
    listRuns(): RunRecord[];
    transition(runId: string, next: RunStatus, reason?: string): Promise<RunRecord>;
    proposePlan(runId: string, plan: string): Promise<void>;
    approvePlan(runId: string, approvedBy: string): Promise<RunRecord>;
    denyPlan(runId: string, reason: string): Promise<RunRecord>;
    recordToolRequested(runId: string, tool: string, args?: Record<string, unknown>): Promise<void>;
    recordToolExecuted(runId: string, tool: string, result?: {
        ms?: number;
        status?: string;
        error?: string;
    }): Promise<void>;
    recordArtifact(runId: string, artifactRef: string, files?: string[]): Promise<RunRecord>;
    blockRun(runId: string, reason: string): Promise<RunRecord>;
    completeRun(runId: string, status: RunTerminalStatus, summary?: string): Promise<RunRecord>;
    eventsForRun(runId: string): Promise<LedgerEvent[]>;
    replayRun(runId: string): Promise<RunRecord | undefined>;
    private requireRun;
    private commitTransition;
    private append;
}
//# sourceMappingURL=run-ledger.d.ts.map