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
import { WORKER_MANIFEST_SCHEMA_VERSION, type WorkerManifest } from './worker-manifest';

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
    const toolAudit = vi.fn();
    let resolveFrame: (() => void) | undefined;
    const frameHandled = new Promise<void>((resolve) => { resolveFrame = resolve; });
    const host = createOrchestrationHost({
      orchestration: deps,
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      toolExecutors,
      approvalFlow,
      toolAudit,
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
    expect(toolAudit).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'frame-proposed_command',
      toolName: 'shell_exec',
      decision: 'approve',
    }));
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

  it('denies FreeClaude commands through the host effect path without executing tools', async () => {
    const deps = await makeDeps();
    const runId = await createRunningRun(deps);
    const shellExec = vi.fn(async () => ({ stdout: 'should-not-run' }));
    const host = createOrchestrationHost({
      orchestration: deps,
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      toolExecutors: executors({ shell_exec: shellExec }),
      approvalFlow: { requestApproval: vi.fn(async () => 'deny' as const) },
      expectedRunId: runId,
      expectedTaskId: 'task-1',
    });

    const result = await routeFreeClaudeWorkerFrame(host, {
      type: 'worker_frame',
      raw: {},
      frame: {
        ...frameBase(runId, 'proposed_command'),
        command: 'printf denied',
        reason: 'verify denial path',
      },
    });

    expect(result).toMatchObject({ ok: false, disposition: 'effect_denied' });
    expect(shellExec).not.toHaveBeenCalled();
    const eventTypes = (await deps.eventLedger.byRun(runId)).map((event) => event.type);
    expect(eventTypes).toContain('effect.denied');
    expect(eventTypes).not.toContain('tool.requested');
    expect(eventTypes).not.toContain('tool.executed');
  });

  it('defers FreeClaude terminal reports to the runtime owner', async () => {
    const deps = await makeDeps();
    const runId = await createRunningRun(deps);
    const host = createOrchestrationHost({
      orchestration: deps,
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      toolExecutors: executors(),
      deferTerminalRunCompletion: true,
      expectedRunId: runId,
      expectedTaskId: 'task-1',
    });

    const result = await routeFreeClaudeWorkerFrame(host, {
      type: 'worker_frame',
      raw: {},
      frame: {
        ...frameBase(runId, 'final_report'),
        status: 'succeeded',
        summary: 'worker says done',
      },
    });

    expect(result).toMatchObject({ ok: true, disposition: 'run_completed' });
    expect(deps.runLedger.getRun(runId)?.status).toBe('running');
    const eventTypes = (await deps.eventLedger.byRun(runId)).map((event) => event.type);
    expect(eventTypes).not.toContain('run.completed');
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

  it('applies worker manifest permissions without weakening overlay denies', async () => {
    const deps = await makeDeps();
    const workerManifest: WorkerManifest = {
      schemaVersion: WORKER_MANIFEST_SCHEMA_VERSION,
      id: 'worker.ceoclaw',
      version: '0.1.0',
      title: 'CEOClaw worker',
      transport: 'acp',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      domainIds: ['ceoclaw'],
      permissionProfile: 'autonomous',
      toolPermissionOverrides: {
        deploy: 'auto_allow',
        shell_exec: 'deny',
      },
    };

    const host = createOrchestrationHost({
      orchestration: deps,
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      domainIds: [],
      workerManifest,
      permissionProfile: 'standard',
      permissionOverrides: {
        shell_exec: 'auto_allow',
      },
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
    await expect(host.permissionEngine.check(
      'shell_exec',
      { workspaceId: 'workspace-1', sessionId: 'session-1' },
      {},
    )).resolves.toMatchObject({
      allow: false,
      promptUser: false,
      permissionClass: 'deny',
    });
  });

  it('passes capability policy through the public host factory surface', async () => {
    const deps = await makeDeps();
    const runId = await createRunningRun(deps);
    const capabilityPolicy = vi.fn(async () => 'grant' as const);
    const host = createOrchestrationHost({
      orchestration: deps,
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      toolExecutors: executors(),
      capabilityPolicy,
    });

    const result = await host.workerBridge.handle({
      ...frameBase(runId, 'request_capability'),
      capability: 'browser_qa',
      reason: 'Run external QA adapter',
    });

    expect(result).toMatchObject({ ok: true, disposition: 'capability_granted' });
    expect(capabilityPolicy).toHaveBeenCalledWith(expect.objectContaining({
      runId,
      capability: 'browser_qa',
    }));
  });
});
