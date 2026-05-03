/**
 * run-ledger.ts — durable RunLifecycle facade backed by EventLedger.
 *
 * This is the M0 orchestration substrate: a small API that keeps the canonical
 * in-memory RunRecord in sync with append-only ledger events. Workers and
 * adapters should use this instead of mutating run state directly.
 */

import { EventLedger, type LedgerAppendInput, type LedgerEvent } from './event-ledger';
import {
  ALLOWED_TRANSITIONS,
  RunLifecycle,
  type BudgetProfile,
  type PermissionProfile,
  type RunMode,
  type RunRecord,
  type RunStatus,
} from './run-lifecycle';

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

const RUN_MODES = new Set<RunMode>(['chat', 'edit', 'autonomous', 'pm']);
const RUN_STATUSES = new Set<RunStatus>(Object.keys(ALLOWED_TRANSITIONS) as RunStatus[]);
const ARTIFACT_INACTIVE_STATUSES = new Set<RunStatus>([
  'completed',
  'failed',
  'cancelled',
  'archived',
]);

function isRunMode(value: unknown): value is RunMode {
  return typeof value === 'string' && RUN_MODES.has(value as RunMode);
}

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && RUN_STATUSES.has(value as RunStatus);
}

function asPermissionProfile(value: unknown): PermissionProfile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const profile = (value as { profile?: unknown }).profile;
  if (profile === 'strict' || profile === 'standard' || profile === 'autonomous') {
    return value as PermissionProfile;
  }
  return undefined;
}

function asBudgetProfile(value: unknown): BudgetProfile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as BudgetProfile;
}

function cloneRecord(record: RunRecord): RunRecord {
  return {
    ...record,
    artifact_refs: [...record.artifact_refs],
    permission_profile: {
      ...record.permission_profile,
      overrides: record.permission_profile.overrides
        ? { ...record.permission_profile.overrides }
        : undefined,
    },
    budget_profile: { ...record.budget_profile },
    error: record.error ? { ...record.error } : undefined,
  };
}

export class RunLedger {
  private readonly ledger: EventLedger;
  private readonly records = new Map<string, RunRecord>();

  constructor(options: RunLedgerOptions) {
    this.ledger = options.ledger;
  }

  async createRun(input: RunLedgerCreateInput): Promise<RunRecord> {
    const { goal, ...recordInput } = input;
    const record = RunLifecycle.create(recordInput);

    await this.append({
      type: 'run.created',
      run_id: record.run_id,
      goal,
      task_id: record.task_id,
      parent_run_id: record.parent_run_id,
      workspace_id: record.workspace_id,
      repo_id: record.repo_id,
      branch_or_worktree_id: record.branch_or_worktree_id,
      mode: record.mode,
      status: record.status,
      model_profile: record.model_profile,
      provider_route: record.provider_route,
      context_snapshot_hash: record.context_snapshot_hash,
      prompt_snapshot_hash: record.prompt_snapshot_hash,
      artifact_refs: record.artifact_refs,
      permission_profile: record.permission_profile,
      budget_profile: record.budget_profile,
    });

    this.records.set(record.run_id, record);
    return cloneRecord(record);
  }

  getRun(runId: string): RunRecord | undefined {
    const record = this.records.get(runId);
    return record ? cloneRecord(record) : undefined;
  }

  listRuns(): RunRecord[] {
    return Array.from(this.records.values(), cloneRecord);
  }

  async transition(runId: string, next: RunStatus, reason?: string): Promise<RunRecord> {
    const current = this.requireRun(runId);
    const updated = RunLifecycle.transition(current, next);
    await this.commitTransition(current, updated, reason);
    return cloneRecord(updated);
  }

  async proposePlan(runId: string, plan: string): Promise<void> {
    const current = this.requireRun(runId);
    if (current.status === 'planned') {
      await this.transition(runId, 'awaiting_approval', 'plan proposed');
    }
    await this.append({ type: 'plan.proposed', run_id: runId, plan });
    await this.append({ type: 'approval.requested', run_id: runId, reason: 'plan approval required' });
  }

  async approvePlan(runId: string, approvedBy: string): Promise<RunRecord> {
    const updated = await this.transition(runId, 'running', 'plan approved');
    await this.append({ type: 'approval.granted', run_id: runId, approved_by: approvedBy });
    return updated;
  }

  async denyPlan(runId: string, reason: string): Promise<RunRecord> {
    const updated = await this.transition(runId, 'cancelled', reason);
    await this.append({ type: 'approval.denied', run_id: runId, reason });
    return updated;
  }

  async recordToolRequested(
    runId: string,
    tool: string,
    args?: Record<string, unknown>,
  ): Promise<void> {
    this.requireRun(runId);
    await this.append({ type: 'tool.requested', run_id: runId, tool, args });
  }

  async recordToolExecuted(
    runId: string,
    tool: string,
    result: { ms?: number; status?: string; error?: string } = {},
  ): Promise<void> {
    this.requireRun(runId);
    await this.append({ type: 'tool.executed', run_id: runId, tool, ...result });
  }

  async recordArtifact(
    runId: string,
    artifactRef: string,
    files?: string[],
  ): Promise<RunRecord> {
    const current = this.requireRun(runId);
    if (ARTIFACT_INACTIVE_STATUSES.has(current.status)) {
      throw new Error(`RunLedger: cannot record artifact for inactive run "${runId}" (${current.status})`);
    }

    const updated = RunLifecycle.withArtifact(current, artifactRef);
    if (updated === current) return cloneRecord(current);

    await this.append({
      type: 'artifact.created',
      run_id: runId,
      artifact_id: artifactRef,
      files,
    });

    this.records.set(runId, updated);
    return cloneRecord(updated);
  }

  async blockRun(runId: string, reason: string): Promise<RunRecord> {
    const updated = await this.transition(runId, 'blocked', reason);
    await this.append({ type: 'run.blocked', run_id: runId, reason });
    return updated;
  }

  async completeRun(
    runId: string,
    status: RunTerminalStatus,
    summary?: string,
  ): Promise<RunRecord> {
    const current = this.requireRun(runId);
    let updated: RunRecord;

    if (status === 'failed') {
      updated = RunLifecycle.withError(current, 'run_failed', summary ?? 'Run failed');
    } else {
      updated = RunLifecycle.transition(current, status);
    }

    await this.commitTransition(current, updated, summary);

    if (status === 'completed') {
      await this.append({ type: 'run.completed', run_id: runId, status });
    } else if (status === 'failed') {
      await this.append({ type: 'run.failed', run_id: runId, error: summary });
    } else {
      await this.append({ type: 'run.cancelled', run_id: runId, reason: summary });
    }

    return cloneRecord(updated);
  }

  async eventsForRun(runId: string): Promise<LedgerEvent[]> {
    return this.ledger.byRun(runId);
  }

  async replayRun(runId: string): Promise<RunRecord | undefined> {
    const events = await this.ledger.byRun(runId);
    let record: RunRecord | undefined;

    for (const event of events) {
      if (event.type === 'run.created') {
        const created = RunLifecycle.create({
          run_id: event.run_id,
          task_id: event.task_id ?? event.goal ?? '',
          parent_run_id: event.parent_run_id,
          workspace_id: event.workspace_id ?? 'unknown',
          repo_id: event.repo_id ?? 'unknown',
          branch_or_worktree_id: event.branch_or_worktree_id ?? '',
          mode: isRunMode(event.mode) ? event.mode : 'autonomous',
          model_profile: event.model_profile ?? event.model ?? '',
          provider_route: event.provider_route ?? event.provider ?? '',
          context_snapshot_hash: event.context_snapshot_hash ?? '',
          prompt_snapshot_hash: event.prompt_snapshot_hash ?? '',
          artifact_refs: event.artifact_refs ?? [],
          permission_profile: asPermissionProfile(event.permission_profile) ?? { profile: 'standard' },
          budget_profile: asBudgetProfile(event.budget_profile) ?? {},
          created_at: event.ts,
          updated_at: event.ts,
        });
        record = {
          ...created,
          status: isRunStatus(event.status) ? event.status : created.status,
          created_at: event.ts,
          updated_at: event.ts,
        };
        continue;
      }

      if (!record) continue;

      if (event.type === 'run.transitioned' && isRunStatus(event.to)) {
        if (record.status !== event.to) {
          record = { ...RunLifecycle.transition(record, event.to), updated_at: event.ts };
        }
      } else if (event.type === 'artifact.created' && event.artifact_id) {
        record = { ...RunLifecycle.withArtifact(record, event.artifact_id), updated_at: event.ts };
      } else if (event.type === 'run.completed') {
        record = record.status === 'completed'
          ? { ...record, updated_at: event.ts }
          : { ...RunLifecycle.transition(record, 'completed'), updated_at: event.ts };
      } else if (event.type === 'run.failed') {
        record = record.status === 'failed'
          ? { ...record, updated_at: event.ts, error: record.error ?? { code: 'run_failed', message: event.error ?? 'Run failed' } }
          : { ...RunLifecycle.withError(record, 'run_failed', event.error ?? 'Run failed'), updated_at: event.ts };
      } else if (event.type === 'run.cancelled') {
        record = record.status === 'cancelled'
          ? { ...record, updated_at: event.ts }
          : { ...RunLifecycle.transition(record, 'cancelled'), updated_at: event.ts };
      }
    }

    if (record) this.records.set(record.run_id, record);
    return record ? cloneRecord(record) : undefined;
  }

  async recoverInterruptedRuns(reason = 'runtime_restarted'): Promise<RunRecord[]> {
    const recovered: RunRecord[] = [];
    for (const record of this.listRuns()) {
      if (record.status !== 'running') continue;
      recovered.push(await this.blockRun(record.run_id, reason));
    }
    return recovered;
  }

  private requireRun(runId: string): RunRecord {
    const record = this.records.get(runId);
    if (!record) throw new Error(`RunLedger: unknown run "${runId}"`);
    return record;
  }

  private async commitTransition(
    current: RunRecord,
    updated: RunRecord,
    reason?: string,
  ): Promise<void> {
    await this.append({
      type: 'run.transitioned',
      run_id: current.run_id,
      from: current.status,
      to: updated.status,
      reason,
    });
    this.records.set(updated.run_id, updated);
  }

  private append(event: LedgerAppendInput): Promise<LedgerEvent> {
    return this.ledger.append(event);
  }
}
