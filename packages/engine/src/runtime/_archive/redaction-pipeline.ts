/**
 * redaction-pipeline.ts — Apply ordered rules to redact PII/secrets in strings and objects.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement?: string | ((match: string, ...groups: string[]) => string);
  enabled?: boolean;
}

export interface RedactionResult {
  redacted: string;
  matches: Array<{ rule: string; original: string; replacement: string; index: number }>;
}

// ─── Built-in rule constants ───────────────────────────────────────────────────

export const RULE_EMAIL: RedactionRule = {
  name: 'email',
  pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
  replacement: '[EMAIL]',
  enabled: true,
};

export const RULE_PHONE: RedactionRule = {
  name: 'phone',
  pattern: /\b\+?\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{2,4}[\s-]?\d{2,4}\b/g,
  replacement: '[PHONE]',
  enabled: true,
};

export const RULE_CREDIT_CARD: RedactionRule = {
  name: 'credit_card',
  pattern: /\b(?:\d[ -]*?){13,19}\b/g,
  replacement: '[CARD]',
  enabled: true,
};

export const RULE_SSN_US: RedactionRule = {
  name: 'ssn_us',
  pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
  replacement: '[SSN]',
  enabled: true,
};

export const RULE_IPV4: RedactionRule = {
  name: 'ipv4',
  pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  replacement: '[IP]',
  enabled: true,
};

export const RULE_AWS_KEY: RedactionRule = {
  name: 'aws_key',
  pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  replacement: '[AWS_KEY]',
  enabled: true,
};

export const RULE_BEARER: RedactionRule = {
  name: 'bearer',
  pattern: /\bBearer\s+[A-Za-z0-9._\-]+/g,
  replacement: 'Bearer [REDACTED]',
  enabled: true,
};

export const RULE_API_KEY: RedactionRule = {
  name: 'api_key',
  pattern: /\b(?:sk|pk|tok)_(?:live|test)?_?[A-Za-z0-9]{16,}\b/g,
  replacement: '[API_KEY]',
  enabled: true,
};

export const RULE_PRIVATE_KEY_PEM: RedactionRule = {
  name: 'private_key_pem',
  pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
  replacement: '[PRIVATE_KEY]',
  enabled: true,
};

export const BUILTIN_RULES: RedactionRule[] = [
  RULE_EMAIL,
  RULE_PHONE,
  RULE_CREDIT_CARD,
  RULE_SSN_US,
  RULE_IPV4,
  RULE_AWS_KEY,
  RULE_BEARER,
  RULE_API_KEY,
  RULE_PRIVATE_KEY_PEM,
];

// ─── Pipeline factory ──────────────────────────────────────────────────────────

export interface RedactionPipeline {
  addRule(rule: RedactionRule): void;
  removeRule(name: string): boolean;
  enableRule(name: string): boolean;
  disableRule(name: string): boolean;
  redact(text: string): RedactionResult;
  redactObject<T>(obj: T, opts?: { redactKeys?: string[]; depth?: number }): T;
  list(): RedactionRule[];
  getStats(): { totalRedactions: number; perRule: Record<string, number> };
}

export function createRedactionPipeline(opts?: {
  rules?: RedactionRule[];
  defaultReplacement?: string;
}): RedactionPipeline {
  const defaultReplacement = opts?.defaultReplacement ?? '[REDACTED]';

  // Clone rules to avoid mutating caller's objects
  const rules: RedactionRule[] = (opts?.rules ?? []).map((r) => ({
    ...r,
    enabled: r.enabled !== false,
    pattern: cloneRegExp(r.pattern),
  }));

  const stats: { totalRedactions: number; perRule: Record<string, number> } = {
    totalRedactions: 0,
    perRule: {},
  };

  function cloneRegExp(re: RegExp): RegExp {
    return new RegExp(re.source, re.flags);
  }

  function addRule(rule: RedactionRule): void {
    rules.push({
      ...rule,
      enabled: rule.enabled !== false,
      pattern: cloneRegExp(rule.pattern),
    });
  }

  function removeRule(name: string): boolean {
    const idx = rules.findIndex((r) => r.name === name);
    if (idx === -1) return false;
    rules.splice(idx, 1);
    return true;
  }

  function enableRule(name: string): boolean {
    const rule = rules.find((r) => r.name === name);
    if (!rule) return false;
    rule.enabled = true;
    return true;
  }

  function disableRule(name: string): boolean {
    const rule = rules.find((r) => r.name === name);
    if (!rule) return false;
    rule.enabled = false;
    return true;
  }

  function redact(text: string): RedactionResult {
    if (text === '') return { redacted: '', matches: [] };

    const matchList: RedactionResult['matches'] = [];
    let current = text;

    for (const rule of rules) {
      if (rule.enabled === false) continue;

      const re = cloneRegExp(rule.pattern);
      const repl = rule.replacement ?? defaultReplacement;

      let result = '';
      let lastIndex = 0;
      let m: RegExpExecArray | null;

      while ((m = re.exec(current)) !== null) {
        const original = m[0];
        let replacement: string;

        if (typeof repl === 'function') {
          replacement = repl(m[0], ...m.slice(1));
        } else {
          replacement = repl;
        }

        // Compute index in the *accumulated* current string
        const index = m.index;

        matchList.push({ rule: rule.name, original, replacement, index });

        // Track stats
        stats.totalRedactions += 1;
        stats.perRule[rule.name] = (stats.perRule[rule.name] ?? 0) + 1;

        result += current.slice(lastIndex, index) + replacement;
        lastIndex = index + original.length;

        // Prevent infinite loop on zero-length matches
        if (re.lastIndex === m.index) re.lastIndex++;
      }

      current = result + current.slice(lastIndex);
    }

    return { redacted: current, matches: matchList };
  }

  function redactObject<T>(obj: T, opts?: { redactKeys?: string[]; depth?: number }): T {
    const maxDepth = opts?.depth ?? Infinity;
    const redactKeys = (opts?.redactKeys ?? []).map((k) => k.toLowerCase());
    const seen = new WeakSet<object>();

    function walk(val: unknown, depth: number, key?: string): unknown {
      // Check if this key should be fully masked
      if (key !== undefined && redactKeys.includes(key.toLowerCase())) {
        return defaultReplacement;
      }

      if (typeof val === 'string') {
        return redact(val).redacted;
      }

      if (val === null || typeof val !== 'object') {
        return val;
      }

      if (depth >= maxDepth) {
        return val;
      }

      if (seen.has(val as object)) {
        return val;
      }
      seen.add(val as object);

      if (Array.isArray(val)) {
        const arr = val.map((item) => walk(item, depth + 1));
        seen.delete(val as object);
        return arr;
      }

      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        out[k] = walk(v, depth + 1, k);
      }
      seen.delete(val as object);
      return out;
    }

    return walk(obj, 0) as T;
  }

  function list(): RedactionRule[] {
    return rules.map((r) => ({ ...r, pattern: cloneRegExp(r.pattern) }));
  }

  function getStats() {
    return {
      totalRedactions: stats.totalRedactions,
      perRule: { ...stats.perRule },
    };
  }

  return { addRule, removeRule, enableRule, disableRule, redact, redactObject, list, getStats };
}
