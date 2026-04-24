// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createBreakingChangeValidator } from './breaking-change.js';
import type { AcpEvent } from '../acp-client.js';
import type { ValidatorContext } from '../step-validator.js';

const mkEditEvt = (path: string): AcpEvent => ({
  sessionId: 's1',
  type: 'tool_call',
  data: { kind: 'edit', path },
  ts: Date.now(),
});

const mkDeleteEvt = (path: string): AcpEvent => ({
  sessionId: 's1',
  type: 'tool_call',
  data: { kind: 'delete', path },
  ts: Date.now(),
});

const mkDiffEvt = (): AcpEvent => ({
  sessionId: 's1',
  type: 'diff',
  data: { added: 3, removed: 1 },
  ts: Date.now(),
});

const ctx: ValidatorContext = { cwd: process.cwd() };

describe('createBreakingChangeValidator', () => {
  it('block when editing index.tsx', async () => {
    const v = createBreakingChangeValidator();
    const result = await v.validate(mkEditEvt('/src/components/Button/index.tsx'), ctx);
    expect(result.verdict).toBe('block');
    expect(result.remediation).toBe('Public API changed; confirm with user');
  });

  it('pass when editing a deep implementation file', async () => {
    const v = createBreakingChangeValidator();
    const result = await v.validate(mkEditEvt('/src/components/Button/Button.tsx'), ctx);
    expect(result.verdict).toBe('pass');
  });

  it('block when editing a .d.ts file', async () => {
    const v = createBreakingChangeValidator();
    const result = await v.validate(mkEditEvt('/src/types/api.d.ts'), ctx);
    expect(result.verdict).toBe('block');
  });

  it('block when editing /public-api/ path', async () => {
    const v = createBreakingChangeValidator();
    const result = await v.validate(mkEditEvt('/src/public-api/endpoints.ts'), ctx);
    expect(result.verdict).toBe('block');
  });

  it('custom publicApiPaths override', async () => {
    const v = createBreakingChangeValidator({ publicApiPaths: [/\/custom-api\//] });
    const blockResult = await v.validate(mkEditEvt('/src/custom-api/routes.ts'), ctx);
    const passResult = await v.validate(mkEditEvt('/src/index.tsx'), ctx);
    expect(blockResult.verdict).toBe('block');
    expect(passResult.verdict).toBe('pass');
  });

  it('appliesTo: returns false for diff events', () => {
    const v = createBreakingChangeValidator();
    expect(v.appliesTo(mkDiffEvt())).toBe(false);
    expect(v.appliesTo(mkEditEvt('/src/index.tsx'))).toBe(true);
    expect(v.appliesTo(mkDeleteEvt('/src/types/api.d.ts'))).toBe(true);
  });
});
