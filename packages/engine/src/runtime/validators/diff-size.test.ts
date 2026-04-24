// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createDiffSizeValidator } from './diff-size.js';
import type { AcpEvent } from '../acp-client.js';
import type { ValidatorContext } from '../step-validator.js';

const mkDiffEvt = (data: unknown): AcpEvent => ({
  sessionId: 's1',
  type: 'diff',
  data,
  ts: Date.now(),
});

const mkToolEvt = (): AcpEvent => ({
  sessionId: 's1',
  type: 'tool_call',
  data: { kind: 'edit' },
  ts: Date.now(),
});

const ctx: ValidatorContext = { cwd: process.cwd() };

describe('createDiffSizeValidator', () => {
  it('pass when total lines < warnLines (numeric shape)', async () => {
    const v = createDiffSizeValidator({ warnLines: 100, blockLines: 500 });
    const result = await v.validate(mkDiffEvt({ added: 20, removed: 10 }), ctx);
    expect(result.verdict).toBe('pass');
    expect(result.validator).toBe('diff-size');
  });

  it('warn when total lines in [warnLines, blockLines)', async () => {
    const v = createDiffSizeValidator({ warnLines: 100, blockLines: 500 });
    const result = await v.validate(mkDiffEvt({ added: 60, removed: 60 }), ctx);
    expect(result.verdict).toBe('warn');
  });

  it('block when total lines >= blockLines (numeric shape)', async () => {
    const v = createDiffSizeValidator({ warnLines: 100, blockLines: 500 });
    const result = await v.validate(mkDiffEvt({ added: 300, removed: 250 }), ctx);
    expect(result.verdict).toBe('block');
    expect(result.remediation).toBeDefined();
  });

  it('handles unified-diff string shape', async () => {
    const unifiedDiff = [
      '--- a/file.ts',
      '+++ b/file.ts',
      ...Array(60).fill('+added line'),
      ...Array(20).fill('-removed line'),
    ].join('\n');
    const v = createDiffSizeValidator({ warnLines: 50, blockLines: 500 });
    const result = await v.validate(mkDiffEvt(unifiedDiff), ctx);
    expect(result.verdict).toBe('warn');
    expect(result.details?.added).toBe(60);
    expect(result.details?.removed).toBe(20);
  });

  it('appliesTo: returns true only for diff events', () => {
    const v = createDiffSizeValidator();
    expect(v.appliesTo(mkDiffEvt({ added: 5, removed: 2 }))).toBe(true);
    expect(v.appliesTo(mkToolEvt())).toBe(false);
  });

  it('handles object with content field containing unified diff', async () => {
    const content = Array(110).fill('+added line').join('\n');
    const v = createDiffSizeValidator({ warnLines: 100, blockLines: 500 });
    const result = await v.validate(mkDiffEvt({ content }), ctx);
    expect(result.verdict).toBe('warn');
  });
});
