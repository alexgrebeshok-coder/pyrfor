// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeConfigSchema, type RuntimeConfig } from './config';
import { EventLedger } from './event-ledger';
import { PyrforRuntime } from './index';
import { RunLedger } from './run-ledger';

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
});
