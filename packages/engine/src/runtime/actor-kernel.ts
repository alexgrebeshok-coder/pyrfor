import { randomUUID } from 'node:crypto';
import type { ArtifactRef, ArtifactStore } from './artifact-model';
import type { DagNode, DurableDag } from './durable-dag';
import type { EventLedger } from './event-ledger';
import type { RunLedger } from './run-ledger';
import type { BudgetProfile, PermissionProfile, RunRecord } from './run-lifecycle';

export interface ActorKernelDeps {
  runLedger: Pick<RunLedger, 'createRun' | 'getRun' | 'replayRun' | 'recordArtifact'>;
  eventLedger: Pick<EventLedger, 'append'>;
  dag: Pick<DurableDag, 'addNode' | 'listReady' | 'listNodes' | 'leaseNode' | 'startNode' | 'completeNode' | 'failNode' | 'getNode' | 'addProvenance'>;
  artifactStore: Pick<ArtifactStore, 'writeJSON' | 'list'>;
  now?: () => Date;
  idFactory?: () => string;
}

export interface SpawnActorInput {
  runId: string;
  actorId?: string;
  agentId: string;
  agentName?: string;
  role?: string;
  parentActorId?: string;
  goal?: string;
  budget?: BudgetProfile;
  permissionProfile?: PermissionProfile;
}

export interface SpawnActorResult {
  actorId: string;
  childRun: RunRecord;
}

export interface EnqueueActorMessageInput {
  runId: string;
  actorId: string;
  task: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  priority?: number;
  allowConcurrent?: boolean;
}

export interface LeaseActorMessageInput {
  runId: string;
  owner: string;
  actorId?: string;
  ttlMs?: number;
}

export interface LeaseActorMessageResult {
  node: DagNode;
}

export interface CompleteActorMessageInput {
  runId: string;
  nodeId: string;
  owner: string;
  output?: string;
  summary?: string;
  proof?: Record<string, unknown>;
}

export interface CompleteActorMessageResult {
  node: DagNode;
  proofArtifact: ArtifactRef;
  alreadyFinalized?: boolean;
}

export interface FailActorMessageInput {
  runId: string;
  nodeId: string;
  owner: string;
  reason: string;
  retryable?: boolean;
}

export interface RecoverStuckActorMessagesInput {
  runId: string;
  actorId?: string;
  olderThanMs: number;
  reason?: string;
}

export interface RecoverStuckActorMessagesResult {
  recovered: DagNode[];
}

type ActorLedgerEvent = {
  run_id: string;
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
  [key: string]: unknown;
};

const DEFAULT_LEASE_TTL_MS = 5 * 60_000;

export class ActorKernel {
  private readonly deps: ActorKernelDeps;
  private readonly proofFinalizationLocks = new Map<string, Promise<void>>();

  constructor(deps: ActorKernelDeps) {
    this.deps = deps;
  }

  async spawnActor(input: SpawnActorInput): Promise<SpawnActorResult> {
    const parent = await this.requireRun(input.runId);
    const actorId = input.actorId?.trim() || `actor-${this.id()}`;
    const childRunId = `${parent.run_id}:actor:${actorId}`;
    const existing = this.deps.runLedger.getRun(childRunId) ?? await this.deps.runLedger.replayRun(childRunId);
    if (existing) return { actorId, childRun: existing };
    const childRun = await this.deps.runLedger.createRun({
      run_id: childRunId,
      parent_run_id: parent.run_id,
      workspace_id: parent.workspace_id,
      repo_id: parent.repo_id,
      branch_or_worktree_id: parent.branch_or_worktree_id,
      mode: 'autonomous',
      task_id: `actor:${input.agentId}`,
      goal: input.goal ?? input.role ?? input.agentName ?? input.agentId,
      model_profile: parent.model_profile,
      provider_route: parent.provider_route,
      permission_profile: input.permissionProfile ?? parent.permission_profile,
      budget_profile: input.budget ?? parent.budget_profile,
      context_snapshot_hash: parent.context_snapshot_hash,
      prompt_snapshot_hash: parent.prompt_snapshot_hash,
    });
    await this.appendActorEvent({
      type: 'actor.spawned',
      run_id: parent.run_id,
      actor_id: actorId,
      child_run_id: childRun.run_id,
      agent_id: input.agentId,
      ...(input.agentName ? { agent_name: input.agentName } : {}),
      ...(input.role ? { role: input.role } : {}),
      ...(input.parentActorId ? { parent_actor_id: input.parentActorId } : {}),
      ...(input.goal ? { current_work: input.goal } : {}),
      ...(childRun.budget_profile ? { budget: childRun.budget_profile } : {}),
    });
    return { actorId, childRun };
  }

  async enqueueMessage(input: EnqueueActorMessageInput): Promise<DagNode> {
    const run = await this.requireRun(input.runId);
    const actorId = input.actorId.trim();
    if (!actorId) throw new Error('ActorKernel: actorId is required');
    const task = input.task.trim();
    if (!task) throw new Error('ActorKernel: task is required');
    const node = this.deps.dag.addNode({
      kind: 'actor.mailbox.task',
      payload: {
        runId: run.run_id,
        actorId,
        task,
        priority: input.priority ?? 0,
        allowConcurrent: input.allowConcurrent === true,
        ...(input.payload ? { payload: input.payload } : {}),
      },
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      retryClass: 'transient',
      timeoutClass: 'normal',
      provenance: [{ kind: 'run', ref: run.run_id, role: 'input' }],
    });
    await this.appendActorEvent({
      type: 'actor.mailbox.enqueued',
      run_id: run.run_id,
      actor_id: actorId,
      node_id: node.id,
      task,
      priority: input.priority ?? 0,
    });
    return node;
  }

  async leaseNextMessage(input: LeaseActorMessageInput): Promise<LeaseActorMessageResult | null> {
    const run = await this.requireRun(input.runId);
    const busyActorIds = new Set(this.deps.dag.listNodes()
      .filter((node) => node.kind === 'actor.mailbox.task'
        && node.payload['runId'] === run.run_id
        && (node.status === 'leased' || node.status === 'running'))
      .map((node) => String(node.payload['actorId'] ?? 'unknown')));
    const ready = this.deps.dag.listReady()
      .filter((node) => node.kind === 'actor.mailbox.task'
        && node.payload['runId'] === run.run_id
        && (!input.actorId || node.payload['actorId'] === input.actorId)
        && (!busyActorIds.has(String(node.payload['actorId'] ?? 'unknown')) || node.payload['allowConcurrent'] === true))
      .sort((left, right) => Number(right.payload['priority'] ?? 0) - Number(left.payload['priority'] ?? 0)
        || left.createdAt - right.createdAt);
    const next = ready[0];
    if (!next) return null;
    const leased = this.deps.dag.leaseNode(next.id, input.owner, input.ttlMs ?? DEFAULT_LEASE_TTL_MS);
    const started = this.deps.dag.startNode(leased.id, input.owner);
    const actorId = String(started.payload['actorId'] ?? input.actorId ?? 'unknown');
    await this.appendActorEvent({
      type: 'actor.mailbox.leased',
      run_id: run.run_id,
      actor_id: actorId,
      node_id: started.id,
      owner: input.owner,
      task: started.payload['task'],
    });
    await this.appendActorEvent({
      type: 'actor.work.started',
      run_id: run.run_id,
      actor_id: actorId,
      node_id: started.id,
      owner: input.owner,
      current_work: started.payload['task'],
    });
    return { node: started };
  }

  async completeMessage(input: CompleteActorMessageInput): Promise<CompleteActorMessageResult> {
    return this.withProofFinalizationLock(`${input.runId}:${input.nodeId}`, async () => this.completeMessageLocked(input));
  }

  private async completeMessageLocked(input: CompleteActorMessageInput): Promise<CompleteActorMessageResult> {
    const run = await this.requireRun(input.runId);
    const node = this.requireCompletableMailboxNode(input.nodeId, run.run_id, input.owner);
    const actorId = String(node.payload['actorId'] ?? 'unknown');
    const completed = node.status === 'succeeded'
      ? node
      : this.deps.dag.completeNode(node.id, [{
        kind: 'run',
        ref: run.run_id,
        role: 'decision',
        meta: { actorId, actorKernelKind: 'actor_completion_owner', owner: input.owner },
      }]);
    const existingProof = completed.provenance.find((link) =>
      link.kind === 'artifact' && link.meta?.['artifactKind'] === 'actor_work_proof'
    );
    if (existingProof) {
      const proofArtifact = await this.findExistingProofArtifact(run.run_id, node.id, existingProof.ref);
      if (!proofArtifact) {
        throw new Error(`ActorKernel: proof artifact "${existingProof.ref}" not found for mailbox node "${node.id}"`);
      }
      return {
        node: completed,
        proofArtifact,
        alreadyFinalized: true,
      };
    }
    const existingArtifact = await this.findExistingProofArtifact(run.run_id, node.id);
    const artifact = existingArtifact ?? await this.deps.artifactStore.writeJSON('summary', {
      schemaVersion: 'pyrfor.actor_work_proof.v1',
      runId: run.run_id,
      actorId,
      nodeId: node.id,
      task: node.payload['task'],
      completedAt: this.nowIso(),
      owner: input.owner,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.output ? { output: input.output } : {}),
      ...(input.proof ? { proof: input.proof } : {}),
    }, {
      runId: run.run_id,
      meta: { artifactKind: 'actor_work_proof', actorId, nodeId: node.id, owner: input.owner },
    });
    await this.deps.runLedger.recordArtifact(run.run_id, artifact.id);
    const completedWithProof = this.deps.dag.addProvenance(completed.id, {
      kind: 'artifact',
      ref: artifact.id,
      role: 'evidence',
      ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
      meta: { actorId, artifactKind: 'actor_work_proof', owner: input.owner },
    });
    await this.appendActorEvent({
      type: 'actor.mailbox.completed',
      run_id: run.run_id,
      actor_id: actorId,
      node_id: completed.id,
      artifact_id: artifact.id,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.output ? { output: input.output } : {}),
    });
    await this.appendActorEvent({
      type: 'actor.work.completed',
      run_id: run.run_id,
      actor_id: actorId,
      node_id: completed.id,
      artifact_id: artifact.id,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.output ? { output: input.output } : {}),
    });
    return { node: completedWithProof, proofArtifact: artifact };
  }

  async failMessage(input: FailActorMessageInput): Promise<DagNode> {
    const run = await this.requireRun(input.runId);
    const node = this.requireLeasedMailboxNode(input.nodeId, run.run_id, input.owner);
    const actorId = String(node.payload['actorId'] ?? 'unknown');
    const failed = this.deps.dag.failNode(node.id, input.reason, input.retryable ?? false);
    await this.appendActorEvent({
      type: 'actor.mailbox.failed',
      run_id: run.run_id,
      actor_id: actorId,
      node_id: failed.id,
      reason: input.reason,
      retryable: input.retryable ?? false,
    });
    if (!input.retryable) {
      await this.appendActorEvent({
        type: 'actor.failed',
        run_id: run.run_id,
        actor_id: actorId,
        node_id: failed.id,
        reason: input.reason,
        retryable: false,
      });
    }
    return failed;
  }

  async recoverStuckMessages(input: RecoverStuckActorMessagesInput): Promise<RecoverStuckActorMessagesResult> {
    if (!Number.isFinite(input.olderThanMs) || input.olderThanMs <= 0) {
      throw new Error('ActorKernel: olderThanMs must be a positive number');
    }
    const run = await this.requireRun(input.runId);
    const now = this.nowMs();
    const reason = input.reason?.trim() || 'supervisor_stuck_actor';
    const candidates = this.deps.dag.listNodes()
      .filter((node) => node.kind === 'actor.mailbox.task'
        && node.payload['runId'] === run.run_id
        && (node.status === 'leased' || node.status === 'running')
        && (!input.actorId || node.payload['actorId'] === input.actorId)
        && now - (node.lease?.leasedAt ?? node.updatedAt) >= input.olderThanMs)
      .sort((left, right) => left.updatedAt - right.updatedAt);
    const recovered: DagNode[] = [];
    for (const node of candidates) {
      const actorId = String(node.payload['actorId'] ?? input.actorId ?? 'unknown');
      const recoveredNode = this.deps.dag.failNode(node.id, reason, true);
      recovered.push(recoveredNode);
      await this.appendActorEvent({
        type: 'actor.mailbox.failed',
        run_id: run.run_id,
        actor_id: actorId,
        node_id: recoveredNode.id,
        reason,
        retryable: true,
        recovered: true,
        previous_owner: node.lease?.owner,
      });
    }
    return { recovered };
  }

  private async requireRun(runId: string): Promise<RunRecord> {
    const run = this.deps.runLedger.getRun(runId) ?? await this.deps.runLedger.replayRun(runId);
    if (!run) throw new Error(`ActorKernel: run "${runId}" not found`);
    return run;
  }

  private requireMailboxNode(nodeId: string, runId: string): DagNode {
    const node = this.deps.dag.getNode(nodeId);
    if (!node || node.kind !== 'actor.mailbox.task' || node.payload['runId'] !== runId) {
      throw new Error(`ActorKernel: actor mailbox node "${nodeId}" not found for run "${runId}"`);
    }
    return node;
  }

  private requireLeasedMailboxNode(nodeId: string, runId: string, owner: string): DagNode {
    const node = this.requireMailboxNode(nodeId, runId);
    if (node.status !== 'leased' && node.status !== 'running') {
      throw new Error(`ActorKernel: actor mailbox node "${nodeId}" is not leased`);
    }
    if (node.lease?.owner !== owner) {
      throw new Error(`ActorKernel: mailbox node "${nodeId}" is leased by another owner`);
    }
    return node;
  }

  private requireCompletableMailboxNode(nodeId: string, runId: string, owner: string): DagNode {
    const node = this.requireMailboxNode(nodeId, runId);
    if (node.status === 'succeeded') {
      const completionOwner = this.getCompletionOwner(node);
      if (completionOwner !== owner) {
        throw new Error(`ActorKernel: mailbox node "${nodeId}" was completed by another owner`);
      }
      return node;
    }
    if (node.status !== 'leased' && node.status !== 'running') {
      throw new Error(`ActorKernel: actor mailbox node "${nodeId}" is not leased`);
    }
    if (node.lease?.owner !== owner) {
      throw new Error(`ActorKernel: mailbox node "${nodeId}" is leased by another owner`);
    }
    return node;
  }

  private async findExistingProofArtifact(runId: string, nodeId: string, artifactId?: string): Promise<ArtifactRef | undefined> {
    const artifacts = await this.deps.artifactStore.list({ runId, kind: 'summary' });
    return artifacts.find((artifact) =>
      artifact.meta?.['artifactKind'] === 'actor_work_proof'
      && artifact.meta?.['nodeId'] === nodeId
      && (!artifactId || artifact.id === artifactId)
    );
  }

  private getCompletionOwner(node: DagNode): string | undefined {
    const ownerLink = [...node.provenance].reverse().find((link) =>
      link.meta?.['actorKernelKind'] === 'actor_completion_owner'
    );
    return typeof ownerLink?.meta?.['owner'] === 'string' ? ownerLink.meta['owner'] : undefined;
  }

  private async withProofFinalizationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.proofFinalizationLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.catch(() => undefined).then(() => current);
    this.proofFinalizationLocks.set(key, next);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.proofFinalizationLocks.get(key) === next) {
        this.proofFinalizationLocks.delete(key);
      }
    }
  }

  private async appendActorEvent(event: ActorLedgerEvent): Promise<void> {
    await this.deps.eventLedger.append(event);
  }

  private nowIso(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }

  private nowMs(): number {
    return (this.deps.now ?? (() => new Date()))().getTime();
  }

  private id(): string {
    return this.deps.idFactory?.() ?? randomUUID();
  }
}

export function createActorKernel(deps: ActorKernelDeps): ActorKernel {
  return new ActorKernel(deps);
}
