/**
 * backup-restore — Snapshot and restore all Pyrfor JSON stores into a single
 * gzip-compressed archive (.bk). No external dependencies; uses node:zlib,
 * node:fs (sync), node:path, node:crypto.
 *
 * Archive format (pyrfor-bk-v1):
 *   gzip( JSON.stringify({ manifest: BackupManifest, files: { [relpath]: base64 } }) )
 * Written atomically via tmp file + rename.
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
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';
// ── Manager factory ───────────────────────────────────────────────────────────
export function createBackupManager(opts) {
    var _a, _b;
    const { archiveDir } = opts;
    const clock = (_a = opts.clock) !== null && _a !== void 0 ? _a : (() => Date.now());
    const log = (_b = opts.logger) !== null && _b !== void 0 ? _b : (() => { });
    const sources = new Map();
    // ── source management ──────────────────────────────────────────────────────
    function addSource(s) {
        sources.set(s.id, s);
    }
    function removeSource(id) {
        sources.delete(id);
    }
    function listSources() {
        return Array.from(sources.values());
    }
    // ── helpers ────────────────────────────────────────────────────────────────
    /** Walk a directory recursively; return absolute paths of all files. */
    function walkDir(dir) {
        const results = [];
        if (!fs.existsSync(dir))
            return results;
        const stat = fs.statSync(dir);
        if (!stat.isDirectory())
            return results;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...walkDir(full));
            }
            else if (entry.isFile()) {
                results.push(full);
            }
        }
        return results;
    }
    function ensureDir(dir) {
        fs.mkdirSync(dir, { recursive: true });
    }
    function readArchiveDoc(archivePath) {
        const raw = fs.readFileSync(archivePath);
        const decompressed = zlib.gunzipSync(raw);
        return JSON.parse(decompressed.toString('utf8'));
    }
    // ── snapshot ───────────────────────────────────────────────────────────────
    function snapshot(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            ensureDir(archiveDir);
            const ts = clock();
            const tag = (_a = opts === null || opts === void 0 ? void 0 : opts.tag) !== null && _a !== void 0 ? _a : 'snap';
            const archiveName = `${ts}-${tag}.bk`;
            const archivePath = path.join(archiveDir, archiveName);
            const tmpPath = path.join(archiveDir, `${archiveName}.tmp-${crypto.randomBytes(4).toString('hex')}`);
            const manifestSources = [];
            const files = {};
            for (const src of sources.values()) {
                if (!fs.existsSync(src.path)) {
                    log('warn: source directory missing, skipping', { id: src.id, path: src.path });
                    manifestSources.push({ id: src.id, path: src.path, fileCount: 0, bytes: 0 });
                    continue;
                }
                const allFiles = walkDir(src.path);
                let fileCount = 0;
                let bytes = 0;
                for (const absPath of allFiles) {
                    const rel = path.relative(src.path, absPath);
                    if (src.include && !src.include.test(rel))
                        continue;
                    if (src.exclude && src.exclude.test(rel))
                        continue;
                    const content = fs.readFileSync(absPath);
                    const key = `${src.id}/${rel}`;
                    files[key] = content.toString('base64');
                    fileCount++;
                    bytes += content.length;
                }
                manifestSources.push({ id: src.id, path: src.path, fileCount, bytes });
            }
            const totalBytes = manifestSources.reduce((s, e) => s + e.bytes, 0);
            const manifest = {
                id: crypto.randomUUID(),
                createdAt: ts,
                sources: manifestSources,
                totalBytes,
                format: 'pyrfor-bk-v1',
            };
            const doc = { manifest, files };
            const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(doc), 'utf8'));
            fs.writeFileSync(tmpPath, compressed);
            fs.renameSync(tmpPath, archivePath);
            log('snapshot created', { archivePath, totalBytes, files: Object.keys(files).length });
            return { manifest, archivePath };
        });
    }
    // ── listArchives ───────────────────────────────────────────────────────────
    function listArchives() {
        if (!fs.existsSync(archiveDir))
            return [];
        const entries = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.bk'));
        const result = [];
        for (const entry of entries) {
            const full = path.join(archiveDir, entry);
            try {
                const doc = readArchiveDoc(full);
                result.push({ path: full, manifest: doc.manifest });
            }
            catch (_a) {
                // skip unreadable archives
            }
        }
        return result;
    }
    // ── restore ────────────────────────────────────────────────────────────────
    function restore(archivePath, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const { targetRoot, sourceIds, overwrite = true } = opts;
            const doc = readArchiveDoc(archivePath);
            const allowedIds = sourceIds ? new Set(sourceIds) : null;
            let restoredFiles = 0;
            let bytes = 0;
            const skipped = [];
            for (const [key, b64] of Object.entries(doc.files)) {
                const slashIdx = key.indexOf('/');
                const srcId = slashIdx === -1 ? key : key.slice(0, slashIdx);
                const relPath = slashIdx === -1 ? '' : key.slice(slashIdx + 1);
                if (allowedIds && !allowedIds.has(srcId))
                    continue;
                const destPath = path.join(targetRoot, key);
                if (!overwrite && fs.existsSync(destPath)) {
                    skipped.push({ path: destPath, reason: 'exists' });
                    continue;
                }
                const content = Buffer.from(b64, 'base64');
                ensureDir(path.dirname(destPath));
                fs.writeFileSync(destPath, content);
                restoredFiles++;
                bytes += content.length;
            }
            log('restore complete', { restoredFiles, bytes, skipped: skipped.length });
            return { restoredFiles, bytes, skipped };
        });
    }
    // ── verify ─────────────────────────────────────────────────────────────────
    function verify(archivePath) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const errors = [];
            let doc;
            try {
                doc = readArchiveDoc(archivePath);
            }
            catch (e) {
                errors.push(`gzip/parse error: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : String(e)}`);
                return { ok: false, errors };
            }
            // manifest shape checks
            if (!doc.manifest || typeof doc.manifest !== 'object') {
                errors.push('manifest missing or not an object');
            }
            else {
                const m = doc.manifest;
                if (m.format !== 'pyrfor-bk-v1')
                    errors.push(`unexpected format: ${m.format}`);
                if (typeof m.id !== 'string' || !m.id)
                    errors.push('manifest.id missing');
                if (typeof m.createdAt !== 'number')
                    errors.push('manifest.createdAt not a number');
                if (!Array.isArray(m.sources))
                    errors.push('manifest.sources not an array');
            }
            if (!doc.files || typeof doc.files !== 'object') {
                errors.push('files section missing or not an object');
            }
            else if (doc.manifest && Array.isArray(doc.manifest.sources)) {
                // file count cross-check
                const declaredTotal = doc.manifest.sources.reduce((s, e) => s + e.fileCount, 0);
                const actualTotal = Object.keys(doc.files).length;
                if (declaredTotal !== actualTotal) {
                    errors.push(`file count mismatch: manifest declares ${declaredTotal} but archive contains ${actualTotal}`);
                }
            }
            return { ok: errors.length === 0, errors };
        });
    }
    // ── prune ──────────────────────────────────────────────────────────────────
    function prune(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!fs.existsSync(archiveDir))
                return { deleted: [] };
            const archives = listArchives().sort((a, b) => b.manifest.createdAt - a.manifest.createdAt);
            const toDelete = new Set();
            const now = clock();
            if (opts.olderThanMs !== undefined) {
                for (const a of archives) {
                    if (now - a.manifest.createdAt > opts.olderThanMs) {
                        toDelete.add(a.path);
                    }
                }
            }
            if (opts.keepLast !== undefined) {
                const keep = opts.keepLast;
                for (let i = keep; i < archives.length; i++) {
                    toDelete.add(archives[i].path);
                }
            }
            const deleted = [];
            for (const p of toDelete) {
                fs.unlinkSync(p);
                deleted.push(p);
                log('pruned archive', { path: p });
            }
            return { deleted };
        });
    }
    // ── public surface ─────────────────────────────────────────────────────────
    return { addSource, removeSource, listSources, snapshot, listArchives, restore, verify, prune };
}
