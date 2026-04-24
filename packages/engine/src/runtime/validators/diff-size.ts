import type { AcpEvent } from '../acp-client.js';
import type { StepValidator, ValidatorContext, ValidatorResult } from '../step-validator.js';

export interface DiffSizeOptions {
  warnLines?: number;
  blockLines?: number;
}

function countDiffLines(data: unknown): { added: number; removed: number } {
  if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>;
    if (typeof d['added'] === 'number' && typeof d['removed'] === 'number') {
      return { added: d['added'] as number, removed: d['removed'] as number };
    }
    const content = d['content'] ?? d['diff'] ?? d['patch'];
    if (typeof content === 'string') {
      return parseUnifiedDiff(content);
    }
  }
  if (typeof data === 'string') {
    return parseUnifiedDiff(data);
  }
  return { added: 0, removed: 0 };
}

function parseUnifiedDiff(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

export function createDiffSizeValidator(opts?: DiffSizeOptions): StepValidator {
  const warnLines = opts?.warnLines ?? 100;
  const blockLines = opts?.blockLines ?? 500;

  return {
    name: 'diff-size',

    appliesTo(event: AcpEvent): boolean {
      return event.type === 'diff';
    },

    async validate(event: AcpEvent, _ctx: ValidatorContext): Promise<ValidatorResult> {
      const start = Date.now();
      const { added, removed } = countDiffLines(event.data);
      const total = added + removed;
      const durationMs = Date.now() - start;

      if (total >= blockLines) {
        return {
          validator: 'diff-size',
          verdict: 'block',
          message: `Diff too large: ${total} lines (limit ${blockLines})`,
          details: { added, removed, total, blockLines },
          remediation: 'Break the change into smaller, focused commits',
          durationMs,
        };
      }

      if (total >= warnLines) {
        return {
          validator: 'diff-size',
          verdict: 'warn',
          message: `Diff is large: ${total} lines (warn threshold ${warnLines})`,
          details: { added, removed, total, warnLines },
          durationMs,
        };
      }

      return {
        validator: 'diff-size',
        verdict: 'pass',
        message: `Diff size OK: ${total} lines`,
        details: { added, removed, total },
        durationMs,
      };
    },
  };
}
