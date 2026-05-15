/**
 * event-ledger.ts — Append-only JSONL event ledger for Pyrfor run auditing.
 *
 * Features:
 * - Discriminated-union LedgerEvent covering the full run lifecycle
 * - Atomic appends (open 'a', write line, optional fsync)
 * - Crash-safe: never overwrites existing lines; corrupt lines skipped with warn
 * - Line-by-line streaming via readline for memory-efficient reads
 * - Monotonic seq counter seeded from on-disk line count at first open
 */

import { open, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import * as nodeCrypto from 'node:crypto';
import path from 'node:path';
import logger from '../observability/logger';
import type { DecisionVector } from './universal/types';

// ====== Event type union =====================================================

export type LedgerEventType =
  | 'run.created'
  | 'run.transitioned'
  | 'plan.proposed'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'model.turn.started'
  | 'model.turn.completed'
  | 'tool.requested'
  | 'tool.approved'
  | 'tool.denied'
  | 'tool.executed'
  | 'effect.proposed'
  | 'effect.policy_decided'
  | 'effect.applied'
  | 'effect.denied'
  | 'effect.failed'
  | 'dag.created'
  | 'dag.node.ready'
  | 'dag.node.started'
  | 'dag.node.completed'
  | 'dag.node.failed'
  | 'dag.lease.acquired'
  | 'dag.lease.released'
  | 'actor.spawned'
  | 'actor.mailbox.enqueued'
  | 'actor.mailbox.leased'
  | 'actor.work.started'
  | 'actor.mailbox.completed'
  | 'actor.work.completed'
  | 'actor.mailbox.failed'
  | 'actor.failed'
  | 'verifier.started'
  | 'verifier.completed'
  | 'verifier.waived'
  | 'eval.completed'
  | 'artifact.created'
  | 'diff.proposed'
  | 'diff.applied'
  | 'test.completed'
  | 'governance.gate.checked'
  | 'governance.gate.violation'
  | 'decision_record.audit.generated'
  | 'governance.legacy_node_audit.generated'
  | 'memory.written'
  | 'memory.conflict'
  | 'tool.slot.reserved'
  | 'tool.slot.committed'
  | 'tool.slot.released'
  | 'concept.received'
  | 'concept.planned'
  | 'concept.completed'
  | 'research.started'
  | 'research.completed'
  | 'critique.started'
  | 'critique.completed'
  | 'strategy.snapshot.created'
  | 'struggle.detected'
  | 'context.rotated'
  | 'supervisor.decision'
  | 'tool.forge.requested'
  | 'tool.forge.blocked'
  | 'extension.tool_blocked'
  | 'delivery.started'
  | 'delivery.completed'
  | 'delivery.failed'
  | 'postmortem.started'
  | 'postmortem.completed'
  | 'self_improvement.proposal.evaluated'
  | 'self_improvement.proposal.promoted'
  | 'self_improvement.proposal.quarantined'
  | 'self_improvement.proposal.escalated'
  | 'self_improvement.meta_change.proposed'
  | 'self_improvement.meta_change.circuit_open'
  | 'self_improvement.meta_change.protected_target_rejected'
  | 'block.loaded'
  | 'block.activated'
  | 'block.deactivated'
  | 'block.error'
  | 'sandbox.run.started'
  | 'sandbox.run.completed'
  | 'run.blocked'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

// ─── Base fields present on every event ─────────────────────────────────────

interface EventBase {
  /** UUID v4 */
  id: string;
  /** ISO 8601 timestamp */
  ts: string;
  /** Owning run identifier */
  run_id: string;
  /** Monotonically increasing per-ledger sequence number (0-based) */
  seq: number;
}

// ─── Per-type discriminated shapes ──────────────────────────────────────────

export interface RunCreatedEvent extends EventBase {
  type: 'run.created';
  goal?: string;
  provider?: string;
  model?: string;
  task_id?: string;
  parent_run_id?: string;
  workspace_id?: string;
  repo_id?: string;
  branch_or_worktree_id?: string;
  mode?: string;
  status?: string;
  model_profile?: string;
  provider_route?: string;
  context_snapshot_hash?: string;
  prompt_snapshot_hash?: string;
  artifact_refs?: string[];
  permission_profile?: unknown;
  budget_profile?: unknown;
}

export interface RunTransitionedEvent extends EventBase {
  type: 'run.transitioned';
  from: string;
  to: string;
  reason?: string;
}

export interface PlanProposedEvent extends EventBase {
  type: 'plan.proposed';
  plan?: string;
  steps?: number;
}

export interface ApprovalRequestedEvent extends EventBase {
  type: 'approval.requested';
  reason?: string;
  tool?: string;
  approval_id?: string;
  artifact_id?: string;
}

export interface ApprovalGrantedEvent extends EventBase {
  type: 'approval.granted';
  approved_by?: string;
  tool?: string;
  approval_id?: string;
  artifact_id?: string;
}

export interface ApprovalDeniedEvent extends EventBase {
  type: 'approval.denied';
  approved_by?: string;
  reason?: string;
  tool?: string;
  approval_id?: string;
  artifact_id?: string;
}

export interface ModelTurnStartedEvent extends EventBase {
  type: 'model.turn.started';
  model?: string;
  provider?: string;
  turn?: number;
}

export interface ModelTurnCompletedEvent extends EventBase {
  type: 'model.turn.completed';
  model?: string;
  provider?: string;
  turn?: number;
  ms?: number;
  tokens?: number;
}

export interface ToolRequestedEvent extends EventBase {
  type: 'tool.requested';
  tool?: string;
  args?: Record<string, unknown>;
}

export interface ToolApprovedEvent extends EventBase {
  type: 'tool.approved';
  tool?: string;
  approved_by?: string;
}

export interface ToolDeniedEvent extends EventBase {
  type: 'tool.denied';
  tool?: string;
  reason?: string;
}

export interface ToolExecutedEvent extends EventBase {
  type: 'tool.executed';
  tool?: string;
  ms?: number;
  status?: string;
  error?: string;
}

export interface EffectProposedEvent extends EventBase {
  type: 'effect.proposed';
  effect_id: string;
  effect_kind: string;
  tool?: string;
  preview?: string;
  idempotency_key?: string;
}

export interface EffectPolicyDecidedEvent extends EventBase {
  type: 'effect.policy_decided';
  effect_id: string;
  decision: string;
  policy_id?: string;
  reason?: string;
  reason_codes?: string[];
  decision_vector_ref?: string;
  approval_required?: boolean;
}

export interface EffectAppliedEvent extends EventBase {
  type: 'effect.applied';
  effect_id: string;
  status?: string;
  ms?: number;
  rollback_handle?: string;
}

export interface EffectDeniedEvent extends EventBase {
  type: 'effect.denied';
  effect_id: string;
  reason?: string;
}

export interface EffectFailedEvent extends EventBase {
  type: 'effect.failed';
  effect_id: string;
  error?: string;
  ms?: number;
}

export interface DagCreatedEvent extends EventBase {
  type: 'dag.created';
  dag_id?: string;
  node_count?: number;
}

export interface DagNodeReadyEvent extends EventBase {
  type: 'dag.node.ready';
  dag_id?: string;
  node_id: string;
  kind?: string;
  idempotency_key?: string;
}

export interface DagNodeStartedEvent extends EventBase {
  type: 'dag.node.started';
  dag_id?: string;
  node_id: string;
  owner?: string;
  attempt?: number;
}

export interface DagNodeCompletedEvent extends EventBase {
  type: 'dag.node.completed';
  dag_id?: string;
  node_id: string;
  artifact_refs?: string[];
}

export interface DagNodeFailedEvent extends EventBase {
  type: 'dag.node.failed';
  dag_id?: string;
  node_id: string;
  reason?: string;
  retryable?: boolean;
}

export interface DagLeaseAcquiredEvent extends EventBase {
  type: 'dag.lease.acquired';
  dag_id?: string;
  node_id: string;
  owner: string;
  expires_at: number;
}

export interface DagLeaseReleasedEvent extends EventBase {
  type: 'dag.lease.released';
  dag_id?: string;
  node_id: string;
  owner?: string;
  reason?: string;
}

export interface VerifierStartedEvent extends EventBase {
  type: 'verifier.started';
  subject_id: string;
  subject_type?: string;
  validators?: string[];
}

export interface VerifierCompletedEvent extends EventBase {
  type: 'verifier.completed';
  subject_id: string;
  status: string;
  action?: string;
  reason?: string;
  findings?: number;
}

export interface VerifierWaivedEvent extends EventBase {
  type: 'verifier.waived';
  status: 'waived';
  waived_from: string;
  approved_by: string;
  reason: string;
  scope: string;
  artifact_id?: string;
}

export interface EvalCompletedEvent extends EventBase {
  type: 'eval.completed';
  suite: string;
  passed: number;
  failed: number;
  status: string;
}

export interface ArtifactCreatedEvent extends EventBase {
  type: 'artifact.created';
  files?: string[];
  artifact_id?: string;
}

export interface DiffProposedEvent extends EventBase {
  type: 'diff.proposed';
  files?: string[];
  lines_added?: number;
  lines_removed?: number;
}

export interface DiffAppliedEvent extends EventBase {
  type: 'diff.applied';
  files?: string[];
  ms?: number;
}

export interface TestCompletedEvent extends EventBase {
  type: 'test.completed';
  passed?: number;
  failed?: number;
  skipped?: number;
  ms?: number;
  status?: string;
}

export type GovernanceGateDisposition =
  | 'passed'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'waived_by_approval';

export interface GovernanceGateCheckedEvent extends EventBase {
  type: 'governance.gate.checked';
  dag_id?: string;
  node_id: string;
  governed_algorithm?: string;
  gate_id: string;
  gate_kind?: 'admission' | 'completion';
  gate_revision?: number;
  trigger?: string;
  attempt?: number;
  required_artifacts?: unknown[];
  present_artifact_refs?: string[];
  missing_artifact_kinds?: string[];
  success_criteria?: string[];
  decision_vector_ref?: string;
  approval_state?: 'none' | 'pending' | 'granted' | 'denied';
  disposition: GovernanceGateDisposition;
  retryable?: boolean;
  evidence_snapshot_hash?: string;
  contract_hash?: string;
  supersedes_check_event_id?: string;
}

export interface GovernanceGateViolationEvent extends EventBase {
  type: 'governance.gate.violation';
  dag_id?: string;
  node_id: string;
  gate_id: string;
  gate_check_event_id?: string;
  attempt?: number;
  violation_code?: string;
  reason?: string;
  retryable?: boolean;
  requires_new_evidence?: boolean;
  accepted_new_evidence_kinds?: string[];
  reopen_on_approval?: boolean;
  blocked_completion?: boolean;
  evidence_snapshot_hash?: string;
  contract_hash?: string;
}

export interface DecisionRecordAuditGeneratedEvent extends EventBase {
  type: 'decision_record.audit.generated';
  artifact_id?: string;
  node_id?: string;
  attempt?: number;
  canonical_valid?: boolean;
  poison_score?: number;
  signal_codes?: string[];
  disposition?: 'accepted' | 'quarantined' | 'gate_failed' | 'safety_block';
}

export interface LegacyNodeAuditGeneratedEvent extends EventBase {
  type: 'governance.legacy_node_audit.generated';
  artifact_id?: string;
  baseline_tag?: string;
  total_grandfathered_nodes?: number;
  active_grandfathered_nodes?: number;
  violations?: number;
}

export interface MemoryWrittenEvent extends EventBase {
  type: 'memory.written';
  concept_id?: string;
  node_id?: string;
  entry_id?: string;
  memory_kind?: string;
  memory_scope?: string;
  artifact_refs?: string[];
  reason?: string;
}

export interface MemoryConflictEvent extends EventBase {
  type: 'memory.conflict';
  concept_id?: string;
  node_id?: string;
  conflict_key: string;
  existing_entry_id?: string;
  approval_id?: string;
  decision?: string;
  artifact_refs?: string[];
}

export interface SelfImprovementProposalEvent extends EventBase {
  type:
    | 'self_improvement.proposal.evaluated'
    | 'self_improvement.proposal.promoted'
    | 'self_improvement.proposal.quarantined'
    | 'self_improvement.proposal.escalated';
  concept_id?: string;
  entry_id: string;
  proposal_type?: string;
  eval_verdict?: string;
  artifact_id?: string;
  approval_id?: string;
  approved_by?: string;
  reason?: string;
}

export interface SelfModificationEngineEvent extends EventBase {
  type:
    | 'self_improvement.meta_change.proposed'
    | 'self_improvement.meta_change.circuit_open'
    | 'self_improvement.meta_change.protected_target_rejected';
  concept_id?: string;
  proposal_id?: string;
  target_key?: string;
  approval_id?: string;
  artifact_id?: string;
  reason?: string;
}

export interface ToolSlotEvent extends EventBase {
  type: 'tool.slot.reserved' | 'tool.slot.committed' | 'tool.slot.released';
  parent_concept_id: string;
  capability_fingerprint: string;
  tool_name?: string;
  node_id?: string;
  approval_id?: string;
  reason?: string;
}

export interface BlockEvent extends EventBase {
  type: 'block.loaded' | 'block.activated' | 'block.deactivated' | 'block.error';
  block_id: string;
  status: string;
  version?: string;
  error?: string;
  warnings?: string[];
  manifest_ref?: unknown;
  result_ref?: unknown;
  registered_capability_tools?: string[];
  registered_contract_refs?: string[];
}

export interface UniversalEngineEvent extends EventBase {
  type:
    | 'concept.received'
    | 'concept.planned'
    | 'concept.completed'
    | 'research.started'
    | 'research.completed'
    | 'critique.started'
    | 'critique.completed'
    | 'strategy.snapshot.created'
    | 'tool.forge.requested'
    | 'tool.forge.blocked'
    | 'extension.tool_blocked'
    | 'delivery.started'
    | 'delivery.completed'
    | 'delivery.failed'
    | 'postmortem.started'
    | 'postmortem.completed'
    | 'sandbox.run.started'
    | 'sandbox.run.completed';
  concept_id?: string;
  parent_concept_id?: string;
  node_id?: string;
  plan_id?: string;
  research_id?: string;
  critique_id?: string;
  artifact_count?: number;
  bundle_artifact_id?: string;
  manifest_artifact_id?: string;
  strategy_snapshot_ref?: string;
  tool_name?: string;
  capability_fingerprint?: string;
  sandbox_backend?: string;
  artifact_id?: string;
  status?: string;
  reason?: string;
  error?: string;
  ms?: number;
}

export interface StruggleDetectedEvent extends EventBase {
  type: 'struggle.detected';
  concept_id?: string;
  node_id?: string;
  signal_kind: 'flat' | 'regression' | 'oscillation';
  loop_count: number;
  verdict?: string;
  last_score?: number;
  iterations?: number;
  from_score?: number;
  to_score?: number;
  window?: number;
  reason?: string;
}

export interface ContextRotatedEvent extends EventBase {
  type: 'context.rotated';
  concept_id?: string;
  node_id?: string;
  reason: string;
  tokens_estimated: number;
  summary_tokens_estimated?: number;
  preserved_artifact_refs?: string[];
}

export interface SupervisorDecisionEvent extends EventBase {
  type: 'supervisor.decision';
  concept_id?: string;
  node_id?: string;
  action: 'rotate_context' | 'continue' | 'abort';
  trigger: 'context_pressure' | 'struggle_detected';
  loop_count?: number;
  artifact_refs?: string[];
  reason?: string;
  decision_vector_ref?: string;
  decision_vector?: DecisionVector;
}

export interface RunBlockedEvent extends EventBase {
  type: 'run.blocked';
  reason?: string;
}

export interface RunCompletedEvent extends EventBase {
  type: 'run.completed';
  ms?: number;
  status?: string;
}

export interface RunFailedEvent extends EventBase {
  type: 'run.failed';
  error?: string;
  ms?: number;
}

export interface RunCancelledEvent extends EventBase {
  type: 'run.cancelled';
  reason?: string;
}

export interface ActorEvent extends EventBase {
  type:
    | 'actor.spawned'
    | 'actor.mailbox.enqueued'
    | 'actor.mailbox.leased'
    | 'actor.work.started'
    | 'actor.mailbox.completed'
    | 'actor.work.completed'
    | 'actor.mailbox.failed'
    | 'actor.failed';
  actor_id: string;
  agent_id?: string;
  agent_name?: string;
  artifact_id?: string;
  blocker?: string;
  budget?: unknown;
  child_run_id?: string;
  current_work?: string;
  error?: string;
  highlights?: unknown;
  node_id?: string;
  output?: string;
  owner?: string;
  parent_actor_id?: string;
  priority?: number;
  reason?: string;
  retryable?: boolean;
  role?: string;
  summary?: string;
  task?: string;
}

export type LedgerEvent =
  | RunCreatedEvent
  | RunTransitionedEvent
  | PlanProposedEvent
  | ApprovalRequestedEvent
  | ApprovalGrantedEvent
  | ApprovalDeniedEvent
  | ModelTurnStartedEvent
  | ModelTurnCompletedEvent
  | ToolRequestedEvent
  | ToolApprovedEvent
  | ToolDeniedEvent
  | ToolExecutedEvent
  | EffectProposedEvent
  | EffectPolicyDecidedEvent
  | EffectAppliedEvent
  | EffectDeniedEvent
  | EffectFailedEvent
  | DagCreatedEvent
  | DagNodeReadyEvent
  | DagNodeStartedEvent
  | DagNodeCompletedEvent
  | DagNodeFailedEvent
  | DagLeaseAcquiredEvent
  | DagLeaseReleasedEvent
  | VerifierStartedEvent
  | VerifierCompletedEvent
  | VerifierWaivedEvent
  | EvalCompletedEvent
  | ArtifactCreatedEvent
  | DiffProposedEvent
  | DiffAppliedEvent
  | TestCompletedEvent
  | GovernanceGateCheckedEvent
  | GovernanceGateViolationEvent
  | DecisionRecordAuditGeneratedEvent
  | LegacyNodeAuditGeneratedEvent
  | MemoryWrittenEvent
  | MemoryConflictEvent
  | SelfImprovementProposalEvent
  | SelfModificationEngineEvent
  | ToolSlotEvent
  | BlockEvent
  | UniversalEngineEvent
  | StruggleDetectedEvent
  | ContextRotatedEvent
  | SupervisorDecisionEvent
  | RunBlockedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | RunCancelledEvent
  | ActorEvent;

export type LedgerAppendInput = LedgerEvent extends infer Event
  ? Event extends LedgerEvent
    ? Omit<Event, 'id' | 'ts' | 'seq'>
    : never
  : never;
export type LegacyLedgerAppendInput = Omit<LedgerEvent, 'id' | 'ts' | 'seq'>;

// ====== Pure functional helpers =============================================

/**
 * Parse a single JSONL line. Returns null (and warns) on corrupt input.
 */
export function parseLine(line: string): LedgerEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<LedgerEvent>;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.type !== 'string' ||
      typeof parsed.id !== 'string' ||
      typeof parsed.ts !== 'string' ||
      typeof parsed.seq !== 'number' ||
      !Number.isFinite(parsed.seq) ||
      ('run_id' in parsed && parsed.run_id !== undefined && typeof parsed.run_id !== 'string')
    ) {
      logger.warn(`[EventLedger] Skipping structurally invalid JSONL line: ${trimmed.slice(0, 120)}`);
      return null;
    }
    return parsed as LedgerEvent;
  } catch {
    logger.warn(`[EventLedger] Skipping corrupt JSONL line: ${trimmed.slice(0, 120)}`);
    return null;
  }
}

/**
 * Construct a LedgerEvent with auto-generated id and ts; seq defaults to 0.
 * Useful for testing or pre-building events before appending.
 */
export function makeEvent(
  partial: Omit<LedgerEvent, 'id' | 'ts' | 'seq'> & { seq?: number },
): LedgerEvent {
  return {
    id: nodeCrypto.randomUUID(),
    ts: new Date().toISOString(),
    seq: partial.seq ?? 0,
    ...partial,
  } as LedgerEvent;
}

// ====== EventLedger class ====================================================

export interface EventLedgerOptions {
  /** If true, fsync is called after every append for crash durability. */
  fsync?: boolean;
}

export type EventLedgerListener = (event: LedgerEvent) => void;

export class EventLedger {
  private readonly filePath: string;
  private readonly opts: Required<EventLedgerOptions>;
  /** Monotonic counter — seeded from line count on first append/read. */
  private seq = -1;
  /** Whether seq has been initialised from disk. */
  private seqReady = false;
  private readonly listeners = new Set<EventLedgerListener>();
  private appendChain: Promise<unknown> = Promise.resolve();

  constructor(filePath: string, opts: EventLedgerOptions = {}) {
    this.filePath = path.resolve(filePath);
    this.opts = { fsync: false, ...opts };
  }

  get storagePath(): string {
    return this.filePath;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /** Ensure parent directory exists. */
  private async ensureDir(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
  }

  /** Seed the next seq counter from valid persisted events (called once). */
  private async initSeq(): Promise<void> {
    if (this.seqReady) return;
    let nextSeq = 0;
    try {
      for await (const event of this.readStream()) {
        nextSeq = Math.max(nextSeq, event.seq + 1);
      }
    } catch {
      // File doesn't exist yet — seq starts at 0
    }
    this.seq = nextSeq;
    this.seqReady = true;
  }

  private async ensureLineBoundary(): Promise<void> {
    const fh = await open(this.filePath, 'a+');
    try {
      const stats = await fh.stat();
      if (stats.size === 0) return;
      const last = Buffer.alloc(1);
      await fh.read(last, 0, 1, stats.size - 1);
      if (last[0] !== 0x0a) {
        await fh.write('\n');
        if (this.opts.fsync) await fh.datasync();
      }
    } finally {
      await fh.close();
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Append a new event. Auto-fills `id`, `ts`, and `seq`.
   * Uses 'a' flag so existing data is never overwritten.
   */
  async append(event: LedgerAppendInput | LegacyLedgerAppendInput): Promise<LedgerEvent> {
    const appendOp = this.appendChain.then(() => this.appendNow(event));
    this.appendChain = appendOp.then(
      () => undefined,
      () => undefined,
    );
    return appendOp;
  }

  private async appendNow(event: LedgerAppendInput | LegacyLedgerAppendInput): Promise<LedgerEvent> {
    await this.ensureDir();
    await this.initSeq();

    const full: LedgerEvent = {
      ...event,
      id: nodeCrypto.randomUUID(),
      ts: new Date().toISOString(),
      seq: this.seq++,
    } as LedgerEvent;

    const line = JSON.stringify(full) + '\n';
    await this.ensureLineBoundary();
    const fh = await open(this.filePath, 'a');
    try {
      await fh.write(line);
      if (this.opts.fsync) await fh.datasync();
    } finally {
      await fh.close();
    }

    this.notify(full);
    return full;
  }

  subscribe(listener: EventLedgerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(event: LedgerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.warn('[EventLedger] subscriber failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Read all events from the ledger file.
   * Corrupt lines are skipped (logged as warn).
   */
  async readAll(): Promise<LedgerEvent[]> {
    const events: LedgerEvent[] = [];
    try {
      for await (const event of this.readStream()) {
        events.push(event);
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
    return events;
  }

  /**
   * Stream events line-by-line. Tolerant of a partial last line.
   * Corrupt lines are skipped.
   */
  async *readStream(): AsyncIterable<LedgerEvent> {
    // createReadStream emits errors asynchronously, so we must handle them via
    // the stream's error event before attaching readline.
    const stream = createReadStream(this.filePath, { encoding: 'utf8' });

    // Wrap stream in a promise that resolves once the stream is open (or rejects
    // on ENOENT / other open errors), so we can bail early without leaving
    // dangling handles.
    await new Promise<void>((resolve, reject) => {
      stream.once('ready', () => resolve());
      stream.once('error', (err) => reject(err));
    }).catch((err: NodeJS.ErrnoException) => {
      stream.destroy();
      if (err.code === 'ENOENT') return; // file doesn't exist yet — yield nothing
      throw err;
    });

    if (stream.destroyed) return;

    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        const event = parseLine(line);
        if (event) yield event;
      }
    } finally {
      rl.close();
      stream.destroy();
    }
  }

  /**
   * Return all events matching `predicate`.
   */
  async filter(predicate: (e: LedgerEvent) => boolean): Promise<LedgerEvent[]> {
    const all = await this.readAll();
    return all.filter(predicate);
  }

  /**
   * Return all events for a given run_id in append order.
   */
  async byRun(runId: string): Promise<LedgerEvent[]> {
    return this.filter((e) => e.run_id === runId);
  }

  /**
   * Return the most-recently appended event for a given run_id.
   */
  async lastEventForRun(runId: string): Promise<LedgerEvent | undefined> {
    const events = await this.byRun(runId);
    return events.length > 0 ? events[events.length - 1] : undefined;
  }

  /**
   * No-op for API symmetry; individual appends use short-lived file handles.
   */
  async close(): Promise<void> {
    await this.appendChain;
  }
}
