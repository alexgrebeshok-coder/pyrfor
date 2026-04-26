/**
 * Diff View — pure Node module for line-level diff computation and HTML rendering.
 * No vscode imports. No external dependencies.
 * Algorithm: Myers O((N+D)*D) diff for computeDiff; classic LCS DP for lcsLines.
 *
 * Identical inputs → 0 hunks (documented choice: no visible changes = no hunks).
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DiffInput {
  oldText: string;
  newText: string;
  filename?: string;
  language?: string;
}

export type DiffOpKind = 'equal' | 'add' | 'remove' | 'replace';

export interface DiffHunk {
  /** 1-based line number in the old file where this hunk starts. */
  oldStart: number;
  oldLines: number;
  /** 1-based line number in the new file where this hunk starts. */
  newStart: number;
  newLines: number;
  ops: Array<{ kind: DiffOpKind; oldLine?: string; newLine?: string }>;
}

export interface DiffResult {
  filename?: string;
  language?: string;
  hunks: DiffHunk[];
  stats: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** HTML-escape a string for safe embedding in HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Split text into lines.
 * Normalises CRLF → LF, trims a single trailing newline, returns [] for empty input.
 */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trimmed = normalised.endsWith('\n') ? normalised.slice(0, -1) : normalised;
  if (trimmed === '') return [];
  return trimmed.split('\n');
}

/**
 * Compute the Longest Common Subsequence of two line arrays using classic O(N*M) DP.
 * Returns (i, j) pairs of equal-line indices in order.
 * Suitable for small inputs (test cases); computeDiff uses Myers for performance.
 */
export function lcsLines(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return pairs.reverse();
}

// ─── Myers diff (internal) ────────────────────────────────────────────────────

type RawOp =
  | { kind: 'equal'; ai: number; bi: number }
  | { kind: 'delete'; ai: number }
  | { kind: 'insert'; bi: number };

/**
 * Myers O((N+D)*D) shortest-edit-script algorithm.
 * Returns raw edit operations in forward order.
 */
function myersDiff(a: string[], b: string[]): RawOp[] {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((_, bi) => ({ kind: 'insert' as const, bi }));
  if (m === 0) return a.map((_, ai) => ({ kind: 'delete' as const, ai }));

  const max = n + m;
  const offset = max;
  // v[k + offset] = furthest x-coordinate reached along diagonal k
  const v = new Int32Array(2 * max + 2);
  // v[offset + 1] is already 0 (Int32Array default), consistent with Myers init

  const trace: Int32Array[] = [];
  let found = false;

  outer: for (let d = 0; d <= max; d++) {
    // Snapshot v BEFORE processing d-step paths (used in backtrack)
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const ki = k + offset;
      let x: number;
      // Choose: come from k+1 (insert/down) or k-1 (delete/right)
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        x = v[ki + 1]; // insert: move down in edit graph
      } else {
        x = v[ki - 1] + 1; // delete: move right in edit graph
      }
      let y = x - k;
      // Extend snake (equal lines)
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[ki] = x;
      if (x >= n && y >= m) {
        found = true;
        break outer;
      }
    }
  }

  if (!found) return []; // unreachable for valid n, m > 0

  // Backtrack through trace to reconstruct operations
  const ops: RawOp[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d];
    const k = x - y;
    const ki = k + offset;

    // Mirror the forward decision to find which diagonal we came from
    const prevK =
      k === -d || (k !== d && vd[ki - 1] < vd[ki + 1])
        ? k + 1  // came via insert (down)
        : k - 1; // came via delete (right)

    const prevX = vd[prevK + offset];
    const prevY = prevX - prevK;

    // Unwind snake (equal lines run from (prevX, prevY) diagonally to snake end)
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'equal', ai: x - 1, bi: y - 1 });
      x--;
      y--;
    }

    // The single edit that preceded the snake (not present at d=0)
    if (d > 0) {
      if (x > prevX) {
        ops.push({ kind: 'delete', ai: x - 1 });
        x--;
      } else if (y > prevY) {
        ops.push({ kind: 'insert', bi: y - 1 });
        y--;
      }
    }
  }

  return ops.reverse();
}

// ─── computeDiff ──────────────────────────────────────────────────────────────

/**
 * Compute a structured diff between two texts.
 *
 * @param input     - old/new text plus optional filename/language metadata.
 * @param opts.contextLines - unchanged lines to include around each change (default 3).
 *
 * Identical inputs produce **0 hunks** — no visible differences, no output.
 * Adjacent delete+insert pairs are promoted to a single 'replace' op.
 */
export function computeDiff(
  input: DiffInput,
  opts?: { contextLines?: number }
): DiffResult {
  const ctx = opts?.contextLines ?? 3;
  const oldArr = splitLines(input.oldText);
  const newArr = splitLines(input.newText);
  const rawOps = myersDiff(oldArr, newArr);

  type FlatOp = { kind: 'equal' | 'delete' | 'insert'; oi: number; ni: number };
  const flat: FlatOp[] = rawOps.map(op => {
    if (op.kind === 'equal') return { kind: 'equal' as const, oi: op.ai, ni: op.bi };
    if (op.kind === 'delete') return { kind: 'delete' as const, oi: op.ai, ni: -1 };
    return { kind: 'insert' as const, oi: -1, ni: op.bi };
  });

  // Count all equal (unchanged) lines across the entire file
  const totalUnchanged = flat.filter(op => op.kind === 'equal').length;

  const hasChanges = flat.some(op => op.kind !== 'equal');
  if (!hasChanges) {
    return {
      filename: input.filename,
      language: input.language,
      hunks: [],
      stats: { added: 0, removed: 0, modified: 0, unchanged: totalUnchanged },
    };
  }

  // Mark indices of changed ops, then expand each by ±ctx
  const included = new Set<number>();
  for (let i = 0; i < flat.length; i++) {
    if (flat[i].kind !== 'equal') {
      for (let j = Math.max(0, i - ctx); j <= Math.min(flat.length - 1, i + ctx); j++) {
        included.add(j);
      }
    }
  }

  // Split included indices into contiguous groups (each group → one hunk)
  const sortedIdx = [...included].sort((a, b) => a - b);
  const groups: number[][] = [];
  let cur: number[] = [];
  for (const idx of sortedIdx) {
    if (cur.length === 0 || idx === cur[cur.length - 1] + 1) {
      cur.push(idx);
    } else {
      groups.push(cur);
      cur = [idx];
    }
  }
  if (cur.length > 0) groups.push(cur);

  let totalAdded = 0;
  let totalRemoved = 0;
  let totalModified = 0;
  const hunks: DiffHunk[] = [];

  for (const group of groups) {
    const groupOps = group.map(i => flat[i]);

    // Find 1-based old/new start positions from the first contributing line
    let minOi = Infinity;
    let minNi = Infinity;
    for (const op of groupOps) {
      if (op.oi >= 0 && op.oi < minOi) minOi = op.oi;
      if (op.ni >= 0 && op.ni < minNi) minNi = op.ni;
    }
    const oldStart = minOi === Infinity ? 1 : minOi + 1;
    const newStart = minNi === Infinity ? 1 : minNi + 1;

    // Build DiffOps; promote adjacent delete+insert → replace
    const diffOps: Array<{ kind: DiffOpKind; oldLine?: string; newLine?: string }> = [];
    let gi = 0;
    while (gi < groupOps.length) {
      const op = groupOps[gi];
      if (op.kind === 'delete' &&
          gi + 1 < groupOps.length &&
          groupOps[gi + 1].kind === 'insert') {
        diffOps.push({
          kind: 'replace',
          oldLine: oldArr[op.oi],
          newLine: newArr[groupOps[gi + 1].ni],
        });
        totalModified++;
        gi += 2;
      } else if (op.kind === 'delete') {
        diffOps.push({ kind: 'remove', oldLine: oldArr[op.oi] });
        totalRemoved++;
        gi++;
      } else if (op.kind === 'insert') {
        diffOps.push({ kind: 'add', newLine: newArr[op.ni] });
        totalAdded++;
        gi++;
      } else {
        // equal
        diffOps.push({ kind: 'equal', oldLine: oldArr[op.oi], newLine: newArr[op.ni] });
        gi++;
      }
    }

    // Count lines contributed to old/new sides
    let oldLines = 0;
    let newLines = 0;
    for (const op of diffOps) {
      if (op.kind === 'equal')   { oldLines++; newLines++; }
      else if (op.kind === 'remove')  { oldLines++; }
      else if (op.kind === 'add')     { newLines++; }
      else /* replace */              { oldLines++; newLines++; }
    }

    hunks.push({ oldStart, oldLines, newStart, newLines, ops: diffOps });
  }

  return {
    filename: input.filename,
    language: input.language,
    hunks,
    stats: {
      added: totalAdded,
      removed: totalRemoved,
      modified: totalModified,
      unchanged: totalUnchanged,
    },
  };
}

// ─── unifiedDiff ──────────────────────────────────────────────────────────────

/** Produce a 'diff --git'-style unified text from a DiffResult. */
export function unifiedDiff(d: DiffResult): string {
  const lines: string[] = [];
  const fname = d.filename ?? 'file';

  lines.push(`diff --git a/${fname} b/${fname}`);
  lines.push(`--- a/${fname}`);
  lines.push(`+++ b/${fname}`);

  for (const hunk of d.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const op of hunk.ops) {
      if (op.kind === 'equal') {
        lines.push(` ${op.oldLine ?? ''}`);
      } else if (op.kind === 'remove') {
        lines.push(`-${op.oldLine ?? ''}`);
      } else if (op.kind === 'add') {
        lines.push(`+${op.newLine ?? ''}`);
      } else {
        // replace: emit remove then add
        lines.push(`-${op.oldLine ?? ''}`);
        lines.push(`+${op.newLine ?? ''}`);
      }
    }
  }

  return lines.join('\n');
}

// ─── patchFromDiff ────────────────────────────────────────────────────────────

/**
 * Produce a standard unified patch (compatible with the `patch` command).
 * Includes --- / +++ headers and @@ hunk headers with +/- / (space) line prefixes.
 */
export function patchFromDiff(d: DiffResult): string {
  const lines: string[] = [];
  const fname = d.filename ?? 'file';

  lines.push(`--- a/${fname}`);
  lines.push(`+++ b/${fname}`);

  for (const hunk of d.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const op of hunk.ops) {
      if (op.kind === 'equal') {
        lines.push(` ${op.oldLine ?? ''}`);
      } else if (op.kind === 'remove') {
        lines.push(`-${op.oldLine ?? ''}`);
      } else if (op.kind === 'add') {
        lines.push(`+${op.newLine ?? ''}`);
      } else {
        lines.push(`-${op.oldLine ?? ''}`);
        lines.push(`+${op.newLine ?? ''}`);
      }
    }
  }

  return lines.join('\n');
}

// ─── renderHtml ───────────────────────────────────────────────────────────────

/**
 * Render a DiffResult as a side-by-side HTML table.
 *
 * - Two-column layout: old on left, new on right, each with line numbers.
 * - Row classes: 'equal', 'add', 'remove', 'replace' for CSS targeting.
 * - Inline <style> block; nonce applied to <style> tag for strict CSP.
 * - No inline scripts.
 * - data-theme="light"|"dark" on the root table.
 */
export function renderHtml(
  d: DiffResult,
  opts?: { theme?: 'light' | 'dark'; nonce?: string }
): string {
  const theme = opts?.theme ?? 'light';
  const nonce = opts?.nonce ?? '';
  const nonceAttr = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';

  const css = `
.diff-view-wrapper { font-family: monospace; font-size: 13px; }
.diff-filename { padding: 4px 8px; font-weight: bold; border-bottom: 1px solid #ccc; }
.diff-view { border-collapse: collapse; width: 100%; table-layout: fixed; }
.diff-view[data-theme="light"] { background: #fff; color: #24292e; }
.diff-view[data-theme="dark"]  { background: #1e1e1e; color: #d4d4d4; }
.diff-view td { padding: 1px 8px; white-space: pre; overflow: hidden; text-overflow: ellipsis; vertical-align: top; }
.diff-view .ln { user-select: none; opacity: 0.45; min-width: 3em; text-align: right; padding-right: 10px; width: 3em; }
.diff-view .hunk-info { opacity: 0.6; font-style: italic; padding: 2px 8px; }
.diff-view[data-theme="light"] tr.add    .code-new { background: #e6ffed; }
.diff-view[data-theme="light"] tr.remove .code-old { background: #ffeef0; }
.diff-view[data-theme="light"] tr.replace .code-old { background: #ffeef0; }
.diff-view[data-theme="light"] tr.replace .code-new { background: #e6ffed; }
.diff-view[data-theme="dark"]  tr.add    .code-new { background: #1a3a1a; }
.diff-view[data-theme="dark"]  tr.remove .code-old { background: #3a1a1a; }
.diff-view[data-theme="dark"]  tr.replace .code-old { background: #3a1a1a; }
.diff-view[data-theme="dark"]  tr.replace .code-new { background: #1a3a1a; }
`.trim();

  const rows: string[] = [];

  for (const hunk of d.hunks) {
    rows.push(
      `<tr class="hunk-header">` +
      `<td colspan="4" class="hunk-info">` +
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` +
      `</td></tr>`
    );

    let oldLn = hunk.oldStart;
    let newLn = hunk.newStart;

    for (const op of hunk.ops) {
      const esc = (s: string | undefined) => escapeHtml(s ?? '');

      if (op.kind === 'equal') {
        rows.push(
          `<tr class="equal">` +
          `<td class="ln">${oldLn++}</td><td class="code-old">${esc(op.oldLine)}</td>` +
          `<td class="ln">${newLn++}</td><td class="code-new">${esc(op.newLine)}</td>` +
          `</tr>`
        );
      } else if (op.kind === 'remove') {
        rows.push(
          `<tr class="remove">` +
          `<td class="ln">${oldLn++}</td><td class="code-old">${esc(op.oldLine)}</td>` +
          `<td class="ln"></td><td class="code-new"></td>` +
          `</tr>`
        );
      } else if (op.kind === 'add') {
        rows.push(
          `<tr class="add">` +
          `<td class="ln"></td><td class="code-old"></td>` +
          `<td class="ln">${newLn++}</td><td class="code-new">${esc(op.newLine)}</td>` +
          `</tr>`
        );
      } else {
        // replace: side-by-side on same row
        rows.push(
          `<tr class="replace">` +
          `<td class="ln">${oldLn++}</td><td class="code-old">${esc(op.oldLine)}</td>` +
          `<td class="ln">${newLn++}</td><td class="code-new">${esc(op.newLine)}</td>` +
          `</tr>`
        );
      }
    }
  }

  const noChanges = d.hunks.length === 0
    ? `<tr><td colspan="4" style="padding:8px;opacity:0.6">No differences</td></tr>`
    : '';

  const filenameHtml = d.filename
    ? `<div class="diff-filename">${escapeHtml(d.filename)}</div>\n`
    : '';

  return [
    `<style${nonceAttr}>${css}</style>`,
    `<div class="diff-view-wrapper">`,
    filenameHtml +
    `<table class="diff-view" data-theme="${theme}">`,
    `<tbody>`,
    noChanges,
    ...rows,
    `</tbody>`,
    `</table>`,
    `</div>`,
  ].join('\n');
}
