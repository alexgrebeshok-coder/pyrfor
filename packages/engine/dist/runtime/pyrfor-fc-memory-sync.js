/**
 * pyrfor-fc-memory-sync.ts — Read-only FreeClaude memory → Pyrfor MemoryStore sync.
 *
 * Imports FC memory entries into Pyrfor for searching/cross-referencing.
 * FC remains the source of truth; we never write back to ~/.freeclaude.
 */
import { homedir } from 'os';
import path from 'path';
// ─── Helpers ─────────────────────────────────────────────────────────────────
function inferKind(tags) {
    if (!tags || tags.length === 0)
        return 'fact';
    // Check for specific tags
    if (tags.includes('personal'))
        return 'preference';
    if (tags.includes('lesson'))
        return 'lesson';
    return 'fact';
}
function getDefaultMemoryPath() {
    return path.join(homedir(), '.freeclaude', 'memory.json');
}
function getDefaultEmbeddingsPath() {
    return path.join(homedir(), '.freeclaude', 'embeddings.json');
}
// ─── Load snapshot ───────────────────────────────────────────────────────────
/**
 * Load FC memory snapshot from disk (no DB writes).
 * Missing files → empty arrays, not throw.
 */
export function loadFcMemorySnapshot(opts) {
    var _a, _b, _c, _d;
    const fs = (_a = opts.fs) !== null && _a !== void 0 ? _a : require('fs');
    const now = (_b = opts.now) !== null && _b !== void 0 ? _b : (() => Date.now());
    const memoryPath = (_c = opts.memoryPath) !== null && _c !== void 0 ? _c : getDefaultMemoryPath();
    const embeddingsPath = (_d = opts.embeddingsPath) !== null && _d !== void 0 ? _d : getDefaultEmbeddingsPath();
    let memory = [];
    let embeddings = [];
    let embeddingModel;
    // Load memory.json
    if (fs.existsSync(memoryPath)) {
        try {
            const raw = fs.readFileSync(memoryPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.entries) {
                const entries = parsed.entries;
                // Handle both object (keyed by key) and array formats
                if (typeof entries === 'object' && !Array.isArray(entries)) {
                    memory = Object.values(entries).filter((e) => e && typeof e === 'object' && e.key);
                }
                else if (Array.isArray(entries)) {
                    memory = entries.filter((e) => e && typeof e === 'object' && e.key);
                }
                else {
                    console.warn(`Unexpected entries shape in ${memoryPath}: expected object or array, got ${typeof entries}`);
                }
            }
        }
        catch (err) {
            if (err.name === 'SyntaxError') {
                throw new Error(`Malformed JSON in ${memoryPath}: ${err.message}`);
            }
            throw err;
        }
    }
    // Load embeddings.json
    if (fs.existsSync(embeddingsPath)) {
        try {
            const raw = fs.readFileSync(embeddingsPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                if (parsed.model) {
                    embeddingModel = parsed.model;
                }
                if (Array.isArray(parsed.entries)) {
                    embeddings = parsed.entries.filter((e) => e && typeof e === 'object' && e.key);
                }
            }
        }
        catch (err) {
            if (err.name === 'SyntaxError') {
                throw new Error(`Malformed JSON in ${embeddingsPath}: ${err.message}`);
            }
            throw err;
        }
    }
    return {
        memory,
        embeddings,
        embeddingModel,
        loadedAt: now(),
    };
}
// ─── Sync to store ───────────────────────────────────────────────────────────
/**
 * Sync snapshot into MemoryStore. Returns { added, skipped, total }.
 * Idempotent: re-running with same data adds 0.
 *
 * TODO: Future enhancement — extend memory-store with embedding column to support
 * vector search. Currently, embeddings are preserved in snapshot but not stored.
 */
export function syncFcMemoryToStore(snapshot, opts) {
    var _a, _b, _c;
    const store = opts.store;
    const scope = (_a = opts.scope) !== null && _a !== void 0 ? _a : 'fc-import';
    const sourcePrefix = (_b = opts.source) !== null && _b !== void 0 ? _b : 'freeclaude';
    const total = snapshot.memory.length;
    if (total === 0) {
        return { added: 0, skipped: 0, total: 0 };
    }
    // Build set of existing sources for idempotency check
    const existingSources = new Set();
    const existing = store.query({ scope, limit: 10000 });
    for (const entry of existing) {
        existingSources.add(entry.source);
    }
    let added = 0;
    let skipped = 0;
    for (const fcEntry of snapshot.memory) {
        const source = `${sourcePrefix}#${fcEntry.key}`;
        // Skip if already synced
        if (existingSources.has(source)) {
            skipped++;
            continue;
        }
        // Build MemoryStore add input
        const kind = inferKind(fcEntry.tags);
        const text = `${fcEntry.key}: ${fcEntry.value}`;
        const tags = (_c = fcEntry.tags) !== null && _c !== void 0 ? _c : [];
        const weight = 1.0;
        store.add({
            kind,
            text,
            source,
            scope,
            tags,
            weight,
            expires_at: undefined,
        });
        added++;
    }
    return { added, skipped, total };
}
// ─── Convenience: load + sync ────────────────────────────────────────────────
/**
 * Convenience: load + sync.
 */
export function syncFcMemory(opts) {
    const snapshot = loadFcMemorySnapshot(opts);
    const result = syncFcMemoryToStore(snapshot, opts);
    return Object.assign(Object.assign({}, result), { snapshot });
}
