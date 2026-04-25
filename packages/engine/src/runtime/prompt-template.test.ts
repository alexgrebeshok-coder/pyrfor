// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest';
import {
  createTemplate,
  createRegistry,
  registerPartial,
  clearPartials,
} from './prompt-template';

// ─── helpers ──────────────────────────────────────────────────────────────────

function strict(src: string) {
  return createTemplate(src, { strict: true });
}

function loose(src: string) {
  return createTemplate(src, { strict: false });
}

// ─── 1. Simple substitution ───────────────────────────────────────────────────

describe('simple substitution', () => {
  it('renders plain text unchanged', () => {
    expect(strict('hello world').render({})).toBe('hello world');
  });

  it('substitutes a single variable', () => {
    expect(strict('Hello {{ name }}!').render({ name: 'Alice' })).toBe('Hello Alice!');
  });

  it('substitutes multiple variables', () => {
    expect(
      strict('{{ a }} + {{ b }} = {{ c }}').render({ a: '1', b: '2', c: '3' }),
    ).toBe('1 + 2 = 3');
  });

  it('renders empty template as empty string', () => {
    expect(strict('').render({})).toBe('');
  });
});

// ─── 2. Dot paths ─────────────────────────────────────────────────────────────

describe('dot path', () => {
  it('resolves a single-level dot path', () => {
    expect(strict('{{ user.name }}').render({ user: { name: 'Bob' } })).toBe('Bob');
  });

  it('resolves a deep dot path', () => {
    expect(
      strict('{{ a.b.c }}').render({ a: { b: { c: 'deep' } } }),
    ).toBe('deep');
  });

  it('resolves an array index via dot path (items.0)', () => {
    expect(strict('{{ items.0 }}').render({ items: ['first', 'second'] })).toBe('first');
  });
});

// ─── 3. Strict vs. loose mode ────────────────────────────────────────────────

describe('strict vs loose mode', () => {
  it('strict mode: missing top-level variable throws', () => {
    expect(() => strict('{{ missing }}').render({})).toThrow(/Missing variable/);
  });

  it('strict mode: missing nested variable throws', () => {
    expect(() => strict('{{ user.age }}').render({ user: {} })).toThrow(/Missing variable/);
  });

  it('loose mode: missing variable returns empty string', () => {
    expect(loose('{{ missing }}').render({})).toBe('');
  });

  it('loose mode: missing nested variable returns empty string', () => {
    expect(loose('{{ a.b.c }}').render({})).toBe('');
  });
});

// ─── 4. Conditionals ─────────────────────────────────────────────────────────

describe('conditionals', () => {
  it('if truthy renders then-branch', () => {
    expect(strict('{{#if show}}yes{{/if}}').render({ show: true })).toBe('yes');
  });

  it('if falsy renders nothing (no else)', () => {
    expect(strict('{{#if show}}yes{{/if}}').render({ show: false })).toBe('');
  });

  it('else branch renders when condition is falsy', () => {
    expect(
      strict('{{#if flag}}on{{else}}off{{/if}}').render({ flag: false }),
    ).toBe('off');
  });

  it('else branch does NOT render when condition is truthy', () => {
    expect(
      strict('{{#if flag}}on{{else}}off{{/if}}').render({ flag: true }),
    ).toBe('on');
  });

  it('treats 0 as falsy', () => {
    expect(strict('{{#if n}}y{{else}}n{{/if}}').render({ n: 0 })).toBe('n');
  });

  it('treats empty string as falsy', () => {
    expect(strict('{{#if s}}y{{else}}n{{/if}}').render({ s: '' })).toBe('n');
  });

  it('treats empty array as falsy', () => {
    expect(strict('{{#if arr}}y{{else}}n{{/if}}').render({ arr: [] })).toBe('n');
  });

  it('treats null as falsy', () => {
    expect(strict('{{#if val}}y{{else}}n{{/if}}').render({ val: null })).toBe('n');
  });

  it('treats non-empty array as truthy', () => {
    expect(strict('{{#if arr}}y{{/if}}').render({ arr: [1] })).toBe('y');
  });

  it('handles nested if blocks', () => {
    const t = strict('{{#if a}}{{#if b}}both{{/if}}{{/if}}');
    expect(t.render({ a: true, b: true })).toBe('both');
    expect(t.render({ a: true, b: false })).toBe('');
    expect(t.render({ a: false, b: true })).toBe('');
  });

  it('missing condition variable is treated as falsy (not throw) even in strict', () => {
    expect(strict('{{#if ghost}}y{{else}}n{{/if}}').render({})).toBe('n');
  });
});

// ─── 5. Each loops ────────────────────────────────────────────────────────────

describe('each loop', () => {
  it('iterates array and exposes this', () => {
    const t = strict('{{#each items}}{{ this }}{{/each}}');
    expect(t.render({ items: ['a', 'b', 'c'] })).toBe('abc');
  });

  it('exposes @index (0-based)', () => {
    const t = strict('{{#each items}}{{ @index }}{{/each}}');
    expect(t.render({ items: ['x', 'y', 'z'] })).toBe('012');
  });

  it('exposes @first — true only on first iteration', () => {
    const t = strict('{{#each items}}{{#if @first}}F{{/if}}{{/each}}');
    expect(t.render({ items: ['a', 'b', 'c'] })).toBe('F');
  });

  it('exposes @last — true only on last iteration', () => {
    const t = strict('{{#each items}}{{#if @last}}L{{/if}}{{/each}}');
    expect(t.render({ items: ['a', 'b', 'c'] })).toBe('L');
  });

  it('exposes @first and @last together', () => {
    const t = strict('{{#each items}}[{{ @index }},{{#if @first}}F{{/if}}{{#if @last}}L{{/if}}]{{/each}}');
    expect(t.render({ items: ['a', 'b', 'c'] })).toBe('[0,F][1,][2,L]');
  });

  it('iterates object entries and exposes @key + this', () => {
    const t = strict('{{#each obj}}{{ @key }}:{{ this }};{{/each}}');
    const result = t.render({ obj: { x: '1', y: '2' } });
    expect(result).toBe('x:1;y:2;');
  });

  it('each over empty array renders nothing', () => {
    expect(strict('{{#each items}}{{ this }}{{/each}}').render({ items: [] })).toBe('');
  });

  it('supports dot-path access on loop items via this', () => {
    const t = strict('{{#each people}}{{ this.name }}|{{/each}}');
    expect(t.render({ people: [{ name: 'A' }, { name: 'B' }] })).toBe('A|B|');
  });
});

// ─── 6. Partials ─────────────────────────────────────────────────────────────

describe('partials', () => {
  afterEach(() => clearPartials());

  it('expands a registered partial', () => {
    registerPartial('greeting', 'Hello, {{ name }}!');
    const t = strict('{{> greeting}}');
    expect(t.render({ name: 'World' })).toBe('Hello, World!');
  });

  it('throws in strict mode when partial is missing', () => {
    expect(() => strict('{{> ghost}}').render({})).toThrow(/Missing partial/);
  });

  it('does not throw in loose mode when partial is missing', () => {
    expect(loose('{{> ghost}}').render({})).toBe('');
  });

  it('partial can reference another partial (non-recursive)', () => {
    registerPartial('inner', '({{ val }})');
    registerPartial('outer', '[{{> inner}}]');
    expect(strict('{{> outer}}').render({ val: 'ok' })).toBe('[(ok)]');
  });

  it('self-recursive partial throws after exceeding depth limit of 10', () => {
    registerPartial('bomb', '{{> bomb}}');
    expect(() => strict('{{> bomb}}').render({})).toThrow(/recursion depth/i);
  });
});

// ─── 7. Filters ──────────────────────────────────────────────────────────────

describe('filters', () => {
  it('upper filter uppercases the value', () => {
    expect(strict('{{ w | upper }}').render({ w: 'hello' })).toBe('HELLO');
  });

  it('lower filter lowercases the value', () => {
    expect(strict('{{ w | lower }}').render({ w: 'HELLO' })).toBe('hello');
  });

  it('trim filter strips surrounding whitespace', () => {
    expect(strict('{{ w | trim }}').render({ w: '  hi  ' })).toBe('hi');
  });

  it('json filter pretty-prints an object', () => {
    const obj = { a: 1, b: [2, 3] };
    expect(strict('{{ data | json }}').render({ data: obj })).toBe(
      JSON.stringify(obj, null, 2),
    );
  });

  it('length filter returns string length', () => {
    expect(strict('{{ s | length }}').render({ s: 'hello' })).toBe('5');
  });

  it('length filter returns array length', () => {
    expect(strict('{{ arr | length }}').render({ arr: [1, 2, 3] })).toBe('3');
  });

  it('truncate filter truncates with ellipsis when value exceeds N', () => {
    expect(strict('{{ s | truncate:5 }}').render({ s: 'Hello World' })).toBe('Hello\u2026');
  });

  it('truncate filter leaves short values intact', () => {
    expect(strict('{{ s | truncate:10 }}').render({ s: 'Hi' })).toBe('Hi');
  });

  it('default filter returns fallback when variable is undefined', () => {
    expect(loose('{{ x | default:\'none\' }}').render({})).toBe('none');
  });

  it('default filter does NOT replace a present value', () => {
    expect(strict('{{ x | default:\'none\' }}').render({ x: 'real' })).toBe('real');
  });

  it('default filter allows missing var without throwing in strict mode', () => {
    // Having a default filter suppresses strict-mode throw
    expect(strict('{{ x | default:\'ok\' }}').render({})).toBe('ok');
  });

  it('escape filter escapes { and } braces', () => {
    expect(strict('{{ code | escape }}').render({ code: '{{var}}' })).toBe('\\{\\{var\\}\\}');
  });

  it('filters are chainable: trim then upper', () => {
    expect(strict('{{ w | trim | upper }}').render({ w: '  hello  ' })).toBe('HELLO');
  });

  it('filters are chainable: json then upper is a valid chain', () => {
    // json converts to string, upper uppercases the JSON
    const result = strict('{{ x | json | upper }}').render({ x: { a: 1 } });
    expect(result).toContain('"A"');
  });
});

// ─── 8. Comments ─────────────────────────────────────────────────────────────

describe('comments', () => {
  it('{{!-- comment --}} is stripped entirely', () => {
    expect(strict('a{{!-- this is a comment --}}b').render({})).toBe('ab');
  });

  it('comment with special chars inside is stripped', () => {
    expect(strict('{{!-- {{ vars }} and more --}}end').render({})).toBe('end');
  });
});

// ─── 9. Raw triple-mustache ───────────────────────────────────────────────────

describe('raw triple-mustache', () => {
  it('{{{ var }}} renders the value without modification', () => {
    expect(strict('{{{ html }}}').render({ html: '<b>bold</b>' })).toBe('<b>bold</b>');
  });

  it('{{{ var }}} is equivalent to {{ var }} (no html-escaping in either)', () => {
    const val = '<script>alert(1)</script>';
    expect(strict('{{{ raw }}}').render({ raw: val })).toBe(val);
    expect(strict('{{ raw }}').render({ raw: val })).toBe(val);
  });
});

// ─── 10. Registry ─────────────────────────────────────────────────────────────

describe('registry', () => {
  it('register and get without version', () => {
    const reg = createRegistry();
    reg.register('greet', 'Hi {{ name }}');
    const t = reg.get('greet');
    expect(t.render({ name: 'Alice' })).toBe('Hi Alice');
  });

  it('register and get with explicit version', () => {
    const reg = createRegistry();
    reg.register('greet', 'Hi {{ name }}', 'v1');
    reg.register('greet', 'Hello {{ name }}', 'v2');
    expect(reg.get('greet', 'v1').render({ name: 'Bob' })).toBe('Hi Bob');
    expect(reg.get('greet', 'v2').render({ name: 'Bob' })).toBe('Hello Bob');
  });

  it('get throws when name not registered', () => {
    const reg = createRegistry();
    expect(() => reg.get('missing')).toThrow(/Template not found/);
  });

  it('list returns registered entries', () => {
    const reg = createRegistry();
    reg.register('a', 'aa');
    reg.register('b', 'bb', '1.0');
    const items = reg.list();
    expect(items).toContainEqual({ name: 'a', version: undefined });
    expect(items).toContainEqual({ name: 'b', version: '1.0' });
  });

  it('registry checksum is stable across calls', () => {
    const reg = createRegistry();
    reg.register('tmpl', '{{ x }}', 'v1');
    expect(reg.checksum('tmpl', 'v1')).toBe(reg.checksum('tmpl', 'v1'));
  });

  it('registry checksum equals template checksum for same source', () => {
    const reg = createRegistry();
    reg.register('tmpl', '{{ x }}');
    const direct = createTemplate('{{ x }}').checksum();
    expect(reg.checksum('tmpl')).toBe(direct);
  });
});

// ─── 11. Checksum stability ───────────────────────────────────────────────────

describe('checksum stability', () => {
  it('checksum is identical for whitespace-equivalent expressions', () => {
    expect(createTemplate('{{ name }}').checksum()).toBe(
      createTemplate('{{name}}').checksum(),
    );
    expect(createTemplate('{{  name  }}').checksum()).toBe(
      createTemplate('{{ name }}').checksum(),
    );
  });

  it('checksum differs for different templates', () => {
    expect(createTemplate('{{ a }}').checksum()).not.toBe(
      createTemplate('{{ b }}').checksum(),
    );
  });

  it('checksum is a 64-char hex string (sha256)', () => {
    const cs = createTemplate('hello {{ world }}').checksum();
    expect(cs).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── 12. validate() ──────────────────────────────────────────────────────────

describe('validate()', () => {
  it('returns ok:true when all referenced variables are present', () => {
    const t = createTemplate('{{ a }} {{ b }}');
    expect(t.validate({ a: 1, b: 2 })).toEqual({ ok: true, missing: [] });
  });

  it('returns ok:false and lists missing variables', () => {
    const t = createTemplate('{{ a }} {{ b }} {{ c }}');
    const result = t.validate({ a: 1 });
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('b');
    expect(result.missing).toContain('c');
    expect(result.missing).not.toContain('a');
  });

  it('reports missing nested path', () => {
    const t = createTemplate('{{ user.email }}');
    const result = t.validate({ user: { name: 'Bob' } });
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('user.email');
  });

  it('ok:true when no variables are referenced', () => {
    expect(createTemplate('plain text').validate({})).toEqual({ ok: true, missing: [] });
  });
});

// ─── 13. variables() ─────────────────────────────────────────────────────────

describe('variables()', () => {
  it('lists all referenced top-level paths', () => {
    const vars = createTemplate('{{ name }} is {{ age }} years old').variables();
    expect(vars).toEqual(new Set(['name', 'age']));
  });

  it('includes paths used in conditionals', () => {
    const vars = createTemplate('{{#if active}}yes{{/if}}').variables();
    expect(vars.has('active')).toBe(true);
  });

  it('includes the collection path for each loops', () => {
    const vars = createTemplate('{{#each items}}{{ this }}{{/each}}').variables();
    expect(vars.has('items')).toBe(true);
  });

  it('does not include loop specials (@index, @first, @last, this)', () => {
    const vars = createTemplate(
      '{{#each xs}}{{ this }} {{ @index }} {{ @first }} {{ @last }}{{/each}}',
    ).variables();
    expect(vars.has('@index')).toBe(false);
    expect(vars.has('@first')).toBe(false);
    expect(vars.has('@last')).toBe(false);
    expect(vars.has('this')).toBe(false);
    expect(vars.has('xs')).toBe(true);
  });
});
