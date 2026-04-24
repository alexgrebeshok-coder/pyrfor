import { describe, it, expect, vi } from 'vitest';
import { createPromptTemplateEngine, TemplateError } from './prompt-templates';

// ─── helpers ──────────────────────────────────────────────────────────────────

function engine(cacheSize = 64) {
  return createPromptTemplateEngine({ cacheSize });
}

function r(tpl: string, ctx: Record<string, any> = {}) {
  return engine().render(tpl, ctx);
}

// ─── 1. Empty / plain text ────────────────────────────────────────────────────

describe('empty and plain text', () => {
  it('empty template returns empty string', () => {
    expect(r('')).toBe('');
  });

  it('plain text returns unchanged', () => {
    expect(r('Hello, World!')).toBe('Hello, World!');
  });

  it('multi-line plain text preserved', () => {
    expect(r('line1\nline2\nline3')).toBe('line1\nline2\nline3');
  });
});

// ─── 2. Variable interpolation ────────────────────────────────────────────────

describe('variable interpolation', () => {
  it('renders simple variable', () => {
    expect(r('Hello {{ name }}!', { name: 'Alice' })).toBe('Hello Alice!');
  });

  it('renders dotted path user.name', () => {
    expect(r('{{ user.name }}', { user: { name: 'Bob' } })).toBe('Bob');
  });

  it('renders deeply nested path a.b.c', () => {
    expect(r('{{ a.b.c }}', { a: { b: { c: 'deep' } } })).toBe('deep');
  });

  it('missing top-level var renders empty string', () => {
    expect(r('{{ missing }}')).toBe('');
  });

  it('missing nested path renders empty string', () => {
    expect(r('{{ user.name }}', { user: {} })).toBe('');
  });

  it('null value renders empty string', () => {
    expect(r('{{ x }}', { x: null })).toBe('');
  });

  it('undefined value renders empty string', () => {
    expect(r('{{ x }}', { x: undefined })).toBe('');
  });

  it('number value renders as string', () => {
    expect(r('{{ n }}', { n: 42 })).toBe('42');
  });

  it('false renders as "false"', () => {
    expect(r('{{ flag }}', { flag: false })).toBe('false');
  });

  it('HTML special chars NOT auto-escaped (LLM prompts, not HTML)', () => {
    const raw = '<b>bold</b> & "quoted" it\'s fine';
    expect(r('{{ content }}', { content: raw })).toBe(raw);
  });
});

// ─── 3. Filters ───────────────────────────────────────────────────────────────

describe('filters', () => {
  it('upper filter', () => {
    expect(r('{{ x | upper }}', { x: 'hello' })).toBe('HELLO');
  });

  it('lower filter', () => {
    expect(r('{{ x | lower }}', { x: 'WORLD' })).toBe('world');
  });

  it('trim filter removes surrounding whitespace', () => {
    expect(r('{{ x | trim }}', { x: '  hi  ' })).toBe('hi');
  });

  it('json filter on object produces valid JSON', () => {
    const val = { a: 1, b: 'two' };
    expect(r('{{ x | json }}', { x: val })).toBe(JSON.stringify(val));
  });

  it('json filter quotes a string value', () => {
    expect(r('{{ x | json }}', { x: 'hello' })).toBe('"hello"');
  });

  it('json filter on null returns "null"', () => {
    expect(r('{{ x | json }}', { x: null })).toBe('null');
  });

  it('json filter on undefined returns "null"', () => {
    expect(r('{{ x | json }}')).toBe('null');
  });

  it('length filter on string', () => {
    expect(r('{{ x | length }}', { x: 'hello' })).toBe('5');
  });

  it('length filter on array', () => {
    expect(r('{{ x | length }}', { x: [1, 2, 3] })).toBe('3');
  });

  it('length filter on null returns 0', () => {
    expect(r('{{ x | length }}')).toBe('0');
  });

  it('default filter when value is defined returns value', () => {
    expect(r('{{ x | default("fallback") }}', { x: 'hello' })).toBe('hello');
  });

  it('default filter when undefined returns fallback', () => {
    expect(r('{{ x | default("fallback") }}')).toBe('fallback');
  });

  it('default filter when null returns fallback', () => {
    expect(r('{{ x | default("fallback") }}', { x: null })).toBe('fallback');
  });

  it('filter chain: trim then upper', () => {
    expect(r('{{ x | trim | upper }}', { x: '  hello  ' })).toBe('HELLO');
  });

  it('filter chain: lower then trim', () => {
    expect(r('{{ x | lower | trim }}', { x: '  WORLD  ' })).toBe('world');
  });

  it('custom filter via registerFilter', () => {
    const e = engine();
    e.registerFilter('repeat', (v: string, n: number) => String(v).repeat(n));
    expect(e.render('{{ x | repeat(3) }}', { x: 'ha' })).toBe('hahaha');
  });

  it('unknown filter throws error', () => {
    expect(() => r('{{ x | nonexistent }}', { x: 'v' })).toThrow("Unknown filter 'nonexistent'");
  });
});

// ─── 4. Comments ──────────────────────────────────────────────────────────────

describe('comments', () => {
  it('comment block is stripped from output', () => {
    expect(r('before{# this is a comment #}after')).toBe('beforeafter');
  });

  it('multi-line comment stripped', () => {
    expect(r('a{#\n  big\n  comment\n#}b')).toBe('ab');
  });
});

// ─── 5. Conditionals ─────────────────────────────────────────────────────────

describe('conditionals', () => {
  it('if true — branch is rendered', () => {
    expect(r('{% if show %}yes{% endif %}', { show: true })).toBe('yes');
  });

  it('if false — branch is not rendered', () => {
    expect(r('{% if show %}yes{% endif %}', { show: false })).toBe('');
  });

  it('if/else — true branch', () => {
    expect(r('{% if x %}A{% else %}B{% endif %}', { x: 1 })).toBe('A');
  });

  it('if/else — false branch', () => {
    expect(r('{% if x %}A{% else %}B{% endif %}', { x: 0 })).toBe('B');
  });

  it('elif — first branch taken', () => {
    const tpl = '{% if x == 1 %}one{% elif x == 2 %}two{% else %}other{% endif %}';
    expect(r(tpl, { x: 1 })).toBe('one');
  });

  it('elif — second branch taken', () => {
    const tpl = '{% if x == 1 %}one{% elif x == 2 %}two{% else %}other{% endif %}';
    expect(r(tpl, { x: 2 })).toBe('two');
  });

  it('elif — else branch taken', () => {
    const tpl = '{% if x == 1 %}one{% elif x == 2 %}two{% else %}other{% endif %}';
    expect(r(tpl, { x: 9 })).toBe('other');
  });

  it('not condition — negates truthy value', () => {
    expect(r('{% if not flag %}no{% endif %}', { flag: true })).toBe('');
  });

  it('not condition — negates falsy value', () => {
    expect(r('{% if not flag %}no{% endif %}', { flag: false })).toBe('no');
  });

  it('equality comparison with string literal', () => {
    expect(r('{% if role == "admin" %}ok{% endif %}', { role: 'admin' })).toBe('ok');
  });

  it('inequality comparison', () => {
    expect(r('{% if x != 0 %}nonzero{% endif %}', { x: 5 })).toBe('nonzero');
  });

  it('numeric greater-than comparison', () => {
    expect(r('{% if n > 10 %}big{% endif %}', { n: 11 })).toBe('big');
  });

  it('dotted path in condition', () => {
    expect(r('{% if user.active %}yes{% endif %}', { user: { active: true } })).toBe('yes');
  });
});

// ─── 6. For loops ─────────────────────────────────────────────────────────────

describe('for loops', () => {
  it('renders each item', () => {
    expect(r('{% for w in words %}{{ w }} {% endfor %}', { words: ['a', 'b', 'c'] })).toBe('a b c ');
  });

  it('loop.index0 is zero-based', () => {
    expect(r('{% for x in items %}{{ loop.index0 }}{% endfor %}', { items: ['a', 'b', 'c'] })).toBe('012');
  });

  it('loop.index1 is one-based', () => {
    expect(r('{% for x in items %}{{ loop.index1 }}{% endfor %}', { items: ['a', 'b', 'c'] })).toBe('123');
  });

  it('empty list renders nothing', () => {
    expect(r('{% for x in items %}{{ x }}{% endfor %}', { items: [] })).toBe('');
  });

  it('non-array list renders nothing', () => {
    expect(r('{% for x in items %}{{ x }}{% endfor %}', { items: null })).toBe('');
  });

  it('loop over objects accesses properties', () => {
    const tpl = '{% for u in users %}{{ u.name }},{% endfor %}';
    expect(r(tpl, { users: [{ name: 'A' }, { name: 'B' }] })).toBe('A,B,');
  });

  it('nested loops with independent indices', () => {
    const tpl = '{% for i in outer %}{% for j in inner %}{{ loop.index1 }}{% endfor %}{% endfor %}';
    expect(r(tpl, { outer: [1, 2], inner: ['a', 'b'] })).toBe('1212');
  });

  it('dotted list path in for tag', () => {
    const tpl = '{% for item in data.list %}{{ item }}{% endfor %}';
    expect(r(tpl, { data: { list: ['x', 'y'] } })).toBe('xy');
  });
});

// ─── 7. Partials / include ────────────────────────────────────────────────────

describe('partials and include', () => {
  it('include renders the named partial', () => {
    const e = engine();
    e.registerPartial('greeting', 'Hello, {{ name }}!');
    expect(e.render("{% include 'greeting' %}", { name: 'World' })).toBe('Hello, World!');
  });

  it('include passes full context to partial', () => {
    const e = engine();
    e.registerPartial('sig', '— {{ author }}, {{ year }}');
    expect(e.render("{% include 'sig' %}", { author: 'Alice', year: 2024 })).toBe('— Alice, 2024');
  });

  it('missing partial throws helpful error with available list', () => {
    const e = engine();
    e.registerPartial('other', 'x');
    expect(() => e.render("{% include 'missing' %}", {})).toThrow("Partial 'missing' not found");
  });

  it('missing partial error mentions available partials', () => {
    const e = engine();
    e.registerPartial('footer', 'f');
    try {
      e.render("{% include 'oops' %}", {});
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('footer');
    }
  });

  it('circular include A → B → A throws TemplateError', () => {
    const e = engine();
    e.registerPartial('A', "{% include 'B' %}");
    e.registerPartial('B', "{% include 'A' %}");
    expect(() => e.render("{% include 'A' %}", {})).toThrow(TemplateError);
  });

  it('circular include error message contains cycle path', () => {
    const e = engine();
    e.registerPartial('A', "{% include 'B' %}");
    e.registerPartial('B', "{% include 'A' %}");
    try {
      e.render("{% include 'A' %}", {});
      expect.fail('should throw');
    } catch (err: any) {
      expect(err.message).toMatch(/A.*B.*A|circular/i);
    }
  });

  it('listPartials returns registered names', () => {
    const e = engine();
    e.registerPartial('foo', 'x');
    e.registerPartial('bar', 'y');
    expect(e.listPartials().sort()).toEqual(['bar', 'foo']);
  });

  it('removePartial deletes partial from registry', () => {
    const e = engine();
    e.registerPartial('foo', 'x');
    e.removePartial('foo');
    expect(e.listPartials()).toEqual([]);
  });

  it('renderTemplate renders a named partial as root template', () => {
    const e = engine();
    e.registerPartial('main', 'Hi {{ name }}');
    expect(e.renderTemplate('main', { name: 'Pyrfor' })).toBe('Hi Pyrfor');
  });

  it('renderTemplate with unknown name throws', () => {
    const e = engine();
    expect(() => e.renderTemplate('missing', {})).toThrow(TemplateError);
  });
});

// ─── 8. Whitespace control ───────────────────────────────────────────────────

describe('whitespace control', () => {
  it('{%- strips whitespace before block tag', () => {
    expect(r('   {%- if true %}yes{% endif %}')).toBe('yes');
  });

  it('-%} strips whitespace after block tag', () => {
    expect(r('{% if true -%}   yes{% endif %}')).toBe('yes');
  });

  it('combined {%- -%} strips both sides', () => {
    // {%- if -%} strips leading ws from '  yes  ' → 'yes  '
    // {%- endif -%} then trims trailing ws from 'yes  ' → 'yes'
    expect(r('  {%- if true -%}  yes  {%- endif -%}  ')).toBe('yes');
  });

  it('whitespace control strips whitespace on both sides of adjacent tags', () => {
    const tpl = 'A  {%- if true -%}  B  {%- endif -%}  C';
    // 'A  '.trimEnd()='A', '  B  '.trimStart()='B  ', 'B  '.trimEnd()='B', '  C'.trimStart()='C'
    expect(r(tpl)).toBe('ABC');
  });
});

// ─── 9. Syntax errors ────────────────────────────────────────────────────────

describe('syntax errors', () => {
  it('unmatched {% if %} throws TemplateError with location', () => {
    expect(() => r('{% if x %}oops')).toThrow(TemplateError);
  });

  it('unmatched {% if %} error includes line info', () => {
    try {
      r('{% if x %}oops');
      expect.fail('should throw');
    } catch (err: any) {
      expect(err.message).toMatch(/line \d+/);
      expect(err.line).toBeGreaterThanOrEqual(1);
    }
  });

  it('unmatched {% for %} throws TemplateError', () => {
    expect(() => r('{% for x in items %}body')).toThrow(TemplateError);
  });

  it('unknown block tag throws TemplateError', () => {
    expect(() => r('{% bogus %}')).toThrow(TemplateError);
  });

  it('unclosed {{ throws TemplateError', () => {
    expect(() => r('{{ unclosed')).toThrow(TemplateError);
  });

  it('unclosed {% throws TemplateError', () => {
    expect(() => r('{% if x')).toThrow(TemplateError);
  });
});

// ─── 10. Cache behaviour ─────────────────────────────────────────────────────

describe('cache', () => {
  it('cache:hit logged on second render of same template', () => {
    const logs: string[] = [];
    const e = createPromptTemplateEngine({ logger: (msg) => logs.push(msg) });
    e.render('hi {{ x }}', { x: 1 });
    e.render('hi {{ x }}', { x: 2 });
    expect(logs.filter(m => m === 'cache:hit').length).toBe(1);
  });

  it('different templates get separate cache entries', () => {
    const logs: string[] = [];
    const e = createPromptTemplateEngine({ logger: (msg) => logs.push(msg) });
    e.render('tpl A {{ x }}', { x: 1 });
    e.render('tpl B {{ x }}', { x: 2 });
    expect(logs.filter(m => m === 'cache:miss').length).toBe(2);
  });

  it('clearCache forces recompile on next render', () => {
    const logs: string[] = [];
    const e = createPromptTemplateEngine({ logger: (msg) => logs.push(msg) });
    e.render('{{ x }}', { x: 1 });
    e.clearCache();
    e.render('{{ x }}', { x: 2 });
    expect(logs.filter(m => m === 'cache:miss').length).toBe(2);
  });

  it('LRU evicts oldest entry when cache is full', () => {
    const logs: string[] = [];
    const e = createPromptTemplateEngine({ cacheSize: 2, logger: (msg) => logs.push(msg) });
    e.render('T1 {{ x }}', {}); // miss — cache: [T1]
    e.render('T2 {{ x }}', {}); // miss — cache: [T1, T2]
    e.render('T3 {{ x }}', {}); // miss — cache: [T2, T3]; T1 evicted
    e.render('T1 {{ x }}', {}); // miss — T1 was evicted
    expect(logs.filter(m => m === 'cache:miss').length).toBe(4);
  });

  it('LRU hit refreshes entry preventing eviction', () => {
    const logs: string[] = [];
    const e = createPromptTemplateEngine({ cacheSize: 2, logger: (msg) => logs.push(msg) });
    e.render('T1 {{ x }}', {}); // miss
    e.render('T2 {{ x }}', {}); // miss
    e.render('T1 {{ x }}', {}); // hit — T1 becomes MRU
    e.render('T3 {{ x }}', {}); // miss — evicts T2 (LRU), not T1
    e.render('T1 {{ x }}', {}); // hit — T1 still in cache
    const hits = logs.filter(m => m === 'cache:hit').length;
    expect(hits).toBe(2);
  });
});

// ─── 11. Edge cases ──────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('multiple variables in one template', () => {
    expect(r('{{ a }}-{{ b }}-{{ c }}', { a: 1, b: 2, c: 3 })).toBe('1-2-3');
  });

  it('variable adjacent to text without spaces', () => {
    expect(r('{{x}}!', { x: 'hi' })).toBe('hi!');
  });

  it('filter with numeric argument', () => {
    const e = engine();
    e.registerFilter('add', (v: number, n: number) => v + n);
    expect(e.render('{{ x | add(10) }}', { x: 5 })).toBe('15');
  });

  it('nested if inside for loop', () => {
    const tpl = '{% for x in items %}{% if x > 2 %}{{ x }}{% endif %}{% endfor %}';
    expect(r(tpl, { items: [1, 2, 3, 4] })).toBe('34');
  });

  it('partial rendered via renderTemplate shares context', () => {
    const e = engine();
    e.registerPartial('tpl', '{{ greeting }}, {{ name }}!');
    expect(e.renderTemplate('tpl', { greeting: 'Hi', name: 'Pyrfor' })).toBe('Hi, Pyrfor!');
  });
});
