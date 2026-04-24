import type { RalphSpec } from './ralph-spec.js';
import type { VerifyCheck, VerifyResult } from './verify-engine.js';
import { renderPrompt } from './ralph-spec.js';
import { runVerify } from './verify-engine.js';
import { promises as fsp } from 'fs';
import path from 'path';

export interface RalphAgentRunner {
  run(
    prompt: string,
    opts: { iteration: number; abortSignal?: AbortSignal }
  ): Promise<{ output: string; tokensIn?: number; tokensOut?: number }>;
}

export interface RalphProgress {
  iteration: number;
  score: number;
  passed: boolean;
  output: string;
  verify: VerifyResult;
  ts: number;
}

export interface RalphRunOptions {
  spec: RalphSpec;
  agent: RalphAgentRunner;
  checks: VerifyCheck[];
  cwd?: string;
  abortSignal?: AbortSignal;
  onProgress?: (p: RalphProgress) => void;
  progressFile?: string;
  lessons?: string;
}

export interface RalphRunResult {
  status: 'completed' | 'max_iterations' | 'aborted' | 'error';
  iterations: RalphProgress[];
  finalScore: number;
  reason?: string;
}

async function appendProgress(file: string, p: RalphProgress): Promise<void> {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.appendFile(file, JSON.stringify(p) + '\n', 'utf8');
}

export async function runRalph(opts: RalphRunOptions): Promise<RalphRunResult> {
  const { spec, agent, checks } = opts;
  const iterations: RalphProgress[] = [];
  let lastVerify: VerifyResult | undefined;
  let lastScore: number | undefined;
  let iteration = 1;

  while (true) {
    if (opts.abortSignal?.aborted) {
      return {
        status: 'aborted',
        iterations,
        finalScore: lastScore ?? 0,
        reason: 'aborted before iteration',
      };
    }

    let progressStr = '';
    if (iterations.length > 0) {
      const lastOut = iterations[iterations.length - 1]!.output;
      progressStr = lastOut.length > 1500 ? lastOut.slice(-1500) : lastOut;
    }

    const renderCtx: {
      iteration: number;
      lastScore?: number;
      lastVerify?: VerifyResult;
      progress: string;
      lessons: string;
    } = {
      iteration,
      progress: progressStr,
      lessons: opts.lessons ?? '',
    };
    if (lastScore !== undefined) renderCtx.lastScore = lastScore;
    if (lastVerify) renderCtx.lastVerify = lastVerify;
    const prompt = renderPrompt(spec, renderCtx);

    let agentOutput: string;
    try {
      const runOpts: { iteration: number; abortSignal?: AbortSignal } = {
        iteration,
      };
      if (opts.abortSignal) runOpts.abortSignal = opts.abortSignal;
      const result = await agent.run(prompt, runOpts);
      agentOutput = result.output;
    } catch (err) {
      const verify: VerifyResult = {
        total: 0,
        threshold: spec.scoreThreshold,
        passed: false,
        checks: [],
        ts: Date.now(),
      };
      const progress: RalphProgress = {
        iteration,
        score: 0,
        passed: false,
        output: err instanceof Error ? err.message : String(err),
        verify,
        ts: Date.now(),
      };
      iterations.push(progress);
      try {
        opts.onProgress?.(progress);
      } catch {
        // ignore
      }
      if (opts.progressFile) {
        try {
          await appendProgress(opts.progressFile, progress);
        } catch {
          // ignore
        }
      }
      lastVerify = verify;
      lastScore = 0;
      iteration++;
      if (iteration > spec.maxIterations) {
        return {
          status: 'max_iterations',
          iterations,
          finalScore: lastScore ?? 0,
        };
      }
      continue;
    }

    if (opts.abortSignal?.aborted) {
      return {
        status: 'aborted',
        iterations,
        finalScore: lastScore ?? 0,
        reason: 'aborted after agent.run',
      };
    }

    if (agentOutput.includes(spec.exitToken)) {
      const verify: VerifyResult = {
        total: 100,
        threshold: spec.scoreThreshold,
        passed: true,
        checks: [],
        ts: Date.now(),
      };
      const progress: RalphProgress = {
        iteration,
        score: 100,
        passed: true,
        output: agentOutput,
        verify,
        ts: Date.now(),
      };
      iterations.push(progress);
      try {
        opts.onProgress?.(progress);
      } catch {
        // ignore
      }
      if (opts.progressFile) {
        try {
          await appendProgress(opts.progressFile, progress);
        } catch {
          // ignore
        }
      }
      return {
        status: 'completed',
        iterations,
        finalScore: 100,
        reason: 'exitToken detected',
      };
    }

    const verifyOpts: {
      cwd?: string;
      threshold: number;
      abortSignal?: AbortSignal;
    } = { threshold: spec.scoreThreshold };
    if (opts.cwd) verifyOpts.cwd = opts.cwd;
    if (opts.abortSignal) verifyOpts.abortSignal = opts.abortSignal;
    const verify = await runVerify(checks, verifyOpts);

    if (opts.abortSignal?.aborted) {
      return {
        status: 'aborted',
        iterations,
        finalScore: verify.total,
        reason: 'aborted after verify',
      };
    }

    const progress: RalphProgress = {
      iteration,
      score: verify.total,
      passed: verify.passed,
      output: agentOutput,
      verify,
      ts: Date.now(),
    };
    iterations.push(progress);
    try {
      opts.onProgress?.(progress);
    } catch {
      // ignore
    }
    if (opts.progressFile) {
      try {
        await appendProgress(opts.progressFile, progress);
      } catch {
        // ignore
      }
    }
    lastVerify = verify;
    lastScore = verify.total;

    if (verify.passed) {
      return {
        status: 'completed',
        iterations,
        finalScore: verify.total,
        reason: 'verify passed',
      };
    }

    iteration++;
    if (iteration > spec.maxIterations) {
      return {
        status: 'max_iterations',
        iterations,
        finalScore: verify.total,
      };
    }
  }
}
