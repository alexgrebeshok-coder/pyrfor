// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createTestGateValidator } from './test-gate.js';
import type { AcpEvent } from '../acp-client.js';
import type { ValidatorContext } from '../step-validator.js';

const mkEditEvt = (): AcpEvent => ({
  sessionId: 's1',
  type: 'tool_call',
  data: { kind: 'edit', path: '/src/foo.ts' },
  ts: Date.now(),
});

const mkDiffEvt = (): AcpEvent => ({
  sessionId: 's1',
  type: 'diff',
  data: { added: 3, removed: 1 },
  ts: Date.now(),
});

const ctx: ValidatorContext = { cwd: process.cwd() };

describe('createTestGateValidator', () => {
  it('pass when JSON shows 0 failures', async () => {
    const json = JSON.stringify({ numTotalTests: 5, numFailedTests: 0, numPassedTests: 5 });
    const v = createTestGateValidator({ command: `echo '${json}'` });
    const result = await v.validate(mkEditEvt(), ctx);
    expect(result.verdict).toBe('pass');
    expect(result.validator).toBe('test-gate');
  });

  it('correct when failure ratio ≤ correctThreshold (0.5)', async () => {
    const json = JSON.stringify({ numTotalTests: 10, numFailedTests: 3, numPassedTests: 7 });
    const v = createTestGateValidator({ command: `echo '${json}'`, failCorrectThreshold: 0.5 });
    const result = await v.validate(mkEditEvt(), ctx);
    expect(result.verdict).toBe('correct');
    expect(result.remediation).toBeDefined();
  });

  it('block when failure ratio > threshold', async () => {
    const json = JSON.stringify({ numTotalTests: 10, numFailedTests: 7, numPassedTests: 3 });
    const v = createTestGateValidator({ command: `echo '${json}'`, failCorrectThreshold: 0.5 });
    const result = await v.validate(mkEditEvt(), ctx);
    expect(result.verdict).toBe('block');
  });

  it('appliesTo: returns true for tool_call with kind=edit', () => {
    const v = createTestGateValidator();
    expect(v.appliesTo(mkEditEvt())).toBe(true);
  });

  it('appliesTo: returns false for diff event', () => {
    const v = createTestGateValidator();
    expect(v.appliesTo(mkDiffEvt())).toBe(false);
  });

  it('handles unparseable JSON output gracefully (exitCode 0 → pass, non-zero → block)', async () => {
    const vPass = createTestGateValidator({ command: 'echo "not-json"' });
    const vFail = createTestGateValidator({ command: 'sh -c \'echo "not-json"; exit 1\'' });
    const rPass = await vPass.validate(mkEditEvt(), ctx);
    const rFail = await vFail.validate(mkEditEvt(), ctx);
    expect(rPass.verdict).toBe('pass');
    expect(rFail.verdict).toBe('block');
  });
});
