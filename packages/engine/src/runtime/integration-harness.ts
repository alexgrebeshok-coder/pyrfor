/**
 * integration-harness.ts — Pyrfor integration-test composition harness.
 *
 * Wires runtime modules together with deterministic fakes (FakeLlm,
 * FakeClock) so integration tests can run without external services.
 *
 * DO NOT modify cli.ts or index.ts — this module only composes existing ones.
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── FakeLlm ──────────────────────────────────────────────────────────────────

export type FakeLlmCall = {
  prompt: string;
  response: string;
  toolCalls?: { name: string; args: any }[];
};

export type FakeLlm = {
  /** Enqueue a scripted response. */
  enqueue(call: FakeLlmCall): void;
  /** Dequeue and return the next scripted response. Throws if queue empty. */
  complete(prompt: string): Promise<{ text: string; toolCalls?: any[] }>;
  /** All calls that have been completed (in order). */
  calls: FakeLlmCall[];
  stats(): { totalCalls: number; pending: number };
};

export function createFakeLlm(): FakeLlm {
  const queue: FakeLlmCall[] = [];
  const calls: FakeLlmCall[] = [];

  return {
    calls,
    enqueue(call: FakeLlmCall): void {
      queue.push(call);
    },
    async complete(prompt: string): Promise<{ text: string; toolCalls?: any[] }> {
      if (queue.length === 0) {
        throw new Error(`FakeLlm: complete() called with empty queue (prompt="${prompt.slice(0, 80)}")`);
      }
      const entry = queue.shift()!;
      const recorded: FakeLlmCall = { ...entry, prompt };
      calls.push(recorded);
      return { text: entry.response, toolCalls: entry.toolCalls };
    },
    stats() {
      return { totalCalls: calls.length, pending: queue.length };
    },
  };
}

// ─── FakeClock ────────────────────────────────────────────────────────────────

type TimerEntry = { id: number; deadline: number; cb: () => void; cancelled: boolean };

export type FakeClock = {
  now(): number;
  advance(ms: number): void;
  setTimeout(cb: () => void, ms: number): number;
  clearTimeout(id: number): void;
};

export function createFakeClock(start = 0): FakeClock {
  let current = start;
  let nextId = 1;
  const timers: TimerEntry[] = [];

  function fireExpired(): void {
    // Sort so timers fire in deadline order; re-evaluate after each fire
    // because a fired callback could advance or add timers (not supported
    // here, but keeps semantics clean).
    let fired = true;
    while (fired) {
      fired = false;
      const sorted = timers
        .filter(t => !t.cancelled && t.deadline <= current)
        .sort((a, b) => a.deadline - b.deadline);
      for (const t of sorted) {
        if (!t.cancelled) {
          t.cancelled = true; // mark before calling so clearTimeout inside cb is safe
          fired = true;
          t.cb();
        }
      }
    }
  }

  return {
    now(): number {
      return current;
    },
    advance(ms: number): void {
      if (ms < 0) throw new Error('FakeClock.advance: ms must be non-negative');
      current += ms;
      fireExpired();
    },
    setTimeout(cb: () => void, ms: number): number {
      const id = nextId++;
      timers.push({ id, deadline: current + ms, cb, cancelled: false });
      return id;
    },
    clearTimeout(id: number): void {
      const t = timers.find(e => e.id === id);
      if (t) t.cancelled = true;
    },
  };
}

// ─── Harness ──────────────────────────────────────────────────────────────────

export type SupportedModule =
  | 'memory-wiki'
  | 'skill-effectiveness'
  | 'runtime-profiler'
  | 'cron-persistence'
  | 'guardrails'
  | 'cost-aware-dag';

export type HarnessOpts = {
  modules?: SupportedModule[];
  tmpRoot?: string;
};

export type Harness = {
  llm: FakeLlm;
  clock: FakeClock;
  /** Dedicated temp directory for this harness instance. */
  tmpDir: string;
  /** Loaded module instances keyed by module name. */
  modules: Record<string, any>;
  /** Remove tmpDir and flush pending writes. */
  cleanup(): Promise<void>;
};

/**
 * Instantiate a single named module using a string-literal dynamic import
 * so bundlers can statically analyse the import graph.
 */
async function loadModule(
  name: SupportedModule,
  tmpDir: string,
  clock: FakeClock,
): Promise<any> {
  const logger = (l: string, m: string, meta?: unknown): void => {
    // silenced during tests — swap for console if you need verbose output
    void l; void m; void meta;
  };

  switch (name) {
    case 'memory-wiki': {
      const mod = await import('./memory-wiki.js');
      return mod.createMemoryWiki({
        storePath: join(tmpDir, 'memory-wiki.json'),
        clock: () => clock.now(),
        logger,
      });
    }
    case 'skill-effectiveness': {
      const mod = await import('./skill-effectiveness.js');
      return mod.createSkillEffectivenessTracker({
        storePath: join(tmpDir, 'skill-effectiveness.json'),
        clock: () => clock.now(),
      });
    }
    case 'runtime-profiler': {
      const mod = await import('./runtime-profiler.js');
      return mod.createRuntimeProfiler({
        tracePath: join(tmpDir, 'profiler-trace.jsonl'),
        clock: () => clock.now(),
      });
    }
    case 'cron-persistence': {
      const mod = await import('./cron-persistence.js');
      return mod.createCronPersistenceStore({
        storePath: join(tmpDir, 'cron-persistence.json'),
        clock: () => clock.now(),
        logger,
      });
    }
    case 'guardrails': {
      const mod = await import('./guardrails.js');
      return mod.createGuardrails({
        auditPath: join(tmpDir, 'guardrails-audit.jsonl'),
        clock: () => clock.now(),
        logger,
      });
    }
    case 'cost-aware-dag': {
      const mod = await import('./cost-aware-dag.js');
      return mod.createCostAwareDAGPlanner({ logger });
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown module: ${String(_exhaustive)}`);
    }
  }
}

export async function createIntegrationHarness(opts: HarnessOpts = {}): Promise<Harness> {
  const { modules: requestedModules = [], tmpRoot } = opts;

  const root = tmpRoot ?? tmpdir();
  const tmpDir = mkdtempSync(join(root, 'pyrfor-harness-'));

  const llm = createFakeLlm();
  const clock = createFakeClock(0);
  const moduleMap: Record<string, any> = {};

  for (const name of requestedModules) {
    try {
      moduleMap[name] = await loadModule(name, tmpDir, clock);
    } catch (err) {
      console.warn(`[integration-harness] skipping module "${name}": ${(err as Error).message}`);
    }
  }

  let cleaned = false;

  async function cleanup(): Promise<void> {
    if (cleaned) return;
    cleaned = true;

    // Flush any pending writes for modules that support it
    for (const inst of Object.values(moduleMap)) {
      if (inst && typeof inst.flush === 'function') {
        try { await inst.flush(); } catch { /* best-effort */ }
      }
    }

    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return { llm, clock, tmpDir, modules: moduleMap, cleanup };
}

// ─── Snapshot helper ──────────────────────────────────────────────────────────

export function snapshotHarness(h: Harness): {
  llmStats: { totalCalls: number; pending: number };
  moduleNames: string[];
  tmpDir: string;
} {
  return {
    llmStats: h.llm.stats(),
    moduleNames: Object.keys(h.modules),
    tmpDir: h.tmpDir,
  };
}
