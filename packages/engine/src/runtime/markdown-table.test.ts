// @vitest-environment node
/**
 * Tests for markdown-table: GFM table parser + formatter.
 *
 * 40 test cases covering all exported functions and edge cases.
 *
 * Emoji display-width note: each emoji code point counts as width 1 in this
 * implementation (see module JSDoc).  e.g. displayWidth('🎉') === 1.
 */

import { describe, it, expect } from 'vitest';
import {
  displayWidth,
  parseTable,
  formatTable,
  renderObjects,
  extractTables,
  type Alignment,
  type ParsedTable,
} from './markdown-table';

// ─── displayWidth ─────────────────────────────────────────────────────────────

describe('displayWidth', () => {
  it('counts ASCII characters as width 1 each', () => {
    expect(displayWidth('hello')).toBe(5);
    expect(displayWidth('')).toBe(0);
    expect(displayWidth('abc123')).toBe(6);
  });

  it('counts a CJK ideograph (U+4E00 range) as width 2', () => {
    expect(displayWidth('中')).toBe(2);   // U+4E2D — CJK unified ideograph
    expect(displayWidth('中文')).toBe(4); // two CJK chars
  });

  it('counts a Hiragana char (U+3040 range) as width 2', () => {
    expect(displayWidth('あ')).toBe(2); // U+3042
  });

  it('counts a Katakana char (U+30A0 range) as width 2', () => {
    expect(displayWidth('ア')).toBe(2); // U+30A2
  });

  it('counts CJK symbols & punctuation (U+3000 range) as width 2', () => {
    expect(displayWidth('。')).toBe(2); // U+3002 ideographic full stop
  });

  it('counts fullwidth Latin (U+FF00 range) as width 2', () => {
    expect(displayWidth('Ａ')).toBe(2); // U+FF21 fullwidth A
  });

  it('counts a mixed ASCII + CJK string correctly', () => {
    // 'Hello' (5) + '世界' (4) = 9
    expect(displayWidth('Hello世界')).toBe(9);
  });

  it('counts an emoji code point as width 1 (documented choice)', () => {
    // 🎉 = U+1F389, one code point → width 1
    expect(displayWidth('🎉')).toBe(1);
    // 😀 = U+1F600, one code point → width 1
    expect(displayWidth('😀')).toBe(1);
  });

  it('counts a multi-code-point emoji ZWJ sequence as the number of code points', () => {
    // 👨‍👩‍👧 = U+1F468 + ZWJ + U+1F469 + ZWJ + U+1F467 → 5 code points (3 emoji + 2 ZWJ)
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    expect(displayWidth(family)).toBe(5);
  });
});

// ─── parseTable ───────────────────────────────────────────────────────────────

describe('parseTable', () => {
  it('parses a basic 3-column table with pipes on both sides', () => {
    const md = `| Name | Age | City |
| --- | --- | --- |
| Alice | 30 | NYC |
| Bob | 25 | LA |`;
    const result = parseTable(md);
    expect(result).not.toBeNull();
    expect(result!.headers).toEqual(['Name', 'Age', 'City']);
    expect(result!.rows).toHaveLength(2);
    expect(result!.rows[0]).toEqual(['Alice', '30', 'NYC']);
    expect(result!.rows[1]).toEqual(['Bob', '25', 'LA']);
  });

  it('detects left-alignment marker `:---`', () => {
    const md = `| A |\n| :--- |\n| x |`;
    const result = parseTable(md);
    expect(result!.alignments[0]).toBe('left');
  });

  it('detects right-alignment marker `---:`', () => {
    const md = `| A |\n| ---: |\n| x |`;
    const result = parseTable(md);
    expect(result!.alignments[0]).toBe('right');
  });

  it('detects center-alignment marker `:---:`', () => {
    const md = `| A |\n| :---: |\n| x |`;
    const result = parseTable(md);
    expect(result!.alignments[0]).toBe('center');
  });

  it('returns null alignment for plain `---`', () => {
    const md = `| A |\n| --- |\n| x |`;
    const result = parseTable(md);
    expect(result!.alignments[0]).toBeNull();
  });

  it('parses a table with no leading or trailing pipes (GFM valid)', () => {
    const md = `Name | Age
--- | ---
Alice | 30`;
    const result = parseTable(md);
    expect(result).not.toBeNull();
    expect(result!.headers).toEqual(['Name', 'Age']);
    expect(result!.rows[0]).toEqual(['Alice', '30']);
  });

  it('unescapes \\| in cell content to |', () => {
    const md = `| Cell |
| --- |
| a\\|b |`;
    const result = parseTable(md);
    expect(result!.rows[0]![0]).toBe('a|b');
  });

  it('returns null for a plain paragraph (no table)', () => {
    expect(parseTable('Hello world\nThis is text.')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseTable('')).toBeNull();
  });

  it('returns null for a single line', () => {
    expect(parseTable('| A | B |')).toBeNull();
  });

  it('returns null when separator row has only 2 dashes (< 3)', () => {
    const md = `| A | B |
| -- | -- |
| 1 | 2 |`;
    expect(parseTable(md)).toBeNull();
  });

  it('accepts separator with exactly 3 dashes', () => {
    const md = `| A |\n| --- |\n| x |`;
    expect(parseTable(md)).not.toBeNull();
  });

  it('returns rows: [] for a table with header+separator only (no data rows)', () => {
    const md = `| A | B |\n| --- | --- |`;
    const result = parseTable(md);
    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(0);
  });

  it('handles empty cells in the header row', () => {
    const md = `|  | Name |
| --- | --- |
| 1 | Alice |`;
    const result = parseTable(md);
    expect(result!.headers[0]).toBe('');
    expect(result!.headers[1]).toBe('Name');
  });

  it('trims whitespace from cell content', () => {
    const md = `|  Name  |  Age  |
| ---  |  ---  |
|  Alice  |  30  |`;
    const result = parseTable(md);
    expect(result!.headers).toEqual(['Name', 'Age']);
    expect(result!.rows[0]).toEqual(['Alice', '30']);
  });

  it('stops collecting data rows at a blank line', () => {
    const md = `| A |
| --- |
| 1 |

| B |
| --- |
| 2 |`;
    const result = parseTable(md);
    expect(result!.rows).toHaveLength(1);
  });

  it('stops collecting data rows at a non-table line', () => {
    const md = `| A |
| --- |
| 1 |
Not a table row`;
    const result = parseTable(md);
    expect(result!.rows).toHaveLength(1);
  });

  it('parses mixed alignments on a multi-column table', () => {
    const md = `| L | R | C | N |
| :--- | ---: | :---: | --- |
| a | b | c | d |`;
    const result = parseTable(md);
    expect(result!.alignments).toEqual(['left', 'right', 'center', null]);
  });
});

// ─── formatTable ──────────────────────────────────────────────────────────────

describe('formatTable', () => {
  it('produces header row, separator row, and data rows', () => {
    const lines = formatTable({
      headers: ['A', 'B'],
      rows: [['1', '2']],
    }).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\|/);  // header
    expect(lines[1]).toMatch(/^[-|: ]+$/); // separator
    expect(lines[2]).toMatch(/^\|/);  // data
  });

  it('pads cells to the widest value in the column', () => {
    const out = formatTable({
      headers: ['Name'],
      rows: [['Al'], ['Alexander']],
    });
    const lines = out.split('\n');
    // All lines must have the same length (header, sep, data rows)
    const lens = lines.map((l) => l.length);
    expect(new Set(lens).size).toBe(1);
  });

  it('generates separator dashes equal to inner column width', () => {
    // 'AB' has displayWidth 2; with default padding=1, innerW = 2 + 2 = 4 dashes.
    const out = formatTable({
      headers: ['AB'],
      alignments: [null],
      rows: [],
    });
    const sepLine = out.split('\n')[1]!;
    // Separator cell must contain only dashes (and pipes as delimiters).
    expect(sepLine.replace(/[|]/g, '').replace(/-/g, '')).toBe('');
    // Must have ≥ 3 dashes.
    expect((sepLine.match(/-/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // Inner width = displayWidth('AB') + 2*padding = 2 + 2 = 4.
    expect(sepLine).toBe('|----|');
  });

  it('applies left alignment (extra spaces on right)', () => {
    const out = formatTable({
      headers: ['X'],
      alignments: ['left'],
      rows: [['ab'], ['abcde']],
    });
    const lines = out.split('\n');
    // Header separator starts with ':'
    expect(lines[1]).toContain(':');
    expect(lines[1]).toMatch(/^|\s*:---/);
  });

  it('applies right alignment (extra spaces on left, separator ends with :)', () => {
    const out = formatTable({
      headers: ['X'],
      alignments: ['right'],
      rows: [['ab'], ['abcde']],
    });
    const lines = out.split('\n');
    expect(lines[1]).toMatch(/---:\|/);
  });

  it('applies center alignment (separator wrapped in colons)', () => {
    const out = formatTable({
      headers: ['X'],
      alignments: ['center'],
      rows: [['abc']],
    });
    const lines = out.split('\n');
    expect(lines[1]).toMatch(/:-+:\|/);
  });

  it('auto right-aligns a purely numeric column', () => {
    const out = formatTable({
      headers: ['Score'],
      rows: [['10'], ['200'], ['3']],
    });
    expect(out.split('\n')[1]).toMatch(/---:\|/);
  });

  it('does NOT auto right-align a column with non-numeric cells', () => {
    const out = formatTable({
      headers: ['Name'],
      rows: [['Alice'], ['Bob']],
    });
    expect(out.split('\n')[1]).not.toMatch(/---:/);
  });

  it('respects alignment="none" and does not infer numeric right-align', () => {
    const out = formatTable(
      { headers: ['N'], rows: [['1'], ['2']] },
      { alignment: 'none' },
    );
    expect(out.split('\n')[1]).not.toMatch(/---:/);
  });

  it('preserves mixed alignments in a format round-trip', () => {
    const original: ParsedTable = {
      headers: ['L', 'R', 'C', 'N'],
      alignments: ['left', 'right', 'center', null],
      rows: [['a', '1', 'b', 'c']],
    };
    const formatted = formatTable(original, { alignment: 'none' });
    const parsed = parseTable(formatted);
    expect(parsed!.alignments).toEqual(['left', 'right', 'center', null]);
  });

  it('escapes | in cell content to \\|', () => {
    const out = formatTable({
      headers: ['H'],
      rows: [['a|b']],
    });
    expect(out).toContain('a\\|b');
  });

  it('strips newlines in cell content to spaces', () => {
    const out = formatTable({
      headers: ['H'],
      rows: [['a\nb']],
    });
    expect(out).toContain('a b');
    expect(out).not.toContain('\n\n');
  });

  it('handles an empty data rows array', () => {
    const out = formatTable({ headers: ['A', 'B'], rows: [] });
    expect(out.split('\n')).toHaveLength(2); // header + separator only
  });

  it('accounts for CJK width when padding columns', () => {
    // '中文' has displayWidth 4; 'AB' has displayWidth 2.
    // All cells in the column must have the same DISPLAY width (not JS string length).
    const out = formatTable({
      headers: ['Col'],
      rows: [['中文'], ['AB']],
    });
    const lines = out.split('\n');
    // Each line wraps cells in | ... |. Strip the surrounding pipes and measure
    // display width of the interior — it must be the same for every row.
    const innerWidths = lines.map((l) => displayWidth(l.replace(/^\||\|$/g, '')));
    expect(new Set(innerWidths).size).toBe(1);
  });

  it('compact mode: cells have no padding spaces', () => {
    const out = formatTable(
      { headers: ['Name', 'Age'], rows: [['Alice', '30']] },
      { compact: true },
    );
    // Compact: |Name|Age|
    expect(out.split('\n')[0]).toBe('|Name|Age|');
    expect(out.split('\n')[2]).toBe('|Alice|30|');
  });

  it('compact mode: separator keeps alignment markers', () => {
    const out = formatTable(
      { headers: ['L', 'R', 'C', 'N'], alignments: ['left', 'right', 'center', null], rows: [] },
      { compact: true },
    );
    expect(out.split('\n')[1]).toBe('|:---|---:|:---:|---|');
  });

  it('compact mode produces shorter output than default mode', () => {
    const table = { headers: ['Name', 'Score'], rows: [['Alice', '100']] };
    const compact = formatTable(table, { compact: true });
    const normal = formatTable(table);
    expect(compact.length).toBeLessThan(normal.length);
  });

  it('returns empty string for a table with zero columns', () => {
    expect(formatTable({ headers: [], rows: [] })).toBe('');
  });

  it('auto right-aligns numeric column but leaves empty-string cells as numeric', () => {
    // Empty cells are considered "numeric" so column is still right-aligned
    const out = formatTable({
      headers: ['Val'],
      rows: [['42'], [''], ['7']],
    });
    expect(out.split('\n')[1]).toMatch(/---:\|/);
  });

  it('does not auto right-align when rows array is empty', () => {
    const out = formatTable({ headers: ['N'], rows: [] });
    // No rows → cannot infer numeric; alignment stays null → left
    expect(out.split('\n')[1]).not.toMatch(/---:/);
  });
});

// ─── renderObjects ────────────────────────────────────────────────────────────

describe('renderObjects', () => {
  const data = [
    { name: 'Alice', age: 30, city: 'NYC' },
    { name: 'Bob', age: 25, city: 'LA' },
  ];

  it('auto-extracts keys from the first object as columns', () => {
    const out = renderObjects(data);
    expect(out).toContain('name');
    expect(out).toContain('age');
    expect(out).toContain('city');
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
  });

  it('respects explicit columns to render a subset', () => {
    const out = renderObjects(data, { columns: ['name', 'city'] });
    expect(out).toContain('name');
    expect(out).toContain('city');
    expect(out).not.toContain('age');
  });

  it('uses custom headers when provided', () => {
    const out = renderObjects(data, { columns: ['name', 'age'], headers: ['Person', 'Years'] });
    expect(out).toContain('Person');
    expect(out).toContain('Years');
    expect(out).not.toContain('| name |');
  });

  it('passes explicit alignments through to formatTable', () => {
    const out = renderObjects(data, { columns: ['name', 'age'], alignments: [null, 'right'] });
    expect(out.split('\n')[1]).toMatch(/---:\|/);
  });

  it('auto right-aligns numeric column (age is all numbers)', () => {
    const out = renderObjects(data, { columns: ['age'] });
    expect(out.split('\n')[1]).toMatch(/---:\|/);
  });

  it('returns empty string for empty input with no columns', () => {
    const out = renderObjects([]);
    expect(out).toBe('');
  });

  it('handles missing keys as empty string', () => {
    const rows = [{ a: 'x' }, { a: 'y' }] as Record<string, unknown>[];
    const out = renderObjects(rows, { columns: ['a', 'b'] });
    // 'b' is missing from both objects → empty cells
    const parsed = parseTable(out);
    expect(parsed!.rows[0]![1]).toBe('');
  });
});

// ─── extractTables ────────────────────────────────────────────────────────────

describe('extractTables', () => {
  it('returns an empty array when there are no tables', () => {
    expect(extractTables('Just some text.\n\nNo tables here.')).toHaveLength(0);
  });

  it('finds a single table', () => {
    const md = `| A | B |\n| --- | --- |\n| 1 | 2 |`;
    const found = extractTables(md);
    expect(found).toHaveLength(1);
    expect(found[0]!.table.headers).toEqual(['A', 'B']);
  });

  it('finds two tables in a document separated by blank lines', () => {
    const md = [
      '# Section 1',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      'Some prose here.',
      '',
      '| X | Y | Z |',
      '| --- | --- | --- |',
      '| a | b | c |',
    ].join('\n');

    const found = extractTables(md);
    expect(found).toHaveLength(2);
    expect(found[0]!.table.headers).toEqual(['A', 'B']);
    expect(found[1]!.table.headers).toEqual(['X', 'Y', 'Z']);
  });

  it('returns correct byte offsets for an ASCII-only doc', () => {
    // Offsets are deterministic for ASCII because each char = 1 byte.
    const prefix = '# Title\n\n';
    const tableStr = '| A |\n| --- |\n| 1 |';
    const md = prefix + tableStr;

    const found = extractTables(md);
    expect(found).toHaveLength(1);

    const startByte = found[0]!.start;
    const endByte = found[0]!.end;

    // start should be at the beginning of "| A |"
    expect(startByte).toBe(Buffer.byteLength(prefix, 'utf8'));
    // end should be at the last byte of "| 1 |"
    expect(endByte).toBe(startByte + Buffer.byteLength(tableStr, 'utf8'));
  });

  it('byte offset start/end span only the table rows (not surrounding prose)', () => {
    const md = 'Before\n| H |\n| --- |\n| d |\nAfter';
    const found = extractTables(md);
    expect(found).toHaveLength(1);
    const { start, end } = found[0]!;
    const tableSlice = Buffer.from(md, 'utf8').slice(start, end).toString('utf8');
    expect(tableSlice).toContain('| H |');
    expect(tableSlice).not.toContain('Before');
    expect(tableSlice).not.toContain('After');
  });

  it('parses a table with no data rows via extractTables', () => {
    const md = '| A | B |\n| --- | --- |';
    const found = extractTables(md);
    expect(found).toHaveLength(1);
    expect(found[0]!.table.rows).toHaveLength(0);
  });

  it('preserves alignment info in extracted tables', () => {
    const md = '| L | R |\n| :--- | ---: |\n| x | 1 |';
    const found = extractTables(md);
    expect(found[0]!.table.alignments).toEqual(['left', 'right']);
  });
});

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe('round-trip: parseTable ∘ formatTable', () => {
  it('recovers headers and alignments after format+parse cycle', () => {
    const original: ParsedTable = {
      headers: ['Name', 'Score', 'Note'],
      alignments: ['left', 'right', null],
      rows: [['Alice', '100', 'top'], ['Bob', '42', '']],
    };
    const formatted = formatTable(original, { alignment: 'none' });
    const parsed = parseTable(formatted);
    expect(parsed!.headers).toEqual(original.headers);
    expect(parsed!.alignments).toEqual(original.alignments);
    expect(parsed!.rows[0]).toEqual(original.rows[0]);
    expect(parsed!.rows[1]).toEqual(original.rows[1]);
  });

  it('round-trips cell content containing a pipe character', () => {
    const original: ParsedTable = {
      headers: ['Formula'],
      alignments: [null],
      rows: [['a|b'], ['c|d|e']],
    };
    const formatted = formatTable(original, { alignment: 'none' });
    const parsed = parseTable(formatted);
    expect(parsed!.rows[0]![0]).toBe('a|b');
    expect(parsed!.rows[1]![0]).toBe('c|d|e');
  });
});
