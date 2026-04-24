// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createScopeCheckValidator } from './scope-check.js';
import type { AcpEvent } from '../acp-client.js';
import type { ValidatorContext } from '../step-validator.js';

const mkEditEvt = (path: string): AcpEvent => ({
  sessionId: 's1',
  type: 'tool_call',
  data: { kind: 'edit', path },
  ts: Date.now(),
});

const mkPlanEvt = (): AcpEvent => ({
  sessionId: 's1',
  type: 'plan',
  data: {},
  ts: Date.now(),
});

const baseCtx: ValidatorContext = { cwd: process.cwd() };

describe('createScopeCheckValidator', () => {
  it('pass when path is in scopeFiles', async () => {
    const v = createScopeCheckValidator();
    const ctx: ValidatorContext = { ...baseCtx, scopeFiles: ['/src/foo.ts', '/src/bar.ts'] };
    const result = await v.validate(mkEditEvt('/src/foo.ts'), ctx);
    expect(result.verdict).toBe('pass');
  });

  it('warn when path is out-of-scope (non-strict mode)', async () => {
    const v = createScopeCheckValidator({ strict: false });
    const ctx: ValidatorContext = { ...baseCtx, scopeFiles: ['/src/foo.ts'] };
    const result = await v.validate(mkEditEvt('/src/other.ts'), ctx);
    expect(result.verdict).toBe('warn');
    expect(result.details?.outOfScope).toContain('/src/other.ts');
  });

  it('block when path is out-of-scope (strict mode)', async () => {
    const v = createScopeCheckValidator({ strict: true });
    const ctx: ValidatorContext = { ...baseCtx, scopeFiles: ['/src/foo.ts'] };
    const result = await v.validate(mkEditEvt('/src/other.ts'), ctx);
    expect(result.verdict).toBe('block');
    expect(result.remediation).toBeDefined();
  });

  it('LLM-disagree path → correct verdict', async () => {
    const llmFn = vi.fn().mockResolvedValue('no, this is out of scope');
    const v = createScopeCheckValidator();
    const ctx: ValidatorContext = {
      ...baseCtx,
      task: 'Fix the login bug',
      llmFn,
    };
    const result = await v.validate(mkEditEvt('/src/unrelated.ts'), ctx);
    expect(result.verdict).toBe('correct');
    expect(llmFn).toHaveBeenCalled();
  });

  it('pass when LLM agrees scope is OK', async () => {
    const llmFn = vi.fn().mockResolvedValue('yes');
    const v = createScopeCheckValidator();
    const ctx: ValidatorContext = {
      ...baseCtx,
      task: 'Fix the login bug',
      llmFn,
    };
    const result = await v.validate(mkEditEvt('/src/login.ts'), ctx);
    expect(result.verdict).toBe('pass');
  });

  it('appliesTo: returns false for plan events', () => {
    const v = createScopeCheckValidator();
    expect(v.appliesTo(mkPlanEvt())).toBe(false);
    expect(v.appliesTo(mkEditEvt('/src/foo.ts'))).toBe(true);
  });
});
