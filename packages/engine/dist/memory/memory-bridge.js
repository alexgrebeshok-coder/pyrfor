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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as fsSync from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../observability/logger.js';
// ====== Pure helpers ========================================================
/**
 * Parse a YAML-ish frontmatter block from the leading '---' … '---' section.
 * Supports string, boolean, integer, float, and simple bracketed arrays.
 */
export function parseFrontmatter(text) {
    var _a, _b;
    const lines = text.split('\n');
    if (((_a = lines[0]) === null || _a === void 0 ? void 0 : _a.trim()) !== '---') {
        return { frontmatter: {}, body: text };
    }
    let closeIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (((_b = lines[i]) === null || _b === void 0 ? void 0 : _b.trim()) === '---') {
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
    const frontmatter = {};
    for (const line of fmLines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        const raw = line.slice(colonIdx + 1).trim();
        if (!key)
            continue;
        if (raw === 'true') {
            frontmatter[key] = true;
        }
        else if (raw === 'false') {
            frontmatter[key] = false;
        }
        else if (/^\d+$/.test(raw)) {
            frontmatter[key] = Number(raw);
        }
        else if (/^\d+\.\d+$/.test(raw)) {
            frontmatter[key] = Number(raw);
        }
        else if (raw.startsWith('[') && raw.endsWith(']')) {
            const items = raw
                .slice(1, -1)
                .split(',')
                .map(s => s.trim().replace(/^['"]|['"]$/g, ''));
            frontmatter[key] = items;
        }
        else {
            frontmatter[key] = raw.replace(/^['"]|['"]$/g, '');
        }
    }
    return { frontmatter, body };
}
/**
 * Serialize a frontmatter map + body back into a .md string with a '---'
 * block.  Emits no header block when fm is empty.
 */
export function serializeFrontmatter(fm, body) {
    const keys = Object.keys(fm);
    if (keys.length === 0)
        return body;
    const lines = ['---'];
    for (const key of keys) {
        const val = fm[key];
        if (Array.isArray(val)) {
            lines.push(`${key}: [${val.map(String).join(', ')}]`);
        }
        else {
            lines.push(`${key}: ${String(val)}`);
        }
    }
    lines.push('---');
    lines.push('');
    lines.push(body);
    return lines.join('\n');
}
/** sha256 hex digest of body text. */
export function computeContentHash(body) {
    return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}
/** Stable 16-hex-char ID derived from a relative path. */
export function stableIdForPath(relPath) {
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
export function resolveConflict(fs, db, policy) {
    if (fs.hash === db.hash)
        return 'equal';
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
const VALID_KINDS = [
    'fact',
    'preference',
    'episode',
    'reference',
    'lesson',
];
const DEFAULT_KIND = 'reference';
function isValidKind(k) {
    return typeof k === 'string' && VALID_KINDS.includes(k);
}
function tagRelPath(relPath) {
    return `bridge:relPath:${relPath}`;
}
function tagWorkspace(workspaceId) {
    return `bridge:workspace:${workspaceId}`;
}
function tagHash(hash) {
    return `bridge:hash:${hash}`;
}
/** Recursively collect all .md files under dir. */
function walkMd(dir) {
    return __awaiter(this, void 0, void 0, function* () {
        const results = [];
        let entries;
        try {
            entries = yield fsp.readdir(dir, { withFileTypes: true });
        }
        catch (_a) {
            return results;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...(yield walkMd(full)));
            }
            else if (entry.isFile() && entry.name.endsWith('.md')) {
                results.push(full);
            }
        }
        return results;
    });
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
    constructor(opts) {
        this.callbacks = new Set();
        this.watcher = null;
        this.opts = Object.assign({ scope: 'memory-bridge', direction: 'two-way', fileGlob: '**/*.md', debounceMs: 250, onConflict: 'newest-wins' }, opts);
    }
    // ====== syncOnce ===========================================================
    /**
     * Perform a single synchronisation pass.
     *
     * @returns Counts of scanned files/entries, written, updated, skipped,
     *          and conflict-blocked items.
     */
    syncOnce() {
        return __awaiter(this, void 0, void 0, function* () {
            const stats = {
                scanned: 0,
                written: 0,
                updated: 0,
                skipped: 0,
                conflicts: 0,
            };
            const { direction, onConflict, scope, workspaceId } = this.opts;
            // ── FS → DB (and two-way FS side) ────────────────────────────────────
            if (direction === 'fs-to-db' || direction === 'two-way') {
                const files = yield this._scanFiles();
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
                    }
                    else {
                        // two-way: apply conflict policy
                        const winner = resolveConflict({ hash: file.contentHash, mtime: file.mtime }, { hash: dbHash, mtime: existing.updated_at }, onConflict);
                        if (winner === 'equal') {
                            stats.skipped++;
                        }
                        else if (winner === 'fs') {
                            this._updateInDb(existing.id, file);
                            stats.updated++;
                            logger.debug('[MemoryBridge] two-way: FS won conflict', { relPath: file.relPath });
                        }
                        else if (winner === 'db') {
                            yield this._writeToFs(file.relPath, existing);
                            stats.updated++;
                            logger.debug('[MemoryBridge] two-way: DB won conflict', { relPath: file.relPath });
                        }
                        else {
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
                    limit: 10000,
                    includeExpired: true,
                });
                stats.scanned = entries.length;
                for (const entry of entries) {
                    const relPath = this._extractRelPath(entry);
                    if (!relPath)
                        continue;
                    const absPath = path.join(this.opts.fsRoot, relPath);
                    let diskHash;
                    try {
                        const diskContent = yield fsp.readFile(absPath, 'utf8');
                        diskHash = computeContentHash(diskContent);
                    }
                    catch (_a) {
                        // file not yet on disk — treat as new
                    }
                    const dbHash = this._extractHash(entry);
                    if (diskHash !== undefined && diskHash === dbHash) {
                        stats.skipped++;
                        continue;
                    }
                    yield this._writeToFs(relPath, entry);
                    logger.debug('[MemoryBridge] wrote DB entry to FS', { relPath });
                    if (diskHash !== undefined) {
                        stats.updated++;
                    }
                    else {
                        stats.written++;
                    }
                }
            }
            logger.info('[MemoryBridge] syncOnce complete', stats);
            return stats;
        });
    }
    // ====== start / stop =======================================================
    /**
     * Begin watching fsRoot for .md changes with a per-file debounce.
     * Uses Node's fs.watch with { recursive: true } (macOS / Windows).
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.watcher)
                return;
            yield fsp.mkdir(this.opts.fsRoot, { recursive: true });
            const debounceMap = new Map();
            this.watcher = fsSync.watch(this.opts.fsRoot, { recursive: true }, (eventType, filename) => {
                if (!filename)
                    return;
                const relPath = filename.replace(/\\/g, '/');
                if (!relPath.endsWith('.md'))
                    return;
                const pending = debounceMap.get(relPath);
                if (pending)
                    clearTimeout(pending);
                debounceMap.set(relPath, setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                    debounceMap.delete(relPath);
                    const absPath = path.join(this.opts.fsRoot, relPath);
                    let type;
                    try {
                        yield fsp.access(absPath);
                        const tracked = this._findDbRecord(relPath);
                        type = tracked ? 'changed' : 'added';
                    }
                    catch (_a) {
                        type = 'deleted';
                    }
                    this._emit({ type, relPath });
                }), this.opts.debounceMs));
            });
            logger.info('[MemoryBridge] watcher started', { fsRoot: this.opts.fsRoot });
        });
    }
    /** Stop the FS watcher. Safe to call when not running. */
    stop() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.watcher) {
                this.watcher.close();
                this.watcher = null;
                logger.info('[MemoryBridge] watcher stopped');
            }
        });
    }
    /**
     * Subscribe to FS change events emitted after the debounce window.
     * Returns an unsubscribe function.
     */
    onChange(cb) {
        this.callbacks.add(cb);
        return () => {
            this.callbacks.delete(cb);
        };
    }
    // ====== Private helpers ====================================================
    _emit(e) {
        for (const cb of this.callbacks) {
            try {
                cb(e);
            }
            catch (_a) {
                /* silence callback errors */
            }
        }
    }
    _scanFiles() {
        return __awaiter(this, void 0, void 0, function* () {
            const absPaths = yield walkMd(this.opts.fsRoot);
            const files = [];
            for (const absPath of absPaths) {
                const relPath = path.relative(this.opts.fsRoot, absPath).replace(/\\/g, '/');
                try {
                    const raw = yield fsp.readFile(absPath, 'utf8');
                    const stat = yield fsp.stat(absPath);
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
                }
                catch (_a) {
                    logger.warn('[MemoryBridge] could not read file', { absPath });
                }
            }
            return files;
        });
    }
    _findDbRecord(relPath) {
        var _a;
        const results = this.opts.store.query({
            scope: this.opts.scope,
            tags: [tagRelPath(relPath)],
            limit: 1,
            includeExpired: true,
        });
        return (_a = results[0]) !== null && _a !== void 0 ? _a : null;
    }
    _extractHash(entry) {
        const hashTag = entry.tags.find(t => t.startsWith('bridge:hash:'));
        return hashTag ? hashTag.slice('bridge:hash:'.length) : computeContentHash(entry.text);
    }
    _extractRelPath(entry) {
        const tag = entry.tags.find(t => t.startsWith('bridge:relPath:'));
        return tag ? tag.slice('bridge:relPath:'.length) : null;
    }
    _buildTags(file) {
        return [
            tagRelPath(file.relPath),
            tagWorkspace(this.opts.workspaceId),
            tagHash(file.contentHash),
        ];
    }
    _writeToDb(file) {
        const { scope } = this.opts;
        const kind = isValidKind(file.frontmatter.kind)
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
    _updateInDb(entryId, file) {
        return this.opts.store.update(entryId, {
            text: file.body,
            tags: this._buildTags(file),
        });
    }
    _writeToFs(relPath, entry) {
        return __awaiter(this, void 0, void 0, function* () {
            const absPath = path.join(this.opts.fsRoot, relPath);
            yield fsp.mkdir(path.dirname(absPath), { recursive: true });
            const fm = {
                id: stableIdForPath(relPath),
                kind: entry.kind,
                source: entry.source,
                scope: entry.scope,
                updatedAt: entry.updated_at,
            };
            const content = serializeFrontmatter(fm, entry.text);
            yield fsp.writeFile(absPath, content, 'utf8');
        });
    }
}
