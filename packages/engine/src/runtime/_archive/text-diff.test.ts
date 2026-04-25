// @vitest-environment node
/**
 * Tests for text-diff: Myers O(ND) word/char/line diff + unified-diff format.
 *
 * Coverage target: ≥ 45 tests across all exported functions.
 */

import { describe, it, expect } from 'vitest';
import {
  diffWords,
  diffChars,
  diffLines,
  unifiedDiff,
  similarity,
  applyPatch,
  type DiffOp,
  type LineDiffEntry,
} from './text-diff';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Reconstruct the original string from a DiffOp[] (equal + delete = "a" side). */
function reconstruct(ops: DiffOp[], side: 'a' | 'b'): string {
  return ops
    .filter(op => (side === 'a' ? op.kind !== 'insert' : op.kind !== 'delete'))
    .map(op => op.value)
    .join('');
}

// ─── diffWords ────────────────────────────────────────────────────────────────

describe('diffWords', () => {
  it('identical strings → single equal op', () => {
    const ops = diffWords('hello world', 'hello world');
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('equal');
    expect(ops[0].value).toBe('hello world');
  });

  it('pure insert (b has extra word at end)', () => {
    const ops = diffWords('hello', 'hello world');
    const inserts = ops.filter(o => o.kind === 'insert');
    const deletes = ops.filter(o => o.kind === 'delete');
    expect(deletes).toHaveLength(0);
    expect(inserts.map(o => o.value).join('')).toBe(' world');
  });

  it('pure delete (a has extra word)', () => {
    const ops = diffWords('hello world', 'hello');
    const inserts = ops.filter(o => o.kind === 'insert');
    const deletes = ops.filter(o => o.kind === 'delete');
    expect(inserts).toHaveLength(0);
    expect(deletes.map(o => o.value).join('')).toBe(' world');
  });

  it('mixed change: one word replaced', () => {
    const ops = diffWords('hello world', 'hello earth');
    const kinds = ops.map(o => o.kind);
    expect(kinds).toContain('equal');
    expect(kinds).toContain('delete');
    expect(kinds).toContain('insert');
    expect(ops.find(o => o.kind === 'delete')?.value).toBe('world');
    expect(ops.find(o => o.kind === 'insert')?.value).toBe('earth');
  });

  it('mixed change: word inserted in middle', () => {
    const ops = diffWords('foo bar', 'foo baz bar');
    expect(ops.filter(o => o.kind === 'insert').map(o => o.value).join('')).toBe('baz ');
  });

  it('reconstruct a-side from ops', () => {
    const a = 'the quick brown fox';
    const b = 'the slow red fox';
    expect(reconstruct(diffWords(a, b), 'a')).toBe(a);
  });

  it('reconstruct b-side from ops', () => {
    const a = 'the quick brown fox';
    const b = 'the slow red fox';
    expect(reconstruct(diffWords(a, b), 'b')).toBe(b);
  });

  it('empty string vs non-empty → single insert op', () => {
    const ops = diffWords('', 'hello');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ kind: 'insert', value: 'hello' });
  });

  it('non-empty vs empty string → single delete op', () => {
    const ops = diffWords('hello', '');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ kind: 'delete', value: 'hello' });
  });

  it('both empty → single equal op with empty value', () => {
    const ops = diffWords('', '');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ kind: 'equal', value: '' });
  });

  it('whitespace-only strings treated as tokens', () => {
    const ops = diffWords('  ', '   ');
    const hasChange = ops.some(o => o.kind !== 'equal');
    expect(hasChange).toBe(true);
  });

  it('multiple word changes preserve equal regions', () => {
    const ops = diffWords('a b c d e', 'a X c Y e');
    const equalValues = ops.filter(o => o.kind === 'equal').map(o => o.value.trim());
    expect(equalValues).toContain('a');
    expect(equalValues).toContain('c');
    expect(equalValues).toContain('e');
  });
});

// ─── diffChars ────────────────────────────────────────────────────────────────

describe('diffChars', () => {
  it('identical strings → single equal op', () => {
    const ops = diffChars('abc', 'abc');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ kind: 'equal', value: 'abc' });
  });

  it('single character inserted', () => {
    const ops = diffChars('ac', 'abc');
    const ins = ops.filter(o => o.kind === 'insert');
    expect(ins.map(o => o.value).join('')).toBe('b');
  });

  it('single character deleted', () => {
    const ops = diffChars('abc', 'ac');
    const del = ops.filter(o => o.kind === 'delete');
    expect(del.map(o => o.value).join('')).toBe('b');
  });

  it('granular: mixed char changes', () => {
    const ops = diffChars('kitten', 'sitting');
    expect(reconstruct(ops, 'a')).toBe('kitten');
    expect(reconstruct(ops, 'b')).toBe('sitting');
  });

  it('both empty → single equal op', () => {
    const ops = diffChars('', '');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ kind: 'equal', value: '' });
  });

  it('empty vs non-empty → single insert', () => {
    const ops = diffChars('', 'xyz');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ kind: 'insert', value: 'xyz' });
  });

  it('char-level is finer than word-level', () => {
    const wordOps = diffWords('hello', 'helo');
    const charOps = diffChars('hello', 'helo');
    // char diff finds the single deleted 'l'; word diff replaces whole word
    const charDels = charOps.filter(o => o.kind === 'delete').map(o => o.value).join('');
    expect(charDels).toBe('l');
    expect(wordOps.some(o => o.kind === 'delete')).toBe(true);
  });

  it('reconstructs a-side', () => {
    const a = 'Saturday';
    const b = 'Sunday';
    expect(reconstruct(diffChars(a, b), 'a')).toBe(a);
  });

  it('reconstructs b-side', () => {
    const a = 'Saturday';
    const b = 'Sunday';
    expect(reconstruct(diffChars(a, b), 'b')).toBe(b);
  });
});

// ─── diffLines ────────────────────────────────────────────────────────────────

describe('diffLines', () => {
  it('identical multi-line strings → all equal', () => {
    const entries = diffLines('a\nb\nc', 'a\nb\nc');
    expect(entries.every(e => e.kind === 'equal')).toBe(true);
    expect(entries).toHaveLength(3);
  });

  it('single line insert', () => {
    const entries = diffLines('a\nc', 'a\nb\nc');
    const inserts = entries.filter(e => e.kind === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].line).toBe('b');
  });

  it('single line delete', () => {
    const entries = diffLines('a\nb\nc', 'a\nc');
    const deletes = entries.filter(e => e.kind === 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].line).toBe('b');
  });

  it('multiple lines changed', () => {
    const entries = diffLines('a\nb\nc', 'a\nX\nY\nc');
    expect(entries.filter(e => e.kind === 'delete').map(e => e.line)).toEqual(['b']);
    expect(entries.filter(e => e.kind === 'insert').map(e => e.line)).toEqual(['X', 'Y']);
  });

  it('equal entries carry correct oldLineNo and newLineNo', () => {
    const entries = diffLines('x\ny\nz', 'x\ny\nz');
    entries.forEach((e, i) => {
      expect(e.oldLineNo).toBe(i + 1);
      expect(e.newLineNo).toBe(i + 1);
    });
  });

  it('delete entries have oldLineNo but no newLineNo', () => {
    const entries = diffLines('a\nb\nc', 'a\nc');
    const del = entries.find(e => e.kind === 'delete')!;
    expect(del.oldLineNo).toBeDefined();
    expect(del.newLineNo).toBeUndefined();
  });

  it('insert entries have newLineNo but no oldLineNo', () => {
    const entries = diffLines('a\nc', 'a\nb\nc');
    const ins = entries.find(e => e.kind === 'insert')!;
    expect(ins.newLineNo).toBeDefined();
    expect(ins.oldLineNo).toBeUndefined();
  });

  it('line numbers increment correctly across changes', () => {
    const entries = diffLines('a\nb\nc', 'a\nX\nc');
    const eq = entries.filter(e => e.kind === 'equal');
    expect(eq[0].oldLineNo).toBe(1);
    expect(eq[0].newLineNo).toBe(1);
    // 'c' is line 3 in old, line 3 in new
    expect(eq[1].oldLineNo).toBe(3);
    expect(eq[1].newLineNo).toBe(3);
  });

  it('trailing newline: "a\\n" has empty last line', () => {
    const entries = diffLines('a\n', 'a\n');
    // split('\n') of 'a\n' is ['a', ''] — two entries
    expect(entries).toHaveLength(2);
    expect(entries[1].line).toBe('');
  });

  it('trailing newline difference is detected', () => {
    const entries = diffLines('a\n', 'a');
    const hasChange = entries.some(e => e.kind !== 'equal');
    expect(hasChange).toBe(true);
  });

  it('empty input → single equal entry with empty line', () => {
    const entries = diffLines('', '');
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('equal');
    expect(entries[0].line).toBe('');
  });
});

// ─── unifiedDiff ──────────────────────────────────────────────────────────────

describe('unifiedDiff', () => {
  it('identical strings → empty string', () => {
    expect(unifiedDiff('hello\nworld', 'hello\nworld')).toBe('');
  });

  it('output starts with --- and +++ headers', () => {
    const patch = unifiedDiff('a\nb', 'a\nc');
    const lines = patch.split('\n');
    expect(lines[0]).toMatch(/^--- /);
    expect(lines[1]).toMatch(/^\+\+\+ /);
  });

  it('fromFile / toFile appear in headers', () => {
    const patch = unifiedDiff('a', 'b', { fromFile: 'old.txt', toFile: 'new.txt' });
    expect(patch).toContain('--- old.txt');
    expect(patch).toContain('+++ new.txt');
  });

  it('contains @@ hunk header', () => {
    const patch = unifiedDiff('a\nb\nc', 'a\nX\nc');
    expect(patch).toMatch(/@@.*@@/);
  });

  it('@@ header has correct old line numbers', () => {
    // change is on line 2; with ctx=3 hunk covers lines 1-3
    const patch = unifiedDiff('a\nb\nc', 'a\nX\nc');
    expect(patch).toMatch(/@@ -1,3 \+1,3 @@/);
  });

  it('@@ header has correct new line numbers', () => {
    const patch = unifiedDiff('a\nb\nc\nd\ne', 'a\nb\nX\nd\ne');
    expect(patch).toMatch(/@@ -1,5 \+1,5 @@/);
  });

  it('default context is 3 lines', () => {
    // Build a file where change is far from edges so context matters
    const a = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
    const b = a.replace('line5', 'CHANGED');
    const patch = unifiedDiff(a, b);
    const hunkLines = patch.split('\n').filter(l => l.startsWith(' '));
    // 3 context lines before + 3 after = 6 equal lines in the hunk
    expect(hunkLines.length).toBe(6);
  });

  it('custom context=1 reduces surrounding lines', () => {
    const a = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
    const b = a.replace('line5', 'CHANGED');
    const patch = unifiedDiff(a, b, { context: 1 });
    const hunkLines = patch.split('\n').filter(l => l.startsWith(' '));
    expect(hunkLines.length).toBe(2); // 1 before + 1 after
  });

  it('context=0 shows only changed lines', () => {
    const patch = unifiedDiff('a\nb\nc', 'a\nX\nc', { context: 0 });
    expect(patch.split('\n').filter(l => l.startsWith(' '))).toHaveLength(0);
    expect(patch).toContain('-b');
    expect(patch).toContain('+X');
  });

  it('delete-only change is formatted correctly', () => {
    const patch = unifiedDiff('a\nb\nc', 'a\nc');
    expect(patch).toContain('-b');
    expect(patch).not.toContain('+b');
  });

  it('insert-only change is formatted correctly', () => {
    const patch = unifiedDiff('a\nc', 'a\nb\nc');
    expect(patch).toContain('+b');
    expect(patch).not.toContain('-b');
  });

  it('multiple hunks when changes are far apart', () => {
    const a = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
    const lines = a.split('\n');
    lines[1] = 'CHANGE_A'; // line 2
    lines[18] = 'CHANGE_B'; // line 19
    const b = lines.join('\n');
    const patch = unifiedDiff(a, b);
    const hunkHeaders = patch.split('\n').filter(l => l.startsWith('@@'));
    expect(hunkHeaders.length).toBe(2);
  });

  it('single-line files', () => {
    const patch = unifiedDiff('hello', 'world');
    expect(patch).toContain('-hello');
    expect(patch).toContain('+world');
  });

  it('change at start of file', () => {
    const patch = unifiedDiff('OLD\nb\nc', 'NEW\nb\nc');
    expect(patch).toContain('-OLD');
    expect(patch).toContain('+NEW');
  });

  it('change at end of file', () => {
    const patch = unifiedDiff('a\nb\nOLD', 'a\nb\nNEW');
    expect(patch).toContain('-OLD');
    expect(patch).toContain('+NEW');
  });
});

// ─── similarity ───────────────────────────────────────────────────────────────

describe('similarity', () => {
  it('identical strings → 1.0', () => {
    expect(similarity('hello', 'hello')).toBe(1.0);
  });

  it('identical empty strings → 1.0', () => {
    expect(similarity('', '')).toBe(1.0);
  });

  it('completely different strings → 0.0', () => {
    expect(similarity('abc', 'xyz')).toBe(0.0);
  });

  it('completely different single chars → 0.0', () => {
    expect(similarity('a', 'b')).toBe(0.0);
  });

  it('half overlap → ~0.5', () => {
    // a='abcd', b='abXY': 2 chars match ('ab'), total=8 → 2*2/8 = 0.5
    expect(similarity('abcd', 'abXY')).toBeCloseTo(0.5, 5);
  });

  it('one char longer string has lower similarity than equal', () => {
    expect(similarity('abc', 'abcd')).toBeLessThan(1.0);
    expect(similarity('abc', 'abcd')).toBeGreaterThan(0.0);
  });

  it('similarity is symmetric', () => {
    expect(similarity('hello', 'helo')).toBeCloseTo(similarity('helo', 'hello'), 10);
  });

  it('returns value in [0, 1] range', () => {
    const s = similarity('the quick brown fox', 'the slow red dog');
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

// ─── applyPatch ───────────────────────────────────────────────────────────────

describe('applyPatch', () => {
  it('round-trip: applyPatch(a, unifiedDiff(a, b)) === b (simple change)', () => {
    const a = 'hello\nworld\n';
    const b = 'hello\nearth\n';
    expect(applyPatch(a, unifiedDiff(a, b))).toBe(b);
  });

  it('round-trip: insert at end', () => {
    const a = 'line1\nline2';
    const b = 'line1\nline2\nline3';
    expect(applyPatch(a, unifiedDiff(a, b))).toBe(b);
  });

  it('round-trip: delete in middle', () => {
    const a = 'a\nb\nc\nd';
    const b = 'a\nc\nd';
    expect(applyPatch(a, unifiedDiff(a, b))).toBe(b);
  });

  it('round-trip: multiple hunks', () => {
    const baseLines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const a = baseLines.join('\n');
    const bLines = [...baseLines];
    bLines[1] = 'CHANGED_2';
    bLines[18] = 'CHANGED_19';
    const b = bLines.join('\n');
    expect(applyPatch(a, unifiedDiff(a, b))).toBe(b);
  });

  it('round-trip: insert-only patch', () => {
    const a = 'first\nthird';
    const b = 'first\nsecond\nthird';
    expect(applyPatch(a, unifiedDiff(a, b))).toBe(b);
  });

  it('round-trip: delete-only patch', () => {
    const a = 'first\nsecond\nthird';
    const b = 'first\nthird';
    expect(applyPatch(a, unifiedDiff(a, b))).toBe(b);
  });

  it('empty patch → returns original unchanged', () => {
    expect(applyPatch('hello\nworld', '')).toBe('hello\nworld');
    expect(applyPatch('hello\nworld', '   ')).toBe('hello\nworld');
  });

  it('identical-file patch → returns original', () => {
    const a = 'no changes here';
    const patch = unifiedDiff(a, a); // returns ''
    expect(applyPatch(a, patch)).toBe(a);
  });

  it('conflict: context line does not match → returns null', () => {
    const a = 'a\nb\nc';
    const b = 'a\nX\nc';
    const patch = unifiedDiff(a, b);
    // Tamper with 'a' before applying the old patch
    const modified = 'TAMPERED\nb\nc';
    expect(applyPatch(modified, patch)).toBeNull();
  });

  it('conflict: delete line does not match → returns null', () => {
    const a = 'a\nb\nc';
    const b = 'a\nc';
    const patch = unifiedDiff(a, b);
    // 'b' is gone, so the delete line won't match
    const modified = 'a\nDIFFERENT\nc';
    expect(applyPatch(modified, patch)).toBeNull();
  });

  it('handles multiple consecutive inserts', () => {
    const a = 'start\nend';
    const b = 'start\nmiddle1\nmiddle2\nmiddle3\nend';
    expect(applyPatch(a, unifiedDiff(a, b))).toBe(b);
  });
});

// ─── Performance ──────────────────────────────────────────────────────────────

describe('performance', () => {
  it('10k-line file with small change completes quickly', () => {
    const lines = Array.from({ length: 10_000 }, (_, i) => `line content ${i}`);
    const a = lines.join('\n');
    const bLines = [...lines];
    bLines[4999] = 'INSERTED LINE';
    const b = bLines.join('\n');

    const t0 = Date.now();
    const patch = unifiedDiff(a, b);
    const result = applyPatch(a, patch);
    const elapsed = Date.now() - t0;

    expect(result).toBe(b);
    expect(elapsed).toBeLessThan(5000); // should finish well under 5 s
  });
});
