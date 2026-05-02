import { describe, it, expect } from 'vitest';

import {
  WORKER_PROTOCOL_VERSION,
  WorkerProtocolValidationError,
  isWorkerFrame,
  parseWorkerFrame,
  validateWorkerFrame,
  type WorkerFrame,
} from './worker-protocol';

function base(overrides: Partial<WorkerFrame> & { type: WorkerFrame['type'] }): Record<string, unknown> {
  return {
    protocol_version: WORKER_PROTOCOL_VERSION,
    frame_id: 'frame-1',
    task_id: 'task-1',
    run_id: 'run-1',
    seq: 0,
    ...overrides,
  };
}

describe('worker protocol v2', () => {
  it('accepts a valid heartbeat frame', () => {
    const result = validateWorkerFrame(base({
      type: 'heartbeat',
      state: 'executing',
      progress: 0.5,
      message: 'working',
    }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frame.type).toBe('heartbeat');
  });

  it('rejects unsupported protocol versions', () => {
    const result = validateWorkerFrame(base({
      protocol_version: 'wp.v1',
      type: 'heartbeat',
    } as Partial<WorkerFrame> & { type: WorkerFrame['type'] }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        path: 'protocol_version',
        message: 'must be wp.v2',
      });
    }
  });

  it('rejects unknown frame types', () => {
    const result = validateWorkerFrame({
      protocol_version: WORKER_PROTOCOL_VERSION,
      type: 'do_anything',
      frame_id: 'frame-1',
      task_id: 'task-1',
      run_id: 'run-1',
      seq: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((err) => err.path === 'type')).toBe(true);
  });

  it('validates proposed_patch required fields', () => {
    const result = validateWorkerFrame(base({
      type: 'proposed_patch',
      patch: 'diff --git a/a.ts b/a.ts',
      files: ['a.ts'],
    }));

    expect(result.ok).toBe(true);
  });

  it('rejects proposed_patch without changed files', () => {
    const result = validateWorkerFrame(base({
      type: 'proposed_patch',
      patch: 'diff --git a/a.ts b/a.ts',
      files: [],
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((err) => err.path === 'files')).toBe(true);
  });

  it('validates proposed_command required fields', () => {
    const frame = parseWorkerFrame(base({
      type: 'proposed_command',
      command: 'npm test -- worker',
      reason: 'run targeted verification',
    }));

    expect(frame.type).toBe('proposed_command');
    if (frame.type === 'proposed_command') expect(frame.command).toBe('npm test -- worker');
  });

  it('validates final_report terminal shape', () => {
    const result = validateWorkerFrame(base({
      type: 'final_report',
      status: 'succeeded',
      summary: 'Implemented the requested change.',
      verification: { status: 'passed' },
    }));

    expect(result.ok).toBe(true);
  });

  it('validates failure_report error shape', () => {
    const result = validateWorkerFrame(base({
      type: 'failure_report',
      status: 'failed',
      error: { code: 'VERIFICATION_FAILED', message: 'Tests failed', retryable: true },
      resume_token: 'resume-1',
    }));

    expect(result.ok).toBe(true);
  });

  it('throws WorkerProtocolValidationError from parseWorkerFrame', () => {
    expect(() => parseWorkerFrame(base({
      type: 'failure_report',
      status: 'failed',
      error: { code: 'E' },
    } as Partial<WorkerFrame> & { type: WorkerFrame['type'] }))).toThrow(WorkerProtocolValidationError);
  });

  it('narrows with isWorkerFrame', () => {
    const frame = base({ type: 'checkpoint', checkpoint_id: 'cp-1' });

    expect(isWorkerFrame(frame)).toBe(true);
    if (isWorkerFrame(frame)) expect(frame.type).toBe('checkpoint');
  });
});
