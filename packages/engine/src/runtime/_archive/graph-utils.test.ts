// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  createGraph,
  topoSort,
  findCycles,
  shortestPath,
  reachable,
  transitiveClosure,
  isDag,
  parallelLayers,
  criticalPath,
  mergeGraphs,
  subgraph,
} from "./graph-utils.js";

// ── createGraph / node API ────────────────────────────────────────────────────

describe("addNode / hasNode / getNode / nodes / size", () => {
  it("addNode makes hasNode return true", () => {
    const g = createGraph();
    g.addNode("a");
    expect(g.hasNode("a")).toBe(true);
  });

  it("hasNode returns false for missing node", () => {
    const g = createGraph();
    expect(g.hasNode("x")).toBe(false);
  });

  it("getNode returns entry with id and data", () => {
    const g = createGraph<{ label: string }>();
    g.addNode("a", { label: "foo" });
    expect(g.getNode("a")).toEqual({ id: "a", data: { label: "foo" } });
  });

  it("addNode without data stores undefined data", () => {
    const g = createGraph();
    g.addNode("b");
    expect(g.getNode("b")?.data).toBeUndefined();
  });

  it("nodes() lists all added nodes", () => {
    const g = createGraph();
    g.addNode("x");
    g.addNode("y");
    expect(g.nodes().sort()).toEqual(["x", "y"]);
  });

  it("size() reflects node count", () => {
    const g = createGraph();
    g.addNode("a");
    g.addNode("b");
    expect(g.size()).toBe(2);
  });
});

describe("removeNode", () => {
  it("removeNode removes the node", () => {
    const g = createGraph();
    g.addNode("a");
    g.removeNode("a");
    expect(g.hasNode("a")).toBe(false);
  });

  it("removeNode also removes incident edges", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "c");
    g.removeNode("b");
    expect(g.outgoing("a")).toHaveLength(0);
    expect(g.incoming("c")).toHaveLength(0);
  });

  it("removeNode on missing node is a no-op", () => {
    const g = createGraph();
    expect(() => g.removeNode("ghost")).not.toThrow();
  });
});

// ── edge API ──────────────────────────────────────────────────────────────────

describe("addEdge / removeEdge / hasEdge / outgoing / incoming", () => {
  it("addEdge creates nodes implicitly", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    expect(g.hasNode("a")).toBe(true);
    expect(g.hasNode("b")).toBe(true);
  });

  it("hasEdge is true after addEdge", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    expect(g.hasEdge("a", "b")).toBe(true);
  });

  it("hasEdge is false for reverse direction", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    expect(g.hasEdge("b", "a")).toBe(false);
  });

  it("removeEdge removes only the specified edge", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("a", "c");
    g.removeEdge("a", "b");
    expect(g.hasEdge("a", "b")).toBe(false);
    expect(g.hasEdge("a", "c")).toBe(true);
  });

  it("outgoing returns correct edges with weights", () => {
    const g = createGraph();
    g.addEdge("a", "b", 5);
    g.addEdge("a", "c", 3);
    const out = g.outgoing("a");
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.to === "b")?.weight).toBe(5);
  });

  it("incoming returns correct source nodes", () => {
    const g = createGraph();
    g.addEdge("a", "c");
    g.addEdge("b", "c");
    const inc = g.incoming("c").map((e) => e.to);
    expect(inc.sort()).toEqual(["a", "b"]);
  });

  it("edgeCount tracks edges correctly", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "c");
    g.addEdge("a", "c");
    expect(g.edgeCount()).toBe(3);
    g.removeEdge("a", "c");
    expect(g.edgeCount()).toBe(2);
  });
});

// ── clone ─────────────────────────────────────────────────────────────────────

describe("clone()", () => {
  it("clone produces structurally equal graph", () => {
    const g = createGraph<number>();
    g.addNode("a", 1);
    g.addEdge("a", "b", 7);
    const c = g.clone();
    expect(c.hasNode("a")).toBe(true);
    expect(c.hasEdge("a", "b")).toBe(true);
    expect(c.outgoing("a")[0]?.weight).toBe(7);
  });

  it("clone is independent of original", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    const c = g.clone();
    c.removeNode("a");
    expect(g.hasNode("a")).toBe(true);
  });
});

// ── topoSort ──────────────────────────────────────────────────────────────────

describe("topoSort", () => {
  it("sorts a linear chain", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "c");
    const r = topoSort(g);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order).toEqual(["a", "b", "c"]);
  });

  it("detects a direct cycle", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "a");
    const r = topoSort(g);
    expect(r.ok).toBe(false);
  });

  it("cycle result contains offending nodes", () => {
    const g = createGraph();
    g.addEdge("x", "y");
    g.addEdge("y", "z");
    g.addEdge("z", "x");
    const r = topoSort(g);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cycle.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("handles single node with no edges", () => {
    const g = createGraph();
    g.addNode("solo");
    const r = topoSort(g);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.order).toContain("solo");
  });
});

// ── findCycles ────────────────────────────────────────────────────────────────

describe("findCycles", () => {
  it("returns empty for a DAG", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "c");
    expect(findCycles(g)).toHaveLength(0);
  });

  it("returns SCC for a cycle", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "c");
    g.addEdge("c", "a");
    const cycles = findCycles(g);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    const flat = cycles.flat();
    expect(flat).toContain("a");
    expect(flat).toContain("b");
    expect(flat).toContain("c");
  });

  it("detects self-loop as a cycle", () => {
    const g = createGraph();
    g.addNode("x");
    g.addEdge("x", "x");
    const cycles = findCycles(g);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });
});

// ── shortestPath ──────────────────────────────────────────────────────────────

describe("shortestPath", () => {
  it("finds path in simple graph", () => {
    const g = createGraph();
    g.addEdge("a", "b", 1);
    g.addEdge("b", "c", 2);
    const r = shortestPath(g, "a", "c");
    expect(r).not.toBeNull();
    expect(r?.path).toEqual(["a", "b", "c"]);
    expect(r?.weight).toBe(3);
  });

  it("finds shortest among multiple paths", () => {
    const g = createGraph();
    g.addEdge("a", "b", 10);
    g.addEdge("a", "c", 1);
    g.addEdge("c", "b", 1);
    const r = shortestPath(g, "a", "b");
    expect(r?.weight).toBe(2);
    expect(r?.path).toEqual(["a", "c", "b"]);
  });

  it("returns null when unreachable", () => {
    const g = createGraph();
    g.addNode("a");
    g.addNode("b");
    expect(shortestPath(g, "a", "b")).toBeNull();
  });

  it("returns null for missing src or dst", () => {
    const g = createGraph();
    g.addNode("a");
    expect(shortestPath(g, "a", "z")).toBeNull();
    expect(shortestPath(g, "z", "a")).toBeNull();
  });

  it("src === dst returns single-node path weight 0", () => {
    const g = createGraph();
    g.addNode("a");
    const r = shortestPath(g, "a", "a");
    expect(r?.path).toEqual(["a"]);
    expect(r?.weight).toBe(0);
  });
});

// ── reachable ─────────────────────────────────────────────────────────────────

describe("reachable", () => {
  it("BFS finds all reachable nodes", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "c");
    g.addEdge("a", "d");
    const r = reachable(g, "a");
    expect([...r].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("returns only src when no outgoing edges", () => {
    const g = createGraph();
    g.addNode("a");
    g.addNode("b");
    expect([...reachable(g, "a")]).toEqual(["a"]);
  });

  it("returns empty set for missing node", () => {
    const g = createGraph();
    expect(reachable(g, "ghost").size).toBe(0);
  });
});

// ── transitiveClosure ─────────────────────────────────────────────────────────

describe("transitiveClosure", () => {
  it("correctness on simple DAG", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "c");
    const tc = transitiveClosure(g);
    expect(tc.get("a")?.has("c")).toBe(true);
    expect(tc.get("b")?.has("c")).toBe(true);
    expect(tc.get("c")?.has("a")).toBe(false);
  });
});

// ── isDag ─────────────────────────────────────────────────────────────────────

describe("isDag", () => {
  it("returns true for a DAG", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "c");
    expect(isDag(g)).toBe(true);
  });

  it("returns false when cycle exists", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "a");
    expect(isDag(g)).toBe(false);
  });
});

// ── parallelLayers ────────────────────────────────────────────────────────────

describe("parallelLayers", () => {
  it("groups independent nodes in same layer", () => {
    const g = createGraph();
    g.addNode("a");
    g.addNode("b");
    g.addEdge("a", "c");
    g.addEdge("b", "c");
    const layers = parallelLayers(g);
    expect(layers[0]!.sort()).toEqual(["a", "b"]);
    expect(layers[1]).toEqual(["c"]);
  });

  it("linear chain produces one node per layer", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "c");
    const layers = parallelLayers(g);
    expect(layers).toHaveLength(3);
    layers.forEach((l) => expect(l).toHaveLength(1));
  });

  it("returns empty array for empty graph", () => {
    const g = createGraph();
    expect(parallelLayers(g)).toHaveLength(0);
  });
});

// ── criticalPath ──────────────────────────────────────────────────────────────

describe("criticalPath", () => {
  it("finds longest path in DAG", () => {
    const g = createGraph();
    g.addEdge("a", "b", 1);
    g.addEdge("b", "d", 1);
    g.addEdge("a", "c", 1);
    g.addEdge("c", "d", 10);
    const r = criticalPath(g);
    expect(r.path).toEqual(["a", "c", "d"]);
    expect(r.weight).toBe(11);
  });

  it("respects node weights", () => {
    const g = createGraph();
    g.addEdge("a", "b", 1);
    g.addEdge("b", "c", 1);
    const nw = new Map([["b", 5]]);
    const r = criticalPath(g, nw);
    expect(r.path).toEqual(["a", "b", "c"]);
    expect(r.weight).toBeGreaterThan(2);
  });
});

// ── mergeGraphs ───────────────────────────────────────────────────────────────

describe("mergeGraphs", () => {
  it("union of nodes and edges", () => {
    const a = createGraph<string>();
    a.addEdge("x", "y");
    const b = createGraph<string>();
    b.addEdge("y", "z");
    const m = mergeGraphs(a, b);
    expect(m.hasNode("x")).toBe(true);
    expect(m.hasNode("z")).toBe(true);
    expect(m.hasEdge("x", "y")).toBe(true);
    expect(m.hasEdge("y", "z")).toBe(true);
  });

  it("b node data wins on conflict", () => {
    const a = createGraph<string>();
    a.addNode("n", "from-a");
    const b = createGraph<string>();
    b.addNode("n", "from-b");
    const m = mergeGraphs(a, b);
    expect(m.getNode("n")?.data).toBe("from-b");
  });
});

// ── subgraph ──────────────────────────────────────────────────────────────────

describe("subgraph", () => {
  it("restricts nodes to given set", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "c");
    g.addEdge("c", "d");
    const sg = subgraph(g, ["a", "b", "c"]);
    expect(sg.hasNode("d")).toBe(false);
    expect(sg.hasNode("c")).toBe(true);
  });

  it("restricts edges to induced edges", () => {
    const g = createGraph();
    g.addEdge("a", "b");
    g.addEdge("b", "c");
    g.addEdge("a", "c");
    const sg = subgraph(g, ["a", "b"]);
    expect(sg.hasEdge("a", "b")).toBe(true);
    expect(sg.hasEdge("b", "c")).toBe(false);
    expect(sg.hasEdge("a", "c")).toBe(false);
  });
});
