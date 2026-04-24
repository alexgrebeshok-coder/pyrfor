import type { AcpEvent } from '../acp-client.js';
import type { StepValidator, ValidatorContext, ValidatorResult } from '../step-validator.js';
import { extractTouchedPaths } from '../step-validator.js';

export interface BreakingChangeOptions {
  publicApiPaths?: RegExp[];
}

const DEFAULT_PUBLIC_API_PATHS: RegExp[] = [
  /\/index\.tsx?$/,
  /\/public-api\//,
  /\.d\.ts$/,
];

function isEditOrDeleteEvent(event: AcpEvent): boolean {
  if (event.type !== 'tool_call' && event.type !== 'tool_call_update') return false;
  const data = event.data as Record<string, unknown> | null;
  const kind = String(data?.['kind'] ?? '');
  return kind === 'edit' || kind === 'delete';
}

export function createBreakingChangeValidator(opts?: BreakingChangeOptions): StepValidator {
  const publicApiPaths = opts?.publicApiPaths ?? DEFAULT_PUBLIC_API_PATHS;

  return {
    name: 'breaking-change',

    appliesTo(event: AcpEvent): boolean {
      return isEditOrDeleteEvent(event);
    },

    async validate(event: AcpEvent, _ctx: ValidatorContext): Promise<ValidatorResult> {
      const start = Date.now();
      const touchedPaths = extractTouchedPaths(event);

      const matchedPaths = touchedPaths.filter((p) => publicApiPaths.some((re) => re.test(p)));

      const durationMs = Date.now() - start;

      if (matchedPaths.length > 0) {
        return {
          validator: 'breaking-change',
          verdict: 'block',
          message: `Public API file(s) modified: ${matchedPaths.join(', ')}`,
          details: { matchedPaths, publicApiPaths: publicApiPaths.map((r) => r.source) },
          remediation: 'Public API changed; confirm with user',
          durationMs,
        };
      }

      return {
        validator: 'breaking-change',
        verdict: 'pass',
        message: 'No public API files modified',
        durationMs,
      };
    },
  };
}
