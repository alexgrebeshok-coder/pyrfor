/**
 * pyrfor-trajectory-recorder.ts
 *
 * JSONL trajectory recorder for FreeClaude (FC) sessions in Pyrfor.
 * Each session gets one append-only JSONL file at <dir>/<sessionId>.jsonl.
 */

import * as nodeFsPromises from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as nodeOs from 'node:os';
import type { FCEvent, FCEnvelope } from './pyrfor-fc-adapter.js';
import type { FcEvent } from './pyrfor-event-reader.js';

// ── Public types ─────────────────────────────────────────────────────────────

export type TrajectoryRecord =
  | { kind: 'session_open'; sessionId: string; taskId?: string; cwd?: string; model?: string; startedAt: number; meta?: Record<string, unknown> }
  | { kind: 'raw'; sessionId: string; ts: number; event: FCEvent }
  | { kind: 'typed'; sessionId: string; ts: number; event: FcEvent }
  | { kind: 'note'; sessionId: string; ts: number; level: 'info' | 'warn' | 'error'; text: string; meta?: Record<string, unknown> }
  | { kind: 'envelope'; sessionId: string; ts: number; envelope: FCEnvelope }
  | { kind: 'session_close'; sessionId: string; ts: number; status: 'success' | 'error' | 'aborted'; reason?: string };

export interface TrajectoryFs {
  mkdir: (p: string, opts: { recursive: boolean }) => Promise<void>;
  appendFile: (p: string, data: string) => Promise<void>;
  readFile: (p: string, enc: 'utf8') => Promise<string>;
  rename: (a: string, b: string) => Promise<void>;
  stat: (p: string) => Promise<{ size: number; mtimeMs: number }>;
  readdir: (p: string) => Promise<string[]>;
}

export interface TrajectoryRecorderOptions {
  /** Directory for trajectories. Default: ~/.pyrfor/trajectories. */
  dir?: string;
  /** Filesystem (for tests). Default: node:fs/promises. */
  fs?: TrajectoryFs;
  /** Clock. */
  now?: () => number;
  /** If true (default), open a stream per session lazily on first record. If false, must call openSession() explicitly. */
  autoOpen?: boolean;
  /** If true, also gzip on close. Default false. */
  gzipOnClose?: boolean;
}

export interface TrajectoryRecorder {
  openSession(sessionId: string, meta?: { taskId?: string; cwd?: string; model?: string; meta?: Record<string, unknown> }): Promise<void>;
  recordRaw(sessionId: string, event: FCEvent): Promise<void>;
  recordTyped(sessionId: string, event: FcEvent): Promise<void>;
  note(sessionId: string, level: 'info' | 'warn' | 'error', text: string, meta?: Record<string, unknown>): Promise<void>;
  recordEnvelope(sessionId: string, envelope: FCEnvelope): Promise<void>;
  closeSession(sessionId: string, status: 'success' | 'error' | 'aborted', reason?: string): Promise<void>;
  /** Path of a session's file (whether open or closed). */
  pathFor(sessionId: string): string;
  /** List session ids by scanning dir. */
  listSessions(): Promise<string[]>;
  /** Read full session file as parsed records. */
  readSession(sessionId: string): Promise<TrajectoryRecord[]>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeSessionId(id: string): string {
  return id.replace(/[^A-Za-z0-9_.-]/g, '_');
}

// ── Implementation ────────────────────────────────────────────────────────────

export function createTrajectoryRecorder(opts?: TrajectoryRecorderOptions): TrajectoryRecorder {
  const dir = opts?.dir ?? nodePath.join(nodeOs.homedir(), '.pyrfor', 'trajectories');
  const fs: TrajectoryFs = opts?.fs ?? (nodeFsPromises as unknown as TrajectoryFs);
  const now = opts?.now ?? (() => Date.now());
  const autoOpen = opts?.autoOpen ?? true;
  const gzipOnClose = opts?.gzipOnClose ?? false;

  // Per-session write chain for serialization
  const chains = new Map<string, Promise<void>>();
  // Track which sessions have been explicitly or auto-opened
  const openedSessions = new Set<string>();
  // Track whether mkdir has been done
  let dirReady: Promise<void> | null = null;

  function ensureDir(): Promise<void> {
    if (!dirReady) {
      dirReady = fs.mkdir(dir, { recursive: true });
    }
    return dirReady;
  }

  function pathFor(sessionId: string): string {
    return nodePath.join(dir, `${sanitizeSessionId(sessionId)}.jsonl`);
  }

  function enqueue(sessionId: string, work: () => Promise<void>): Promise<void> {
    const prev = chains.get(sessionId) ?? Promise.resolve();
    const next = prev.then(() => work(), () => work());
    chains.set(sessionId, next);
    return next;
  }

  async function writeRecord(sessionId: string, record: TrajectoryRecord): Promise<void> {
    await ensureDir();
    const line = JSON.stringify(record) + '\n';
    await fs.appendFile(pathFor(sessionId), line);
  }

  async function ensureOpen(sessionId: string): Promise<void> {
    if (openedSessions.has(sessionId)) return;
    if (!autoOpen) {
      throw new Error(`Session "${sessionId}" has not been opened. Call openSession() first or enable autoOpen.`);
    }
    // Auto-open: emit session_open with minimal meta
    openedSessions.add(sessionId);
    const record: TrajectoryRecord = {
      kind: 'session_open',
      sessionId: sanitizeSessionId(sessionId),
      startedAt: now(),
    };
    await writeRecord(sessionId, record);
  }

  return {
    pathFor(sessionId: string): string {
      return pathFor(sessionId);
    },

    async openSession(sessionId: string, meta?: { taskId?: string; cwd?: string; model?: string; meta?: Record<string, unknown> }): Promise<void> {
      return enqueue(sessionId, async () => {
        if (openedSessions.has(sessionId)) return;
        openedSessions.add(sessionId);
        const record: TrajectoryRecord = {
          kind: 'session_open',
          sessionId: sanitizeSessionId(sessionId),
          startedAt: now(),
          ...(meta?.taskId !== undefined && { taskId: meta.taskId }),
          ...(meta?.cwd !== undefined && { cwd: meta.cwd }),
          ...(meta?.model !== undefined && { model: meta.model }),
          ...(meta?.meta !== undefined && { meta: meta.meta }),
        };
        await writeRecord(sessionId, record);
      });
    },

    async recordRaw(sessionId: string, event: FCEvent): Promise<void> {
      return enqueue(sessionId, async () => {
        await ensureOpen(sessionId);
        const record: TrajectoryRecord = {
          kind: 'raw',
          sessionId: sanitizeSessionId(sessionId),
          ts: now(),
          event,
        };
        await writeRecord(sessionId, record);
      });
    },

    async recordTyped(sessionId: string, event: FcEvent): Promise<void> {
      return enqueue(sessionId, async () => {
        await ensureOpen(sessionId);
        const record: TrajectoryRecord = {
          kind: 'typed',
          sessionId: sanitizeSessionId(sessionId),
          ts: now(),
          event,
        };
        await writeRecord(sessionId, record);
      });
    },

    async note(sessionId: string, level: 'info' | 'warn' | 'error', text: string, meta?: Record<string, unknown>): Promise<void> {
      return enqueue(sessionId, async () => {
        await ensureOpen(sessionId);
        const record: TrajectoryRecord = {
          kind: 'note',
          sessionId: sanitizeSessionId(sessionId),
          ts: now(),
          level,
          text,
          ...(meta !== undefined && { meta }),
        };
        await writeRecord(sessionId, record);
      });
    },

    async recordEnvelope(sessionId: string, envelope: FCEnvelope): Promise<void> {
      return enqueue(sessionId, async () => {
        await ensureOpen(sessionId);
        const record: TrajectoryRecord = {
          kind: 'envelope',
          sessionId: sanitizeSessionId(sessionId),
          ts: now(),
          envelope,
        };
        await writeRecord(sessionId, record);
      });
    },

    async closeSession(sessionId: string, status: 'success' | 'error' | 'aborted', reason?: string): Promise<void> {
      return enqueue(sessionId, async () => {
        await ensureOpen(sessionId);
        const record: TrajectoryRecord = {
          kind: 'session_close',
          sessionId: sanitizeSessionId(sessionId),
          ts: now(),
          status,
          ...(reason !== undefined && { reason }),
        };
        await writeRecord(sessionId, record);

        if (gzipOnClose) {
          const { gzip } = await import('node:zlib');
          const { promisify } = await import('node:util');
          const gzipAsync = promisify(gzip);
          const filePath = pathFor(sessionId);
          const content = await fs.readFile(filePath, 'utf8');
          const compressed = await gzipAsync(Buffer.from(content, 'utf8'));
          const gzPath = filePath + '.gz';
          await fs.appendFile(gzPath, compressed.toString('binary'));
          await fs.rename(filePath, filePath + '.bak');
        }
      });
    },

    async listSessions(): Promise<string[]> {
      await ensureDir();
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return [];
      }
      return entries
        .filter(f => f.endsWith('.jsonl'))
        .map(f => f.slice(0, -('.jsonl'.length)));
    },

    async readSession(sessionId: string): Promise<TrajectoryRecord[]> {
      const content = await fs.readFile(pathFor(sessionId), 'utf8');
      const records: TrajectoryRecord[] = [];
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          records.push(JSON.parse(trimmed) as TrajectoryRecord);
        } catch {
          // skip malformed lines silently
        }
      }
      return records;
    },
  };
}
