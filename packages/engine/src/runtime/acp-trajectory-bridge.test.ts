// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAcpTrajectoryBridge,
  attachBridgeToSession,
} from './acp-trajectory-bridge.js';
import type { AcpTrajectoryBridgeOptions, BridgeRecorder } from './acp-trajectory-bridge.js';
import type { AcpEvent, AcpEventType, AcpSession, AcpStopReason } from './acp-client.js';
import type { GateDecision } from './quality-gate.js';
import type { ValidatorResult } from './step-validator.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkEvent(type: AcpEventType, data: unknown, sessionId = 's1', ts = Date.now()): AcpEvent {
  return { sessionId, type, data, ts };
}

function mkRecorder() {
  const records: unknown[] = [];
  const recorder: BridgeRecorder = {
    finish: vi.fn(async (rec) => records.push(rec)),
  };
  return { recorder, records };
}

function mkOpts(recorder: BridgeRecorder, extra?: Partial<AcpTrajectoryBridgeOptions>): AcpTrajectoryBridgeOptions {
  return {
    recorder,
    sessionId: 's1',
    userInput: 'build me a widget',
    agentName: 'freeclaude',
    ...extra,
  };
}

function mkGateDecision(action: GateDecision['action']): GateDecision {
  return {
    action,
    reason: 'test',
    results: [],
    attempt: 1,
    remainingPerEvent: 2,
    remainingPerSession: 9,
  };
}

function mkValidatorResult(verdict: ValidatorResult['verdict'] = 'pass'): ValidatorResult {
  return { validator: 'test', verdict, message: 'ok', durationMs: 1 };
}

// ── Mock AcpSession ───────────────────────────────────────────────────────────

function mkSession() {
  const queue: AcpEvent[] = [];
  let resolve: ((v: AcpEvent | undefined) => void) | null = null;
  return {
    id: 's1',
    cwd: '/project',
    push(ev: AcpEvent) {
      queue.push(ev);
      if (resolve) {
        resolve(ev);
        resolve = null;
      }
    },
    end() {
      if (resolve) {
        resolve(undefined);
        resolve = null;
      }
    },
    events: async function* () {
      while (true) {
        if (queue.length) {
          yield queue.shift()!;
        } else {
          const next = await new Promise<AcpEvent | undefined>((r) => {
            resolve = r;
          });
          if (!next) return;
          yield next;
        }
      }
    },
    prompt: vi.fn(),
    inject: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createAcpTrajectoryBridge', () => {
  // 1. creates bridge with provided recorder + sessionId
  it('creates bridge with provided recorder and sessionId', () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    expect(bridge).toBeDefined();
    expect(bridge.state().sessionId).toBe('s1');
    expect(bridge.state().finalised).toBe(false);
  });

  // 2. throws if recorder missing
  it('throws if recorder is missing', () => {
    expect(() =>
      createAcpTrajectoryBridge({ recorder: undefined as unknown as BridgeRecorder, sessionId: 's1', userInput: 'x', agentName: 'a' }),
    ).toThrow('recorder is required');
  });

  // 3. tool_call event opens a pending call (not yet in toolCalls)
  it('tool_call event opens a pending call', () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    bridge.recordEvent(mkEvent('tool_call', { id: 'tc1', name: 'readFile', kind: 'read', args: { path: '/a.ts' } }));
    expect(bridge.state().toolCalls).toHaveLength(0); // still pending
  });

  // 4. tool_call_update completed closes pending call into toolCalls
  it('tool_call_update completed closes pending call into toolCalls', () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    const ts = Date.now();
    bridge.recordEvent(mkEvent('tool_call', { id: 'tc1', name: 'readFile', kind: 'read', args: {} }, 's1', ts));
    bridge.recordEvent(mkEvent('tool_call_update', { id: 'tc1', status: 'completed', result: 'file contents' }, 's1', ts + 100));
    const calls = bridge.state().toolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('readFile');
    expect(calls[0].success).toBe(true);
    expect(calls[0].latencyMs).toBe(100);
    expect(calls[0].result).toBe('file contents');
  });

  // 5. tool_call_update failed marks success=false, error captured
  it('tool_call_update failed marks success=false and captures error', () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    bridge.recordEvent(mkEvent('tool_call', { id: 'tc2', name: 'writeFile', kind: 'edit', args: {} }));
    bridge.recordEvent(mkEvent('tool_call_update', { id: 'tc2', status: 'failed', error: 'permission denied' }));
    const calls = bridge.state().toolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0].success).toBe(false);
    expect(calls[0].errorMessage).toContain('permission denied');
  });

  // 6. diff event appended as synthetic call
  it('diff event appended as synthetic ToolCallRecord', () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    bridge.recordEvent(mkEvent('diff', { path: 'src/foo.ts', additions: 12, deletions: 3 }));
    const calls = bridge.state().toolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('diff');
    expect(calls[0].kind).toBe('edit');
    expect((calls[0].args as { path: string }).path).toBe('src/foo.ts');
    expect(calls[0].result).toBe('+12/-3');
  });

  // 7. terminal event appended
  it('terminal event appended as synthetic ToolCallRecord', () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    bridge.recordEvent(mkEvent('terminal', { command: 'npm test', output: 'PASS', exitCode: 0 }));
    const calls = bridge.state().toolCalls;
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('terminal');
    expect(calls[0].kind).toBe('execute');
    expect(calls[0].success).toBe(true);
    expect((calls[0].args as { command: string }).command).toBe('npm test');
  });

  // 8. plan event stored in metadata.plan
  it('plan event stores latest plan in finalized metadata', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    bridge.recordEvent(mkEvent('plan', { steps: ['step1', 'step2'] }));
    await bridge.finalize('end_turn');
    const call = (recorder.finish as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.metadata.plan).toEqual({ steps: ['step1', 'step2'] });
  });

  // 9. agent_message_chunk accumulates text
  it('agent_message_chunk accumulates into finalAnswer', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    bridge.recordEvent(mkEvent('agent_message_chunk', { text: 'hello ' }));
    bridge.recordEvent(mkEvent('agent_message_chunk', { text: 'world' }));
    await bridge.finalize('end_turn');
    const call = (recorder.finish as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.finalAnswer).toBe('hello world');
  });

  // 10. unknown event ignored (no throw)
  it('unknown event type is silently ignored', () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    // 'thought' is a valid AcpEventType but the bridge ignores it
    expect(() => bridge.recordEvent(mkEvent('thought' as AcpEventType, { text: 'hmm' }))).not.toThrow();
    expect(bridge.state().toolCalls).toHaveLength(0);
  });

  // 11. recordValidation increments validatorEvents
  it('recordValidation increments validatorEvents counter', () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    expect(bridge.state().validatorEvents).toBe(0);
    bridge.recordValidation('ev1', [mkValidatorResult('pass')]);
    bridge.recordValidation('ev2', [mkValidatorResult('warn'), mkValidatorResult('block')]);
    expect(bridge.state().validatorEvents).toBe(2);
  });

  // 12. recordGateDecision increments corrections and blocks counters
  it('recordGateDecision increments corrections and blocks independently', () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    bridge.recordGateDecision(mkGateDecision('inject_correction'));
    bridge.recordGateDecision(mkGateDecision('inject_correction'));
    bridge.recordGateDecision(mkGateDecision('block'));
    expect(bridge.state().corrections).toBe(2);
    expect(bridge.state().blocks).toBe(1);
  });

  // 13. gateDecisions metadata capped at 50
  it('gateDecisions metadata is capped at 50 entries', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    for (let i = 0; i < 60; i++) {
      bridge.recordGateDecision(mkGateDecision('continue'));
    }
    await bridge.finalize('end_turn');
    const call = (recorder.finish as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect((call.metadata.gateDecisions as unknown[]).length).toBe(50);
  });

  // 14. recordInjection appended; cap at 50
  it('recordInjection appends entries and caps at 50', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    for (let i = 0; i < 60; i++) {
      bridge.recordInjection(`inject ${i}`, i);
    }
    await bridge.finalize('end_turn');
    const call = (recorder.finish as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const injections = call.metadata.injections as Array<{ text: string; attempt: number }>;
    expect(injections.length).toBe(50);
    // Oldest entries are dropped; most recent 50 remain
    expect(injections[49].attempt).toBe(59);
  });

  // 15. finalize end_turn → success=true, finalAnswer from accumulated text
  it('finalize with end_turn sets success=true and uses accumulated text', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    bridge.recordEvent(mkEvent('agent_message_chunk', { text: 'Done!' }));
    await bridge.finalize('end_turn');
    const call = (recorder.finish as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.success).toBe(true);
    expect(call.finalAnswer).toBe('Done!');
    expect(call.stopReason).toBe('end_turn');
  });

  // 16. finalize cancelled → success=false
  it('finalize with cancelled sets success=false', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    await bridge.finalize('cancelled');
    const call = (recorder.finish as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.success).toBe(false);
  });

  // 17. finalize closes still-pending tool calls as abandoned
  it('finalize closes still-pending tool calls with success=false/abandoned', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    bridge.recordEvent(mkEvent('tool_call', { id: 'tc-lost', name: 'runTests', kind: 'execute', args: {} }));
    await bridge.finalize('end_turn');
    const call = (recorder.finish as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const toolCalls = call.toolCalls as Array<{ name: string; success: boolean; errorMessage: string }>;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('runTests');
    expect(toolCalls[0].success).toBe(false);
    expect(toolCalls[0].errorMessage).toBe('abandoned');
  });

  // 18. finalize is idempotent — second call is a no-op
  it('finalize is idempotent: second call does nothing', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    await bridge.finalize('end_turn');
    await bridge.finalize('end_turn');
    expect((recorder.finish as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  // 19. recordEvent after finalize is ignored
  it('recordEvent after finalize is silently ignored', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    await bridge.finalize('end_turn');
    bridge.recordEvent(mkEvent('diff', { path: 'late.ts', additions: 1, deletions: 0 }));
    expect(bridge.state().toolCalls).toHaveLength(0);
  });

  // 20. abort calls finalize with cancelled and includes abortReason in metadata
  it('abort finalises with cancelled and includes abortReason in metadata', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    await bridge.abort('supervisor override');
    const call = (recorder.finish as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.stopReason).toBe('cancelled');
    expect(call.metadata.abortReason).toBe('supervisor override');
    expect(bridge.state().finalised).toBe(true);
  });

  // 21. attachBridgeToSession pipes events from session.events() iterator
  it('attachBridgeToSession pipes events into bridge.recordEvent', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    const session = mkSession();

    // Pre-populate the queue BEFORE attaching so the consumer drains them via
    // the synchronous `if (queue.length)` branch — avoids the double-yield
    // that occurs when push() both enqueues AND resolves a waiting promise.
    session.push(mkEvent('diff', { path: 'index.ts', additions: 5, deletions: 0 }));
    session.push(mkEvent('agent_message_chunk', { text: 'all done' }));

    attachBridgeToSession(session as unknown as AcpSession, bridge);

    // Let the consume loop drain the pre-populated queue.
    await new Promise((r) => setTimeout(r, 20));

    // Now the consumer is waiting at the else-branch; calling end() terminates it.
    session.end();

    // Wait for auto-finalise (capped at 500 ms to keep tests fast).
    await new Promise<void>((resolve) => {
      const deadline = Date.now() + 500;
      const interval = setInterval(() => {
        if (bridge.state().finalised || Date.now() > deadline) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    expect(bridge.state().finalised).toBe(true);
    const call = (recorder.finish as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.finalAnswer).toBe('all done');
    expect((call.toolCalls as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  // 22. disposer auto-finalises if not already finalised
  it('disposer auto-finalises the bridge with end_turn if not already done', async () => {
    const { recorder } = mkRecorder();
    const bridge = createAcpTrajectoryBridge(mkOpts(recorder));
    const session = mkSession();

    // Pre-populate before attaching to avoid double-yield in the mock.
    session.push(mkEvent('agent_message_chunk', { text: 'partial' }));

    const dispose = attachBridgeToSession(session as unknown as AcpSession, bridge);

    // Give the consume loop time to drain the pre-populated queue.
    await new Promise((r) => setTimeout(r, 20));

    expect(bridge.state().finalised).toBe(false);

    await dispose();

    expect(bridge.state().finalised).toBe(true);
    const call = (recorder.finish as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.stopReason).toBe('end_turn');
    expect(call.finalAnswer).toBe('partial');
  });
});
