/**
 * memory-store.ts — SQLite-backed long-term memory for Pyrfor.
 *
 * Features:
 * - FTS5 full-text search with BM25 ranking
 * - Content-table triggers keep FTS in sync (AI/AD/AU)
 * - Scoped queries, tag filtering, expiry, pruning
 * - In-process, synchronous better-sqlite3 for zero-latency reads
 */

import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import path from 'path';

// ─── Public types ────────────────────────────────────────────────────────────

export type MemoryKind = 'fact' | 'preference' | 'episode' | 'reference' | 'lesson';

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  source: string;
  scope: string;
  tags: string[];
  weight: number;
  applied_count: number;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

export interface MemoryQuery {
  scope?: string;
  kind?: MemoryKind | MemoryKind[];
  tags?: string[];
  search?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  includeExpired?: boolean;
}

export interface MemoryStoreOptions {
  dbPath?: string;
  tokenizer?: string;
}

export interface MemoryStore {
  add(input: Omit<MemoryEntry, 'id' | 'created_at' | 'updated_at' | 'applied_count'>): MemoryEntry;
  update(
    id: string,
    patch: Partial<Pick<MemoryEntry, 'text' | 'tags' | 'weight' | 'expires_at' | 'kind' | 'scope'>>,
  ): MemoryEntry | null;
  get(id: string): MemoryEntry | null;
  delete(id: string): boolean;
  query(q?: MemoryQuery): MemoryEntry[];
  search(text: string, opts?: { scope?: string; limit?: number }): MemoryEntry[];
  recordApplied(id: string): void;
  prune(opts?: { olderThanDays?: number; maxRows?: number }): number;
  count(): number;
  close(): void;
  exportAll(): MemoryEntry[];
  importMany(entries: MemoryEntry[]): number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Lightweight ULID-ish: timestamp base36 + 10 random bytes hex */
function makeId(): string {
  return Date.now().toString(36) + randomBytes(10).toString('hex');
}

function now(): string {
  return new Date().toISOString();
}

/** Wrap user input in double-quotes for FTS5 phrase safety. */
export function escapeFtsQuery(q: string): string {
  // Strip existing double-quotes then wrap entire string as FTS5 phrase
  return '"' + q.replace(/"/g, ' ') + '"';
}

// ─── Row ↔ MemoryEntry coercion ───────────────────────────────────────────

interface Row {
  id: string;
  kind: string;
  text: string;
  source: string;
  scope: string;
  tags: string;
  weight: number;
  applied_count: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

function rowToEntry(row: Row): MemoryEntry {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags) as string[];
  } catch {
    tags = [];
  }
  const entry: MemoryEntry = {
    id: row.id,
    kind: row.kind as MemoryKind,
    text: row.text,
    source: row.source,
    scope: row.scope,
    tags,
    weight: row.weight,
    applied_count: row.applied_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (row.expires_at != null) entry.expires_at = row.expires_at;
  return entry;
}

// ─── Schema DDL ──────────────────────────────────────────────────────────────

const SCHEMA_VERSION = '1';

function applySchema(db: Database.Database, tokenizer: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_entries (
      id            TEXT PRIMARY KEY,
      kind          TEXT NOT NULL,
      text          TEXT NOT NULL,
      source        TEXT NOT NULL,
      scope         TEXT NOT NULL,
      tags          TEXT NOT NULL DEFAULT '[]',
      weight        REAL NOT NULL DEFAULT 0.5,
      applied_count INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      expires_at    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_me_scope      ON memory_entries(scope);
    CREATE INDEX IF NOT EXISTS idx_me_kind       ON memory_entries(kind);
    CREATE INDEX IF NOT EXISTS idx_me_updated_at ON memory_entries(updated_at);
    CREATE INDEX IF NOT EXISTS idx_me_expires_at ON memory_entries(expires_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
      USING fts5(
        text,
        tags,
        content='memory_entries',
        content_rowid='rowid',
        tokenize='${tokenizer}'
      );

    -- AI trigger: after insert sync FTS
    CREATE TRIGGER IF NOT EXISTS me_ai
      AFTER INSERT ON memory_entries BEGIN
        INSERT INTO memory_fts(rowid, text, tags)
          VALUES (new.rowid, new.text, new.tags);
      END;

    -- AD trigger: after delete sync FTS
    CREATE TRIGGER IF NOT EXISTS me_ad
      AFTER DELETE ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, text, tags)
          VALUES ('delete', old.rowid, old.text, old.tags);
      END;

    -- AU trigger: after update sync FTS
    CREATE TRIGGER IF NOT EXISTS me_au
      AFTER UPDATE ON memory_entries BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, text, tags)
          VALUES ('delete', old.rowid, old.text, old.tags);
        INSERT INTO memory_fts(rowid, text, tags)
          VALUES (new.rowid, new.text, new.tags);
      END;
  `);

  // Store schema version
  db.prepare(`INSERT OR IGNORE INTO memory_meta(key, value) VALUES (?, ?)`).run(
    'schema_version',
    SCHEMA_VERSION,
  );
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createMemoryStore(opts?: MemoryStoreOptions): MemoryStore {
  const dbPath = opts?.dbPath ?? path.join(homedir(), '.pyrfor', 'memory.db');
  const tokenizer = opts?.tokenizer ?? 'unicode61 remove_diacritics 2';

  const db =
    dbPath === ':memory:'
      ? new Database(':memory:')
      : new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  applySchema(db, tokenizer);

  let closed = false;

  function assertOpen(): void {
    if (closed) throw new Error('MemoryStore is closed');
  }

  // ── Prepared statements ────────────────────────────────────────────────

  const stmtInsert = db.prepare<[
    string, string, string, string, string, string, number, string, string, string | null
  ]>(`
    INSERT INTO memory_entries
      (id, kind, text, source, scope, tags, weight, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const stmtGetById = db.prepare<[string], Row>(`
    SELECT * FROM memory_entries WHERE id = ?
  `);

  const stmtDeleteById = db.prepare<[string]>(`
    DELETE FROM memory_entries WHERE id = ?
  `);

  const stmtCount = db.prepare<[], { n: number }>(`
    SELECT COUNT(*) AS n FROM memory_entries
  `);

  const stmtIncrApplied = db.prepare<[string, string, string]>(`
    UPDATE memory_entries
    SET applied_count = applied_count + 1, updated_at = ?
    WHERE id = ?
    RETURNING updated_at
  `);
  void stmtIncrApplied; // used below

  // ── add ───────────────────────────────────────────────────────────────

  function add(
    input: Omit<MemoryEntry, 'id' | 'created_at' | 'updated_at' | 'applied_count'>,
  ): MemoryEntry {
    assertOpen();
    const id = makeId();
    const ts = now();
    const tagsJson = JSON.stringify(input.tags ?? []);
    stmtInsert.run(
      id,
      input.kind,
      input.text,
      input.source,
      input.scope,
      tagsJson,
      input.weight,
      ts,
      ts,
      input.expires_at ?? null,
    );
    return {
      id,
      kind: input.kind,
      text: input.text,
      source: input.source,
      scope: input.scope,
      tags: input.tags ?? [],
      weight: input.weight,
      applied_count: 0,
      created_at: ts,
      updated_at: ts,
      ...(input.expires_at != null ? { expires_at: input.expires_at } : {}),
    };
  }

  // ── get ───────────────────────────────────────────────────────────────

  function get(id: string): MemoryEntry | null {
    assertOpen();
    const row = stmtGetById.get(id);
    return row ? rowToEntry(row) : null;
  }

  // ── update ────────────────────────────────────────────────────────────

  function update(
    id: string,
    patch: Partial<Pick<MemoryEntry, 'text' | 'tags' | 'weight' | 'expires_at' | 'kind' | 'scope'>>,
  ): MemoryEntry | null {
    assertOpen();
    const existing = stmtGetById.get(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (patch.text !== undefined) { fields.push('text = ?'); values.push(patch.text); }
    if (patch.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(patch.tags)); }
    if (patch.weight !== undefined) { fields.push('weight = ?'); values.push(patch.weight); }
    if (patch.expires_at !== undefined) { fields.push('expires_at = ?'); values.push(patch.expires_at); }
    if (patch.kind !== undefined) { fields.push('kind = ?'); values.push(patch.kind); }
    if (patch.scope !== undefined) { fields.push('scope = ?'); values.push(patch.scope); }

    if (fields.length === 0) return rowToEntry(existing);

    const ts = now();
    fields.push('updated_at = ?');
    values.push(ts);
    values.push(id);

    db.prepare(`UPDATE memory_entries SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const updated = stmtGetById.get(id);
    return updated ? rowToEntry(updated) : null;
  }

  // ── delete ────────────────────────────────────────────────────────────

  function del(id: string): boolean {
    assertOpen();
    const info = stmtDeleteById.run(id);
    return info.changes > 0;
  }

  // ── query ─────────────────────────────────────────────────────────────

  function query(q?: MemoryQuery): MemoryEntry[] {
    assertOpen();
    const limit = q?.limit ?? 20;
    const includeExpired = q?.includeExpired ?? false;

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (q?.scope !== undefined) {
      clauses.push('scope = ?');
      params.push(q.scope);
    }

    if (q?.kind !== undefined) {
      const kinds = Array.isArray(q.kind) ? q.kind : [q.kind];
      clauses.push(`kind IN (${kinds.map(() => '?').join(', ')})`);
      params.push(...kinds);
    }

    if (q?.tags && q.tags.length > 0) {
      for (const tag of q.tags) {
        clauses.push(`tags LIKE ?`);
        params.push(`%"${tag}"%`);
      }
    }

    if (q?.since !== undefined) {
      clauses.push('updated_at >= ?');
      params.push(q.since.toISOString());
    }

    if (q?.until !== undefined) {
      clauses.push('updated_at <= ?');
      params.push(q.until.toISOString());
    }

    if (!includeExpired) {
      clauses.push('(expires_at IS NULL OR expires_at > ?)');
      params.push(now());
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `SELECT * FROM memory_entries ${where} ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare<unknown[], Row>(sql).all(...params);
    return rows.map(rowToEntry);
  }

  // ── search ────────────────────────────────────────────────────────────

  function search(text: string, opts?: { scope?: string; limit?: number }): MemoryEntry[] {
    assertOpen();
    const limit = opts?.limit ?? 20;
    const escaped = escapeFtsQuery(text);

    const scopeClause = opts?.scope !== undefined ? 'AND e.scope = ?' : '';
    const params: unknown[] = [escaped];
    if (opts?.scope !== undefined) params.push(opts.scope);
    params.push(now()); // for expiry check
    params.push(limit);

    const sql = `
      SELECT e.*
      FROM memory_fts f
      JOIN memory_entries e ON e.rowid = f.rowid
      WHERE memory_fts MATCH ?
        ${scopeClause}
        AND (e.expires_at IS NULL OR e.expires_at > ?)
      ORDER BY bm25(memory_fts) ASC, e.weight DESC
      LIMIT ?
    `;

    const rows = db.prepare<unknown[], Row>(sql).all(...params);
    return rows.map(rowToEntry);
  }

  // ── recordApplied ─────────────────────────────────────────────────────

  function recordApplied(id: string): void {
    assertOpen();
    const ts = now();
    db.prepare(`
      UPDATE memory_entries
      SET applied_count = applied_count + 1, updated_at = ?
      WHERE id = ?
    `).run(ts, id);
  }

  // ── prune ─────────────────────────────────────────────────────────────

  function prune(opts?: { olderThanDays?: number; maxRows?: number }): number {
    assertOpen();
    let deleted = 0;

    if (opts?.olderThanDays !== undefined) {
      const cutoff = new Date(Date.now() - opts.olderThanDays * 86_400_000).toISOString();
      const info = db.prepare(`DELETE FROM memory_entries WHERE updated_at < ?`).run(cutoff);
      deleted += info.changes;
    }

    if (opts?.maxRows !== undefined) {
      const info = db.prepare(`
        DELETE FROM memory_entries
        WHERE id NOT IN (
          SELECT id FROM memory_entries
          ORDER BY updated_at DESC
          LIMIT ?
        )
      `).run(opts.maxRows);
      deleted += info.changes;
    }

    return deleted;
  }

  // ── count ─────────────────────────────────────────────────────────────

  function count(): number {
    assertOpen();
    return (stmtCount.get() as { n: number }).n;
  }

  // ── close ─────────────────────────────────────────────────────────────

  function close(): void {
    closed = true;
    db.close();
  }

  // ── exportAll ─────────────────────────────────────────────────────────

  function exportAll(): MemoryEntry[] {
    assertOpen();
    const rows = db.prepare<[], Row>(`SELECT * FROM memory_entries ORDER BY created_at ASC`).all();
    return rows.map(rowToEntry);
  }

  // ── importMany ────────────────────────────────────────────────────────

  function importMany(entries: MemoryEntry[]): number {
    assertOpen();
    const stmt = db.prepare<[
      string, string, string, string, string, string, number, number, string, string, string | null
    ]>(`
      INSERT OR IGNORE INTO memory_entries
        (id, kind, text, source, scope, tags, weight, applied_count,
         created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((rows: MemoryEntry[]) => {
      let n = 0;
      for (const e of rows) {
        const info = stmt.run(
          e.id,
          e.kind,
          e.text,
          e.source,
          e.scope,
          JSON.stringify(e.tags ?? []),
          e.weight,
          e.applied_count,
          e.created_at,
          e.updated_at,
          e.expires_at ?? null,
        );
        n += info.changes;
      }
      return n;
    });

    return insertMany(entries) as number;
  }

  return { add, update, get, delete: del, query, search, recordApplied, prune, count, close, exportAll, importMany };
}
