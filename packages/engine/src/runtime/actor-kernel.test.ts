// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from './artifact-model';
import { createActorKernel } from './actor-kernel';
import { DurableDag } from './durable-dag';
import { EventLedger } from './event-ledger';
import { RunLedger } from './run-ledger';

const roots: string[] = [];
const ledgers: EventLedger[] = [];

async function createHarness(now: () => Date = () => new Date('2026-05-01T00:00:00.000Z')) {
  const root = await mkdtemp(path.join(tmpdir(), 'pyrfor-actor-kernel-'));
  roots.push(root);
  const eventLedger = new EventLedger(path.join(root, 'events.jsonl'));
  ledgers.push(eventLedger);
  const runLedger = new RunLedger({ ledger: eventLedger });
  const dag = new DurableDag({
    storePath: path.join(root, 'dag.json'),
    ledger: eventLedger,
    dagId: 'actor-test-dag',
    ledgerRunId: 'runtime-orchestration',
  });
  const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
  await runLedger.createRun({
    run_id: 'run-1',
    workspace_id: 'workspace-1',
    repo_id: 'repo-1',
    branch_or_worktree_id: 'main',
    mode: 'autonomous',
    task_id: 'parent-task',
    goal: 'Coordinate actors',
    model_profile: 'gpt-5.4',
    provider_route: 'openrouter',
    permission_profile: { profile: 'standard' },
    budget_profile: { maxTokens: 10_000, maxToolCalls: 25 },
  });
  await runLedger.transition('run-1', 'planned', 'test setup');
  await runLedger.transition('run-1', 'running', 'test setup');
  const kernel = createActorKernel({
    runLedger,
    eventLedger,
    dag,
    artifactStore,
    now,
    idFactory: () => 'fixed',
  });
  return { eventLedger, runLedger, dag, artifactStore, kernel };
}

describe('ActorKernel', () => {
  afterEach(async () => {
    await Promise.all(ledgers.splice(0).map((ledger) => ledger.close()));
    await Promise.all(roots.splice(0).map((root) => rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 10,
    })));
  });

  it('spawns an actor child run and records mailbox work with durable proof', async () => {
    const { eventLedger, runLedger, dag, artifactStore, kernel } = await createHarness();

    const actor = await kernel.spawnActor({
      runId: 'run-1',
      actorId: 'actor-planner',
      agentId: 'planner',
      agentName: 'Planner',
      role: 'planner',
      goal: 'Plan implementation',
    });
    expect(actor.childRun.run_id).toBe('run-1:actor:actor-planner');
    expect(actor.childRun.parent_run_id).toBe('run-1');
    expect(actor.childRun.budget_profile).toMatchObject({ maxTokens: 10_000 });
    const duplicateActor = await kernel.spawnActor({
      runId: 'run-1',
      actorId: 'actor-planner',
      agentId: 'planner',
    });
    expect(duplicateActor.childRun.run_id).toBe(actor.childRun.run_id);

    const message = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-planner',
      task: 'Draft actor plan',
      payload: { phase: 'J' },
      idempotencyKey: 'run-1:actor-planner:draft-plan',
    });
    expect(message.kind).toBe('actor.mailbox.task');
    expect(message.payload).toMatchObject({ runId: 'run-1', actorId: 'actor-planner', task: 'Draft actor plan' });

    const duplicate = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-planner',
      task: 'Draft actor plan',
      idempotencyKey: 'run-1:actor-planner:draft-plan',
    });
    expect(duplicate.id).toBe(message.id);

    const leased = await kernel.leaseNextMessage({ runId: 'run-1', actorId: 'actor-planner', owner: 'worker-1' });
    expect(leased?.node.status).toBe('running');
    expect(leased?.node.lease?.owner).toBe('worker-1');

    const completed = await kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      summary: 'Actor plan drafted',
      output: 'Use durable mailbox primitives',
      proof: { checks: ['unit'] },
    });
    expect(completed.node.status).toBe('succeeded');
    expect(completed.proofArtifact.kind).toBe('summary');
    expect(dag.getNode(message.id)?.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'artifact', ref: completed.proofArtifact.id, role: 'evidence' }),
    ]));
    expect(runLedger.getRun('run-1')?.artifact_refs).toContain(completed.proofArtifact.id);
    const proof = await artifactStore.readJSON<Record<string, unknown>>(completed.proofArtifact);
    expect(proof).toMatchObject({
      schemaVersion: 'pyrfor.actor_work_proof.v1',
      runId: 'run-1',
      actorId: 'actor-planner',
      output: 'Use durable mailbox primitives',
    });
    const events = await eventLedger.byRun('run-1');
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'actor.spawned',
      'actor.mailbox.enqueued',
      'actor.mailbox.leased',
      'actor.work.started',
      'actor.mailbox.completed',
      'actor.work.completed',
      'artifact.created',
    ]));
  });

  it('records actor proof artifacts on the child run after the parent run is completed', async () => {
    const { runLedger, artifactStore, kernel } = await createHarness();

    await kernel.spawnActor({
      runId: 'run-1',
      actorId: 'actor-planner',
      agentId: 'planner',
    });
    const message = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-planner',
      task: 'Review completed delivery',
    });
    await kernel.leaseNextMessage({ runId: 'run-1', actorId: 'actor-planner', owner: 'worker-1' });
    await runLedger.completeRun('run-1', 'completed', 'parent finished');

    const completed = await kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      summary: 'Actor reviewed completed delivery',
    });

    expect(runLedger.getRun('run-1')?.artifact_refs).not.toContain(completed.proofArtifact.id);
    expect(runLedger.getRun('run-1:actor:actor-planner')?.artifact_refs).toContain(completed.proofArtifact.id);
    await expect(artifactStore.list({ runId: 'run-1:actor:actor-planner', kind: 'summary' })).resolves.toEqual([
      expect.objectContaining({ id: completed.proofArtifact.id }),
    ]);
    await expect(artifactStore.readJSON<Record<string, unknown>>(completed.proofArtifact)).resolves.toMatchObject({
      runId: 'run-1',
      proofRunId: 'run-1:actor:actor-planner',
      actorId: 'actor-planner',
    });
  });

  it('fails and retries actor mailbox messages without losing the DAG node', async () => {
    const { eventLedger, dag, kernel } = await createHarness();
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-reviewer', agentId: 'reviewer' });
    const message = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-reviewer',
      task: 'Review implementation',
    });
    await kernel.leaseNextMessage({ runId: 'run-1', owner: 'worker-1' });

    const failed = await kernel.failMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      reason: 'transient provider failure',
      retryable: true,
    });

    expect(failed.status).toBe('pending');
    expect(failed.failure).toMatchObject({ reason: 'transient provider failure', retryable: true });
    expect(dag.listReady().map((node) => node.id)).toContain(message.id);
    const events = await eventLedger.byRun('run-1');
    expect(events.map((event) => event.type)).toContain('actor.mailbox.failed');
    expect(events.map((event) => event.type)).not.toContain('actor.failed');
  });

  it('recovers only stale leased actor mailbox messages', async () => {
    const { eventLedger, dag, kernel } = await createHarness(() => new Date('2026-05-01T00:10:00.000Z'));
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-stale', agentId: 'stale' });
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-fresh', agentId: 'fresh' });
    const staleMessage = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-stale',
      task: 'Recover stale work',
    });
    const freshMessage = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-fresh',
      task: 'Keep fresh work leased',
    });
    const staleLease = await kernel.leaseNextMessage({ runId: 'run-1', actorId: 'actor-stale', owner: 'worker-stale' });
    const freshLease = await kernel.leaseNextMessage({ runId: 'run-1', actorId: 'actor-fresh', owner: 'worker-fresh' });
    const staleAt = Date.parse('2026-05-01T00:00:00.000Z');
    const freshAt = Date.parse('2026-05-01T00:09:45.000Z');
    dag.hydrateNode({
      ...staleLease!.node,
      status: 'running',
      updatedAt: staleAt,
      lease: { owner: 'worker-stale', leasedAt: staleAt, expiresAt: staleAt + 300_000 },
    });
    dag.hydrateNode({
      ...freshLease!.node,
      status: 'running',
      updatedAt: freshAt,
      lease: { owner: 'worker-fresh', leasedAt: freshAt, expiresAt: freshAt + 300_000 },
    });

    const recovered = await kernel.recoverStuckMessages({
      runId: 'run-1',
      olderThanMs: 5 * 60_000,
      reason: 'supervisor_stuck_actor',
    });

    expect(recovered.recovered.map((node) => node.id)).toEqual([staleMessage.id]);
    expect(dag.getNode(staleMessage.id)).toMatchObject({
      status: 'pending',
      failure: { reason: 'supervisor_stuck_actor', retryable: true },
    });
    expect(dag.getNode(freshMessage.id)).toMatchObject({
      status: 'running',
      lease: { owner: 'worker-fresh' },
    });
    const events = await eventLedger.byRun('run-1');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'actor.mailbox.failed',
        actor_id: 'actor-stale',
        node_id: staleMessage.id,
        retryable: true,
        recovered: true,
        previous_owner: 'worker-stale',
      }),
    ]));
  });

  it('leases one mailbox task per actor by default unless a task explicitly allows concurrency', async () => {
    const { kernel } = await createHarness();
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-writer', agentId: 'writer' });
    const first = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-writer',
      task: 'Write first section',
    });
    await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-writer',
      task: 'Write second section',
    });
    const concurrent = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-writer',
      task: 'Parallel note',
      allowConcurrent: true,
    });

    const leasedFirst = await kernel.leaseNextMessage({ runId: 'run-1', actorId: 'actor-writer', owner: 'worker-1' });
    expect(leasedFirst?.node.id).toBe(first.id);
    const leasedConcurrent = await kernel.leaseNextMessage({ runId: 'run-1', actorId: 'actor-writer', owner: 'worker-2' });
    expect(leasedConcurrent?.node.id).toBe(concurrent.id);
    await expect(kernel.leaseNextMessage({ runId: 'run-1', actorId: 'actor-writer', owner: 'worker-3' })).resolves.toBeNull();
  });

  it('skips busy actors when leasing without an actor filter', async () => {
    const { kernel } = await createHarness();
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-a', agentId: 'a' });
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-b', agentId: 'b' });
    const firstA = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-a',
      task: 'A first',
      priority: 200,
    });
    await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-a',
      task: 'A high-priority second',
      priority: 100,
    });
    const firstB = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-b',
      task: 'B first',
    });

    const leasedA = await kernel.leaseNextMessage({ runId: 'run-1', actorId: 'actor-a', owner: 'worker-a' });
    expect(leasedA?.node.id).toBe(firstA.id);
    const leasedB = await kernel.leaseNextMessage({ runId: 'run-1', owner: 'worker-b' });
    expect(leasedB?.node.id).toBe(firstB.id);
  });

  it('keeps same-task mailbox messages distinct unless an idempotency key is supplied', async () => {
    const { dag, kernel } = await createHarness();
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-reviewer', agentId: 'reviewer' });

    const first = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-reviewer',
      task: 'Review implementation',
      payload: { attempt: 1 },
    });
    const second = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-reviewer',
      task: 'Review implementation',
      payload: { attempt: 2 },
    });

    expect(second.id).not.toBe(first.id);
    expect(dag.listReady().filter((node) => node.kind === 'actor.mailbox.task')).toHaveLength(2);
  });

  it('namespaces child actor runs by parent run', async () => {
    const { runLedger, kernel } = await createHarness();
    await runLedger.createRun({
      run_id: 'run-2',
      workspace_id: 'workspace-1',
      repo_id: 'repo-1',
      branch_or_worktree_id: 'main',
      mode: 'autonomous',
      task_id: 'second-parent',
      goal: 'Coordinate another actor tree',
    });

    const first = await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-planner', agentId: 'planner' });
    const second = await kernel.spawnActor({ runId: 'run-2', actorId: 'actor-planner', agentId: 'planner' });

    expect(first.childRun.run_id).toBe('run-1:actor:actor-planner');
    expect(second.childRun.run_id).toBe('run-2:actor:actor-planner');
    expect(first.childRun.run_id).not.toBe(second.childRun.run_id);
  });

  it('rejects completion by a worker that does not hold the lease', async () => {
    const { kernel } = await createHarness();
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-writer', agentId: 'writer' });
    const message = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-writer',
      task: 'Write patch',
    });
    await kernel.leaseNextMessage({ runId: 'run-1', owner: 'worker-1' });

    await expect(kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-2',
      output: 'not allowed',
    })).rejects.toThrow('leased by another owner');
  });

  it('keeps DAG completion authoritative when a competing failure races proof write', async () => {
    const { eventLedger, runLedger, dag, artifactStore } = await createHarness();
    let nodeId = '';
    const kernel = createActorKernel({
      runLedger,
      eventLedger,
      dag,
      artifactStore: {
        writeJSON: async (...args) => {
          expect(() => dag.failNode(nodeId, 'late failure', false)).toThrow('terminal status succeeded');
          return artifactStore.writeJSON(...args);
        },
        list: (...args) => artifactStore.list(...args),
      },
    });
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-writer', agentId: 'writer' });
    const message = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-writer',
      task: 'Write patch',
    });
    nodeId = message.id;
    await kernel.leaseNextMessage({ runId: 'run-1', owner: 'worker-1' });

    const completed = await kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      output: 'patch complete',
    });

    expect(completed.node.status).toBe('succeeded');
    expect(dag.getNode(message.id)?.status).toBe('succeeded');
  });

  it('can finalize proof bookkeeping after a post-DAG proof write failure', async () => {
    const { eventLedger, runLedger, dag, artifactStore } = await createHarness();
    let shouldFailProofWrite = true;
    const kernel = createActorKernel({
      runLedger,
      eventLedger,
      dag,
      artifactStore: {
        writeJSON: async (...args) => {
          if (shouldFailProofWrite) {
            shouldFailProofWrite = false;
            throw new Error('proof store unavailable');
          }
          return artifactStore.writeJSON(...args);
        },
        list: (...args) => artifactStore.list(...args),
      },
    });
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-writer', agentId: 'writer' });
    const message = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-writer',
      task: 'Write patch',
    });
    await kernel.leaseNextMessage({ runId: 'run-1', owner: 'worker-1' });

    await expect(kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      output: 'first attempt',
    })).rejects.toThrow('proof store unavailable');
    expect(dag.getNode(message.id)?.status).toBe('succeeded');
    expect(dag.getNode(message.id)?.provenance.some((link) => link.meta?.['artifactKind'] === 'actor_work_proof')).toBe(false);

    const completed = await kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      output: 'retry attempt',
    });

    expect(completed.node.status).toBe('succeeded');
    expect(completed.node.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'artifact', ref: completed.proofArtifact.id }),
    ]));
  });

  it('keeps proofless completion retry bound to the original owner', async () => {
    const { eventLedger, runLedger, dag, artifactStore } = await createHarness();
    let shouldFailProofWrite = true;
    const kernel = createActorKernel({
      runLedger,
      eventLedger,
      dag,
      artifactStore: {
        writeJSON: async (...args) => {
          if (shouldFailProofWrite) {
            shouldFailProofWrite = false;
            throw new Error('proof store unavailable');
          }
          return artifactStore.writeJSON(...args);
        },
        list: (...args) => artifactStore.list(...args),
      },
    });
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-writer', agentId: 'writer' });
    const message = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-writer',
      task: 'Write patch',
    });
    await kernel.leaseNextMessage({ runId: 'run-1', owner: 'worker-1' });

    await expect(kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      output: 'first attempt',
    })).rejects.toThrow('proof store unavailable');
    await expect(kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-2',
      output: 'forged retry',
    })).rejects.toThrow('completed by another owner');
  });

  it('reuses an already written proof artifact when provenance finalization is retried', async () => {
    const { dag, artifactStore, kernel } = await createHarness();
    const originalAddProvenance = dag.addProvenance.bind(dag);
    let shouldFailProvenance = true;
    dag.addProvenance = ((...args) => {
      if (shouldFailProvenance) {
        shouldFailProvenance = false;
        throw new Error('dag provenance unavailable');
      }
      return originalAddProvenance(...args);
    }) as typeof dag.addProvenance;
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-writer', agentId: 'writer' });
    const message = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-writer',
      task: 'Write patch',
    });
    await kernel.leaseNextMessage({ runId: 'run-1', owner: 'worker-1' });

    await expect(kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      output: 'first attempt',
    })).rejects.toThrow('dag provenance unavailable');
    expect(await artifactStore.list({ runId: 'run-1', kind: 'summary' })).toHaveLength(1);

    const completed = await kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      output: 'retry attempt',
    });

    expect(await artifactStore.list({ runId: 'run-1', kind: 'summary' })).toHaveLength(1);
    expect(completed.node.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'artifact', ref: completed.proofArtifact.id }),
    ]));
  });

  it('serializes concurrent proofless completion retries for a mailbox node', async () => {
    const { eventLedger, runLedger, dag, artifactStore } = await createHarness();
    let shouldFailInitialProofWrite = true;
    let retryProofWrites = 0;
    const kernel = createActorKernel({
      runLedger,
      eventLedger,
      dag,
      artifactStore: {
        writeJSON: async (...args) => {
          if (shouldFailInitialProofWrite) {
            shouldFailInitialProofWrite = false;
            throw new Error('proof store unavailable');
          }
          retryProofWrites += 1;
          if (retryProofWrites === 1) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return artifactStore.writeJSON(...args);
        },
        list: (...args) => artifactStore.list(...args),
      },
    });
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-writer', agentId: 'writer' });
    const message = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-writer',
      task: 'Write patch',
    });
    await kernel.leaseNextMessage({ runId: 'run-1', owner: 'worker-1' });
    await expect(kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      output: 'first attempt',
    })).rejects.toThrow('proof store unavailable');

    const [firstRetry, secondRetry] = await Promise.all([
      kernel.completeMessage({
        runId: 'run-1',
        nodeId: message.id,
        owner: 'worker-1',
        output: 'retry one',
      }),
      kernel.completeMessage({
        runId: 'run-1',
        nodeId: message.id,
        owner: 'worker-1',
        output: 'retry two',
      }),
    ]);

    expect(firstRetry.proofArtifact.id).toBe(secondRetry.proofArtifact.id);
    expect(retryProofWrites).toBe(1);
    expect(await artifactStore.list({ runId: 'run-1', kind: 'summary' })).toHaveLength(1);
    expect(dag.getNode(message.id)?.provenance.filter((link) => link.meta?.['artifactKind'] === 'actor_work_proof')).toHaveLength(1);
  });

  it('returns existing proof when an already finalized mailbox completion is retried', async () => {
    const { artifactStore, kernel } = await createHarness();
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-writer', agentId: 'writer' });
    const message = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-writer',
      task: 'Write patch',
    });
    await kernel.leaseNextMessage({ runId: 'run-1', owner: 'worker-1' });
    const first = await kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      output: 'patch complete',
    });
    const second = await kernel.completeMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      output: 'duplicate retry',
    });

    expect(second.alreadyFinalized).toBe(true);
    expect(second.proofArtifact.id).toBe(first.proofArtifact.id);
    await expect(artifactStore.readJSON<Record<string, unknown>>(second.proofArtifact)).resolves.toMatchObject({
      nodeId: message.id,
      output: 'patch complete',
    });
    const proofArtifacts = await artifactStore.list({ runId: 'run-1', kind: 'summary' });
    expect(proofArtifacts).toHaveLength(1);
  });

  it('rejects failure by a worker that does not hold a lease', async () => {
    const { kernel } = await createHarness();
    await kernel.spawnActor({ runId: 'run-1', actorId: 'actor-reviewer', agentId: 'reviewer' });
    const message = await kernel.enqueueMessage({
      runId: 'run-1',
      actorId: 'actor-reviewer',
      task: 'Review unleased work',
    });

    await expect(kernel.failMessage({
      runId: 'run-1',
      nodeId: message.id,
      owner: 'worker-1',
      reason: 'not allowed',
    })).rejects.toThrow('not leased');
  });
});
