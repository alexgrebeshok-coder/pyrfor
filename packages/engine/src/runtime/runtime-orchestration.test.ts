// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeConfigSchema, type RuntimeConfig } from './config';
import { EventLedger } from './event-ledger';
import { PyrforRuntime } from './index';
import { RunLedger } from './run-ledger';
import type { StepValidator, ValidatorResult } from './step-validator';
import { WORKER_PROTOCOL_VERSION } from './worker-protocol';

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
      runs: [expect.objectContaining({ run_id: 'run-seeded', status: 'running' })],
    });

    const run = await get(port, '/api/runs/run-seeded');
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      run: expect.objectContaining({
        run_id: 'run-seeded',
        task_id: 'task-seeded',
        status: 'running',
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
        events: ({ runId, taskId, sessionId }) => (async function* () {
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
        events: ({ runId, taskId }) => (async function* () {
          yield {
            type: 'worker_frame' as const,
            raw: {},
            frame: {
              protocol_version: WORKER_PROTOCOL_VERSION,
              type: 'proposed_command',
              frame_id: 'fc-frame-command',
              task_id: taskId,
              run_id: runId,
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
        events: ({ runId, taskId, sessionId }) => (async function* () {
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
