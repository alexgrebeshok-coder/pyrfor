import type { AcpEvent } from '../acp-client.js';
import type { StepValidator, ValidatorContext, ValidatorResult } from '../step-validator.js';

export interface SecurityScanOptions {
  extraPatterns?: RegExp[];
}

interface PatternDef {
  pattern: RegExp;
  label: string;
}

const DEFAULT_PATTERNS: PatternDef[] = [
  { pattern: /AKIA[0-9A-Z]{16}/, label: 'AWS Access Key ID (AKIA...)' },
  { pattern: /AIza[0-9A-Za-z\-_]{35}/, label: 'Google API Key (AIza...)' },
  { pattern: /ghp_[0-9A-Za-z]{36}/, label: 'GitHub Personal Access Token (ghp_...)' },
  { pattern: /sk-[A-Za-z0-9]{32,}/, label: 'Secret key (sk-...)' },
  { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH |)PRIVATE KEY-----/, label: 'Private key block' },
  { pattern: /password\s*=\s*['"][^'"]{3,}['"]/, label: 'Hardcoded password' },
  { pattern: /api_key\s*=\s*['"][^'"]{3,}['"]/, label: 'Hardcoded API key' },
  { pattern: /eval\s*\(/, label: 'eval() call' },
  { pattern: /child_process\.exec\s*\(/, label: 'child_process.exec (potential injection)' },
];

function extractTextContent(data: unknown): string {
  if (typeof data === 'string') return data;
  if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>;
    const candidates = ['content', 'code', 'diff', 'patch', 'text', 'body'];
    for (const key of candidates) {
      if (typeof d[key] === 'string') return d[key] as string;
    }
    return JSON.stringify(data);
  }
  return '';
}

function isEditOrDiff(event: AcpEvent): boolean {
  if (event.type === 'diff') return true;
  if (event.type === 'tool_call' || event.type === 'tool_call_update') {
    const data = event.data as Record<string, unknown> | null;
    const kind = String(data?.['kind'] ?? '');
    return kind === 'edit';
  }
  return false;
}

export function createSecurityScanValidator(opts?: SecurityScanOptions): StepValidator {
  const patterns: PatternDef[] = [
    ...DEFAULT_PATTERNS,
    ...(opts?.extraPatterns ?? []).map((p) => ({ pattern: p, label: `custom: ${p.source}` })),
  ];

  return {
    name: 'security-scan',

    appliesTo(event: AcpEvent): boolean {
      return isEditOrDiff(event);
    },

    async validate(event: AcpEvent, _ctx: ValidatorContext): Promise<ValidatorResult> {
      const start = Date.now();
      const text = extractTextContent(event.data);
      const lines = text.split('\n');

      for (const { pattern, label } of patterns) {
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i]!)) {
            const durationMs = Date.now() - start;
            return {
              validator: 'security-scan',
              verdict: 'block',
              message: `Security issue detected: ${label}`,
              details: {
                pattern: pattern.source,
                line: i + 1,
                snippet: lines[i]!.slice(0, 120),
              },
              remediation: 'Remove sensitive data before committing',
              durationMs,
            };
          }
        }
      }

      const durationMs = Date.now() - start;
      return {
        validator: 'security-scan',
        verdict: 'pass',
        message: 'No security issues detected',
        durationMs,
      };
    },
  };
}
