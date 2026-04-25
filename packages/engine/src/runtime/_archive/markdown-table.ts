/**
 * markdown-table.ts — GitHub-flavored Markdown table parser + formatter.
 *
 * Exports:
 *   displayWidth   — display-column count for a string (CJK = 2, others = 1 per code point)
 *   parseTable     — parse the first GFM table found in a markdown string
 *   formatTable    — render a table as a GFM markdown string
 *   renderObjects  — render an array of objects as a GFM table
 *   extractTables  — find all tables in a markdown document with byte offsets
 *
 * Display-width notes:
 *   • CJK characters in ranges U+3000–U+303F, U+3040–U+309F, U+30A0–U+30FF,
 *     U+4E00–U+9FFF, U+FF00–U+FFEF each count as width 2.
 *   • All other characters — including emoji — are iterated as Unicode code
 *     points via the spread operator ([...str]) and each code point counts as
 *     width 1.  A multi-code-point emoji sequence (e.g. ZWJ sequences) will
 *     count as the number of its constituent code points.
 *
 * Separator validation: requires ≥ 3 dashes (stricter than the bare GFM spec).
 *
 * No external dependencies. Pure functions throughout.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type Alignment = 'left' | 'right' | 'center' | null;

export interface ParsedTable {
  headers: string[];
  alignments: Alignment[];
  rows: string[][];
}

/** Options for {@link formatTable}. */
export interface FormatOptions {
  /** Spaces added on each side of every cell's content. Default: `1`. */
  padding?: number;
  /**
   * `'auto'` infers right-alignment for columns whose every non-empty data
   * cell matches a number (integer / float / scientific notation).
   * `'none'` leaves alignments exactly as supplied.
   * Default: `'auto'`.
   */
  alignment?: 'auto' | 'none';
  /**
   * When `true`, cells are not padded to column width and the separator row
   * uses the minimum-width dash sequence (`:---`, `---:`, `:---:`, `---`).
   * Default: `false`.
   */
  compact?: boolean;
}

/** Options for {@link renderObjects}. */
export interface RenderObjectsOptions {
  /** Column keys to extract from each object. Defaults to `Object.keys(objs[0])`. */
  columns?: string[];
  /** Header labels. Defaults to `columns`. */
  headers?: string[];
  /** Explicit alignments for each column. */
  alignments?: Alignment[];
}

/** A table found by {@link extractTables}, with UTF-8 byte offsets. */
export interface TableLocation {
  /** Byte offset of the first character of the header row. */
  start: number;
  /** Byte offset of the last character of the final row (exclusive of trailing newline). */
  end: number;
  table: ParsedTable;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x3000 && cp <= 0x303f) || // CJK symbols & punctuation
    (cp >= 0x3040 && cp <= 0x309f) || // Hiragana
    (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified ideographs (common block)
    (cp >= 0xff00 && cp <= 0xffef)    // Halfwidth / fullwidth forms
  );
}

/**
 * Count the number of display columns occupied by `str`.
 * CJK characters count as 2; all other code points count as 1.
 */
export function displayWidth(str: string): number {
  let w = 0;
  for (const char of str) {
    const cp = char.codePointAt(0) ?? 0;
    w += isWideCodePoint(cp) ? 2 : 1;
  }
  return w;
}

/** Escape cell content: replace `|` with `\|` and strip newlines to spaces. */
function escapeCell(value: string): string {
  return value.replace(/\n/g, ' ').replace(/\|/g, '\\|');
}

/** Unescape `\|` back to `|` in parsed cell content. */
function unescapeCell(value: string): string {
  return value.replace(/\\\|/g, '|');
}

/**
 * Split a single table row into trimmed cell strings.
 * Escaped pipes (`\|`) are preserved as-is; only bare `|` characters act as
 * delimiters. Leading / trailing empty cells produced by leading / trailing
 * pipes are stripped.
 */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length && line[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (line[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += line[i];
    }
  }
  cells.push(cur.trim());
  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** Return `true` if `cell` is a valid GFM separator cell (≥ 3 dashes, optional colons). */
function isSepCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell.trim());
}

/** Derive column alignment from a separator cell. */
function parseAlignment(cell: string): Alignment {
  const c = cell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

/**
 * Return `true` if `line` contains at least one unescaped `|` character
 * (i.e. looks like a GFM table row).
 */
function looksLikeTableRow(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length && line[i + 1] === '|') {
      i++;
    } else if (line[i] === '|') {
      return true;
    }
  }
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse the first valid GFM table found in `md`.
 * Returns `null` if no valid table is found.
 *
 * A table is valid when:
 *   1. A header row exists.
 *   2. It is immediately followed by a separator row with the same cell count,
 *      each cell matching `^:?-{3,}:?$`.
 *   3. Any subsequent non-blank lines that contain `|` are treated as data rows.
 */
export function parseTable(md: string): ParsedTable | null {
  const lines = md.split('\n').map((l) => l.trimEnd());

  for (let i = 0; i < lines.length - 1; i++) {
    const headerCells = splitRow(lines[i]!);
    if (headerCells.length === 0) continue;

    const sepCells = splitRow(lines[i + 1]!);
    if (sepCells.length !== headerCells.length) continue;
    if (!sepCells.every(isSepCell)) continue;

    const headers = headerCells.map(unescapeCell);
    const alignments = sepCells.map(parseAlignment);

    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const line = lines[j]!;
      if (line === '') break;
      if (!looksLikeTableRow(line)) break;
      rows.push(splitRow(line).map(unescapeCell));
    }

    return { headers, alignments, rows };
  }

  return null;
}

/**
 * Render a table as a GFM Markdown string.
 *
 * Column widths are computed from `displayWidth` so CJK characters and wide
 * symbols are accounted for.  When `compact` is `true`, cells carry no padding
 * and the separator row uses minimum-length dash sequences.
 */
export function formatTable(
  table: { headers: string[]; alignments?: Alignment[]; rows: string[][] },
  opts: FormatOptions = {},
): string {
  const { padding = 1, alignment = 'auto', compact = false } = opts;
  const n = table.headers.length;
  if (n === 0) return '';

  // ── 1. Resolve alignments ─────────────────────────────────────────────────
  const baseAligns: Alignment[] = table.alignments ?? new Array<Alignment>(n).fill(null);

  const aligns: Alignment[] = baseAligns.map((a, i) => {
    if (alignment !== 'auto' || a !== null) return a;
    if (table.rows.length === 0) return null;
    const allNumeric = table.rows.every((row) => {
      const cell = (row[i] ?? '').trim();
      return cell === '' || /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cell);
    });
    return allNumeric ? 'right' : null;
  });

  // ── 2. Compact mode ───────────────────────────────────────────────────────
  if (compact) {
    const headerRow = '|' + table.headers.map(escapeCell).join('|') + '|';
    const sepRow =
      '|' +
      aligns
        .map((a) => {
          if (a === 'left') return ':---';
          if (a === 'right') return '---:';
          if (a === 'center') return ':---:';
          return '---';
        })
        .join('|') +
      '|';
    const dataRows = table.rows.map(
      (row) => '|' + table.headers.map((_, i) => escapeCell(row[i] ?? '')).join('|') + '|',
    );
    return [headerRow, sepRow, ...dataRows].join('\n');
  }

  // ── 3. Compute column widths ───────────────────────────────────────────────
  const colWidths: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let w = displayWidth(escapeCell(table.headers[i] ?? ''));
    for (const row of table.rows) {
      w = Math.max(w, displayWidth(escapeCell(row[i] ?? '')));
    }
    // Enforce minimum width so separator always has ≥ 3 dashes.
    // inner = colWidth + 2*padding; requirements per alignment:
    //   center  → inner ≥ 5  (: + ≥3 dashes + :)
    //   left/right → inner ≥ 4  (: + ≥3 dashes  or  ≥3 dashes + :)
    //   none    → inner ≥ 3  (≥3 dashes)
    const minInner =
      aligns[i] === 'center' ? 5 : aligns[i] === 'left' || aligns[i] === 'right' ? 4 : 3;
    const minW = minInner - 2 * padding;
    colWidths[i] = Math.max(w, minW > 0 ? minW : 1);
  }

  // ── 4. Cell formatter ──────────────────────────────────────────────────────
  function padCell(content: string, width: number, align: Alignment): string {
    const dw = displayWidth(content);
    const extra = Math.max(0, width - dw);
    const sp = (n: number) => ' '.repeat(n);
    const p = padding;
    if (align === 'right') {
      return sp(extra + p) + content + sp(p);
    }
    if (align === 'center') {
      const leftExtra = Math.floor(extra / 2);
      const rightExtra = extra - leftExtra;
      return sp(leftExtra + p) + content + sp(rightExtra + p);
    }
    // left or null → left-align
    return sp(p) + content + sp(extra + p);
  }

  // ── 5. Build rows ──────────────────────────────────────────────────────────
  const headerRow =
    '|' +
    table.headers.map((h, i) => padCell(escapeCell(h), colWidths[i]!, aligns[i]!)).join('|') +
    '|';

  const sepRow =
    '|' +
    aligns
      .map((a, i) => {
        const innerW = colWidths[i]! + 2 * padding;
        if (a === 'left') return ':' + '-'.repeat(innerW - 1);
        if (a === 'right') return '-'.repeat(innerW - 1) + ':';
        if (a === 'center') return ':' + '-'.repeat(innerW - 2) + ':';
        return '-'.repeat(innerW);
      })
      .join('|') +
    '|';

  const dataRows = table.rows.map(
    (row) =>
      '|' +
      table.headers.map((_, i) => padCell(escapeCell(row[i] ?? ''), colWidths[i]!, aligns[i]!)).join('|') +
      '|',
  );

  return [headerRow, sepRow, ...dataRows].join('\n');
}

/**
 * Render an array of plain objects as a GFM Markdown table.
 *
 * Column keys are taken from `opts.columns` if provided, otherwise from
 * `Object.keys(objs[0])`.  `opts.headers` overrides the displayed header
 * labels without affecting which keys are read.
 */
export function renderObjects(
  objs: Record<string, unknown>[],
  opts: RenderObjectsOptions = {},
): string {
  const columns = opts.columns ?? (objs.length > 0 ? Object.keys(objs[0]!) : []);
  const headers = opts.headers ?? columns;
  const rows = objs.map((obj) => columns.map((col) => String(obj[col] ?? '')));
  return formatTable({ headers, alignments: opts.alignments, rows });
}

/**
 * Find every GFM table in `md` and return its location (UTF-8 byte offsets)
 * together with the parsed table structure.
 *
 * `start` is the byte offset of the first character of the header row.
 * `end` is the byte offset of the last character of the final row (the
 * trailing newline, if any, is not included).
 */
export function extractTables(md: string): TableLocation[] {
  const lines = md.split('\n');
  const result: TableLocation[] = [];

  // Pre-compute byte offset of each line's first character.
  const lineByteStart: number[] = [];
  let bytePos = 0;
  for (const line of lines) {
    lineByteStart.push(bytePos);
    bytePos += Buffer.byteLength(line, 'utf8') + 1; // +1 for the \n
  }

  let i = 0;
  while (i < lines.length - 1) {
    const headerCells = splitRow(lines[i]!);
    const sepCells = splitRow(lines[i + 1]!);

    if (
      headerCells.length > 0 &&
      headerCells.length === sepCells.length &&
      sepCells.every(isSepCell)
    ) {
      // Collect data rows (non-blank lines that look like table rows).
      let j = i + 2;
      while (j < lines.length) {
        const line = lines[j]!;
        if (line.trim() === '' || !looksLikeTableRow(line)) break;
        j++;
      }

      const tableText = lines.slice(i, j).join('\n');
      const table = parseTable(tableText);

      if (table) {
        const start = lineByteStart[i]!;
        const end = lineByteStart[j - 1]! + Buffer.byteLength(lines[j - 1]!, 'utf8');
        result.push({ start, end, table });
      }

      i = j; // advance past this table
    } else {
      i++;
    }
  }

  return result;
}
