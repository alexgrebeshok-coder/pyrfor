// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { CodingSupervisorHost } from './coding-supervisor-host';
import type { WorkerProtocolBridgeResult } from './worker-protocol-bridge';

const frame = {
  protocol_version: 'wp.v2',
  type: 'heartbeat',
  frame_id: 'frame-1',
  task_id: 'task-1',
  run_id: 'run-1',
  seq: 1,
  status: 'working',
  message: 'still working',
};

describe('CodingSupervisorHost', () => {
  it('routes ACP worker_frame events into WorkerProtocolBridge', async () => {
    const result: WorkerProtocolBridgeResult = {
      ok: true,
      disposition: 'accepted',
      frame: frame as any,
    };
    const workerBridge = { handle: vi.fn(async () => result) };
    const onFrameResult = vi.fn();
    const host = new CodingSupervisorHost({ workerBridge: workerBridge as any, onFrameResult });

    const output = await host.handleAcpEvent({
      sessionId: 'session-1',
      type: 'worker_frame',
      data: frame,
      ts: 1,
    });

    expect(output).toBe(result);
    expect(workerBridge.handle).toHaveBeenCalledWith(frame);
    expect(onFrameResult).toHaveBeenCalledWith(result, 'acp');
  });

  it('routes FreeClaude worker_frame events into WorkerProtocolBridge', async () => {
    const result: WorkerProtocolBridgeResult = {
      ok: true,
      disposition: 'accepted',
      frame: frame as any,
    };
    const workerBridge = { handle: vi.fn(async () => result) };
    const host = new CodingSupervisorHost({ workerBridge: workerBridge as any });

    const output = await host.handleFreeClaudeEvent({
      type: 'worker_frame',
      frame: frame as any,
      raw: frame,
    });

    expect(output).toBe(result);
    expect(workerBridge.handle).toHaveBeenCalledWith(frame);
  });

  it('ignores non-worker telemetry events', async () => {
    const workerBridge = { handle: vi.fn() };
    const host = new CodingSupervisorHost({ workerBridge: workerBridge as any });

    await expect(host.handleAcpEvent({
      sessionId: 'session-1',
      type: 'plan',
      data: { content: 'plan' },
      ts: 1,
    })).resolves.toBeNull();

    await expect(host.handleFreeClaudeEvent({
      type: 'stderr',
      line: 'warning',
    })).resolves.toBeNull();

    expect(workerBridge.handle).not.toHaveBeenCalled();
  });
});
