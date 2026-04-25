// ─── Types ────────────────────────────────────────────────────────────────────

/** Standard comparison: negative if a < b, zero if equal, positive if a > b. */
export type Comparator<T> = (a: T, b: T) => number;

export interface PriorityQueueOptions<T> {
  /**
   * Custom comparator.  comparator(a, b) < 0 places `a` closer to the root
   * (higher priority).  When omitted the natural `<`/`>` ordering is used.
   */
  comparator?: Comparator<T>;
  /** Ordering mode when no custom comparator is provided. Defaults to `'min'`. */
  mode?: 'min' | 'max';
}

export interface PriorityQueue<T> {
  push(item: T): void;
  pop(): T | undefined;
  peek(): T | undefined;
  readonly size: number;
  clear(): void;
  /** Returns items in internal heap order (not sorted). */
  toArray(): T[];
  pushAll(items: T[]): void;
  popMany(n: number): T[];
  /** Find the first item where comparator(x, item) === 0 and replace it, then re-heapify. */
  update(item: T, newItem: T): boolean;
  /** Remove the first item where comparator(x, item) === 0. */
  remove(item: T): boolean;
}

export interface ScheduledHandle {
  id: string;
  cancel(): void;
}

export interface DelayedQueueOptions<T> {
  /** Returns current time in ms. Defaults to `Date.now`. */
  clock?: () => number;
  /** Schedule a callback to fire after `ms` ms. Defaults to `setTimeout`. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Cancel a timer returned by `setTimer`. Defaults to `clearTimeout`. */
  clearTimer?: (id: unknown) => void;
}

export interface DelayedQueue<T> {
  schedule(item: T, timing: number | { delayMs: number }): ScheduledHandle;
  onReady(handler: (items: T[]) => void): void;
  pending(): Array<{ id: string; item: T; runAtMs: number }>;
  count(): number;
  nextRunAt(): number | undefined;
  clear(): void;
}

export interface WorkSchedulerOptions<T> {
  /** Maximum parallel work items. Defaults to `4`. */
  concurrency?: number;
  /** comparator(a, b) < 0 means `a` has higher priority. */
  comparator?: Comparator<T>;
  /** Called when a work function rejects. */
  onError?: (err: unknown, item: T) => void;
}

export interface WorkScheduler<T> {
  submit<R>(item: T, workFn: (item: T) => Promise<R>): Promise<R>;
  pause(): void;
  resume(): void;
  stats(): { inFlight: number; queued: number; completed: number; failed: number };
}

// ─── PriorityQueue ────────────────────────────────────────────────────────────

export function createPriorityQueue<T>(
  options: PriorityQueueOptions<T> = {},
): PriorityQueue<T> {
  const { mode = 'min' } = options;
  const naturalCmp: Comparator<T> = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const baseCmp = options.comparator ?? naturalCmp;
  // When a custom comparator is supplied it already encodes direction.
  // When using the default, flip sign for max-mode.
  const cmp: Comparator<T> =
    options.comparator ? baseCmp : mode === 'min' ? baseCmp : (a, b) => -baseCmp(a, b);

  const h: T[] = [];

  const swap = (i: number, j: number): void => {
    const tmp = h[i] as T;
    h[i] = h[j] as T;
    h[j] = tmp;
  };

  /** Bubble item at `i` toward the root; returns its final index. */
  const siftUp = (i: number): number => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (cmp(h[i] as T, h[p] as T) < 0) {
        swap(i, p);
        i = p;
      } else {
        break;
      }
    }
    return i;
  };

  /** Push item at `i` toward the leaves. */
  const siftDown = (i: number): void => {
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let best = i;
      if (l < h.length && cmp(h[l] as T, h[best] as T) < 0) best = l;
      if (r < h.length && cmp(h[r] as T, h[best] as T) < 0) best = r;
      if (best === i) break;
      swap(i, best);
      i = best;
    }
  };

  const q: PriorityQueue<T> = {
    push(item: T): void {
      h.push(item);
      siftUp(h.length - 1);
    },

    pop(): T | undefined {
      if (!h.length) return undefined;
      const top = h[0] as T;
      const last = h.pop() as T;
      if (h.length) {
        h[0] = last;
        siftDown(0);
      }
      return top;
    },

    peek(): T | undefined {
      return h[0];
    },

    get size(): number {
      return h.length;
    },

    clear(): void {
      h.length = 0;
    },

    toArray(): T[] {
      return [...h];
    },

    pushAll(items: T[]): void {
      for (const item of items) q.push(item);
    },

    popMany(n: number): T[] {
      const out: T[] = [];
      for (let i = 0; i < n && h.length; i++) out.push(q.pop() as T);
      return out;
    },

    update(item: T, newItem: T): boolean {
      const i = h.findIndex((x) => cmp(x, item) === 0);
      if (i === -1) return false;
      h[i] = newItem;
      siftDown(siftUp(i));
      return true;
    },

    remove(item: T): boolean {
      const i = h.findIndex((x) => cmp(x, item) === 0);
      if (i === -1) return false;
      const last = h.pop() as T;
      if (i < h.length) {
        h[i] = last;
        siftDown(siftUp(i));
      }
      return true;
    },
  };

  return q;
}

// ─── DelayedQueue ─────────────────────────────────────────────────────────────

interface DelayEntry<T> {
  id: string;
  item: T;
  runAtMs: number;
}

let _dqSeq = 0;

export function createDelayedQueue<T>(
  opts: DelayedQueueOptions<T> = {},
): DelayedQueue<T> {
  const clockFn = opts.clock ?? (() => Date.now());
  const setFn =
    opts.setTimer ??
    ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clrFn =
    opts.clearTimer ??
    ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));

  const pq = createPriorityQueue<DelayEntry<T>>({
    comparator: (a, b) => a.runAtMs - b.runAtMs,
  });
  const cancelled = new Set<string>();
  let handler: ((items: T[]) => void) | undefined;
  let tid: unknown;

  /** Pop and discard cancelled entries that sit at the front of the queue. */
  const drainCancelled = (): void => {
    while (pq.size) {
      const top = pq.peek() as DelayEntry<T>;
      if (cancelled.has(top.id)) {
        pq.pop();
        cancelled.delete(top.id);
      } else {
        break;
      }
    }
  };

  /** (Re-)arm a single timer for the next due item. */
  const arm = (): void => {
    if (tid !== undefined) {
      clrFn(tid);
      tid = undefined;
    }
    drainCancelled();
    if (!pq.size) return;
    const next = pq.peek() as DelayEntry<T>;
    tid = setFn(() => {
      tid = undefined;
      const now = clockFn();
      const due: T[] = [];
      while (pq.size) {
        const top = pq.peek() as DelayEntry<T>;
        if (top.runAtMs > now) break;
        pq.pop();
        if (cancelled.has(top.id)) {
          cancelled.delete(top.id);
        } else {
          due.push(top.item);
        }
      }
      if (due.length && handler) handler(due);
      arm();
    }, Math.max(0, next.runAtMs - clockFn()));
  };

  return {
    schedule(item: T, timing: number | { delayMs: number }): ScheduledHandle {
      const runAtMs =
        typeof timing === 'number' ? timing : clockFn() + timing.delayMs;
      const id = `dq${++_dqSeq}`;
      pq.push({ id, item, runAtMs });
      arm();
      return {
        id,
        cancel: () => {
          cancelled.add(id);
          arm();
        },
      };
    },

    onReady(h: (items: T[]) => void): void {
      handler = h;
    },

    pending(): Array<{ id: string; item: T; runAtMs: number }> {
      return pq
        .toArray()
        .filter((e) => !cancelled.has(e.id))
        .map((e) => ({ id: e.id, item: e.item, runAtMs: e.runAtMs }));
    },

    count(): number {
      return pq.toArray().filter((e) => !cancelled.has(e.id)).length;
    },

    nextRunAt(): number | undefined {
      const ts = pq
        .toArray()
        .filter((e) => !cancelled.has(e.id))
        .map((e) => e.runAtMs);
      return ts.length ? Math.min(...ts) : undefined;
    },

    clear(): void {
      if (tid !== undefined) {
        clrFn(tid);
        tid = undefined;
      }
      pq.clear();
      cancelled.clear();
    },
  };
}

// ─── WorkScheduler ────────────────────────────────────────────────────────────

interface WorkEntry<T> {
  item: T;
  // R is erased here so a single typed queue can hold mixed-R entries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workFn: (i: T) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (v: any) => void;
  reject: (e: unknown) => void;
}

export function createWorkScheduler<T>(
  opts: WorkSchedulerOptions<T> = {},
): WorkScheduler<T> {
  const { concurrency = 4, onError } = opts;
  const itemCmp = opts.comparator;
  const pq = createPriorityQueue<WorkEntry<T>>(
    itemCmp ? { comparator: (a, b) => itemCmp(a.item, b.item) } : {},
  );

  let inFlight = 0;
  let completed = 0;
  let failed = 0;
  let paused = false;

  const run = (): void => {
    while (!paused && inFlight < concurrency && pq.size) {
      const w = pq.pop() as WorkEntry<T>;
      inFlight++;
      w.workFn(w.item).then(
        (v: unknown) => {
          inFlight--;
          completed++;
          w.resolve(v);
          run();
        },
        (e: unknown) => {
          inFlight--;
          failed++;
          w.reject(e);
          if (onError) {
            try {
              onError(e, w.item);
            } catch (_) {
              // swallow errors thrown by the user-supplied error handler
            }
          }
          run();
        },
      );
    }
  };

  return {
    submit<R>(item: T, workFn: (item: T) => Promise<R>): Promise<R> {
      return new Promise<R>((resolve, reject) => {
        pq.push({ item, workFn, resolve, reject });
        run();
      });
    },

    pause(): void {
      paused = true;
    },

    resume(): void {
      paused = false;
      run();
    },

    stats(): { inFlight: number; queued: number; completed: number; failed: number } {
      return { inFlight, queued: pq.size, completed, failed };
    },
  };
}
