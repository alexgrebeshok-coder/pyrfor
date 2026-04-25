// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { computeScore, scoreWorkdir } from './pyrfor-scoring';
import type { ScoringInputs, ScoringRunOptions } from './pyrfor-scoring';

describe('pyrfor-scoring', () => {
  describe('computeScore', () => {
    it('perfect score: all tests pass, build ok, no lint issues, no regressions', () => {
      const inputs: ScoringInputs = {
        tests: { passed: 10, total: 10 },
        build: { ok: true },
        lint: { errors: 0, warnings: 0 },
        regressedFiles: [],
      };

      const result = computeScore(inputs);

      expect(result.tests.score).toBe(40);
      expect(result.build.score).toBe(20);
      expect(result.lint.score).toBe(20);
      expect(result.noRegress.score).toBe(20);
      expect(result.total).toBe(100);
      expect(result.passed).toBe(true);
      expect(result.threshold).toBe(80);
    });

    it('passing score: 80% tests, build ok, 1 error, no regressions', () => {
      const inputs: ScoringInputs = {
        tests: { passed: 8, total: 10 },
        build: { ok: true },
        lint: { errors: 1, warnings: 0 },
        regressedFiles: [],
      };

      const result = computeScore(inputs);

      expect(result.tests.score).toBe(32); // 40 * 0.8
      expect(result.build.score).toBe(20);
      expect(result.lint.score).toBe(16); // 20 - 4*1
      expect(result.noRegress.score).toBe(20);
      expect(result.total).toBe(88);
      expect(result.passed).toBe(true);
    });

    it('failing score: 50% tests, build fail, no lint issues, no regressions', () => {
      const inputs: ScoringInputs = {
        tests: { passed: 5, total: 10 },
        build: { ok: false },
        lint: { errors: 0, warnings: 0 },
        regressedFiles: [],
      };

      const result = computeScore(inputs);

      expect(result.tests.score).toBe(20); // 40 * 0.5
      expect(result.build.score).toBe(0);
      expect(result.lint.score).toBe(20);
      expect(result.noRegress.score).toBe(20);
      expect(result.total).toBe(60);
      expect(result.passed).toBe(false);
    });

    it('skipped sections with regressions', () => {
      const inputs: ScoringInputs = {
        tests: { skipped: true, reason: 'No test runner found' },
        build: { ok: true },
        lint: { skipped: true, reason: 'No linter configured' },
        regressedFiles: ['a.ts', 'b.ts', 'c.ts'],
      };

      const result = computeScore(inputs);

      expect(result.tests.score).toBe(0);
      expect(result.tests.detail).toContain('skipped');
      expect(result.tests.detail).toContain('No test runner found');
      expect(result.build.score).toBe(20);
      expect(result.lint.score).toBe(0);
      expect(result.lint.detail).toContain('skipped');
      expect(result.noRegress.score).toBe(5); // 20 - 5*3
      expect(result.total).toBe(25);
      expect(result.passed).toBe(false);
    });

    it('lint score floors at 0 with many errors', () => {
      const inputs: ScoringInputs = {
        tests: { passed: 10, total: 10 },
        build: { ok: true },
        lint: { errors: 100, warnings: 0 },
        regressedFiles: [],
      };

      const result = computeScore(inputs);

      expect(result.lint.score).toBe(0); // max(0, 20 - 4*100)
      expect(result.total).toBe(80);
    });

    it('no-regress score floors at 0 with many regressions', () => {
      const inputs: ScoringInputs = {
        tests: { passed: 10, total: 10 },
        build: { ok: true },
        lint: { errors: 0, warnings: 0 },
        regressedFiles: new Array(10).fill('file.ts'),
      };

      const result = computeScore(inputs);

      expect(result.noRegress.score).toBe(0); // max(0, 20 - 5*10)
      expect(result.total).toBe(80);
    });

    it('custom threshold: 50', () => {
      const inputs: ScoringInputs = {
        tests: { passed: 5, total: 10 },
        build: { ok: true },
        lint: { errors: 0, warnings: 0 },
        regressedFiles: [],
      };

      const result = computeScore(inputs, { threshold: 50 });

      expect(result.total).toBe(80); // 20 + 20 + 20 + 20
      expect(result.passed).toBe(true);
      expect(result.threshold).toBe(50);
    });

    it('zero total tests', () => {
      const inputs: ScoringInputs = {
        tests: { passed: 0, total: 0 },
        build: { ok: true },
        lint: { errors: 0, warnings: 0 },
        regressedFiles: [],
      };

      const result = computeScore(inputs);

      expect(result.tests.score).toBe(0);
      expect(result.tests.detail).toContain('0 total');
      expect(result.total).toBe(60); // 0 + 20 + 20 + 20
    });

    it('mixed errors and warnings in lint', () => {
      const inputs: ScoringInputs = {
        tests: { passed: 10, total: 10 },
        build: { ok: true },
        lint: { errors: 2, warnings: 5 },
        regressedFiles: [],
      };

      const result = computeScore(inputs);

      expect(result.lint.score).toBe(7); // 20 - 4*2 - 1*5 = 7
      expect(result.total).toBe(87);
    });

    it('build failure with reason', () => {
      const inputs: ScoringInputs = {
        tests: { passed: 10, total: 10 },
        build: { ok: false, reason: 'Type error in main.ts' },
        lint: { errors: 0, warnings: 0 },
        regressedFiles: [],
      };

      const result = computeScore(inputs);

      expect(result.build.score).toBe(0);
      expect(result.build.detail).toContain('Type error in main.ts');
    });

    it('no inputs provided', () => {
      const inputs: ScoringInputs = {};

      const result = computeScore(inputs);

      expect(result.tests.score).toBe(0);
      expect(result.tests.detail).toContain('not provided');
      expect(result.build.score).toBe(0);
      expect(result.build.detail).toContain('not provided');
      expect(result.lint.score).toBe(0);
      expect(result.lint.detail).toContain('not provided');
      expect(result.noRegress.score).toBe(20);
      expect(result.total).toBe(20);
    });

    it('undefined regressedFiles defaults to empty array', () => {
      const inputs: ScoringInputs = {
        tests: { passed: 10, total: 10 },
        build: { ok: true },
        lint: { errors: 0, warnings: 0 },
      };

      const result = computeScore(inputs);

      expect(result.noRegress.score).toBe(20);
      expect(result.noRegress.detail).toContain('No regressions');
    });
  });

  describe('scoreWorkdir', () => {
    it('all commands succeed with parseable outputs', async () => {
      const mockExec = vi.fn();
      mockExec
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ numTotalTests: 10, numPassedTests: 10 }),
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: 'Build successful',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            { messages: [{ severity: 2 }, { severity: 1 }] },
            { messages: [{ severity: 1 }] },
          ]),
          stderr: '',
          exitCode: 0,
        });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        testCommand: 'npm test',
        buildCommand: 'npm run build',
        lintCommand: 'eslint . -f json',
        testParser: 'vitest-json',
        lintParser: 'eslint-json',
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(mockExec).toHaveBeenCalledTimes(3);
      expect(result.tests.score).toBe(40);
      expect(result.build.score).toBe(20);
      expect(result.lint.score).toBe(14); // 20 - 4*1 - 1*2
      expect(result.noRegress.score).toBe(20);
      expect(result.total).toBe(94);
    });

    it('testCommand omitted results in skipped tests', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        buildCommand: 'npm run build',
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.tests.score).toBe(0);
      expect(result.tests.detail).toContain('skipped');
      expect(result.tests.detail).toContain('No test command provided');
      expect(result.build.score).toBe(20);
    });

    it('lintCommand exits non-zero but with valid JSON', async () => {
      const mockExec = vi.fn();
      mockExec
        .mockResolvedValueOnce({
          stdout: JSON.stringify({ numTotalTests: 8, numPassedTests: 8 }),
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            { messages: [{ severity: 2 }] },
          ]),
          stderr: '',
          exitCode: 1, // ESLint exits with 1 when errors found
        });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        testCommand: 'vitest run',
        lintCommand: 'eslint . -f json',
        testParser: 'vitest-json',
        lintParser: 'eslint-json',
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.tests.score).toBe(40); // 8/8 = 100%
      expect(result.lint.score).toBe(16); // 20 - 4*1
      expect(result.lint.detail).toContain('1 error(s)');
    });

    it('custom test parser function', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: 'Custom: 7 out of 10 passed',
        stderr: '',
        exitCode: 0,
      });

      const customParser = (stdout: string, exitCode: number) => {
        const match = stdout.match(/(\d+) out of (\d+) passed/);
        if (!match) throw new Error('Parse failed');
        return { passed: parseInt(match[1]), total: parseInt(match[2]) };
      };

      const opts: ScoringRunOptions = {
        workdir: '/test',
        testCommand: 'custom-test',
        testParser: customParser,
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.tests.score).toBe(28); // 40 * 0.7
      expect(result.tests.detail).toContain('7/10 passed');
    });

    it('custom lint parser function', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: 'Found 3 errors and 2 warnings',
        stderr: '',
        exitCode: 0,
      });

      const customParser = (stdout: string, exitCode: number) => {
        const match = stdout.match(/(\d+) errors and (\d+) warnings/);
        if (!match) throw new Error('Parse failed');
        return { errors: parseInt(match[1]), warnings: parseInt(match[2]) };
      };

      const opts: ScoringRunOptions = {
        workdir: '/test',
        lintCommand: 'custom-lint',
        lintParser: customParser,
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.lint.score).toBe(6); // 20 - 4*3 - 1*2
      expect(result.lint.detail).toContain('3 error(s), 2 warning(s)');
    });

    it('regressedFiles = currentFailures \\ baselineFailures', async () => {
      const mockExec = vi.fn();

      const opts: ScoringRunOptions = {
        workdir: '/test',
        baselineFailures: ['a.ts', 'b.ts'],
        currentFailures: ['b.ts', 'c.ts', 'd.ts'],
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      // Regressions: c.ts and d.ts (not in baseline)
      expect(result.noRegress.score).toBe(10); // 20 - 5*2
      expect(result.noRegress.detail).toContain('2 regressed file(s)');
    });

    it('only currentFailures provided (no baseline)', async () => {
      const mockExec = vi.fn();

      const opts: ScoringRunOptions = {
        workdir: '/test',
        currentFailures: ['a.ts', 'b.ts'],
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.noRegress.score).toBe(10); // 20 - 5*2
    });

    it('parser throws error results in skipped', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: 'Invalid JSON',
        stderr: '',
        exitCode: 0,
      });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        testCommand: 'npm test',
        testParser: 'vitest-json',
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.tests.score).toBe(0);
      expect(result.tests.detail).toContain('skipped');
    });

    it('parser returns NaN results in skipped', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: 'test output',
        stderr: '',
        exitCode: 0,
      });

      const customParser = () => ({ passed: NaN, total: 10 });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        testCommand: 'npm test',
        testParser: customParser,
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.tests.score).toBe(0);
      expect(result.tests.detail).toContain('skipped');
      expect(result.tests.detail).toContain('Parser returned NaN');
    });

    it('execFn throws error results in skipped/failed', async () => {
      const mockExec = vi.fn();
      mockExec
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Command not found'));

      const opts: ScoringRunOptions = {
        workdir: '/test',
        testCommand: 'npm test',
        buildCommand: 'npm run build',
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.tests.score).toBe(0);
      expect(result.tests.detail).toContain('Timeout');
      expect(result.build.score).toBe(0);
      expect(result.build.detail).toContain('Command not found');
    });

    it('uses default timeoutSec of 600', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        buildCommand: 'npm run build',
        execFn: mockExec,
      };

      await scoreWorkdir(opts);

      expect(mockExec).toHaveBeenCalledWith('npm run build', {
        cwd: '/test',
        timeoutSec: 600,
      });
    });

    it('uses custom timeoutSec', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        buildCommand: 'npm run build',
        timeoutSec: 120,
        execFn: mockExec,
      };

      await scoreWorkdir(opts);

      expect(mockExec).toHaveBeenCalledWith('npm run build', {
        cwd: '/test',
        timeoutSec: 120,
      });
    });

    it('jest-json parser', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: JSON.stringify({
          numTotalTests: 15,
          numPassedTests: 12,
        }),
        stderr: '',
        exitCode: 0,
      });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        testCommand: 'jest --json',
        testParser: 'jest-json',
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.tests.score).toBe(32); // 40 * (12/15) = 32
    });

    it('tap parser', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: `TAP version 13
ok 1 - test one
ok 2 - test two
not ok 3 - test three
ok 4 - test four`,
        stderr: '',
        exitCode: 0,
      });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        testCommand: 'tap',
        testParser: 'tap',
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.tests.score).toBe(30); // 40 * (3/4) = 30
    });

    it('simple-counts parser', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: '8 passed, 2 failed',
        stderr: '',
        exitCode: 0,
      });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        testCommand: 'custom-test',
        testParser: 'simple-counts',
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.tests.score).toBe(32); // 40 * (8/10) = 32
    });

    it('lint simple-counts parser', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: '5 errors, 3 warnings found',
        stderr: '',
        exitCode: 1,
      });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        lintCommand: 'custom-lint',
        lintParser: 'simple-counts',
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.lint.score).toBe(0); // max(0, 20 - 4*5 - 1*3) = 0
    });

    it('threshold passed through to computeScore', async () => {
      const mockExec = vi.fn();
      mockExec.mockResolvedValue({
        stdout: JSON.stringify({ numTotalTests: 10, numPassedTests: 6 }),
        stderr: '',
        exitCode: 0,
      });

      const opts: ScoringRunOptions = {
        workdir: '/test',
        testCommand: 'npm test',
        testParser: 'vitest-json',
        threshold: 20,
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      expect(result.tests.score).toBe(24); // 40 * 0.6
      expect(result.total).toBe(44);
      expect(result.passed).toBe(true);
      expect(result.threshold).toBe(20);
    });

    it('order-independent set difference for regressions', async () => {
      const mockExec = vi.fn();

      const opts: ScoringRunOptions = {
        workdir: '/test',
        baselineFailures: ['z.ts', 'a.ts', 'm.ts'],
        currentFailures: ['m.ts', 'x.ts', 'a.ts', 'b.ts'],
        execFn: mockExec,
      };

      const result = await scoreWorkdir(opts);

      // Regressions: x.ts, b.ts (2 files)
      expect(result.noRegress.score).toBe(10); // 20 - 5*2
    });
  });
});
