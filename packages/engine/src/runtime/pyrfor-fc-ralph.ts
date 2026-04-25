// @vitest-environment node
import type { FCRunOptions, FCEnvelope } from './pyrfor-fc-adapter.js';
import { runFreeClaude } from './pyrfor-fc-adapter.js';
import type { EarlyStopPredicate } from './pyrfor-fc-early-stop.js';
import type { StruggleDetector } from './pyrfor-fc-struggle-detect.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface IterationResult {
  iter: number;
  envelope: FCEnvelope;
  score: { total: number; breakdown: any };
  durationMs: number;
  filesTouched: string[];
  costUsd: number;
  abortReason?: 'struggle' | 'max-iter' | 'threshold-reached' | 'fatal';
}

export interface RalphFcOptions {
  prompt: string;
  workdir: string;
  maxIterations: number;
  scoreThreshold: number;
  fcRunner: typeof runFreeClaude;
  scoreFn: (
    envelope: FCEnvelope,
    workdir: string
  ) => Promise<{ total: number; breakdown: any }>;
  buildContextForIteration?: (
    iter: number,
    history: IterationResult[]
  ) => Promise<{ appendSystemPrompt?: string; resumeSessionId?: string }>;
  onIteration?: (r: IterationResult) => void;
  struggleDetector?: StruggleDetector;
  earlyStop?: EarlyStopPredicate;
  trajectory?: { append: (ev: any) => void };
  fcModel?: string;
}

export interface RalphFcResult {
  finalIter: number;
  bestIter: IterationResult;
  history: IterationResult[];
  stoppedReason: 'threshold-reached' | 'max-iter' | 'struggle' | 'fatal';
  totalCostUsd: number;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runRalphFc(opts: RalphFcOptions): Promise<RalphFcResult> {
  const history: IterationResult[] = [];
  let bestIter: IterationResult | null = null;
  let stoppedReason: RalphFcResult['stoppedReason'] = 'max-iter';
  let finalIter = 0;
  let totalCostUsd = 0;

  for (let iter = 1; iter <= opts.maxIterations; iter++) {
    finalIter = iter;

    // ── Build context ──────────────────────────────────────────────────────
    let appendSystemPrompt: string | undefined;
    let resumeSessionId: string | undefined;

    if (opts.buildContextForIteration) {
      const ctx = await opts.buildContextForIteration(iter, [...history]);
      appendSystemPrompt = ctx.appendSystemPrompt;
      resumeSessionId = ctx.resumeSessionId;
    } else if (iter > 1 && history.length > 0) {
      // Default: continue in previous session when no custom builder provided
      resumeSessionId =
        history[history.length - 1]!.envelope.sessionId ?? undefined;
    }

    const runOpts: FCRunOptions = {
      prompt: opts.prompt,
      workdir: opts.workdir,
      model: opts.fcModel,
      appendSystemPrompt,
      resume: resumeSessionId,
    };

    // ── Run FC ─────────────────────────────────────────────────────────────
    const t0 = Date.now();
    let envelope: FCEnvelope;
    try {
      const handle = opts.fcRunner(runOpts);
      const result = await handle.complete();
      envelope = result.envelope;
    } catch (err) {
      envelope = {
        status: 'error',
        exitCode: 1,
        filesTouched: [],
        commandsRun: [],
        error: String(err),
        raw: {},
      };
    }
    const durationMs = Date.now() - t0;

    // ── Fatal check ────────────────────────────────────────────────────────
    if (envelope.status === 'error') {
      const iterResult: IterationResult = {
        iter,
        envelope,
        score: { total: 0, breakdown: {} },
        durationMs,
        filesTouched: envelope.filesTouched ?? [],
        costUsd: envelope.costUsd ?? 0,
        abortReason: 'fatal',
      };
      totalCostUsd += iterResult.costUsd;
      if (!bestIter) bestIter = iterResult;
      history.push(iterResult);
      opts.onIteration?.(iterResult);
      opts.trajectory?.append({
        type: 'iteration',
        iter,
        score: 0,
        durationMs,
        abortReason: 'fatal',
      });
      stoppedReason = 'fatal';
      break;
    }

    // ── Score ──────────────────────────────────────────────────────────────
    const score = await opts.scoreFn(envelope, opts.workdir);
    const costUsd = envelope.costUsd ?? 0;
    totalCostUsd += costUsd;

    const iterResult: IterationResult = {
      iter,
      envelope,
      score,
      durationMs,
      filesTouched: envelope.filesTouched ?? [],
      costUsd,
    };

    // Track best (strictly greater → ties keep earliest)
    if (!bestIter || score.total > bestIter.score.total) {
      bestIter = iterResult;
    }

    history.push(iterResult);
    opts.onIteration?.(iterResult);
    opts.trajectory?.append({
      type: 'iteration',
      iter,
      score: score.total,
      durationMs,
    });

    // ── Early-stop: score threshold ────────────────────────────────────────
    if (score.total >= opts.scoreThreshold) {
      iterResult.abortReason = 'threshold-reached';
      stoppedReason = 'threshold-reached';
      break;
    }

    // ── Early-stop: pluggable predicate ────────────────────────────────────
    if (opts.earlyStop) {
      const stopResult = opts.earlyStop.shouldStop({
        history: [...history],
        current: iterResult,
      });
      if (stopResult.stop) {
        iterResult.abortReason = 'struggle';
        stoppedReason = 'struggle';
        break;
      }
    }

    // ── Early-stop: struggle detector ──────────────────────────────────────
    if (opts.struggleDetector) {
      const detectResult = opts.struggleDetector.detect([...history]);
      if (detectResult.stuck) {
        iterResult.abortReason = 'struggle';
        stoppedReason = 'struggle';
        break;
      }
    }

    // ── Max iterations ─────────────────────────────────────────────────────
    if (iter === opts.maxIterations) {
      iterResult.abortReason = 'max-iter';
      stoppedReason = 'max-iter';
    }
  }

  return {
    finalIter,
    bestIter: bestIter!,
    history,
    stoppedReason,
    totalCostUsd,
  };
}
