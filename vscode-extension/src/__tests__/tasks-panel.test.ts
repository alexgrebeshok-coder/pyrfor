import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TasksPanel,
  RunningTask,
  DaemonClientLike,
  TaskStatus,
  compareTasks,
  isTerminalStatus,
  formatDuration,
  isValidStatus,
  escapeHtml,
} from '../panels/tasks';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeMockDaemon() {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();

  const daemon: DaemonClientLike = {
    send: vi.fn(),
    on: vi.fn((event: string, cb: (payload: unknown) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
    }),
    off: vi.fn((event: string, cb: (payload: unknown) => void) => {
      const list = listeners.get(event) ?? [];
      listeners.set(
        event,
        list.filter((h) => h !== cb)
      );
    }),
    isConnected: vi.fn(() => true),
  };

  function emit(event: string, payload: unknown): void {
    const list = listeners.get(event) ?? [];
    for (const cb of [...list]) cb(payload);
  }

  return { daemon, emit };
}

/** Creates a minimal valid RunningTask. */
function makeTask(
  id: string,
  status: TaskStatus = 'running',
  updatedAt = '2024-01-01T00:01:00.000Z',
  title = `Task ${id}`
): RunningTask {
  return {
    id,
    title,
    mode: 'chat',
    status,
    startedAt: '2024-01-01T00:00:00.000Z',
    updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('compareTasks', () => {
  it('orders by status priority: running > queued > blocked > completed > failed > cancelled', () => {
    const tasks = [
      makeTask('cancelled', 'cancelled'),
      makeTask('failed', 'failed'),
      makeTask('completed', 'completed'),
      makeTask('blocked', 'blocked'),
      makeTask('queued', 'queued'),
      makeTask('running', 'running'),
    ];
    const sorted = [...tasks].sort(compareTasks);
    expect(sorted.map((t) => t.status)).toEqual([
      'running',
      'queued',
      'blocked',
      'completed',
      'failed',
      'cancelled',
    ]);
  });

  it('sorts by updatedAt descending within the same status', () => {
    const older = makeTask('old', 'running', '2024-01-01T00:00:00.000Z');
    const newer = makeTask('new', 'running', '2024-01-01T00:01:00.000Z');
    const sorted = [older, newer].sort(compareTasks);
    expect(sorted[0].id).toBe('new');
    expect(sorted[1].id).toBe('old');
  });

  it('does not re-order equal tasks (same status and updatedAt)', () => {
    const a = makeTask('a', 'queued', '2024-01-01T00:00:00.000Z');
    const b = makeTask('b', 'queued', '2024-01-01T00:00:00.000Z');
    expect(compareTasks(a, b)).toBe(0);
  });
});

describe('isTerminalStatus', () => {
  it.each([
    ['completed', true],
    ['failed', true],
    ['cancelled', true],
    ['running', false],
    ['queued', false],
    ['blocked', false],
  ] as [TaskStatus, boolean][])('%s → %s', (status, expected) => {
    expect(isTerminalStatus(status)).toBe(expected);
  });
});

describe('formatDuration', () => {
  const BASE = '2024-01-01T00:00:00.000Z';
  const baseMs = new Date(BASE).getTime();

  it('formats 0 seconds as "0s"', () => {
    expect(formatDuration(BASE, BASE, baseMs)).toBe('0s');
  });

  it('formats 90 seconds as "1m 30s"', () => {
    const endedAt = new Date(baseMs + 90_000).toISOString();
    expect(formatDuration(BASE, endedAt, baseMs)).toBe('1m 30s');
  });

  it('formats sub-minute durations without minutes prefix', () => {
    const endedAt = new Date(baseMs + 45_000).toISOString();
    expect(formatDuration(BASE, endedAt, baseMs)).toBe('45s');
  });

  it('uses `now` when endedAt is undefined (ongoing task)', () => {
    const now = baseMs + 62_000;
    expect(formatDuration(BASE, undefined, now)).toBe('1m 2s');
  });

  it('clamps negative durations to "0s"', () => {
    const before = new Date(baseMs - 5_000).toISOString();
    expect(formatDuration(BASE, before, baseMs)).toBe('0s');
  });
});

describe('isValidStatus', () => {
  it('accepts all valid statuses', () => {
    for (const s of ['queued', 'running', 'blocked', 'completed', 'failed', 'cancelled']) {
      expect(isValidStatus(s)).toBe(true);
    }
  });

  it('rejects invalid strings', () => {
    expect(isValidStatus('pending')).toBe(false);
    expect(isValidStatus('done')).toBe(false);
    expect(isValidStatus('')).toBe(false);
    expect(isValidStatus(null)).toBe(false);
    expect(isValidStatus(42)).toBe(false);
    expect(isValidStatus(undefined)).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('escapes < > & "', () => {
    expect(escapeHtml('<b>"hello" & world</b>')).toBe(
      '&lt;b&gt;&quot;hello&quot; &amp; world&lt;/b&gt;'
    );
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });
});

// ---------------------------------------------------------------------------
// TasksPanel — lifecycle
// ---------------------------------------------------------------------------

describe('TasksPanel start/stop', () => {
  it('start subscribes to "task.update" on the daemon', async () => {
    const { daemon } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();
    expect(daemon.on).toHaveBeenCalledWith('task.update', expect.any(Function));
  });

  it('stop unsubscribes from daemon; subsequent emits do not fire onChange', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    let changeCount = 0;
    panel.onChange(() => {
      changeCount++;
    });

    emit('task.update', makeTask('t1'));
    expect(changeCount).toBe(1);

    await panel.stop();

    emit('task.update', makeTask('t2'));
    expect(changeCount).toBe(1); // handler was removed
    expect(daemon.off).toHaveBeenCalledWith('task.update', expect.any(Function));
  });
});

// ---------------------------------------------------------------------------
// TasksPanel — task updates
// ---------------------------------------------------------------------------

describe('TasksPanel task updates', () => {
  let daemon: DaemonClientLike;
  let emit: (event: string, payload: unknown) => void;
  let panel: TasksPanel;

  beforeEach(async () => {
    ({ daemon, emit } = makeMockDaemon());
    panel = new TasksPanel({ daemon });
    await panel.start();
  });

  afterEach(async () => {
    await panel.stop();
  });

  it('new task id → getTasks length +1; onChange fired', () => {
    let fired = false;
    panel.onChange(() => {
      fired = true;
    });

    emit('task.update', makeTask('t1'));

    expect(panel.getTasks()).toHaveLength(1);
    expect(fired).toBe(true);
  });

  it('existing id partial update → merged; onChange fired', () => {
    emit('task.update', makeTask('t1', 'running'));

    let lastTasks: RunningTask[] = [];
    panel.onChange((tasks) => {
      lastTasks = tasks;
    });

    emit('task.update', { id: 't1', status: 'completed', endedAt: '2024-01-01T00:05:00.000Z', updatedAt: '2024-01-01T00:05:00.000Z' });

    expect(panel.getTasks()).toHaveLength(1);
    expect(panel.getTask('t1')?.status).toBe('completed');
    expect(panel.getTask('t1')?.endedAt).toBe('2024-01-01T00:05:00.000Z');
    expect(panel.getTask('t1')?.title).toBe('Task t1'); // original preserved
    expect(lastTasks).toHaveLength(1);
  });

  it('malformed payload (missing id) is ignored', () => {
    let changeCount = 0;
    panel.onChange(() => {
      changeCount++;
    });

    emit('task.update', { title: 'No ID' });
    emit('task.update', null);
    emit('task.update', 'just a string');
    emit('task.update', 42);
    emit('task.update', {});

    expect(changeCount).toBe(0);
    expect(panel.getTasks()).toHaveLength(0);
  });

  it('incomplete new task (missing required fields) is ignored', () => {
    emit('task.update', { id: 't1', title: 'Only title' }); // missing mode/status/startedAt/updatedAt
    expect(panel.getTasks()).toHaveLength(0);
  });

  it('terminal-status task stays in getTasks; drainCompleted removes it', () => {
    emit('task.update', makeTask('t1', 'running'));
    expect(panel.getTasks()).toHaveLength(1);

    emit('task.update', { id: 't1', status: 'completed', endedAt: '2024-01-01T00:02:00.000Z', updatedAt: '2024-01-01T00:02:00.000Z' });
    expect(panel.getTasks()).toHaveLength(1);
    expect(panel.getTask('t1')?.status).toBe('completed');

    let changeFired = false;
    panel.onChange(() => {
      changeFired = true;
    });

    panel.drainCompleted();
    expect(panel.getTasks()).toHaveLength(0);
    expect(changeFired).toBe(true);
  });

  it('drainCompleted does not fire onChange when nothing was removed', () => {
    emit('task.update', makeTask('t1', 'running'));

    let changeFired = false;
    panel.onChange(() => {
      changeFired = true;
    });

    panel.drainCompleted();
    expect(changeFired).toBe(false);
    expect(panel.getTasks()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TasksPanel — cancel / pause / resume
// ---------------------------------------------------------------------------

describe('TasksPanel cancel/pause/resume', () => {
  it('cancel sends "task.cancel" and resolves true on { ok: true }', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    const p = panel.cancel('t1');
    emit('task.cancel.result', { id: 't1', ok: true });

    expect(await p).toBe(true);
    expect(daemon.send).toHaveBeenCalledWith({ type: 'task.cancel', id: 't1' });
  });

  it('cancel resolves false on ack { ok: false }', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    const p = panel.cancel('t1');
    emit('task.cancel.result', { id: 't1', ok: false });

    expect(await p).toBe(false);
  });

  it('cancel resolves false on timeout', async () => {
    vi.useFakeTimers();
    try {
      const { daemon } = makeMockDaemon();
      const panel = new TasksPanel({ daemon });
      await panel.start();

      const p = panel.cancel('t1');
      vi.advanceTimersByTime(3001);

      expect(await p).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel ignores ack for a different id', async () => {
    vi.useFakeTimers();
    try {
      const { daemon, emit } = makeMockDaemon();
      const panel = new TasksPanel({ daemon });
      await panel.start();

      const p = panel.cancel('t1');
      emit('task.cancel.result', { id: 't2', ok: true }); // wrong id
      vi.advanceTimersByTime(3001); // expire

      expect(await p).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pause sends "task.pause" and resolves true on ack', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    const p = panel.pause('t1');
    emit('task.pause.result', { id: 't1', ok: true });

    expect(await p).toBe(true);
    expect(daemon.send).toHaveBeenCalledWith({ type: 'task.pause', id: 't1' });
  });

  it('pause resolves false on timeout', async () => {
    vi.useFakeTimers();
    try {
      const { daemon } = makeMockDaemon();
      const panel = new TasksPanel({ daemon });
      await panel.start();

      const p = panel.pause('t1');
      vi.advanceTimersByTime(3001);

      expect(await p).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resume sends "task.resume" and resolves true on ack', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    const p = panel.resume('t1');
    emit('task.resume.result', { id: 't1', ok: true });

    expect(await p).toBe(true);
    expect(daemon.send).toHaveBeenCalledWith({ type: 'task.resume', id: 't1' });
  });

  it('resume resolves false on timeout', async () => {
    vi.useFakeTimers();
    try {
      const { daemon } = makeMockDaemon();
      const panel = new TasksPanel({ daemon });
      await panel.start();

      const p = panel.resume('t1');
      vi.advanceTimersByTime(3001);

      expect(await p).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// TasksPanel — refresh
// ---------------------------------------------------------------------------

describe('TasksPanel refresh', () => {
  it('sends "task.list", awaits "task.list.result", replaces map, returns sorted', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    // Pre-populate with a stale task
    emit('task.update', makeTask('stale', 'queued'));
    expect(panel.getTasks()).toHaveLength(1);

    const snapshot = [
      { id: 't1', title: 'Running Task', mode: 'chat', status: 'running', startedAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:01:00.000Z' },
      { id: 't2', title: 'Queued Task', mode: 'edit', status: 'queued', startedAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
    ];

    const p = panel.refresh();
    emit('task.list.result', snapshot);
    const result = await p;

    expect(daemon.send).toHaveBeenCalledWith({ type: 'task.list' });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('t1'); // running comes first
    expect(result[1].id).toBe('t2');
    expect(panel.getTask('stale')).toBeUndefined(); // map was replaced
  });

  it('ignores non-array task.list.result payloads', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    emit('task.update', makeTask('t1'));

    // Non-array payload should be ignored — handler stays registered
    const p = panel.refresh();
    emit('task.list.result', 'not an array'); // ignored
    emit('task.list.result', []);             // accepted
    const result = await p;

    expect(result).toHaveLength(0);
  });

  it('refresh timeout returns previous snapshot unchanged', async () => {
    vi.useFakeTimers();
    try {
      const { daemon, emit } = makeMockDaemon();
      const panel = new TasksPanel({ daemon });
      await panel.start();

      emit('task.update', makeTask('t1'));

      const p = panel.refresh();
      vi.advanceTimersByTime(5001);
      const result = await p;

      expect(result).toHaveLength(1); // previous snapshot returned
      expect(result[0].id).toBe('t1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refresh fires onChange after replacing map', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    let changed = false;
    panel.onChange(() => {
      changed = true;
    });

    const p = panel.refresh();
    emit('task.list.result', [makeTask('fresh')]);
    await p;

    expect(changed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TasksPanel — polling
// ---------------------------------------------------------------------------

describe('TasksPanel polling', () => {
  it('pollIntervalMs > 0: refresh is called periodically', async () => {
    vi.useFakeTimers();
    try {
      const { daemon, emit } = makeMockDaemon();
      const panel = new TasksPanel({ daemon, pollIntervalMs: 100 });
      await panel.start();

      // First poll
      vi.advanceTimersByTime(100);
      expect(daemon.send).toHaveBeenCalledWith({ type: 'task.list' });
      emit('task.list.result', []); // settle first refresh

      // Second poll
      vi.advanceTimersByTime(100);
      const calls = (daemon.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => (c[0] as { type: string }).type === 'task.list'
      );
      expect(calls).toHaveLength(2);
      emit('task.list.result', []); // settle second refresh

      await panel.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pollIntervalMs = 0 (default): does not start an interval', async () => {
    vi.useFakeTimers();
    try {
      const { daemon } = makeMockDaemon();
      const panel = new TasksPanel({ daemon }); // no pollIntervalMs
      await panel.start();

      vi.advanceTimersByTime(10_000);

      expect(daemon.send).not.toHaveBeenCalled();
      await panel.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// TasksPanel — getStats
// ---------------------------------------------------------------------------

describe('TasksPanel getStats', () => {
  it('counts each status correctly', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    emit('task.update', makeTask('r1', 'running'));
    emit('task.update', makeTask('r2', 'running'));
    emit('task.update', makeTask('q1', 'queued'));
    emit('task.update', makeTask('b1', 'blocked'));
    emit('task.update', makeTask('c1', 'completed'));
    emit('task.update', makeTask('f1', 'failed'));
    emit('task.update', makeTask('x1', 'cancelled'));

    const stats = panel.getStats();
    expect(stats.total).toBe(7);
    expect(stats.running).toBe(2);
    expect(stats.queued).toBe(1);
    expect(stats.blocked).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.cancelled).toBe(1);
  });

  it('returns zeroes when no tasks', async () => {
    const { daemon } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    const stats = panel.getStats();
    expect(stats).toEqual({ total: 0, running: 0, queued: 0, completed: 0, failed: 0, cancelled: 0, blocked: 0 });
  });
});

// ---------------------------------------------------------------------------
// TasksPanel — getQuickPickItems
// ---------------------------------------------------------------------------

describe('TasksPanel getQuickPickItems', () => {
  it('returns items sorted in task order with mode and status in description', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    emit('task.update', makeTask('q1', 'queued'));
    emit('task.update', makeTask('r1', 'running'));

    const items = panel.getQuickPickItems();
    expect(items).toHaveLength(2);
    expect(items[0].taskId).toBe('r1'); // running first
    expect(items[0].description).toContain('chat');
    expect(items[0].description).toContain('running');
    expect(items[1].taskId).toBe('q1');
  });
});

// ---------------------------------------------------------------------------
// TasksPanel — renderHtml
// ---------------------------------------------------------------------------

describe('TasksPanel renderHtml', () => {
  it('HTML-escapes task title containing <script>', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    emit('task.update', {
      id: 'xss',
      title: '<script>alert(1)</script>',
      mode: 'chat',
      status: 'running',
      startedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const html = panel.renderHtml();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes nonce attribute on script tag', () => {
    const { daemon } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });

    const html = panel.renderHtml({ nonce: 'abc123' });
    expect(html).toContain('nonce="abc123"');
  });

  it('respects light theme', () => {
    const { daemon } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    expect(panel.renderHtml({ theme: 'light' })).toContain('data-theme="light"');
  });

  it('defaults to dark theme', () => {
    const { daemon } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    expect(panel.renderHtml()).toContain('data-theme="dark"');
  });

  it('uses injected clock for duration of ongoing tasks', async () => {
    const fixedNow = new Date('2024-01-01T00:02:30.000Z').getTime();
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon, clock: () => fixedNow });
    await panel.start();

    emit('task.update', {
      id: 't1',
      title: 'Long task',
      mode: 'autonomous',
      status: 'running',
      startedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const html = panel.renderHtml();
    expect(html).toContain('2m 30s');
  });
});

// ---------------------------------------------------------------------------
// TasksPanel — onChange
// ---------------------------------------------------------------------------

describe('TasksPanel onChange', () => {
  it('onChange disposer stops future notifications', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    let count = 0;
    const dispose = panel.onChange(() => {
      count++;
    });

    emit('task.update', makeTask('t1'));
    expect(count).toBe(1);

    dispose();

    emit('task.update', makeTask('t2'));
    expect(count).toBe(1); // no further calls
  });

  it('multiple listeners each receive the update', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    let a = 0;
    let b = 0;
    panel.onChange(() => { a++; });
    panel.onChange(() => { b++; });

    emit('task.update', makeTask('t1'));
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('onChange callback receives sorted task list', async () => {
    const { daemon, emit } = makeMockDaemon();
    const panel = new TasksPanel({ daemon });
    await panel.start();

    emit('task.update', makeTask('q1', 'queued'));

    let received: RunningTask[] = [];
    panel.onChange((tasks) => { received = tasks; });

    emit('task.update', makeTask('r1', 'running'));

    expect(received[0].status).toBe('running');
    expect(received[1].status).toBe('queued');
  });
});
