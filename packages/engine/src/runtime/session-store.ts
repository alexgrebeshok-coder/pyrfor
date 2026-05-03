/**
 * session-store.ts — Runtime Session Store: persists chat/run sessions to disk.
 *
 * Sprint 3 #8 — UNIFIED_PLAN_FINAL.md
 *
 * Layout: <rootDir>/<workspaceId>/<sessionId>.json
 *
 * Design:
 *  - In-memory cache (Map) is the source of truth for hot reads.
 *  - Mutations mark the entry dirty and schedule a debounced flush via setTimeout.
 *  - Atomic write: write to <file>.tmp then rename() — POSIX crash-safe.
 *  - flush() drains all dirty entries immediately; returns after all writes complete.
 *  - close() flushes then clears all timers.
 *  - Write errors during debounced saves: increment writeErrors, log warn, swallow.
 *  - Write errors during flush()/close(): increment writeErrors, log warn, rethrow.
 *
 * Also exports legacy PersistedSession / reviveSession / debounceMs alias so that
 * existing callers (index.ts, session.ts, cli.ts) continue to compile without
 * modification. These will be removed in a future sprint.
 */

import { promises as fsp } from 'node:fs';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import logger from '../observability/logger';

// ====== New API — Interfaces ==================================================

/** A single message within a chat or run session. */
export interface SessionMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
  /** ISO-8601 timestamp; auto-set by appendMessage if absent. */
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/** Full persisted record for a session. */
export interface SessionRecord {
  /** Unique session identifier. */
  id: string;
  workspaceId: string;
  title: string;
  mode: 'chat' | 'edit' | 'autonomous' | 'pm';
  runId?: string;
  parentSessionId?: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-updated timestamp. */
  updatedAt: string;
  messages: SessionMessage[];
  /** Optional rolling summary for long sessions. */
  summary?: string;
  archived?: boolean;
  metadata?: Record<string, unknown>;
}

/** Options accepted by the SessionStore constructor. */
export interface SessionStoreOptions {
  /**
   * Root directory where sessions are persisted.
   * Layout: <rootDir>/<workspaceId>/<sessionId>.json
   */
  /** Root dir (required for new API; legacy callers may use undefined with default). */
  rootDir?: string;
  /** Debounce window for autosaves in ms. Default: 200. */
  autosaveDebounceMs?: number;
  /**
   * @deprecated Alias for autosaveDebounceMs. Used by legacy callers.
   * If both are supplied autosaveDebounceMs wins.
   */
  debounceMs?: number;
  /**
   * Soft hint for callers: maximum messages to keep in memory before
   * summarisation. Not enforced by the store. Default: 5000.
   */
  maxMessagesInMemory?: number;
}

// ====== Legacy types (kept for backward compatibility) ========================

/** @deprecated Legacy persisted session shape; used by the old channel-based store. */
export interface PersistedSession {
  schemaVersion: number;
  id: string;
  channel: string;
  userId: string;
  chatId: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string; timestamp?: string }>;
  tokenCount: number;
  maxTokens: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Structural shape of the legacy Session object (mirrors session.ts). */
interface LegacySession {
  id: string;
  channel: 'telegram' | 'cli' | 'tma' | 'web';
  userId: string;
  chatId: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
  tokenCount: number;
  maxTokens: number;
  summary?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  lastActivityAt: Date;
}

/**
 * @deprecated Converts a PersistedSession back to a legacy session shape.
 * Used by index.ts to hydrate sessions on startup.
 */
export function reviveSession(p: PersistedSession): LegacySession {
  return {
    id: p.id,
    channel: p.channel as 'telegram' | 'cli' | 'tma' | 'web',
    userId: p.userId,
    chatId: p.chatId,
    systemPrompt: p.systemPrompt ?? '',
    messages: p.messages.map((m) => ({ role: normalizeLegacyRole(m.role), content: m.content })),
    createdAt: new Date(p.createdAt),
    lastActivityAt: new Date(p.updatedAt),
    tokenCount: p.tokenCount ?? 0,
    maxTokens: p.maxTokens ?? 128_000,
    summary: typeof p.metadata?.['sessionSummary'] === 'string' ? p.metadata['sessionSummary'] : undefined,
    metadata: p.metadata ?? {},
  };
}

export function reviveSessionRecord(record: SessionRecord): LegacySession {
  return reviveSession(recordToPersistedSession(record));
}

// ====== Pure Helpers ==========================================================

/**
 * Return the absolute file path for a session JSON file.
 * Layout: <rootDir>/<workspaceId>/<sessionId>.json
 */
export function sessionFilePath(
  rootDir: string,
  workspaceId: string,
  sessionId: string,
): string {
  return path.join(rootDir, sanitizeId(workspaceId), `${sanitizeId(sessionId)}.json`);
}

/**
 * Strip path-traversal sequences and filesystem-unsafe characters from an id
 * so it is safe to use as a path segment.
 */
export function sanitizeId(s: string): string {
  return (
    s
      .replace(/\.\./g, '')
      .replace(/[/\\]/g, '_')
      .replace(/^_+/, '')
      .replace(/_+$/, '')
  ) || '_';
}

/**
 * Build a deterministic rolling summary of messages by concatenating
 * "role: content" pairs and truncating to maxChars.
 * Deterministic: same input always produces the same output.
 */
export function summarizeMessages(messages: SessionMessage[], maxChars: number): string {
  return messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')
    .slice(0, maxChars);
}

/** Generate a new session id (UUID v4). */
export function newSessionId(): string {
  return randomUUID();
}

// ====== Internal helpers ======================================================

function cacheKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}/${sessionId}`;
}

function isMode(value: unknown): value is SessionRecord['mode'] {
  return value === 'chat' || value === 'edit' || value === 'autonomous' || value === 'pm';
}

function normalizeLegacyRole(role: string): 'user' | 'system' | 'assistant' {
  return role === 'user' || role === 'system' || role === 'assistant' ? role : 'assistant';
}

function legacyWorkspaceId(session: { metadata?: Record<string, unknown> } | { id: string }): string {
  if (!('metadata' in session)) return 'legacy';
  const metadataWorkspace = session.metadata?.['workspaceId'] ?? session.metadata?.['workspacePath'];
  if (typeof metadataWorkspace === 'string' && metadataWorkspace.length > 0) return metadataWorkspace;
  return 'legacy';
}

function legacySessionToRecord(session: LegacySession): SessionRecord {
  const workspaceId = legacyWorkspaceId(session);
  const summary = session.summary
    ?? (typeof session.metadata['sessionSummary'] === 'string' ? session.metadata['sessionSummary'] : undefined);
  const mode = isMode(session.metadata['mode']) ? session.metadata['mode'] : 'chat';
  const updatedAt = session.lastActivityAt.toISOString();
  return {
    id: session.id,
    workspaceId,
    title: typeof session.metadata['title'] === 'string'
      ? session.metadata['title']
      : `${session.channel}:${session.chatId}`,
    mode,
    createdAt: session.createdAt.toISOString(),
    updatedAt,
    messages: session.messages.map((message, index) => ({
      id: `${session.id}:msg:${index}`,
      role: message.role,
      content: message.content,
      createdAt: updatedAt,
    })),
    ...(summary ? { summary } : {}),
    metadata: {
      ...session.metadata,
      workspaceId,
      legacyChannel: session.channel,
      legacyUserId: session.userId,
      legacyChatId: session.chatId,
      systemPrompt: session.systemPrompt,
      tokenCount: session.tokenCount,
      maxTokens: session.maxTokens,
      ...(summary ? { sessionSummary: summary } : {}),
    },
  };
}

function recordToPersistedSession(record: SessionRecord): PersistedSession {
  const metadata = record.metadata ?? {};
  const channel = typeof metadata['legacyChannel'] === 'string' ? metadata['legacyChannel'] : 'web';
  const userId = typeof metadata['legacyUserId'] === 'string' ? metadata['legacyUserId'] : 'unknown';
  const chatId = typeof metadata['legacyChatId'] === 'string' ? metadata['legacyChatId'] : record.id;
  const systemPrompt = typeof metadata['systemPrompt'] === 'string' ? metadata['systemPrompt'] : '';
  const tokenCount = typeof metadata['tokenCount'] === 'number' ? metadata['tokenCount'] : 0;
  const maxTokens = typeof metadata['maxTokens'] === 'number' ? metadata['maxTokens'] : 128_000;
  return {
    schemaVersion: 1,
    id: record.id,
    channel,
    userId,
    chatId,
    systemPrompt,
    messages: record.messages.map((message) => ({
      role: normalizeLegacyRole(message.role),
      content: message.content,
      timestamp: message.createdAt,
    })),
    tokenCount,
    maxTokens,
    metadata: {
      ...metadata,
      workspaceId: record.workspaceId,
      ...(record.summary ? { sessionSummary: record.summary } : {}),
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// ====== SessionStore ==========================================================

/**
 * Persists chat/run sessions to disk as JSON files, one file per session.
 * In-memory cache is the source of truth for hot reads.
 * Mutations are debounce-autosaved to disk atomically.
 */
export class SessionStore {
  private readonly opts: Required<Omit<SessionStoreOptions, 'debounceMs'>>;
  /** workspaceId/sessionId → SessionRecord */
  private readonly cache = new Map<string, SessionRecord>();
  /** Keys of records that have unsaved mutations. */
  private readonly dirty = new Set<string>();
  /** Active debounce timers keyed by cache key. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private _flushes = 0;
  private _writeErrors = 0;

  constructor(opts: SessionStoreOptions) {
    this.opts = {
      // debounceMs is a legacy alias; autosaveDebounceMs wins if both present.
      autosaveDebounceMs: opts.autosaveDebounceMs ?? opts.debounceMs ?? 200,
      maxMessagesInMemory: opts.maxMessagesInMemory ?? 5000,
      rootDir: opts.rootDir ?? '',
    };
  }

  // ====== New API =============================================================

  /**
   * Create a new session record, write it to disk immediately, and return it.
   */
  async create(
    input: Pick<SessionRecord, 'workspaceId' | 'title' | 'mode'> &
      Partial<Pick<SessionRecord, 'runId' | 'parentSessionId' | 'metadata'>>,
  ): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const record: SessionRecord = {
      id: newSessionId(),
      workspaceId: input.workspaceId,
      title: input.title,
      mode: input.mode,
      createdAt: now,
      updatedAt: now,
      messages: [],
      ...(input.runId !== undefined && { runId: input.runId }),
      ...(input.parentSessionId !== undefined && { parentSessionId: input.parentSessionId }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    };
    const key = cacheKey(record.workspaceId, record.id);
    this.cache.set(key, record);
    await this._writeRecord(record);
    return record;
  }

  /**
   * Get a session by workspaceId + sessionId.
   * Returns null if the session does not exist on disk or in cache.
   * Populates the cache on first disk read.
   */
  async get(workspaceId: string, sessionId: string): Promise<SessionRecord | null> {
    const key = cacheKey(workspaceId, sessionId);
    if (this.cache.has(key)) return this.cache.get(key)!;

    const filePath = sessionFilePath(this.opts.rootDir, workspaceId, sessionId);
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const record = JSON.parse(raw) as SessionRecord;
      this.cache.set(key, record);
      return record;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * List sessions for a workspace.
   * Scans <rootDir>/<workspaceId>/*.json; uses in-memory cache when available.
   * Sorting is done by reading createdAt/updatedAt fields from each record.
   *
   * Default behaviour: excludes archived sessions (archived !== true).
   */
  async list(
    workspaceId: string,
    opts: {
      archived?: boolean;
      mode?: SessionRecord['mode'];
      limit?: number;
      offset?: number;
      orderBy?: 'createdAt' | 'updatedAt';
      direction?: 'asc' | 'desc';
    } = {},
  ): Promise<SessionRecord[]> {
    const {
      archived = false,
      mode,
      limit,
      offset = 0,
      orderBy = 'updatedAt',
      direction = 'desc',
    } = opts;

    const wsDir = path.join(this.opts.rootDir, sanitizeId(workspaceId));
    let entries: string[];
    try {
      entries = await fsp.readdir(wsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const records: SessionRecord[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const sessionId = name.slice(0, -5); // strip '.json'
      const key = cacheKey(workspaceId, sessionId);
      let record: SessionRecord | undefined;

      if (this.cache.has(key)) {
        record = this.cache.get(key)!;
      } else {
        const filePath = path.join(wsDir, name);
        try {
          const raw = await fsp.readFile(filePath, 'utf-8');
          record = JSON.parse(raw) as SessionRecord;
          this.cache.set(key, record);
        } catch {
          continue;
        }
      }

      const isArchived = record.archived === true;
      if (archived !== isArchived) continue;
      if (mode !== undefined && record.mode !== mode) continue;
      records.push(record);
    }

    records.sort((a, b) => {
      const av = a[orderBy];
      const bv = b[orderBy];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return direction === 'asc' ? cmp : -cmp;
    });

    return records.slice(offset, limit !== undefined ? offset + limit : undefined);
  }

  /**
   * Append a message to a session.
   * Auto-assigns id (UUID v4) and createdAt (ISO) if absent on the input.
   * Marks session dirty and schedules a debounced flush.
   */
  async appendMessage(
    workspaceId: string,
    sessionId: string,
    msg: Omit<SessionMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  ): Promise<SessionMessage> {
    const record = await this.get(workspaceId, sessionId);
    if (!record) {
      throw new Error(`[SessionStore] Session not found: ${workspaceId}/${sessionId}`);
    }
    const message: SessionMessage = {
      ...msg,
      id: msg.id ?? randomUUID(),
      createdAt: msg.createdAt ?? new Date().toISOString(),
    };
    record.messages.push(message);
    record.updatedAt = new Date().toISOString();
    const key = cacheKey(workspaceId, sessionId);
    this.cache.set(key, record);
    this._scheduleSave(key, record);
    return message;
  }

  /**
   * Patch specific fields on a session and bump updatedAt.
   * Returns null if session not found.
   */
  async update(
    workspaceId: string,
    sessionId: string,
    patch: Partial<
      Pick<SessionRecord, 'title' | 'mode' | 'runId' | 'summary' | 'archived' | 'metadata'>
    >,
  ): Promise<SessionRecord | null> {
    const record = await this.get(workspaceId, sessionId);
    if (!record) return null;
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    const key = cacheKey(workspaceId, sessionId);
    this.cache.set(key, record);
    this._scheduleSave(key, record);
    return record;
  }

  /**
   * Set archived=true on a session.
   * Returns false if session not found, true otherwise.
   */
  async archive(workspaceId: string, sessionId: string): Promise<boolean> {
    return (await this.update(workspaceId, sessionId, { archived: true })) !== null;
  }

  /**
   * Delete a session by workspaceId + sessionId (new API).
   * Removes the file and evicts from cache.
   * Cancels any pending debounced save for that session.
   * Returns false if the file did not exist.
   */
  async delete(workspaceId: string, sessionId: string): Promise<boolean>;
  /**
   * @deprecated Delete a session using a legacy Session-like object (old API).
   * No-op in the new API — callers should migrate to delete(workspaceId, sessionId).
   */
  async delete(session: { id: string }): Promise<boolean>;
  async delete(
    workspaceIdOrSession: string | { id: string },
    sessionId?: string,
  ): Promise<boolean> {
    if (typeof workspaceIdOrSession !== 'string') {
      return this.delete(legacyWorkspaceId(workspaceIdOrSession), workspaceIdOrSession.id);
    }

    const wsId = workspaceIdOrSession;
    const sid = sessionId!;
    const key = cacheKey(wsId, sid);
    const timer = this.timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    this.dirty.delete(key);
    this.cache.delete(key);

    const filePath = sessionFilePath(this.opts.rootDir, wsId, sid);
    try {
      await fsp.unlink(filePath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  /**
   * Return a pretty-printed JSON string of the session record.
   * Throws if session not found.
   */
  async exportToJson(workspaceId: string, sessionId: string): Promise<string> {
    const record = await this.get(workspaceId, sessionId);
    if (!record) {
      throw new Error(`[SessionStore] exportToJson: session not found ${workspaceId}/${sessionId}`);
    }
    return JSON.stringify(record, null, 2);
  }

  /**
   * Parse a JSON string, validate required fields, persist to disk, and add to cache.
   * Throws on invalid JSON or missing required fields.
   */
  async importFromJson(json: string): Promise<SessionRecord> {
    let record: SessionRecord;
    try {
      record = JSON.parse(json) as SessionRecord;
    } catch (err) {
      throw new Error(`[SessionStore] importFromJson: invalid JSON — ${String(err)}`);
    }

    const required: (keyof SessionRecord)[] = [
      'id', 'workspaceId', 'title', 'mode', 'createdAt', 'updatedAt', 'messages',
    ];
    for (const field of required) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (record[field] === undefined || record[field] === null) {
        throw new Error(`[SessionStore] importFromJson: missing required field "${field}"`);
      }
    }
    if (!Array.isArray(record.messages)) {
      throw new Error('[SessionStore] importFromJson: "messages" must be an array');
    }

    const key = cacheKey(record.workspaceId, record.id);
    this.cache.set(key, record);
    await this._writeRecord(record);
    return record;
  }

  /**
   * Force all pending dirty sessions to be written to disk immediately.
   * Cancels outstanding debounce timers.
   * Increments the flushes counter regardless of errors.
   * Rethrows the first write error if any occur.
   */
  async flush(): Promise<void> {
    for (const [key, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    const dirtyKeys = [...this.dirty];
    this.dirty.clear();

    const errors: Error[] = [];
    await Promise.all(
      dirtyKeys.map(async (key) => {
        const record = this.cache.get(key);
        if (!record) return;
        try {
          await this._writeRecord(record);
        } catch (err) {
          this._writeErrors++;
          logger.warn('[SessionStore] Flush write error', { key, error: String(err) });
          errors.push(err as Error);
        }
      }),
    );

    this._flushes++;
    if (errors.length > 0) throw errors[0];
  }

  /**
   * Flush any pending writes, then clear all timers and state.
   * Should be called on graceful shutdown.
   */
  async close(): Promise<void> {
    await this.flush();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.dirty.clear();
  }

  /** Return a snapshot of internal cache and write statistics. */
  getCacheStats(): { loaded: number; dirty: number; flushes: number; writeErrors: number } {
    return {
      loaded: this.cache.size,
      dirty: this.dirty.size,
      flushes: this._flushes,
      writeErrors: this._writeErrors,
    };
  }

  // ====== Legacy backward-compat methods =====================================

  /**
   * @deprecated Bridge for legacy session.ts callers.
   * New API: mutations are autosaved via appendMessage/update.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  save(_session: LegacySession): void {
    const record = legacySessionToRecord(_session);
    const key = cacheKey(record.workspaceId, record.id);
    this.cache.set(key, record);
    this._scheduleSave(key, record);
  }

  /**
   * Persist a legacy session synchronously.
   *
   * Used for initial session creation so a crash immediately after create()
   * does not lose the session identity or first-turn continuity anchor.
   */
  saveImmediate(_session: LegacySession): void {
    const record = legacySessionToRecord(_session);
    const key = cacheKey(record.workspaceId, record.id);
    const timer = this.timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    this.cache.set(key, record);
    this.dirty.delete(key);
    this._writeRecordSync(record);
  }

  /**
   * @deprecated No-op bridge for legacy index.ts callers.
   * New API: sessions are loaded lazily; no explicit init required.
   */
  async init(): Promise<void> {
    // Intentional no-op.
  }

  /**
   * @deprecated Bridge for legacy index.ts callers. Always returns [].
   * New API: use list() per workspace.
   */
  async loadAll(): Promise<PersistedSession[]> {
    const records: SessionRecord[] = [];
    let workspaceEntries: string[];
    try {
      workspaceEntries = await fsp.readdir(this.opts.rootDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    for (const workspaceName of workspaceEntries) {
      const workspaceDir = path.join(this.opts.rootDir, workspaceName);
      let stat;
      try {
        stat = await fsp.stat(workspaceDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      let sessionFiles: string[];
      try {
        sessionFiles = await fsp.readdir(workspaceDir);
      } catch {
        continue;
      }
      for (const fileName of sessionFiles) {
        if (!fileName.endsWith('.json')) continue;
        try {
          const raw = await fsp.readFile(path.join(workspaceDir, fileName), 'utf-8');
          const record = JSON.parse(raw) as SessionRecord;
          records.push(record);
          this.cache.set(cacheKey(record.workspaceId, record.id), record);
        } catch (err) {
          logger.warn('[SessionStore] Skipping unreadable persisted session', {
            path: path.join(workspaceDir, fileName),
            error: String(err),
          });
        }
      }
    }

    return records.map(recordToPersistedSession);
  }

  /**
   * @deprecated Alias for flush(). Used by legacy index.ts callers.
   */
  async flushAll(): Promise<void> {
    return this.flush();
  }

  // ====== Private helpers =====================================================

  /**
   * Schedule a debounced write for a session.
   * Multiple calls within the window collapse into one write at the end.
   * Write errors are counted and logged; they do NOT rethrow here.
   */
  private _scheduleSave(key: string, record: SessionRecord): void {
    this.dirty.add(key);
    const existing = this.timers.get(key);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.timers.delete(key);
      this.dirty.delete(key);
      try {
        await this._writeRecord(record);
      } catch (err) {
        this._writeErrors++;
        logger.warn('[SessionStore] Autosave write error', { key, error: String(err) });
      }
    }, this.opts.autosaveDebounceMs);

    // Don't hold the event loop open just for a debounced write.
    if (typeof (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref === 'function') {
      (timer as ReturnType<typeof setTimeout> & { unref: () => void }).unref();
    }
    this.timers.set(key, timer);
  }

  /**
   * Atomically write a record to disk: write to <path>.tmp then rename().
   * rename() is atomic on POSIX within a single filesystem.
   */
  private async _writeRecord(record: SessionRecord): Promise<void> {
    const filePath = sessionFilePath(this.opts.rootDir, record.workspaceId, record.id);
    const tmpPath = `${filePath}.tmp`;
    const json = JSON.stringify(record, null, 2);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(tmpPath, json, 'utf-8');
    await fsp.rename(tmpPath, filePath);
    logger.debug('[SessionStore] Wrote session', { id: record.id, path: filePath });
  }

  private _writeRecordSync(record: SessionRecord): void {
    const filePath = sessionFilePath(this.opts.rootDir, record.workspaceId, record.id);
    const tmpPath = `${filePath}.tmp`;
    mkdirSync(path.dirname(filePath), { recursive: true });
    const json = JSON.stringify(record, null, 2);
    writeFileSync(tmpPath, json, 'utf-8');
    renameSync(tmpPath, filePath);
  }
}
