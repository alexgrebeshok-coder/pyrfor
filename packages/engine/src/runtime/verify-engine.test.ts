// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { runVerify } from './verify-engine.js';
import type { VerifyCheck } from './verify-engine.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('runVerify', () => {
  it('single passing check (exit 0)', async () => {
    const checks: VerifyCheck[] = [{ name: 'ok', command: 'exit 0', weight: 100 }];
    const r = await runVerify(checks);
    expect(r.total).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.checks[0]!.passed).toBe(true);
  });

  it('single failing check (exit 1)', async () => {
    const checks: VerifyCheck[] = [{ name: 'fail', command: 'exit 1', weight: 100 }];
    const r = await runVerify(checks);
    expect(r.total).toBe(0);
    expect(r.passed).toBe(false);
  });

  it('weighted total — two checks, one passes, one fails', async () => {
    const checks: VerifyCheck[] = [
      { name: 'a', command: 'exit 0', weight: 60 },
      { name: 'b', command: 'exit 1', weight: 40 },
    ];
    const r = await runVerify(checks);
    expect(r.total).toBe(60);
  });

  it('successPattern enforced — exit 0 but pattern fails', async () => {
    const checks: VerifyCheck[] = [
      { name: 'p', command: 'echo hello', weight: 100, successPattern: /world/ },
    ];
    const r = await runVerify(checks);
    expect(r.checks[0]!.passed).toBe(false);
    expect(r.total).toBe(0);
  });

  it('successPattern passes when output matches', async () => {
    const checks: VerifyCheck[] = [
      { name: 'p', command: 'echo hello world', weight: 100, successPattern: /world/ },
    ];
    const r = await runVerify(checks);
    expect(r.checks[0]!.passed).toBe(true);
    expect(r.total).toBe(100);
  });

  it('timeout kills process', async () => {
    const checks: VerifyCheck[] = [
      { name: 'slow', command: 'sleep 30', weight: 100, timeoutMs: 200 },
    ];
    const r = await runVerify(checks);
    expect(r.checks[0]!.passed).toBe(false);
    expect(r.checks[0]!.durationMs).toBeLessThan(5000);
  });

  it('truncates large stdout to truncateOutputBytes', async () => {
    const checks: VerifyCheck[] = [
      {
        name: 'big',
        command: `node -e "process.stdout.write('a'.repeat(10000))"`,
        weight: 100,
      },
    ];
    const r = await runVerify(checks, { truncateOutputBytes: 100 });
    expect(r.checks[0]!.stdout.length).toBeLessThanOrEqual(100);
  });

  it('cwd is passed to process', async () => {
    const checks: VerifyCheck[] = [{ name: 'cwd', command: 'pwd', weight: 100 }];
    const r = await runVerify(checks, { cwd: __dirname });
    expect(r.checks[0]!.stdout).toContain(__dirname);
  });

  it('env is passed to process', async () => {
    const checks: VerifyCheck[] = [
      { name: 'env', command: 'echo $MY_TEST_VAR', weight: 100 },
    ];
    const r = await runVerify(checks, { env: { MY_TEST_VAR: 'hello123' } });
    expect(r.checks[0]!.stdout).toContain('hello123');
  });

  it('threshold default is 80', async () => {
    const r = await runVerify([{ name: 'ok', command: 'exit 0', weight: 100 }]);
    expect(r.threshold).toBe(80);
  });

  it('threshold override', async () => {
    const r = await runVerify(
      [{ name: 'ok', command: 'exit 0', weight: 60 }],
      { threshold: 50 }
    );
    expect(r.passed).toBe(true);
    expect(r.threshold).toBe(50);
  });

  it('empty checks array → total=100, passed=true (with default threshold)', async () => {
    const r = await runVerify([]);
    expect(r.total).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.checks).toHaveLength(0);
  });

  it('abortSignal cancels in-progress check', async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 50);
    const checks: VerifyCheck[] = [
      { name: 'slow', command: 'sleep 10', weight: 100, timeoutMs: 60000 },
    ];
    const start = Date.now();
    const r = await runVerify(checks, { abortSignal: ctrl.signal });
    expect(r.checks[0]!.passed).toBe(false);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
