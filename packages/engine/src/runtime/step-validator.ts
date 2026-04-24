import type { AcpEvent } from './acp-client.js';
import { spawn } from 'node:child_process';

export type ValidatorVerdict = 'pass' | 'warn' | 'correct' | 'block';

export interface ValidatorContext {
  cwd: string;
  task?: string;
  scopeFiles?: string[];
  abortSignal?: AbortSignal;
  llmFn?: (prompt: string) => Promise<string>;
  shellTimeoutMs?: number;
}

export interface ValidatorResult {
  validator: string;
  verdict: ValidatorVerdict;
  message: string;
  details?: Record<string, unknown>;
  remediation?: string;
  durationMs: number;
}

export interface StepValidator {
  name: string;
  appliesTo(event: AcpEvent): boolean;
  validate(event: AcpEvent, ctx: ValidatorContext): Promise<ValidatorResult>;
}

export interface RunValidatorsOptions {
  validators: StepValidator[];
  event: AcpEvent;
  ctx: ValidatorContext;
  parallel?: boolean;
}

export interface RunValidatorsResult {
  verdict: ValidatorVerdict;
  results: ValidatorResult[];
}

export const VERDICT_RANK: Record<ValidatorVerdict, number> = {
  pass: 0,
  warn: 1,
  correct: 2,
  block: 3,
};

export function strongestVerdict(verdicts: ValidatorVerdict[]): ValidatorVerdict {
  if (verdicts.length === 0) return 'pass';
  return verdicts.reduce<ValidatorVerdict>(
    (best, v) => (VERDICT_RANK[v] > VERDICT_RANK[best] ? v : best),
    'pass'
  );
}

export async function runValidators(opts: RunValidatorsOptions): Promise<RunValidatorsResult> {
  const { validators, event, ctx, parallel = true } = opts;
  const applicable = validators.filter((v) => v.appliesTo(event));

  if (applicable.length === 0) {
    return { verdict: 'pass', results: [] };
  }

  if (ctx.abortSignal?.aborted) {
    return {
      verdict: 'block',
      results: [{ validator: 'runValidators', verdict: 'block', message: 'aborted', durationMs: 0 }],
    };
  }

  const runOne = async (v: StepValidator): Promise<ValidatorResult> => {
    const start = Date.now();
    try {
      return await v.validate(event, ctx);
    } catch (err) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return {
        validator: v.name,
        verdict: 'warn',
        message: `validator threw: ${message}`,
        durationMs,
      };
    }
  };

  let results: ValidatorResult[];

  try {
    if (parallel) {
      const allPromise = Promise.all(applicable.map((v) => runOne(v)));
      if (ctx.abortSignal) {
        const abortPromise = new Promise<never>((_, reject) => {
          const handler = () => reject(new Error('aborted'));
          ctx.abortSignal!.addEventListener('abort', handler, { once: true });
          if (ctx.abortSignal!.aborted) handler();
        });
        results = await Promise.race([allPromise, abortPromise]);
      } else {
        results = await allPromise;
      }
    } else {
      results = [];
      for (const v of applicable) {
        if (ctx.abortSignal?.aborted) throw new Error('aborted');
        results.push(await runOne(v));
      }
    }
  } catch (err) {
    if (ctx.abortSignal?.aborted || (err instanceof Error && err.message === 'aborted')) {
      return {
        verdict: 'block',
        results: [{ validator: 'runValidators', verdict: 'block', message: 'aborted', durationMs: 0 }],
      };
    }
    throw err;
  }

  const verdict = strongestVerdict(results.map((r) => r.verdict));
  return { verdict, results };
}

// ── Shell helper ─────────────────────────────────────────────────────────────

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export function runShell(
  cmd: string,
  opts: { cwd?: string; timeoutMs?: number; abortSignal?: AbortSignal } = {}
): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const { cwd = process.cwd(), timeoutMs = 60_000, abortSignal } = opts;

    const proc = spawn(cmd, [], {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Shell command timed out after ${timeoutMs}ms: ${cmd}`));
    }, timeoutMs);

    const abortHandler = () => {
      clearTimeout(timer);
      proc.kill();
      reject(new Error('aborted'));
    };

    abortSignal?.addEventListener('abort', abortHandler, { once: true });

    proc.on('close', (code) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', abortHandler);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        durationMs: Date.now() - start,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', abortHandler);
      reject(err);
    });
  });
}

// ── Path extraction helper ───────────────────────────────────────────────────

export function extractTouchedPaths(event: AcpEvent): string[] {
  const data = event.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') return [];

  const paths: string[] = [];

  if (typeof data['path'] === 'string') paths.push(data['path']);
  if (typeof data['file'] === 'string') paths.push(data['file']);
  if (typeof data['from'] === 'string') paths.push(data['from']);
  if (typeof data['to'] === 'string') paths.push(data['to']);
  if (Array.isArray(data['paths'])) {
    for (const p of data['paths']) {
      if (typeof p === 'string') paths.push(p);
    }
  }
  if (Array.isArray(data['files'])) {
    for (const f of data['files']) {
      if (typeof f === 'string') paths.push(f);
    }
  }

  return paths;
}
