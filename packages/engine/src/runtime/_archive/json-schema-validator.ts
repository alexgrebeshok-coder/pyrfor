/**
 * Lightweight JSON Schema (draft-07 subset) validator — zero external deps.
 *
 * Supported keywords:
 *   type, enum, const, properties, required, additionalProperties,
 *   patternProperties, items (single | tuple), minItems, maxItems,
 *   uniqueItems, minLength, maxLength, pattern, minimum, maximum,
 *   exclusiveMinimum, exclusiveMaximum, multipleOf,
 *   anyOf, oneOf, allOf, not, $ref (#/definitions/X | #/$defs/X),
 *   default, format (recorded, not enforced)
 */

export type ValidationError = {
  path: string;
  keyword: string;
  message: string;
  expected?: any;
  actual?: any;
};

export type ValidateResult = {
  valid: boolean;
  errors: ValidationError[];
};

// ─── internals ───────────────────────────────────────────────────────────────

const MAX_DEPTH = 50;

type Schema = Record<string, any> | boolean;

function cloneDeep<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEqual((a as any)[k], (b as any)[k]));
  }
  return false;
}

function jsType(value: any): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function resolveRef(ref: string, root: Record<string, any>): Schema | undefined {
  if (!ref.startsWith('#/')) return undefined;
  const parts = ref.slice(2).split('/');
  let cur: any = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur as Schema | undefined;
}

function checkMultipleOf(value: number, factor: number): boolean {
  if (factor === 0) return true;
  // Use rounding to avoid floating-point imprecision
  const ratio = value / factor;
  return Math.abs(Math.round(ratio) - ratio) < 1e-10;
}

function walk(
  data: any,
  schema: Schema,
  path: string,
  root: Record<string, any>,
  depth: number,
  errors: ValidationError[],
): void {
  if (depth > MAX_DEPTH) {
    errors.push({
      path,
      keyword: '$ref',
      message: `Maximum schema depth (${MAX_DEPTH}) exceeded — possible circular $ref`,
    });
    return;
  }

  // boolean schema
  if (typeof schema === 'boolean') {
    if (!schema) {
      errors.push({ path, keyword: 'false schema', message: 'Schema is false; no value is valid' });
    }
    return;
  }

  // $ref — resolve before anything else; ignore sibling keywords (draft-07 §8.3)
  if ('$ref' in schema) {
    const resolved = resolveRef(schema['$ref'] as string, root);
    if (!resolved) {
      errors.push({ path, keyword: '$ref', message: `Cannot resolve $ref: ${schema['$ref']}` });
      return;
    }
    walk(data, resolved, path, root, depth + 1, errors);
    return;
  }

  // ── type ──────────────────────────────────────────────────────────────────
  if ('type' in schema) {
    const declared: string[] = Array.isArray(schema['type'])
      ? (schema['type'] as string[])
      : [schema['type'] as string];

    const actual = jsType(data);
    const ok = declared.some(t => {
      if (t === 'integer') return typeof data === 'number' && Number.isInteger(data);
      return t === actual;
    });
    if (!ok) {
      errors.push({
        path,
        keyword: 'type',
        message: `Expected type ${declared.join('|')}, got ${actual}`,
        expected: declared.length === 1 ? declared[0] : declared,
        actual,
      });
      // continue — more keywords may produce useful errors
    }
  }

  // ── enum ──────────────────────────────────────────────────────────────────
  if ('enum' in schema) {
    const enums = schema['enum'] as any[];
    if (!enums.some(v => deepEqual(v, data))) {
      errors.push({
        path,
        keyword: 'enum',
        message: `Value must be one of: ${JSON.stringify(enums)}`,
        expected: enums,
        actual: data,
      });
    }
  }

  // ── const ─────────────────────────────────────────────────────────────────
  if ('const' in schema) {
    if (!deepEqual(schema['const'], data)) {
      errors.push({
        path,
        keyword: 'const',
        message: `Value must equal ${JSON.stringify(schema['const'])}`,
        expected: schema['const'],
        actual: data,
      });
    }
  }

  // ── format — recorded, not enforced ───────────────────────────────────────
  // (intentionally a no-op; format is advisory in draft-07)

  // ── string keywords ───────────────────────────────────────────────────────
  if (typeof data === 'string') {
    if ('minLength' in schema && data.length < (schema['minLength'] as number)) {
      errors.push({
        path,
        keyword: 'minLength',
        message: `String length ${data.length} is less than minLength ${schema['minLength']}`,
        expected: schema['minLength'],
        actual: data.length,
      });
    }
    if ('maxLength' in schema && data.length > (schema['maxLength'] as number)) {
      errors.push({
        path,
        keyword: 'maxLength',
        message: `String length ${data.length} exceeds maxLength ${schema['maxLength']}`,
        expected: schema['maxLength'],
        actual: data.length,
      });
    }
    if ('pattern' in schema) {
      const re = new RegExp(schema['pattern'] as string);
      if (!re.test(data)) {
        errors.push({
          path,
          keyword: 'pattern',
          message: `String does not match pattern /${schema['pattern']}/`,
          expected: schema['pattern'],
          actual: data,
        });
      }
    }
  }

  // ── number / integer keywords ─────────────────────────────────────────────
  if (typeof data === 'number') {
    if ('minimum' in schema && data < (schema['minimum'] as number)) {
      errors.push({
        path,
        keyword: 'minimum',
        message: `Value ${data} is less than minimum ${schema['minimum']}`,
        expected: schema['minimum'],
        actual: data,
      });
    }
    if ('maximum' in schema && data > (schema['maximum'] as number)) {
      errors.push({
        path,
        keyword: 'maximum',
        message: `Value ${data} exceeds maximum ${schema['maximum']}`,
        expected: schema['maximum'],
        actual: data,
      });
    }

    const excMin = schema['exclusiveMinimum'];
    if (excMin !== undefined) {
      if (typeof excMin === 'number' && data <= excMin) {
        // draft-07 style: exclusiveMinimum is a number
        errors.push({
          path,
          keyword: 'exclusiveMinimum',
          message: `Value ${data} must be > exclusiveMinimum ${excMin}`,
          expected: excMin,
          actual: data,
        });
      } else if (excMin === true && 'minimum' in schema && data <= (schema['minimum'] as number)) {
        // draft-04 style: exclusiveMinimum is a boolean flag
        errors.push({
          path,
          keyword: 'exclusiveMinimum',
          message: `Value ${data} must be strictly > minimum ${schema['minimum']}`,
          expected: schema['minimum'],
          actual: data,
        });
      }
    }

    const excMax = schema['exclusiveMaximum'];
    if (excMax !== undefined) {
      if (typeof excMax === 'number' && data >= excMax) {
        errors.push({
          path,
          keyword: 'exclusiveMaximum',
          message: `Value ${data} must be < exclusiveMaximum ${excMax}`,
          expected: excMax,
          actual: data,
        });
      } else if (excMax === true && 'maximum' in schema && data >= (schema['maximum'] as number)) {
        errors.push({
          path,
          keyword: 'exclusiveMaximum',
          message: `Value ${data} must be strictly < maximum ${schema['maximum']}`,
          expected: schema['maximum'],
          actual: data,
        });
      }
    }

    if ('multipleOf' in schema && !checkMultipleOf(data, schema['multipleOf'] as number)) {
      errors.push({
        path,
        keyword: 'multipleOf',
        message: `Value ${data} is not a multiple of ${schema['multipleOf']}`,
        expected: schema['multipleOf'],
        actual: data,
      });
    }
  }

  // ── array keywords ────────────────────────────────────────────────────────
  if (Array.isArray(data)) {
    if ('minItems' in schema && data.length < (schema['minItems'] as number)) {
      errors.push({
        path,
        keyword: 'minItems',
        message: `Array has ${data.length} items, requires at least ${schema['minItems']}`,
        expected: schema['minItems'],
        actual: data.length,
      });
    }
    if ('maxItems' in schema && data.length > (schema['maxItems'] as number)) {
      errors.push({
        path,
        keyword: 'maxItems',
        message: `Array has ${data.length} items, exceeds maxItems ${schema['maxItems']}`,
        expected: schema['maxItems'],
        actual: data.length,
      });
    }
    if (schema['uniqueItems']) {
      for (let i = 0; i < data.length; i++) {
        for (let j = i + 1; j < data.length; j++) {
          if (deepEqual(data[i], data[j])) {
            errors.push({
              path,
              keyword: 'uniqueItems',
              message: `Array items at indices ${i} and ${j} are not unique`,
              actual: [i, j],
            });
          }
        }
      }
    }
    if ('items' in schema) {
      const items = schema['items'];
      if (Array.isArray(items)) {
        // tuple mode
        (items as Schema[]).forEach((itemSchema, i) => {
          if (i < data.length) walk(data[i], itemSchema, `${path}/${i}`, root, depth + 1, errors);
        });
        if (schema['additionalItems'] === false) {
          for (let i = (items as Schema[]).length; i < data.length; i++) {
            errors.push({
              path: `${path}/${i}`,
              keyword: 'additionalItems',
              message: 'Additional items are not allowed',
              actual: data[i],
            });
          }
        }
      } else {
        // single-schema mode
        (data as any[]).forEach((item, i) =>
          walk(item, items as Schema, `${path}/${i}`, root, depth + 1, errors),
        );
      }
    }
  }

  // ── object keywords ───────────────────────────────────────────────────────
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, any>;

    if ('required' in schema) {
      for (const key of schema['required'] as string[]) {
        if (!(key in obj)) {
          errors.push({
            path: `${path}/${key}`,
            keyword: 'required',
            message: `Required property '${key}' is missing`,
            expected: key,
          });
        }
      }
    }

    const definedProps = new Set(Object.keys((schema['properties'] as object | undefined) ?? {}));
    const patternProps = schema['patternProperties'] as Record<string, Schema> | undefined;

    // patternProperties
    if (patternProps) {
      for (const pattern of Object.keys(patternProps)) {
        const re = new RegExp(pattern);
        for (const key of Object.keys(obj)) {
          if (re.test(key)) {
            walk(obj[key], patternProps[pattern], `${path}/${key}`, root, depth + 1, errors);
          }
        }
      }
    }

    // properties
    if ('properties' in schema) {
      const props = schema['properties'] as Record<string, Schema>;
      for (const key of Object.keys(props)) {
        if (key in obj) {
          walk(obj[key], props[key], `${path}/${key}`, root, depth + 1, errors);
        }
      }
    }

    // additionalProperties
    if ('additionalProperties' in schema) {
      const patternKeys = patternProps ? Object.keys(patternProps) : [];
      for (const key of Object.keys(obj)) {
        const coveredByPattern = patternKeys.some(p => new RegExp(p).test(key));
        if (!definedProps.has(key) && !coveredByPattern) {
          if (schema['additionalProperties'] === false) {
            errors.push({
              path: `${path}/${key}`,
              keyword: 'additionalProperties',
              message: `Additional property '${key}' is not allowed`,
              actual: key,
            });
          } else if (
            typeof schema['additionalProperties'] === 'object' &&
            schema['additionalProperties'] !== null
          ) {
            walk(
              obj[key],
              schema['additionalProperties'] as Schema,
              `${path}/${key}`,
              root,
              depth + 1,
              errors,
            );
          }
        }
      }
    }
  }

  // ── composition keywords ──────────────────────────────────────────────────

  if ('allOf' in schema) {
    for (const sub of schema['allOf'] as Schema[]) {
      walk(data, sub, path, root, depth + 1, errors);
    }
  }

  if ('anyOf' in schema) {
    const branches = schema['anyOf'] as Schema[];
    const anyPassed = branches.some(sub => {
      const tmp: ValidationError[] = [];
      walk(data, sub, path, root, depth + 1, tmp);
      return tmp.length === 0;
    });
    if (!anyPassed) {
      errors.push({
        path,
        keyword: 'anyOf',
        message: 'Value must match at least one of the anyOf schemas',
        actual: data,
      });
    }
  }

  if ('oneOf' in schema) {
    const branches = schema['oneOf'] as Schema[];
    const matched = branches.filter(sub => {
      const tmp: ValidationError[] = [];
      walk(data, sub, path, root, depth + 1, tmp);
      return tmp.length === 0;
    }).length;
    if (matched !== 1) {
      errors.push({
        path,
        keyword: 'oneOf',
        message: `Value must match exactly one oneOf schema, but matched ${matched}`,
        expected: 1,
        actual: matched,
      });
    }
  }

  if ('not' in schema) {
    const tmp: ValidationError[] = [];
    walk(data, schema['not'] as Schema, path, root, depth + 1, tmp);
    if (tmp.length === 0) {
      errors.push({
        path,
        keyword: 'not',
        message: 'Value must not match the "not" schema',
        actual: data,
      });
    }
  }
}

// ─── default coercion ────────────────────────────────────────────────────────

function applyDefaults(data: any, schema: Schema, root: Record<string, any>, depth: number): any {
  if (depth > MAX_DEPTH) return data;
  if (typeof schema === 'boolean') return data;

  // Resolve $ref
  if ('$ref' in schema) {
    const resolved = resolveRef(schema['$ref'] as string, root);
    if (resolved) return applyDefaults(data, resolved, root, depth + 1);
    return data;
  }

  // Apply top-level default when data is undefined/missing
  if (data === undefined && 'default' in schema) {
    data = cloneDeep(schema['default']);
  }

  // Recurse into object properties
  if (data !== null && typeof data === 'object' && !Array.isArray(data) && 'properties' in schema) {
    const result: Record<string, any> = { ...data };
    const props = schema['properties'] as Record<string, Schema>;
    for (const key of Object.keys(props)) {
      const childSchema = props[key];
      if (!(key in result)) {
        const coerced = applyDefaults(undefined, childSchema, root, depth + 1);
        if (coerced !== undefined) result[key] = coerced;
      } else {
        result[key] = applyDefaults(result[key], childSchema, root, depth + 1);
      }
    }
    return result;
  }

  return data;
}

// ─── public API ───────────────────────────────────────────────────────────────

export function createValidator(
  schema: any,
  opts?: { coerceDefaults?: boolean; logger?: (msg: string, meta?: any) => void },
) {
  const root = schema as Record<string, any>;
  const log = opts?.logger;

  return {
    validate(data: any): ValidateResult {
      const errors: ValidationError[] = [];
      walk(data, schema as Schema, '', root, 0, errors);
      const result: ValidateResult = { valid: errors.length === 0, errors };
      log?.('json-schema-validator:validate', { valid: result.valid, errorCount: errors.length });
      return result;
    },

    validateAndCoerce(data: any): { result: ValidateResult; data: any } {
      const coerced = opts?.coerceDefaults ? applyDefaults(data, schema as Schema, root, 0) : data;
      const errors: ValidationError[] = [];
      walk(coerced, schema as Schema, '', root, 0, errors);
      const result: ValidateResult = { valid: errors.length === 0, errors };
      log?.('json-schema-validator:validateAndCoerce', { valid: result.valid, errorCount: errors.length });
      return { result, data: coerced };
    },
  };
}

export function validateOnce(schema: any, data: any): ValidateResult {
  return createValidator(schema).validate(data);
}

export function compile(schema: any): (data: any) => ValidateResult {
  const v = createValidator(schema);
  return (data: any) => v.validate(data);
}
