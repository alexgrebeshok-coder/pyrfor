// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ContractsBridge, type ToolExecutor } from './contracts-bridge';
import { EventLedger } from './event-ledger';
import {
  PermissionEngine,
  ToolRegistry,
  registerStandardTools,
} from './permission-engine';
import { RunLedger } from './run-ledger';
import { TwoPhaseEffectRunner } from './two-phase-effect';
import { WORKER_PROTOCOL_VERSION } from './worker-protocol';
import { WorkerProtocolBridge } from './worker-protocol-bridge';

function tmpLedgerPath(): string {
  const hex = randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `worker-protocol-bridge-test-${hex}`, 'events.jsonl');
}

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

describe('WorkerProtocolBridge', () => {
  let ledgerPath: string;
  let eventLedger: EventLedger;
  let runLedger: RunLedger;
  let registry: ToolRegistry;

  beforeEach(() => {
    ledgerPath = tmpLedgerPath();
    eventLedger = new EventLedger(ledgerPath);
    runLedger = new RunLedger({ ledger: eventLedger });
    registry = new ToolRegistry();
    registerStandardTools(registry);
  });

  afterEach(async () => {
    await eventLedger.close();
    await rm(path.dirname(ledgerPath), { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function createRunningRun(): Promise<string> {
    const run = await runLedger.createRun({
      workspace_id: 'ws-1',
      repo_id: 'repo-1',
      mode: 'autonomous',
      task_id: 'task-1',
    });
    await runLedger.transition(run.run_id, 'planned');
    await runLedger.transition(run.run_id, 'running');
    return run.run_id;
  }

  function makeBridge(options: {
    onAskPermission?: () => Promise<'allow' | 'deny'>;
    executor?: ToolExecutor;
  } = {}): WorkerProtocolBridge {
    const permissionEngine = new PermissionEngine(registry);
    const contractsBridge = new ContractsBridge({
      permissionEngine,
      ledger: eventLedger,
      ...(options.onAskPermission ? { onAskPermission: async () => options.onAskPermission!() } : {}),
    });
    return new WorkerProtocolBridge({
      runLedger,
      contractsBridge,
      toolExecutors: {
        shell_exec: options.executor ?? (async () => ({ ok: true })),
      },
    });
  }

  function makeEffectBridge(options: {
    approvalDecision?: 'approve' | 'deny' | 'timeout';
    executor?: ToolExecutor;
    patchExecutor?: ToolExecutor;
  } = {}): WorkerProtocolBridge {
    const permissionEngine = new PermissionEngine(registry);
    const contractsBridge = new ContractsBridge({
      permissionEngine,
      ledger: eventLedger,
    });
    const effectRunner = new TwoPhaseEffectRunner({
      ledger: eventLedger,
      permissionEngine,
      permissionContext: { workspaceId: 'ws-1', sessionId: 'session-1' },
    });
    return new WorkerProtocolBridge({
      runLedger,
      contractsBridge,
      effectRunner,
      approvalFlow: options.approvalDecision
        ? { requestApproval: async () => options.approvalDecision! }
        : undefined,
      toolExecutors: {
        shell_exec: options.executor ?? (async () => ({ ok: true })),
        apply_patch: options.patchExecutor ?? (async () => ({ ok: true })),
      },
    });
  }

  it('invokes proposed_command only through ContractsBridge', async () => {
    const runId = await createRunningRun();
    const exec = vi.fn(async () => ({ stdout: 'ok' }));
    const bridge = makeBridge({ onAskPermission: async () => 'allow', executor: exec });

    const result = await bridge.handle({
      ...frameBase(runId, 'proposed_command'),
      command: 'npm test -- worker',
      reason: 'verify task',
    });

    expect(result.ok).toBe(true);
    expect(result.disposition).toBe('tool_invoked');
    expect(exec).toHaveBeenCalledTimes(1);

    const events = await eventLedger.byRun(runId);
    expect(events.some((event) => event.type === 'tool.requested')).toBe(true);
    expect(events.some((event) => event.type === 'tool.executed')).toBe(true);
  });

  it('does not execute proposed_command when permission is denied', async () => {
    const runId = await createRunningRun();
    const exec = vi.fn(async () => ({ stdout: 'should-not-run' }));
    const bridge = makeBridge({ executor: exec });

    const result = await bridge.handle({
      ...frameBase(runId, 'proposed_command'),
      command: 'rm -rf /tmp/nope',
    });

    expect(result.ok).toBe(false);
    expect(result.toolResult?.decision).toBe('denied_user');
    expect(exec).not.toHaveBeenCalled();

    const events = await eventLedger.byRun(runId);
    expect(events.some((event) => event.type === 'tool.denied')).toBe(true);
  });

  it('records artifact_reference through RunLedger', async () => {
    const runId = await createRunningRun();
    const bridge = makeBridge();

    const result = await bridge.handle({
      ...frameBase(runId, 'artifact_reference'),
      artifact_id: 'sha256:abc',
      uri: 'artifact://run/diff',
    });

    expect(result).toMatchObject({ ok: true, disposition: 'artifact_recorded' });
    expect(runLedger.getRun(runId)?.artifact_refs).toEqual(['sha256:abc']);
    const events = await eventLedger.byRun(runId);
    expect(events.some((event) => event.type === 'artifact.created')).toBe(true);
  });

  it('completes a run from final_report through RunLedger', async () => {
    const runId = await createRunningRun();
    const bridge = makeBridge();

    const result = await bridge.handle({
      ...frameBase(runId, 'final_report'),
      status: 'succeeded',
      summary: 'done',
    });

    expect(result).toMatchObject({ ok: true, disposition: 'run_completed' });
    expect(runLedger.getRun(runId)?.status).toBe('completed');
    const events = await eventLedger.byRun(runId);
    expect(events.some((event) => event.type === 'run.completed')).toBe(true);
  });

  it('fails a run from failure_report through RunLedger', async () => {
    const runId = await createRunningRun();
    const bridge = makeBridge();

    const result = await bridge.handle({
      ...frameBase(runId, 'failure_report'),
      status: 'failed',
      error: { code: 'VERIFICATION_FAILED', message: 'tests failed' },
    });

    expect(result).toMatchObject({ ok: true, disposition: 'run_failed' });
    expect(runLedger.getRun(runId)?.status).toBe('failed');
    const events = await eventLedger.byRun(runId);
    expect(events.some((event) => event.type === 'run.failed')).toBe(true);
  });

  it('returns invalid_frame for malformed worker frames without throwing', async () => {
    const bridge = makeBridge();

    const result = await bridge.handle({
      protocol_version: WORKER_PROTOCOL_VERSION,
      type: 'proposed_command',
      frame_id: 'frame-1',
      task_id: 'task-1',
      seq: 0,
      command: 'npm test',
    });

    expect(result.ok).toBe(false);
    expect(result.disposition).toBe('invalid_frame');
    expect(result.errors?.some((error) => error.path === 'run_id')).toBe(true);
  });

  it('routes proposed_command through two-phase effects before execution', async () => {
    const runId = await createRunningRun();
    const exec = vi.fn(async () => ({ stdout: 'ok' }));
    const bridge = makeEffectBridge({ approvalDecision: 'approve', executor: exec });

    const result = await bridge.handle({
      ...frameBase(runId, 'proposed_command'),
      command: 'npm test -- worker',
      reason: 'verify task',
    });

    expect(result.ok).toBe(true);
    expect(result.effect?.kind).toBe('shell_command');
    expect(result.verdict?.decision).toBe('allow');
    expect(exec).toHaveBeenCalledTimes(1);

    const events = await eventLedger.byRun(runId);
    expect(events.map((event) => event.type)).toEqual([
      'run.created',
      'run.transitioned',
      'run.transitioned',
      'effect.proposed',
      'effect.policy_decided',
      'run.transitioned',
      'run.blocked',
      'effect.policy_decided',
      'run.transitioned',
      'tool.requested',
      'tool.executed',
      'effect.applied',
    ]);
  });

  it('blocks the run and does not execute when approval is denied', async () => {
    const runId = await createRunningRun();
    const exec = vi.fn(async () => ({ stdout: 'should-not-run' }));
    const bridge = makeEffectBridge({ approvalDecision: 'deny', executor: exec });

    const result = await bridge.handle({
      ...frameBase(runId, 'proposed_command'),
      command: 'npm test -- worker',
    });

    expect(result.ok).toBe(false);
    expect(result.disposition).toBe('effect_denied');
    expect(exec).not.toHaveBeenCalled();
    expect(runLedger.getRun(runId)?.status).toBe('blocked');

    const events = await eventLedger.byRun(runId);
    expect(events.some((event) => event.type === 'effect.denied')).toBe(true);
    expect(events.some((event) => event.type === 'tool.executed')).toBe(false);
  });

  it('routes proposed_patch as a file_edit effect', async () => {
    const runId = await createRunningRun();
    const patchExec = vi.fn(async () => ({ stdout: 'patched' }));
    const bridge = makeEffectBridge({ approvalDecision: 'approve', patchExecutor: patchExec });

    const result = await bridge.handle({
      ...frameBase(runId, 'proposed_patch'),
      patch: 'diff --git a/a.ts b/a.ts',
      files: ['a.ts'],
      summary: 'Update a.ts',
    });

    expect(result.ok).toBe(true);
    expect(result.effect?.kind).toBe('file_edit');
    expect(patchExec).toHaveBeenCalledTimes(1);

    const requested = (await eventLedger.byRun(runId)).find((event) => event.type === 'tool.requested');
    expect((requested as { tool?: string }).tool).toBe('apply_patch');
  });
});
