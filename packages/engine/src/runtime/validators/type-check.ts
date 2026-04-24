import type { AcpEvent } from '../acp-client.js';
import type { StepValidator, ValidatorContext, ValidatorResult } from '../step-validator.js';
import { runShell } from '../step-validator.js';

export interface TypeCheckOptions {
  command?: string;
  timeoutMs?: number;
  appliesToKinds?: string[];
}

export function createTypeCheckValidator(opts?: TypeCheckOptions): StepValidator {
  const command = opts?.command ?? 'npx tsc --noEmit';
  const appliesToKinds = opts?.appliesToKinds ?? ['edit'];

  return {
    name: 'type-check',

    appliesTo(event: AcpEvent): boolean {
      if (event.type !== 'tool_call' && event.type !== 'tool_call_update') return false;
      const data = event.data as Record<string, unknown> | null;
      return appliesToKinds.includes(String(data?.['kind'] ?? ''));
    },

    async validate(event: AcpEvent, ctx: ValidatorContext): Promise<ValidatorResult> {
      const start = Date.now();
      const timeoutMs = opts?.timeoutMs ?? ctx.shellTimeoutMs ?? 60_000;

      const { stdout, stderr, exitCode } = await runShell(command, {
        cwd: ctx.cwd,
        timeoutMs,
        abortSignal: ctx.abortSignal,
      });

      const durationMs = Date.now() - start;

      if (exitCode === 0) {
        return {
          validator: 'type-check',
          verdict: 'pass',
          message: 'TypeScript compiled successfully',
          durationMs,
        };
      }

      return {
        validator: 'type-check',
        verdict: 'block',
        message: 'TypeScript compilation failed',
        details: { stdout, stderr, exitCode },
        remediation: 'Fix TypeScript errors before proceeding',
        durationMs,
      };
    },
  };
}
