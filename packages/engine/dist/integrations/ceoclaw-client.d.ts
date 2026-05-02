/**
 * ceoclaw-client.ts — Pyrfor-side HTTP integration client for CEOClaw.
 *
 * Pushes run events (heartbeats) to CEOClaw and pulls tasks/goals from it.
 * Subscribes to the engine's EventLedger so every meaningful run.* event
 * becomes a heartbeat ping sent to CEOClaw.
 *
 * Ledger read API used: EventLedger.readAll() — no watch/tail API exists;
 * the client polls every `flushEveryMs` ms (default 2 000 ms) and tracks the
 * last seen `seq` so already-processed events are never resent.
 *
 * Sprint 3 #1 + #7 of UNIFIED_PLAN_FINAL.md.
 */
import type { EventLedger, LedgerEvent } from '../runtime/event-ledger';
export interface CeoclawClientOptions {
    /** Root URL of the CEOClaw server, e.g. 'https://ceoclaw.example.com'. */
    baseUrl: string;
    /** Sent as `Authorization: Bearer <apiKey>` when present. */
    apiKey?: string;
    /** Pyrfor workspace identifier forwarded in every heartbeat. */
    workspaceId: string;
    /** Per-request timeout in milliseconds. Default: 8 000. */
    timeoutMs?: number;
    /** Retry policy. Default: { attempts: 2, backoffMs: 250 }. */
    retry?: {
        attempts?: number;
        backoffMs?: number;
    };
    /** Injectable fetch implementation — used by tests to avoid real network. */
    fetchImpl?: typeof fetch;
    /** Injectable clock — used by tests to control latency measurement. */
    clock?: () => number;
}
export interface CeoclawTask {
    id: string;
    title: string;
    description?: string;
    status: 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
    goalId?: string;
    assigneeId?: string;
    dueAt?: string;
    metadata?: Record<string, unknown>;
}
export interface CeoclawHeartbeat {
    runId: string;
    taskId?: string;
    workspaceId: string;
    status: 'started' | 'progress' | 'blocked' | 'completed' | 'failed' | 'cancelled';
    summary?: string;
    /** 0..1 */
    progress?: number;
    artifactCount?: number;
    /** ISO-8601 timestamp of when the underlying event occurred. */
    occurredAt: string;
    metadata?: Record<string, unknown>;
}
export interface CeoclawGoal {
    id: string;
    title: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    status: 'planned' | 'active' | 'paused' | 'done' | 'cancelled';
    metadata?: Record<string, unknown>;
}
/**
 * Build standard request headers, optionally including a Bearer token.
 */
export declare function buildHeaders(apiKey?: string): Record<string, string>;
/**
 * Wraps a non-2xx HTTP response so callers can inspect the status code.
 */
export declare class HttpError extends Error {
    readonly status: number;
    readonly statusText: string;
    readonly body?: string | undefined;
    constructor(status: number, statusText: string, body?: string | undefined);
}
/**
 * Thrown when the per-request AbortController fires due to timeoutMs expiry.
 * Distinct from a user-initiated AbortError so the retry loop can treat it as
 * a transient failure rather than a cancellation.
 */
export declare class TimeoutError extends Error {
    constructor(ms: number);
}
/**
 * Classify an error thrown by fetch (or our helpers) into one of three
 * categories that drive the retry/bail decision.
 *
 *   'cancelled'  — user-initiated abort; never retry
 *   'transient'  — timeout / network error / 5xx; safe to retry
 *   'permanent'  — 4xx (client error); retrying will not help
 */
export declare function classifyHttpError(e: unknown): 'transient' | 'permanent' | 'cancelled';
/**
 * Default strategy for converting a LedgerEvent into a CeoclawHeartbeat.
 * Returns null for event types that should not produce a heartbeat.
 *
 * Covered mappings:
 *   run.created            → started
 *   run.completed          → completed  (progress: 1)
 *   run.failed             → failed
 *   run.cancelled          → cancelled
 *   run.blocked            → blocked
 *   approval.requested /
 *   approval.granted   /
 *   approval.denied        → progress
 *   tool.executed          → progress
 *   everything else        → null
 */
export declare function defaultLedgerMapping(event: LedgerEvent, ctx: {
    workspaceId: string;
}): CeoclawHeartbeat | null;
/**
 * HTTP client for the CEOClaw integration API.
 *
 * All network methods retry on transient (5xx / timeout / network) errors
 * up to `retry.attempts` times with linear back-off.
 */
export declare class CeoclawClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly workspaceId;
    private readonly timeoutMs;
    private readonly retry;
    private readonly fetchImpl;
    private readonly clockFn;
    private readonly _stats;
    constructor(opts: CeoclawClientOptions);
    private get fetch();
    /**
     * Execute a single fetch call guarded by an AbortController-based timeout.
     * On timeout, throws TimeoutError (which classifyHttpError maps to 'transient').
     */
    private _fetchOnce;
    /**
     * Execute a request with automatic retry on transient errors.
     * Returns the Response on 2xx; throws HttpError on non-2xx (after retries).
     */
    private _request;
    /** Build an absolute URL with optional query parameters. */
    private buildUrl;
    /** Ping the CEOClaw health endpoint. Measures round-trip latency. */
    health(): Promise<{
        ok: boolean;
        version?: string;
        latencyMs: number;
    }>;
    /** List tasks, optionally filtered by status / goal / assignee. */
    listTasks(filter?: {
        status?: CeoclawTask['status'];
        goalId?: string;
        assigneeId?: string;
        limit?: number;
    }): Promise<CeoclawTask[]>;
    /** Fetch a single task by ID; returns null if the server responds 404. */
    getTask(id: string): Promise<CeoclawTask | null>;
    /**
     * Create-or-update a task. The server performs an upsert keyed on `task.id`
     * when present, or creates a new task when `id` is absent.
     */
    upsertTask(task: Partial<CeoclawTask> & {
        id?: string;
    }): Promise<CeoclawTask>;
    /**
     * Delete a task by ID.
     * Returns true if the server deleted it (2xx), false if it was not found (404).
     */
    deleteTask(id: string): Promise<boolean>;
    /** List goals, optionally filtered by status. */
    listGoals(filter?: {
        status?: CeoclawGoal['status'];
        limit?: number;
    }): Promise<CeoclawGoal[]>;
    /** Send a single heartbeat event. */
    sendHeartbeat(hb: CeoclawHeartbeat): Promise<{
        accepted: boolean;
        serverId?: string;
    }>;
    /**
     * Send a batch of heartbeat events in one HTTP call.
     * Returns server-confirmed accepted / rejected counts.
     */
    sendBatch(hbs: CeoclawHeartbeat[]): Promise<{
        accepted: number;
        rejected: number;
    }>;
    /**
     * Subscribe to an EventLedger, polling for new events and forwarding them
     * to CEOClaw as batched heartbeats.
     *
     * Implementation notes:
     *   - Uses EventLedger.readAll() (no server-push / watch API available).
     *   - Tracks the last processed `seq` to skip already-sent events.
     *   - Failed batches are kept in a bounded in-memory queue (max 1 000 items)
     *     and retried on the next poll cycle.
     *   - Returns a disposer (() => void / Promise<void>) that stops the interval
     *     and performs a final flush.
     *
     * @param ledger    The EventLedger instance to subscribe to.
     * @param opts.mapping       Custom event→heartbeat mapper (default: defaultLedgerMapping).
     * @param opts.flushEveryMs  Poll interval in ms (default: 2 000).
     * @param opts.maxBatch      Maximum heartbeats per sendBatch call (default: 50).
     */
    subscribeLedger(ledger: EventLedger, opts?: {
        mapping?: (event: LedgerEvent) => CeoclawHeartbeat | null;
        flushEveryMs?: number;
        maxBatch?: number;
    }): () => void;
    /** Return a snapshot of cumulative send statistics. */
    getStats(): {
        sent: number;
        failed: number;
        queued: number;
        lastError?: string;
    };
}
//# sourceMappingURL=ceoclaw-client.d.ts.map