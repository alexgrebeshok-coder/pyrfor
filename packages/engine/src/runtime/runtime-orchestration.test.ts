// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeConfigSchema, type RuntimeConfig } from './config';
import { EventLedger } from './event-ledger';
import { DurableDag } from './durable-dag';
import { ArtifactStore } from './artifact-model';
import { PyrforRuntime } from './index';
import { RunLedger } from './run-ledger';
import type { StepValidator, ValidatorResult } from './step-validator';
import { WORKER_PROTOCOL_VERSION } from './worker-protocol';
import { approvalFlow } from './approval-flow';
import type { GitHubDeliveryPlan } from './github-delivery-plan';

process.env['LOG_LEVEL'] = 'silent';

interface RuntimeInternals {
  gateway: { port: number } | null;
}

const TEST_TOKEN = 'test-secret';

function makeConfig(rootDir: string): RuntimeConfig {
  const base = RuntimeConfigSchema.parse({});
  return {
    ...base,
    gateway: {
      ...base.gateway,
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      bearerToken: TEST_TOKEN,
    },
    cron: { enabled: false, timezone: 'UTC', jobs: [] },
    health: { enabled: false, intervalMs: 60_000 },
    persistence: {
      enabled: true,
      rootDir,
      debounceMs: 100,
      prisma: { enabled: false },
    },
  };
}

async function get(port: number, pathname: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function post(port: number, pathname: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TEST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function validator(name: string, result: ValidatorResult): StepValidator {
  return {
    name,
    appliesTo: () => true,
    validate: async () => result,
  };
}

describe('PyrforRuntime orchestration wiring', () => {
  let runtime: PyrforRuntime | null = null;
  const tempRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    approvalFlow.resetForTests();
    if (runtime) {
      await runtime.stop();
      runtime = null;
    }
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function startRuntime(rootDir: string): Promise<number> {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-workspace-'));
    tempRoots.push(workspacePath);
    runtime = new PyrforRuntime({
      workspacePath,
      config: makeConfig(rootDir),
      persistence: { rootDir: path.join(rootDir, 'sessions'), debounceMs: 100 },
    });
    vi.spyOn(runtime.providers, 'chat').mockResolvedValue('mock reply');
    await runtime.start();
    return (runtime as unknown as RuntimeInternals).gateway?.port ?? 0;
  }

  it('exposes default orchestration objects through the gateway', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    expect(port).toBeGreaterThan(0);

    const dashboard = await get(port, '/api/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toMatchObject({
      orchestration: {
        overlays: {
          total: 2,
          domainIds: ['ceoclaw', 'ochag'],
        },
      },
    });

    const overlays = await get(port, '/api/overlays');
    expect(overlays.status).toBe(200);
    expect(overlays.body).toMatchObject({
      overlays: [
        expect.objectContaining({ domainId: 'ceoclaw' }),
        expect.objectContaining({ domainId: 'ochag' }),
      ],
    });
  });

  it('creates product factory planned runs with plan artifact and seeded DAG preview', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const created = await post(port, '/api/runs', {
      productFactory: {
        templateId: 'feature',
        prompt: 'Add delivery artifacts to the operator console',
        answers: {
          acceptance: 'Run details show summary and tests.',
          surface: 'Orchestration panel and gateway API.',
        },
      },
    });

    expect(created.status).toBe(201);
    const runId = (created.body as { run: { run_id: string; status: string; mode: string; artifact_refs: string[] } }).run.run_id;
    expect(created.body).toMatchObject({
      run: expect.objectContaining({
        task_id: expect.stringMatching(/^pf-/),
        mode: 'pm',
        status: 'planned',
        artifact_refs: [expect.any(String)],
      }),
      preview: expect.objectContaining({
        missingClarifications: [],
        dagPreview: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({ kind: 'product_factory.scoped_plan' }),
            expect.objectContaining({ kind: 'product_factory.delivery_package' }),
          ]),
        }),
      }),
      artifact: expect.objectContaining({ kind: 'plan' }),
    });

    const events = await get(port, `/api/runs/${runId}/events`);
    expect((events.body as { events: Array<{ type: string }> }).events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['run.created', 'run.transitioned', 'artifact.created']),
    );
    const dag = await get(port, `/api/runs/${runId}/dag`);
    const nodes = (dag.body as { nodes: Array<{ kind: string; provenance: Array<{ kind: string }> }> }).nodes;
    expect(nodes.map((node) => node.kind)).toEqual(expect.arrayContaining([
      'product_factory.scoped_plan',
      'product_factory.delivery_package',
    ]));
    expect(nodes[0].provenance.map((link) => link.kind)).toEqual(expect.arrayContaining(['run', 'artifact']));
  });

  it('blocks interrupted running runs and reclaims DAG leases on restart', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-recovery-'));
    tempRoots.push(rootDir);
    const orchestrationDir = path.join(rootDir, 'orchestration');
    const eventLedger = new EventLedger(path.join(orchestrationDir, 'events.jsonl'));
    const runLedger = new RunLedger({ ledger: eventLedger });
    const run = await runLedger.createRun({
      workspace_id: 'ws-1',
      repo_id: 'repo-1',
      mode: 'autonomous',
      task_id: 'crash-prone-run',
    });
    await runLedger.transition(run.run_id, 'planned');
    await runLedger.transition(run.run_id, 'running');
    const dag = new DurableDag({
      storePath: path.join(orchestrationDir, 'dag.json'),
      ledger: eventLedger,
      ledgerRunId: 'runtime-orchestration',
      dagId: 'runtime-orchestration',
    });
    const node = dag.addNode({
      id: 'node-restart',
      kind: 'worker',
      payload: { runId: run.run_id },
      provenance: [{ kind: 'run', ref: run.run_id, role: 'input' }],
    });
    dag.leaseNode(node.id, 'worker-before-crash', 60_000);
    dag.startNode(node.id, 'worker-before-crash');
    await dag.flushLedger();
    await eventLedger.close();
    await writeFile(path.join(rootDir, 'sessions-placeholder'), 'seed', 'utf8');

    const port = await startRuntime(rootDir);

    const runResponse = await get(port, `/api/runs/${run.run_id}`);
    expect(runResponse.status).toBe(200);
    expect(runResponse.body).toMatchObject({
      run: expect.objectContaining({ status: 'blocked' }),
    });
    const dagResponse = await get(port, `/api/runs/${run.run_id}/dag`);
    expect(dagResponse.status).toBe(200);
    expect((dagResponse.body as { nodes: Array<{ id: string; status: string; failure?: { reason?: string } }> }).nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'node-restart',
          status: 'ready',
          failure: expect.objectContaining({ reason: 'runtime_restarted' }),
        }),
      ]),
    );
    const events = await get(port, `/api/runs/${run.run_id}/events`);
    expect((events.body as { events: Array<{ type: string; reason?: string }> }).events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'run.blocked', reason: 'runtime_restarted' }),
      ]),
    );
  });

  it('executes product factory planned runs through governed worker, verifier and delivery DAG nodes', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const created = await post(port, '/api/runs', {
      productFactory: {
        templateId: 'feature',
        prompt: 'Add delivery artifacts to the operator console',
        answers: {
          acceptance: 'Run details show summary and tests.',
          surface: 'Orchestration panel and gateway API.',
        },
      },
    });
    const runId = (created.body as { run: { run_id: string } }).run.run_id;

    const executed = await post(port, `/api/runs/${runId}/control`, { action: 'execute' });
    expect(executed.status).toBe(200);
    expect(executed.body).toMatchObject({
      ok: true,
      action: 'execute',
      run: expect.objectContaining({ status: 'completed' }),
      deliveryArtifact: expect.objectContaining({ kind: 'summary' }),
      deliveryEvidenceArtifact: expect.objectContaining({ kind: 'delivery_evidence' }),
      deliveryEvidence: expect.objectContaining({ schemaVersion: 'pyrfor.delivery_evidence.v1' }),
      summary: expect.stringContaining('Product Factory executed'),
    });

    const events = await get(port, `/api/runs/${runId}/events`);
    const eventTypes = ((events.body as { events: Array<{ type: string }> }).events).map((event) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      'verifier.completed',
      'run.completed',
      'artifact.created',
    ]));
    expect(eventTypes.indexOf('run.completed')).toBeGreaterThan(eventTypes.indexOf('verifier.completed'));
    expect(eventTypes.lastIndexOf('artifact.created')).toBeLessThan(eventTypes.indexOf('run.completed'));

    const evidence = await get(port, `/api/runs/${runId}/delivery-evidence`);
    expect(evidence.body).toMatchObject({
      artifact: expect.objectContaining({ kind: 'delivery_evidence' }),
      snapshot: expect.objectContaining({
        schemaVersion: 'pyrfor.delivery_evidence.v1',
        runId,
        verifierStatus: 'passed',
      }),
    });

    const deliveryPlan = await post(port, `/api/runs/${runId}/github-delivery-plan`, { issueNumber: 42 });
    expect(deliveryPlan.status).toBe(201);
    expect(deliveryPlan.body).toMatchObject({
      artifact: expect.objectContaining({ kind: 'delivery_plan' }),
      plan: expect.objectContaining({
        schemaVersion: 'pyrfor.github_delivery_plan.v1',
        mode: 'dry_run',
        applySupported: false,
        issue: expect.objectContaining({ number: 42 }),
      }),
    });
    const latestDeliveryPlan = await get(port, `/api/runs/${runId}/github-delivery-plan`);
    expect(latestDeliveryPlan.body).toMatchObject({
      artifact: expect.objectContaining({ kind: 'delivery_plan' }),
      plan: expect.objectContaining({ runId }),
    });

    const dag = await get(port, `/api/runs/${runId}/dag`);
    const nodes = (dag.body as { nodes: Array<{ kind: string; status: string; provenance: Array<{ kind: string }> }> }).nodes;
    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'product_factory.worker_execution', status: 'succeeded' }),
      expect.objectContaining({ kind: 'product_factory.verify', status: 'succeeded' }),
      expect.objectContaining({ kind: 'product_factory.delivery_package', status: 'succeeded' }),
      expect.objectContaining({ kind: 'product_factory.github_delivery_evidence', status: 'succeeded' }),
      expect.objectContaining({ kind: 'product_factory.github_delivery_plan', status: 'succeeded' }),
      expect.objectContaining({ kind: 'governed.verifier', status: 'succeeded' }),
    ]));
    expect(nodes.find((node) => node.kind === 'product_factory.delivery_package')?.provenance)
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'artifact' })]));
  });

  it('blocks product factory execution without completing delivery when verifier rejects it', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const created = await post(port, '/api/runs', {
      productFactory: {
        templateId: 'feature',
        prompt: 'Add delivery artifacts to the operator console',
        answers: {
          acceptance: 'Run details show summary and tests.',
          surface: 'Orchestration panel and gateway API.',
        },
      },
    });
    const runId = (created.body as { run: { run_id: string } }).run.run_id;

    await expect(runtime!.executeProductFactoryRun(runId, {
      worker: {
        transport: 'acp',
        verifierValidators: [
          validator('policy', {
            validator: 'policy',
            verdict: 'block',
            message: 'delivery policy violation',
            durationMs: 1,
          }),
        ],
      },
    })).rejects.toThrow(/verifier blocked execution/);

    const run = await get(port, `/api/runs/${runId}`);
    expect(run.body).toMatchObject({
      run: expect.objectContaining({ status: 'blocked' }),
    });

    const dag = await get(port, `/api/runs/${runId}/dag`);
    const nodes = (dag.body as { nodes: Array<{ kind: string; status: string }> }).nodes;
    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'product_factory.worker_execution', status: 'succeeded' }),
      expect.objectContaining({ kind: 'governed.verifier', status: 'succeeded' }),
    ]));
    expect(nodes.find((node) => node.kind === 'product_factory.delivery_package')?.status).not.toBe('succeeded');
    expect(nodes.find((node) => node.kind === 'product_factory.github_delivery_evidence')).toBeUndefined();
    const forgedEvidence = await post(port, `/api/runs/${runId}/delivery-evidence`, { verifierStatus: 'passed' });
    expect(forgedEvidence.status).toBe(409);
    const forgedPlan = await post(port, `/api/runs/${runId}/github-delivery-plan`, { issueNumber: 42 });
    expect(forgedPlan.status).toBe(409);
    const evidence = await get(port, `/api/runs/${runId}/delivery-evidence`);
    expect(evidence.body).toEqual({ artifact: null, snapshot: null });

    const waiver = await post(port, `/api/runs/${runId}/verifier-waiver`, {
      operatorId: 'operator-1',
      reason: 'Accepting blocked verifier for manual follow-up',
      scope: 'all',
    });
    expect(waiver.status).toBe(201);
    expect(waiver.body).toMatchObject({
      artifact: expect.objectContaining({ kind: 'verifier_waiver' }),
      waiver: expect.objectContaining({
        schemaVersion: 'pyrfor.verifier_waiver.v1',
        rawStatus: 'blocked',
        operator: { id: 'token:legacy', name: 'legacy' },
      }),
      decision: expect.objectContaining({ status: 'waived', rawStatus: 'blocked' }),
      run: expect.objectContaining({ status: 'blocked' }),
    });

    const waivedEvidence = await post(port, `/api/runs/${runId}/delivery-evidence`, {});
    expect(waivedEvidence.status).toBe(201);
    expect(waivedEvidence.body).toMatchObject({
      artifact: expect.objectContaining({ kind: 'delivery_evidence' }),
      snapshot: expect.objectContaining({
        verifierStatus: 'waived',
        verifier: expect.objectContaining({ rawStatus: 'blocked', waivedFrom: 'blocked' }),
      }),
    });
    const evidenceArtifactId = (waivedEvidence.body as { artifact: { id: string } }).artifact.id;
    const waiverArtifactId = (waiver.body as { artifact: { id: string } }).artifact.id;
    const runAfterEvidence = await get(port, `/api/runs/${runId}`);
    expect(runAfterEvidence.body).toMatchObject({
      run: expect.objectContaining({
        status: 'blocked',
        artifact_refs: expect.arrayContaining([evidenceArtifactId]),
      }),
    });
    const dagAfterEvidence = await get(port, `/api/runs/${runId}/dag`);
    const lineageNodes = (dagAfterEvidence.body as { nodes: Array<{ id: string; kind: string; status: string; dependsOn: string[]; provenance?: Array<{ kind: string; ref: string }> }> }).nodes;
    const verifierNode = lineageNodes.find((node) => node.kind === 'governed.verifier');
    const waiverNode = lineageNodes.find((node) => node.kind === 'governed.verifier_waiver');
    expect(lineageNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'product_factory.github_delivery_evidence', status: 'succeeded' }),
    ]));
    expect(waiverNode).toMatchObject({
      status: 'succeeded',
      dependsOn: verifierNode ? expect.arrayContaining([verifierNode.id]) : expect.any(Array),
      provenance: expect.arrayContaining([
        expect.objectContaining({ kind: 'artifact', ref: waiverArtifactId }),
      ]),
    });
    expect(waiverNode?.provenance ?? []).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'artifact' }),
      expect.objectContaining({ kind: 'ledger_event' }),
    ]));

    const waivedPlan = await post(port, `/api/runs/${runId}/github-delivery-plan`, { issueNumber: 42 });
    expect(waivedPlan.status).toBe(201);
    expect(waivedPlan.body).toMatchObject({
      plan: expect.objectContaining({
        applySupported: false,
        blockers: expect.arrayContaining([
          expect.stringContaining('apply requires completed'),
        ]),
      }),
    });
    const planArtifactId = (waivedPlan.body as { artifact: { id: string } }).artifact.id;
    const runAfterPlan = await get(port, `/api/runs/${runId}`);
    expect(runAfterPlan.body).toMatchObject({
      run: expect.objectContaining({
        status: 'blocked',
        artifact_refs: expect.arrayContaining([evidenceArtifactId, planArtifactId]),
      }),
    });

    const waiverEvents = await get(port, `/api/runs/${runId}/events`);
    expect((waiverEvents.body as { events: Array<{ type: string }> }).events.map((event) => event.type))
      .toContain('verifier.waived');
  });

  it('allows delivery_plan waivers to create planning evidence without broadening to delivery', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const created = await post(port, '/api/runs', {
      productFactory: {
        templateId: 'feature',
        prompt: 'Prepare a delivery plan after a verifier block',
        answers: {
          acceptance: 'Draft plan is visible.',
          surface: 'Gateway delivery plan route.',
        },
      },
    });
    const runId = (created.body as { run: { run_id: string } }).run.run_id;

    await expect(runtime!.executeProductFactoryRun(runId, {
      worker: {
        transport: 'acp',
        verifierValidators: [
          validator('policy', {
            validator: 'policy',
            verdict: 'block',
            message: 'delivery policy violation',
            durationMs: 1,
          }),
        ],
      },
    })).rejects.toThrow(/verifier blocked execution/);

    const narrowWaiver = await post(port, `/api/runs/${runId}/verifier-waiver`, {
      operatorId: 'operator-1',
      reason: 'Plan-only waiver for operator review',
      scope: 'delivery_plan',
    });
    expect(narrowWaiver.status).toBe(201);

    const deliveryPlan = await post(port, `/api/runs/${runId}/github-delivery-plan`, { issueNumber: 42 });
    expect(deliveryPlan.status).toBe(201);
    expect(deliveryPlan.body).toMatchObject({
      evidenceArtifact: expect.objectContaining({ kind: 'delivery_evidence' }),
      plan: expect.objectContaining({
        applySupported: false,
        blockers: expect.arrayContaining([
          expect.stringContaining('apply requires completed'),
          expect.stringContaining('verifier must be passed or waived before apply'),
        ]),
      }),
    });

    const evidenceArtifactId = (deliveryPlan.body as { evidenceArtifact: { id: string } }).evidenceArtifact.id;
    const persistedEvidence = await get(port, `/api/runs/${runId}/delivery-evidence`);
    expect(persistedEvidence.body).toMatchObject({
      artifact: expect.objectContaining({ id: evidenceArtifactId }),
      snapshot: expect.objectContaining({
        verifierStatus: 'waived',
        verifier: expect.objectContaining({ waivedFrom: 'blocked' }),
      }),
    });
  });

  it('allows warning evidence but requires a waiver before GitHub delivery planning', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const created = await post(port, '/api/runs', {
      productFactory: {
        templateId: 'feature',
        prompt: 'Add delivery artifacts to the operator console',
        answers: {
          acceptance: 'Run details show summary and tests.',
          surface: 'Orchestration panel and gateway API.',
        },
      },
    });
    const runId = (created.body as { run: { run_id: string } }).run.run_id;

    const result = await runtime!.executeProductFactoryRun(runId, {
      worker: {
        transport: 'acp',
        verifierValidators: [
          validator('policy', {
            validator: 'policy',
            verdict: 'warn',
            message: 'manual review recommended',
            durationMs: 1,
          }),
        ],
      },
    });
    expect(result.run.status).toBe('completed');
    expect(result.deliveryEvidence?.verifierStatus).toBe('warning');

    const evidence = await get(port, `/api/runs/${runId}/delivery-evidence`);
    expect(evidence.body).toMatchObject({
      snapshot: expect.objectContaining({ verifierStatus: 'warning' }),
    });
    const preWaiverEvidenceArtifactId = (evidence.body as { artifact: { id: string } }).artifact.id;

    const blockedPlan = await post(port, `/api/runs/${runId}/github-delivery-plan`, { issueNumber: 42 });
    expect(blockedPlan.status).toBe(409);
    expect(blockedPlan.body).toMatchObject({
      error: expect.stringContaining('passed or waived'),
    });

    const waiver = await post(port, `/api/runs/${runId}/verifier-waiver`, {
      operatorId: 'operator-1',
      reason: 'Warning reviewed and accepted for draft delivery',
      scope: 'delivery_plan',
    });
    expect(waiver.status).toBe(201);
    const genericVerifierStatus = await get(port, `/api/runs/${runId}/verifier-status`);
    expect(genericVerifierStatus.body).toMatchObject({
      decision: expect.objectContaining({ status: 'warning', rawStatus: 'warning' }),
    });

    const deliveryPlan = await post(port, `/api/runs/${runId}/github-delivery-plan`, { issueNumber: 42 });
    expect(deliveryPlan.status).toBe(201);
    expect(deliveryPlan.body).toMatchObject({
      artifact: expect.objectContaining({ kind: 'delivery_plan' }),
      evidenceArtifact: expect.objectContaining({ kind: 'delivery_evidence' }),
      plan: expect.objectContaining({
        applySupported: false,
        blockers: expect.arrayContaining([
          expect.stringContaining('verifier must be passed or waived before apply'),
        ]),
      }),
    });
    const planEvidenceArtifactId = (deliveryPlan.body as { evidenceArtifact: { id: string } }).evidenceArtifact.id;
    expect(planEvidenceArtifactId).not.toBe(preWaiverEvidenceArtifactId);
    const waivedEvidence = await get(port, `/api/runs/${runId}/delivery-evidence`);
    expect(waivedEvidence.body).toMatchObject({
      artifact: expect.objectContaining({ id: planEvidenceArtifactId }),
      snapshot: expect.objectContaining({
        verifierStatus: 'waived',
        verifier: expect.objectContaining({ waivedFrom: 'warning' }),
      }),
    });
  });

  it('creates Ochag reminder runs with overlay workflow DAG nodes', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const created = await post(port, '/api/ochag/reminders', {
      title: 'Send dinner reminder',
      familyId: 'fam-1',
      dueAt: '18:00 daily',
      audience: 'parents',
      visibility: 'family',
    });

    expect(created.status).toBe(201);
    const runId = (created.body as { run: { run_id: string } }).run.run_id;
    expect(created.body).toMatchObject({
      run: expect.objectContaining({ mode: 'pm', status: 'planned' }),
      preview: expect.objectContaining({
        intent: expect.objectContaining({ domainIds: ['ochag'] }),
      }),
      artifact: expect.objectContaining({ kind: 'plan' }),
    });

    const dag = await get(port, `/api/runs/${runId}/dag`);
    const nodes = (dag.body as { nodes: Array<{ kind: string; payload: Record<string, unknown> }> }).nodes;
    expect(nodes.map((node) => node.kind)).toEqual(expect.arrayContaining([
      'ochag.classify_request',
      'ochag.privacy_check',
      'ochag.schedule_reminder',
      'ochag.telegram_notify',
    ]));
    expect(nodes.find((node) => node.kind === 'ochag.schedule_reminder')?.payload).toMatchObject({
      familyId: 'fam-1',
      audience: 'parents',
      visibility: 'family',
      reminderChannel: 'telegram',
    });
  });

  it('executes Ochag reminder runs as vertical reminder evidence', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const created = await post(port, '/api/ochag/reminders', {
      title: 'Send dinner reminder',
      familyId: 'fam-1',
      dueAt: '18:00 daily',
      audience: 'parents',
      visibility: 'family',
    });

    const runId = (created.body as { run: { run_id: string } }).run.run_id;
    const executed = await post(port, `/api/runs/${runId}/control`, { action: 'execute' });

    expect(executed.status).toBe(200);
    expect(executed.body).toMatchObject({
      run: expect.objectContaining({ status: 'completed' }),
      deliveryArtifact: expect.objectContaining({ kind: 'summary' }),
      summary: expect.stringContaining('Ochag reminder scheduled'),
    });

    const dag = await get(port, `/api/runs/${runId}/dag`);
    const nodes = (dag.body as { nodes: Array<{ kind: string; status: string }> }).nodes;
    expect(nodes.filter((node) => node.kind.startsWith('ochag.')).map((node) => node.status))
      .toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);

    const events = await get(port, `/api/runs/${runId}/events`);
    expect((events.body as { events: Array<{ type: string; status?: string }> }).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'test.completed', status: 'ochag.reminder_mvp:passed' }),
    ]));
  });

  it('creates CEOClaw business brief runs with overlay workflow DAG nodes', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const created = await post(port, '/api/ceoclaw/briefs', {
      decision: 'Approve supplier contract',
      evidence: ['contract.pdf', 'finance-note.md'],
      deadline: 'Friday',
      projectId: 'project-1',
    });

    expect(created.status).toBe(201);
    const runId = (created.body as { run: { run_id: string } }).run.run_id;
    expect(created.body).toMatchObject({
      run: expect.objectContaining({ mode: 'pm', status: 'planned' }),
      preview: expect.objectContaining({
        intent: expect.objectContaining({ domainIds: ['ceoclaw'] }),
      }),
      artifact: expect.objectContaining({ kind: 'plan' }),
    });

    const dag = await get(port, `/api/runs/${runId}/dag`);
    const nodes = (dag.body as { nodes: Array<{ kind: string; payload: Record<string, unknown>; provenance: Array<{ kind: string }> }> }).nodes;
    expect(nodes.map((node) => node.kind)).toEqual(expect.arrayContaining([
      'ceoclaw.collect_evidence',
      'ceoclaw.verify_evidence',
      'ceoclaw.finance_impact_check',
      'ceoclaw.request_approval',
      'ceoclaw.generate_report',
    ]));
    expect(nodes.find((node) => node.kind === 'ceoclaw.request_approval')?.payload).toMatchObject({
      projectId: 'project-1',
      actionType: 'approval',
      evidenceRefs: ['contract.pdf', 'finance-note.md'],
    });
    expect(nodes[0].provenance.map((link) => link.kind)).toEqual(expect.arrayContaining(['run', 'artifact']));
  });

  it('executes CEOClaw business briefs through evidence, approval and report nodes', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const created = await post(port, '/api/ceoclaw/briefs', {
      decision: 'Approve supplier contract',
      evidence: ['contract.pdf', 'finance-note.md'],
      deadline: 'Friday',
      projectId: 'project-1',
    });

    const runId = (created.body as { run: { run_id: string } }).run.run_id;
    const approvalRequested = await post(port, `/api/runs/${runId}/control`, { action: 'execute' });

    expect(approvalRequested.status).toBe(200);
    const approvalId = (approvalRequested.body as { approval: { id: string } }).approval.id;
    expect(approvalRequested.body).toMatchObject({
      run: expect.objectContaining({ status: 'blocked' }),
      approval: expect.objectContaining({
        toolName: 'ceoclaw_business_brief_approval',
        run_id: runId,
      }),
      summary: expect.stringContaining('awaiting approval'),
    });

    let dag = await get(port, `/api/runs/${runId}/dag`);
    let nodes = (dag.body as { nodes: Array<{ kind: string; status: string }> }).nodes;
    expect(nodes.find((node) => node.kind === 'ceoclaw.collect_evidence')?.status).toBe('succeeded');
    expect(nodes.find((node) => node.kind === 'ceoclaw.verify_evidence')?.status).toBe('succeeded');
    expect(nodes.find((node) => node.kind === 'ceoclaw.finance_impact_check')?.status).toBe('succeeded');
    expect(nodes.find((node) => node.kind === 'ceoclaw.request_approval')?.status).not.toBe('succeeded');

    expect(approvalFlow.resolveDecision(approvalId, 'approve')).toBe(true);
    const approved = await post(port, `/api/runs/${runId}/control`, { action: 'execute', approvalId });

    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      run: expect.objectContaining({ status: 'completed' }),
      deliveryArtifact: expect.objectContaining({ kind: 'summary' }),
      summary: expect.stringContaining('Approved CEOClaw action'),
    });

    dag = await get(port, `/api/runs/${runId}/dag`);
    nodes = (dag.body as { nodes: Array<{ kind: string; status: string }> }).nodes;
    expect(nodes.filter((node) => node.kind.startsWith('ceoclaw.')).map((node) => node.status))
      .toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded']);

    const events = await get(port, `/api/runs/${runId}/events`);
    expect((events.body as { events: Array<{ type: string; status?: string }> }).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'approval.requested' }),
      expect.objectContaining({ type: 'approval.granted' }),
      expect.objectContaining({ type: 'test.completed', status: 'ceoclaw.business_brief_mvp:passed' }),
    ]));
  });

  it('does not consume CEOClaw approvals that belong to another run', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const first = await post(port, '/api/ceoclaw/briefs', {
      decision: 'Approve first action',
      evidence: ['first.md'],
      projectId: 'project-1',
    });
    const second = await post(port, '/api/ceoclaw/briefs', {
      decision: 'Approve second action',
      evidence: ['second.md'],
      projectId: 'project-2',
    });
    const firstRunId = (first.body as { run: { run_id: string } }).run.run_id;
    const secondRunId = (second.body as { run: { run_id: string } }).run.run_id;

    await post(port, `/api/runs/${firstRunId}/control`, { action: 'execute' });
    const secondApprovalRequest = await post(port, `/api/runs/${secondRunId}/control`, { action: 'execute' });
    const secondApprovalId = (secondApprovalRequest.body as { approval: { id: string } }).approval.id;
    expect(approvalFlow.resolveDecision(secondApprovalId, 'approve')).toBe(true);

    const mismatched = await post(port, `/api/runs/${firstRunId}/control`, {
      action: 'execute',
      approvalId: secondApprovalId,
    });
    expect(mismatched.status).toBe(409);

    const approved = await post(port, `/api/runs/${secondRunId}/control`, {
      action: 'execute',
      approvalId: secondApprovalId,
    });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      run: expect.objectContaining({ run_id: secondRunId, status: 'completed' }),
    });
  });

  it('cancels CEOClaw runs when their approval is denied', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const created = await post(port, '/api/ceoclaw/briefs', {
      decision: 'Approve supplier contract',
      evidence: ['contract.pdf'],
      projectId: 'project-denied',
    });
    const runId = (created.body as { run: { run_id: string } }).run.run_id;
    const approvalRequested = await post(port, `/api/runs/${runId}/control`, { action: 'execute' });
    const approvalId = (approvalRequested.body as { approval: { id: string } }).approval.id;
    expect(approvalFlow.resolveDecision(approvalId, 'deny')).toBe(true);

    await expect.poll(async () => {
      const run = await get(port, `/api/runs/${runId}`);
      return (run.body as { run: { status: string } }).run.status;
    }).toBe('cancelled');
    const staleExecute = await post(port, `/api/runs/${runId}/control`, { action: 'execute', approvalId });
    expect(staleExecute.status).toBe(409);
    const events = await get(port, `/api/runs/${runId}/events`);
    const runEvents = (events.body as { events: Array<{ type: string; approval_id?: string }> }).events;
    expect(runEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'approval.denied', approval_id: approvalId }),
      expect.objectContaining({ type: 'run.cancelled' }),
    ]));
    expect(runEvents.filter((event) => event.type === 'approval.denied' && event.approval_id === approvalId)).toHaveLength(1);
    expect(runEvents.filter((event) => event.type === 'run.cancelled')).toHaveLength(1);
  });

  it('cancels CEOClaw runs when denial arrives before the initial execute blocks', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const created = await post(port, '/api/ceoclaw/briefs', {
      decision: 'Approve immediately denied action',
      evidence: ['contract.pdf'],
      projectId: 'project-preblock-denied',
    });
    const runId = (created.body as { run: { run_id: string } }).run.run_id;
    const approvalId = `ceoclaw-business-brief-${runId}`;
    const unsubscribe = approvalFlow.subscribe((event) => {
      if (
        event.type === 'approval-requested'
        && event.request.toolName === 'ceoclaw_business_brief_approval'
        && event.request.run_id === runId
      ) {
        approvalFlow.resolveDecision(event.request.id, 'deny');
      }
    });
    try {
      const execute = await post(port, `/api/runs/${runId}/control`, { action: 'execute' });
      expect(execute.status).toBe(409);
    } finally {
      unsubscribe();
    }

    const run = await get(port, `/api/runs/${runId}`);
    expect(run.body).toMatchObject({
      run: expect.objectContaining({ run_id: runId, status: 'cancelled' }),
    });
    const events = await get(port, `/api/runs/${runId}/events`);
    const runEvents = (events.body as { events: Array<{ type: string; approval_id?: string }> }).events;
    expect(runEvents.filter((event) => event.type === 'approval.denied' && event.approval_id === approvalId)).toHaveLength(1);
    expect(runEvents.filter((event) => event.type === 'run.cancelled')).toHaveLength(1);
  });

  it('recovers pending CEOClaw approvals for blocked runs after restart', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    let port = await startRuntime(rootDir);
    const created = await post(port, '/api/ceoclaw/briefs', {
      decision: 'Approve recovered action',
      evidence: ['recovery.md'],
      projectId: 'project-recovery',
    });
    const runId = (created.body as { run: { run_id: string } }).run.run_id;
    const approvalRequested = await post(port, `/api/runs/${runId}/control`, { action: 'execute' });
    const approvalId = (approvalRequested.body as { approval: { id: string } }).approval.id;

    approvalFlow.resetForTests();
    await runtime!.stop();
    runtime = null;
    port = await startRuntime(rootDir);

    const pending = await get(port, '/api/approvals/pending');
    expect(pending.status).toBe(200);
    expect(pending.body).toMatchObject({
      approvals: [
        expect.objectContaining({
          id: approvalId,
          toolName: 'ceoclaw_business_brief_approval',
          run_id: runId,
        }),
      ],
    });

    expect(approvalFlow.resolveDecision(approvalId, 'approve')).toBe(true);
    const approved = await post(port, `/api/runs/${runId}/control`, { action: 'execute', approvalId });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      run: expect.objectContaining({ run_id: runId, status: 'completed' }),
    });
  });

  it('does not recover GitHub delivery apply approvals after an apply artifact was persisted', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);
    const runId = 'run-github-applied';
    const eventLedger = new EventLedger(path.join(rootDir, 'orchestration', 'events.jsonl'));
    const runLedger = new RunLedger({ ledger: eventLedger });
    await runLedger.createRun({
      run_id: runId,
      task_id: 'task-github-applied',
      workspace_id: 'workspace-1',
      repo_id: 'repo-1',
      mode: 'pm',
      goal: 'Seed applied GitHub delivery state',
    });
    await runLedger.transition(runId, 'planned', 'seeded restart state');
    await runLedger.transition(runId, 'running', 'seeded restart state');
    await runLedger.completeRun(runId, 'completed', 'seeded completion');
    const artifactStore = new ArtifactStore({ rootDir: path.join(rootDir, 'artifacts') });
    const plan: GitHubDeliveryPlan = {
      schemaVersion: 'pyrfor.github_delivery_plan.v1',
      createdAt: '2026-05-03T00:00:00.000Z',
      runId,
      mode: 'dry_run',
      applySupported: true,
      approvalRequired: true,
      repository: 'acme/pyrfor',
      baseBranch: 'main',
      headSha: '1234567890abcdef',
      proposedBranch: 'pyrfor/applied',
      pullRequest: { title: 'Pyrfor delivery', body: 'Draft PR', draft: true },
      ci: { observeWorkflowRuns: [] },
      blockers: [],
      provenance: {
        repository: 'acme/pyrfor',
        baseBranch: 'main',
        headSha: '1234567890abcdef',
      },
    };
    const planArtifact = await artifactStore.writeJSON('delivery_plan', plan, { runId });
    const approvalId = 'github-delivery-apply-recovered-test';
    await eventLedger.append({
      type: 'approval.requested',
      run_id: runId,
      tool: 'github_delivery_apply',
      approval_id: approvalId,
      artifact_id: planArtifact.id,
      reason: `approval required for delivery plan ${planArtifact.id}`,
    });
    await artifactStore.writeJSON('delivery_apply', {
      schemaVersion: 'pyrfor.github_delivery_apply.v1',
      appliedAt: '2026-05-03T00:01:00.000Z',
      mode: 'draft_pr',
      runId,
      repository: 'acme/pyrfor',
      baseBranch: 'main',
      branch: 'pyrfor/applied',
      headSha: '1234567890abcdef',
      planArtifactId: planArtifact.id,
      planSha256: planArtifact.sha256,
      approvalId,
      idempotencyKey: 'idempotency-key',
      draftPullRequest: {
        number: 12,
        url: 'https://github.com/acme/pyrfor/pull/12',
        title: 'Pyrfor delivery',
        state: 'open',
        draft: true,
        headRef: 'pyrfor/applied',
        baseRef: 'main',
      },
    }, {
      runId,
      meta: {
        planArtifactId: planArtifact.id,
        approvalId,
      },
    });

    const port = await startRuntime(rootDir);
    const pending = await get(port, '/api/approvals/pending');
    expect(pending.status).toBe(200);
    expect(pending.body).toMatchObject({ approvals: [] });
  });

  it('hydrates run records from the persisted event ledger on restart', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const eventLedger = new EventLedger(path.join(rootDir, 'orchestration', 'events.jsonl'));
    const runLedger = new RunLedger({ ledger: eventLedger });
    await runLedger.createRun({
      run_id: 'run-seeded',
      task_id: 'task-seeded',
      workspace_id: 'workspace-1',
      repo_id: 'repo-1',
      mode: 'pm',
      goal: 'Seed persisted orchestration state',
    });
    await runLedger.transition('run-seeded', 'planned', 'seeded restart state');
    await runLedger.transition('run-seeded', 'running', 'seeded restart state');

    const port = await startRuntime(rootDir);

    const runs = await get(port, '/api/runs');
    expect(runs.status).toBe(200);
    expect(runs.body).toMatchObject({
      runs: [expect.objectContaining({ run_id: 'run-seeded', status: 'blocked' })],
    });

    const run = await get(port, '/api/runs/run-seeded');
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      run: expect.objectContaining({
        run_id: 'run-seeded',
        task_id: 'task-seeded',
        status: 'blocked',
      }),
    });
  });

  it('captures handleMessage user turns as completed RunLedger runs', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const result = await runtime!.handleMessage('web', 'user-1', 'chat-1', 'Summarize the workspace');

    expect(result).toMatchObject({
      success: true,
      response: 'mock reply',
      sessionId: expect.any(String),
      runId: expect.any(String),
      taskId: expect.any(String),
    });

    const runs = await get(port, '/api/runs');
    expect(runs.status).toBe(200);
    expect(runs.body).toMatchObject({
      runs: [expect.objectContaining({
        run_id: result.runId,
        task_id: result.taskId,
        status: 'completed',
        mode: 'chat',
      })],
    });

    const events = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}/events`);
    expect(events.status).toBe(200);
    const eventTypes = ((events.body as { events: Array<{ type: string }> }).events).map((event) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      'run.created',
      'run.transitioned',
      'run.completed',
    ]));
  });

  it('routes live ACP worker frames through the runtime-owned orchestration host', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const result = await runtime!.handleMessage('web', 'user-1', 'chat-1', 'Run a worker task', {
      worker: {
        transport: 'acp',
        permissionOverrides: { shell_exec: 'auto_allow' },
        events: ({ runId, taskId, sessionId, workerRunId }) => (async function* () {
          yield {
            sessionId,
            type: 'worker_frame' as const,
            ts: Date.now(),
            data: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'proposed_command',
              frame_id: 'frame-command',
              task_id: taskId,
              run_id: runId,
              worker_run_id: workerRunId,
              seq: 0,
              command: 'printf worker',
              reason: 'runtime wiring smoke',
            },
          };
          yield {
            sessionId,
            type: 'worker_frame' as const,
            ts: Date.now(),
            data: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'final_report',
              frame_id: 'frame-final',
              task_id: taskId,
              run_id: runId,
              worker_run_id: workerRunId,
              seq: 1,
              status: 'succeeded',
              summary: 'worker completed under host authority',
            },
          };
        })(),
      },
    });

    expect(result).toMatchObject({
      success: true,
      response: 'worker completed under host authority',
      runId: expect.any(String),
    });

    const run = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}`);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      run: expect.objectContaining({ status: 'completed' }),
    });

    const events = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}/events`);
    expect(events.status).toBe(200);
    const eventTypes = ((events.body as { events: Array<{ type: string }> }).events).map((event) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      'effect.proposed',
      'effect.policy_decided',
      'effect.applied',
      'tool.requested',
      'tool.executed',
      'artifact.created',
      'verifier.completed',
      'run.completed',
    ]));

    const verifierIndex = eventTypes.indexOf('verifier.completed');
    const completedIndex = eventTypes.indexOf('run.completed');
    expect(verifierIndex).toBeGreaterThanOrEqual(0);
    expect(completedIndex).toBeGreaterThan(verifierIndex);

    const artifactEvents = (events.body as { events: Array<{ type: string; artifact_id?: string }> }).events
      .filter((event) => event.type === 'artifact.created');
    expect(artifactEvents.length).toBeGreaterThanOrEqual(2);

    const dag = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}/dag`);
    expect(dag.status).toBe(200);
    const nodes = (dag.body as { nodes: Array<{ id: string; kind: string; dependsOn?: string[]; provenance?: Array<{ kind: string; ref: string }> }> }).nodes;
    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'governed.context_pack' }),
      expect.objectContaining({ kind: 'worker.frame.proposed_command' }),
      expect.objectContaining({ kind: 'worker.effect.shell_command' }),
      expect.objectContaining({ kind: 'governed.verifier' }),
    ]));
    const contextNode = nodes.find((node) => node.kind === 'governed.context_pack');
    const verifyNode = nodes.find((node) => node.kind === 'governed.verifier');
    expect(verifyNode?.dependsOn).toContain(contextNode?.id);
    expect(verifyNode?.provenance?.some((link) => link.kind === 'artifact')).toBe(true);
  });

  it('routes live FreeClaude worker frames through the runtime-owned orchestration host', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const result = await runtime!.handleMessage('web', 'user-1', 'chat-1', 'Run a FreeClaude worker task', {
      worker: {
        transport: 'freeclaude',
        permissionOverrides: { shell_exec: 'auto_allow' },
        events: ({ runId, taskId, workerRunId }) => (async function* () {
          yield {
            type: 'worker_frame' as const,
            raw: {},
            frame: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'proposed_command',
              frame_id: 'fc-frame-command',
              task_id: taskId,
              run_id: runId,
              worker_run_id: workerRunId,
              seq: 0,
              command: 'printf freeclaude',
              reason: 'runtime FreeClaude wiring smoke',
            },
          };
          yield {
            type: 'worker_frame' as const,
            raw: {},
            frame: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'final_report',
              frame_id: 'fc-frame-final',
              task_id: taskId,
              run_id: runId,
              worker_run_id: workerRunId,
              seq: 1,
              status: 'succeeded',
              summary: 'freeclaude worker completed under host authority',
            },
          };
        })(),
      },
    });

    expect(result).toMatchObject({
      success: true,
      response: 'freeclaude worker completed under host authority',
      runId: expect.any(String),
    });

    const events = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}/events`);
    expect(events.status).toBe(200);
    const eventTypes = ((events.body as { events: Array<{ type: string }> }).events).map((event) => event.type);
    expect(eventTypes).toEqual(expect.arrayContaining([
      'effect.proposed',
      'effect.applied',
      'tool.requested',
      'tool.executed',
      'verifier.completed',
      'run.completed',
    ]));
  });

  it('rejects FreeClaude frames that omit the host-owned worker run id', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const result = await runtime!.handleMessage('web', 'user-1', 'chat-1', 'Run an unbound FreeClaude worker task', {
      worker: {
        transport: 'freeclaude',
        permissionOverrides: { shell_exec: 'auto_allow' },
        events: ({ runId, taskId }) => (async function* () {
          yield {
            type: 'worker_frame' as const,
            raw: {},
            frame: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'proposed_command',
              frame_id: 'fc-unbound-command',
              task_id: taskId,
              run_id: runId,
              seq: 0,
              command: 'printf should-not-run',
            },
          };
        })(),
      },
    });

    expect(result).toMatchObject({
      success: false,
      runId: expect.any(String),
    });
    expect(result.error).toContain('worker_run_id');

    const run = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}`);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      run: expect.objectContaining({ status: 'failed' }),
    });

    const events = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}/events`);
    const eventTypes = ((events.body as { events: Array<{ type: string }> }).events).map((event) => event.type);
    expect(eventTypes).not.toContain('tool.requested');
    expect(eventTypes).not.toContain('tool.executed');
  });

  it('keeps denied FreeClaude effects from becoming success-shaped completions', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const result = await runtime!.handleMessage('web', 'user-1', 'chat-1', 'Run a denied FreeClaude patch task', {
      worker: {
        transport: 'freeclaude',
        permissionOverrides: { apply_patch: 'deny', shell_exec: 'auto_allow' },
        events: ({ runId, taskId, workerRunId }) => (async function* () {
          yield {
            type: 'worker_frame' as const,
            raw: {},
            frame: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'proposed_patch',
              frame_id: 'fc-denied-patch',
              task_id: taskId,
              run_id: runId,
              worker_run_id: workerRunId,
              seq: 0,
              patch: 'diff --git a/a.ts b/a.ts',
              files: ['a.ts'],
              summary: 'attempt denied patch',
            },
          };
          yield {
            type: 'worker_frame' as const,
            raw: {},
            frame: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'proposed_command',
              frame_id: 'fc-after-denial-command',
              task_id: taskId,
              run_id: runId,
              worker_run_id: workerRunId,
              seq: 1,
              command: 'printf should-not-run',
              reason: 'attempt post-denial execution',
            },
          };
          yield {
            type: 'worker_frame' as const,
            raw: {},
            frame: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'final_report',
              frame_id: 'fc-denied-final',
              task_id: taskId,
              run_id: runId,
              worker_run_id: workerRunId,
              seq: 2,
              status: 'succeeded',
              summary: 'worker claims success after denial',
            },
          };
        })(),
      },
    });

    expect(result).toMatchObject({
      success: false,
      runId: expect.any(String),
    });
    expect(result.error).toContain('denied');

    const run = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}`);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      run: expect.objectContaining({ status: 'blocked' }),
    });

    const events = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}/events`);
    const eventTypes = ((events.body as { events: Array<{ type: string }> }).events).map((event) => event.type);
    expect(eventTypes).toContain('effect.denied');
    expect(eventTypes).not.toContain('tool.requested');
    expect(eventTypes).not.toContain('tool.executed');
    expect(eventTypes).not.toContain('run.completed');
  });

  it('returns failure for FreeClaude failure reports without success-shaped completion', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const result = await runtime!.handleMessage('web', 'user-1', 'chat-1', 'Run a failing FreeClaude worker task', {
      worker: {
        transport: 'freeclaude',
        events: ({ runId, taskId, workerRunId }) => (async function* () {
          yield {
            type: 'worker_frame' as const,
            raw: {},
            frame: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'failure_report',
              frame_id: 'fc-failure-report',
              task_id: taskId,
              run_id: runId,
              worker_run_id: workerRunId,
              seq: 0,
              status: 'failed',
              error: { code: 'WORKER_FAILED', message: 'worker failed before completion' },
            },
          };
        })(),
      },
    });

    expect(result).toMatchObject({
      success: false,
      runId: expect.any(String),
    });
    expect(result.error).toContain('worker failed before completion');

    const run = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}`);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      run: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('rejects native FreeClaude mutation telemetry outside Worker Protocol', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const result = await runtime!.handleMessage('web', 'user-1', 'chat-1', 'Run a native-mutating FreeClaude worker task', {
      worker: {
        transport: 'freeclaude',
        events: () => (async function* () {
          yield {
            type: 'result' as const,
            raw: {},
            result: {
              filesTouched: ['a.ts'],
              commandsRun: [],
            },
          };
        })(),
      },
    });

    expect(result).toMatchObject({
      success: false,
      runId: expect.any(String),
    });
    expect(result.error).toContain('Strict FreeClaude worker reported native mutations');

    const run = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}`);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      run: expect.objectContaining({ status: 'failed' }),
    });
  });

  it('blocks a governed worker run when verifier fails', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-orchestration-'));
    tempRoots.push(rootDir);

    const port = await startRuntime(rootDir);
    const result = await runtime!.handleMessage('web', 'user-1', 'chat-1', 'Run a worker task that fails verification', {
      worker: {
        transport: 'acp',
        permissionOverrides: { shell_exec: 'auto_allow' },
        verifierValidators: [
          validator('policy', {
            validator: 'policy',
            verdict: 'block',
            message: 'policy violation',
            durationMs: 1,
          }),
        ],
        events: ({ runId, taskId, sessionId, workerRunId }) => (async function* () {
          yield {
            sessionId,
            type: 'worker_frame' as const,
            ts: Date.now(),
            data: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'proposed_command',
              frame_id: 'blocked-frame-command',
              task_id: taskId,
              run_id: runId,
              worker_run_id: workerRunId,
              seq: 0,
              command: 'printf blocked',
            },
          };
          yield {
            sessionId,
            type: 'worker_frame' as const,
            ts: Date.now(),
            data: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'final_report',
              frame_id: 'blocked-frame-final',
              task_id: taskId,
              run_id: runId,
              worker_run_id: workerRunId,
              seq: 1,
              status: 'succeeded',
              summary: 'worker claimed success',
            },
          };
        })(),
      },
    });

    expect(result).toMatchObject({
      success: false,
      response: '',
      runId: expect.any(String),
      error: expect.stringContaining('Verifier blocked run'),
    });

    const run = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}`);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      run: expect.objectContaining({ status: 'blocked' }),
    });

    const events = await get(port, `/api/runs/${encodeURIComponent(result.runId!)}/events`);
    expect(events.status).toBe(200);
    const eventTypes = ((events.body as { events: Array<{ type: string }> }).events).map((event) => event.type);
    expect(eventTypes).toContain('verifier.completed');
    expect(eventTypes).toContain('run.blocked');
    expect(eventTypes).not.toContain('run.completed');
  });
});
