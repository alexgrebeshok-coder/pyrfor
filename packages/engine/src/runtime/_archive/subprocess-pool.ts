/**
 * subprocess-pool.ts — Long-running worker pool with persistent child processes.
 *
 * Workers communicate via line-delimited JSON RPC over stdio:
 *   Pool → worker:  {"id":"…","payload":…}\n
 *   Worker → pool:  {"id":"…","ok":true,"data":…}\n  or
 *                   {"id":"…","ok":false,"error":"…"}\n
 *
 * Fully injectable for deterministic tests (spawnFn, clock, setTimer, clearTimer).
 * No external dependencies — only node:child_process.
 */

import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { spawn as nodeSpawn } from 'node:child_process';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PoolTask {
  id?: string;
  payload: unknown;
  timeoutMs?: number;
}

export interface PoolResult {
  id: string;
  ok: true;
  data: unknown;
  durationMs: number;
  workerId: string;
}

export interface PoolFailure {
  id: string;
  ok: false;
  error: string;
  durationMs: number;
  workerId: string;
}

export interface PoolStats {
  totalSubmitted: number;
  totalCompleted: number;
  totalFailed: number;
  activeWorkers: number;
  idleWorkers: number;
  queueDepth: number;
  perWorker: Record<string, { tasksRun: number; failures: number }>;
}

// ─── Pool factory ─────────────────────────────────────────────────────────────

export function createSubprocessPool(opts: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  minWorkers?: number;
  maxWorkers?: number;
  /** Recycle worker after N completed tasks (default: Infinity). */
  maxTasksPerWorker?: number;
  /** Shut down idle workers above minWorkers after this many ms (default: 30 000). */
  idleTimeoutMs?: number;
  defaultTimeoutMs?: number;
  spawnFn?: typeof nodeSpawn;
  clock?: () => number;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}) {
  const {
    command,
    args = [],
    cwd,
    env,
    minWorkers = 0,
    maxWorkers = 4,
    maxTasksPerWorker = Infinity,
    idleTimeoutMs = 30_000,
    defaultTimeoutMs,
  } = opts;

  // Injected or real implementations
  const doSpawn = (opts.spawnFn ?? nodeSpawn) as (
    cmd: string,
    args: string[],
    opts: SpawnOptions,
  ) => ChildProcess;
  const clock = opts.clock ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer =
    opts.clearTimer ??
    ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  // ─── Internal types ──────────────────────────────────────────────────────────

  interface InFlight {
    id: string;
    resolve: (r: PoolResult | PoolFailure) => void;
    startedAt: number;
    timeoutHandle: unknown;
  }

  interface WorkerState {
    id: string;
    proc: ChildProcess;
    tasksRun: number;
    failures: number;
    inFlight: InFlight | null;
    idleHandle: unknown;
    buf: string;
    dead: boolean;
  }

  interface QueuedTask {
    id: string;
    payload: unknown;
    resolve: (r: PoolResult | PoolFailure) => void;
    timeoutMs?: number;
  }

  // ─── State ───────────────────────────────────────────────────────────────────

  let workerSeq = 0;
  let taskSeq = 0;

  const workers = new Map<string, WorkerState>();
  const queue: QueuedTask[] = [];

  let totalSubmitted = 0;
  let totalCompleted = 0;
  let totalFailed = 0;
  let shuttingDown = false;
  let shutdownDrainedFn: (() => void) | null = null;

  // ─── Worker lifecycle ────────────────────────────────────────────────────────

  function spawnWorker(): WorkerState {
    const wid = `w${++workerSeq}`;
    const spawnOpts: SpawnOptions = {
      cwd,
      env: env as NodeJS.ProcessEnv | undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    };
    const proc = doSpawn(command, args, spawnOpts);

    const worker: WorkerState = {
      id: wid,
      proc,
      tasksRun: 0,
      failures: 0,
      inFlight: null,
      idleHandle: null,
      buf: '',
      dead: false,
    };
    workers.set(wid, worker);

    proc.stdout?.on('data', (chunk: Buffer | string) => {
      worker.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let nl = worker.buf.indexOf('\n');
      while (nl !== -1) {
        const line = worker.buf.slice(0, nl).trim();
        worker.buf = worker.buf.slice(nl + 1);
        if (line) handleWorkerLine(worker, line);
        nl = worker.buf.indexOf('\n');
      }
    });

    proc.on('close', (_code, _signal) => handleWorkerClose(worker));

    startIdleTimer(worker);
    return worker;
  }

  function killWorker(worker: WorkerState, signal: string): void {
    if (worker.dead) return;
    worker.dead = true;
    clearIdleTimer(worker);
    workers.delete(worker.id);
    try {
      worker.proc.kill(signal as NodeJS.Signals);
    } catch {
      // process may already be gone
    }
  }

  function startIdleTimer(worker: WorkerState): void {
    if (shuttingDown || worker.inFlight !== null || idleTimeoutMs <= 0) return;
    clearIdleTimer(worker);
    worker.idleHandle = setTimer(() => {
      if (!worker.dead && worker.inFlight === null && workers.size > minWorkers) {
        killWorker(worker, 'SIGTERM');
        checkShutdownComplete();
      }
    }, idleTimeoutMs);
  }

  function clearIdleTimer(worker: WorkerState): void {
    if (worker.idleHandle !== null) {
      clearTimer(worker.idleHandle);
      worker.idleHandle = null;
    }
  }

  function ensureMinWorkers(): void {
    while (!shuttingDown && workers.size < minWorkers) {
      spawnWorker();
    }
  }

  // ─── Task assignment ─────────────────────────────────────────────────────────

  function assignTask(worker: WorkerState, task: QueuedTask): void {
    clearIdleTimer(worker);

    const startedAt = clock();
    const tms = task.timeoutMs ?? defaultTimeoutMs;
    let timeoutHandle: unknown = null;

    if (tms !== undefined) {
      timeoutHandle = setTimer(() => {
        if (!worker.inFlight || worker.inFlight.id !== task.id) return;
        const durationMs = clock() - startedAt;
        const { resolve } = worker.inFlight;
        worker.inFlight = null;
        totalFailed++;
        worker.failures++;
        resolve({
          id: task.id,
          ok: false,
          error: 'WORKER_TIMEOUT',
          durationMs,
          workerId: worker.id,
        });
        killWorker(worker, 'SIGTERM');
        if (!shuttingDown) {
          spawnWorker();
          drainQueue();
        }
        checkShutdownComplete();
      }, tms);
    }

    worker.inFlight = {
      id: task.id,
      resolve: task.resolve,
      startedAt,
      timeoutHandle,
    };

    const msg = JSON.stringify({ id: task.id, payload: task.payload }) + '\n';
    worker.proc.stdin?.write(msg);
  }

  function drainQueue(): void {
    while (queue.length > 0) {
      const idle = findIdleWorker();
      if (idle) {
        assignTask(idle, queue.shift()!);
      } else if (!shuttingDown && workers.size < maxWorkers) {
        const w = spawnWorker();
        assignTask(w, queue.shift()!);
      } else {
        break;
      }
    }
  }

  function findIdleWorker(): WorkerState | null {
    for (const w of workers.values()) {
      if (!w.dead && w.inFlight === null) return w;
    }
    return null;
  }

  // ─── Message / close handlers ────────────────────────────────────────────────

  function handleWorkerLine(worker: WorkerState, line: string): void {
    let msg: { id: string; ok: boolean; data?: unknown; error?: string };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
    }

    const inFlight = worker.inFlight;
    if (!inFlight || inFlight.id !== msg.id) return;

    if (inFlight.timeoutHandle !== null) clearTimer(inFlight.timeoutHandle);

    const durationMs = clock() - inFlight.startedAt;
    const { resolve } = inFlight;
    worker.inFlight = null;
    worker.tasksRun++;

    if (msg.ok) {
      totalCompleted++;
      resolve({
        id: inFlight.id,
        ok: true,
        data: msg.data ?? null,
        durationMs,
        workerId: worker.id,
      });
    } else {
      totalFailed++;
      worker.failures++;
      resolve({
        id: inFlight.id,
        ok: false,
        error: msg.error ?? 'worker_error',
        durationMs,
        workerId: worker.id,
      });
    }

    if (worker.tasksRun >= maxTasksPerWorker) {
      killWorker(worker, 'SIGTERM');
      if (!shuttingDown) {
        spawnWorker();
        drainQueue();
      }
      checkShutdownComplete();
      return;
    }

    startIdleTimer(worker);
    drainQueue();
    checkShutdownComplete();
  }

  function handleWorkerClose(worker: WorkerState): void {
    if (worker.dead) return; // handled (killed intentionally)
    worker.dead = true;
    clearIdleTimer(worker);
    workers.delete(worker.id);

    const inFlight = worker.inFlight;
    if (inFlight) {
      if (inFlight.timeoutHandle !== null) clearTimer(inFlight.timeoutHandle);
      const durationMs = clock() - inFlight.startedAt;
      worker.inFlight = null;
      totalFailed++;
      worker.failures++;
      inFlight.resolve({
        id: inFlight.id,
        ok: false,
        error: 'WORKER_CRASH',
        durationMs,
        workerId: worker.id,
      });
    }

    if (!shuttingDown) {
      ensureMinWorkers();
      drainQueue();
    }
    checkShutdownComplete();
  }

  // ─── Shutdown helpers ────────────────────────────────────────────────────────

  function checkShutdownComplete(): void {
    if (!shuttingDown || !shutdownDrainedFn) return;
    if (queue.length > 0) return;
    const hasActive = [...workers.values()].some(
      (w) => !w.dead && w.inFlight !== null,
    );
    if (hasActive) return;
    const fn = shutdownDrainedFn;
    shutdownDrainedFn = null;
    fn();
  }

  // ─── Initialise min workers ───────────────────────────────────────────────────

  ensureMinWorkers();

  // ─── Public API ──────────────────────────────────────────────────────────────

  function submit(task: PoolTask): Promise<PoolResult | PoolFailure> {
    return new Promise<PoolResult | PoolFailure>((resolve) => {
      if (shuttingDown) {
        const id = task.id ?? `t${++taskSeq}`;
        resolve({ id, ok: false, error: 'POOL_SHUTDOWN', durationMs: 0, workerId: '' });
        return;
      }

      totalSubmitted++;
      const id = task.id ?? `t${++taskSeq}`;
      const qt: QueuedTask = {
        id,
        payload: task.payload,
        resolve,
        timeoutMs: task.timeoutMs,
      };

      const idle = findIdleWorker();
      if (idle) {
        assignTask(idle, qt);
      } else if (workers.size < maxWorkers) {
        assignTask(spawnWorker(), qt);
      } else {
        queue.push(qt);
      }
    });
  }

  function shutdown(shutdownOpts?: { graceMs?: number }): Promise<void> {
    const graceMs = shutdownOpts?.graceMs ?? 5_000;
    shuttingDown = true;

    return new Promise<void>((resolve) => {
      const terminateAll = () => {
        const all = [...workers.values()];
        if (all.length === 0) {
          resolve();
          return;
        }

        let remaining = all.length;
        const exited = new Set<string>();

        const graceTimer = setTimer(() => {
          for (const w of all) {
            if (!exited.has(w.id)) {
              try {
                w.proc.kill('SIGKILL');
              } catch {
                /* already gone */
              }
            }
          }
        }, graceMs);

        for (const w of all) {
          w.proc.once('close', () => {
            if (exited.has(w.id)) return;
            exited.add(w.id);
            remaining--;
            if (remaining === 0) {
              clearTimer(graceTimer);
              resolve();
            }
          });
          killWorker(w, 'SIGTERM');
        }
      };

      if (workers.size === 0 && queue.length === 0) {
        resolve();
        return;
      }

      shutdownDrainedFn = terminateAll;
      checkShutdownComplete();
    });
  }

  function getStats(): PoolStats {
    const perWorker: Record<string, { tasksRun: number; failures: number }> = {};
    let activeWorkers = 0;
    let idleWorkers = 0;

    for (const w of workers.values()) {
      if (w.dead) continue;
      perWorker[w.id] = { tasksRun: w.tasksRun, failures: w.failures };
      if (w.inFlight !== null) {
        activeWorkers++;
      } else {
        idleWorkers++;
      }
    }

    return {
      totalSubmitted,
      totalCompleted,
      totalFailed,
      activeWorkers,
      idleWorkers,
      queueDepth: queue.length,
      perWorker,
    };
  }

  return { submit, shutdown, getStats };
}
