/**
 * text-diff: Pure-JS line-based + word-based diff utility for Pyrfor verify pipelines.
 *
 * Exports:
 *   diffWords    — word-level diff (whitespace-tokenised)
 *   diffChars    — character-level diff
 *   diffLines    — line-level diff with 1-based line numbers
 *   unifiedDiff  — standard unified-diff format (patch-compatible output)
 *   similarity   — 0..1 overlap ratio (2×matched / (|a|+|b|))
 *   applyPatch   — apply a unified diff; returns null on conflict
 *
 * Algorithm: Myers O(ND) diff — "An O(ND) Difference Algorithm and Its
 * Variations", Eugene W. Myers, Algorithmica 1(2), 1986.
 *
 * No external dependencies. Pure functions throughout.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type DiffOp = { kind: 'equal' | 'insert' | 'delete'; value: string };

export type LineDiffEntry = {
  kind: 'equal' | 'insert' | 'delete';
  line: string;
  oldLineNo?: number;
  newLineNo?: number;
};

export type UnifiedDiffOpts = {
  fromFile?: string;
  toFile?: string;
  context?: number;
};

// ─── Internal: Myers O(ND) core ───────────────────────────────────────────────

/**
 * A contiguous region produced by the edit script.
 *   'equal'  → a[aStart..aEnd) === b[bStart..bEnd) (lengths match)
 *   'delete' → remove a[aStart..aEnd); bStart === bEnd
 *   'insert' → add   b[bStart..bEnd); aStart === aEnd
 */
interface RawOp {
  kind: 'equal' | 'insert' | 'delete';
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/**
 * Myers O(ND) shortest-edit-script between two token arrays.
 *
 * The edit graph has N+M+1 diagonals k = x − y.  V[k + offset] stores
 * the furthest x-coordinate reachable on diagonal k using exactly d edits.
 * We iterate d = 0, 1, … and on each step extend every valid diagonal by
 * one insert (y++) or delete (x++) followed by as many free "snake" moves
 * (x++, y++ while a[x] === b[y]) as possible.
 *
 * A snapshot of V is captured *before* each d-step so that backtracking can
 * replay the same insert-vs-delete choice that was made in the forward pass.
 */
function myersCore(a: string[], b: string[]): RawOp[] {
  const N = a.length;
  const M = b.length;

  // Trivial cases
  if (N === 0 && M === 0) return [];
  if (N === 0) return [{ kind: 'insert', aStart: 0, aEnd: 0, bStart: 0, bEnd: M }];
  if (M === 0) return [{ kind: 'delete', aStart: 0, aEnd: N, bStart: 0, bEnd: 0 }];

  const MAX = N + M;
  const offset = MAX; // shift so negative diagonal indices stay positive

  // V[k + offset] = furthest x on diagonal k with current edit budget
  const V = new Int32Array(2 * MAX + 1);

  // trace[d] = snapshot of V taken *before* the d-th forward step.
  // During backtracking, trace[d] gives the exact V values that were read
  // when the forward pass made its insert-vs-delete decision at step d.
  const trace: Int32Array[] = [];

  outer: for (let d = 0; d <= MAX; d++) {
    trace.push(Int32Array.from(V)); // snapshot before any changes at step d

    for (let k = -d; k <= d; k += 2) {
      let x: number;

      // Select predecessor diagonal:
      //   k === -d  → only reachable via insert  (from diagonal k+1, y++)
      //   k ===  d  → only reachable via delete  (from diagonal k-1, x++)
      //   otherwise → pick whichever reached further
      if (k === -d || (k !== d && V[k - 1 + offset] < V[k + 1 + offset])) {
        x = V[k + 1 + offset]; // insert: borrow x from k+1, y increases by 1
      } else {
        x = V[k - 1 + offset] + 1; // delete: advance x from k-1
      }

      let y = x - k;

      // Extend the "snake": consume equal elements for free
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }

      V[k + offset] = x;

      if (x >= N && y >= M) break outer; // reached bottom-right corner
    }
  }

  return _backtrack(a, b, trace, offset);
}

/**
 * Reconstruct the edit script by walking backwards through the Myers trace.
 *
 * At depth d we replay the same predecessor-selection logic used during the
 * forward pass (using trace[d], the V snapshot from before step d).  This
 * tells us whether the step was an insert or delete, and where the preceding
 * "snake" (equal region) begins.
 */
function _backtrack(
  a: string[],
  b: string[],
  trace: Int32Array[],
  offset: number,
): RawOp[] {
  const ops: RawOp[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = trace.length - 1; d > 0 && (x > 0 || y > 0); d--) {
    // trace[d] = V before step d — the values actually read by the forward pass
    const V = trace[d];
    const k = x - y;

    // Replay forward selection: same condition as in myersCore
    let prevK: number;
    if (k === -d || (k !== d && V[k - 1 + offset] < V[k + 1 + offset])) {
      prevK = k + 1; // step was an insert (came from diagonal k+1)
    } else {
      prevK = k - 1; // step was a delete (came from diagonal k-1)
    }

    const prevX = V[prevK + offset];
    const prevY = prevX - prevK;

    // After the single edit we landed at (snakeX, snakeY) and snaked to (x, y)
    //   insert: edit moves (prevX, prevY) → (prevX, prevY+1), then snake
    //   delete: edit moves (prevX, prevY) → (prevX+1, prevY), then snake
    const snakeX = prevK === k + 1 ? prevX : prevX + 1;
    const snakeY = prevK === k + 1 ? prevY + 1 : prevY;

    if (x > snakeX) {
      ops.push({ kind: 'equal', aStart: snakeX, aEnd: x, bStart: snakeY, bEnd: y });
    }

    if (prevK === k + 1) {
      // Insert b[prevY]
      ops.push({ kind: 'insert', aStart: prevX, aEnd: prevX, bStart: prevY, bEnd: prevY + 1 });
    } else {
      // Delete a[prevX]
      ops.push({ kind: 'delete', aStart: prevX, aEnd: prevX + 1, bStart: prevY, bEnd: prevY });
    }

    x = prevX;
    y = prevY;
  }

  // Any remaining position is a leading equal region (the snake from (0,0))
  if (x > 0) {
    ops.push({ kind: 'equal', aStart: 0, aEnd: x, bStart: 0, bEnd: y });
  }

  ops.reverse(); // built in reverse; restore forward order
  return ops;
}

// ─── Token helpers ────────────────────────────────────────────────────────────

/**
 * Tokenise a string into alternating runs of non-whitespace and whitespace.
 * Concatenating all tokens exactly reconstructs the original string.
 */
function tokenizeWords(s: string): string[] {
  return s.match(/\S+|\s+/g) ?? [];
}

/**
 * Convert raw ops to DiffOp[], merging consecutive ops of the same kind so
 * the caller sees one logical op per contiguous changed region.
 * For 'insert' ops the value is drawn from b; for 'delete'/'equal' from a.
 */
function rawToDiffOps(rawOps: RawOp[], a: string[], b: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  for (const raw of rawOps) {
    const value =
      raw.kind === 'insert'
        ? b.slice(raw.bStart, raw.bEnd).join('')
        : a.slice(raw.aStart, raw.aEnd).join('');

    const prev = ops[ops.length - 1];
    if (prev && prev.kind === raw.kind) {
      prev.value += value; // merge into adjacent same-kind op
    } else {
      ops.push({ kind: raw.kind, value });
    }
  }
  return ops;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Word-level diff.
 *
 * Tokenises on whitespace boundaries (preserving spaces as tokens) so that
 * joining all op values reconstructs the original strings exactly.
 */
export function diffWords(a: string, b: string): DiffOp[] {
  const aT = tokenizeWords(a);
  const bT = tokenizeWords(b);
  if (aT.length === 0 && bT.length === 0) {
    return [{ kind: 'equal', value: a }];
  }
  return rawToDiffOps(myersCore(aT, bT), aT, bT);
}

/**
 * Character-level diff.  Each character is treated as an individual token.
 */
export function diffChars(a: string, b: string): DiffOp[] {
  if (a === '' && b === '') return [{ kind: 'equal', value: '' }];
  const aC = a.split('');
  const bC = b.split('');
  return rawToDiffOps(myersCore(aC, bC), aC, bC);
}

/**
 * Line-level diff with 1-based line numbers.
 *
 *   oldLineNo is present for 'equal' and 'delete' entries.
 *   newLineNo is present for 'equal' and 'insert' entries.
 */
export function diffLines(a: string, b: string): LineDiffEntry[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const rawOps = myersCore(aLines, bLines);

  const result: LineDiffEntry[] = [];
  let oldNo = 1;
  let newNo = 1;

  for (const op of rawOps) {
    if (op.kind === 'equal') {
      for (let i = 0; i < op.aEnd - op.aStart; i++) {
        result.push({
          kind: 'equal',
          line: aLines[op.aStart + i],
          oldLineNo: oldNo++,
          newLineNo: newNo++,
        });
      }
    } else if (op.kind === 'delete') {
      for (let i = 0; i < op.aEnd - op.aStart; i++) {
        result.push({ kind: 'delete', line: aLines[op.aStart + i], oldLineNo: oldNo++ });
      }
    } else {
      for (let i = 0; i < op.bEnd - op.bStart; i++) {
        result.push({ kind: 'insert', line: bLines[op.bStart + i], newLineNo: newNo++ });
      }
    }
  }

  return result;
}

/**
 * Standard unified-diff output (compatible with `patch`).
 *
 * Returns '' when a === b.  Default context window is 3 lines.
 * Headers use `fromFile` / `toFile` option values (default 'a' / 'b').
 *
 * Hunk format:  @@ -oldStart,oldCount +newStart,newCount @@
 */
export function unifiedDiff(a: string, b: string, opts?: UnifiedDiffOpts): string {
  if (a === b) return '';

  const fromFile = opts?.fromFile ?? 'a';
  const toFile = opts?.toFile ?? 'b';
  const ctx = opts?.context ?? 3;

  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const rawOps = myersCore(aLines, bLines);

  // ── Flatten ops to a per-entry list ─────────────────────────────────────────
  interface Entry {
    kind: 'equal' | 'insert' | 'delete';
    aIdx: number; // index into aLines; -1 for pure inserts
    bIdx: number; // index into bLines; -1 for pure deletes
  }

  const entries: Entry[] = [];
  for (const op of rawOps) {
    if (op.kind === 'equal') {
      for (let i = 0; i < op.aEnd - op.aStart; i++) {
        entries.push({ kind: 'equal', aIdx: op.aStart + i, bIdx: op.bStart + i });
      }
    } else if (op.kind === 'delete') {
      for (let i = 0; i < op.aEnd - op.aStart; i++) {
        entries.push({ kind: 'delete', aIdx: op.aStart + i, bIdx: -1 });
      }
    } else {
      for (let i = 0; i < op.bEnd - op.bStart; i++) {
        entries.push({ kind: 'insert', aIdx: -1, bIdx: op.bStart + i });
      }
    }
  }

  // ── Mark entries that fall within `ctx` lines of a change ───────────────────
  const inHunk = new Uint8Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].kind !== 'equal') {
      const lo = Math.max(0, i - ctx);
      const hi = Math.min(entries.length - 1, i + ctx);
      for (let j = lo; j <= hi; j++) inHunk[j] = 1;
    }
  }

  // ── Collect contiguous hunk ranges ──────────────────────────────────────────
  const hunkRanges: Array<{ start: number; end: number }> = [];
  let hunkStart = -1;
  for (let i = 0; i <= entries.length; i++) {
    if (i < entries.length && inHunk[i]) {
      if (hunkStart === -1) hunkStart = i;
    } else if (hunkStart !== -1) {
      hunkRanges.push({ start: hunkStart, end: i - 1 });
      hunkStart = -1;
    }
  }

  if (hunkRanges.length === 0) return '';

  // ── Format output ────────────────────────────────────────────────────────────
  let out = `--- ${fromFile}\n+++ ${toFile}\n`;

  for (const { start, end } of hunkRanges) {
    const slice = entries.slice(start, end + 1);

    let oldStart = -1;
    let newStart = -1;
    let oldCount = 0;
    let newCount = 0;

    for (const e of slice) {
      if (e.aIdx !== -1) {
        if (oldStart === -1) oldStart = e.aIdx;
        oldCount++;
      }
      if (e.bIdx !== -1) {
        if (newStart === -1) newStart = e.bIdx;
        newCount++;
      }
    }

    // Unified diff spec: when count is 0 the start is the line *before* the
    // edit (or 0 when inserting at the very beginning of the file).
    const oldS = oldCount === 0 ? (oldStart === -1 ? 0 : oldStart) : oldStart + 1;
    const newS = newCount === 0 ? (newStart === -1 ? 0 : newStart) : newStart + 1;

    out += `@@ -${oldS},${oldCount} +${newS},${newCount} @@\n`;

    for (const e of slice) {
      if (e.kind === 'equal') out += ` ${aLines[e.aIdx]}\n`;
      else if (e.kind === 'delete') out += `-${aLines[e.aIdx]}\n`;
      else out += `+${bLines[e.bIdx]}\n`;
    }
  }

  return out;
}

/**
 * Similarity ratio: 2 × (matched characters) / (|a| + |b|).
 *
 * Returns 1.0 for identical strings, 0.0 when there is no overlap,
 * and values in between otherwise.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const total = a.length + b.length;
  if (total === 0) return 1.0;
  const ops = diffChars(a, b);
  const matched = ops
    .filter(op => op.kind === 'equal')
    .reduce((acc, op) => acc + op.value.length, 0);
  return (2 * matched) / total;
}

/**
 * Apply a unified diff produced by `unifiedDiff` (or compatible tools).
 *
 * Works line-by-line; each context and delete line is verified against the
 * original.  Returns `null` if any line fails to match (patch conflict).
 */
export function applyPatch(original: string, patch: string): string | null {
  if (!patch.trim()) return original;

  const origLines = original.split('\n');
  const patchLines = patch.split('\n');
  const result: string[] = [];
  let origIdx = 0;
  let i = 0;

  // Skip file-header lines (--- / +++)
  while (i < patchLines.length && !patchLines[i].startsWith('@@')) i++;

  while (i < patchLines.length) {
    const header = patchLines[i];
    if (!header.startsWith('@@')) { i++; continue; }

    // Parse "@@ -oldStart[,oldCount] +newStart[,newCount] @@"
    const m = header.match(/@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (!m) { i++; continue; }

    const oldStart = parseInt(m[1], 10) - 1; // convert to 0-based

    // Copy original lines that precede this hunk
    while (origIdx < oldStart) result.push(origLines[origIdx++]);

    i++; // advance past hunk header

    while (i < patchLines.length && !patchLines[i].startsWith('@@')) {
      const pl = patchLines[i];

      if (pl.startsWith(' ')) {
        // Context line: must match the original
        const expected = pl.slice(1);
        if (origIdx >= origLines.length || origLines[origIdx] !== expected) return null;
        result.push(origLines[origIdx++]);
      } else if (pl.startsWith('-')) {
        // Delete line: must match the original
        const expected = pl.slice(1);
        if (origIdx >= origLines.length || origLines[origIdx] !== expected) return null;
        origIdx++;
      } else if (pl.startsWith('+')) {
        // Insert line: add to result
        result.push(pl.slice(1));
      }
      // Ignore "\ No newline at end of file" and empty trailing patch lines
      i++;
    }
  }

  // Append any remaining original lines after the last hunk
  while (origIdx < origLines.length) result.push(origLines[origIdx++]);

  return result.join('\n');
}
