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
import logger from '../observability/logger';

// ====== Interfaces ===========================================================

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
  retry?: { attempts?: number; backoffMs?: number };
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

// ====== Pure helpers =========================================================

/**
 * Build standard request headers, optionally including a Bearer token.
 */
export function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

// ====== Error types ==========================================================

/**
 * Wraps a non-2xx HTTP response so callers can inspect the status code.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: string,
  ) {
    super(`HTTP ${status} ${statusText}`);
    this.name = 'HttpError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the per-request AbortController fires due to timeoutMs expiry.
 * Distinct from a user-initiated AbortError so the retry loop can treat it as
 * a transient failure rather than a cancellation.
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms} ms`);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Classify an error thrown by fetch (or our helpers) into one of three
 * categories that drive the retry/bail decision.
 *
 *   'cancelled'  — user-initiated abort; never retry
 *   'transient'  — timeout / network error / 5xx; safe to retry
 *   'permanent'  — 4xx (client error); retrying will not help
 */
export function classifyHttpError(e: unknown): 'transient' | 'permanent' | 'cancelled' {
  if (e instanceof Error) {
    // User-initiated abort (not our internal timeout).
    if (e.name === 'AbortError') return 'cancelled';
    // Our internal timeout wrapper.
    if (e.name === 'TimeoutError') return 'transient';
    // Raw network failures from undici / node-fetch / native fetch.
    const msg = e.message.toLowerCase();
    if (
      msg.includes('fetch failed') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('network error') ||
      msg.includes('failed to fetch')
    ) {
      return 'transient';
    }
    // HTTP-level errors: 5xx → transient, 4xx → permanent.
    if (e instanceof HttpError) {
      return e.status >= 500 ? 'transient' : 'permanent';
    }
  }
  return 'transient';
}

// ====== Ledger mapping =======================================================

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
export function defaultLedgerMapping(
  event: LedgerEvent,
  ctx: { workspaceId: string },
): CeoclawHeartbeat | null {
  const base: Pick<CeoclawHeartbeat, 'runId' | 'workspaceId' | 'occurredAt'> = {
    runId: event.run_id,
    workspaceId: ctx.workspaceId,
    occurredAt: event.ts,
  };

  switch (event.type) {
    case 'run.created':
      return { ...base, status: 'started', summary: event.goal };

    case 'run.completed':
      return { ...base, status: 'completed', progress: 1, summary: event.status };

    case 'run.failed':
      return { ...base, status: 'failed', summary: event.error };

    case 'run.cancelled':
      return { ...base, status: 'cancelled', summary: event.reason };

    case 'run.blocked':
      return { ...base, status: 'blocked', summary: event.reason };

    case 'approval.requested':
    case 'approval.granted':
    case 'approval.denied':
      return {
        ...base,
        status: 'progress',
        summary: event.type,
        metadata: { tool: event.tool },
      };

    case 'tool.executed':
      return {
        ...base,
        status: 'progress',
        summary: `tool:${event.tool ?? 'unknown'}`,
        metadata: { tool: event.tool, ms: event.ms, toolStatus: event.status },
      };

    default:
      return null;
  }
}

// ====== Internal constants ===================================================

const BASE_PATH = '/api/integrations/pyrfor';
const MAX_QUEUE = 1_000;

// ====== CeoclawClient ========================================================

interface ResolvedRetry {
  attempts: number;
  backoffMs: number;
}

interface ClientStats {
  sent: number;
  failed: number;
  queued: number;
  lastError?: string;
}

/**
 * HTTP client for the CEOClaw integration API.
 *
 * All network methods retry on transient (5xx / timeout / network) errors
 * up to `retry.attempts` times with linear back-off.
 */
export class CeoclawClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly workspaceId: string;
  private readonly timeoutMs: number;
  private readonly retry: ResolvedRetry;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly clockFn: () => number;

  private readonly _stats: ClientStats = { sent: 0, failed: 0, queued: 0 };

  constructor(opts: CeoclawClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.workspaceId = opts.workspaceId;
    this.timeoutMs = opts.timeoutMs ?? 8_000;
    this.retry = {
      attempts: opts.retry?.attempts ?? 2,
      backoffMs: opts.retry?.backoffMs ?? 250,
    };
    this.fetchImpl = opts.fetchImpl;
    this.clockFn = opts.clock ?? (() => Date.now());
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private get fetch(): typeof fetch {
    return this.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Execute a single fetch call guarded by an AbortController-based timeout.
   * On timeout, throws TimeoutError (which classifyHttpError maps to 'transient').
   */
  private async _fetchOnce(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      return await this.fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
      if (timedOut) throw new TimeoutError(this.timeoutMs);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Execute a request with automatic retry on transient errors.
   * Returns the Response on 2xx; throws HttpError on non-2xx (after retries).
   */
  private async _request(url: string, init: RequestInit = {}): Promise<Response> {
    const { attempts, backoffMs } = this.retry;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= attempts; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, backoffMs * attempt));
      }
      try {
        const res = await this._fetchOnce(url, init);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new HttpError(res.status, res.statusText, body);
        }
        return res;
      } catch (e) {
        const kind = classifyHttpError(e);
        if (kind === 'cancelled') throw e;
        if (kind === 'transient' && attempt < attempts) {
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    // Safety net — reached only when all retry iterations used `continue`.
    throw lastErr;
  }

  /** Build an absolute URL with optional query parameters. */
  private buildUrl(
    subPath: string,
    params?: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(`${this.baseUrl}${BASE_PATH}${subPath}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Ping the CEOClaw health endpoint. Measures round-trip latency. */
  async health(): Promise<{ ok: boolean; version?: string; latencyMs: number }> {
    const t0 = this.clockFn();
    const res = await this._request(this.buildUrl('/health'), {
      method: 'GET',
      headers: buildHeaders(this.apiKey),
    });
    const body = (await res.json()) as { ok?: boolean; version?: string };
    return {
      ok: body.ok ?? true,
      version: body.version,
      latencyMs: this.clockFn() - t0,
    };
  }

  /** List tasks, optionally filtered by status / goal / assignee. */
  async listTasks(filter?: {
    status?: CeoclawTask['status'];
    goalId?: string;
    assigneeId?: string;
    limit?: number;
  }): Promise<CeoclawTask[]> {
    const res = await this._request(
      this.buildUrl('/tasks', {
        status: filter?.status,
        goalId: filter?.goalId,
        assigneeId: filter?.assigneeId,
        limit: filter?.limit,
      }),
      { method: 'GET', headers: buildHeaders(this.apiKey) },
    );
    return (await res.json()) as CeoclawTask[];
  }

  /** Fetch a single task by ID; returns null if the server responds 404. */
  async getTask(id: string): Promise<CeoclawTask | null> {
    try {
      const res = await this._request(
        this.buildUrl(`/tasks/${encodeURIComponent(id)}`),
        { method: 'GET', headers: buildHeaders(this.apiKey) },
      );
      return (await res.json()) as CeoclawTask;
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  /**
   * Create-or-update a task. The server performs an upsert keyed on `task.id`
   * when present, or creates a new task when `id` is absent.
   */
  async upsertTask(task: Partial<CeoclawTask> & { id?: string }): Promise<CeoclawTask> {
    const res = await this._request(this.buildUrl('/tasks'), {
      method: 'PUT',
      headers: buildHeaders(this.apiKey),
      body: JSON.stringify(task),
    });
    return (await res.json()) as CeoclawTask;
  }

  /**
   * Delete a task by ID.
   * Returns true if the server deleted it (2xx), false if it was not found (404).
   */
  async deleteTask(id: string): Promise<boolean> {
    try {
      await this._request(
        this.buildUrl(`/tasks/${encodeURIComponent(id)}`),
        { method: 'DELETE', headers: buildHeaders(this.apiKey) },
      );
      return true;
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return false;
      throw e;
    }
  }

  /** List goals, optionally filtered by status. */
  async listGoals(filter?: {
    status?: CeoclawGoal['status'];
    limit?: number;
  }): Promise<CeoclawGoal[]> {
    const res = await this._request(
      this.buildUrl('/goals', {
        status: filter?.status,
        limit: filter?.limit,
      }),
      { method: 'GET', headers: buildHeaders(this.apiKey) },
    );
    return (await res.json()) as CeoclawGoal[];
  }

  /** Send a single heartbeat event. */
  async sendHeartbeat(
    hb: CeoclawHeartbeat,
  ): Promise<{ accepted: boolean; serverId?: string }> {
    const res = await this._request(this.buildUrl('/heartbeat'), {
      method: 'POST',
      headers: buildHeaders(this.apiKey),
      body: JSON.stringify(hb),
    });
    const body = (await res.json()) as { accepted?: boolean; serverId?: string };
    this._stats.sent++;
    return { accepted: body.accepted ?? true, serverId: body.serverId };
  }

  /**
   * Send a batch of heartbeat events in one HTTP call.
   * Returns server-confirmed accepted / rejected counts.
   */
  async sendBatch(
    hbs: CeoclawHeartbeat[],
  ): Promise<{ accepted: number; rejected: number }> {
    const res = await this._request(this.buildUrl('/heartbeat/batch'), {
      method: 'POST',
      headers: buildHeaders(this.apiKey),
      body: JSON.stringify(hbs),
    });
    const body = (await res.json()) as { accepted?: number; rejected?: number };
    const accepted = body.accepted ?? hbs.length;
    const rejected = body.rejected ?? 0;
    this._stats.sent += accepted;
    this._stats.failed += rejected;
    return { accepted, rejected };
  }

  // ─── Ledger subscription ────────────────────────────────────────────────────

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
  subscribeLedger(
    ledger: EventLedger,
    opts?: {
      mapping?: (event: LedgerEvent) => CeoclawHeartbeat | null;
      flushEveryMs?: number;
      maxBatch?: number;
    },
  ): () => void {
    const flushEveryMs = opts?.flushEveryMs ?? 2_000;
    const maxBatch = opts?.maxBatch ?? 50;
    const mapFn =
      opts?.mapping ??
      ((e: LedgerEvent) => defaultLedgerMapping(e, { workspaceId: this.workspaceId }));

    let lastSeq = -1;
    let stopped = false;
    const pendingQueue: CeoclawHeartbeat[] = [];

    const syncQueuedStat = () => {
      this._stats.queued = pendingQueue.length;
    };

    // Send up to maxBatch items from pendingQueue; requeue on network failure.
    const flush = async (): Promise<void> => {
      if (pendingQueue.length === 0) return;
      const batch = pendingQueue.splice(0, maxBatch);
      syncQueuedStat();
      try {
        await this.sendBatch(batch);
        // sendBatch updates sent/failed stats internally.
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.warn('[CeoclawClient] sendBatch failed, requeueing heartbeats', { error: errMsg });
        this._stats.lastError = errMsg;
        this._stats.failed += batch.length;
        // Requeue up to the bounded limit.
        const available = MAX_QUEUE - pendingQueue.length;
        pendingQueue.unshift(...batch.slice(0, available));
        syncQueuedStat();
      }
    };

    // Poll ledger, enqueue new events, then flush.
    const poll = async (): Promise<void> => {
      try {
        const events = await ledger.readAll();
        const newEvents = events.filter((e) => e.seq > lastSeq);
        if (newEvents.length > 0) {
          lastSeq = newEvents[newEvents.length - 1].seq;
          for (const event of newEvents) {
            if (pendingQueue.length >= MAX_QUEUE) break;
            const hb = mapFn(event);
            if (hb) pendingQueue.push(hb);
          }
          syncQueuedStat();
        }
        await flush();
      } catch (e) {
        logger.warn('[CeoclawClient] ledger poll error', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      syncQueuedStat();
    };

    const timer = setInterval(() => {
      if (!stopped) void poll();
    }, flushEveryMs);

    // Disposer: stop interval and do one final flush.
    return () => {
      stopped = true;
      clearInterval(timer);
      void poll();
    };
  }

  /** Return a snapshot of cumulative send statistics. */
  getStats(): { sent: number; failed: number; queued: number; lastError?: string } {
    return { ...this._stats };
  }
}
