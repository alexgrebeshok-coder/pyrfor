import { describe, it, expect } from 'vitest';
import {
  splitLines,
  escapeHtml,
  lcsLines,
  computeDiff,
  unifiedDiff,
  patchFromDiff,
  renderHtml,
} from '../diff-view';

// ─── splitLines ───────────────────────────────────────────────────────────────

describe('splitLines', () => {
  it("'a\\nb\\n' → ['a','b']", () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
  });

  it("'' → []", () => {
    expect(splitLines('')).toEqual([]);
  });

  it('single line without trailing newline', () => {
    expect(splitLines('hello')).toEqual(['hello']);
  });

  it('normalises CRLF to LF', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
  });

  it('normalises standalone CR', () => {
    expect(splitLines('a\rb\r')).toEqual(['a', 'b']);
  });

  it('only a newline → []', () => {
    expect(splitLines('\n')).toEqual([]);
  });
});

// ─── escapeHtml ───────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it("'<script>' → '&lt;script&gt;'", () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes ampersand', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"value"')).toBe('&quot;value&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('passes plain text through unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  it('escapes multiple special chars in one string', () => {
    expect(escapeHtml('<b class="x">&amp;</b>')).toBe(
      '&lt;b class=&quot;x&quot;&gt;&amp;amp;&lt;/b&gt;'
    );
  });
});

// ─── lcsLines ─────────────────────────────────────────────────────────────────

describe('lcsLines', () => {
  it('identical arrays → all pairs', () => {
    const a = ['a', 'b', 'c'];
    expect(lcsLines(a, a)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('disjoint arrays → empty', () => {
    expect(lcsLines(['a', 'b'], ['c', 'd'])).toEqual([]);
  });

  it('empty a → []', () => {
    expect(lcsLines([], ['a', 'b'])).toEqual([]);
  });

  it('empty b → []', () => {
    expect(lcsLines(['a'], [])).toEqual([]);
  });

  it('both empty → []', () => {
    expect(lcsLines([], [])).toEqual([]);
  });

  it('single matching line', () => {
    expect(lcsLines(['a', 'b', 'c'], ['x', 'b', 'y'])).toEqual([[1, 1]]);
  });

  it('LCS is a subset, not the full sequence', () => {
    // a b c d  vs  b d e → LCS = b d
    const pairs = lcsLines(['a', 'b', 'c', 'd'], ['b', 'd', 'e']);
    expect(pairs).toEqual([
      [1, 0],
      [3, 1],
    ]);
  });
});

// ─── computeDiff ──────────────────────────────────────────────────────────────

describe('computeDiff – identical inputs', () => {
  it('produces 0 hunks', () => {
    const r = computeDiff({ oldText: 'a\nb\nc\n', newText: 'a\nb\nc\n' });
    expect(r.hunks).toHaveLength(0);
  });

  it('stats are all-unchanged', () => {
    const r = computeDiff({ oldText: 'a\nb\nc\n', newText: 'a\nb\nc\n' });
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 3 });
  });

  it('empty vs empty also produces 0 hunks', () => {
    const r = computeDiff({ oldText: '', newText: '' });
    expect(r.hunks).toHaveLength(0);
    expect(r.stats.unchanged).toBe(0);
  });
});

describe('computeDiff – single add', () => {
  it('line added at end: stats.added=1', () => {
    const r = computeDiff({ oldText: 'a\nb\n', newText: 'a\nb\nc\n' });
    expect(r.stats.added).toBe(1);
    expect(r.stats.removed).toBe(0);
    expect(r.stats.modified).toBe(0);
  });

  it('hunk contains one add op', () => {
    const r = computeDiff({ oldText: 'a\nb\n', newText: 'a\nb\nc\n' });
    const addOps = r.hunks.flatMap(h => h.ops).filter(op => op.kind === 'add');
    expect(addOps).toHaveLength(1);
    expect(addOps[0].newLine).toBe('c');
  });
});

describe('computeDiff – single remove', () => {
  it('line removed: stats.removed=1', () => {
    const r = computeDiff({ oldText: 'a\nb\nc\n', newText: 'a\nc\n' });
    expect(r.stats.removed).toBe(1);
    expect(r.stats.added).toBe(0);
    expect(r.stats.modified).toBe(0);
  });

  it('removed op carries oldLine', () => {
    const r = computeDiff({ oldText: 'a\nb\nc\n', newText: 'a\nc\n' });
    const removeOps = r.hunks.flatMap(h => h.ops).filter(op => op.kind === 'remove');
    expect(removeOps[0].oldLine).toBe('b');
  });
});

describe('computeDiff – replacement', () => {
  it('adjacent delete+insert becomes replace: stats.modified=1', () => {
    const r = computeDiff({ oldText: 'a\nb\nc\n', newText: 'a\nx\nc\n' });
    expect(r.stats.modified).toBe(1);
    expect(r.stats.added).toBe(0);
    expect(r.stats.removed).toBe(0);
  });

  it('replace op carries both oldLine and newLine', () => {
    const r = computeDiff({ oldText: 'a\nb\nc\n', newText: 'a\nx\nc\n' });
    const replaceOps = r.hunks.flatMap(h => h.ops).filter(op => op.kind === 'replace');
    expect(replaceOps).toHaveLength(1);
    expect(replaceOps[0].oldLine).toBe('b');
    expect(replaceOps[0].newLine).toBe('x');
  });
});

describe('computeDiff – contextLines', () => {
  it('defaults to 3: two distant changes produce 2 separate hunks', () => {
    // 20 lines, changes at line 1 and line 20 — more than 6 lines apart
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const old = lines.join('\n');
    const changed = lines
      .map((l, i) => (i === 0 ? 'CHANGED1' : i === 19 ? 'CHANGED20' : l))
      .join('\n');
    const r = computeDiff({ oldText: old, newText: changed });
    expect(r.hunks.length).toBeGreaterThanOrEqual(2);
  });

  it('contextLines=0 collapses all surrounding unchanged lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    const old = lines.join('\n');
    const nw = lines.map((l, i) => (i === 4 ? 'CHANGED' : l)).join('\n');
    const r = computeDiff({ oldText: old, newText: nw }, { contextLines: 0 });
    expect(r.hunks).toHaveLength(1);
    // No equal ops should appear in the hunk
    expect(r.hunks[0].ops.every(op => op.kind !== 'equal')).toBe(true);
  });

  it('contextLines=1 includes exactly 1 context line on each side', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    const old = lines.join('\n');
    const nw = lines.map((l, i) => (i === 4 ? 'CHANGED' : l)).join('\n');
    const r = computeDiff({ oldText: old, newText: nw }, { contextLines: 1 });
    // Hunk should have 1 equal before + 1 replace + 1 equal after = 3 ops
    expect(r.hunks).toHaveLength(1);
    const equalOps = r.hunks[0].ops.filter(op => op.kind === 'equal');
    expect(equalOps).toHaveLength(2);
  });
});

describe('computeDiff – metadata', () => {
  it('preserves filename', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n', filename: 'main.ts' });
    expect(r.filename).toBe('main.ts');
  });

  it('preserves language', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n', language: 'typescript' });
    expect(r.language).toBe('typescript');
  });
});

describe('computeDiff – edge cases', () => {
  it('empty → non-empty: stats.added equals new line count', () => {
    const r = computeDiff({ oldText: '', newText: 'a\nb\n' });
    expect(r.stats.added).toBe(2);
    expect(r.stats.removed).toBe(0);
  });

  it('non-empty → empty: stats.removed equals old line count', () => {
    const r = computeDiff({ oldText: 'a\nb\n', newText: '' });
    expect(r.stats.removed).toBe(2);
    expect(r.stats.added).toBe(0);
  });

  it('hunk oldStart/newStart are 1-based', () => {
    const r = computeDiff({ oldText: 'a\nb\nc\n', newText: 'a\nx\nc\n' });
    expect(r.hunks[0].oldStart).toBeGreaterThanOrEqual(1);
    expect(r.hunks[0].newStart).toBeGreaterThanOrEqual(1);
  });

  it('hunk line counts match op counts', () => {
    const r = computeDiff({ oldText: 'a\nb\nc\n', newText: 'a\nx\nc\n' });
    for (const hunk of r.hunks) {
      let expectedOld = 0;
      let expectedNew = 0;
      for (const op of hunk.ops) {
        if (op.kind === 'equal')   { expectedOld++; expectedNew++; }
        if (op.kind === 'remove')  { expectedOld++; }
        if (op.kind === 'add')     { expectedNew++; }
        if (op.kind === 'replace') { expectedOld++; expectedNew++; }
      }
      expect(hunk.oldLines).toBe(expectedOld);
      expect(hunk.newLines).toBe(expectedNew);
    }
  });
});

// ─── unifiedDiff ──────────────────────────────────────────────────────────────

describe('unifiedDiff', () => {
  it("produces valid '@@ -X,Y +A,B @@' headers", () => {
    const r = computeDiff({ oldText: 'a\nb\nc\n', newText: 'a\nx\nc\n' });
    const ud = unifiedDiff(r);
    expect(ud).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('includes diff --git header with filename', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n', filename: 'file.ts' });
    const ud = unifiedDiff(r);
    expect(ud).toContain('diff --git a/file.ts b/file.ts');
  });

  it('includes --- and +++ lines', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n', filename: 'file.ts' });
    const ud = unifiedDiff(r);
    expect(ud).toContain('--- a/file.ts');
    expect(ud).toContain('+++ b/file.ts');
  });

  it('no @@ lines for identical inputs (0 hunks)', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'a\n' });
    const ud = unifiedDiff(r);
    expect(ud).not.toMatch(/@@ /);
  });

  it('context lines are prefixed with a space', () => {
    const r = computeDiff({ oldText: 'a\nb\nc\n', newText: 'a\nx\nc\n' });
    const lines = unifiedDiff(r).split('\n');
    const contextLines = lines.filter(l => l.startsWith(' '));
    expect(contextLines.length).toBeGreaterThan(0);
  });
});

// ─── patchFromDiff ────────────────────────────────────────────────────────────

describe('patchFromDiff', () => {
  it("hunk lines carry '+'/'-'/' ' prefixes", () => {
    const r = computeDiff({ oldText: 'a\nb\nc\n', newText: 'a\nx\nc\n' });
    const patch = patchFromDiff(r);
    const hunkLines = patch.split('\n').filter(l =>
      l.startsWith('+') || l.startsWith('-') || l.startsWith(' ')
    );
    expect(hunkLines.length).toBeGreaterThan(0);
  });

  it('contains @@ -X,Y +A,B @@ headers', () => {
    const r = computeDiff({ oldText: 'a\nb\n', newText: 'a\nc\n' });
    expect(patchFromDiff(r)).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('replaced line appears as - then + pair', () => {
    const r = computeDiff({ oldText: 'x\n', newText: 'y\n' });
    const patch = patchFromDiff(r);
    expect(patch).toContain('-x');
    expect(patch).toContain('+y');
  });

  it('no +/- lines for identical inputs', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'a\n' });
    const patch = patchFromDiff(r);
    // Exclude the --- / +++ header lines; only count actual hunk change lines
    const changingLines = patch.split('\n').filter(l =>
      (l.startsWith('+') && !l.startsWith('+++')) ||
      (l.startsWith('-') && !l.startsWith('---'))
    );
    expect(changingLines).toHaveLength(0);
  });
});

// ─── renderHtml ───────────────────────────────────────────────────────────────

describe('renderHtml', () => {
  it("wraps output in a diff-view-wrapper element", () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n' });
    expect(renderHtml(r)).toContain('class="diff-view-wrapper"');
  });

  it("table carries class 'diff-view'", () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n' });
    expect(renderHtml(r)).toMatch(/class="diff-view"/);
  });

  it('escapes <script> in line content', () => {
    const r = computeDiff({
      oldText: '<script>alert(1)</script>\n',
      newText: '<script>alert(2)</script>\n',
    });
    const html = renderHtml(r);
    // Raw <script> tags must not appear inside table cells
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toContain('&lt;script&gt;');
  });

  it('embeds nonce attribute on <style> when nonce is provided', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n' });
    const html = renderHtml(r, { nonce: 'abc123' });
    expect(html).toContain('nonce="abc123"');
  });

  it('no nonce attribute when nonce is omitted', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n' });
    expect(renderHtml(r)).not.toContain('nonce=');
  });

  it('dark theme sets data-theme="dark"', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n' });
    expect(renderHtml(r, { theme: 'dark' })).toContain('data-theme="dark"');
  });

  it('light theme by default', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n' });
    expect(renderHtml(r)).toContain('data-theme="light"');
  });

  it('explicitly passing light theme', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n' });
    expect(renderHtml(r, { theme: 'light' })).toContain('data-theme="light"');
  });

  it('includes filename when present', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n', filename: 'hello.ts' });
    expect(renderHtml(r)).toContain('hello.ts');
  });

  it('shows "No differences" for identical inputs', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'a\n' });
    expect(renderHtml(r)).toContain('No differences');
  });

  it('contains no inline <script> tags', () => {
    const r = computeDiff({ oldText: 'a\n', newText: 'b\n' });
    // The rendered HTML must not have script elements (CSP requirement)
    expect(renderHtml(r)).not.toMatch(/<script[\s>]/i);
  });
});

// ─── performance ──────────────────────────────────────────────────────────────

describe('performance', () => {
  it('1000-line file with 10 scattered changes completes within vitest timeout', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1} with some content`);
    const newLines = lines.map((l, i) => (i % 100 === 0 ? `CHANGED ${i}` : l));
    const r = computeDiff({ oldText: lines.join('\n'), newText: newLines.join('\n') });
    // 10 replace ops (indices 0,100,200,...,900)
    expect(r.stats.modified).toBe(10);
    expect(r.stats.added).toBe(0);
    expect(r.stats.removed).toBe(0);
  });

  it('large identical file (1000 lines) returns 0 hunks quickly', () => {
    const text = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
    const r = computeDiff({ oldText: text, newText: text });
    expect(r.hunks).toHaveLength(0);
    expect(r.stats.unchanged).toBe(1000);
  });
});
