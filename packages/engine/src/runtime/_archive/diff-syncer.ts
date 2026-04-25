import { randomBytes } from 'crypto';

export interface Op {
  id: string;
  ts: number;
  replicaId: string;
  type: 'set' | 'del';
  key: string;
  value?: unknown;
}

export interface DocSnapshot {
  state: Record<string, unknown>;
  vector: Record<string, number>;
  replicaId: string;
}

export interface Doc {
  readonly id: string;
  readonly replicaId: string;
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  delete(key: string): void;
  toJSON(): DocSnapshot;
  applyOp(op: Op): void;
  export(): Op[];
  merge(other: Doc | Op[]): number;
  appendText(key: string, str: string): void;
  replaceText(key: string, str: string): void;
}

export interface CreateDocOptions {
  id: string;
  replicaId: string;
  clock?: () => number;
}

export interface DiffResult {
  aOnly: Op[];
  bOnly: Op[];
}

export interface CompactResult {
  removed: number;
}

/** Returns true when `incoming` beats `existing` under LWW rules. */
function lwwBeats(incoming: Op, existing: Op): boolean {
  if (incoming.ts !== existing.ts) return incoming.ts > existing.ts;
  return incoming.replicaId > existing.replicaId;
}

function seqFromOp(op: Op): number {
  // Op id format: `${ts}-${replicaId}-${seq}`
  // Since ts and replicaId are known, slice off the prefix to get seq.
  const prefix = `${op.ts}-${op.replicaId}-`;
  return parseInt(op.id.slice(prefix.length), 10);
}

interface DocInternals {
  opsById: Map<string, Op>;
  winningOps: Map<string, Op>;
}

// Module-level WeakMap so compact() can access internal state without
// leaking implementation details through the public Doc interface.
const _internals = new WeakMap<object, DocInternals>();

export function createDoc(options: CreateDocOptions): Doc {
  if (!options.replicaId) throw new Error('replicaId is required');

  const { id, replicaId, clock = () => Date.now() } = options;

  const opsById = new Map<string, Op>();
  const winningOps = new Map<string, Op>();
  const vector: Record<string, number> = {};
  let ownSeq = 0;

  function updateVector(op: Op): void {
    const seq = seqFromOp(op);
    const current = vector[op.replicaId] ?? -1;
    if (seq > current) vector[op.replicaId] = seq;
  }

  function applyOpInternal(op: Op): void {
    if (opsById.has(op.id)) return; // idempotent guard
    opsById.set(op.id, op);
    updateVector(op);
    const existing = winningOps.get(op.key);
    if (!existing || lwwBeats(op, existing)) {
      winningOps.set(op.key, op);
    }
  }

  function makeOp(type: 'set' | 'del', key: string, value?: unknown): Op {
    const ts = clock();
    const seq = ownSeq++;
    return { id: `${ts}-${replicaId}-${seq}`, ts, replicaId, type, key, value };
  }

  const doc: Doc = {
    get id() { return id; },
    get replicaId() { return replicaId; },

    set(key: string, value: unknown): void {
      applyOpInternal(makeOp('set', key, value));
    },

    get(key: string): unknown {
      const op = winningOps.get(key);
      return op && op.type === 'set' ? op.value : undefined;
    },

    delete(key: string): void {
      applyOpInternal(makeOp('del', key));
    },

    toJSON(): DocSnapshot {
      const state: Record<string, unknown> = {};
      for (const [key, op] of winningOps) {
        if (op.type === 'set') state[key] = op.value;
      }
      return { state, vector: { ...vector }, replicaId };
    },

    applyOp(op: Op): void {
      applyOpInternal(op);
    },

    export(): Op[] {
      return Array.from(opsById.values());
    },

    merge(other: Doc | Op[]): number {
      const ops = Array.isArray(other) ? other : other.export();
      let conflicts = 0;
      const counted = new Set<string>();
      for (const op of ops) {
        if (opsById.has(op.id)) continue;
        const existing = winningOps.get(op.key);
        // Concurrent write to same key = conflict (count each key once per merge)
        if (existing && !counted.has(op.key)) {
          conflicts++;
          counted.add(op.key);
        }
        applyOpInternal(op);
      }
      return conflicts;
    },

    appendText(key: string, str: string): void {
      const current = doc.get(key);
      doc.set(key, (typeof current === 'string' ? current : '') + str);
    },

    replaceText(key: string, str: string): void {
      doc.set(key, str);
    },
  };

  _internals.set(doc, { opsById, winningOps });
  return doc;
}

export function diff(docA: Doc, docB: Doc): DiffResult {
  const opsA = docA.export();
  const opsB = docB.export();
  const idsB = new Set(opsB.map(op => op.id));
  const idsA = new Set(opsA.map(op => op.id));
  return {
    aOnly: opsA.filter(op => !idsB.has(op.id)),
    bOnly: opsB.filter(op => !idsA.has(op.id)),
  };
}

/** Removes superseded ops, keeping only the LWW-winning op per key in-place.
 *  WARNING: compaction breaks future merges from replicas with older state. */
export function compact(doc: Doc): CompactResult {
  const internals = _internals.get(doc);
  if (!internals) throw new Error('compact: argument is not a Doc created by createDoc');

  const { opsById, winningOps } = internals;
  const winningIds = new Set<string>(
    Array.from(winningOps.values()).map(op => op.id),
  );

  let removed = 0;
  for (const opId of Array.from(opsById.keys())) {
    if (!winningIds.has(opId)) {
      opsById.delete(opId);
      removed++;
    }
  }
  return { removed };
}

// Convenience re-export so callers can generate a collision-resistant replicaId.
export function newReplicaId(): string {
  return randomBytes(8).toString('hex');
}
