// @vitest-environment node
/**
 * Error sanitiser — strips secrets, paths, and PII from error messages
 * before they are surfaced in Telegram chats.
 */

import os from 'os';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SanitiseOptions {
  homeDir?: string;
  cwd?: string;
  /** Truncate final message to this length. Default 1500. */
  maxLength?: number;
  /** Custom regex patterns to redact. */
  extraPatterns?: Array<{ pattern: RegExp; replacement: string }>;
  /** Include stack trace? Default false. */
  includeStack?: boolean;
}

export interface SanitiseResult {
  message: string;
  redactions: number;
  truncated: boolean;
}

// ─── Built-in redaction patterns ─────────────────────────────────────────────

interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

function buildBuiltinRules(homeDir: string, cwd: string): RedactionRule[] {
  return [
    // API keys — specific providers first
    { pattern: /sk-[a-zA-Z0-9_\-]{16,}/g,                                            replacement: 'sk-REDACTED' },
    { pattern: /Bearer\s+[a-zA-Z0-9._\-]{20,}/g,                                     replacement: 'Bearer REDACTED' },
    { pattern: /xoxb-[a-zA-Z0-9\-]+/g,                                               replacement: 'xoxb-REDACTED' },
    { pattern: /gh[oprsu]_[A-Za-z0-9]{16,}/g,                                        replacement: 'ghX_REDACTED' },
    { pattern: /AIza[0-9A-Za-z\-_]{35,}/g,                                           replacement: 'AIza-REDACTED' },
    { pattern: /glpat-[A-Za-z0-9_\-]{20,}/g,                                         replacement: 'glpat-REDACTED' },
    { pattern: /xapp-[A-Za-z0-9_\-]+/g,                                              replacement: 'xapp-REDACTED' },
    // JWT
    { pattern: /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g,         replacement: 'JWT-REDACTED' },
    // Authorization header value (case-insensitive key)
    { pattern: /(?<=[Aa]uthorization:\s*)\S+/g,                                       replacement: 'REDACTED' },

    // File paths — cwd first (longer/more-specific), then homeDir, then generic /Users/xxx
    { pattern: new RegExp(escapeRegex(cwd), 'g'),                                     replacement: '.' },
    { pattern: new RegExp(escapeRegex(homeDir), 'g'),                                 replacement: '~' },
    { pattern: /\/Users\/[^/\s]+/g,                                                   replacement: '/Users/USER' },

    // Email
    { pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,                replacement: '[email]' },

    // IPv4
    { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,                                       replacement: '[ip]' },
  ];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Core ────────────────────────────────────────────────────────────────────

function extractRawMessage(err: unknown): string {
  if (err === null || err === undefined) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj['message'] === 'string') return obj['message'];
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }
  return String(err);
}

function extractStack(err: unknown): string | undefined {
  if (err instanceof Error) return err.stack;
  return undefined;
}

function applyRules(text: string, rules: RedactionRule[]): { text: string; count: number } {
  let count = 0;
  for (const { pattern, replacement } of rules) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) count += matches.length;
    pattern.lastIndex = 0;
    text = text.replace(pattern, replacement);
  }
  return { text, count };
}

export function sanitiseError(err: unknown, opts?: SanitiseOptions): SanitiseResult {
  const homeDir = opts?.homeDir ?? os.homedir();
  const cwd     = opts?.cwd     ?? process.cwd();
  const maxLen   = opts?.maxLength ?? 1500;

  const rawMsg   = extractRawMessage(err);
  const rawStack = (opts?.includeStack && extractStack(err)) ? extractStack(err)! : undefined;

  const combined = rawStack ? `${rawMsg}\n\n${rawStack}` : rawMsg;

  const rules: RedactionRule[] = [
    ...buildBuiltinRules(homeDir, cwd),
    ...(opts?.extraPatterns ?? []),
  ];

  const { text: sanitised, count } = applyRules(combined, rules);

  const truncated = sanitised.length > maxLen;
  const message   = truncated ? sanitised.slice(0, maxLen) + '… (truncated)' : sanitised;

  return { message, redactions: count, truncated };
}

export function formatErrorForTelegram(err: unknown, opts?: SanitiseOptions): string {
  const result = sanitiseError(err, opts);
  const header = '❌ Error:';
  const body   = result.message.includes('\n')
    ? `${header}\n${result.message}`
    : `${header} ${result.message}`;

  return result.truncated ? `${body}\n_(message truncated)_` : body;
}
