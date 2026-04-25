/**
 * Pyrfor Runtime — Persistent Priority Task Queue
 *
 * Features: concurrency cap, retries with exponential backoff, deduplication,
 * backpressure, optional JSON persistence (atomic tmp+rename), per-task
 * AbortController, injectable clock + timer for deterministic testing.
 *
 * No external dependencies. Node builtins only.
 */
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
type QueueEvent = 'enqueued' | 'started' | 'completed' | 'failed' | 'retry' | 'cancelled' | 'idle';
type EventCallback = (task?: Task) => void;
export declare function createTaskQueue(opts?: TaskQueueOptions): {
    readonly registerHandler: (kind: string, handler: TaskHandler) => void;
    readonly enqueue: (input: {
        kind: string;
        payload?: any;
        priority?: number;
        maxAttempts?: number;
        runAt?: number;
        dedupKey?: string;
    }) => Task;
    readonly get: (id: string) => Task | undefined;
    readonly list: (filter?: {
        state?: TaskState;
        kind?: string;
    }) => Task[];
    readonly cancel: (id: string) => boolean;
    readonly start: () => void;
    readonly stop: () => Promise<void>;
    readonly drain: () => Promise<void>;
    readonly on: (event: QueueEvent, cb: EventCallback) => () => void;
};
export type TaskQueue = ReturnType<typeof createTaskQueue>;
export {};
//# sourceMappingURL=task-queue.d.ts.map