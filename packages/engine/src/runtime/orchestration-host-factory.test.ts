// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactStore } from './artifact-model';
import { DomainOverlayRegistry } from './domain-overlay';
import { registerDefaultDomainOverlays } from './domain-overlay-presets';
import { DurableDag } from './durable-dag';
import { EventLedger } from './event-ledger';
import {
  createAcpWorkerFrameHandler,
  createOrchestrationHost,
  routeFreeClaudeWorkerFrame,
  type OrchestrationHostRuntimeDeps,
} from './orchestration-host-factory';
import { RunLedger } from './run-ledger';
import type { ToolExecutor } from './contracts-bridge';
import { WORKER_PROTOCOL_VERSION } from './worker-protocol';

function frameBase(runId: string, type: string): Record<string, unknown> {
  return {
    protocol_version: WORKER_PROTOCOL_VERSION,
    type,
    frame_id: `frame-${type}`,
    task_id: 'task-1',
    run_id: runId,
    seq: 0,
  };
}

describe('OrchestrationHostFactory', () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function makeDeps(): Promise<OrchestrationHostRuntimeDeps> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-host-factory-'));
    roots.push(root);
    const eventLedger = new EventLedger(path.join(root, 'events.jsonl'));
    return {
      eventLedger,
      runLedger: new RunLedger({ ledger: eventLedger }),
      dag: new DurableDag({ storePath: path.join(root, 'dag.json'), ledger: eventLedger }),
      artifactStore: new ArtifactStore({ rootDir: path.join(root, 'artifacts') }),
      overlays: registerDefaultDomainOverlays(new DomainOverlayRegistry()),
    };
  }

  async function createRunningRun(deps: OrchestrationHostRuntimeDeps): Promise<string> {
    const run = await deps.runLedger.createRun({
      workspace_id: 'workspace-1',
      repo_id: 'repo-1',
      mode: 'autonomous',
      task_id: 'task-1',
    });
    await deps.runLedger.transition(run.run_id, 'planned');
    await deps.runLedger.transition(run.run_id, 'running');
    return run.run_id;
  }

  function executors(overrides: Partial<Record<string, ToolExecutor>> = {}): Record<string, ToolExecutor> {
    return {
      shell_exec: vi.fn(async () => ({ stdout: 'ok' })),
      apply_patch: vi.fn(async () => ({ patched: true })),
      ...overrides,
    };
  }

  it('routes ACP worker_frame commands through two-phase approvals and tool execution', async () => {
    const deps = await makeDeps();
    const runId = await createRunningRun(deps);
    const toolExecutors = executors();
    const approvalFlow = { requestApproval: vi.fn(async () => 'approve' as const) };
    let resolveFrame: (() => void) | undefined;
    const frameHandled = new Promise<void>((resolve) => { resolveFrame = resolve; });
    const host = createOrchestrationHost({
      orchestration: deps,
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      toolExecutors,
      approvalFlow,
      onFrameResult: () => resolveFrame?.(),
    });
    const onEvent = vi.fn();
    const onAcpEvent = createAcpWorkerFrameHandler(host, { onEvent });

    onAcpEvent({
      sessionId: 'session-1',
      type: 'worker_frame',
      data: {
        ...frameBase(runId, 'proposed_command'),
        command: 'npm test -- worker',
        reason: 'verify',
      },
      ts: Date.now(),
    });
    await frameHandled;

    expect(approvalFlow.requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'shell_exec',
      summary: 'verify: npm test -- worker',
    }));
    expect(toolExecutors.shell_exec).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledTimes(1);
    const events = await deps.eventLedger.byRun(runId);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'effect.proposed',
      'effect.policy_decided',
      'effect.applied',
      'tool.requested',
      'tool.executed',
    ]));
  });

  it('routes FreeClaude worker_frame patches through the same host path', async () => {
    const deps = await makeDeps();
    const runId = await createRunningRun(deps);
    const toolExecutors = executors();
    const host = createOrchestrationHost({
      orchestration: deps,
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      toolExecutors,
      approvalFlow: { requestApproval: vi.fn(async () => 'approve' as const) },
    });

    const result = await routeFreeClaudeWorkerFrame(host, {
      type: 'worker_frame',
      raw: {},
      frame: {
        ...frameBase(runId, 'proposed_patch'),
        patch: 'diff --git a/a.ts b/a.ts',
        files: ['a.ts'],
        summary: 'Update a.ts',
      },
    });

    expect(result?.ok).toBe(true);
    expect(toolExecutors.apply_patch).toHaveBeenCalledTimes(1);
  });

  it('throws when required worker side-effect executors are missing', async () => {
    const deps = await makeDeps();

    expect(() => createOrchestrationHost({
      orchestration: deps,
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      toolExecutors: { shell_exec: vi.fn(async () => ({})) },
    })).toThrow(/apply_patch/);
  });

  it('merges domain overlay permission overrides into the permission engine', async () => {
    const deps = await makeDeps();
    const host = createOrchestrationHost({
      orchestration: deps,
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      domainIds: ['ceoclaw'],
      toolExecutors: executors(),
    });

    await expect(host.permissionEngine.check(
      'deploy',
      { workspaceId: 'workspace-1', sessionId: 'session-1' },
      {},
    )).resolves.toMatchObject({
      allow: false,
      promptUser: false,
      permissionClass: 'deny',
    });
  });
});
