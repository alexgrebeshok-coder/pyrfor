// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createSecurityScanValidator } from './security-scan.js';
import type { AcpEvent } from '../acp-client.js';
import type { ValidatorContext } from '../step-validator.js';

const mkEditEvt = (content: string): AcpEvent => ({
  sessionId: 's1',
  type: 'tool_call',
  data: { kind: 'edit', content },
  ts: Date.now(),
});

const mkDiffEvt = (content: string): AcpEvent => ({
  sessionId: 's1',
  type: 'diff',
  data: { content },
  ts: Date.now(),
});

const mkPlanEvt = (content: string): AcpEvent => ({
  sessionId: 's1',
  type: 'plan',
  data: { content },
  ts: Date.now(),
});

const ctx: ValidatorContext = { cwd: process.cwd() };

describe('createSecurityScanValidator', () => {
  it('block when AWS key (AKIA...) detected', async () => {
    const v = createSecurityScanValidator();
    const result = await v.validate(mkEditEvt('const key = "AKIAIOSFODNN7EXAMPLE";'), ctx);
    expect(result.verdict).toBe('block');
    expect(result.message).toContain('AWS Access Key');
    expect(result.details?.line).toBe(1);
  });

  it('block when eval() detected', async () => {
    const v = createSecurityScanValidator();
    const result = await v.validate(mkEditEvt('eval(userInput)'), ctx);
    expect(result.verdict).toBe('block');
    expect(result.message).toContain('eval()');
  });

  it('block when GitHub token (ghp_...) detected', async () => {
    const v = createSecurityScanValidator();
    const result = await v.validate(
      mkEditEvt('const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";'),
      ctx
    );
    expect(result.verdict).toBe('block');
  });

  it('pass when clean code provided', async () => {
    const v = createSecurityScanValidator();
    const result = await v.validate(mkEditEvt('const x = 1 + 2;\nconsole.log(x);'), ctx);
    expect(result.verdict).toBe('pass');
  });

  it('extraPatterns extension works', async () => {
    const v = createSecurityScanValidator({ extraPatterns: [/CUSTOM_SECRET/] });
    const result = await v.validate(mkEditEvt('const s = "CUSTOM_SECRET_VALUE";'), ctx);
    expect(result.verdict).toBe('block');
    expect(result.message).toContain('custom:');
  });

  it('appliesTo: returns false for non-edit/diff events', () => {
    const v = createSecurityScanValidator();
    expect(v.appliesTo(mkPlanEvt('plan text'))).toBe(false);
    expect(v.appliesTo(mkDiffEvt('diff text'))).toBe(true);
    expect(v.appliesTo(mkEditEvt('code'))).toBe(true);
  });
});
