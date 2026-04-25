/**
 * LLM Prompt Template Engine
 *
 * Mustache-like syntax with variables, conditionals, loops, partials,
 * filters, and version-pinned registry.  Pure Node built-ins only.
 */

import { createHash } from 'node:crypto';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TemplateOptions {
  /** true (default) = missing variable throws; false = empty string */
  strict?: boolean;
}

export interface Template {
  render(vars: Record<string, unknown>): string;
  variables(): Set<string>;
  validate(vars: Record<string, unknown>): { ok: boolean; missing: string[] };
  checksum(): string;
}

export interface Registry {
  register(name: string, src: string, version?: string): void;
  get(name: string, version?: string): Template;
  list(): Array<{ name: string; version: string | undefined }>;
  checksum(name: string, version?: string): string;
}

// ─── AST ─────────────────────────────────────────────────────────────────────

type ASTNode =
  | { type: 'text'; value: string }
  | { type: 'var'; path: string; filters: FilterSpec[]; raw: boolean }
  | { type: 'if'; cond: string; then: ASTNode[]; else: ASTNode[] }
  | { type: 'each'; path: string; body: ASTNode[] }
  | { type: 'partial'; name: string };

interface FilterSpec {
  name: string;
  arg?: string;
}

// ─── Module-level partials store ─────────────────────────────────────────────

const _partials = new Map<string, ASTNode[]>();

export function registerPartial(name: string, src: string): void {
  _partials.set(name, parse(src));
}

export function clearPartials(): void {
  _partials.clear();
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

interface Token {
  type: 'text' | 'tag' | 'raw';
  value: string;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const len = source.length;

  while (pos < len) {
    // Triple mustache {{{ ... }}}  — check before double-mustache
    if (pos + 2 < len && source[pos] === '{' && source[pos + 1] === '{' && source[pos + 2] === '{') {
      const end = source.indexOf('}}}', pos + 3);
      if (end === -1) throw new Error(`Unclosed {{{ at position ${pos}`);
      tokens.push({ type: 'raw', value: source.slice(pos + 3, end).trim() });
      pos = end + 3;
      continue;
    }

    // Comment {{!-- ... --}}
    if (
      pos + 4 < len &&
      source[pos] === '{' && source[pos + 1] === '{' &&
      source[pos + 2] === '!' && source[pos + 3] === '-' && source[pos + 4] === '-'
    ) {
      const end = source.indexOf('--}}', pos + 5);
      if (end === -1) throw new Error(`Unclosed {{!-- at position ${pos}`);
      pos = end + 4; // discard comment entirely
      continue;
    }

    // Double mustache {{ ... }}
    if (pos + 1 < len && source[pos] === '{' && source[pos + 1] === '{') {
      const end = source.indexOf('}}', pos + 2);
      if (end === -1) throw new Error(`Unclosed {{ at position ${pos}`);
      tokens.push({ type: 'tag', value: source.slice(pos + 2, end).trim() });
      pos = end + 2;
      continue;
    }

    // Plain text — collect until next tag opener
    let next = pos + 1;
    while (next < len) {
      if (source[next] === '{' && next + 1 < len && source[next + 1] === '{') break;
      next++;
    }
    tokens.push({ type: 'text', value: source.slice(pos, next) });
    pos = next;
  }

  return tokens;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

interface ParseResult {
  nodes: ASTNode[];
  /** tokens consumed from `start`, NOT including the terminator token itself */
  consumed: number;
}

function buildAST(tokens: Token[], start: number): ParseResult {
  const nodes: ASTNode[] = [];
  let i = start;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === 'text') {
      if (token.value) nodes.push({ type: 'text', value: token.value });
      i++;
      continue;
    }

    if (token.type === 'raw') {
      nodes.push({ type: 'var', path: token.value, filters: [], raw: true });
      i++;
      continue;
    }

    // token.type === 'tag'
    const val = token.value;

    // Terminator tokens — return control to parent
    if (val === '/if' || val === '/each' || val === 'else') {
      return { nodes, consumed: i - start };
    }

    // {{#if cond}} ... {{else}} ... {{/if}}
    if (val.startsWith('#if ')) {
      const cond = val.slice(4).trim();
      const thenResult = buildAST(tokens, i + 1);
      let elseNodes: ASTNode[] = [];
      let termIdx = i + 1 + thenResult.consumed;

      if (termIdx < tokens.length && tokens[termIdx].value === 'else') {
        const elseResult = buildAST(tokens, termIdx + 1);
        elseNodes = elseResult.nodes;
        termIdx = termIdx + 1 + elseResult.consumed;
      }
      // termIdx now points at the '/if' token
      nodes.push({ type: 'if', cond, then: thenResult.nodes, else: elseNodes });
      i = termIdx + 1; // skip '/if'
      continue;
    }

    // {{#each path}} ... {{/each}}
    if (val.startsWith('#each ')) {
      const path = val.slice(6).trim();
      const bodyResult = buildAST(tokens, i + 1);
      const termIdx = i + 1 + bodyResult.consumed;
      nodes.push({ type: 'each', path, body: bodyResult.nodes });
      i = termIdx + 1; // skip '/each'
      continue;
    }

    // {{> partialName}}
    if (val.startsWith('> ')) {
      nodes.push({ type: 'partial', name: val.slice(2).trim() });
      i++;
      continue;
    }

    // Variable with optional filters
    const { varPath, filters } = parseFilters(val);
    nodes.push({ type: 'var', path: varPath, filters, raw: false });
    i++;
  }

  return { nodes, consumed: i - start };
}

/**
 * Split `expr` on `|` respecting single/double-quoted strings,
 * then parse each segment into a filter spec.
 */
function parseFilters(expr: string): { varPath: string; filters: FilterSpec[] } {
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (const ch of expr) {
    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; }
    else if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; }
    else if (ch === '|' && !inSingle && !inDouble) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const varPath = parts[0] ?? '';
  const filters: FilterSpec[] = [];

  for (let idx = 1; idx < parts.length; idx++) {
    const f = parts[idx];
    const colon = f.indexOf(':');
    if (colon !== -1) {
      const name = f.slice(0, colon).trim();
      let arg = f.slice(colon + 1).trim();
      // Strip surrounding quotes from arg
      if (
        (arg.startsWith("'") && arg.endsWith("'")) ||
        (arg.startsWith('"') && arg.endsWith('"'))
      ) {
        arg = arg.slice(1, -1);
      }
      filters.push({ name, arg });
    } else {
      filters.push({ name: f });
    }
  }

  return { varPath, filters };
}

function parse(source: string): ASTNode[] {
  return buildAST(tokenize(source), 0).nodes;
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

const LOOP_SPECIALS = new Set(['this', '@index', '@first', '@last', '@key']);

function resolvePath(
  vars: Record<string, unknown>,
  path: string,
  strict: boolean,
): unknown {
  // Fast-path for loop-special variables
  if (LOOP_SPECIALS.has(path)) return vars[path];

  const parts = path.split('.');
  let current: unknown = vars;

  for (const part of parts) {
    if (current === null || current === undefined) {
      if (strict) throw new Error(`Missing variable: "${path}"`);
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current === undefined && strict) {
    throw new Error(`Missing variable: "${path}"`);
  }

  return current;
}

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (value === '' || value === 0 || value === false) return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function applyFilters(value: unknown, filters: FilterSpec[]): string {
  let result: unknown = value;

  for (const f of filters) {
    switch (f.name) {
      case 'upper':
        result = String(result ?? '').toUpperCase();
        break;
      case 'lower':
        result = String(result ?? '').toLowerCase();
        break;
      case 'trim':
        result = String(result ?? '').trim();
        break;
      case 'json':
        result = JSON.stringify(result, null, 2);
        break;
      case 'length':
        if (typeof result === 'string') result = result.length;
        else if (Array.isArray(result)) result = result.length;
        else if (result !== null && typeof result === 'object')
          result = Object.keys(result as Record<string, unknown>).length;
        else result = 0;
        break;
      case 'truncate': {
        const n = parseInt(f.arg ?? '50', 10);
        const s = String(result ?? '');
        result = s.length > n ? s.slice(0, n) + '\u2026' : s;
        break;
      }
      case 'default':
        if (result === undefined || result === null || result === '') {
          result = f.arg ?? '';
        }
        break;
      case 'escape':
        result = String(result ?? '').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
        break;
      default:
        throw new Error(`Unknown filter: "${f.name}"`);
    }
  }

  return String(result ?? '');
}

const MAX_PARTIAL_DEPTH = 10;

function renderNodes(
  nodes: ASTNode[],
  vars: Record<string, unknown>,
  strict: boolean,
  depth: number,
): string {
  if (depth > MAX_PARTIAL_DEPTH) {
    throw new Error(`Partial recursion depth exceeded (limit: ${MAX_PARTIAL_DEPTH})`);
  }

  let out = '';

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out += node.value;
        break;

      case 'var': {
        const hasDefault = node.filters.some(f => f.name === 'default');
        const value = resolvePath(vars, node.path, strict && !hasDefault);
        out += node.filters.length === 0
          ? String(value ?? '')
          : applyFilters(value, node.filters);
        break;
      }

      case 'if': {
        // Conditions are always resolved loosely (undefined → falsy, not throw)
        const condVal = resolvePath(vars, node.cond, false);
        out += renderNodes(
          isTruthy(condVal) ? node.then : node.else,
          vars, strict, depth,
        );
        break;
      }

      case 'each': {
        const collection = resolvePath(vars, node.path, strict);
        if (collection === undefined || collection === null) break;

        if (Array.isArray(collection)) {
          const len = collection.length;
          for (let idx = 0; idx < len; idx++) {
            out += renderNodes(node.body, {
              ...vars,
              this: collection[idx],
              '@index': idx,
              '@first': idx === 0,
              '@last': idx === len - 1,
            }, strict, depth);
          }
        } else if (typeof collection === 'object') {
          const entries = Object.entries(collection as Record<string, unknown>);
          const len = entries.length;
          for (let idx = 0; idx < len; idx++) {
            const [key, val] = entries[idx];
            out += renderNodes(node.body, {
              ...vars,
              this: val,
              '@key': key,
              '@index': idx,
              '@first': idx === 0,
              '@last': idx === len - 1,
            }, strict, depth);
          }
        }
        break;
      }

      case 'partial': {
        const partialAST = _partials.get(node.name);
        if (!partialAST) {
          if (strict) throw new Error(`Missing partial: "${node.name}"`);
          break;
        }
        out += renderNodes(partialAST, vars, strict, depth + 1);
        break;
      }
    }
  }

  return out;
}

// ─── Variable collection ─────────────────────────────────────────────────────

function collectVariables(nodes: ASTNode[], result: Set<string>): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'var':
        if (
          !LOOP_SPECIALS.has(node.path) &&
          !node.path.startsWith('@') &&
          !node.path.startsWith('this.')
        ) {
          result.add(node.path);
        }
        break;
      case 'if':
        if (!LOOP_SPECIALS.has(node.cond) && !node.cond.startsWith('@')) {
          result.add(node.cond);
        }
        collectVariables(node.then, result);
        collectVariables(node.else, result);
        break;
      case 'each':
        result.add(node.path);
        collectVariables(node.body, result);
        break;
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function createTemplate(source: string, opts?: TemplateOptions): Template {
  const strict = opts?.strict !== false;
  const ast = parse(source);
  const _checksum = createHash('sha256')
    .update(JSON.stringify(ast))
    .digest('hex');

  return {
    render(vars: Record<string, unknown>): string {
      return renderNodes(ast, vars, strict, 0);
    },

    variables(): Set<string> {
      const result = new Set<string>();
      collectVariables(ast, result);
      return result;
    },

    validate(vars: Record<string, unknown>): { ok: boolean; missing: string[] } {
      const required = new Set<string>();
      collectVariables(ast, required);

      const missing: string[] = [];
      for (const path of required) {
        const parts = path.split('.');
        let current: unknown = vars;
        let found = true;
        for (const part of parts) {
          if (current === null || current === undefined) { found = false; break; }
          current = (current as Record<string, unknown>)[part];
          if (current === undefined) { found = false; break; }
        }
        if (!found) missing.push(path);
      }

      return { ok: missing.length === 0, missing };
    },

    checksum(): string {
      return _checksum;
    },
  };
}

export function createRegistry(): Registry {
  const store = new Map<string, { src: string; checksum: string }>();

  function key(name: string, version?: string): string {
    return version !== undefined ? `${name}@${version}` : name;
  }

  return {
    register(name: string, src: string, version?: string): void {
      const ast = parse(src);
      const checksum = createHash('sha256')
        .update(JSON.stringify(ast))
        .digest('hex');
      store.set(key(name, version), { src, checksum });
    },

    get(name: string, version?: string): Template {
      const entry = store.get(key(name, version));
      if (!entry) throw new Error(`Template not found: "${key(name, version)}"`);
      return createTemplate(entry.src);
    },

    list(): Array<{ name: string; version: string | undefined }> {
      return Array.from(store.keys()).map(k => {
        const at = k.lastIndexOf('@');
        return at === -1
          ? { name: k, version: undefined }
          : { name: k.slice(0, at), version: k.slice(at + 1) };
      });
    },

    checksum(name: string, version?: string): string {
      const entry = store.get(key(name, version));
      if (!entry) throw new Error(`Template not found: "${key(name, version)}"`);
      return entry.checksum;
    },
  };
}
