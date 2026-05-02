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
import type { MemoryKind, MemoryEntry } from '../runtime/memory-store.js';
/**
 * Minimal store surface that MemoryBridge requires.
 *
 * The real MemoryStore (runtime/memory-store.ts) satisfies this interface;
 * cast the store or supply a hand-rolled stub for testing.
 *
 * @see packages/engine/src/runtime/memory-store.ts — full MemoryStore type
 */
export interface MemoryStoreLike {
    add(input: Omit<MemoryEntry, 'id' | 'created_at' | 'updated_at' | 'applied_count'>): MemoryEntry;
    update(id: string, patch: Partial<Pick<MemoryEntry, 'text' | 'tags' | 'weight' | 'expires_at' | 'kind' | 'scope'>>): MemoryEntry | null;
    query(q?: {
        scope?: string;
        kind?: MemoryKind | MemoryKind[];
        tags?: string[];
        limit?: number;
        includeExpired?: boolean;
    }): MemoryEntry[];
}
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
/**
 * Parse a YAML-ish frontmatter block from the leading '---' … '---' section.
 * Supports string, boolean, integer, float, and simple bracketed arrays.
 */
export declare function parseFrontmatter(text: string): {
    frontmatter: Record<string, unknown>;
    body: string;
};
/**
 * Serialize a frontmatter map + body back into a .md string with a '---'
 * block.  Emits no header block when fm is empty.
 */
export declare function serializeFrontmatter(fm: Record<string, unknown>, body: string): string;
/** sha256 hex digest of body text. */
export declare function computeContentHash(body: string): string;
/** Stable 16-hex-char ID derived from a relative path. */
export declare function stableIdForPath(relPath: string): string;
/**
 * Determine which side wins a content conflict.
 *
 * Returns:
 *   'equal'    — both sides have the same hash (no real conflict)
 *   'fs'       — FS content should win
 *   'db'       — DB content should win
 *   'conflict' — policy is 'fail'; caller must increment the conflict counter
 */
export declare function resolveConflict(fs: {
    hash: string;
    mtime: string;
}, db: {
    hash: string;
    mtime: string;
}, policy: 'fs-wins' | 'db-wins' | 'newest-wins' | 'fail'): 'fs' | 'db' | 'equal' | 'conflict';
type ChangeEvent = {
    type: 'added' | 'changed' | 'deleted';
    relPath: string;
};
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
export declare class MemoryBridge {
    private readonly opts;
    private callbacks;
    private watcher;
    constructor(opts: BridgeOptions);
    /**
     * Perform a single synchronisation pass.
     *
     * @returns Counts of scanned files/entries, written, updated, skipped,
     *          and conflict-blocked items.
     */
    syncOnce(): Promise<SyncResult>;
    /**
     * Begin watching fsRoot for .md changes with a per-file debounce.
     * Uses Node's fs.watch with { recursive: true } (macOS / Windows).
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    start(): Promise<void>;
    /** Stop the FS watcher. Safe to call when not running. */
    stop(): Promise<void>;
    /**
     * Subscribe to FS change events emitted after the debounce window.
     * Returns an unsubscribe function.
     */
    onChange(cb: ChangeCallback): () => void;
    private _emit;
    private _scanFiles;
    private _findDbRecord;
    private _extractHash;
    private _extractRelPath;
    private _buildTags;
    private _writeToDb;
    private _updateInDb;
    private _writeToFs;
}
export {};
//# sourceMappingURL=memory-bridge.d.ts.map