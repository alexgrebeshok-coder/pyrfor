// @vitest-environment node
/**
 * Tests for error-sanitiser — strips secrets, paths, and PII from error messages.
 */

import { describe, it, expect } from 'vitest';
import os from 'os';
import { sanitiseError, formatErrorForTelegram } from './error-sanitiser';

const HOME = os.homedir();
const CWD  = process.cwd();

// ─── API key redaction ────────────────────────────────────────────────────────

describe('sanitiseError — API key redaction', () => {
  it('redacts OpenAI-style sk- key', () => {
    const err = new Error(`Failed with key sk-abcdefghijklmnopqrstuvwxyz123456`);
    const r = sanitiseError(err);
    expect(r.message).not.toContain('sk-abcdef');
    expect(r.message).toContain('sk-REDACTED');
    expect(r.redactions).toBeGreaterThanOrEqual(1);
  });

  it('redacts Bearer token in Authorization header', () => {
    const msg = `Request failed. Authorization: Bearer eyJhbGciOiJub25lIn0.abc.def extra`;
    const r = sanitiseError(msg);
    expect(r.message).not.toContain('eyJhbGciOiJub25lIn0');
    expect(r.redactions).toBeGreaterThanOrEqual(1);
  });

  it('redacts GitHub token gho_', () => {
    const err = new Error(`Token: gho_A1B2C3D4E5F6G7H8I9J0K1L2`);
    const r = sanitiseError(err);
    expect(r.message).not.toContain('gho_A1B2');
    expect(r.message).toContain('ghX_REDACTED');
  });

  it('redacts GitHub token ghp_', () => {
    const err = new Error(`Token: ghp_ABCDEFGHIJKLMNOPQ`);
    const r = sanitiseError(err);
    expect(r.message).toContain('ghX_REDACTED');
  });

  it('redacts Google API key AIza...', () => {
    const key = 'AIza' + 'A'.repeat(35);
    const err = new Error(`google key=${key}`);
    const r = sanitiseError(err);
    expect(r.message).not.toContain(key);
    expect(r.message).toContain('AIza-REDACTED');
  });

  it('redacts GitLab PAT glpat-...', () => {
    const pat = 'glpat-' + 'abcdefghijklmnopqrst';
    const err = new Error(`gitlab token: ${pat}`);
    const r = sanitiseError(err);
    expect(r.message).not.toContain(pat);
    expect(r.message).toContain('glpat-REDACTED');
  });

  it('redacts Slack bot token xoxb-', () => {
    const tok = 'xoxb-123456789-abcdef';
    const err = new Error(`slack: ${tok}`);
    const r = sanitiseError(err);
    expect(r.message).not.toContain(tok);
    expect(r.message).toContain('xoxb-REDACTED');
  });

  it('redacts a full JWT token', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const r = sanitiseError(`auth token: ${jwt}`);
    expect(r.message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(r.message).toContain('JWT-REDACTED');
  });

  it('redacts Authorization header value (case-insensitive key)', () => {
    const r1 = sanitiseError('header: Authorization: secretvalue12345678901234567890');
    expect(r1.message).toContain('REDACTED');
    expect(r1.message).not.toContain('secretvalue');

    const r2 = sanitiseError('header: authorization: secretvalue12345678901234567890');
    expect(r2.message).toContain('REDACTED');
  });
});

// ─── Path redaction ───────────────────────────────────────────────────────────

describe('sanitiseError — path redaction', () => {
  it('collapses homeDir to ~', () => {
    const r = sanitiseError(`file at ${HOME}/secrets/key.pem`);
    expect(r.message).not.toContain(HOME);
    expect(r.message).toContain('~/secrets/key.pem');
  });

  it('collapses cwd to .', () => {
    const r = sanitiseError(`file at ${CWD}/src/index.ts`);
    expect(r.message).not.toContain(CWD);
    expect(r.message).toContain('./src/index.ts');
  });

  it('replaces /Users/otherperson/... when not own homeDir', () => {
    const r = sanitiseError('/Users/foo/secret/file.txt', { homeDir: '/Users/bar', cwd: '/nonexistent' });
    expect(r.message).not.toContain('/Users/foo/');
    expect(r.message).toContain('/Users/USER');
  });
});

// ─── PII redaction ────────────────────────────────────────────────────────────

describe('sanitiseError — PII redaction', () => {
  it('redacts email addresses', () => {
    const r = sanitiseError('contact user@example.com for help');
    expect(r.message).not.toContain('user@example.com');
    expect(r.message).toContain('[email]');
  });

  it('redacts IPv4 addresses', () => {
    const r = sanitiseError('connection to 192.168.1.1 failed');
    expect(r.message).not.toContain('192.168.1.1');
    expect(r.message).toContain('[ip]');
  });

  it('does NOT redact IPv6 addresses (out of scope)', () => {
    const ipv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    const r = sanitiseError(`connect to ${ipv6}`);
    expect(r.message).toContain(ipv6);
  });
});

// ─── Multiple secrets ─────────────────────────────────────────────────────────

describe('sanitiseError — multiple secrets', () => {
  it('redacts multiple secrets in one message', () => {
    const msg = `key=sk-xxxxxxxxxxxxxxxx, email=admin@corp.com, ip=10.0.0.1`;
    const r = sanitiseError(msg);
    expect(r.message).toContain('sk-REDACTED');
    expect(r.message).toContain('[email]');
    expect(r.message).toContain('[ip]');
    expect(r.redactions).toBeGreaterThanOrEqual(3);
  });

  it('redactions count reflects all matches accurately', () => {
    const msg = `sk-aaaaaaaaaaaaaaaa and sk-bbbbbbbbbbbbbbbb two keys`;
    const r = sanitiseError(msg);
    expect(r.redactions).toBeGreaterThanOrEqual(2);
  });
});

// ─── Stack trace ──────────────────────────────────────────────────────────────

describe('sanitiseError — stack trace', () => {
  it('includeStack=true appends sanitised stack', () => {
    const err = new Error('boom');
    const r = sanitiseError(err, { includeStack: true });
    expect(r.message).toContain('boom');
    expect(r.message).toContain('Error:');
  });

  it('includeStack=false omits stack (default)', () => {
    const err = new Error('boom');
    const r = sanitiseError(err, { includeStack: false });
    expect(r.message).toBe('boom');
    expect(r.message).not.toContain('at ');
  });
});

// ─── Truncation ───────────────────────────────────────────────────────────────

describe('sanitiseError — truncation', () => {
  it('truncates to maxLength with suffix and sets truncated=true', () => {
    const long = 'x'.repeat(2000);
    const r = sanitiseError(long, { maxLength: 100 });
    expect(r.truncated).toBe(true);
    expect(r.message).toContain('… (truncated)');
    expect(r.message.length).toBeLessThanOrEqual(115); // 100 + suffix
  });

  it('does not truncate when message is within maxLength', () => {
    const r = sanitiseError('short message', { maxLength: 100 });
    expect(r.truncated).toBe(false);
    expect(r.message).toBe('short message');
  });
});

// ─── Input type handling ──────────────────────────────────────────────────────

describe('sanitiseError — input types', () => {
  it('plain string used as-is', () => {
    const r = sanitiseError('plain string error');
    expect(r.message).toBe('plain string error');
  });

  it('null → "Unknown error"', () => {
    const r = sanitiseError(null);
    expect(r.message).toBe('Unknown error');
  });

  it('plain object with message property → uses .message', () => {
    const r = sanitiseError({ message: 'object message' });
    expect(r.message).toBe('object message');
  });

  it('circular object → falls back gracefully without throwing', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj['self'] = obj;
    expect(() => sanitiseError(obj)).not.toThrow();
    const r = sanitiseError(obj);
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(0);
  });
});

// ─── Extra patterns ───────────────────────────────────────────────────────────

describe('sanitiseError — extraPatterns', () => {
  it('applies custom extra patterns', () => {
    const r = sanitiseError('password=hunter2 in config', {
      extraPatterns: [{ pattern: /password=[^\s]+/g, replacement: 'password=REDACTED' }],
    });
    expect(r.message).not.toContain('hunter2');
    expect(r.message).toContain('password=REDACTED');
    expect(r.redactions).toBeGreaterThanOrEqual(1);
  });
});

// ─── formatErrorForTelegram ───────────────────────────────────────────────────

describe('formatErrorForTelegram', () => {
  it('prefixes single-line error with ❌ Error:', () => {
    const out = formatErrorForTelegram('something went wrong');
    expect(out).toBe('❌ Error: something went wrong');
  });

  it('prefixes multiline error with newline separator', () => {
    const out = formatErrorForTelegram('line1\nline2');
    expect(out).toContain('❌ Error:\n');
  });

  it('appends truncation note when truncated', () => {
    const long = 'x'.repeat(2000);
    const out = formatErrorForTelegram(long, { maxLength: 50 });
    expect(out).toContain('_(message truncated)_');
  });
});
