/**
 * subagent-orchestrator.ts — Pyrfor Phase E: hierarchical SubagentOrchestrator.
 *
 * Spawns child tasks (subagents) with isolated tool subsets, per-agent budgets
 * (tokens, iterations, wall-clock ms), and AbortController propagation.
 * Supports parallel and serial dispatch with a concurrency semaphore.
 */

import { randomBytes } from 'node:crypto';

// ── Public types ──────────────────────────────────────────────────────────────

export interface SubagentToolDef {
  name: string;
  call: (args: any, signal: AbortSignal) => Promise<any>;
}

export interface SubagentSpec {
  id?: string;
  role: string;
  goal: string;
  tools?: SubagentToolDef[];
  maxIterations?: number;
  maxTokens?: number;
  maxDurationMs?: number;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

export interface SubagentRunResult {
  id: string;
  role: string;
  ok: boolean;
  output?: string;
  toolCalls: number;
  iterations: number;
  durationMs: number;
  tokensUsed: number;
  costUsd?: number;
  error?: string;
  cancelled?: boolean;
}

export type SubagentRunner = (
  spec: SubagentSpec,
  ctx: { signal: AbortSignal; logger: (lvl: string, msg: string, m?: any) => void },
) => Promise<{
  output: string;
  toolCalls: number;
  iterations: number;
  tokensUsed: number;
  costUsd?: number;
}>;

export interface SubagentOrchestratorOptions {
  runner: SubagentRunner;
  cost?: {
    record(input: { agentId: string; role: string; tokens: number; usd?: number }): void;
  };
  concurrencyLimit?: number;
  defaultMaxIterations?: number;
  defaultMaxTokens?: number;
  defaultMaxDurationMs?: number;
  clock?: () => number;
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
}

export interface SubagentOrchestrator {
  spawn(spec: SubagentSpec): Promise<SubagentRunResult>;
  spawnMany(
    specs: SubagentSpec[],
    opts?: { mode?: 'parallel' | 'serial' },
  ): Promise<SubagentRunResult[]>;
  cancel(id: string): boolean;
  cancelAll(): number;
  active(): Array<{ id: string; role: string; startedAt: number }>;
  shutdown(): Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + randomBytes(10).toString('hex');
}

/** Simple counting semaphore — resolves `acquire` as soon as a slot opens. */
class Semaphore {
  private _count: number;
  private _waiters: Array<() => void> = [];

  constructor(limit: number) {
    this._count = limit;
  }

  acquire(): Promise<void> {
    if (this._count > 0) {
      this._count--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this._waiters.push(resolve);
    });
  }

  release(): void {
    const next = this._waiters.shift();
    if (next) {
      next();
    } else {
      this._count++;
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSubagentOrchestrator(
  opts: SubagentOrchestratorOptions,
): SubagentOrchestrator {
  const clock = opts.clock ?? (() => Date.now());
  const log = opts.logger ?? (() => {});
  const concurrencyLimit = Math.max(1, opts.concurrencyLimit ?? 4);
  const defaultMaxIterations = opts.defaultMaxIterations ?? 10;
  const defaultMaxTokens = opts.defaultMaxTokens ?? 8000;
  const defaultMaxDurationMs = opts.defaultMaxDurationMs ?? 60_000;

  const semaphore = new Semaphore(concurrencyLimit);

  // active agents: id → { controller, role, startedAt, promise }
  const _active = new Map<
    string,
    { controller: AbortController; role: string; startedAt: number; promise: Promise<SubagentRunResult> }
  >();

  // all in-flight promises (for shutdown)
  const _allPromises = new Set<Promise<SubagentRunResult>>();

  let _isShutdown = false;

  // ── spawn ─────────────────────────────────────────────────────────────────

  async function spawn(spec: SubagentSpec): Promise<SubagentRunResult> {
    const id = spec.id ?? generateId();
    const maxDurationMs = spec.maxDurationMs ?? defaultMaxDurationMs;
    const maxTokens = spec.maxTokens ?? defaultMaxTokens;
    const maxIterations = spec.maxIterations ?? defaultMaxIterations;

    const controller = new AbortController();
    const startedAt = clock();

    log('info', `[subagent] spawning ${id} role=${spec.role}`, { id, role: spec.role });

    const agentLogger = (lvl: string, msg: string, m?: any) =>
      log(lvl as 'info' | 'warn' | 'error', `[subagent:${id}] ${msg}`, m);

    const promise: Promise<SubagentRunResult> = (async (): Promise<SubagentRunResult> => {
      _active.set(id, { controller, role: spec.role, startedAt, promise: null as any });

      try {
        // Race runner against timeout
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            controller.abort();
            reject(new Error('__timeout__'));
          }, maxDurationMs);
        });

        let runnerResult: Awaited<ReturnType<SubagentRunner>>;
        try {
          runnerResult = await Promise.race([
            opts.runner({ ...spec, id }, { signal: controller.signal, logger: agentLogger }),
            timeoutPromise,
          ]);
        } finally {
          if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        }

        const durationMs = clock() - startedAt;

        // Post-call budget checks
        if (runnerResult.tokensUsed > maxTokens) {
          log('warn', `[subagent] ${id} token budget exceeded`, {
            tokensUsed: runnerResult.tokensUsed,
            maxTokens,
          });
          opts.cost?.record({
            agentId: id,
            role: spec.role,
            tokens: runnerResult.tokensUsed,
            usd: runnerResult.costUsd,
          });
          return {
            id,
            role: spec.role,
            ok: false,
            output: runnerResult.output,
            toolCalls: runnerResult.toolCalls,
            iterations: runnerResult.iterations,
            durationMs,
            tokensUsed: runnerResult.tokensUsed,
            costUsd: runnerResult.costUsd,
            error: 'token-budget-exceeded',
            cancelled: false,
          };
        }

        if (runnerResult.iterations > maxIterations) {
          log('warn', `[subagent] ${id} iteration budget exceeded`, {
            iterations: runnerResult.iterations,
            maxIterations,
          });
          opts.cost?.record({
            agentId: id,
            role: spec.role,
            tokens: runnerResult.tokensUsed,
            usd: runnerResult.costUsd,
          });
          return {
            id,
            role: spec.role,
            ok: false,
            output: runnerResult.output,
            toolCalls: runnerResult.toolCalls,
            iterations: runnerResult.iterations,
            durationMs,
            tokensUsed: runnerResult.tokensUsed,
            costUsd: runnerResult.costUsd,
            error: 'iteration-budget-exceeded',
            cancelled: false,
          };
        }

        opts.cost?.record({
          agentId: id,
          role: spec.role,
          tokens: runnerResult.tokensUsed,
          usd: runnerResult.costUsd,
        });

        log('info', `[subagent] ${id} completed ok`, { durationMs });

        return {
          id,
          role: spec.role,
          ok: true,
          output: runnerResult.output,
          toolCalls: runnerResult.toolCalls,
          iterations: runnerResult.iterations,
          durationMs,
          tokensUsed: runnerResult.tokensUsed,
          costUsd: runnerResult.costUsd,
        };
      } catch (err: unknown) {
        const durationMs = clock() - startedAt;
        const msg = err instanceof Error ? err.message : String(err);

        if (msg === '__timeout__') {
          log('warn', `[subagent] ${id} timed out after ${durationMs}ms`);
          return {
            id,
            role: spec.role,
            ok: false,
            toolCalls: 0,
            iterations: 0,
            durationMs,
            tokensUsed: 0,
            error: 'timeout',
            cancelled: false,
          };
        }

        const wasCancelled = controller.signal.aborted && msg !== '__timeout__';
        log(wasCancelled ? 'info' : 'error', `[subagent] ${id} ${wasCancelled ? 'cancelled' : 'failed'}`, { msg });

        return {
          id,
          role: spec.role,
          ok: false,
          toolCalls: 0,
          iterations: 0,
          durationMs,
          tokensUsed: 0,
          error: wasCancelled ? 'cancelled' : msg,
          cancelled: wasCancelled,
        };
      } finally {
        _active.delete(id);
      }
    })();

    // Store promise reference back so active() can reflect it
    const entry = _active.get(id);
    if (entry) {
      (entry as any).promise = promise;
    }
    _allPromises.add(promise);
    promise.finally(() => _allPromises.delete(promise));

    return promise;
  }

  // ── spawnMany ─────────────────────────────────────────────────────────────

  async function spawnMany(
    specs: SubagentSpec[],
    spawnOpts?: { mode?: 'parallel' | 'serial' },
  ): Promise<SubagentRunResult[]> {
    if (specs.length === 0) return [];

    const mode = spawnOpts?.mode ?? 'parallel';

    if (mode === 'serial') {
      const results: SubagentRunResult[] = [];
      for (const spec of specs) {
        results.push(await spawn(spec));
      }
      return results;
    }

    // parallel — bounded by semaphore
    const promises = specs.map(async (spec) => {
      await semaphore.acquire();
      try {
        return await spawn(spec);
      } finally {
        semaphore.release();
      }
    });

    return Promise.all(promises);
  }

  // ── cancel / cancelAll ────────────────────────────────────────────────────

  function cancel(id: string): boolean {
    const entry = _active.get(id);
    if (!entry) return false;
    entry.controller.abort();
    return true;
  }

  function cancelAll(): number {
    const ids = [..._active.keys()];
    for (const id of ids) {
      _active.get(id)?.controller.abort();
    }
    return ids.length;
  }

  // ── active ────────────────────────────────────────────────────────────────

  function active(): Array<{ id: string; role: string; startedAt: number }> {
    return [..._active.entries()].map(([id, { role, startedAt }]) => ({
      id,
      role,
      startedAt,
    }));
  }

  // ── shutdown ──────────────────────────────────────────────────────────────

  async function shutdown(): Promise<void> {
    if (_isShutdown) return;
    _isShutdown = true;
    cancelAll();
    // Wait for all in-flight promises to settle
    const pending = [..._allPromises];
    await Promise.allSettled(pending);
  }

  return { spawn, spawnMany, cancel, cancelAll, active, shutdown };
}
