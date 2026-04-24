import type { AcpEvent } from '../acp-client.js';
import type { StepValidator, ValidatorContext, ValidatorResult } from '../step-validator.js';
import { extractTouchedPaths } from '../step-validator.js';

export interface ScopeCheckOptions {
  strict?: boolean;
}

function isEditDeleteMoveEvent(event: AcpEvent): boolean {
  if (event.type !== 'tool_call' && event.type !== 'tool_call_update') return false;
  const data = event.data as Record<string, unknown> | null;
  const kind = String(data?.['kind'] ?? '');
  return ['edit', 'delete', 'move'].includes(kind);
}

export function createScopeCheckValidator(opts?: ScopeCheckOptions): StepValidator {
  const strict = opts?.strict ?? false;

  return {
    name: 'scope-check',

    appliesTo(event: AcpEvent): boolean {
      return isEditDeleteMoveEvent(event);
    },

    async validate(event: AcpEvent, ctx: ValidatorContext): Promise<ValidatorResult> {
      const start = Date.now();
      const touchedPaths = extractTouchedPaths(event);

      if (ctx.scopeFiles && ctx.scopeFiles.length > 0) {
        const outOfScope = touchedPaths.filter((p) => !ctx.scopeFiles!.includes(p));
        if (outOfScope.length > 0) {
          const durationMs = Date.now() - start;
          if (strict) {
            return {
              validator: 'scope-check',
              verdict: 'block',
              message: `Out-of-scope files modified: ${outOfScope.join(', ')}`,
              details: { outOfScope, scopeFiles: ctx.scopeFiles },
              remediation: 'Limit changes to files within the task scope',
              durationMs,
            };
          }
          return {
            validator: 'scope-check',
            verdict: 'warn',
            message: `Possible out-of-scope files modified: ${outOfScope.join(', ')}`,
            details: { outOfScope, scopeFiles: ctx.scopeFiles },
            durationMs,
          };
        }
      }

      if (ctx.llmFn && ctx.task) {
        const dataStr =
          typeof event.data === 'string' ? event.data : JSON.stringify(event.data).slice(0, 2000);

        const prompt = `Task: ${ctx.task}\n\nThe agent made this change:\n${dataStr}\n\nDid this change stay within the task scope? Reply with exactly "yes" or "no".`;

        try {
          const answer = (await ctx.llmFn(prompt)).trim().toLowerCase();
          if (answer.startsWith('no')) {
            const durationMs = Date.now() - start;
            return {
              validator: 'scope-check',
              verdict: 'correct',
              message: 'LLM judged change as outside task scope',
              details: { llmAnswer: answer, task: ctx.task },
              remediation: 'Revise the change to stay within task scope',
              durationMs,
            };
          }
        } catch {
          // LLM failure is non-fatal
        }
      }

      const durationMs = Date.now() - start;
      return {
        validator: 'scope-check',
        verdict: 'pass',
        message: 'Change is within task scope',
        durationMs,
      };
    },
  };
}
