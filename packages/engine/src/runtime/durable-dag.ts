/**
 * durable-dag.ts — durable task DAG with leases, idempotency and provenance.
 *
 * This is an orchestration primitive, not a worker queue. It records what can
 * run, who leased it, what artifacts/effects it produced, and how to recover
 * when a lease expires.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventLedger, type LedgerAppendInput } from './event-ledger';

export type DagNodeStatus =
  | 'pending'
  | 'ready'
  | 'leased'
  | 'running'
  | 'blocked'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type DagRetryClass = 'none' | 'transient' | 'deterministic' | 'policy' | 'human_needed';
export type DagTimeoutClass = 'short' | 'normal' | 'long' | 'manual';

export interface DagLease {
  owner: string;
  leasedAt: number;
  expiresAt: number;
}

export interface DagCompensationPolicy {
  kind: 'none' | 'rollback' | 'manual';
  rollbackHandle?: string;
  note?: string;
}

export interface DagProvenanceLink {
  kind: 'run' | 'artifact' | 'effect' | 'ledger_event' | 'worker_frame' | 'memory';
  ref: string;
  role: 'input' | 'output' | 'evidence' | 'decision' | 'side_effect';
  sha256?: string;
  meta?: Record<string, unknown>;
}

export interface DagNode {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  status: DagNodeStatus;
  dependsOn: string[];
  idempotencyKey: string;
  retryClass: DagRetryClass;
  timeoutClass: DagTimeoutClass;
  compensation: DagCompensationPolicy;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lease?: DagLease;
  failure?: {
    reason: string;
    retryable: boolean;
  };
  provenance: DagProvenanceLink[];
}

export interface DurableDagOptions {
  storePath?: string;
  clock?: () => number;
  ledger?: EventLedger;
  ledgerRunId?: string;
  dagId?: string;
}

export interface AddDagNodeInput {
  id?: string;
  kind: string;
  payload?: Record<string, unknown>;
  dependsOn?: string[];
  idempotencyKey?: string;
  retryClass?: DagRetryClass;
  timeoutClass?: DagTimeoutClass;
  compensation?: DagCompensationPolicy;
  provenance?: DagProvenanceLink[];
}

export interface HydrateDagNodeInput {
  id: string;
  kind: string;
  payload?: Record<string, unknown>;
  status?: DagNodeStatus;
  dependsOn?: string[];
  idempotencyKey?: string;
  retryClass?: DagRetryClass;
  timeoutClass?: DagTimeoutClass;
  compensation?: DagCompensationPolicy;
  attempts?: number;
  createdAt?: number;
  updatedAt?: number;
  lease?: DagLease;
  failure?: DagNode['failure'];
  provenance?: DagProvenanceLink[];
}

const TERMINAL_STATUSES = new Set<DagNodeStatus>(['succeeded', 'failed', 'cancelled']);

function cloneNode(node: DagNode): DagNode {
  return {
    ...node,
    payload: { ...node.payload },
    dependsOn: [...node.dependsOn],
    lease: node.lease ? { ...node.lease } : undefined,
    failure: node.failure ? { ...node.failure } : undefined,
    compensation: { ...node.compensation },
    provenance: node.provenance.map((link) => ({
      ...link,
      meta: link.meta ? { ...link.meta } : undefined,
    })),
  };
}

function isTerminal(status: DagNodeStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export class DurableDag {
  private readonly storePath: string | undefined;
  private readonly clock: () => number;
  private readonly ledger: EventLedger | undefined;
  private readonly ledgerRunId: string;
  private readonly dagId: string;
  private ledgerWriteChain: Promise<unknown> = Promise.resolve();
  private readonly nodes = new Map<string, DagNode>();

  constructor(options: DurableDagOptions = {}) {
    this.storePath = options.storePath;
    this.clock = options.clock ?? Date.now;
    this.ledger = options.ledger;
    this.ledgerRunId = options.ledgerRunId ?? options.dagId ?? 'durable-dag';
    this.dagId = options.dagId ?? this.ledgerRunId;
    this.load();
  }

  addNode(input: AddDagNodeInput): DagNode {
    const idempotencyKey = input.idempotencyKey ?? input.id ?? randomUUID();
    const existing = this.findActiveByIdempotencyKey(idempotencyKey);
    if (existing) return cloneNode(existing);

    const now = this.clock();
    const node: DagNode = {
      id: input.id ?? randomUUID(),
      kind: input.kind,
      payload: input.payload ?? {},
      status: 'pending',
      dependsOn: input.dependsOn ?? [],
      idempotencyKey,
      retryClass: input.retryClass ?? 'transient',
      timeoutClass: input.timeoutClass ?? 'normal',
      compensation: input.compensation ?? { kind: 'none' },
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      provenance: input.provenance ?? [],
    };
    this.nodes.set(node.id, node);
    this.flush();
    this.appendLedger({
      type: 'dag.created',
      run_id: this.ledgerRunId,
      dag_id: this.dagId,
      node_count: this.nodes.size,
    });
    if (this.dependenciesSatisfied(node)) {
      this.appendLedger({
        type: 'dag.node.ready',
        run_id: this.ledgerRunId,
        dag_id: this.dagId,
        node_id: node.id,
        kind: node.kind,
        idempotency_key: node.idempotencyKey,
      });
    }
    return cloneNode(node);
  }

  getNode(id: string): DagNode | undefined {
    const node = this.nodes.get(id);
    return node ? cloneNode(node) : undefined;
  }

  hydrateNode(input: HydrateDagNodeInput): DagNode {
    const now = this.clock();
    const existing = this.nodes.get(input.id);
    const node: DagNode = {
      id: input.id,
      kind: input.kind,
      payload: input.payload ?? existing?.payload ?? {},
      status: input.status ?? existing?.status ?? 'pending',
      dependsOn: input.dependsOn ?? existing?.dependsOn ?? [],
      idempotencyKey: input.idempotencyKey ?? existing?.idempotencyKey ?? input.id,
      retryClass: input.retryClass ?? existing?.retryClass ?? 'transient',
      timeoutClass: input.timeoutClass ?? existing?.timeoutClass ?? 'normal',
      compensation: input.compensation ?? existing?.compensation ?? { kind: 'none' },
      attempts: input.attempts ?? existing?.attempts ?? 0,
      createdAt: input.createdAt ?? existing?.createdAt ?? now,
      updatedAt: input.updatedAt ?? existing?.updatedAt ?? now,
      lease: input.lease ?? existing?.lease,
      failure: input.failure ?? existing?.failure,
      provenance: input.provenance ?? existing?.provenance ?? [],
    };
    this.nodes.set(node.id, node);
    this.flush();
    return cloneNode(node);
  }

  listNodes(filter?: { status?: DagNodeStatus; kind?: string }): DagNode[] {
    let nodes = Array.from(this.nodes.values());
    if (filter?.status) nodes = nodes.filter((node) => node.status === filter.status);
    if (filter?.kind) nodes = nodes.filter((node) => node.kind === filter.kind);
    return nodes.map(cloneNode);
  }

  listReady(): DagNode[] {
    return Array.from(this.nodes.values())
      .filter((node) => (node.status === 'pending' || node.status === 'ready') && this.dependenciesSatisfied(node))
      .map(cloneNode);
  }

  leaseNode(nodeId: string, owner: string, ttlMs: number): DagNode {
    const node = this.requireNode(nodeId);
    if (!this.dependenciesSatisfied(node)) {
      throw new Error(`DurableDag: dependencies are not satisfied for node "${nodeId}"`);
    }
    if (node.status !== 'pending' && node.status !== 'ready' && !this.isLeaseExpired(node)) {
      throw new Error(`DurableDag: node "${nodeId}" is not leaseable (${node.status})`);
    }
    const now = this.clock();
    const updated = this.updateNode(node, {
      status: 'leased',
      lease: { owner, leasedAt: now, expiresAt: now + ttlMs },
      failure: undefined,
    });
    this.appendLedger({
      type: 'dag.lease.acquired',
      run_id: this.ledgerRunId,
      dag_id: this.dagId,
      node_id: updated.id,
      owner,
      expires_at: updated.lease?.expiresAt ?? now + ttlMs,
    });
    return cloneNode(updated);
  }

  startNode(nodeId: string, owner: string): DagNode {
    const node = this.requireNode(nodeId);
    if (node.status !== 'leased' || node.lease?.owner !== owner) {
      throw new Error(`DurableDag: node "${nodeId}" is not leased by "${owner}"`);
    }
    const updated = this.updateNode(node, {
      status: 'running',
      attempts: node.attempts + 1,
    });
    this.appendLedger({
      type: 'dag.node.started',
      run_id: this.ledgerRunId,
      dag_id: this.dagId,
      node_id: updated.id,
      owner,
      attempt: updated.attempts,
    });
    return cloneNode(updated);
  }

  completeNode(nodeId: string, provenance: DagProvenanceLink[] = []): DagNode {
    const node = this.requireNode(nodeId);
    if (node.status !== 'leased' && node.status !== 'running') {
      throw new Error(`DurableDag: node "${nodeId}" cannot complete from ${node.status}`);
    }
    const updated = this.updateNode(node, {
      status: 'succeeded',
      lease: undefined,
      failure: undefined,
      provenance: [...node.provenance, ...provenance],
    });
    this.appendLedger({
      type: 'dag.node.completed',
      run_id: this.ledgerRunId,
      dag_id: this.dagId,
      node_id: updated.id,
      artifact_refs: provenance
        .filter((link) => link.kind === 'artifact')
        .map((link) => link.ref),
    });
    this.appendLedger({
      type: 'dag.lease.released',
      run_id: this.ledgerRunId,
      dag_id: this.dagId,
      node_id: updated.id,
      owner: node.lease?.owner,
      reason: 'completed',
    });
    this.markNewlyReady();
    return cloneNode(updated);
  }

  failNode(nodeId: string, reason: string, retryable: boolean): DagNode {
    const node = this.requireNode(nodeId);
    const updated = this.updateNode(node, {
      status: retryable ? 'pending' : 'failed',
      lease: undefined,
      failure: { reason, retryable },
    });
    this.appendLedger({
      type: 'dag.node.failed',
      run_id: this.ledgerRunId,
      dag_id: this.dagId,
      node_id: updated.id,
      reason,
      retryable,
    });
    this.appendLedger({
      type: 'dag.lease.released',
      run_id: this.ledgerRunId,
      dag_id: this.dagId,
      node_id: updated.id,
      owner: node.lease?.owner,
      reason: retryable ? 'retryable_failure' : 'failed',
    });
    return cloneNode(updated);
  }

  cancelNode(nodeId: string): DagNode {
    const node = this.requireNode(nodeId);
    const updated = this.updateNode(node, {
      status: 'cancelled',
      lease: undefined,
    });
    this.appendLedger({
      type: 'dag.lease.released',
      run_id: this.ledgerRunId,
      dag_id: this.dagId,
      node_id: updated.id,
      owner: node.lease?.owner,
      reason: 'cancelled',
    });
    return cloneNode(updated);
  }

  addProvenance(nodeId: string, link: DagProvenanceLink): DagNode {
    const node = this.requireNode(nodeId);
    const updated = this.updateNode(node, {
      provenance: [...node.provenance, link],
    });
    return cloneNode(updated);
  }

  reclaimExpiredLeases(): DagNode[] {
    const reclaimed: DagNode[] = [];
    for (const node of this.nodes.values()) {
      if ((node.status === 'leased' || node.status === 'running') && this.isLeaseExpired(node)) {
        const updated = this.updateNode(node, {
          status: 'pending',
          lease: undefined,
          failure: { reason: 'lease_expired', retryable: true },
        });
        this.appendLedger({
          type: 'dag.lease.released',
          run_id: this.ledgerRunId,
          dag_id: this.dagId,
          node_id: updated.id,
          owner: node.lease?.owner,
          reason: 'lease_expired',
        });
        reclaimed.push(cloneNode(updated));
      }
    }
    return reclaimed;
  }

  recoverInterruptedLeases(reason = 'runtime_restarted'): DagNode[] {
    const recovered: DagNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.status !== 'leased' && node.status !== 'running') continue;
      const updated = this.updateNode(node, {
        status: 'pending',
        lease: undefined,
        failure: { reason, retryable: true },
      });
      this.appendLedger({
        type: 'dag.lease.released',
        run_id: this.ledgerRunId,
        dag_id: this.dagId,
        node_id: updated.id,
        owner: node.lease?.owner,
        reason,
      });
      recovered.push(cloneNode(updated));
    }
    if (recovered.length > 0) this.markNewlyReady();
    return recovered;
  }

  async flushLedger(): Promise<void> {
    await this.ledgerWriteChain;
  }

  flush(): void {
    if (!this.storePath) return;
    mkdirSync(dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(Array.from(this.nodes.values()), null, 2), 'utf8');
    renameSync(tmp, this.storePath);
  }

  private load(): void {
    if (!this.storePath || !existsSync(this.storePath)) return;
    const raw = readFileSync(this.storePath, 'utf8');
    const parsed = JSON.parse(raw) as DagNode[];
    if (!Array.isArray(parsed)) throw new Error('DurableDag: persisted store must be an array');
    for (const node of parsed) {
      this.nodes.set(node.id, node);
    }
    this.markNewlyReady();
  }

  private findActiveByIdempotencyKey(idempotencyKey: string): DagNode | undefined {
    return Array.from(this.nodes.values()).find(
      (node) => node.idempotencyKey === idempotencyKey && !isTerminal(node.status),
    );
  }

  private requireNode(nodeId: string): DagNode {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`DurableDag: unknown node "${nodeId}"`);
    return node;
  }

  private dependenciesSatisfied(node: DagNode): boolean {
    return node.dependsOn.every((depId) => this.nodes.get(depId)?.status === 'succeeded');
  }

  private isLeaseExpired(node: DagNode): boolean {
    return node.lease !== undefined && node.lease.expiresAt <= this.clock();
  }

  private markNewlyReady(): void {
    let changed = false;
    for (const node of this.nodes.values()) {
      if (node.status === 'pending' && this.dependenciesSatisfied(node)) {
        node.status = 'ready';
        node.updatedAt = this.clock();
        this.appendLedger({
          type: 'dag.node.ready',
          run_id: this.ledgerRunId,
          dag_id: this.dagId,
          node_id: node.id,
          kind: node.kind,
          idempotency_key: node.idempotencyKey,
        });
        changed = true;
      }
    }
    if (changed) this.flush();
  }

  private updateNode(node: DagNode, patch: Partial<DagNode>): DagNode {
    const updated: DagNode = {
      ...node,
      ...patch,
      payload: patch.payload ? { ...patch.payload } : node.payload,
      dependsOn: patch.dependsOn ? [...patch.dependsOn] : node.dependsOn,
      provenance: patch.provenance ? [...patch.provenance] : node.provenance,
      updatedAt: this.clock(),
    };
    this.nodes.set(updated.id, updated);
    this.flush();
    return updated;
  }

  private appendLedger(event: LedgerAppendInput): void {
    if (!this.ledger) return;
    const write = this.ledgerWriteChain.then(() => this.ledger!.append(event));
    this.ledgerWriteChain = write.then(
      () => undefined,
      () => undefined,
    );
  }
}
