/**
 * artifact-model.ts — Filesystem-backed artifact store for Pyrfor run outputs.
 *
 * Features:
 * - Typed ArtifactKind union covering all Pyrfor output categories
 * - Atomic file writes with sha256 integrity, auto-mkdir
 * - Append-only _index.jsonl for fast listing and persistence across restarts
 * - Corrupt index lines are warned and skipped; valid entries still returned
 * - Pure helper exports: computeSha256, serializeRef, deserializeRef
 * - No external dependencies; uses node:crypto and node:fs/promises
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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink, appendFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import logger from '../observability/logger.js';
// ====== Pure helpers =========================================================
/** Compute hex-encoded SHA-256 digest of a buffer. */
export function computeSha256(buf) {
    return createHash('sha256').update(buf).digest('hex');
}
/** Serialise an ArtifactRef to a single JSON line (no trailing newline). */
export function serializeRef(ref) {
    return JSON.stringify(ref);
}
/**
 * Parse a single JSON line back into an ArtifactRef.
 * Returns null if the line is empty, malformed, or missing required fields.
 */
export function deserializeRef(line) {
    try {
        const parsed = JSON.parse(line);
        if (typeof parsed.id !== 'string' ||
            typeof parsed.kind !== 'string' ||
            typeof parsed.uri !== 'string' ||
            typeof parsed.createdAt !== 'string') {
            return null;
        }
        return parsed;
    }
    catch (_a) {
        return null;
    }
}
// ====== ArtifactStore ========================================================
export class ArtifactStore {
    constructor(opts) {
        this.rootDir = opts.rootDir;
        this.indexPath = path.join(this.rootDir, '_index.jsonl');
    }
    // ─── Path resolution ──────────────────────────────────────────────────────
    /** Return the absolute filesystem path for a given ArtifactRef. */
    resolvePath(ref) {
        var _a;
        const bucket = (_a = ref.runId) !== null && _a !== void 0 ? _a : '_global';
        return path.join(this.rootDir, bucket, ref.kind, ref.id);
    }
    // ─── Write ────────────────────────────────────────────────────────────────
    /**
     * Write content to disk, compute sha256, append ref to the index, and return
     * the resulting ArtifactRef.
     */
    write(kind, content, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8');
            const id = randomUUID() + ((_a = opts === null || opts === void 0 ? void 0 : opts.ext) !== null && _a !== void 0 ? _a : '');
            const sha256 = computeSha256(buf);
            const createdAt = new Date().toISOString();
            const bucket = (_b = opts === null || opts === void 0 ? void 0 : opts.runId) !== null && _b !== void 0 ? _b : '_global';
            const dirPath = path.join(this.rootDir, bucket, kind);
            yield mkdir(dirPath, { recursive: true });
            yield writeFile(path.join(dirPath, id), buf);
            const ref = Object.assign(Object.assign({ id,
                kind, uri: path.join(dirPath, id), sha256, bytes: buf.length, createdAt }, ((opts === null || opts === void 0 ? void 0 : opts.runId) !== undefined ? { runId: opts.runId } : {})), ((opts === null || opts === void 0 ? void 0 : opts.meta) !== undefined ? { meta: opts.meta } : {}));
            // Ensure rootDir exists before writing index
            yield mkdir(this.rootDir, { recursive: true });
            yield appendFile(this.indexPath, serializeRef(ref) + '\n');
            return ref;
        });
    }
    /** Convenience wrapper: serialises value as JSON and sets ext to '.json'. */
    writeJSON(kind, value, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.write(kind, JSON.stringify(value), Object.assign(Object.assign({}, opts), { ext: '.json' }));
        });
    }
    // ─── Read ─────────────────────────────────────────────────────────────────
    /** Read the raw bytes of an artifact. */
    read(ref) {
        return __awaiter(this, void 0, void 0, function* () {
            return readFile(this.resolvePath(ref));
        });
    }
    /** Read raw bytes and verify they still match the reviewed sha256 digest. */
    readVerified(ref, expectedSha256) {
        return __awaiter(this, void 0, void 0, function* () {
            const buf = yield this.read(ref);
            const actualSha256 = computeSha256(buf);
            if (actualSha256 !== expectedSha256) {
                throw new Error('ArtifactStore: artifact sha256 mismatch');
            }
            return buf;
        });
    }
    /** Read artifact content as a UTF-8 string. */
    readText(ref) {
        return __awaiter(this, void 0, void 0, function* () {
            return (yield this.read(ref)).toString('utf-8');
        });
    }
    /** Deserialise a JSON artifact into a typed value. */
    readJSON(ref) {
        return __awaiter(this, void 0, void 0, function* () {
            return JSON.parse(yield this.readText(ref));
        });
    }
    /** Deserialise JSON only after verifying current artifact bytes. */
    readJSONVerified(ref, expectedSha256) {
        return __awaiter(this, void 0, void 0, function* () {
            return JSON.parse((yield this.readVerified(ref, expectedSha256)).toString('utf-8'));
        });
    }
    // ─── List ─────────────────────────────────────────────────────────────────
    /**
     * List all artifacts by reading the _index.jsonl file.
     * Corrupt lines are warned and skipped; valid entries are always returned.
     * Optionally filter by runId and/or kind.
     */
    list(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, e_1, _b, _c;
            const refs = [];
            try {
                const stream = createReadStream(this.indexPath);
                const rl = createInterface({ input: stream, crlfDelay: Infinity });
                try {
                    for (var _d = true, rl_1 = __asyncValues(rl), rl_1_1; rl_1_1 = yield rl_1.next(), _a = rl_1_1.done, !_a; _d = true) {
                        _c = rl_1_1.value;
                        _d = false;
                        const line = _c;
                        const trimmed = line.trim();
                        if (!trimmed)
                            continue;
                        const ref = deserializeRef(trimmed);
                        if (ref === null) {
                            logger.warn('ArtifactStore: corrupt index line skipped', { line: trimmed });
                            continue;
                        }
                        refs.push(ref);
                    }
                }
                catch (e_1_1) { e_1 = { error: e_1_1 }; }
                finally {
                    try {
                        if (!_d && !_a && (_b = rl_1.return)) yield _b.call(rl_1);
                    }
                    finally { if (e_1) throw e_1.error; }
                }
            }
            catch (err) {
                if (err.code !== 'ENOENT')
                    throw err;
                // Index does not yet exist — return empty list
            }
            let results = refs;
            if ((opts === null || opts === void 0 ? void 0 : opts.runId) !== undefined) {
                results = results.filter(r => r.runId === opts.runId);
            }
            if ((opts === null || opts === void 0 ? void 0 : opts.kind) !== undefined) {
                results = results.filter(r => r.kind === opts.kind);
            }
            return results;
        });
    }
    // ─── Remove ───────────────────────────────────────────────────────────────
    /**
     * Delete the artifact file.
     * Returns true if the file existed and was removed, false if it was already
     * absent.  Note: the index entry is retained (tombstone behaviour).
     */
    remove(ref) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield unlink(this.resolvePath(ref));
                return true;
            }
            catch (err) {
                if (err.code === 'ENOENT')
                    return false;
                throw err;
            }
        });
    }
}
