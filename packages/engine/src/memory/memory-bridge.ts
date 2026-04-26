/**
 * memory-bridge.ts — FS ↔ SQLite memory synchronisation bridge.
 *
 * Keeps FreeClaude-style file-based memory (`.freeclaude/memory/*.md`) and
 * Pyrfor's SQLite-backed MemoryStore in sync.
 *
 * Direction modes:
 *   fs-to-db   — walk FS files, upsert into DB
 *   db-to-fs   — query DB records, write out as .md files
 *   two-way    — reconcile both sides via the configured conflict policy
 *
 * Watcher:
 *   start() / stop() wrap Node's fs.watch (recursive on macOS) with a
 *   per-file debounce driven by plain setTimeout — no extra dependencies.
 *
 * Production note:
 *   MemoryBridge depends on a MemoryStoreLike interface (see below) that is a
 *   strict subset of the MemoryStore public API.  The real createMemoryStore()
 *   return value satisfies it directly — cast as needed:
 *     new MemoryBridge({ store: realStore as unknown as MemoryStoreLike, … })
 *   If MemoryStore later exposes a typed sub-interface the cast can be removed.
 *   DO NOT modify memory-store.ts to accommodate this file.
 */

import * as fsSync from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../observability/logger.js';
import type { MemoryKind, MemoryEntry } from '../runtime/memory-store.js';

// ====== MemoryStoreLike =====================================================

/**
 * Minimal store surface that MemoryBridge requires.
 *
 * The real MemoryStore (runtime/memory-store.ts) satisfies this interface;
 * cast the store or supply a hand-rolled stub for testing.
 *
 * @see packages/engine/src/runtime/memory-store.ts — full MemoryStore type
 */
export interface MemoryStoreLike {
  add(
    input: Omit<MemoryEntry, 'id' | 'created_at' | 'updated_at' | 'applied_count'>,
  ): MemoryEntry;
  update(
    id: string,
    patch: Partial<Pick<MemoryEntry, 'text' | 'tags' | 'weight' | 'expires_at' | 'kind' | 'scope'>>,
  ): MemoryEntry | null;
  query(q?: {
    scope?: string;
    kind?: MemoryKind | MemoryKind[];
    tags?: string[];
    limit?: number;
    includeExpired?: boolean;
  }): MemoryEntry[];
}

// ====== Public types ========================================================

/** Options for constructing a MemoryBridge. */
export interface BridgeOptions {
  /** Absolute path to the directory containing .md memory files. */
  fsRoot: string;
  /** SQLite-backed memory store (or compatible stub). */
  store: MemoryStoreLike;
  /** Workspace identifier — used as a stable tag on every stored entry. */
  workspaceId: string;
  /** Scope written to / queried from the store. Default: 'memory-bridge'. */
  scope?: string;
  /** Sync direction. Default: 'two-way'. */
  direction?: 'fs-to-db' | 'db-to-fs' | 'two-way';
  /** Glob for files to include. Default: '**\/*.md'. Only .md extension is respected in the
   *  built-in walker; other glob patterns are currently ignored. */
  fileGlob?: string;
  /** Debounce window for FS watcher events in milliseconds. Default: 250. */
  debounceMs?: number;
  /** Conflict resolution policy when both sides have changed. Default: 'newest-wins'. */
  onConflict?: 'fs-wins' | 'db-wins' | 'newest-wins' | 'fail';
}

/** A scanned file from fsRoot. */
export interface BridgeFile {
  /** Path relative to fsRoot (forward slashes). */
  relPath: string;
  /** Absolute path. */
  absPath: string;
  /** sha256 hex of body text (frontmatter stripped). */
  contentHash: string;
  /** File body with frontmatter removed. */
  body: string;
  /** Key/value pairs from the leading YAML-ish '---' block. */
  frontmatter: Record<string, unknown>;
  /** Last-modified time as ISO string. */
  mtime: string;
}

/** Logical bridge record — the bridge's view of a DB entry. */
export interface BridgeRecord {
  /** Stable id derived from relPath: sha256(relPath).slice(0,16). */
  id: string;
  /** Path relative to fsRoot. */
  relPath: string;
  /** sha256 hex of body text at last sync. */
  contentHash: string;
  /** ISO timestamp of last DB update. */
  updatedAt: string;
}

// ====== Pure helpers ========================================================

/**
 * Parse a YAML-ish frontmatter block from the leading '---' … '---' section.
 * Supports string, boolean, integer, float, and simple bracketed arrays.
 */
export function parseFrontmatter(text: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const lines = text.split('\n');

  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: text };
  }

  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      closeIdx = i;
      break;
    }
  }

  if (closeIdx === -1) {
    return { frontmatter: {}, body: text };
  }

  const fmLines = lines.slice(1, closeIdx);
  const rawBody = lines.slice(closeIdx + 1).join('\n');
  // Drop a single leading newline that serializeFrontmatter inserts
  const body = rawBody.startsWith('\n') ? rawBody.slice(1) : rawBody;

  const frontmatter: Record<string, unknown> = {};
  for (const line of fmLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    if (raw === 'true') {
      frontmatter[key] = true;
    } else if (raw === 'false') {
      frontmatter[key] = false;
    } else if (/^\d+$/.test(raw)) {
      frontmatter[key] = Number(raw);
    } else if (/^\d+\.\d+$/.test(raw)) {
      frontmatter[key] = Number(raw);
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      const items = raw
        .slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''));
      frontmatter[key] = items;
    } else {
      frontmatter[key] = raw.replace(/^['"]|['"]$/g, '');
    }
  }

  return { frontmatter, body };
}

/**
 * Serialize a frontmatter map + body back into a .md string with a '---'
 * block.  Emits no header block when fm is empty.
 */
export function serializeFrontmatter(
  fm: Record<string, unknown>,
  body: string,
): string {
  const keys = Object.keys(fm);
  if (keys.length === 0) return body;

  const lines: string[] = ['---'];
  for (const key of keys) {
    const val = fm[key];
    if (Array.isArray(val)) {
      lines.push(`${key}: [${(val as unknown[]).map(String).join(', ')}]`);
    } else {
      lines.push(`${key}: ${String(val)}`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(body);
  return lines.join('\n');
}

/** sha256 hex digest of body text. */
export function computeContentHash(body: string): string {
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Stable 16-hex-char ID derived from a relative path. */
export function stableIdForPath(relPath: string): string {
  return crypto.createHash('sha256').update(relPath, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Determine which side wins a content conflict.
 *
 * Returns:
 *   'equal'    — both sides have the same hash (no real conflict)
 *   'fs'       — FS content should win
 *   'db'       — DB content should win
 *   'conflict' — policy is 'fail'; caller must increment the conflict counter
 */
export function resolveConflict(
  fs: { hash: string; mtime: string },
  db: { hash: string; mtime: string },
  policy: 'fs-wins' | 'db-wins' | 'newest-wins' | 'fail',
): 'fs' | 'db' | 'equal' | 'conflict' {
  if (fs.hash === db.hash) return 'equal';

  switch (policy) {
    case 'fs-wins':
      return 'fs';
    case 'db-wins':
      return 'db';
    case 'newest-wins': {
      const fsTime = new Date(fs.mtime).getTime();
      const dbTime = new Date(db.mtime).getTime();
      return fsTime >= dbTime ? 'fs' : 'db';
    }
    case 'fail':
      return 'conflict';
  }
}

// ====== Internal constants & helpers ========================================

const VALID_KINDS: readonly MemoryKind[] = [
  'fact',
  'preference',
  'episode',
  'reference',
  'lesson',
] as const;

const DEFAULT_KIND: MemoryKind = 'reference';

function isValidKind(k: unknown): k is MemoryKind {
  return typeof k === 'string' && (VALID_KINDS as readonly string[]).includes(k);
}

function tagRelPath(relPath: string): string {
  return `bridge:relPath:${relPath}`;
}

function tagWorkspace(workspaceId: string): string {
  return `bridge:workspace:${workspaceId}`;
}

function tagHash(hash: string): string {
  return `bridge:hash:${hash}`;
}

/** Recursively collect all .md files under dir. */
async function walkMd(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: fsSync.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkMd(full)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

// ====== MemoryBridge class ==================================================

type ChangeEvent = { type: 'added' | 'changed' | 'deleted'; relPath: string };
type ChangeCallback = (e: ChangeEvent) => void;

/** Sync result returned by syncOnce(). */
export interface SyncResult {
  scanned: number;
  written: number;
  updated: number;
  skipped: number;
  conflicts: number;
}

/**
 * MemoryBridge — bidirectional sync between a directory of .md files and a
 * SQLite-backed MemoryStore.
 *
 * @example
 * ```ts
 * const bridge = new MemoryBridge({
 *   fsRoot: '/workspace/.freeclaude/memory',
 *   store: createMemoryStore() as unknown as MemoryStoreLike,
 *   workspaceId: 'my-workspace',
 * });
 * await bridge.syncOnce();
 * await bridge.start();       // begin watching
 * const unsub = bridge.onChange(e => console.log(e));
 * // … later …
 * await bridge.stop();
 * ```
 */
export class MemoryBridge {
  private readonly opts: Required<BridgeOptions>;
  private callbacks: Set<ChangeCallback> = new Set();
  private watcher: fsSync.FSWatcher | null = null;

  constructor(opts: BridgeOptions) {
    this.opts = {
      scope: 'memory-bridge',
      direction: 'two-way',
      fileGlob: '**/*.md',
      debounceMs: 250,
      onConflict: 'newest-wins',
      ...opts,
    };
  }

  // ====== syncOnce ===========================================================

  /**
   * Perform a single synchronisation pass.
   *
   * @returns Counts of scanned files/entries, written, updated, skipped,
   *          and conflict-blocked items.
   */
  async syncOnce(): Promise<SyncResult> {
    const stats: SyncResult = {
      scanned: 0,
      written: 0,
      updated: 0,
      skipped: 0,
      conflicts: 0,
    };

    const { direction, onConflict, scope, workspaceId } = this.opts;

    // ── FS → DB (and two-way FS side) ────────────────────────────────────
    if (direction === 'fs-to-db' || direction === 'two-way') {
      const files = await this._scanFiles();
      stats.scanned = files.length;

      for (const file of files) {
        const existing = this._findDbRecord(file.relPath);

        if (!existing) {
          this._writeToDb(file);
          stats.written++;
          logger.debug('[MemoryBridge] wrote new file to DB', { relPath: file.relPath });
          continue;
        }

        const dbHash = this._extractHash(existing);

        if (dbHash === file.contentHash) {
          stats.skipped++;
          continue;
        }

        if (direction === 'fs-to-db') {
          // Always take FS in unidirectional mode
          this._updateInDb(existing.id, file);
          stats.updated++;
          logger.debug('[MemoryBridge] updated DB entry from FS', { relPath: file.relPath });
        } else {
          // two-way: apply conflict policy
          const winner = resolveConflict(
            { hash: file.contentHash, mtime: file.mtime },
            { hash: dbHash, mtime: existing.updated_at },
            onConflict,
          );

          if (winner === 'equal') {
            stats.skipped++;
          } else if (winner === 'fs') {
            this._updateInDb(existing.id, file);
            stats.updated++;
            logger.debug('[MemoryBridge] two-way: FS won conflict', { relPath: file.relPath });
          } else if (winner === 'db') {
            await this._writeToFs(file.relPath, existing);
            stats.updated++;
            logger.debug('[MemoryBridge] two-way: DB won conflict', { relPath: file.relPath });
          } else {
            stats.conflicts++;
            logger.warn('[MemoryBridge] conflict skipped (policy=fail)', {
              relPath: file.relPath,
            });
          }
        }
      }
    }

    // ── DB → FS ──────────────────────────────────────────────────────────
    if (direction === 'db-to-fs') {
      const entries = this.opts.store.query({
        scope,
        tags: [tagWorkspace(workspaceId)],
        limit: 10_000,
        includeExpired: true,
      });

      stats.scanned = entries.length;

      for (const entry of entries) {
        const relPath = this._extractRelPath(entry);
        if (!relPath) continue;

        const absPath = path.join(this.opts.fsRoot, relPath);
        let diskHash: string | undefined;

        try {
          const diskContent = await fsp.readFile(absPath, 'utf8');
          diskHash = computeContentHash(diskContent);
        } catch {
          // file not yet on disk — treat as new
        }

        const dbHash = this._extractHash(entry);

        if (diskHash !== undefined && diskHash === dbHash) {
          stats.skipped++;
          continue;
        }

        await this._writeToFs(relPath, entry);
        logger.debug('[MemoryBridge] wrote DB entry to FS', { relPath });

        if (diskHash !== undefined) {
          stats.updated++;
        } else {
          stats.written++;
        }
      }
    }

    logger.info('[MemoryBridge] syncOnce complete', stats);
    return stats;
  }

  // ====== start / stop =======================================================

  /**
   * Begin watching fsRoot for .md changes with a per-file debounce.
   * Uses Node's fs.watch with { recursive: true } (macOS / Windows).
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async start(): Promise<void> {
    if (this.watcher) return;

    await fsp.mkdir(this.opts.fsRoot, { recursive: true });

    const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();

    this.watcher = fsSync.watch(
      this.opts.fsRoot,
      { recursive: true },
      (eventType, filename) => {
        if (!filename) return;
        const relPath = filename.replace(/\\/g, '/');
        if (!relPath.endsWith('.md')) return;

        const pending = debounceMap.get(relPath);
        if (pending) clearTimeout(pending);

        debounceMap.set(
          relPath,
          setTimeout(async () => {
            debounceMap.delete(relPath);
            const absPath = path.join(this.opts.fsRoot, relPath);
            let type: 'added' | 'changed' | 'deleted';
            try {
              await fsp.access(absPath);
              const tracked = this._findDbRecord(relPath);
              type = tracked ? 'changed' : 'added';
            } catch {
              type = 'deleted';
            }
            this._emit({ type, relPath });
          }, this.opts.debounceMs),
        );
      },
    );

    logger.info('[MemoryBridge] watcher started', { fsRoot: this.opts.fsRoot });
  }

  /** Stop the FS watcher. Safe to call when not running. */
  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('[MemoryBridge] watcher stopped');
    }
  }

  /**
   * Subscribe to FS change events emitted after the debounce window.
   * Returns an unsubscribe function.
   */
  onChange(cb: ChangeCallback): () => void {
    this.callbacks.add(cb);
    return () => {
      this.callbacks.delete(cb);
    };
  }

  // ====== Private helpers ====================================================

  private _emit(e: ChangeEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb(e);
      } catch {
        /* silence callback errors */
      }
    }
  }

  private async _scanFiles(): Promise<BridgeFile[]> {
    const absPaths = await walkMd(this.opts.fsRoot);
    const files: BridgeFile[] = [];

    for (const absPath of absPaths) {
      const relPath = path.relative(this.opts.fsRoot, absPath).replace(/\\/g, '/');
      try {
        const raw = await fsp.readFile(absPath, 'utf8');
        const stat = await fsp.stat(absPath);
        const { frontmatter, body } = parseFrontmatter(raw);
        const contentHash = computeContentHash(body);
        files.push({
          relPath,
          absPath,
          contentHash,
          body,
          frontmatter,
          mtime: stat.mtime.toISOString(),
        });
      } catch {
        logger.warn('[MemoryBridge] could not read file', { absPath });
      }
    }

    return files;
  }

  private _findDbRecord(relPath: string): MemoryEntry | null {
    const results = this.opts.store.query({
      scope: this.opts.scope,
      tags: [tagRelPath(relPath)],
      limit: 1,
      includeExpired: true,
    });
    return results[0] ?? null;
  }

  private _extractHash(entry: MemoryEntry): string {
    const hashTag = entry.tags.find(t => t.startsWith('bridge:hash:'));
    return hashTag ? hashTag.slice('bridge:hash:'.length) : computeContentHash(entry.text);
  }

  private _extractRelPath(entry: MemoryEntry): string | null {
    const tag = entry.tags.find(t => t.startsWith('bridge:relPath:'));
    return tag ? tag.slice('bridge:relPath:'.length) : null;
  }

  private _buildTags(file: BridgeFile): string[] {
    return [
      tagRelPath(file.relPath),
      tagWorkspace(this.opts.workspaceId),
      tagHash(file.contentHash),
    ];
  }

  private _writeToDb(file: BridgeFile): MemoryEntry {
    const { scope } = this.opts;
    const kind: MemoryKind = isValidKind(file.frontmatter.kind)
      ? file.frontmatter.kind
      : DEFAULT_KIND;

    return this.opts.store.add({
      kind,
      text: file.body,
      source: 'memory-bridge',
      scope,
      tags: this._buildTags(file),
      weight: 0.5,
    });
  }

  private _updateInDb(entryId: string, file: BridgeFile): MemoryEntry | null {
    return this.opts.store.update(entryId, {
      text: file.body,
      tags: this._buildTags(file),
    });
  }

  private async _writeToFs(relPath: string, entry: MemoryEntry): Promise<void> {
    const absPath = path.join(this.opts.fsRoot, relPath);
    await fsp.mkdir(path.dirname(absPath), { recursive: true });

    const fm: Record<string, unknown> = {
      id: stableIdForPath(relPath),
      kind: entry.kind,
      source: entry.source,
      scope: entry.scope,
      updatedAt: entry.updated_at,
    };

    const content = serializeFrontmatter(fm, entry.text);
    await fsp.writeFile(absPath, content, 'utf8');
  }
}
