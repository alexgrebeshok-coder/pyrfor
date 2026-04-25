/**
 * pyrfor-fc-best-of-n.ts
 *
 * Orchestration strategy: spawn N parallel FreeClaude branches and pick the
 * winner by score.
 *
 * Each branch runs in its own workdir (default `${workdir}/.bestofn/branch-${i}`).
 * Parallelism is capped via a simple semaphore (default = n).
 * Failed branches receive score 0 and do not block the others.
 * Ties are broken by earliest index.
 */

import type { FCEnvelope, FCRunOptions } from './pyrfor-fc-adapter';
import { runFreeClaude } from './pyrfor-fc-adapter';

// ── Public types ──────────────────────────────────────────────────────────────

export interface BestOfNOptions {
  prompt: string;
  workdir: string;
  n: number;
  fcRunner: typeof runFreeClaude;
  scoreFn: (env: FCEnvelope, workdir: string) => Promise<{ total: number; breakdown: any }>;
  /** Override per-branch workdir. Default: `${workdir}/.bestofn/branch-${i}` */
  branchWorkdir?: (i: number) => string;
  /** Per-branch model override (length = n). */
  models?: string[];
  /**
   * Per-branch temperature (length = n).
   * NOTE: FCRunOptions does not expose a `temperature` field, so this value is
   * stored in BranchResult for caller reference but is NOT forwarded to fcRunner.
   */
  temperatures?: number[];
  /** Max concurrent branches. Defaults to n. */
  parallelism?: number;
  onBranchComplete?: (i: number, res: BranchResult) => void;
}

export interface BranchResult {
  i: number;
  envelope: FCEnvelope;
  score: { total: number; breakdown: any };
  workdir: string;
  durationMs: number;
  error?: string;
}

export interface BestOfNResult {
  winner: BranchResult;
  branches: BranchResult[];
  totalCostUsd: number;
}

// ── Implementation ────────────────────────────────────────────────────────────

async function runBranch(
  i: number,
  opts: BestOfNOptions,
  branchDir: string,
): Promise<BranchResult> {
  const start = Date.now();
  const runOpts: FCRunOptions = {
    prompt: opts.prompt,
    workdir: branchDir,
  };
  if (opts.models?.[i]) {
    runOpts.model = opts.models[i];
  }

  try {
    const handle = opts.fcRunner(runOpts);
    const result = await handle.complete();
    const envelope = result.envelope;
    const durationMs = Date.now() - start;

    if (envelope.status === 'error') {
      const score = { total: 0, breakdown: {} };
      return { i, envelope, score, workdir: branchDir, durationMs, error: envelope.error ?? 'error status' };
    }

    const score = await opts.scoreFn(envelope, branchDir);
    return { i, envelope, score, workdir: branchDir, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    const errorMsg: string = err instanceof Error ? err.message : String(err);
    const fakeEnvelope: FCEnvelope = {
      status: 'error',
      error: errorMsg,
      exitCode: -1,
      filesTouched: [],
      commandsRun: [],
      raw: {},
    };
    return {
      i,
      envelope: fakeEnvelope,
      score: { total: 0, breakdown: {} },
      workdir: branchDir,
      durationMs,
      error: errorMsg,
    };
  }
}

export async function runBestOfN(opts: BestOfNOptions): Promise<BestOfNResult> {
  const n = opts.n;
  const parallelism = opts.parallelism ?? n;
  const getBranchDir = opts.branchWorkdir ?? ((i: number) => `${opts.workdir}/.bestofn/branch-${i}`);

  const branches: BranchResult[] = new Array(n);

  // Queue-based semaphore to support multiple concurrent waiters
  let running = 0;
  const waitQueue: Array<() => void> = [];

  const release = () => {
    running--;
    const next = waitQueue.shift();
    if (next) next();
  };

  const acquire = (): Promise<void> => {
    if (running < parallelism) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waitQueue.push(() => { running++; resolve(); });
    });
  };

  const tasks = Array.from({ length: n }, (_, i) => i).map(async (i) => {
    await acquire();
    try {
      const branchDir = getBranchDir(i);
      const result = await runBranch(i, opts, branchDir);
      branches[i] = result;
      opts.onBranchComplete?.(i, result);
      return result;
    } finally {
      release();
    }
  });

  await Promise.all(tasks);

  // Pick winner: highest score, tie → earliest index
  let winner = branches[0];
  for (let i = 1; i < n; i++) {
    if (branches[i].score.total > winner.score.total) {
      winner = branches[i];
    }
  }

  const totalCostUsd = branches.reduce((sum, b) => sum + (b.envelope.costUsd ?? 0), 0);

  return { winner, branches, totalCostUsd };
}
