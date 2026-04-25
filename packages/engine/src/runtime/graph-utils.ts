/**
 * graph-utils.ts — Generic directed-graph utilities for agent-pipeline DAG
 * validation, scheduling, and dependency resolution.
 *
 * Pure TypeScript, Node built-ins only, ESM-compatible.
 */

// ── Node / Edge types ─────────────────────────────────────────────────────────

export interface GraphEdge {
  to: string;
  weight: number;
}

export interface GraphNodeEntry<D> {
  id: string;
  data?: D;
}

// ── Graph class ───────────────────────────────────────────────────────────────

export interface Graph<N = string> {
  addNode(id: string, data?: N): void;
  removeNode(id: string): void;
  hasNode(id: string): boolean;
  getNode(id: string): GraphNodeEntry<N> | undefined;
  nodes(): string[];

  addEdge(from: string, to: string, weight?: number): void;
  removeEdge(from: string, to: string): void;
  hasEdge(from: string, to: string): boolean;
  outgoing(id: string): GraphEdge[];
  incoming(id: string): GraphEdge[];

  clone(): Graph<N>;
  size(): number;
  edgeCount(): number;
}

class GraphImpl<N = string> implements Graph<N> {
  private _nodes = new Map<string, GraphNodeEntry<N>>();
  // adjacency list: from → list of {to, weight}
  private _out = new Map<string, GraphEdge[]>();
  // reverse adjacency: to → list of {to: from, weight}
  private _in = new Map<string, GraphEdge[]>();

  addNode(id: string, data?: N): void {
    if (!this._nodes.has(id)) {
      this._nodes.set(id, { id, data });
      this._out.set(id, []);
      this._in.set(id, []);
    } else {
      const entry = this._nodes.get(id)!;
      entry.data = data;
    }
  }

  removeNode(id: string): void {
    if (!this._nodes.has(id)) return;
    // remove all outgoing edges
    for (const edge of this._out.get(id) ?? []) {
      const inList = this._in.get(edge.to);
      if (inList) {
        const idx = inList.findIndex((e) => e.to === id);
        if (idx !== -1) inList.splice(idx, 1);
      }
    }
    // remove all incoming edges
    for (const edge of this._in.get(id) ?? []) {
      const outList = this._out.get(edge.to);
      if (outList) {
        const idx = outList.findIndex((e) => e.to === id);
        if (idx !== -1) outList.splice(idx, 1);
      }
    }
    this._nodes.delete(id);
    this._out.delete(id);
    this._in.delete(id);
  }

  hasNode(id: string): boolean {
    return this._nodes.has(id);
  }

  getNode(id: string): GraphNodeEntry<N> | undefined {
    return this._nodes.get(id);
  }

  nodes(): string[] {
    return Array.from(this._nodes.keys());
  }

  addEdge(from: string, to: string, weight = 1): void {
    if (!this._nodes.has(from)) this.addNode(from);
    if (!this._nodes.has(to)) this.addNode(to);
    const outList = this._out.get(from)!;
    const existing = outList.find((e) => e.to === to);
    if (existing) {
      existing.weight = weight;
    } else {
      outList.push({ to, weight });
      this._in.get(to)!.push({ to: from, weight });
    }
  }

  removeEdge(from: string, to: string): void {
    const outList = this._out.get(from);
    if (outList) {
      const idx = outList.findIndex((e) => e.to === to);
      if (idx !== -1) outList.splice(idx, 1);
    }
    const inList = this._in.get(to);
    if (inList) {
      const idx = inList.findIndex((e) => e.to === from);
      if (idx !== -1) inList.splice(idx, 1);
    }
  }

  hasEdge(from: string, to: string): boolean {
    return (this._out.get(from) ?? []).some((e) => e.to === to);
  }

  outgoing(id: string): GraphEdge[] {
    return [...(this._out.get(id) ?? [])];
  }

  incoming(id: string): GraphEdge[] {
    return [...(this._in.get(id) ?? [])];
  }

  clone(): Graph<N> {
    const g = new GraphImpl<N>();
    for (const [id, entry] of this._nodes) {
      g.addNode(id, entry.data);
    }
    for (const [from, edges] of this._out) {
      for (const { to, weight } of edges) {
        g.addEdge(from, to, weight);
      }
    }
    return g;
  }

  size(): number {
    return this._nodes.size;
  }

  edgeCount(): number {
    let total = 0;
    for (const edges of this._out.values()) total += edges.length;
    return total;
  }

  // Internal accessors for algorithms
  _outMap(): Map<string, GraphEdge[]> {
    return this._out;
  }
  _inMap(): Map<string, GraphEdge[]> {
    return this._in;
  }
}

export function createGraph<N = string>(): Graph<N> {
  return new GraphImpl<N>();
}

// ── Algorithm helpers ─────────────────────────────────────────────────────────

function asImpl<N>(g: Graph<N>): GraphImpl<N> {
  return g as GraphImpl<N>;
}

// ── topoSort ──────────────────────────────────────────────────────────────────

export type TopoSortResult =
  | { ok: true; order: string[] }
  | { ok: false; cycle: string[] };

export function topoSort(g: Graph): TopoSortResult {
  const impl = asImpl(g);
  const inDeg = new Map<string, number>();
  for (const n of g.nodes()) inDeg.set(n, 0);
  for (const n of g.nodes()) {
    for (const { to } of impl.outgoing(n)) {
      inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [n, d] of inDeg) if (d === 0) queue.push(n);

  const order: string[] = [];
  while (queue.length) {
    const node = queue.shift()!;
    order.push(node);
    for (const { to } of impl.outgoing(node)) {
      const d = (inDeg.get(to) ?? 1) - 1;
      inDeg.set(to, d);
      if (d === 0) queue.push(to);
    }
  }

  if (order.length !== g.size()) {
    // find cycle via DFS
    const cycle = _extractCycle(g);
    return { ok: false, cycle };
  }
  return { ok: true, order };
}

function _extractCycle(g: Graph): string[] {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  for (const n of g.nodes()) {
    color.set(n, WHITE);
    parent.set(n, null);
  }

  let cycleStart: string | null = null;
  let cycleEnd: string | null = null;

  function dfs(u: string): boolean {
    color.set(u, GRAY);
    for (const { to } of asImpl(g).outgoing(u)) {
      if (color.get(to) === GRAY) {
        cycleStart = to;
        cycleEnd = u;
        return true;
      }
      if (color.get(to) === WHITE) {
        parent.set(to, u);
        if (dfs(to)) return true;
      }
    }
    color.set(u, BLACK);
    return false;
  }

  for (const n of g.nodes()) {
    if (color.get(n) === WHITE) {
      if (dfs(n)) break;
    }
  }

  if (cycleStart === null) return [];
  const cycle: string[] = [cycleStart];
  let cur: string = cycleEnd!;
  while (cur !== cycleStart) {
    cycle.unshift(cur);
    cur = parent.get(cur) as string;
  }
  cycle.unshift(cycleStart);
  return cycle;
}

// ── findCycles (Tarjan SCC) ───────────────────────────────────────────────────

export function findCycles(g: Graph): string[][] {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  function strongConnect(v: string): void {
    index.set(v, counter);
    lowLink.set(v, counter);
    counter++;
    stack.push(v);
    onStack.set(v, true);

    for (const { to: w } of asImpl(g).outgoing(v)) {
      if (!index.has(w)) {
        strongConnect(w);
        lowLink.set(v, Math.min(lowLink.get(v)!, lowLink.get(w)!));
      } else if (onStack.get(w)) {
        lowLink.set(v, Math.min(lowLink.get(v)!, index.get(w)!));
      }
    }

    if (lowLink.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.set(w, false);
        scc.push(w);
      } while (w !== v);
      // Only return SCCs that are actual cycles
      if (scc.length >= 2 || (scc.length === 1 && g.hasEdge(scc[0]!, scc[0]!))) {
        sccs.push(scc);
      }
    }
  }

  for (const v of g.nodes()) {
    if (!index.has(v)) strongConnect(v);
  }

  return sccs;
}

// ── shortestPath (Dijkstra) ───────────────────────────────────────────────────

export interface PathResult {
  path: string[];
  weight: number;
}

export function shortestPath(g: Graph, src: string, dst: string): PathResult | null {
  if (!g.hasNode(src) || !g.hasNode(dst)) return null;

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const visited = new Set<string>();

  for (const n of g.nodes()) dist.set(n, Infinity);
  dist.set(src, 0);
  prev.set(src, null);

  // Simple O(V²) Dijkstra (sufficient for pipeline graphs)
  while (true) {
    let u: string | null = null;
    let minDist = Infinity;
    for (const [n, d] of dist) {
      if (!visited.has(n) && d < minDist) {
        minDist = d;
        u = n;
      }
    }
    if (u === null) break;
    if (u === dst) break;
    visited.add(u);

    for (const { to, weight } of asImpl(g).outgoing(u)) {
      const alt = (dist.get(u) ?? Infinity) + weight;
      if (alt < (dist.get(to) ?? Infinity)) {
        dist.set(to, alt);
        prev.set(to, u);
      }
    }
  }

  if ((dist.get(dst) ?? Infinity) === Infinity) return null;

  const path: string[] = [];
  let cur: string | null = dst;
  while (cur !== null) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }
  return { path, weight: dist.get(dst)! };
}

// ── reachable (BFS) ───────────────────────────────────────────────────────────

export function reachable(g: Graph, src: string): Set<string> {
  const visited = new Set<string>();
  if (!g.hasNode(src)) return visited;
  const queue = [src];
  while (queue.length) {
    const u = queue.shift()!;
    if (visited.has(u)) continue;
    visited.add(u);
    for (const { to } of g.outgoing(u)) {
      if (!visited.has(to)) queue.push(to);
    }
  }
  return visited;
}

// ── transitiveClosure ─────────────────────────────────────────────────────────

export function transitiveClosure(g: Graph): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const n of g.nodes()) {
    result.set(n, reachable(g, n));
  }
  return result;
}

// ── isDag ─────────────────────────────────────────────────────────────────────

export function isDag(g: Graph): boolean {
  return topoSort(g).ok;
}

// ── parallelLayers (Kahn's per-layer) ─────────────────────────────────────────

export function parallelLayers(g: Graph): string[][] {
  const impl = asImpl(g);
  const inDeg = new Map<string, number>();
  for (const n of g.nodes()) inDeg.set(n, 0);
  for (const n of g.nodes()) {
    for (const { to } of impl.outgoing(n)) {
      inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
    }
  }

  const layers: string[][] = [];
  let current = g.nodes().filter((n) => inDeg.get(n) === 0);

  while (current.length > 0) {
    layers.push([...current]);
    const next: string[] = [];
    for (const u of current) {
      for (const { to } of impl.outgoing(u)) {
        const d = (inDeg.get(to) ?? 1) - 1;
        inDeg.set(to, d);
        if (d === 0) next.push(to);
      }
    }
    current = next;
  }

  return layers;
}

// ── criticalPath ──────────────────────────────────────────────────────────────

export function criticalPath(
  g: Graph,
  weights?: Map<string, number>
): PathResult {
  const result = topoSort(g);
  if (!result.ok) return { path: [], weight: 0 };

  const { order } = result;
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();

  for (const n of order) {
    const nodeW = weights?.get(n) ?? 0;
    if (!dist.has(n)) {
      dist.set(n, nodeW);
      prev.set(n, null);
    }
    for (const { to, weight: edgeW } of asImpl(g).outgoing(n)) {
      const toNodeW = weights?.get(to) ?? 0;
      const newDist = (dist.get(n) ?? 0) + edgeW + toNodeW;
      if (newDist > (dist.get(to) ?? -Infinity)) {
        dist.set(to, newDist);
        prev.set(to, n);
      }
    }
  }

  // Find node with max distance
  let maxNode: string | null = null;
  let maxDist = -Infinity;
  for (const [n, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      maxNode = n;
    }
  }

  if (maxNode === null) return { path: [], weight: 0 };

  const path: string[] = [];
  let cur: string | null = maxNode;
  while (cur !== null) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }

  return { path, weight: maxDist };
}

// ── mergeGraphs ───────────────────────────────────────────────────────────────

export function mergeGraphs<N = string>(a: Graph<N>, b: Graph<N>): Graph<N> {
  const g = createGraph<N>();

  for (const id of a.nodes()) {
    g.addNode(id, a.getNode(id)?.data);
  }
  for (const id of b.nodes()) {
    // b wins on conflict
    g.addNode(id, b.getNode(id)?.data);
  }

  for (const from of a.nodes()) {
    for (const { to, weight } of a.outgoing(from)) {
      g.addEdge(from, to, weight);
    }
  }
  for (const from of b.nodes()) {
    for (const { to, weight } of b.outgoing(from)) {
      g.addEdge(from, to, weight);
    }
  }

  return g;
}

// ── subgraph ──────────────────────────────────────────────────────────────────

export function subgraph<N = string>(g: Graph<N>, nodeIds: string[]): Graph<N> {
  const keep = new Set(nodeIds);
  const sg = createGraph<N>();

  for (const id of nodeIds) {
    if (g.hasNode(id)) sg.addNode(id, g.getNode(id)?.data);
  }

  for (const from of nodeIds) {
    if (!g.hasNode(from)) continue;
    for (const { to, weight } of g.outgoing(from)) {
      if (keep.has(to)) sg.addEdge(from, to, weight);
    }
  }

  return sg;
}
