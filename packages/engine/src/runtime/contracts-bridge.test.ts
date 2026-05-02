// @vitest-environment node
/**
 * contracts-bridge.test.ts — Integration tests for ContractsBridge.
 *
 * Uses real PermissionEngine, EventLedger (file-backed), and RunLifecycle
 * instances to validate the full contract-enforcement pipeline.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  ContractsBridge,
  makeInvocationId,
  summarizeArgs,
  type ToolInvocation,
  type ToolExecutor,
  type ToolInvocationResult,
} from './contracts-bridge';
import {
  PermissionEngine,
  ToolRegistry,
  registerStandardTools,
} from './permission-engine';
import { EventLedger } from './event-ledger';
import { RunLifecycle, InvalidTransitionError } from './run-lifecycle';

// ===== Test helpers ==========================================================

function tmpLedgerPath(): string {
  const hex = randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `bridge-test-${hex}`, 'ledger.jsonl');
}

function makeRegistry(): ToolRegistry {
  const r = new ToolRegistry();
  registerStandardTools(r);
  return r;
}

const ALLOWED_INV: ToolInvocation = {
  runId: 'run-test',
  toolName: 'read_file', // auto_allow
  args: { path: '/test/file.txt' },
};

const ASK_INV: ToolInvocation = {
  runId: 'run-test',
  toolName: 'write_file', // ask_once (no prior approval)
  args: { path: '/out/file.txt', content: 'hello' },
};

const DENY_INV: ToolInvocation = {
  runId: 'run-test',
  toolName: 'delete_file', // ask_every_time by default; override to deny in some tests
  args: { path: '/danger' },
};

const NOOP_EXEC: ToolExecutor = async () => undefined;
const OK_EXEC: ToolExecutor = async () => 'result-value';

// ===== Suite =================================================================

describe('ContractsBridge', () => {
  let ledgerPath: string;
  let ledger: EventLedger;
  let registry: ToolRegistry;
  let engine: PermissionEngine;
  let lifecycle: RunLifecycle;
  let bridge: ContractsBridge;

  beforeEach(() => {
    ledgerPath = tmpLedgerPath();
    ledger = new EventLedger(ledgerPath);
    registry = makeRegistry();
    engine = new PermissionEngine(registry);
    lifecycle = new RunLifecycle({ workspace_id: 'w', repo_id: 'r', mode: 'autonomous' });
    bridge = new ContractsBridge({ permissionEngine: engine, ledger });
  });

  afterEach(async () => {
    try {
      await rm(path.dirname(ledgerPath), { recursive: true, force: true });
    } catch { /* best-effort */ }
    vi.restoreAllMocks();
  });

  // ── Permission: auto_allow ─────────────────────────────────────────────────

  describe('Permission — auto_allow', () => {
    it('passes the configured workspace/session context into PermissionEngine.check', async () => {
      const checkSpy = vi.spyOn(engine, 'check');
      const contextualBridge = new ContractsBridge({
        permissionEngine: engine,
        ledger,
        permissionContext: { workspaceId: 'workspace-real', sessionId: 'session-real' },
      });

      await contextualBridge.invoke(ALLOWED_INV, OK_EXEC);

      expect(checkSpy).toHaveBeenCalledWith(
        'read_file',
        { workspaceId: 'workspace-real', sessionId: 'session-real', runId: ALLOWED_INV.runId },
        ALLOWED_INV.args,
      );
    });

    it('returns ok=true and decision=auto_allow', async () => {
      const result = await bridge.invoke(ALLOWED_INV, OK_EXEC);
      expect(result.ok).toBe(true);
      expect(result.decision).toBe('auto_allow');
    });

    it('calls the executor and returns its output', async () => {
      const execSpy = vi.fn(async () => 'expected-output');
      const result = await bridge.invoke(ALLOWED_INV, execSpy);
      expect(execSpy).toHaveBeenCalledTimes(1);
      expect(result.output).toBe('expected-output');
    });

    it('emits tool.requested event before execution', async () => {
      await bridge.invoke(ALLOWED_INV, OK_EXEC);
      const events = await ledger.byRun(ALLOWED_INV.runId);
      const req = events.find((e) => e.type === 'tool.requested');
      expect(req).toBeDefined();
      expect((req as { tool?: string }).tool).toBe('read_file');
    });

    it('emits tool.executed event with status=ok after success', async () => {
      await bridge.invoke(ALLOWED_INV, OK_EXEC);
      const events = await ledger.byRun(ALLOWED_INV.runId);
      const exec = events.find((e) => e.type === 'tool.executed');
      expect(exec).toBeDefined();
      expect((exec as { status?: string }).status).toBe('ok');
    });

    it('tool.executed event carries run_id and tool fields', async () => {
      await bridge.invoke(ALLOWED_INV, OK_EXEC);
      const events = await ledger.byRun(ALLOWED_INV.runId);
      const exec = events.find((e) => e.type === 'tool.executed');
      expect(exec?.run_id).toBe(ALLOWED_INV.runId);
      expect((exec as { tool?: string }).tool).toBe('read_file');
    });

    it('durationMs is a non-negative number', async () => {
      const result = await bridge.invoke(ALLOWED_INV, OK_EXEC);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Permission: policy deny ────────────────────────────────────────────────

  describe('Permission — policy deny', () => {
    let denyBridge: ContractsBridge;
    const denyInv: ToolInvocation = {
      runId: 'run-deny',
      toolName: 'blocked_tool',
      args: {},
    };

    beforeEach(() => {
      // Register a tool overridden to 'deny' via engine options
      registry.register({
        name: 'blocked_tool',
        description: 'test',
        inputSchema: {},
        outputSchema: {},
        sideEffect: 'read',
        defaultPermission: 'deny',
        timeoutMs: 5000,
        idempotent: true,
        requiresApproval: false,
      });
      const denyEngine = new PermissionEngine(registry);
      denyBridge = new ContractsBridge({ permissionEngine: denyEngine, ledger });
    });

    it('returns ok=false and decision=denied_pre', async () => {
      const result = await denyBridge.invoke(denyInv, OK_EXEC);
      expect(result.ok).toBe(false);
      expect(result.decision).toBe('denied_pre');
    });

    it('does NOT call the executor', async () => {
      const execSpy = vi.fn(async () => 'should-not-run');
      await denyBridge.invoke(denyInv, execSpy);
      expect(execSpy).not.toHaveBeenCalled();
    });

    it('emits tool.denied event with reason=policy', async () => {
      await denyBridge.invoke(denyInv, OK_EXEC);
      const events = await ledger.byRun(denyInv.runId);
      const denied = events.find((e) => e.type === 'tool.denied');
      expect(denied).toBeDefined();
      expect((denied as { reason?: string }).reason).toBe('policy');
    });

    it('returns durationMs=0', async () => {
      const result = await denyBridge.invoke(denyInv, OK_EXEC);
      expect(result.durationMs).toBe(0);
    });

    it('unknown tool (not registered) also results in denied_pre', async () => {
      const result = await bridge.invoke(
        { runId: 'run-x', toolName: 'nonexistent_tool', args: {} },
        OK_EXEC,
      );
      expect(result.ok).toBe(false);
      expect(result.decision).toBe('denied_pre');
    });
  });

  // ── Permission: ask ────────────────────────────────────────────────────────

  describe('Permission — ask', () => {
    it('user approves → ok=true and decision=allow', async () => {
      const askBridge = new ContractsBridge({
        permissionEngine: engine,
        ledger,
        onAskPermission: async () => 'allow',
      });
      const result = await askBridge.invoke(ASK_INV, OK_EXEC);
      expect(result.ok).toBe(true);
      expect(result.decision).toBe('allow');
    });

    it('user approves → executor is called and tool.requested is emitted', async () => {
      const execSpy = vi.fn(async () => 'done');
      const askBridge = new ContractsBridge({
        permissionEngine: engine,
        ledger,
        onAskPermission: async () => 'allow',
      });
      await askBridge.invoke(ASK_INV, execSpy);
      expect(execSpy).toHaveBeenCalledTimes(1);
      const events = await ledger.byRun(ASK_INV.runId);
      expect(events.some((e) => e.type === 'tool.requested')).toBe(true);
    });

    it('user denies → ok=false and decision=denied_user', async () => {
      const askBridge = new ContractsBridge({
        permissionEngine: engine,
        ledger,
        onAskPermission: async () => 'deny',
      });
      const result = await askBridge.invoke(ASK_INV, OK_EXEC);
      expect(result.ok).toBe(false);
      expect(result.decision).toBe('denied_user');
    });

    it('user denies → tool.denied event emitted with reason=user_denied', async () => {
      const askBridge = new ContractsBridge({
        permissionEngine: engine,
        ledger,
        onAskPermission: async () => 'deny',
      });
      await askBridge.invoke(ASK_INV, OK_EXEC);
      const events = await ledger.byRun(ASK_INV.runId);
      const denied = events.find((e) => e.type === 'tool.denied');
      expect(denied).toBeDefined();
      expect((denied as { reason?: string }).reason).toBe('user_denied');
    });

    it('default onAskPermission denies (denied_user)', async () => {
      // bridge created without onAskPermission → default is deny
      const result = await bridge.invoke(ASK_INV, OK_EXEC);
      expect(result.ok).toBe(false);
      expect(result.decision).toBe('denied_user');
    });
  });

  // ── Executor errors ────────────────────────────────────────────────────────

  describe('Executor errors', () => {
    it('executor throws → ok=false', async () => {
      const result = await bridge.invoke(ALLOWED_INV, async () => {
        throw new Error('boom');
      });
      expect(result.ok).toBe(false);
    });

    it('executor throws → error.message is populated', async () => {
      const result = await bridge.invoke(ALLOWED_INV, async () => {
        throw new Error('disk full');
      });
      expect(result.error?.message).toBe('disk full');
    });

    it('executor throws with code → error.code is preserved', async () => {
      const result = await bridge.invoke(ALLOWED_INV, async () => {
        const err = new Error('permission denied') as Error & { code: string };
        err.code = 'EACCES';
        throw err;
      });
      expect(result.error?.code).toBe('EACCES');
    });

    it('executor throws → tool.executed event emitted with status=error', async () => {
      await bridge.invoke(ALLOWED_INV, async () => {
        throw new Error('failure');
      });
      const events = await ledger.byRun(ALLOWED_INV.runId);
      const exec = events.find((e) => e.type === 'tool.executed');
      expect((exec as { status?: string }).status).toBe('error');
    });

    it('executor returns value → output equals that value', async () => {
      const result = await bridge.invoke(ALLOWED_INV, async () => ({ key: 42 }));
      expect(result.output).toEqual({ key: 42 });
    });
  });

  // ── Already-approved execution ─────────────────────────────────────────────

  describe('invokeApproved()', () => {
    it('executes without a PermissionEngine.check call', async () => {
      const checkSpy = vi.spyOn(engine, 'check');
      const execSpy = vi.fn(async () => 'approved-output');

      const result = await bridge.invokeApproved(ASK_INV, execSpy);

      expect(result.ok).toBe(true);
      expect(result.output).toBe('approved-output');
      expect(execSpy).toHaveBeenCalledTimes(1);
      expect(checkSpy).not.toHaveBeenCalled();
    });

    it('emits tool.requested and tool.executed for an approved invocation', async () => {
      await bridge.invokeApproved(ASK_INV, OK_EXEC);

      const events = await ledger.byRun(ASK_INV.runId);
      expect(events.map((event) => event.type)).toEqual(['tool.requested', 'tool.executed']);
    });

    it('preserves execution errors for approved invocations', async () => {
      const result = await bridge.invokeApproved(ASK_INV, async () => {
        throw Object.assign(new Error('failed'), { code: 'E_TEST' });
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({ message: 'failed', code: 'E_TEST' });
      const events = await ledger.byRun(ASK_INV.runId);
      const executed = events.find((event) => event.type === 'tool.executed');
      expect((executed as { status?: string }).status).toBe('error');
    });
  });

  // ── Timeout and AbortSignal ────────────────────────────────────────────────

  describe('Timeout and AbortSignal', () => {
    it('executor exceeds timeout → ok=false and error.code=timeout', async () => {
      const slowBridge = new ContractsBridge({
        permissionEngine: engine,
        ledger,
        defaultTimeoutMs: 40,
      });
      const result = await slowBridge.invoke(
        ALLOWED_INV,
        (_inv, ctx) =>
          new Promise<never>((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => {
              reject(new Error('executor aborted'));
            });
            // Never resolves on its own within the timeout window
          }),
      );
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('timeout');
    }, 5_000);

    it('timeout → tool.executed emitted with error indicating timeout', async () => {
      const slowBridge = new ContractsBridge({
        permissionEngine: engine,
        ledger,
        defaultTimeoutMs: 40,
      });
      await slowBridge.invoke(
        ALLOWED_INV,
        (_inv, ctx) =>
          new Promise<never>((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const events = await ledger.byRun(ALLOWED_INV.runId);
      const exec = events.find((e) => e.type === 'tool.executed');
      expect(exec).toBeDefined();
      expect((exec as { status?: string }).status).toBe('error');
      const errStr = (exec as { error?: string }).error ?? '';
      expect(errStr).toMatch(/timeout/i);
    }, 5_000);

    it('timeout → AbortSignal given to executor is aborted', async () => {
      const slowBridge = new ContractsBridge({
        permissionEngine: engine,
        ledger,
        defaultTimeoutMs: 40,
      });
      let capturedSignal: AbortSignal | undefined;
      await slowBridge.invoke(
        ALLOWED_INV,
        (_inv, ctx) => {
          capturedSignal = ctx.signal;
          return new Promise<never>((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
          });
        },
      );
      expect(capturedSignal?.aborted).toBe(true);
    }, 5_000);

    it('per-invocation timeoutMs override is respected', async () => {
      const result = await bridge.invoke(
        ALLOWED_INV,
        (_inv, ctx) =>
          new Promise<never>((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
        { timeoutMs: 30 },
      );
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('timeout');
    }, 5_000);

    it('pre-aborted caller signal → executor receives an already-aborted signal', async () => {
      const ac = new AbortController();
      ac.abort('pre-aborted');

      let capturedSignal: AbortSignal | undefined;
      await bridge.invoke(
        ALLOWED_INV,
        (_inv, ctx) => {
          capturedSignal = ctx.signal;
          // Executor checks signal and throws immediately
          throw Object.assign(new Error('aborted'), { code: 'abort' });
        },
        { signal: ac.signal },
      );
      expect(capturedSignal?.aborted).toBe(true);
    });
  });

  // ── Ledger resilience ──────────────────────────────────────────────────────

  describe('Ledger resilience', () => {
    it('ledger.append throws → bridge does not throw; returns result normally', async () => {
      vi.spyOn(ledger, 'append').mockRejectedValue(new Error('disk full'));
      const result = await bridge.invoke(ALLOWED_INV, OK_EXEC);
      // Bridge should still complete without throwing
      expect(result.ok).toBe(true);
    });

    it('ledger.append throws → console.warn is called', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(ledger, 'append').mockRejectedValue(new Error('write error'));
      await bridge.invoke(ALLOWED_INV, OK_EXEC);
      expect(warnSpy).toHaveBeenCalled();
      const warnMsg: string = warnSpy.mock.calls[0]?.[0] ?? '';
      expect(warnMsg).toContain('[ContractsBridge]');
    });
  });

  // ── Lifecycle markers ──────────────────────────────────────────────────────

  describe('Lifecycle markers', () => {
    it('markRunStarted: no-op when lifecycle absent', async () => {
      // bridge created without lifecycle
      await expect(bridge.markRunStarted('run-noop')).resolves.toBeUndefined();
    });

    it('markRunCompleted: no-op when lifecycle absent', async () => {
      await expect(bridge.markRunCompleted('run-noop')).resolves.toBeUndefined();
    });

    it('markRunFailed: no-op when lifecycle absent', async () => {
      await expect(
        bridge.markRunFailed('run-noop', { message: 'oops' }),
      ).resolves.toBeUndefined();
    });

    it('markRunStarted: lifecycle present → completes without error', async () => {
      const lb = new ContractsBridge({ permissionEngine: engine, ledger, lifecycle });
      await expect(lb.markRunStarted('run-A')).resolves.toBeUndefined();
    });

    it('markRunCompleted: after markRunStarted → completes without error', async () => {
      const lb = new ContractsBridge({ permissionEngine: engine, ledger, lifecycle });
      await lb.markRunStarted('run-B');
      await expect(lb.markRunCompleted('run-B')).resolves.toBeUndefined();
    });

    it('markRunFailed: after markRunStarted → completes without error', async () => {
      const lb = new ContractsBridge({ permissionEngine: engine, ledger, lifecycle });
      await lb.markRunStarted('run-C');
      await expect(
        lb.markRunFailed('run-C', { message: 'crashed', code: 'ERR_CRASH' }),
      ).resolves.toBeUndefined();
    });

    it('double-complete → throws InvalidTransitionError', async () => {
      const lb = new ContractsBridge({ permissionEngine: engine, ledger, lifecycle });
      await lb.markRunStarted('run-D');
      await lb.markRunCompleted('run-D');
      await expect(lb.markRunCompleted('run-D')).rejects.toBeInstanceOf(
        InvalidTransitionError,
      );
    });
  });

  // ── Pure helpers ───────────────────────────────────────────────────────────

  describe('makeInvocationId', () => {
    it('returns runId:toolName:seq format', () => {
      expect(makeInvocationId('r1', 'read_file', 0)).toBe('r1:read_file:0');
    });

    it('is deterministic for the same inputs', () => {
      expect(makeInvocationId('r1', 'write_file', 7)).toBe(
        makeInvocationId('r1', 'write_file', 7),
      );
    });

    it('different seq values produce different ids', () => {
      expect(makeInvocationId('r1', 'read_file', 0)).not.toBe(
        makeInvocationId('r1', 'read_file', 1),
      );
    });
  });

  describe('summarizeArgs', () => {
    it('short args are returned verbatim', () => {
      const args = { x: 1 };
      expect(summarizeArgs(args)).toBe(JSON.stringify(args));
    });

    it('args exactly at maxLen are returned without truncation', () => {
      const s = 'a'.repeat(190);
      const args = { k: s };
      const raw = JSON.stringify(args);
      expect(summarizeArgs(args, raw.length)).toBe(raw);
    });

    it('long args are truncated with ellipsis suffix', () => {
      const args = { data: 'x'.repeat(300) };
      const result = summarizeArgs(args, 200);
      expect(result.length).toBe(201); // 200 chars + '…'
      expect(result.endsWith('\u2026')).toBe(true);
    });

    it('custom maxLen is respected', () => {
      const args = { a: '12345' };
      const result = summarizeArgs(args, 5);
      expect(result.length).toBe(6); // 5 + '…'
    });

    it('circular reference produces "[Circular]" instead of throwing', () => {
      const args: Record<string, unknown> = {};
      args['self'] = args;
      const result = summarizeArgs(args);
      expect(result).toContain('[Circular]');
    });

    it('empty args returns "{}"', () => {
      expect(summarizeArgs({})).toBe('{}');
    });
  });

  // ── Integration: sequential invocations ───────────────────────────────────

  describe('Integration — sequential invocations', () => {
    it('3 invocations produce the correct ordered sequence of ledger events', async () => {
      const runId = 'seq-run';

      // inv1: read_file (auto_allow) → success
      const inv1: ToolInvocation = { runId, toolName: 'read_file', args: { path: '/a' } };
      const r1 = await bridge.invoke(inv1, async () => 'file-a');

      // inv2: read_file (auto_allow) → success
      const inv2: ToolInvocation = { runId, toolName: 'read_file', args: { path: '/b' } };
      const r2 = await bridge.invoke(inv2, async () => 'file-b');

      // inv3: write_file (ask_once, no prior approval) → denied by default handler
      const inv3: ToolInvocation = {
        runId,
        toolName: 'write_file',
        args: { path: '/out', content: 'data' },
      };
      const r3 = await bridge.invoke(inv3, async () => 'written');

      expect(r1.ok).toBe(true);
      expect(r1.decision).toBe('auto_allow');
      expect(r2.ok).toBe(true);
      expect(r2.decision).toBe('auto_allow');
      expect(r3.ok).toBe(false);
      expect(r3.decision).toBe('denied_user');

      // Expected event sequence:
      // [0] tool.requested  (inv1)
      // [1] tool.executed   (inv1 ok)
      // [2] tool.requested  (inv2)
      // [3] tool.executed   (inv2 ok)
      // [4] tool.denied     (inv3 user_denied)
      const events = await ledger.byRun(runId);
      expect(events).toHaveLength(5);
      expect(events[0].type).toBe('tool.requested');
      expect(events[1].type).toBe('tool.executed');
      expect(events[2].type).toBe('tool.requested');
      expect(events[3].type).toBe('tool.executed');
      expect(events[4].type).toBe('tool.denied');
    });

    it('ledger events have strictly ascending seq numbers', async () => {
      const runId = 'seq-order';
      await bridge.invoke({ runId, toolName: 'read_file', args: {} }, async () => 'a');
      await bridge.invoke({ runId, toolName: 'read_file', args: {} }, async () => 'b');
      const events = await ledger.byRun(runId);
      for (let i = 1; i < events.length; i++) {
        expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
      }
    });

    it('ledger.byRun returns only events for the given runId', async () => {
      const runA = 'run-alpha';
      const runB = 'run-beta';
      await bridge.invoke({ runId: runA, toolName: 'read_file', args: {} }, OK_EXEC);
      await bridge.invoke({ runId: runB, toolName: 'read_file', args: {} }, OK_EXEC);
      const eventsA = await ledger.byRun(runA);
      const eventsB = await ledger.byRun(runB);
      expect(eventsA.every((e) => e.run_id === runA)).toBe(true);
      expect(eventsB.every((e) => e.run_id === runB)).toBe(true);
      expect(eventsA.length).toBeGreaterThan(0);
      expect(eventsB.length).toBeGreaterThan(0);
    });
  });
});
