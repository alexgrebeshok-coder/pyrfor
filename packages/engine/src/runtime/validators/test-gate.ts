import type { AcpEvent } from '../acp-client.js';
import type { StepValidator, ValidatorContext, ValidatorResult } from '../step-validator.js';
import { runShell } from '../step-validator.js';

export interface TestGateOptions {
  command?: string;
  failBlockThreshold?: number;
  failCorrectThreshold?: number;
  timeoutMs?: number;
}

interface VitestJsonResult {
  numTotalTests?: number;
  numFailedTests?: number;
  numPassedTests?: number;
  success?: boolean;
}

function parseTestJson(stdout: string): { failed: number; total: number } | null {
  try {
    const parsed = JSON.parse(stdout.trim()) as VitestJsonResult;
    const total = parsed.numTotalTests ?? 0;
    const failed = parsed.numFailedTests ?? 0;
    return { failed, total };
  } catch {
    return null;
  }
}

export function createTestGateValidator(opts?: TestGateOptions): StepValidator {
  const command = opts?.command ?? 'npx vitest run --reporter=json';
  const correctThreshold = opts?.failCorrectThreshold ?? 0.5;

  return {
    name: 'test-gate',

    appliesTo(event: AcpEvent): boolean {
      if (event.type !== 'tool_call' && event.type !== 'tool_call_update') return false;
      const data = event.data as Record<string, unknown> | null;
      const kind = String(data?.['kind'] ?? '');
      return kind === 'edit';
    },

    async validate(event: AcpEvent, ctx: ValidatorContext): Promise<ValidatorResult> {
      const start = Date.now();
      const timeoutMs = opts?.timeoutMs ?? ctx.shellTimeoutMs ?? 60_000;

      const { stdout, exitCode } = await runShell(command, {
        cwd: ctx.cwd,
        timeoutMs,
        abortSignal: ctx.abortSignal,
      });

      const durationMs = Date.now() - start;

      const parsed = parseTestJson(stdout);

      if (!parsed) {
        return {
          validator: 'test-gate',
          verdict: exitCode === 0 ? 'pass' : 'block',
          message: exitCode === 0 ? 'Tests passed' : 'Tests failed (could not parse output)',
          details: { stdout: stdout.slice(0, 500) },
          durationMs,
        };
      }

      const { failed, total } = parsed;
      const ratio = total === 0 ? 0 : failed / total;

      if (ratio === 0) {
        return {
          validator: 'test-gate',
          verdict: 'pass',
          message: `All ${total} tests passed`,
          details: { failed, total },
          durationMs,
        };
      }

      if (ratio <= correctThreshold) {
        return {
          validator: 'test-gate',
          verdict: 'correct',
          message: `${failed}/${total} tests failed (below block threshold)`,
          details: { failed, total, ratio },
          remediation: 'Fix failing tests',
          durationMs,
        };
      }

      return {
        validator: 'test-gate',
        verdict: 'block',
        message: `${failed}/${total} tests failed (exceeds threshold)`,
        details: { failed, total, ratio },
        remediation: 'Fix failing tests before proceeding',
        durationMs,
      };
    },
  };
}
