/**
 * Prompt Template Engine — Jinja-lite subset for LLM prompt construction.
 *
 * Syntax:
 *   {{ var }}                — interpolation; dotted paths supported (user.name)
 *   {{ var | filter }}       — filters: upper | lower | trim | json | length | default(v)
 *   {% if cond %} … {% elif cond %} … {% else %} … {% endif %}
 *   {% for item in list %} … {% endfor %}  — loop.index0 / loop.index1 available
 *   {% include 'name' %}     — partial lookup in registry
 *   {# comment #}            — stripped at compile time
 *   {%- … -%}               — whitespace-stripping variants
 *
 * Design: pure recursive-descent parser → explicit AST → tree-walking interpreter.
 * No eval, no Function constructor.
 */

export type TemplateContext = Record<string, any>;

// ─── Error ────────────────────────────────────────────────────────────────────

export class TemplateError extends Error {
  readonly line: number;
  readonly col: number;

  constructor(message: string, line: number, col: number) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'TemplateError';
    this.line = line;
    this.col = col;
  }
}

// ─── LRU Cache ────────────────────────────────────────────────────────────────

class LRUCache<K, V> {
  private readonly maxSize: number;
  private readonly store: Map<K, V>;

  constructor(maxSize: number) {
    this.maxSize = Math.max(1, maxSize);
    this.store = new Map();
  }

  get(key: K): V | undefined {
    if (!this.store.has(key)) return undefined;
    const val = this.store.get(key)!;
    // Re-insert to mark as most-recently-used
    this.store.delete(key);
    this.store.set(key, val);
    return val;
  }

  set(key: K, val: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      // Map insertion order → first key is LRU
      const lruKey = this.store.keys().next().value as K;
      this.store.delete(lruKey);
    }
    this.store.set(key, val);
  }

  has(key: K): boolean { return this.store.has(key); }
  clear(): void        { this.store.clear(); }
  get size(): number   { return this.store.size; }
}

// ─── Lexer ────────────────────────────────────────────────────────────────────

type RawTokenType = 'text' | 'var' | 'block' | 'comment';

interface RawToken {
  type: RawTokenType;
  value: string;       // inner content, whitespace-trimmed
  line: number;
  col: number;
  stripBefore: boolean; // {%- or {{-  → trim end of previous text node
  stripAfter: boolean;  // -%} or -}}  → trim start of next text node
}

function buildLineStarts(source: string): number[] {
  const s = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') s.push(i + 1);
  }
  return s;
}

function posToLC(lineStarts: number[], pos: number): [number, number] {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return [lo + 1, pos - lineStarts[lo] + 1];
}

function lex(source: string): RawToken[] {
  const ls = buildLineStarts(source);
  const tokens: RawToken[] = [];
  let pos = 0;
  let textStart = 0;

  function flushText(): void {
    if (pos > textStart) {
      const [line, col] = posToLC(ls, textStart);
      tokens.push({ type: 'text', value: source.slice(textStart, pos), line, col, stripBefore: false, stripAfter: false });
    }
    textStart = pos;
  }

  while (pos < source.length) {
    const ch  = source[pos];
    const ch2 = pos + 1 < source.length ? source[pos + 1] : '';

    if (ch === '{' && (ch2 === '{' || ch2 === '%' || ch2 === '#')) {
      flushText();
      const [tagLine, tagCol] = posToLC(ls, pos);

      let closeA: string, closeB: string, tagType: RawTokenType;
      if      (ch2 === '{') { closeA = '}'; closeB = '}'; tagType = 'var'; }
      else if (ch2 === '%') { closeA = '%'; closeB = '}'; tagType = 'block'; }
      else                  { closeA = '#'; closeB = '}'; tagType = 'comment'; }

      let innerStart = pos + 2;
      let stripBefore = false;
      if (tagType !== 'comment' && source[innerStart] === '-') {
        stripBefore = true;
        innerStart++;
      }

      // Scan for closing delimiter
      let found = -1;
      for (let j = innerStart; j < source.length - 1; j++) {
        if (source[j] === closeA && source[j + 1] === closeB) { found = j; break; }
      }
      if (found === -1) {
        throw new TemplateError(`Unclosed '${ch}${ch2}' tag`, tagLine, tagCol);
      }

      let innerEnd = found;
      let stripAfter = false;
      if (tagType !== 'comment' && found > 0 && source[found - 1] === '-') {
        stripAfter = true;
        innerEnd = found - 1;
      }

      pos = found + 2;
      textStart = pos;

      if (tagType !== 'comment') {
        tokens.push({
          type: tagType,
          value: source.slice(innerStart, innerEnd).trim(),
          line: tagLine,
          col: tagCol,
          stripBefore,
          stripAfter,
        });
      }
    } else {
      pos++;
    }
  }

  flushText();
  return tokens;
}

function applyWsControl(tokens: RawToken[]): RawToken[] {
  const out = tokens.map(t => ({ ...t }));
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (t.type === 'block' || t.type === 'var') {
      if (t.stripBefore && i > 0 && out[i - 1].type === 'text') {
        out[i - 1] = { ...out[i - 1], value: out[i - 1].value.trimEnd() };
      }
      if (t.stripAfter && i + 1 < out.length && out[i + 1].type === 'text') {
        out[i + 1] = { ...out[i + 1], value: out[i + 1].value.trimStart() };
      }
    }
  }
  return out;
}

// ─── AST types ────────────────────────────────────────────────────────────────

interface FilterCall { name: string; args: any[]; }

interface TextNode    { type: 'text';    value: string; }
interface VarNode     { type: 'var';     path: string[]; filters: FilterCall[]; line: number; col: number; }
interface IncludeNode { type: 'include'; name: string;   line: number; col: number; }
interface ForNode     { type: 'for';     item: string; listPath: string[]; body: AstNode[]; line: number; col: number; }
interface IfNode      { type: 'if';      branches: Array<{ cond: CondNode; body: AstNode[] }>; elseBranch: AstNode[] | null; line: number; col: number; }

type AstNode = TextNode | VarNode | IfNode | ForNode | IncludeNode;

// ─── Condition AST ────────────────────────────────────────────────────────────

type CondNode =
  | { kind: 'path';    path: string[] }
  | { kind: 'not';     inner: CondNode }
  | { kind: 'literal'; value: boolean }
  | { kind: 'cmp';     left: string[]; op: string; right: any }
  | { kind: 'and';     left: CondNode; right: CondNode }
  | { kind: 'or';      left: CondNode; right: CondNode };

// ─── Condition parser ─────────────────────────────────────────────────────────

function parseLiteralValue(s: string): any {
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  if (t === 'true')  return true;
  if (t === 'false') return false;
  if (t === 'null')  return null;
  const n = Number(t);
  if (!isNaN(n) && t !== '') return n;
  return { _path: t.split('.') };
}

function parseCond(expr: string, line: number, col: number): CondNode {
  const s = expr.trim();

  // Boolean literals
  if (s === 'true')  return { kind: 'literal', value: true };
  if (s === 'false') return { kind: 'literal', value: false };

  // 'or' — lowest precedence; split on first occurrence of ' or '
  const orIdx = s.indexOf(' or ');
  if (orIdx !== -1) {
    return { kind: 'or', left: parseCond(s.slice(0, orIdx), line, col), right: parseCond(s.slice(orIdx + 4), line, col) };
  }

  // 'and' — next precedence
  const andIdx = s.indexOf(' and ');
  if (andIdx !== -1) {
    return { kind: 'and', left: parseCond(s.slice(0, andIdx), line, col), right: parseCond(s.slice(andIdx + 5), line, col) };
  }

  // 'not' prefix
  if (s.startsWith('not ')) {
    return { kind: 'not', inner: parseCond(s.slice(4), line, col) };
  }

  // Comparison: left op right — ops: === == !== != >= <= > <
  const cmpRe = /^(.+?)\s*(===?|!==?|>=|<=|>|<)\s*(.+)$/;
  const m = s.match(cmpRe);
  if (m) {
    const op = m[2].replace('===', '==').replace('!==', '!=');
    return { kind: 'cmp', left: m[1].trim().split('.'), op, right: parseLiteralValue(m[3]) };
  }

  // Simple truthy path
  return { kind: 'path', path: s.split('.') };
}

// ─── Filter arg parser ────────────────────────────────────────────────────────

function splitOnPipe(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '|' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts;
}

function parseFilterArgs(argsStr: string): any[] {
  if (!argsStr.trim()) return [];
  return argsStr.split(',').map(a => {
    const s = a.trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) return s.slice(1, -1);
    if (s === 'true')  return true;
    if (s === 'false') return false;
    if (s === 'null')  return null;
    const n = Number(s);
    if (!isNaN(n) && s !== '') return n;
    return s;
  });
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parse(tokens: RawToken[]): AstNode[] {
  let pos = 0;

  function cur(): RawToken | undefined { return tokens[pos]; }

  function peekKeyword(): string | null {
    const t = cur();
    return (t && t.type === 'block') ? t.value.split(/\s+/)[0] : null;
  }

  function expectKeyword(kw: string): RawToken {
    const t = cur();
    if (!t || t.type !== 'block' || t.value.split(/\s+/)[0] !== kw) {
      const got = t ? `'${t.value.split(/\s+/)[0]}'` : 'end of template';
      throw new TemplateError(`Expected '{% ${kw} %}' but got ${got}`, t?.line ?? 1, t?.col ?? 1);
    }
    return tokens[pos++];
  }

  function parseBody(stopAt: string[]): AstNode[] {
    const nodes: AstNode[] = [];
    while (pos < tokens.length) {
      const t = cur()!;
      if (t.type === 'block' && stopAt.includes(t.value.split(/\s+/)[0])) break;
      nodes.push(parseNode());
    }
    return nodes;
  }

  function parseNode(): AstNode {
    const t = cur();
    if (!t) throw new TemplateError('Unexpected end of template', 1, 1);
    if (t.type === 'text')  { pos++; return { type: 'text', value: t.value }; }
    if (t.type === 'var')   { pos++; return parseVarToken(t); }
    if (t.type === 'block') return parseBlockTag();
    throw new TemplateError(`Unexpected token '${t.type}'`, t.line, t.col);
  }

  function parseVarToken(t: RawToken): VarNode {
    const parts = splitOnPipe(t.value);
    const pathStr = parts[0].trim();
    if (!pathStr) throw new TemplateError('Empty variable expression', t.line, t.col);

    const filters: FilterCall[] = [];
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i].trim();
      const pi = p.indexOf('(');
      if (pi === -1) {
        filters.push({ name: p, args: [] });
      } else {
        const name    = p.slice(0, pi).trim();
        const argsStr = p.slice(pi + 1, p.lastIndexOf(')'));
        filters.push({ name, args: parseFilterArgs(argsStr) });
      }
    }
    return { type: 'var', path: pathStr.split('.'), filters, line: t.line, col: t.col };
  }

  function parseBlockTag(): AstNode {
    const t = cur()!;
    const kw = t.value.split(/\s+/)[0];
    if (kw === 'if')      return parseIf();
    if (kw === 'for')     return parseFor();
    if (kw === 'include') return parseInclude();
    throw new TemplateError(`Unknown block tag '${kw}'`, t.line, t.col);
  }

  function parseIf(): IfNode {
    const ifTok = tokens[pos++];
    const condStr = ifTok.value.replace(/^if\s+/, '');
    const branches: IfNode['branches'] = [
      { cond: parseCond(condStr, ifTok.line, ifTok.col), body: parseBody(['elif', 'else', 'endif']) },
    ];
    let elseBranch: AstNode[] | null = null;
    let closed = false;

    while (pos < tokens.length) {
      const kw = peekKeyword();
      if (kw === 'elif') {
        const et = tokens[pos++];
        const ec = parseCond(et.value.replace(/^elif\s+/, ''), et.line, et.col);
        branches.push({ cond: ec, body: parseBody(['elif', 'else', 'endif']) });
      } else if (kw === 'else') {
        pos++;
        elseBranch = parseBody(['endif']);
        expectKeyword('endif');
        closed = true;
        break;
      } else if (kw === 'endif') {
        pos++;
        closed = true;
        break;
      } else {
        break;
      }
    }

    if (!closed) {
      throw new TemplateError("Unmatched '{% if %}' — missing '{% endif %}'", ifTok.line, ifTok.col);
    }
    return { type: 'if', branches, elseBranch, line: ifTok.line, col: ifTok.col };
  }

  function parseFor(): ForNode {
    const ft = tokens[pos++];
    const m = ft.value.match(/^for\s+(\w+)\s+in\s+(.+)$/);
    if (!m) throw new TemplateError(`Invalid for syntax: expected 'for item in list'`, ft.line, ft.col);
    const item     = m[1];
    const listPath = m[2].trim().split('.');
    const body     = parseBody(['endfor']);
    if (peekKeyword() !== 'endfor') {
      throw new TemplateError("Unmatched '{% for %}' — missing '{% endfor %}'", ft.line, ft.col);
    }
    pos++;
    return { type: 'for', item, listPath, body, line: ft.line, col: ft.col };
  }

  function parseInclude(): IncludeNode {
    const t = tokens[pos++];
    const m = t.value.match(/^include\s+['"](.+?)['"]$/);
    if (!m) throw new TemplateError(`Invalid include syntax: expected include 'name'`, t.line, t.col);
    return { type: 'include', name: m[1], line: t.line, col: t.col };
  }

  const ast = parseBody([]);
  if (pos < tokens.length) {
    const t = tokens[pos];
    throw new TemplateError(`Unexpected tag '${t.value.split(/\s+/)[0]}'`, t.line, t.col);
  }
  return ast;
}

// ─── Built-in filters ─────────────────────────────────────────────────────────

const BUILTIN_FILTERS = new Map<string, (val: any, ...args: any[]) => any>([
  ['upper',   (v: any)              => v == null ? '' : String(v).toUpperCase()],
  ['lower',   (v: any)              => v == null ? '' : String(v).toLowerCase()],
  ['trim',    (v: any)              => v == null ? '' : String(v).trim()],
  ['json',    (v: any)              => v === undefined ? 'null' : (JSON.stringify(v) ?? 'null')],
  ['length',  (v: any)              => v == null ? 0 : typeof v === 'string' || Array.isArray(v) ? v.length : typeof v === 'object' ? Object.keys(v).length : 0],
  ['default', (v: any, fb: any = '') => v == null ? fb : v],
]);

// ─── Hash (djb2) ──────────────────────────────────────────────────────────────

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ─── Engine public interface ──────────────────────────────────────────────────

export interface PromptTemplateEngine {
  registerPartial(name: string, source: string): void;
  removePartial(name: string): void;
  listPartials(): string[];
  render(source: string, ctx: TemplateContext): string;
  renderTemplate(name: string, ctx: TemplateContext): string;
  clearCache(): void;
  registerFilter(name: string, fn: (val: any, ...args: any[]) => any): void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createPromptTemplateEngine(opts?: {
  cacheSize?: number;
  logger?: (msg: string, meta?: any) => void;
}): PromptTemplateEngine {
  const maxCache = opts?.cacheSize ?? 64;
  const log      = opts?.logger;

  const partials      = new Map<string, string>();
  const customFilters = new Map<string, (val: any, ...args: any[]) => any>();

  type CompiledFn = (ctx: TemplateContext, stack: string[]) => string;
  const cache = new LRUCache<string, CompiledFn>(maxCache);

  // ── compile ──────────────────────────────────────────────────────────────

  function compile(source: string): CompiledFn {
    const key = hashStr(source);
    if (cache.has(key)) {
      log?.('cache:hit', { key });
      return cache.get(key)!;
    }
    log?.('cache:miss', { key });
    const ast = parse(applyWsControl(lex(source)));
    const fn: CompiledFn = (ctx, stack) => evalAst(ast, ctx, stack);
    cache.set(key, fn);
    return fn;
  }

  // ── evaluator ────────────────────────────────────────────────────────────

  function evalAst(nodes: AstNode[], ctx: TemplateContext, stack: string[]): string {
    let out = '';
    for (const n of nodes) out += evalNode(n, ctx, stack);
    return out;
  }

  function evalNode(node: AstNode, ctx: TemplateContext, stack: string[]): string {
    switch (node.type) {
      case 'text':
        return node.value;

      case 'var': {
        let val: any = resolvePath(node.path, ctx);
        for (const f of node.filters) val = applyFilter(f, val);
        return val == null ? '' : String(val);
      }

      case 'if': {
        for (const branch of node.branches) {
          if (evalCond(branch.cond, ctx)) return evalAst(branch.body, ctx, stack);
        }
        return node.elseBranch ? evalAst(node.elseBranch, ctx, stack) : '';
      }

      case 'for': {
        const list = resolvePath(node.listPath, ctx);
        if (!Array.isArray(list)) return '';
        let out = '';
        for (let i = 0; i < list.length; i++) {
          const loopCtx: TemplateContext = { ...ctx, [node.item]: list[i], loop: { index0: i, index1: i + 1 } };
          out += evalAst(node.body, loopCtx, stack);
        }
        return out;
      }

      case 'include': {
        const src = partials.get(node.name);
        if (src === undefined) {
          const avail = [...partials.keys()].join(', ') || '(none)';
          throw new TemplateError(`Partial '${node.name}' not found. Available: [${avail}]`, node.line, node.col);
        }
        if (stack.includes(node.name)) {
          throw new TemplateError(
            `Circular partial reference: ${[...stack, node.name].join(' → ')}`,
            node.line, node.col,
          );
        }
        return compile(src)(ctx, [...stack, node.name]);
      }
    }
  }

  function resolvePath(path: string[], ctx: TemplateContext): any {
    let val: any = ctx;
    for (const key of path) {
      if (val == null) return undefined;
      val = val[key];
    }
    return val;
  }

  function applyFilter(f: FilterCall, val: any): any {
    const fn = customFilters.get(f.name) ?? BUILTIN_FILTERS.get(f.name);
    if (!fn) throw new Error(`Unknown filter '${f.name}'`);
    return fn(val, ...f.args);
  }

  function evalCond(cond: CondNode, ctx: TemplateContext): boolean {
    switch (cond.kind) {
      case 'path':    return Boolean(resolvePath(cond.path, ctx));
      case 'not':     return !evalCond(cond.inner, ctx);
      case 'literal': return cond.value;
      case 'and':     return evalCond(cond.left, ctx) && evalCond(cond.right, ctx);
      case 'or':      return evalCond(cond.left, ctx) || evalCond(cond.right, ctx);
      case 'cmp': {
        const lv = resolvePath(cond.left, ctx);
        const rv = (typeof cond.right === 'object' && cond.right !== null && '_path' in cond.right)
          ? resolvePath((cond.right as { _path: string[] })._path, ctx)
          : cond.right;
        switch (cond.op) {
          case '==':  return lv == rv;   // intentional loose comparison
          case '!=':  return lv != rv;
          case '>':   return lv >  rv;
          case '<':   return lv <  rv;
          case '>=':  return lv >= rv;
          case '<=':  return lv <= rv;
          default:    return false;
        }
      }
    }
  }

  // ── public API ───────────────────────────────────────────────────────────

  return {
    registerPartial(name, source)      { partials.set(name, source); },
    removePartial(name)                { partials.delete(name); },
    listPartials()                     { return [...partials.keys()]; },
    clearCache()                       { cache.clear(); },
    registerFilter(name, fn)           { customFilters.set(name, fn); },

    render(source, ctx) {
      return compile(source)(ctx, []);
    },

    renderTemplate(name, ctx) {
      const src = partials.get(name);
      if (src === undefined) throw new TemplateError(`Template '${name}' not found`, 1, 1);
      return compile(src)(ctx, [name]);
    },
  };
}
