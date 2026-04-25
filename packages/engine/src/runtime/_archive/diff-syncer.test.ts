// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createDoc, diff, compact, newReplicaId, type Op } from './diff-syncer';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Deterministic monotonic clock starting at `start`. */
function makeClock(start = 1000) {
  let t = start;
  return () => t++;
}

/** Snapshot just the visible state (no metadata). */
function state(doc: ReturnType<typeof createDoc>) {
  return doc.toJSON().state;
}

/** All permutations of an array. */
function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((el, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(rest => [el, ...rest]),
  );
}

// ─── basic set / get / delete ────────────────────────────────────────────────

describe('basic set/get/delete', () => {
  it('set and get a value', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.set('name', 'Alice');
    expect(doc.get('name')).toBe('Alice');
  });

  it('get returns undefined for unknown key', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    expect(doc.get('missing')).toBeUndefined();
  });

  it('set overwrites previous value (same replica)', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.set('x', 1);
    doc.set('x', 2);
    expect(doc.get('x')).toBe(2);
  });

  it('delete makes get return undefined', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.set('x', 42);
    doc.delete('x');
    expect(doc.get('x')).toBeUndefined();
  });

  it('toJSON state excludes deleted keys', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.set('a', 1);
    doc.set('b', 2);
    doc.delete('a');
    expect(state(doc)).toEqual({ b: 2 });
  });

  it('replicaId is required — throws when empty', () => {
    expect(() => createDoc({ id: 'd1', replicaId: '' })).toThrow('replicaId is required');
  });
});

// ─── LWW resolution ──────────────────────────────────────────────────────────

describe('LWW resolution', () => {
  it('higher ts wins when two replicas write same key', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock(100) });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock(200) }); // B is later
    a.set('k', 'from-A');
    b.set('k', 'from-B');
    // merge B into A → B's op has higher ts, so B wins
    a.merge(b);
    expect(a.get('k')).toBe('from-B');
  });

  it('lower ts loses', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock(200) });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock(100) }); // B is earlier
    a.set('k', 'from-A');
    b.set('k', 'from-B');
    a.merge(b);
    expect(a.get('k')).toBe('from-A');
  });

  it('tie-break: lexicographically larger replicaId wins', () => {
    const clock = makeClock(500); // same ts for both
    const a = createDoc({ id: 'da', replicaId: 'replica-A', clock: () => clock() });
    const b = createDoc({ id: 'db', replicaId: 'replica-Z', clock: () => clock() });
    a.set('k', 'val-A');
    b.set('k', 'val-Z');

    // Create a fresh doc and merge both to see who wins
    const merged = createDoc({ id: 'dm', replicaId: 'merge-node', clock: makeClock(9999) });
    merged.merge(a.export());
    merged.merge(b.export());
    // 'replica-Z' > 'replica-A' lexicographically
    expect(merged.get('k')).toBe('val-Z');
  });

  it('tie-break: smaller replicaId loses', () => {
    const ts = 500;
    const a = createDoc({ id: 'da', replicaId: 'aaa', clock: () => ts });
    const b = createDoc({ id: 'db', replicaId: 'zzz', clock: () => ts });
    a.set('k', 'a-val');
    b.set('k', 'z-val');
    a.merge(b);
    expect(a.get('k')).toBe('z-val');
  });

  it('delete then later set wins (set has higher ts)', () => {
    const del = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock(100) });
    const set = createDoc({ id: 'd2', replicaId: 'r2', clock: makeClock(200) });
    del.delete('x');
    set.set('x', 'resurrected');
    del.merge(set);
    expect(del.get('x')).toBe('resurrected');
  });

  it('set then delete by higher ts wins (key is gone)', () => {
    const setter = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock(100) });
    const deleter = createDoc({ id: 'd2', replicaId: 'r2', clock: makeClock(200) });
    setter.set('x', 'hello');
    deleter.delete('x');
    setter.merge(deleter);
    expect(setter.get('x')).toBeUndefined();
  });
});

// ─── three-replica convergence (all 6 orderings) ────────────────────────────

describe('three-replica convergence', () => {
  /**
   * Build three docs, each writing to overlapping keys.
   * Returns their exported op-arrays. Then tests that applying the three
   * op-groups in every permutation yields identical final state.
   */
  function buildThreeReplicas() {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock(300) });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock(200) });
    const c = createDoc({ id: 'dc', replicaId: 'C', clock: makeClock(100) });
    a.set('shared', 'from-A');
    a.set('onlyA', 'a-exclusive');
    b.set('shared', 'from-B');
    b.set('onlyB', 'b-exclusive');
    c.set('shared', 'from-C');
    c.set('onlyC', 'c-exclusive');
    return [a.export(), b.export(), c.export()] as const;
  }

  const [opsA, opsB, opsC] = buildThreeReplicas();
  const groups = [opsA, opsB, opsC];

  permutations([0, 1, 2]).forEach((order, idx) => {
    it(`ordering ${idx + 1}/6: apply groups in order [${order.join(',')}]`, () => {
      const doc = createDoc({ id: 'merged', replicaId: 'M', clock: makeClock(9999) });
      for (const gi of order) doc.merge(groups[gi]);
      // A has highest ts (300), so 'shared' = 'from-A'
      expect(doc.get('shared')).toBe('from-A');
      expect(doc.get('onlyA')).toBe('a-exclusive');
      expect(doc.get('onlyB')).toBe('b-exclusive');
      expect(doc.get('onlyC')).toBe('c-exclusive');
    });
  });
});

// ─── applyOp idempotency ─────────────────────────────────────────────────────

describe('applyOp idempotency', () => {
  it('applying the same op twice leaves state unchanged', () => {
    const a = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    a.set('k', 'v');
    const [op] = a.export();
    const before = JSON.stringify(state(a));
    a.applyOp(op);
    expect(JSON.stringify(state(a))).toBe(before);
  });

  it('export length stays the same after re-applying own op', () => {
    const a = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    a.set('k', 'v');
    const lenBefore = a.export().length;
    a.applyOp(a.export()[0]);
    expect(a.export().length).toBe(lenBefore);
  });

  it('merge is idempotent: merging same doc twice = same state', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock(100) });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock(200) });
    b.set('x', 99);
    a.merge(b);
    const snap1 = JSON.stringify(state(a));
    a.merge(b); // second merge must be no-op
    expect(JSON.stringify(state(a))).toBe(snap1);
  });
});

// ─── diff ─────────────────────────────────────────────────────────────────────

describe('diff', () => {
  it('returns empty arrays when docs are identical', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock() });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock() });
    a.set('k', 1);
    b.applyOp(a.export()[0]);
    const { aOnly, bOnly } = diff(a, b);
    expect(aOnly).toHaveLength(0);
    expect(bOnly).toHaveLength(0);
  });

  it('aOnly contains ops present only in A', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock() });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock() });
    a.set('k', 1);
    const { aOnly, bOnly } = diff(a, b);
    expect(aOnly).toHaveLength(1);
    expect(bOnly).toHaveLength(0);
  });

  it('bOnly contains ops present only in B', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock() });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock() });
    b.set('k', 2);
    const { aOnly, bOnly } = diff(a, b);
    expect(aOnly).toHaveLength(0);
    expect(bOnly).toHaveLength(1);
  });

  it('symmetric: aOnly and bOnly together cover the total divergence', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock(100) });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock(200) });
    a.set('x', 'a');
    b.set('y', 'b');
    const { aOnly, bOnly } = diff(a, b);
    expect(aOnly).toHaveLength(1);
    expect(bOnly).toHaveLength(1);
    // after cross-applying the diff, they should converge
    a.merge(bOnly);
    b.merge(aOnly);
    expect(state(a)).toEqual(state(b));
  });

  it('diff op ids are disjoint', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock(1) });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock(2) });
    a.set('m', 1);
    b.set('n', 2);
    const { aOnly, bOnly } = diff(a, b);
    const aIds = new Set(aOnly.map((o: Op) => o.id));
    const bIds = new Set(bOnly.map((o: Op) => o.id));
    for (const id of bIds) expect(aIds.has(id)).toBe(false);
  });
});

// ─── vector clock ─────────────────────────────────────────────────────────────

describe('vector clock', () => {
  it('advances own replicaId seq on set', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.set('a', 1);
    doc.set('b', 2);
    expect(doc.toJSON().vector['r1']).toBeGreaterThanOrEqual(1);
  });

  it('records foreign replicaId after merge', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock() });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock() });
    b.set('x', 10);
    a.merge(b);
    expect(a.toJSON().vector['B']).toBeDefined();
  });

  it('vector clock seq increments with each local op', () => {
    const doc = createDoc({ id: 'd', replicaId: 'R', clock: makeClock() });
    doc.set('a', 1);
    const seq0 = doc.toJSON().vector['R'];
    doc.set('b', 2);
    const seq1 = doc.toJSON().vector['R'];
    expect(seq1).toBeGreaterThan(seq0);
  });
});

// ─── export / import round-trip ───────────────────────────────────────────────

describe('export / import round-trip', () => {
  it('reconstructing a doc from exported ops yields same state', () => {
    const original = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    original.set('name', 'Bob');
    original.set('age', 30);
    original.delete('name');

    const clone = createDoc({ id: 'd2', replicaId: 'r2', clock: makeClock(9999) });
    for (const op of original.export()) clone.applyOp(op);

    expect(state(clone)).toEqual(state(original));
  });

  it('toJSON snapshot state matches get() calls', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.set('p', 'q');
    doc.set('r', 42);
    const snap = doc.toJSON();
    expect(snap.state['p']).toBe(doc.get('p'));
    expect(snap.state['r']).toBe(doc.get('r'));
  });

  it('toJSON replicaId matches doc replicaId', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'my-replica', clock: makeClock() });
    expect(doc.toJSON().replicaId).toBe('my-replica');
  });

  it('import via applyOp loop is idempotent when run twice', () => {
    const src = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    src.set('k', 'v');
    const dst = createDoc({ id: 'd2', replicaId: 'r2', clock: makeClock(9999) });
    const ops = src.export();
    for (const op of ops) dst.applyOp(op);
    for (const op of ops) dst.applyOp(op); // second pass — must be no-op
    expect(dst.export().length).toBe(ops.length);
  });
});

// ─── merge conflict count ─────────────────────────────────────────────────────

describe('merge conflict count', () => {
  it('returns 0 when merging disjoint key sets', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock() });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock() });
    a.set('x', 1);
    b.set('y', 2);
    expect(a.merge(b)).toBe(0);
  });

  it('returns 1 when both replicas wrote the same key independently', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock(100) });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock(200) });
    a.set('shared', 'A-value');
    b.set('shared', 'B-value');
    const conflicts = a.merge(b);
    expect(conflicts).toBe(1);
  });

  it('counts each conflicting key once even if multiple ops target it', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock(100) });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock(200) });
    a.set('k', 'a1');
    b.set('k', 'b1');
    b.set('k', 'b2'); // second write on B for same key
    const conflicts = a.merge(b);
    // both replicas wrote 'k', but it's 1 key = 1 conflict
    expect(conflicts).toBe(1);
  });

  it('returns 0 on second merge of same doc (already seen)', () => {
    const a = createDoc({ id: 'da', replicaId: 'A', clock: makeClock(100) });
    const b = createDoc({ id: 'db', replicaId: 'B', clock: makeClock(200) });
    a.set('shared', 'A');
    b.set('shared', 'B');
    a.merge(b);
    expect(a.merge(b)).toBe(0); // second merge sees no new ops → no new conflicts
  });
});

// ─── compact ──────────────────────────────────────────────────────────────────

describe('compact', () => {
  it('reduces op count when there are superseded ops', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.set('k', 'v1');
    doc.set('k', 'v2');
    doc.set('k', 'v3');
    const before = doc.export().length;
    const { removed } = compact(doc);
    expect(removed).toBe(before - 1); // only 1 op should survive for key 'k'
    expect(doc.export().length).toBe(1);
  });

  it('compact keeps only the winning op per key', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.set('a', 1);
    doc.set('a', 2);
    doc.set('b', 'x');
    compact(doc);
    // surviving ops: 1 for 'a' (latest) + 1 for 'b'
    expect(doc.export().length).toBe(2);
    expect(doc.get('a')).toBe(2);
    expect(doc.get('b')).toBe('x');
  });

  it('compact returns removed=0 when already minimal', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.set('a', 1);
    doc.set('b', 2);
    const { removed } = compact(doc);
    expect(removed).toBe(0);
  });

  it('compact does not alter visible state', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.set('x', 10);
    doc.set('x', 20);
    doc.set('y', 5);
    const before = state(doc);
    compact(doc);
    expect(state(doc)).toEqual(before);
  });
});

// ─── text helpers ─────────────────────────────────────────────────────────────

describe('text helpers', () => {
  it('appendText builds a string across calls', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.appendText('msg', 'Hello');
    doc.appendText('msg', ', World');
    expect(doc.get('msg')).toBe('Hello, World');
  });

  it('appendText starts from empty string when key is absent', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.appendText('log', 'line1');
    expect(doc.get('log')).toBe('line1');
  });

  it('appendText op is idempotent: applying same op twice = same state', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.appendText('t', 'hello');
    const ops = doc.export();
    for (const op of ops) doc.applyOp(op); // re-apply all
    expect(doc.get('t')).toBe('hello');   // must not double-append
  });

  it('replaceText sets value directly', () => {
    const doc = createDoc({ id: 'd1', replicaId: 'r1', clock: makeClock() });
    doc.appendText('t', 'old content');
    doc.replaceText('t', 'new content');
    expect(doc.get('t')).toBe('new content');
  });
});

// ─── clock injection ──────────────────────────────────────────────────────────

describe('clock injection', () => {
  it('fixed clock produces deterministic op ids', () => {
    const doc1 = createDoc({ id: 'd', replicaId: 'R', clock: () => 42 });
    const doc2 = createDoc({ id: 'd', replicaId: 'R', clock: () => 42 });
    doc1.set('k', 'v');
    doc2.set('k', 'v');
    expect(doc1.export()[0].id).toBe(doc2.export()[0].id);
  });

  it('clock value appears as ts in the generated op', () => {
    const doc = createDoc({ id: 'd', replicaId: 'R', clock: () => 12345 });
    doc.set('k', 1);
    expect(doc.export()[0].ts).toBe(12345);
  });
});

// ─── newReplicaId ─────────────────────────────────────────────────────────────

describe('newReplicaId', () => {
  it('returns a non-empty string', () => {
    expect(typeof newReplicaId()).toBe('string');
    expect(newReplicaId().length).toBeGreaterThan(0);
  });

  it('successive calls return different values', () => {
    expect(newReplicaId()).not.toBe(newReplicaId());
  });
});
