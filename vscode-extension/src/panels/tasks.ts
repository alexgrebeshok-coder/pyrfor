// Pure Node module — no 'vscode' imports. Webview/Tree wiring lives in extension.ts.

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RunningTask {
  id: string;
  runId?: string;
  title: string;
  mode: 'chat' | 'edit' | 'autonomous' | 'pm';
  status: TaskStatus;
  progress?: number; // 0..1
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  summary?: string;
  artifactCount?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** Minimal public surface needed — matches DaemonClient (which extends EventEmitter). */
export interface DaemonClientLike {
  send(payload: object): void | Promise<unknown>;
  on(event: string, cb: (payload: unknown) => void): void;
  off(event: string, cb: (payload: unknown) => void): void;
  isConnected?(): boolean;
}

// ---------------------------------------------------------------------------
// Status sort priority (lower = higher in list)
// ---------------------------------------------------------------------------
const STATUS_PRIORITY: Record<TaskStatus, number> = {
  running: 0,
  queued: 1,
  blocked: 2,
  completed: 3,
  failed: 4,
  cancelled: 5,
};

const TERMINAL_STATUSES = new Set<TaskStatus>(['completed', 'failed', 'cancelled']);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function isValidStatus(s: unknown): s is TaskStatus {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(STATUS_PRIORITY, s);
}

export function isTerminalStatus(s: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(s);
}

/** Sorts running > queued > blocked > completed > failed > cancelled; ties broken by updatedAt desc. */
export function compareTasks(a: RunningTask, b: RunningTask): number {
  const pa = STATUS_PRIORITY[a.status] ?? 99;
  const pb = STATUS_PRIORITY[b.status] ?? 99;
  if (pa !== pb) return pa - pb;
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * Formats elapsed duration.
 * - endedAt undefined → uses `now` (ongoing task).
 * - Returns '0s' for zero-second durations.
 */
export function formatDuration(
  startedAt: string,
  endedAt: string | undefined,
  now: number
): string {
  const startMs = new Date(startedAt).getTime();
  const endMs = endedAt !== undefined ? new Date(endedAt).getTime() : now;
  const totalSec = Math.max(0, Math.floor((endMs - startMs) / 1000));
  if (totalSec === 0) return '0s';
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins === 0 ? `${secs}s` : `${mins}m ${secs}s`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Private type guards
// ---------------------------------------------------------------------------

/** Returns true when payload is an object with a non-empty string `id`. */
function isPartialUpdate(payload: unknown): payload is { id: string } & Partial<RunningTask> {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return typeof p['id'] === 'string' && (p['id'] as string).length > 0;
}

/** Returns true when payload satisfies all required RunningTask fields. */
function isTaskShape(value: unknown): value is RunningTask {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t['id'] === 'string' &&
    (t['id'] as string).length > 0 &&
    typeof t['title'] === 'string' &&
    typeof t['startedAt'] === 'string' &&
    typeof t['updatedAt'] === 'string' &&
    isValidStatus(t['status']) &&
    (t['mode'] === 'chat' ||
      t['mode'] === 'edit' ||
      t['mode'] === 'autonomous' ||
      t['mode'] === 'pm')
  );
}

/** Returns true when payload is an ack for the given task id. */
function isAckFor(payload: unknown, id: string): payload is { id: string; ok: boolean } {
  if (typeof payload !== 'object' || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return p['id'] === id && typeof p['ok'] === 'boolean';
}

// ---------------------------------------------------------------------------
// TasksPanel
// ---------------------------------------------------------------------------

const ACK_TIMEOUT_MS = 3000;
const REFRESH_TIMEOUT_MS = 5000;

export class TasksPanel {
  private readonly _daemon: DaemonClientLike;
  private readonly _pollIntervalMs: number;
  private readonly _clock: () => number;

  private _tasks: Map<string, RunningTask> = new Map();
  private _changeListeners: Set<(tasks: RunningTask[]) => void> = new Set();
  private _updateHandler: ((payload: unknown) => void) | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: {
    daemon: DaemonClientLike;
    pollIntervalMs?: number;
    clock?: () => number;
  }) {
    this._daemon = opts.daemon;
    this._pollIntervalMs = opts.pollIntervalMs ?? 0;
    this._clock = opts.clock ?? (() => Date.now());
  }

  /** Subscribe to daemon task events and optionally start a polling interval. */
  async start(): Promise<void> {
    this._updateHandler = (payload: unknown) => this._handleUpdate(payload);
    this._daemon.on('task.update', this._updateHandler);

    if (this._pollIntervalMs > 0) {
      this._pollTimer = setInterval(() => {
        this.refresh().catch(() => {
          // swallow — errors reported via daemon
        });
      }, this._pollIntervalMs);
    }
  }

  /** Unsubscribe from daemon events and cancel the polling interval. */
  async stop(): Promise<void> {
    if (this._updateHandler !== null) {
      this._daemon.off('task.update', this._updateHandler);
      this._updateHandler = null;
    }
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /** Returns tasks sorted: running first, then queued, then blocked, etc.; ties by updatedAt desc. */
  getTasks(): RunningTask[] {
    return [...this._tasks.values()].sort(compareTasks);
  }

  getTask(id: string): RunningTask | undefined {
    return this._tasks.get(id);
  }

  /** Register a change listener. Returns a disposer function. */
  onChange(cb: (tasks: RunningTask[]) => void): () => void {
    this._changeListeners.add(cb);
    return () => {
      this._changeListeners.delete(cb);
    };
  }

  async cancel(id: string): Promise<boolean> {
    return this._ack('task.cancel', id);
  }

  async pause(id: string): Promise<boolean> {
    return this._ack('task.pause', id);
  }

  async resume(id: string): Promise<boolean> {
    return this._ack('task.resume', id);
  }

  /**
   * Sends 'task.list' and awaits 'task.list.result'.
   * On success: replaces the in-memory map, fires onChange, returns sorted list.
   * On timeout (5 s): returns the current snapshot unchanged.
   */
  async refresh(): Promise<RunningTask[]> {
    return new Promise<RunningTask[]>((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this._daemon.off('task.list.result', handler);
        // Return existing snapshot on timeout (documented behaviour).
        resolve(this.getTasks());
      }, REFRESH_TIMEOUT_MS);

      const handler = (payload: unknown) => {
        if (!Array.isArray(payload)) return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._daemon.off('task.list.result', handler);

        const newMap = new Map<string, RunningTask>();
        for (const item of payload) {
          if (isTaskShape(item)) {
            newMap.set(item.id, item);
          }
        }
        this._tasks = newMap;
        this._fireChange();
        resolve(this.getTasks());
      };

      this._daemon.on('task.list.result', handler);
      try {
        this._daemon.send({ type: 'task.list' });
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this._daemon.off('task.list.result', handler);
          resolve(this.getTasks());
        }
      }
    });
  }

  /** Removes all terminal-status tasks (completed|failed|cancelled) and fires onChange. */
  drainCompleted(): void {
    let changed = false;
    for (const [id, task] of this._tasks) {
      if (isTerminalStatus(task.status)) {
        this._tasks.delete(id);
        changed = true;
      }
    }
    if (changed) this._fireChange();
  }

  getStats(): {
    total: number;
    running: number;
    queued: number;
    completed: number;
    failed: number;
    cancelled: number;
    blocked: number;
  } {
    const all = [...this._tasks.values()];
    return {
      total: all.length,
      running: all.filter((t) => t.status === 'running').length,
      queued: all.filter((t) => t.status === 'queued').length,
      completed: all.filter((t) => t.status === 'completed').length,
      failed: all.filter((t) => t.status === 'failed').length,
      cancelled: all.filter((t) => t.status === 'cancelled').length,
      blocked: all.filter((t) => t.status === 'blocked').length,
    };
  }

  getQuickPickItems(): Array<{ label: string; description: string; taskId: string }> {
    return this.getTasks().map((t) => ({
      label: t.title,
      description: `${t.mode} · ${t.status}`,
      taskId: t.id,
    }));
  }

  /**
   * Renders a simple HTML table of all tasks.
   * Titles (and all user content) are HTML-escaped.
   * Respects theme ('light'|'dark') via data-theme attribute.
   * Nonce is applied to the inline script tag (for CSP).
   */
  renderHtml(opts?: { theme?: 'light' | 'dark'; nonce?: string }): string {
    const theme = opts?.theme ?? 'dark';
    const nonce = opts?.nonce ?? '';
    const nonceAttr = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';
    const now = this._clock();

    const rows = this.getTasks()
      .map((t) => {
        const progress =
          t.progress !== undefined ? `${Math.round(t.progress * 100)}%` : '';
        const duration = formatDuration(t.startedAt, t.endedAt, now);
        return (
          `    <tr>` +
          `<td>${escapeHtml(t.id)}</td>` +
          `<td>${escapeHtml(t.title)}</td>` +
          `<td>${escapeHtml(t.mode)}</td>` +
          `<td>${escapeHtml(t.status)}</td>` +
          `<td>${escapeHtml(progress)}</td>` +
          `<td>${escapeHtml(duration)}</td>` +
          `</tr>`
        );
      })
      .join('\n');

    return `<!DOCTYPE html>
<html data-theme="${escapeHtml(theme)}" lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Pyrfor Tasks</title>
  <style>
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); margin: 0; padding: 8px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-input-border); }
    th { font-weight: bold; }
  </style>
</head>
<body>
  <table>
    <thead><tr><th>ID</th><th>Title</th><th>Mode</th><th>Status</th><th>Progress</th><th>Duration</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <script${nonceAttr}>/* Pyrfor Tasks Panel */</script>
</body>
</html>`;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _handleUpdate(payload: unknown): void {
    if (!isPartialUpdate(payload)) return; // malformed: missing/invalid id

    const id = payload.id;
    const existing = this._tasks.get(id);

    if (existing) {
      // Merge partial fields; strip undefined so required fields aren't clobbered.
      const patch = Object.fromEntries(
        Object.entries(payload as Record<string, unknown>).filter(([, v]) => v !== undefined)
      ) as Partial<RunningTask>;
      this._tasks.set(id, { ...existing, ...patch } as RunningTask);
    } else {
      // New task: all required fields must be present.
      if (!isTaskShape(payload)) return;
      this._tasks.set(id, { ...payload } as RunningTask);
    }

    this._fireChange();
  }

  private _fireChange(): void {
    const snapshot = this.getTasks();
    for (const cb of this._changeListeners) {
      cb(snapshot);
    }
  }

  /**
   * Sends `{ type: verb, id }` and resolves true if the daemon replies with
   * `{ id, ok: true }` on event `<verb>.result` within ACK_TIMEOUT_MS.
   * Resolves false on `{ ok: false }`, timeout, or send error.
   */
  private _ack(verb: string, id: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const resultEvent = `${verb}.result`;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this._daemon.off(resultEvent, handler);
        resolve(false);
      }, ACK_TIMEOUT_MS);

      const handler = (payload: unknown) => {
        if (!isAckFor(payload, id)) return;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._daemon.off(resultEvent, handler);
        resolve(payload.ok);
      };

      this._daemon.on(resultEvent, handler);
      try {
        this._daemon.send({ type: verb, id });
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this._daemon.off(resultEvent, handler);
          resolve(false);
        }
      }
    });
  }
}
