// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DurableDag } from './durable-dag';
import { EventLedger } from './event-ledger';

function tmpPath(): string {
  const hex = randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `durable-dag-test-${hex}`, 'dag.json');
}

function tmpLedgerPath(): string {
  const hex = randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `durable-dag-ledger-test-${hex}`, 'events.jsonl');
}

describe('DurableDag', () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((filePath) => rm(path.dirname(filePath), { recursive: true, force: true })));
  });

  it('adds nodes and deduplicates active idempotency keys', () => {
    const dag = new DurableDag();
    const first = dag.addNode({ kind: 'worker', idempotencyKey: 'same-key' });
    const second = dag.addNode({ kind: 'worker', idempotencyKey: 'same-key' });

    expect(second.id).toBe(first.id);
    expect(dag.listNodes()).toHaveLength(1);
  });

  it('lists only dependency-satisfied ready nodes', () => {
    const dag = new DurableDag();
    const a = dag.addNode({ id: 'a', kind: 'plan' });
    const b = dag.addNode({ id: 'b', kind: 'build', dependsOn: ['a'] });

    expect(dag.listReady().map((node) => node.id)).toEqual(['a']);

    const leased = dag.leaseNode(a.id, 'worker-1', 1000);
    dag.startNode(leased.id, 'worker-1');
    dag.completeNode(a.id);

    expect(dag.getNode(b.id)?.status).toBe('ready');
    expect(dag.listReady().map((node) => node.id)).toEqual(['b']);
  });

  it('leases, starts and completes nodes with provenance', () => {
    const dag = new DurableDag();
    const node = dag.addNode({ kind: 'implementation' });

    const leased = dag.leaseNode(node.id, 'worker-1', 1000);
    expect(leased.status).toBe('leased');
    expect(leased.lease?.owner).toBe('worker-1');

    const running = dag.startNode(node.id, 'worker-1');
    expect(running.status).toBe('running');
    expect(running.attempts).toBe(1);

    const done = dag.completeNode(node.id, [
      { kind: 'artifact', ref: 'sha256:abc', role: 'output', sha256: 'abc' },
    ]);
    expect(done.status).toBe('succeeded');
    expect(done.lease).toBeUndefined();
    expect(done.provenance).toHaveLength(1);
  });

  it('reclaims expired leases', () => {
    let now = 1000;
    const dag = new DurableDag({ clock: () => now });
    const node = dag.addNode({ kind: 'implementation' });
    dag.leaseNode(node.id, 'worker-1', 50);
    now = 1051;

    const reclaimed = dag.reclaimExpiredLeases();

    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0].status).toBe('pending');
    expect(reclaimed[0].failure).toMatchObject({ reason: 'lease_expired', retryable: true });
  });

  it('recovers interrupted leases on restart without waiting for TTL expiry', async () => {
    const ledgerPath = tmpLedgerPath();
    cleanup.push(ledgerPath);
    const storePath = tmpPath();
    cleanup.push(storePath);
    const ledger = new EventLedger(ledgerPath);
    const dag = new DurableDag({ storePath, ledger, ledgerRunId: 'run-1' });
    const node = dag.addNode({ id: 'node-1', kind: 'implementation' });
    dag.leaseNode(node.id, 'worker-1', 60_000);
    dag.startNode(node.id, 'worker-1');
    await dag.flushLedger();

    const reopened = new DurableDag({ storePath, ledger, ledgerRunId: 'run-1' });
    const recovered = reopened.recoverInterruptedLeases('runtime_restarted');
    await reopened.flushLedger();

    expect(recovered).toEqual([
      expect.objectContaining({
        id: 'node-1',
        status: 'pending',
        lease: undefined,
        failure: { reason: 'runtime_restarted', retryable: true },
      }),
    ]);
    expect(reopened.listReady().map((item) => item.id)).toEqual(['node-1']);
    const events = await ledger.byRun('run-1');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
      type: 'dag.lease.released',
      node_id: 'node-1',
      owner: 'worker-1',
      reason: 'runtime_restarted',
      }),
    ]));
    await ledger.close();
  });

  it('persists and reloads the graph', () => {
    const filePath = tmpPath();
    cleanup.push(filePath);
    const dag = new DurableDag({ storePath: filePath });
    const node = dag.addNode({
      id: 'node-1',
      kind: 'implementation',
      provenance: [{ kind: 'run', ref: 'run-1', role: 'input' }],
    });
    dag.leaseNode(node.id, 'worker-1', 1000);

    const reopened = new DurableDag({ storePath: filePath });

    expect(reopened.getNode('node-1')).toMatchObject({
      id: 'node-1',
      kind: 'implementation',
      status: 'leased',
      provenance: [{ kind: 'run', ref: 'run-1', role: 'input' }],
    });
  });

  it('hydrates persisted node state without emitting ledger events', async () => {
    const ledgerPath = tmpLedgerPath();
    cleanup.push(ledgerPath);
    const ledger = new EventLedger(ledgerPath);
    const dag = new DurableDag({ ledger, ledgerRunId: 'run-1' });

    dag.hydrateNode({
      id: 'a',
      kind: 'workflow.agent',
      status: 'succeeded',
      attempts: 2,
      provenance: [{ kind: 'run', ref: 'heartbeat-1', role: 'evidence' }],
    });
    dag.hydrateNode({
      id: 'b',
      kind: 'workflow.agent',
      status: 'pending',
      dependsOn: ['a'],
    });
    await dag.flushLedger();

    expect(await ledger.readAll()).toEqual([]);
    expect(dag.getNode('a')).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(dag.listReady().map((node) => node.id)).toEqual(['b']);
    await ledger.close();
  });

  it('does not deduplicate terminal nodes with the same idempotency key', () => {
    const dag = new DurableDag();
    const first = dag.addNode({ kind: 'implementation', idempotencyKey: 'same-key' });
    dag.leaseNode(first.id, 'worker-1', 1000);
    dag.completeNode(first.id);

    const second = dag.addNode({ kind: 'implementation', idempotencyKey: 'same-key' });

    expect(second.id).not.toBe(first.id);
    expect(dag.listNodes()).toHaveLength(2);
  });

  it('appends DAG lifecycle events to EventLedger when configured', async () => {
    const ledgerPath = tmpLedgerPath();
    cleanup.push(ledgerPath);
    const ledger = new EventLedger(ledgerPath);
    const dag = new DurableDag({
      ledger,
      ledgerRunId: 'run-1',
      dagId: 'dag-1',
    });

    const node = dag.addNode({ id: 'node-1', kind: 'implementation', idempotencyKey: 'node-key' });
    dag.leaseNode(node.id, 'worker-1', 1000);
    dag.startNode(node.id, 'worker-1');
    dag.completeNode(node.id, [
      { kind: 'artifact', ref: 'sha256:abc', role: 'output', sha256: 'abc' },
    ]);
    await dag.flushLedger();

    const events = await ledger.byRun('run-1');
    expect(events.map((event) => event.type)).toEqual([
      'dag.created',
      'dag.node.ready',
      'dag.lease.acquired',
      'dag.node.started',
      'dag.node.completed',
      'dag.lease.released',
    ]);
    expect(events[1]).toMatchObject({
      type: 'dag.node.ready',
      dag_id: 'dag-1',
      node_id: 'node-1',
      idempotency_key: 'node-key',
    });
    expect(events[4]).toMatchObject({
      type: 'dag.node.completed',
      artifact_refs: ['sha256:abc'],
    });
    await ledger.close();
  });

  it('appends lease release when expired leases are reclaimed', async () => {
    const ledgerPath = tmpLedgerPath();
    cleanup.push(ledgerPath);
    const ledger = new EventLedger(ledgerPath);
    let now = 1000;
    const dag = new DurableDag({
      ledger,
      ledgerRunId: 'run-1',
      clock: () => now,
    });
    const node = dag.addNode({ id: 'node-1', kind: 'implementation' });
    dag.leaseNode(node.id, 'worker-1', 50);
    now = 1051;
    dag.reclaimExpiredLeases();
    await dag.flushLedger();

    const events = await ledger.byRun('run-1');
    expect(events.some((event) => event.type === 'dag.lease.released')).toBe(true);
    const released = events.find((event) => event.type === 'dag.lease.released');
    expect(released).toMatchObject({ node_id: 'node-1', owner: 'worker-1', reason: 'lease_expired' });
    await ledger.close();
  });
});
