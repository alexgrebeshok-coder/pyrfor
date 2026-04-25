// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRedactionPipeline,
  BUILTIN_RULES,
  RULE_EMAIL,
  RULE_PHONE,
  RULE_CREDIT_CARD,
  RULE_SSN_US,
  RULE_IPV4,
  RULE_AWS_KEY,
  RULE_BEARER,
  RULE_API_KEY,
  RULE_PRIVATE_KEY_PEM,
} from './redaction-pipeline';
import type { RedactionRule } from './redaction-pipeline';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePipeline(...extraRules: RedactionRule[]) {
  const p = createRedactionPipeline({ rules: BUILTIN_RULES.map((r) => ({ ...r })) });
  for (const r of extraRules) p.addRule(r);
  return p;
}

// ─── BUILTIN_RULES constant ────────────────────────────────────────────────────

describe('BUILTIN_RULES', () => {
  it('has exactly 9 entries', () => {
    expect(BUILTIN_RULES).toHaveLength(9);
  });

  it('all entries have a name and pattern', () => {
    for (const r of BUILTIN_RULES) {
      expect(r.name).toBeTruthy();
      expect(r.pattern).toBeInstanceOf(RegExp);
    }
  });
});

// ─── Individual built-in rules ────────────────────────────────────────────────

describe('RULE_EMAIL', () => {
  it('redacts a plain email', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL] });
    expect(p.redact('contact me at alice@example.com please').redacted).toBe(
      'contact me at [EMAIL] please',
    );
  });

  it('redacts multiple emails in one string', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL] });
    const r = p.redact('from: a@b.com to: c@d.org');
    expect(r.redacted).toBe('from: [EMAIL] to: [EMAIL]');
    expect(r.matches).toHaveLength(2);
  });
});

describe('RULE_PHONE', () => {
  it('redacts a US phone number', () => {
    const p = createRedactionPipeline({ rules: [RULE_PHONE] });
    expect(p.redact('call 555-867-5309 now').redacted).toContain('[PHONE]');
  });

  it('redacts international phone with country code', () => {
    const p = createRedactionPipeline({ rules: [RULE_PHONE] });
    expect(p.redact('+1 800 555 1234').redacted).toContain('[PHONE]');
  });

  it('redacts phone with parentheses', () => {
    const p = createRedactionPipeline({ rules: [RULE_PHONE] });
    expect(p.redact('(415) 555-2671').redacted).toContain('[PHONE]');
  });
});

describe('RULE_CREDIT_CARD', () => {
  it('redacts a 16-digit credit card', () => {
    const p = createRedactionPipeline({ rules: [RULE_CREDIT_CARD] });
    expect(p.redact('card: 4111111111111111').redacted).toContain('[CARD]');
  });

  it('redacts a dashed credit card', () => {
    const p = createRedactionPipeline({ rules: [RULE_CREDIT_CARD] });
    expect(p.redact('4111-1111-1111-1111').redacted).toContain('[CARD]');
  });
});

describe('RULE_SSN_US', () => {
  it('redacts a US SSN', () => {
    const p = createRedactionPipeline({ rules: [RULE_SSN_US] });
    expect(p.redact('SSN: 123-45-6789').redacted).toBe('SSN: [SSN]');
  });
});

describe('RULE_IPV4', () => {
  it('redacts an IPv4 address', () => {
    const p = createRedactionPipeline({ rules: [RULE_IPV4] });
    expect(p.redact('server at 192.168.1.1 port 80').redacted).toBe('server at [IP] port 80');
  });
});

describe('RULE_AWS_KEY', () => {
  it('redacts an AWS access key', () => {
    const p = createRedactionPipeline({ rules: [RULE_AWS_KEY] });
    expect(p.redact('key=AKIAIOSFODNN7EXAMPLE').redacted).toContain('[AWS_KEY]');
  });
});

describe('RULE_BEARER', () => {
  it('redacts a Bearer token', () => {
    const p = createRedactionPipeline({ rules: [RULE_BEARER] });
    expect(p.redact('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9').redacted).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });
});

describe('RULE_API_KEY', () => {
  it('redacts sk_live_ key', () => {
    const p = createRedactionPipeline({ rules: [RULE_API_KEY] });
    expect(p.redact('key=sk_live_abcdefghijklmnop').redacted).toContain('[API_KEY]');
  });

  it('redacts pk_ key', () => {
    const p = createRedactionPipeline({ rules: [RULE_API_KEY] });
    expect(p.redact('pk_test_abcdefghijklmnopqrstuvwx').redacted).toContain('[API_KEY]');
  });

  it('redacts tok_live_ key', () => {
    const p = createRedactionPipeline({ rules: [RULE_API_KEY] });
    expect(p.redact('tok_live_abcdefghijklmnop').redacted).toContain('[API_KEY]');
  });
});

describe('RULE_PRIVATE_KEY_PEM', () => {
  it('redacts a PEM private key block', () => {
    const p = createRedactionPipeline({ rules: [RULE_PRIVATE_KEY_PEM] });
    const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4PAtEsHAFPbdiRMhFnXxzFXWw==
-----END RSA PRIVATE KEY-----`;
    expect(p.redact(pem).redacted).toBe('[PRIVATE_KEY]');
  });

  it('redacts EC PRIVATE KEY', () => {
    const p = createRedactionPipeline({ rules: [RULE_PRIVATE_KEY_PEM] });
    const pem = `-----BEGIN EC PRIVATE KEY-----
abc123==
-----END EC PRIVATE KEY-----`;
    expect(p.redact(pem).redacted).toBe('[PRIVATE_KEY]');
  });
});

// ─── Multi-rule in one string ─────────────────────────────────────────────────

describe('multiple rules applied', () => {
  it('redacts both email and SSN in one string', () => {
    // Use explicit rule order so SSN is processed before PHONE
    const p = createRedactionPipeline({ rules: [RULE_EMAIL, RULE_SSN_US] });
    const r = p.redact('email: bob@test.com ssn: 987-65-4321');
    expect(r.redacted).toBe('email: [EMAIL] ssn: [SSN]');
    expect(r.matches.some((m) => m.rule === 'email')).toBe(true);
    expect(r.matches.some((m) => m.rule === 'ssn_us')).toBe(true);
  });

  it('applies rules in registration order', () => {
    const p = createRedactionPipeline();
    p.addRule({ name: 'foo', pattern: /foo/g, replacement: 'bar' });
    p.addRule({ name: 'bar', pattern: /bar/g, replacement: 'baz' });
    // foo→bar, then bar→baz, so "foo" becomes "baz"
    expect(p.redact('foo').redacted).toBe('baz');
  });
});

// ─── result.matches ───────────────────────────────────────────────────────────

describe('result.matches', () => {
  it('has rule, original, replacement, index fields', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL] });
    const r = p.redact('send to alice@example.com');
    expect(r.matches).toHaveLength(1);
    const m = r.matches[0];
    expect(m.rule).toBe('email');
    expect(m.original).toBe('alice@example.com');
    expect(m.replacement).toBe('[EMAIL]');
    expect(typeof m.index).toBe('number');
  });

  it('index points to the position in the processed string at that rule stage', () => {
    const p = createRedactionPipeline({ rules: [RULE_SSN_US] });
    const r = p.redact('SSN: 123-45-6789');
    expect(r.matches[0].index).toBe(5);
  });
});

// ─── Function replacement ─────────────────────────────────────────────────────

describe('function replacement', () => {
  it('calls function with matched string', () => {
    const calls: string[] = [];
    const rule: RedactionRule = {
      name: 'custom',
      pattern: /\d+/g,
      replacement: (match) => {
        calls.push(match);
        return `[NUM:${match.length}]`;
      },
    };
    const p = createRedactionPipeline({ rules: [rule] });
    const r = p.redact('abc 123 def 45');
    expect(r.redacted).toBe('abc [NUM:3] def [NUM:2]');
    expect(calls).toEqual(['123', '45']);
  });

  it('passes capture groups to function', () => {
    const rule: RedactionRule = {
      name: 'grouped',
      pattern: /(\w+)@(\w+)/g,
      replacement: (_full, user, domain) => `[${user}@HIDDEN.${domain}]`,
    };
    const p = createRedactionPipeline({ rules: [rule] });
    expect(p.redact('alice@example').redacted).toBe('[alice@HIDDEN.example]');
  });
});

// ─── addRule / removeRule ─────────────────────────────────────────────────────

describe('addRule / removeRule', () => {
  it('addRule appends and applies a new rule', () => {
    const p = createRedactionPipeline();
    p.addRule({ name: 'secret', pattern: /secret/gi, replacement: '[SECRET]' });
    expect(p.redact('keep it secret').redacted).toBe('keep it [SECRET]');
  });

  it('removeRule returns true and stops applying rule', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL] });
    expect(p.removeRule('email')).toBe(true);
    expect(p.redact('alice@example.com').redacted).toBe('alice@example.com');
  });

  it('removeRule returns false for unknown rule', () => {
    const p = createRedactionPipeline();
    expect(p.removeRule('nonexistent')).toBe(false);
  });
});

// ─── enableRule / disableRule ─────────────────────────────────────────────────

describe('enableRule / disableRule', () => {
  it('disableRule prevents the rule from applying', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL] });
    expect(p.disableRule('email')).toBe(true);
    expect(p.redact('alice@example.com').redacted).toBe('alice@example.com');
  });

  it('enableRule re-activates a disabled rule', () => {
    const p = createRedactionPipeline({
      rules: [{ ...RULE_EMAIL, enabled: false }],
    });
    expect(p.redact('alice@example.com').redacted).toBe('alice@example.com');
    p.enableRule('email');
    expect(p.redact('alice@example.com').redacted).toBe('[EMAIL]');
  });

  it('enableRule returns false for unknown rule', () => {
    const p = createRedactionPipeline();
    expect(p.enableRule('ghost')).toBe(false);
  });

  it('disableRule returns false for unknown rule', () => {
    const p = createRedactionPipeline();
    expect(p.disableRule('ghost')).toBe(false);
  });

  it('disabled rule is skipped', () => {
    const p = createRedactionPipeline({ rules: [RULE_SSN_US] });
    p.disableRule('ssn_us');
    const r = p.redact('SSN: 123-45-6789');
    expect(r.redacted).toBe('SSN: 123-45-6789');
    expect(r.matches).toHaveLength(0);
  });
});

// ─── list() ───────────────────────────────────────────────────────────────────

describe('list()', () => {
  it('returns current rules', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL, RULE_SSN_US] });
    const names = p.list().map((r) => r.name);
    expect(names).toEqual(['email', 'ssn_us']);
  });

  it('reflects adds and removes', () => {
    const p = createRedactionPipeline();
    p.addRule({ name: 'r1', pattern: /x/g });
    p.addRule({ name: 'r2', pattern: /y/g });
    p.removeRule('r1');
    expect(p.list().map((r) => r.name)).toEqual(['r2']);
  });
});

// ─── getStats() ───────────────────────────────────────────────────────────────

describe('getStats()', () => {
  it('counts total and per-rule redactions', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL, RULE_SSN_US] });
    p.redact('a@b.com and 123-45-6789');
    p.redact('c@d.org');
    const s = p.getStats();
    expect(s.totalRedactions).toBe(3);
    expect(s.perRule['email']).toBe(2);
    expect(s.perRule['ssn_us']).toBe(1);
  });

  it('starts at zero', () => {
    const p = createRedactionPipeline();
    expect(p.getStats()).toEqual({ totalRedactions: 0, perRule: {} });
  });
});

// ─── Empty text ───────────────────────────────────────────────────────────────

describe('empty text', () => {
  it('returns empty string and no matches', () => {
    const p = makePipeline();
    const r = p.redact('');
    expect(r.redacted).toBe('');
    expect(r.matches).toEqual([]);
  });
});

// ─── redactObject ─────────────────────────────────────────────────────────────

describe('redactObject', () => {
  it('deep walks and redacts string values', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL] });
    const obj = { user: { email: 'alice@example.com', name: 'Alice' } };
    const out = p.redactObject(obj);
    expect((out as typeof obj).user.email).toBe('[EMAIL]');
    expect((out as typeof obj).user.name).toBe('Alice');
  });

  it('preserves object structure', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL] });
    const obj = { a: 1, b: true, c: null, d: 'alice@example.com' };
    const out = p.redactObject(obj) as typeof obj;
    expect(out.a).toBe(1);
    expect(out.b).toBe(true);
    expect(out.c).toBe(null);
    expect(out.d).toBe('[EMAIL]');
  });

  it('handles arrays', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL] });
    const arr = ['alice@example.com', 'bob@test.org', 'plain text'];
    const out = p.redactObject(arr) as typeof arr;
    expect(out[0]).toBe('[EMAIL]');
    expect(out[1]).toBe('[EMAIL]');
    expect(out[2]).toBe('plain text');
  });

  it('redactKeys masks any value type by key (case-insensitive)', () => {
    const p = createRedactionPipeline();
    const obj = { Password: 'secret123', token: 42, name: 'Alice' };
    const out = p.redactObject(obj, { redactKeys: ['password', 'TOKEN'] }) as typeof obj;
    expect(out.Password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.name).toBe('Alice');
  });

  it('is cycle-safe', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL] });
    const a: Record<string, unknown> = { email: 'alice@example.com' };
    a['self'] = a; // cycle
    expect(() => p.redactObject(a)).not.toThrow();
  });

  it('respects depth cap', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL] });
    const deep = { l1: { l2: { l3: 'alice@example.com' } } };
    // depth: 1 → only l1 level is walked (l2 object returned as-is at depth 2)
    const out = p.redactObject(deep, { depth: 1 }) as typeof deep;
    // l3 should NOT be redacted because depth cap stops walking at l2
    expect(out.l1.l2.l3).toBe('alice@example.com');
  });

  it('nested arrays are handled', () => {
    const p = createRedactionPipeline({ rules: [RULE_SSN_US] });
    const data = { records: ['123-45-6789', '987-65-4321'] };
    const out = p.redactObject(data) as typeof data;
    expect(out.records[0]).toBe('[SSN]');
    expect(out.records[1]).toBe('[SSN]');
  });

  it('non-string primitives are left alone', () => {
    const p = createRedactionPipeline({ rules: [RULE_EMAIL] });
    const obj = { count: 42, flag: false, nothing: null };
    const out = p.redactObject(obj) as typeof obj;
    expect(out.count).toBe(42);
    expect(out.flag).toBe(false);
    expect(out.nothing).toBe(null);
  });
});

// ─── defaultReplacement ───────────────────────────────────────────────────────

describe('defaultReplacement', () => {
  it('uses custom default when rule has no replacement', () => {
    const p = createRedactionPipeline({ defaultReplacement: '***' });
    p.addRule({ name: 'digits', pattern: /\d+/g });
    expect(p.redact('pin 1234').redacted).toBe('pin ***');
  });

  it('defaultReplacement used for redactKeys', () => {
    const p = createRedactionPipeline({ defaultReplacement: '<hidden>' });
    const obj = { secret: 'value' };
    const out = p.redactObject(obj, { redactKeys: ['secret'] }) as typeof obj;
    expect(out.secret).toBe('<hidden>');
  });
});
