/**
 * file-sync.ts — Two-way file synchronisation between the local workspace and
 * the Pyrfor daemon (Sprint 2 #1).
 *
 * Pure Node module — no 'vscode' import so it can be unit-tested with vitest.
 * Wire into the VSCode extension lifecycle from extension.ts after Sprint 2.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Minimal subset of DaemonClient required by FileSync.
 * Adapted to match the actual public surface of DaemonClient:
 *   - send(msg: object): void          (fire-and-forget JSON write)
 *   - on / off                         (EventEmitter API)
 *   - state: string                    ('open' when connected)
 */
export interface DaemonClientLike {
  send(msg: object): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
  /** 'open' when the WebSocket connection to the daemon is live. */
  state: string;
}

export interface FileSyncOptions {
  /** DaemonClient instance or any compatible implementation. */
  daemon: DaemonClientLike;
  workspaceRoot: string;
  /** File-extension suffixes to include. Default: common code/config types. */
  include?: string[];
  /** Path substrings that trigger exclusion. */
  exclude?: string[];
  /** Skip push for files larger than this byte count. Default 512 000. */
  maxFileBytes?: number;
  /** Debounce delay for fs.watch events, in ms. Default 200. */
  debounceMs?: number;
}

export interface FileChange {
  type: 'created' | 'modified' | 'deleted';
  relPath: string;
  absPath: string;
  size?: number;
  sha256?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INCLUDE: readonly string[] = [
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonc',
  '.md', '.mdx',
  '.yaml', '.yml',
  '.toml', '.env',
  '.py', '.go', '.rs', '.rb',
  '.sh', '.bash', '.zsh',
  '.txt', '.csv',
  '.html', '.css', '.scss',
];

const DEFAULT_EXCLUDE: readonly string[] = [
  'node_modules/', '/.git/', 'dist/', 'build/',
];

const DEFAULT_MAX_FILE_BYTES = 512_000;
const DEFAULT_DEBOUNCE_MS = 200;
const MAX_QUEUE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Returns true when relPath should participate in sync. */
export function shouldInclude(
  relPath: string,
  include: string[],
  exclude: string[],
): boolean {
  const norm = normalizeRelPath(relPath);
  for (const ex of exclude) {
    if (norm.includes(ex)) return false;
  }
  for (const inc of include) {
    if (norm.endsWith(inc)) return true;
  }
  return false;
}

/** SHA-256 hex digest of buf. */
export function computeFileHash(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Normalise a relative path: backslashes → forward slashes, strip leading './'. */
export function normalizeRelPath(p: string): string {
  let result = p.replace(/\\/g, '/');
  while (result.startsWith('./')) result = result.slice(2);
  return result;
}

// ---------------------------------------------------------------------------
// FileSync
// ---------------------------------------------------------------------------

export class FileSync {
  private readonly _daemon: DaemonClientLike;
  private readonly _root: string;
  private readonly _include: string[];
  private readonly _exclude: string[];
  private readonly _maxFileBytes: number;
  private readonly _debounceMs: number;

  private _running = false;
  private _paused = false;

  /** Last-seen sha256 per normalised relPath — loop-prevention + change detection. */
  private readonly _knownHashes = new Map<string, string>();

  private readonly _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Bounded outgoing queue used when daemon is disconnected or sync is paused. */
  private _pushQueue: Array<{ relPath: string }> = [];

  private readonly _localEmitter = new EventEmitter();
  private readonly _remoteEmitter = new EventEmitter();

  // Stored listener references so we can unregister them in stop().
  private _msgListener: ((...args: unknown[]) => void) | null = null;
  private _openListener: ((...args: unknown[]) => void) | null = null;
  private _watcher: fs.FSWatcher | null = null;

  constructor(opts: FileSyncOptions) {
    this._daemon = opts.daemon;
    this._root = opts.workspaceRoot;
    this._include = opts.include ?? [...DEFAULT_INCLUDE];
    this._exclude = opts.exclude ?? [...DEFAULT_EXCLUDE];
    this._maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this._debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;

    this._msgListener = (...args: unknown[]) => {
      void this._handleDaemonMessage(args[0]);
    };
    this._openListener = () => {
      void this._flushQueue();
    };

    this._daemon.on('message', this._msgListener);
    this._daemon.on('open', this._openListener);

    this._startWatcher();
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;

    this._watcher?.close();
    this._watcher = null;

    for (const t of this._debounceTimers.values()) clearTimeout(t);
    this._debounceTimers.clear();

    if (this._msgListener) {
      this._daemon.off('message', this._msgListener);
      this._msgListener = null;
    }
    if (this._openListener) {
      this._daemon.off('open', this._openListener);
      this._openListener = null;
    }
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    void this._flushQueue();
  }

  // ── Event subscriptions ───────────────────────────────────────────────────

  onLocalChange(cb: (c: FileChange) => void): () => void {
    this._localEmitter.on('change', cb);
    return () => this._localEmitter.off('change', cb);
  }

  onRemoteChange(cb: (c: FileChange) => void): () => void {
    this._remoteEmitter.on('change', cb);
    return () => this._remoteEmitter.off('change', cb);
  }

  // ── Push / Pull ───────────────────────────────────────────────────────────

  async pushFile(relPath: string): Promise<void> {
    const norm = normalizeRelPath(relPath);
    if (!shouldInclude(norm, this._include, this._exclude)) return;

    const abs = path.join(this._root, norm);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(abs);
    } catch {
      return; // File deleted or inaccessible — skip silently
    }

    if (stat.size > this._maxFileBytes) {
      console.warn(`[FileSync] skip push ${norm}: ${stat.size} B > limit ${this._maxFileBytes} B`);
      return;
    }

    let buf: Buffer;
    try {
      buf = await fs.promises.readFile(abs);
    } catch (err) {
      console.warn(`[FileSync] read error ${norm}:`, err);
      return;
    }

    const sha256 = computeFileHash(buf);
    if (this._knownHashes.get(norm) === sha256) return; // No change

    if (!this._isDaemonOpen()) {
      // Don't record the hash — _flushQueue must re-attempt and reach the send
      this._enqueue({ relPath: norm });
      return;
    }

    try {
      this._daemon.send({
        type: 'file.upsert',
        relPath: norm,
        content: buf.toString('base64'),
        sha256,
      });
      this._knownHashes.set(norm, sha256);
    } catch (err) {
      console.warn(`[FileSync] send error ${norm}:`, err);
      this._enqueue({ relPath: norm });
    }
  }

  async pullFile(relPath: string): Promise<void> {
    const norm = normalizeRelPath(relPath);
    const abs = path.join(this._root, norm);

    let response: unknown;
    try {
      response = await this._request('file.fetch', { relPath: norm }, 'file.fetch.result');
    } catch (err) {
      console.warn(`[FileSync] pull error ${norm}:`, err);
      return;
    }

    const m = response as Record<string, unknown>;
    const content = m.content as string | undefined;
    if (!content) {
      console.warn(`[FileSync] no content received for ${norm}`);
      return;
    }

    const buf = Buffer.from(content, 'base64');
    const hash = computeFileHash(buf);

    if (this._knownHashes.get(norm) === hash) return; // Already up-to-date

    try {
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      await fs.promises.writeFile(abs, buf);
      this._knownHashes.set(norm, hash);
    } catch (err) {
      console.warn(`[FileSync] write error ${norm}:`, err);
    }
  }

  async syncAll(): Promise<{ pushed: number; pulled: number; skipped: number }> {
    let pushed = 0, pulled = 0, skipped = 0;

    // ── 1. Fetch daemon file list ──────────────────────────────────────────
    let daemonFiles: Array<{ relPath: string; sha256?: string; mtime?: number }> = [];
    try {
      const res = await this._request('file.list', {}, 'file.list.result') as Record<string, unknown>;
      daemonFiles = (res.files as typeof daemonFiles) ?? [];
    } catch (err) {
      console.warn('[FileSync] syncAll: failed to list daemon files:', err);
    }

    const daemonMap = new Map<string, { sha256?: string; mtime?: number }>();
    for (const f of daemonFiles) {
      daemonMap.set(normalizeRelPath(f.relPath), { sha256: f.sha256, mtime: f.mtime });
    }

    // ── 2. Scan local workspace ────────────────────────────────────────────
    const localFiles = await this._scanLocal();
    const localSet = new Set<string>();

    for (const f of localFiles) {
      localSet.add(f.relPath);
      const d = daemonMap.get(f.relPath);

      if (!d) {
        // Local-only → push
        await this.pushFile(f.relPath);
        pushed++;
        continue;
      }

      // Both sides have the file — compare
      let buf: Buffer;
      try {
        buf = await fs.promises.readFile(f.absPath);
      } catch {
        skipped++;
        continue;
      }

      const localHash = computeFileHash(buf);

      if (d.sha256 && d.sha256 === localHash) {
        skipped++; // Identical content
      } else if (d.mtime !== undefined && f.mtime > d.mtime) {
        await this.pushFile(f.relPath);
        pushed++;
      } else if (d.mtime !== undefined && d.mtime > f.mtime) {
        await this.pullFile(f.relPath);
        pulled++;
      } else {
        skipped++; // Can't determine direction safely
      }
    }

    // ── 3. Daemon-only files → pull ────────────────────────────────────────
    for (const [rel] of daemonMap) {
      if (!localSet.has(rel)) {
        await this.pullFile(rel);
        pulled++;
      }
    }

    return { pushed, pulled, skipped };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _isDaemonOpen(): boolean {
    return this._daemon.state === 'open';
  }

  private _enqueue(item: { relPath: string }): void {
    if (this._pushQueue.length >= MAX_QUEUE_SIZE) {
      console.warn('[FileSync] push queue full, dropping oldest item');
      this._pushQueue.shift();
    }
    this._pushQueue.push(item);
  }

  private async _flushQueue(): Promise<void> {
    if (!this._isDaemonOpen()) return;
    const items = this._pushQueue.splice(0, this._pushQueue.length);
    for (const item of items) {
      await this.pushFile(item.relPath);
    }
  }

  private _startWatcher(): void {
    try {
      const watcher = fs.watch(this._root, { recursive: true });

      const onFsEvent = (
        _evtType: string,
        filename: fs.PathLike | null,
      ): void => {
        if (!filename || typeof filename !== 'string') return;
        const rel = normalizeRelPath(filename);
        if (!shouldInclude(rel, this._include, this._exclude)) return;
        this._debouncePath(rel);
      };
      watcher.on('change', onFsEvent);
      watcher.on('rename', onFsEvent);

      watcher.on('error', (err: Error) => {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ABORT_ERR') console.warn('[FileSync] watcher error:', err);
      });

      this._watcher = watcher;
    } catch (err) {
      console.warn('[FileSync] failed to start file watcher:', err);
    }
  }

  private _debouncePath(relPath: string): void {
    const existing = this._debounceTimers.get(relPath);
    if (existing) clearTimeout(existing);

    this._debounceTimers.set(
      relPath,
      setTimeout(() => {
        this._debounceTimers.delete(relPath);
        if (this._paused) {
          this._enqueue({ relPath });
          return;
        }
        void this._handleLocalChange(relPath);
      }, this._debounceMs),
    );
  }

  private async _handleLocalChange(relPath: string): Promise<void> {
    const abs = path.join(this._root, relPath);
    let stat: fs.Stats | null = null;
    let buf: Buffer | null = null;
    let changeType: FileChange['type'] = 'modified';

    try {
      stat = await fs.promises.stat(abs);
      buf = await fs.promises.readFile(abs);
    } catch {
      changeType = 'deleted';
    }

    let sha256: string | undefined;
    if (buf) {
      sha256 = computeFileHash(buf);
      if (this._knownHashes.get(relPath) === sha256) return; // Loop-prevention
      // Don't record the hash here — pushFile() owns that after a successful send,
      // otherwise pushFile would short-circuit on its own no-change guard.
    } else {
      this._knownHashes.delete(relPath);
    }

    const change: FileChange = {
      type: changeType,
      relPath,
      absPath: abs,
      size: stat?.size,
      sha256,
    };
    this._localEmitter.emit('change', change);

    if (changeType !== 'deleted') {
      await this.pushFile(relPath);
    }
  }

  private async _handleDaemonMessage(raw: unknown): Promise<void> {
    if (!isPlainObj(raw)) return;
    const m = raw as Record<string, unknown>;
    if (m.type !== 'file.update') return;

    const relPath = normalizeRelPath(String(m.relPath ?? ''));
    if (!relPath) return;

    const sha256 = m.sha256 as string | undefined;
    const content = m.content as string | undefined;

    // Loop-prevention: if we already hold this hash, skip
    if (sha256 && this._knownHashes.get(relPath) === sha256) return;

    const abs = path.join(this._root, relPath);

    if (content) {
      const buf = Buffer.from(content, 'base64');
      const hash = computeFileHash(buf);

      if (this._knownHashes.get(relPath) === hash) return; // Already have it

      try {
        await fs.promises.mkdir(path.dirname(abs), { recursive: true });
        await fs.promises.writeFile(abs, buf);
        this._knownHashes.set(relPath, hash);
      } catch (err) {
        console.warn(`[FileSync] remote write error ${relPath}:`, err);
        return;
      }
    }

    const change: FileChange = {
      type: (m.changeType as FileChange['type']) ?? 'modified',
      relPath,
      absPath: abs,
      size: typeof m.size === 'number' ? m.size : undefined,
      sha256,
    };
    this._remoteEmitter.emit('change', change);
  }

  /**
   * Send a typed request to the daemon and await the first response whose
   * `type` field matches `responseType`. Times out after REQUEST_TIMEOUT_MS.
   */
  private _request(
    type: string,
    payload: object,
    responseType: string,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        clearTimeout(timer);
        this._daemon.off('message', handler);
      };

      const handler = (...args: unknown[]): void => {
        if (settled) return;
        const msg = args[0];
        if (isPlainObj(msg) && (msg as Record<string, unknown>).type === responseType) {
          settled = true;
          cleanup();
          resolve(msg);
        }
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`[FileSync] timeout waiting for ${responseType}`));
      }, REQUEST_TIMEOUT_MS);

      this._daemon.on('message', handler);

      try {
        this._daemon.send({ type, ...payload });
      } catch (err) {
        settled = true;
        cleanup();
        reject(err);
      }
    });
  }

  private async _scanLocal(): Promise<
    Array<{ relPath: string; absPath: string; mtime: number; size: number }>
  > {
    const results: Array<{
      relPath: string;
      absPath: string;
      mtime: number;
      size: number;
    }> = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        const rel = normalizeRelPath(path.relative(this._root, abs));

        if (entry.isDirectory()) {
          const dirSlash = rel + '/';
          const excluded = this._exclude.some(
            (ex) => dirSlash.includes(ex) || (rel + '/') === ex,
          );
          if (!excluded) await walk(abs);
        } else if (
          entry.isFile() &&
          shouldInclude(rel, this._include, this._exclude)
        ) {
          try {
            const st = await fs.promises.stat(abs);
            results.push({ relPath: rel, absPath: abs, mtime: st.mtimeMs, size: st.size });
          } catch {
            /* skip inaccessible files */
          }
        }
      }
    };

    await walk(this._root);
    return results;
  }
}

// ---------------------------------------------------------------------------
// Internal utility
// ---------------------------------------------------------------------------

function isPlainObj(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
