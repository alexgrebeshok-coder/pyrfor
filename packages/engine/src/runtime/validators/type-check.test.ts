// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createTypeCheckValidator } from './type-check.js';
import type { AcpEvent } from '../acp-client.js';
import type { ValidatorContext } from '../step-validator.js';

const mkEditEvt = (extra: Record<string, unknown> = {}): AcpEvent => ({
  sessionId: 's1',
  type: 'tool_call',
  data: { kind: 'edit', path: '/src/foo.ts', ...extra },
  ts: Date.now(),
});

const mkDiffEvt = (): AcpEvent => ({
  sessionId: 's1',
  type: 'diff',
  data: { added: 5, removed: 2 },
  ts: Date.now(),
});

const ctx: ValidatorContext = { cwd: process.cwd() };

describe('createTypeCheckValidator', () => {
  it('pass when command exits 0', async () => {
    const v = createTypeCheckValidator({ command: 'true' });
    const result = await v.validate(mkEditEvt(), ctx);
    expect(result.verdict).toBe('pass');
    expect(result.validator).toBe('type-check');
  });

  it('block when command exits non-zero', async () => {
    const v = createTypeCheckValidator({ command: 'false' });
    const result = await v.validate(mkEditEvt(), ctx);
    expect(result.verdict).toBe('block');
    expect(result.remediation).toBeDefined();
    expect(result.details?.exitCode).not.toBe(0);
  });

  it('respects timeout — times out and throws (caught as warn in runValidators)', async () => {
    const v = createTypeCheckValidator({ command: 'sleep 10', timeoutMs: 50 });
    await expect(v.validate(mkEditEvt(), ctx)).rejects.toThrow(/timed out/i);
  });

  it('appliesTo: returns true for tool_call with kind=edit', () => {
    const v = createTypeCheckValidator();
    expect(v.appliesTo(mkEditEvt())).toBe(true);
  });

  it('appliesTo: returns false for diff event', () => {
    const v = createTypeCheckValidator();
    expect(v.appliesTo(mkDiffEvt())).toBe(false);
  });

  it('appliesTo: respects custom appliesToKinds', () => {
    const v = createTypeCheckValidator({ appliesToKinds: ['delete'] });
    const deleteEvt: AcpEvent = {
      sessionId: 's1',
      type: 'tool_call',
      data: { kind: 'delete', path: '/src/foo.ts' },
      ts: Date.now(),
    };
    expect(v.appliesTo(deleteEvt)).toBe(true);
    expect(v.appliesTo(mkEditEvt())).toBe(false);
  });
});
