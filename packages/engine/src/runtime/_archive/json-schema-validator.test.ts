// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  createValidator,
  validateOnce,
  compile,
  type ValidationError,
  type ValidateResult,
} from './json-schema-validator.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function valid(r: ValidateResult) {
  expect(r.valid).toBe(true);
  expect(r.errors).toHaveLength(0);
}

function invalid(r: ValidateResult, keywordHint?: string) {
  expect(r.valid).toBe(false);
  expect(r.errors.length).toBeGreaterThan(0);
  if (keywordHint) {
    expect(r.errors.some((e: ValidationError) => e.keyword === keywordHint)).toBe(true);
  }
}

function errPaths(r: ValidateResult) {
  return r.errors.map((e: ValidationError) => e.path);
}

// ─── type checks ──────────────────────────────────────────────────────────────

describe('type: string', () => {
  const schema = { type: 'string' };
  it('accepts a string', () => valid(validateOnce(schema, 'hello')));
  it('rejects a number', () => invalid(validateOnce(schema, 42), 'type'));
  it('rejects null', () => invalid(validateOnce(schema, null), 'type'));
  it('rejects undefined (non-string)', () => invalid(validateOnce(schema, undefined), 'type'));
});

describe('type: number', () => {
  const schema = { type: 'number' };
  it('accepts an integer', () => valid(validateOnce(schema, 3)));
  it('accepts a float', () => valid(validateOnce(schema, 3.14)));
  it('rejects a string', () => invalid(validateOnce(schema, '3.14'), 'type'));
});

describe('type: integer', () => {
  const schema = { type: 'integer' };
  it('accepts 0', () => valid(validateOnce(schema, 0)));
  it('accepts positive integer', () => valid(validateOnce(schema, 7)));
  it('rejects 1.5', () => invalid(validateOnce(schema, 1.5), 'type'));
  it('rejects a string', () => invalid(validateOnce(schema, '5'), 'type'));
});

describe('type: boolean', () => {
  const schema = { type: 'boolean' };
  it('accepts true', () => valid(validateOnce(schema, true)));
  it('accepts false', () => valid(validateOnce(schema, false)));
  it('rejects 0', () => invalid(validateOnce(schema, 0), 'type'));
});

describe('type: object', () => {
  const schema = { type: 'object' };
  it('accepts {}', () => valid(validateOnce(schema, {})));
  it('rejects array', () => invalid(validateOnce(schema, []), 'type'));
  it('rejects null', () => invalid(validateOnce(schema, null), 'type'));
});

describe('type: array', () => {
  const schema = { type: 'array' };
  it('accepts []', () => valid(validateOnce(schema, [])));
  it('rejects {}', () => invalid(validateOnce(schema, {}), 'type'));
});

describe('type: null', () => {
  const schema = { type: 'null' };
  it('accepts null', () => valid(validateOnce(schema, null)));
  it('rejects 0', () => invalid(validateOnce(schema, 0), 'type'));
});

// ─── enum ─────────────────────────────────────────────────────────────────────

describe('enum', () => {
  const schema = { enum: ['a', 'b', 1, null] };
  it('accepts matching string', () => valid(validateOnce(schema, 'a')));
  it('accepts matching number', () => valid(validateOnce(schema, 1)));
  it('accepts null', () => valid(validateOnce(schema, null)));
  it('rejects non-member', () => invalid(validateOnce(schema, 'c'), 'enum'));
  it('rejects wrong type even if value looks similar', () =>
    invalid(validateOnce(schema, '1'), 'enum'));
});

// ─── const ────────────────────────────────────────────────────────────────────

describe('const', () => {
  it('accepts exact match', () => valid(validateOnce({ const: 42 }, 42)));
  it('rejects mismatch', () => invalid(validateOnce({ const: 42 }, 43), 'const'));
  it('accepts deep-equal object', () =>
    valid(validateOnce({ const: { x: 1 } }, { x: 1 })));
  it('rejects partial object', () =>
    invalid(validateOnce({ const: { x: 1 } }, { x: 1, y: 2 }), 'const'));
});

// ─── required + properties ───────────────────────────────────────────────────

describe('required', () => {
  const schema = {
    type: 'object',
    required: ['name', 'age'],
    properties: {
      name: { type: 'string' },
      age: { type: 'integer' },
    },
  };

  it('passes when all required props present', () =>
    valid(validateOnce(schema, { name: 'Alice', age: 30 })));

  it('error path is /name when name missing', () => {
    const r = validateOnce(schema, { age: 30 });
    expect(r.valid).toBe(false);
    expect(errPaths(r)).toContain('/name');
  });

  it('error path is /age when age missing', () => {
    const r = validateOnce(schema, { name: 'Bob' });
    expect(errPaths(r)).toContain('/age');
  });

  it('validates property type at /age', () => {
    const r = validateOnce(schema, { name: 'Bob', age: 'old' });
    expect(r.valid).toBe(false);
    expect(errPaths(r)).toContain('/age');
  });
});

// ─── additionalProperties ─────────────────────────────────────────────────────

describe('additionalProperties: false', () => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'string' } },
    additionalProperties: false,
  };

  it('allows only defined keys', () => valid(validateOnce(schema, { a: 'hi' })));
  it('rejects extra key', () => {
    const r = validateOnce(schema, { a: 'hi', b: 1 });
    invalid(r, 'additionalProperties');
    expect(errPaths(r)).toContain('/b');
  });
});

describe('additionalProperties: schema', () => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'string' } },
    additionalProperties: { type: 'number' },
  };

  it('allows extra key matching schema', () => valid(validateOnce(schema, { a: 'hi', b: 99 })));
  it('rejects extra key not matching schema', () => {
    const r = validateOnce(schema, { a: 'hi', b: 'oops' });
    invalid(r, 'type');
    expect(errPaths(r)).toContain('/b');
  });
});

// ─── patternProperties ────────────────────────────────────────────────────────

describe('patternProperties', () => {
  const schema = {
    type: 'object',
    patternProperties: {
      '^S_': { type: 'string' },
      '^I_': { type: 'integer' },
    },
  };

  it('validates keys matching ^S_ as string', () =>
    valid(validateOnce(schema, { S_name: 'Alice', I_count: 5 })));

  it('rejects ^S_ key with non-string', () => {
    const r = validateOnce(schema, { S_name: 123 });
    invalid(r, 'type');
    expect(errPaths(r)).toContain('/S_name');
  });

  it('ignores keys not matching any pattern', () =>
    valid(validateOnce(schema, { other: true })));
});

// ─── items — single schema ────────────────────────────────────────────────────

describe('items: single schema', () => {
  const schema = { type: 'array', items: { type: 'number' } };
  it('validates all items', () => valid(validateOnce(schema, [1, 2, 3])));
  it('rejects if any item fails', () => {
    const r = validateOnce(schema, [1, 'x', 3]);
    invalid(r, 'type');
    expect(errPaths(r)).toContain('/1');
  });
});

// ─── items — tuple ────────────────────────────────────────────────────────────

describe('items: tuple', () => {
  const schema = {
    type: 'array',
    items: [{ type: 'string' }, { type: 'integer' }],
  };

  it('passes valid tuple', () => valid(validateOnce(schema, ['hello', 5])));
  it('rejects wrong type at index 0', () => {
    const r = validateOnce(schema, [5, 5]);
    invalid(r, 'type');
    expect(errPaths(r)).toContain('/0');
  });
  it('rejects wrong type at index 1', () => {
    const r = validateOnce(schema, ['hello', 'world']);
    invalid(r, 'type');
    expect(errPaths(r)).toContain('/1');
  });
  it('allows extra items beyond tuple by default', () =>
    valid(validateOnce(schema, ['hello', 5, 'extra'])));
});

// ─── minItems / maxItems ──────────────────────────────────────────────────────

describe('minItems / maxItems', () => {
  it('minItems: passes when length >= min', () =>
    valid(validateOnce({ minItems: 2 }, [1, 2])));
  it('minItems: fails when length < min', () =>
    invalid(validateOnce({ minItems: 2 }, [1]), 'minItems'));
  it('maxItems: passes when length <= max', () =>
    valid(validateOnce({ maxItems: 3 }, [1, 2, 3])));
  it('maxItems: fails when length > max', () =>
    invalid(validateOnce({ maxItems: 3 }, [1, 2, 3, 4]), 'maxItems'));
});

// ─── uniqueItems ──────────────────────────────────────────────────────────────

describe('uniqueItems', () => {
  const schema = { type: 'array', uniqueItems: true };

  it('passes unique primitives', () => valid(validateOnce(schema, [1, 2, 3])));
  it('detects duplicate primitives', () =>
    invalid(validateOnce(schema, [1, 2, 1]), 'uniqueItems'));
  it('detects deep-equal objects', () =>
    invalid(validateOnce(schema, [{ a: 1 }, { a: 1 }]), 'uniqueItems'));
  it('passes distinct objects', () =>
    valid(validateOnce(schema, [{ a: 1 }, { a: 2 }])));
});

// ─── string keywords ──────────────────────────────────────────────────────────

describe('minLength / maxLength', () => {
  it('minLength: passes', () => valid(validateOnce({ minLength: 3 }, 'abc')));
  it('minLength: fails', () => invalid(validateOnce({ minLength: 3 }, 'ab'), 'minLength'));
  it('maxLength: passes', () => valid(validateOnce({ maxLength: 5 }, 'hello')));
  it('maxLength: fails', () => invalid(validateOnce({ maxLength: 5 }, 'toolong'), 'maxLength'));
});

describe('pattern', () => {
  const schema = { type: 'string', pattern: '^[0-9]+$' };
  it('matches digits-only string', () => valid(validateOnce(schema, '12345')));
  it('rejects non-digit string', () => invalid(validateOnce(schema, 'abc'), 'pattern'));
});

// ─── number keywords ──────────────────────────────────────────────────────────

describe('minimum / maximum', () => {
  it('minimum: passes equal', () => valid(validateOnce({ minimum: 5 }, 5)));
  it('minimum: fails below', () => invalid(validateOnce({ minimum: 5 }, 4), 'minimum'));
  it('maximum: passes equal', () => valid(validateOnce({ maximum: 10 }, 10)));
  it('maximum: fails above', () => invalid(validateOnce({ maximum: 10 }, 11), 'maximum'));
});

describe('exclusiveMinimum (draft-07 numeric)', () => {
  it('passes above', () => valid(validateOnce({ exclusiveMinimum: 5 }, 6)));
  it('fails equal', () => invalid(validateOnce({ exclusiveMinimum: 5 }, 5), 'exclusiveMinimum'));
  it('fails below', () => invalid(validateOnce({ exclusiveMinimum: 5 }, 4), 'exclusiveMinimum'));
});

describe('exclusiveMaximum (draft-07 numeric)', () => {
  it('passes below', () => valid(validateOnce({ exclusiveMaximum: 10 }, 9)));
  it('fails equal', () =>
    invalid(validateOnce({ exclusiveMaximum: 10 }, 10), 'exclusiveMaximum'));
});

describe('multipleOf', () => {
  it('3 is multiple of 3', () => valid(validateOnce({ multipleOf: 3 }, 9)));
  it('7 is not multiple of 3', () =>
    invalid(validateOnce({ multipleOf: 3 }, 7), 'multipleOf'));
  it('0.3 is multiple of 0.1 (float precision)', () =>
    valid(validateOnce({ multipleOf: 0.1 }, 0.3)));
});

// ─── anyOf / oneOf / allOf / not ─────────────────────────────────────────────

describe('anyOf', () => {
  const schema = { anyOf: [{ type: 'string' }, { type: 'number' }] };
  it('passes when matching first branch', () => valid(validateOnce(schema, 'hello')));
  it('passes when matching second branch', () => valid(validateOnce(schema, 42)));
  it('fails when matching none', () =>
    invalid(validateOnce(schema, true), 'anyOf'));
});

describe('oneOf', () => {
  const schema = {
    oneOf: [
      { type: 'integer', multipleOf: 2 },
      { type: 'integer', multipleOf: 3 },
    ],
  };
  it('passes when exactly one matches (4 → first)', () => valid(validateOnce(schema, 4)));
  it('passes when exactly one matches (9 → second)', () => valid(validateOnce(schema, 9)));
  it('fails when both match (6 is multiple of 2 and 3)', () =>
    invalid(validateOnce(schema, 6), 'oneOf'));
  it('fails when none match', () =>
    invalid(validateOnce(schema, 5), 'oneOf'));
});

describe('allOf', () => {
  const schema = {
    allOf: [{ type: 'number', minimum: 0 }, { type: 'number', maximum: 100 }],
  };
  it('passes when all branches pass', () => valid(validateOnce(schema, 50)));
  it('fails when one branch fails', () =>
    invalid(validateOnce(schema, -1), 'minimum'));
});

describe('not', () => {
  const schema = { not: { type: 'string' } };
  it('passes for non-string', () => valid(validateOnce(schema, 42)));
  it('fails for string (matches "not" schema)', () =>
    invalid(validateOnce(schema, 'hello'), 'not'));
});

// ─── $ref ─────────────────────────────────────────────────────────────────────

describe('$ref to #/definitions/X', () => {
  const schema = {
    type: 'object',
    properties: {
      value: { $ref: '#/definitions/positiveInt' },
    },
    definitions: {
      positiveInt: { type: 'integer', minimum: 1 },
    },
  };

  it('resolves and validates via $ref', () =>
    valid(validateOnce(schema, { value: 5 })));

  it('fails when ref constraint not met', () => {
    const r = validateOnce(schema, { value: 0 });
    invalid(r, 'minimum');
    expect(errPaths(r)).toContain('/value');
  });
});

describe('$ref to #/$defs/X', () => {
  const schema = {
    type: 'object',
    properties: {
      tag: { $ref: '#/$defs/tag' },
    },
    $defs: {
      tag: { type: 'string', minLength: 1 },
    },
  };

  it('resolves #/$defs and validates', () =>
    valid(validateOnce(schema, { tag: 'important' })));

  it('fails when $defs constraint not met', () => {
    const r = validateOnce(schema, { tag: '' });
    invalid(r, 'minLength');
  });
});

describe('circular $ref depth limit', () => {
  // Schema where A → B → A endlessly
  const schema: any = {
    $defs: {
      A: { properties: { child: { $ref: '#/$defs/B' } } },
      B: { properties: { child: { $ref: '#/$defs/A' } } },
    },
    $ref: '#/$defs/A',
  };

  it('stops recursion and reports depth error', () => {
    // Build a deeply nested object to trigger depth limit
    const data: any = {};
    let cur = data;
    for (let i = 0; i < 60; i++) {
      cur.child = {};
      cur = cur.child;
    }
    const r = validateOnce(schema, data);
    // Should terminate (not stack overflow) and report depth error
    expect(r.errors.some(e => e.message.includes('depth') || e.keyword === '$ref')).toBe(true);
  });
});

// ─── error path ───────────────────────────────────────────────────────────────

describe('error path notation', () => {
  it('uses /a/b/0/c for deeply nested errors', () => {
    const schema = {
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: {
            b: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  c: { type: 'string' },
                },
              },
            },
          },
        },
      },
    };
    const r = validateOnce(schema, { a: { b: [{ c: 99 }] } });
    invalid(r, 'type');
    expect(errPaths(r)).toContain('/a/b/0/c');
  });
});

// ─── format ───────────────────────────────────────────────────────────────────

describe('format keyword', () => {
  it('returns valid for email format (not enforced)', () =>
    valid(validateOnce({ type: 'string', format: 'email' }, 'not-an-email')));
  it('returns valid for uri format (not enforced)', () =>
    valid(validateOnce({ type: 'string', format: 'uri' }, 'not-a-uri')));
  it('returns valid for date-time format (not enforced)', () =>
    valid(validateOnce({ type: 'string', format: 'date-time' }, 'not-a-date')));
});

// ─── validateAndCoerce / defaults ────────────────────────────────────────────

describe('validateAndCoerce with defaults', () => {
  const schema = {
    type: 'object',
    properties: {
      role: { type: 'string', default: 'viewer' },
      active: { type: 'boolean', default: true },
    },
  };
  const v = createValidator(schema, { coerceDefaults: true });

  it('applies default when property is missing', () => {
    const { result, data } = v.validateAndCoerce({});
    expect(result.valid).toBe(true);
    expect(data.role).toBe('viewer');
    expect(data.active).toBe(true);
  });

  it('does not overwrite an existing value', () => {
    const { data } = v.validateAndCoerce({ role: 'admin' });
    expect(data.role).toBe('admin');
    expect(data.active).toBe(true); // still fills in missing
  });

  it('does not modify original object', () => {
    const input = { role: 'editor' };
    const { data } = v.validateAndCoerce(input);
    expect(input).not.toHaveProperty('active');
    expect(data.active).toBe(true);
  });
});

// ─── compile ─────────────────────────────────────────────────────────────────

describe('compile', () => {
  it('returns a reusable validator function', () => {
    const validate = compile({ type: 'string', minLength: 2 });
    expect(typeof validate).toBe('function');
    valid(validate('hello'));
    invalid(validate('x'), 'minLength');
    invalid(validate(42), 'type');
  });

  it('is independent of other compiled validators', () => {
    const vStr = compile({ type: 'string' });
    const vNum = compile({ type: 'number' });
    valid(vStr('hi'));
    invalid(vStr(1), 'type');
    valid(vNum(1));
    invalid(vNum('hi'), 'type');
  });
});

// ─── logger option ────────────────────────────────────────────────────────────

describe('logger option', () => {
  it('calls logger on validate', () => {
    const calls: string[] = [];
    const v = createValidator({ type: 'string' }, { logger: (msg) => calls.push(msg) });
    v.validate('hello');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('validate');
  });
});

// ─── validateOnce convenience ────────────────────────────────────────────────

describe('validateOnce', () => {
  it('validates without creating a validator explicitly', () =>
    valid(validateOnce({ type: 'boolean' }, false)));
});
