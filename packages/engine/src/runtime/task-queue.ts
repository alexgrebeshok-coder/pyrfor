/**
 * Pyrfor Runtime — Persistent Priority Task Queue
 *
 * Features: concurrency cap, retries with exponential backoff, deduplication,
 * backpressure, optional JSON persistence (atomic tmp+rename), per-task
 * AbortController, injectable clock + timer for deterministic testing.
 *
 * No external dependencies. Node builtins only.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type Task = {
  id: string;
  kind: string;
  payload: any;
  priority: number;
  attempts: number;
  maxAttempts: number;
  state: TaskState;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  lastError?: string;
  runAt?: number;
  dedupKey?: string;
};

export type TaskHandler = (task: Task, signal: AbortSignal) => Promise<any>;

// ─── Queue Options ────────────────────────────────────────────────────────────

export interface TaskQueueOptions {
  /** JSON file path for persistence. Omit for in-memory only. */
  storePath?: string;
  /** Max simultaneous running tasks. Default: 2. */
  concurrency?: number;
  /** Timestamp source. Default: Date.now. */
  clock?: () => number;
  /** Debounce window for flush. Default: 500 ms. */
  flushDebounceMs?: number;
  /** Log sink. */
  logger?: (msg: string, meta?: any) => void;
  /** Timer factory. Default: setTimeout. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  /** Timer canceller. Default: clearTimeout. */
  clearTimer?: (h: unknown) => void;
}

// ─── Event Types ──────────────────────────────────────────────────────────────

type QueueEvent = 'enqueued' | 'started' | 'completed' | 'failed' | 'retry' | 'cancelled' | 'idle';
type EventCallback = (task?: Task) => void;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FINISHED: ReadonlySet<TaskState> = new Set<TaskState>(['done', 'failed', 'cancelled']);

function genId(): string {
  return randomBytes(8).toString('hex');
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createTaskQueue(opts: TaskQueueOptions = {}) {
  const concurrency = opts.concurrency ?? 2;
  const clock = opts.clock ?? (() => Date.now());
  const flushDebounceMs = opts.flushDebounceMs ?? 500;
  const setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const log = opts.logger ?? (() => {});

  // ── State ──────────────────────────────────────────────────────────────────
  const tasks = new Map<string, Task>();
  const handlers = new Map<string, TaskHandler>();
  const controllers = new Map<string, AbortController>();
  const listeners = new Map<QueueEvent, Set<EventCallback>>();

  let running = 0;
  let started = false;
  let stopping = false;

  let flushTimer: unknown = null;
  let futureTickTimer: unknown = null;

  const drainResolvers: Array<() => void> = [];
  const stopResolvers: Array<() => void> = [];

  // ── Persistence ────────────────────────────────────────────────────────────

  function loadFromDisk(): void {
    if (!opts.storePath || !existsSync(opts.storePath)) return;
    try {
      const raw = readFileSync(opts.storePath, 'utf8');
      const data = JSON.parse(raw) as Task[];
      if (!Array.isArray(data)) throw new Error('expected array');
      for (const t of data) tasks.set(t.id, t);
    } catch (e) {
      log('task-queue: corrupt store, starting empty', { error: e });
    }
  }

  function scheduleFlush(): void {
    if (!opts.storePath) return;
    if (flushTimer !== null) clearTimer(flushTimer);
    flushTimer = setTimer(() => {
      flushTimer = null;
      flushToDisk();
    }, flushDebounceMs);
  }

  function flushToDisk(): void {
    if (!opts.storePath) return;
    try {
      mkdirSync(dirname(opts.storePath), { recursive: true });
      const tmp = opts.storePath + '.tmp';
      writeFileSync(tmp, JSON.stringify([...tasks.values()], null, 2), 'utf8');
      renameSync(tmp, opts.storePath);
    } catch (e) {
      log('task-queue: flush failed', { error: e });
    }
  }

  function immediateFlush(): void {
    if (!opts.storePath) return;
    if (flushTimer !== null) {
      clearTimer(flushTimer);
      flushTimer = null;
    }
    flushToDisk();
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  function emit(event: QueueEvent, task?: Task): void {
    const cbs = listeners.get(event);
    if (cbs) for (const cb of [...cbs]) cb(task);
  }

  // ── Drain / Stop resolution ────────────────────────────────────────────────

  function checkDrain(): void {
    if (drainResolvers.length === 0) return;
    if (running > 0) return;
    const hasQueued = [...tasks.values()].some((t) => t.state === 'queued');
    if (!hasQueued) {
      const resolvers = drainResolvers.splice(0);
      for (const r of resolvers) r();
    }
  }

  function checkStop(): void {
    if (stopResolvers.length === 0) return;
    if (running === 0) {
      started = false;
      immediateFlush();
      const resolvers = stopResolvers.splice(0);
      for (const r of resolvers) r();
    }
  }

  function checkIdle(): void {
    if (!started || stopping) return;
    if (running > 0) return;
    const hasActive = [...tasks.values()].some(
      (t) => t.state === 'queued' || t.state === 'running',
    );
    if (!hasActive) emit('idle');
  }

  // ── Scheduling ─────────────────────────────────────────────────────────────

  function pickNext(): Task | undefined {
    const now = clock();
    let best: Task | undefined;
    for (const t of tasks.values()) {
      if (t.state !== 'queued') continue;
      if ((t.runAt ?? 0) > now) continue;
      if (!best) {
        best = t;
        continue;
      }
      if (t.priority > best.priority) {
        best = t;
        continue;
      }
      if (t.priority === best.priority && t.createdAt < best.createdAt) best = t;
    }
    return best;
  }

  function scheduleFutureTick(): void {
    const now = clock();
    let minRunAt = Infinity;
    for (const t of tasks.values()) {
      if (t.state === 'queued' && t.runAt !== undefined && t.runAt > now) {
        minRunAt = Math.min(minRunAt, t.runAt);
      }
    }
    if (minRunAt < Infinity) {
      if (futureTickTimer !== null) clearTimer(futureTickTimer);
      futureTickTimer = setTimer(() => {
        futureTickTimer = null;
        tick();
      }, minRunAt - now);
    }
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  function tick(): void {
    if (!started || stopping) return;
    while (running < concurrency) {
      const task = pickNext();
      if (!task) break;
      execute(task);
    }
    scheduleFutureTick();
    checkIdle();
  }

  function execute(task: Task): void {
    const handler = handlers.get(task.kind);
    if (!handler) {
      task.state = 'failed';
      task.finishedAt = clock();
      task.lastError = `No handler registered for kind: ${task.kind}`;
      emit('failed', task);
      scheduleFlush();
      checkDrain();
      checkStop();
      return;
    }

    const ac = new AbortController();
    controllers.set(task.id, ac);

    task.state = 'running';
    task.startedAt = clock();
    task.attempts += 1;
    running++;

    emit('started', task);
    scheduleFlush();

    handler({ ...task }, ac.signal)
      .then(() => {
        controllers.delete(task.id);
        running--;

        if (task.state !== 'cancelled') {
          task.state = 'done';
          task.finishedAt = clock();
          emit('completed', task);
        }

        scheduleFlush();
        checkDrain();
        checkStop();
        tick();
      })
      .catch((err: unknown) => {
        controllers.delete(task.id);
        running--;

        if (task.state === 'cancelled') {
          scheduleFlush();
          checkDrain();
          checkStop();
          tick();
          return;
        }

        const errMsg = err instanceof Error ? err.message : String(err);
        task.lastError = errMsg;

        if (task.attempts < task.maxAttempts) {
          const delay = Math.min(Math.pow(2, task.attempts) * 1000, 60_000);
          task.state = 'queued';
          task.runAt = clock() + delay;
          emit('retry', task);
          scheduleFlush();
          // Schedule a tick once the delay expires
          setTimer(() => tick(), delay);
        } else {
          task.state = 'failed';
          task.finishedAt = clock();
          emit('failed', task);
          scheduleFlush();
          checkDrain();
          checkStop();
        }

        tick();
      });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function registerHandler(kind: string, handler: TaskHandler): void {
    handlers.set(kind, handler);
  }

  function enqueue(input: {
    kind: string;
    payload?: any;
    priority?: number;
    maxAttempts?: number;
    runAt?: number;
    dedupKey?: string;
  }): Task {
    if (input.dedupKey) {
      for (const t of tasks.values()) {
        if (t.dedupKey === input.dedupKey && !FINISHED.has(t.state)) return t;
      }
    }

    const task: Task = {
      id: genId(),
      kind: input.kind,
      payload: input.payload ?? null,
      priority: input.priority ?? 0,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      state: 'queued',
      createdAt: clock(),
      runAt: input.runAt,
      dedupKey: input.dedupKey,
    };

    tasks.set(task.id, task);
    emit('enqueued', task);
    scheduleFlush();

    if (started && !stopping) tick();

    return task;
  }

  function get(id: string): Task | undefined {
    return tasks.get(id);
  }

  function list(filter?: { state?: TaskState; kind?: string }): Task[] {
    let result = [...tasks.values()];
    if (filter?.state) result = result.filter((t) => t.state === filter.state);
    if (filter?.kind) result = result.filter((t) => t.kind === filter.kind);
    return result;
  }

  function cancel(id: string): boolean {
    const task = tasks.get(id);
    if (!task) return false;

    if (task.state === 'queued') {
      task.state = 'cancelled';
      task.finishedAt = clock();
      emit('cancelled', task);
      scheduleFlush();
      checkDrain();
      tick();
      return true;
    }

    if (task.state === 'running') {
      const ac = controllers.get(id);
      if (ac) ac.abort();
      task.state = 'cancelled';
      task.finishedAt = clock();
      emit('cancelled', task);
      scheduleFlush();
      // drain/stop resolved when the handler promise settles (decrement running)
      return true;
    }

    return false;
  }

  function start(): void {
    loadFromDisk();
    // Reset any in-flight tasks left over from a previous run
    for (const t of tasks.values()) {
      if (t.state === 'running') {
        t.state = 'queued';
        t.startedAt = undefined;
      }
    }
    started = true;
    stopping = false;
    tick();
  }

  async function stop(): Promise<void> {
    stopping = true;
    for (const ac of controllers.values()) ac.abort();

    if (running === 0) {
      started = false;
      immediateFlush();
      return;
    }

    return new Promise<void>((resolve) => {
      stopResolvers.push(resolve);
    });
  }

  async function drain(): Promise<void> {
    if (running === 0) {
      const hasQueued = [...tasks.values()].some((t) => t.state === 'queued');
      if (!hasQueued) return;
    }
    return new Promise<void>((resolve) => {
      drainResolvers.push(resolve);
    });
  }

  function on(event: QueueEvent, cb: EventCallback): () => void {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
    return () => listeners.get(event)?.delete(cb);
  }

  return { registerHandler, enqueue, get, list, cancel, start, stop, drain, on } as const;
}

export type TaskQueue = ReturnType<typeof createTaskQueue>;
