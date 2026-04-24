/**
 * session-replay.ts — Pyrfor session replay recorder & replayer.
 *
 * Records every agent event (prompts, tool calls, outputs, timings) as
 * append-only JSONL lines.  Replays expose iterators for visualizers /
 * test runners.
 *
 * Design decisions:
 * - Append-only JSONL: one JSON object per line, atomic via appendFile.
 * - In-memory buffer drained by flushEveryNEvents threshold or debounce timer.
 * - writeChain serialises concurrent writes so lines never interleave.
 * - Replayer uses synchronous readFileSync / readdirSync so callers do not
 *   need to await simple queries.
 * - iterate() yields events with wall-clock-proportional delays (speed=1.0)
 *   or as-fast-as-possible (speed=0); honours AbortSignal for cancellation.
 */

import { promises as fs } from 'node:fs';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// ── Public types ───────────────────────────────────────────────────────────

export type ReplayEvent = {
  ts: number;
  sessionId: string;
  kind:
    | 'sessionStart'
    | 'sessionEnd'
    | 'userMessage'
    | 'assistantMessage'
    | 'toolCallStart'
    | 'toolCallEnd'
    | 'systemPromptInjected'
    | 'error'
    | 'meta';
  payload: Record<string, any>;
};

export type SessionRecorderOpts = {
  storeDir: string;
  sessionId: string;
  /** Monotonic clock in ms. Defaults to Date.now(). */
  clock?: () => number;
  /** Flush to disk after this many buffered events. Default: 50. */
  flushEveryNEvents?: number;
  /** Flush to disk after this many ms of inactivity. Default: 200. */
  flushDebounceMs?: number;
  logger?: (msg: string, meta?: any) => void;
};

// ── Recorder ───────────────────────────────────────────────────────────────

export function createSessionRecorder(opts: SessionRecorderOpts) {
  const {
    storeDir,
    sessionId,
    clock = () => Date.now(),
    flushEveryNEvents = 50,
    flushDebounceMs = 200,
    logger,
  } = opts;

  const filePath = path.join(storeDir, `${sessionId}.jsonl`);

  let buffer: ReplayEvent[] = [];
  let totalFlushed = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let dirEnsured = false;
  // Serialise concurrent appendFile calls so lines never interleave.
  let writeChain: Promise<void> = Promise.resolve();

  async function ensureDir(): Promise<void> {
    if (!dirEnsured) {
      await fs.mkdir(storeDir, { recursive: true });
      dirEnsured = true;
    }
  }

  function clearDebounce(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function scheduleDebounce(): void {
    if (debounceTimer !== null) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      flush().catch((err) => logger?.('session-replay: flush error', err));
    }, flushDebounceMs);
  }

  async function doWrite(events: ReplayEvent[]): Promise<void> {
    await ensureDir();
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.appendFile(filePath, lines, 'utf8');
  }

  async function flush(): Promise<void> {
    // If nothing buffered, still await any in-flight write so callers that
    // do `await flush()` after an auto-flush get a true "written" guarantee.
    if (buffer.length === 0) return writeChain;
    const toWrite = buffer.splice(0);
    totalFlushed += toWrite.length;
    clearDebounce();
    writeChain = writeChain.then(() => doWrite(toWrite));
    return writeChain;
  }

  function record(kind: ReplayEvent['kind'], payload: any): void {
    if (closed) return;
    const event: ReplayEvent = {
      ts: clock(),
      sessionId,
      kind,
      payload: payload ?? {},
    };
    buffer.push(event);
    if (buffer.length >= flushEveryNEvents) {
      clearDebounce();
      flush().catch((err) => logger?.('session-replay: flush error', err));
    } else {
      scheduleDebounce();
    }
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    // Always append a sessionEnd marker.
    buffer.push({ ts: clock(), sessionId, kind: 'sessionEnd', payload: {} });
    await flush();
  }

  return {
    record,
    meta(payload: any): void { record('meta', payload); },
    sessionStart(payload?: any): void { record('sessionStart', payload ?? {}); },
    sessionEnd(payload?: any): void { record('sessionEnd', payload ?? {}); },
    flush,
    close,
    count(): number { return totalFlushed + buffer.length; },
  };
}

// ── Replayer helpers ───────────────────────────────────────────────────────

function parseJsonlLines(content: string, onCorrupt?: (line: string) => void): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as ReplayEvent);
    } catch {
      onCorrupt?.(trimmed);
    }
  }
  return events;
}

function readEventsSync(filePath: string): ReplayEvent[] {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  return parseJsonlLines(content, (line) =>
    console.warn(`session-replay: skipping corrupt JSONL line: ${line.slice(0, 120)}`),
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(id); resolve(); }, { once: true });
  });
}

// ── Replayer ───────────────────────────────────────────────────────────────

export function createSessionReplayer(opts: { storeDir: string }) {
  const { storeDir } = opts;

  function loadSession(sessionId: string): ReplayEvent[] {
    return readEventsSync(path.join(storeDir, `${sessionId}.jsonl`));
  }

  function listSessions(): { sessionId: string; eventCount: number; firstTs: number; lastTs: number }[] {
    let files: string[];
    try {
      files = readdirSync(storeDir);
    } catch {
      return [];
    }
    const results: { sessionId: string; eventCount: number; firstTs: number; lastTs: number }[] = [];
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const sessionId = f.slice(0, -6);
      const events = readEventsSync(path.join(storeDir, f));
      if (events.length === 0) continue;
      results.push({
        sessionId,
        eventCount: events.length,
        firstTs: events[0].ts,
        lastTs: events[events.length - 1].ts,
      });
    }
    return results;
  }

  async function* iterate(
    sessionId: string,
    iterOpts?: { speed?: number; clock?: () => number; signal?: AbortSignal },
  ): AsyncGenerator<ReplayEvent> {
    const speed = iterOpts?.speed ?? 1.0;
    const signal = iterOpts?.signal;
    const events = loadSession(sessionId);

    for (let i = 0; i < events.length; i++) {
      if (signal?.aborted) return;
      yield events[i];
      if (speed > 0 && i < events.length - 1) {
        const gapMs = Math.max(0, events[i + 1].ts - events[i].ts);
        if (gapMs > 0) {
          await sleep(gapMs / speed, signal);
        }
      }
    }
  }

  function filter(events: ReplayEvent[], pred: (e: ReplayEvent) => boolean): ReplayEvent[] {
    return events.filter(pred);
  }

  function tail(sessionId: string, n: number): ReplayEvent[] {
    const events = loadSession(sessionId);
    return events.slice(Math.max(0, events.length - n));
  }

  function exportJson(sessionId: string): string {
    return JSON.stringify(loadSession(sessionId));
  }

  return { listSessions, loadSession, iterate, filter, tail, exportJson };
}
