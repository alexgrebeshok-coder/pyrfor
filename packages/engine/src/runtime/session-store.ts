/**
 * SessionStore — JSON file persistence for SessionManager.
 *
 * Layout:
 *   ~/.pyrfor/sessions/{channel}/{userId}_{chatId}.json
 *
 * Design choices:
 * - One file per session keyed by (channel, userId, chatId), so /clear or
 *   eviction can remove a single small file.
 * - **Atomic writes**: write to `<file>.tmp` then `rename()` — crash-safe on
 *   POSIX (`rename(2)` is atomic within a filesystem). No half-written JSON.
 * - **Debounced writes**: addMessage() can fire many times per second during
 *   a tool loop; we coalesce into one write every `debounceMs` (default 5s).
 * - **flush() on shutdown** drains the debounce queue synchronously.
 * - **No schema migrations** — we store a `schemaVersion` field; older files
 *   are silently ignored if version is incompatible.
 *
 * Format:
 * {
 *   schemaVersion: 1,
 *   id, channel, userId, chatId,
 *   messages: [{ role, content, timestamp }],
 *   systemPrompt, tokenCount, maxTokens, metadata,
 *   createdAt, updatedAt
 * }
 */

import { promises as fs } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { logger } from '../observability/logger';
import type { Session, Channel } from './session';
import type { Message } from '../ai/providers/base';

export const SCHEMA_VERSION = 1;

export interface PersistedMessage {
  role: Message['role'];
  content: string;
  timestamp: string; // ISO
}

export interface PersistedSession {
  schemaVersion: number;
  id: string;
  channel: Channel;
  userId: string;
  chatId: string;
  systemPrompt: string;
  messages: PersistedMessage[];
  tokenCount: number;
  maxTokens: number;
  metadata: Record<string, unknown>;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface SessionStoreOptions {
  /** Root directory. Default: `~/.pyrfor/sessions` */
  rootDir?: string;
  /** Debounce window for writes per session, in ms. Default 5000. */
  debounceMs?: number;
}

const VALID_CHANNELS: ReadonlySet<Channel> = new Set<Channel>(['telegram', 'cli', 'tma', 'web']);

/** Sanitize a path segment so it can never escape the channel directory. */
function safeSegment(s: string): string {
  // Replace anything that isn't safe with `_`. Collapse runs.
  return (
    s
      .normalize('NFKC')
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 200) || '_'
  );
}

/** Build the absolute path for a session's JSON file. */
function buildPath(rootDir: string, channel: Channel, userId: string, chatId: string): string {
  return path.join(rootDir, channel, `${safeSegment(userId)}_${safeSegment(chatId)}.json`);
}

export class SessionStore {
  private readonly rootDir: string;
  private readonly debounceMs: number;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Sessions awaiting debounced flush, keyed by sessionId. */
  private readonly pending = new Map<string, Session>();
  /** Map sessionId → file path (set on save/load). */
  private readonly pathBySessionId = new Map<string, string>();
  private closed = false;

  constructor(options: SessionStoreOptions = {}) {
    this.rootDir = options.rootDir || path.join(homedir(), '.pyrfor', 'sessions');
    this.debounceMs = options.debounceMs ?? 5000;
  }

  getRootDir(): string {
    return this.rootDir;
  }

  /** Ensure base directories exist. Idempotent. */
  async init(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    for (const channel of VALID_CHANNELS) {
      await fs.mkdir(path.join(this.rootDir, channel), { recursive: true });
    }
  }

  /**
   * Schedule a debounced save of the session.
   * Multiple calls within the debounce window collapse into one write.
   */
  save(session: Session): void {
    if (this.closed) return;
    this.pending.set(session.id, session);

    const existing = this.timers.get(session.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(session.id);
      const snap = this.pending.get(session.id);
      this.pending.delete(session.id);
      if (!snap) return;
      void this.writeAtomic(snap).catch((err) => {
        logger.error('SessionStore: deferred write failed', {
          sessionId: snap.id,
          error: String(err),
        });
      });
    }, this.debounceMs);

    // Don't keep the event loop alive just for a debounced write.
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(session.id, timer);
  }

  /** Force-write a single session immediately, bypassing debounce. */
  async saveNow(session: Session): Promise<void> {
    const t = this.timers.get(session.id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(session.id);
    }
    this.pending.delete(session.id);
    await this.writeAtomic(session);
  }

  /** Flush all pending writes synchronously (await all). */
  async flushAll(): Promise<void> {
    const sessions = Array.from(this.pending.values());
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.pending.clear();
    await Promise.all(sessions.map((s) => this.writeAtomic(s).catch((err) => {
      logger.error('SessionStore: flush write failed', {
        sessionId: s.id,
        error: String(err),
      });
    })));
  }

  /** Delete a session's persisted file. */
  async delete(session: Pick<Session, 'id' | 'channel' | 'userId' | 'chatId'>): Promise<void> {
    // Cancel any pending write first.
    const t = this.timers.get(session.id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(session.id);
    }
    this.pending.delete(session.id);

    const filePath =
      this.pathBySessionId.get(session.id) ||
      buildPath(this.rootDir, session.channel, session.userId, session.chatId);
    this.pathBySessionId.delete(session.id);

    try {
      await fs.unlink(filePath);
      logger.info('SessionStore: deleted', { sessionId: session.id, path: filePath });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logger.warn('SessionStore: delete failed', {
          sessionId: session.id,
          error: String(err),
        });
      }
    }
  }

  /**
   * Load all persisted sessions from disk.
   * Skips files that fail to parse / have wrong schema version.
   */
  async loadAll(): Promise<PersistedSession[]> {
    await this.init();
    const out: PersistedSession[] = [];

    for (const channel of VALID_CHANNELS) {
      const dir = path.join(this.rootDir, channel);
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') continue;
        throw err;
      }
      for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        const filePath = path.join(dir, name);
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          const parsed = JSON.parse(raw) as PersistedSession;
          if (parsed.schemaVersion !== SCHEMA_VERSION) {
            logger.warn('SessionStore: skipping incompatible schema', {
              file: filePath,
              version: parsed.schemaVersion,
            });
            continue;
          }
          if (!parsed.id || !parsed.channel || !parsed.userId || !parsed.chatId) {
            logger.warn('SessionStore: skipping malformed session', { file: filePath });
            continue;
          }
          this.pathBySessionId.set(parsed.id, filePath);
          out.push(parsed);
        } catch (err) {
          logger.warn('SessionStore: failed to load session file', {
            file: filePath,
            error: String(err),
          });
        }
      }
    }

    logger.info('SessionStore: loaded', { count: out.length, root: this.rootDir });
    return out;
  }

  /** Stop all timers; no more writes will be scheduled. */
  close(): void {
    this.closed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────

  private async writeAtomic(session: Session): Promise<void> {
    const filePath = buildPath(this.rootDir, session.channel, session.userId, session.chatId);
    this.pathBySessionId.set(session.id, filePath);

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const persisted: PersistedSession = {
      schemaVersion: SCHEMA_VERSION,
      id: session.id,
      channel: session.channel,
      userId: session.userId,
      chatId: session.chatId,
      systemPrompt: session.systemPrompt,
      messages: session.messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: new Date().toISOString(),
      })),
      tokenCount: session.tokenCount,
      maxTokens: session.maxTokens,
      metadata: session.metadata,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.lastActivityAt.toISOString(),
    };

    const tmpPath = `${filePath}.${process.pid}.tmp`;
    const json = JSON.stringify(persisted, null, 2);

    let fh: import('fs').promises.FileHandle | undefined;
    try {
      fh = await fs.open(tmpPath, 'w', 0o600);
      await fh.writeFile(json, 'utf-8');
      // fsync to survive power loss / kernel panics.
      await fh.sync().catch(() => { /* not fatal */ });
    } finally {
      await fh?.close();
    }
    // Bug fix: clean up .tmp on rename failure to avoid stale artefacts on disk.
    try {
      await fs.rename(tmpPath, filePath);
    } catch (renameErr) {
      await fs.unlink(tmpPath).catch(() => { /* best-effort; ignore ENOENT */ });
      throw renameErr;
    }
    logger.debug('SessionStore: wrote', {
      sessionId: session.id,
      path: filePath,
      bytes: json.length,
    });
  }
}

/**
 * Convert a PersistedSession back into a runtime Session.
 * Timestamps on individual messages are dropped (Message type has no field).
 */
export function reviveSession(p: PersistedSession): Session {
  return {
    id: p.id,
    channel: p.channel,
    userId: p.userId,
    chatId: p.chatId,
    messages: p.messages.map((m) => ({ role: m.role, content: m.content })),
    systemPrompt: p.systemPrompt,
    createdAt: new Date(p.createdAt),
    lastActivityAt: new Date(p.updatedAt),
    tokenCount: p.tokenCount,
    maxTokens: p.maxTokens,
    metadata: p.metadata || {},
  };
}
