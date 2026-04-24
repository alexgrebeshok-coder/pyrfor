import { spawn } from 'child_process';

export interface VerifyCheck {
  name: string;
  command: string;
  weight: number;
  successPattern?: RegExp;
  timeoutMs?: number;
}

export interface VerifyCheckResult {
  name: string;
  passed: boolean;
  score: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

export interface VerifyResult {
  total: number;
  threshold: number;
  passed: boolean;
  checks: VerifyCheckResult[];
  ts: number;
}

export interface VerifyEngineOptions {
  cwd?: string;
  env?: Record<string, string>;
  threshold?: number;
  abortSignal?: AbortSignal;
  truncateOutputBytes?: number;
}

function tailBuffer(buf: Buffer, max: number): Buffer {
  if (buf.length <= max) return buf;
  return buf.subarray(buf.length - max);
}

function runCheck(
  check: VerifyCheck,
  opts: VerifyEngineOptions
): Promise<VerifyCheckResult> {
  const truncateBytes = opts.truncateOutputBytes ?? 4000;
  const timeoutMs = check.timeoutMs ?? 60000;
  const start = Date.now();

  return new Promise<VerifyCheckResult>((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };
    const proc = spawn('bash', ['-lc', check.command], {
      cwd: opts.cwd,
      env,
    });

    let stdoutBuf: Buffer = Buffer.alloc(0);
    let stderrBuf: Buffer = Buffer.alloc(0);
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const onStdout = (chunk: Buffer): void => {
      stdoutBuf = tailBuffer(Buffer.concat([stdoutBuf, chunk]), truncateBytes);
    };
    const onStderr = (chunk: Buffer): void => {
      stderrBuf = tailBuffer(Buffer.concat([stderrBuf, chunk]), truncateBytes);
    };
    proc.stdout.on('data', onStdout);
    proc.stderr.on('data', onStderr);

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
      // Force kill after a short grace period
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 200);
    }, timeoutMs);

    const onAbort = (): void => {
      aborted = true;
      try {
        proc.kill('SIGTERM');
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 200);
    };

    if (opts.abortSignal) {
      if (opts.abortSignal.aborted) {
        onAbort();
      } else {
        opts.abortSignal.addEventListener('abort', onAbort, { once: true });
      }
    }

    proc.on('error', (_err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts.abortSignal) opts.abortSignal.removeEventListener('abort', onAbort);
      const stdout = stdoutBuf.toString('utf8');
      const stderr = stderrBuf.toString('utf8');
      resolve({
        name: check.name,
        passed: false,
        score: 0,
        stdout,
        stderr,
        exitCode: null,
        durationMs: Date.now() - start,
      });
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts.abortSignal) opts.abortSignal.removeEventListener('abort', onAbort);
      const stdout = stdoutBuf.toString('utf8');
      const stderr = stderrBuf.toString('utf8');
      const exitCode = timedOut || aborted ? null : code;
      let passed = !timedOut && !aborted && exitCode === 0;
      if (passed && check.successPattern) {
        passed = check.successPattern.test(stdout);
      }
      resolve({
        name: check.name,
        passed,
        score: passed ? check.weight : 0,
        stdout,
        stderr,
        exitCode,
        durationMs: Date.now() - start,
      });
    });
  });
}

export async function runVerify(
  checks: VerifyCheck[],
  opts: VerifyEngineOptions = {}
): Promise<VerifyResult> {
  const threshold = opts.threshold ?? 80;

  if (checks.length === 0) {
    return {
      total: 100,
      threshold,
      passed: 100 >= threshold,
      checks: [],
      ts: Date.now(),
    };
  }

  const results: VerifyCheckResult[] = [];
  for (const check of checks) {
    if (opts.abortSignal?.aborted) {
      results.push({
        name: check.name,
        passed: false,
        score: 0,
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: 0,
      });
      continue;
    }
    const r = await runCheck(check, opts);
    results.push(r);
  }

  const total = results.reduce((s, r) => s + r.score, 0);
  return {
    total,
    threshold,
    passed: total >= threshold,
    checks: results,
    ts: Date.now(),
  };
}
