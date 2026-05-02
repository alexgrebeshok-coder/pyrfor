// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { EventLedger } from './event-ledger';
import {
  PermissionEngine,
  ToolRegistry,
  registerStandardTools,
} from './permission-engine';
import { TwoPhaseEffectRunner } from './two-phase-effect';

function tmpLedgerPath(): string {
  const hex = randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `two-phase-effect-test-${hex}`, 'events.jsonl');
}

describe('TwoPhaseEffectRunner', () => {
  let ledgerPath: string;
  let ledger: EventLedger;
  let registry: ToolRegistry;
  let permissionEngine: PermissionEngine;
  let runner: TwoPhaseEffectRunner;

  beforeEach(() => {
    ledgerPath = tmpLedgerPath();
    ledger = new EventLedger(ledgerPath);
    registry = new ToolRegistry();
    registerStandardTools(registry);
    permissionEngine = new PermissionEngine(registry);
    runner = new TwoPhaseEffectRunner({
      ledger,
      permissionEngine,
      permissionContext: { workspaceId: 'ws-1', sessionId: 'session-1' },
    });
  });

  afterEach(async () => {
    await ledger.close();
    await rm(path.dirname(ledgerPath), { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('proposes an effect and appends effect.proposed', async () => {
    const effect = await runner.propose({
      run_id: 'run-1',
      kind: 'tool_call',
      toolName: 'read_file',
      payload: { path: 'README.md' },
      preview: 'Read README.md',
      idempotency_key: 'read:README.md',
    });

    expect(effect.status).toBe('proposed');
    const events = await ledger.byRun('run-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'effect.proposed',
      effect_id: effect.effect_id,
      effect_kind: 'tool_call',
      tool: 'read_file',
      preview: 'Read README.md',
      idempotency_key: 'read:README.md',
    });
  });

  it('decides policy through PermissionEngine and appends verdict', async () => {
    const effect = await runner.propose({
      run_id: 'run-1',
      kind: 'tool_call',
      toolName: 'read_file',
      payload: { path: 'README.md' },
      preview: 'Read README.md',
    });

    const verdict = await runner.decide(effect);

    expect(verdict).toMatchObject({
      decision: 'allow',
      policy_id: 'permission:auto_allow',
      approval_required: false,
    });
    const events = await ledger.byRun('run-1');
    expect(events.map((event) => event.type)).toEqual(['effect.proposed', 'effect.policy_decided']);
  });

  it('applies only allowed effects through the host executor', async () => {
    const effect = await runner.propose({
      run_id: 'run-1',
      kind: 'tool_call',
      toolName: 'read_file',
      payload: { path: 'README.md' },
      preview: 'Read README.md',
    });
    const executor = vi.fn(async () => ({ output: 'content', rollback_handle: 'noop' }));

    const result = await runner.apply(effect, executor);

    expect(result.ok).toBe(true);
    expect(result.effect.status).toBe('applied');
    expect(result.output).toBe('content');
    expect(result.rollback_handle).toBe('noop');
    expect(executor).toHaveBeenCalledTimes(1);

    const events = await ledger.byRun('run-1');
    expect(events.map((event) => event.type)).toEqual([
      'effect.proposed',
      'effect.policy_decided',
      'effect.applied',
    ]);
  });

  it('does not apply effects that require approval without explicit approval', async () => {
    const effect = await runner.propose({
      run_id: 'run-1',
      kind: 'shell_command',
      payload: { command: 'npm test' },
      preview: 'Run npm test',
    });
    const executor = vi.fn(async () => ({ output: 'should-not-run' }));

    const result = await runner.apply(effect, executor);

    expect(result.ok).toBe(false);
    expect(result.effect.status).toBe('denied');
    expect(result.verdict.decision).toBe('ask');
    expect(executor).not.toHaveBeenCalled();

    const events = await ledger.byRun('run-1');
    expect(events.map((event) => event.type)).toEqual([
      'effect.proposed',
      'effect.policy_decided',
      'effect.denied',
    ]);
  });

  it('can apply an approval-required effect after explicit host approval', async () => {
    const effect = await runner.propose({
      run_id: 'run-1',
      kind: 'shell_command',
      payload: { command: 'npm test' },
      preview: 'Run npm test',
    });
    const verdict = await runner.approve(effect, 'tester');
    const executor = vi.fn(async () => ({ output: 'ok' }));

    const result = await runner.apply(effect, executor, { verdict });

    expect(result.ok).toBe(true);
    expect(result.effect.status).toBe('applied');
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('records failed executor results without throwing', async () => {
    const effect = await runner.propose({
      run_id: 'run-1',
      kind: 'tool_call',
      toolName: 'read_file',
      payload: { path: 'README.md' },
      preview: 'Read README.md',
    });

    const result = await runner.apply(effect, async () => {
      throw new Error('disk failed');
    });

    expect(result.ok).toBe(false);
    expect(result.effect.status).toBe('failed');
    expect(result.error?.message).toBe('disk failed');
    const events = await ledger.byRun('run-1');
    expect(events.some((event) => event.type === 'effect.failed')).toBe(true);
  });
});
