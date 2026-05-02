/**
 * fts5-search.ts — Public FTS5 Search API built on top of the memory-store SQLite database.
 *
 * DESIGN NOTE — Database access
 * ─────────────────────────────
 * MemoryStore (../runtime/memory-store) is a plain TypeScript *interface* backed by a
 * closure created in `createMemoryStore()`.  The underlying `better-sqlite3` Database
 * handle lives inside that closure and is NOT exposed through any public method.
 *
 * Therefore Fts5Search ALWAYS opens a SEPARATE, read-only connection:
 *
 *   new Database(dbPath, { readonly: true, fileMustExist: true })
 *
 * The optional `store` constructor argument is accepted for future API compatibility
 * (e.g. if MemoryStore ever grows a `.db` accessor) but is currently unused for raw
 * DB access.  `ownsDb` is always `true` in the present implementation.
 *
 * All SQL executed by this module is strictly READ-ONLY.
 * No INSERT / UPDATE / DELETE statements are ever issued.
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
import Database from 'better-sqlite3';
import { homedir } from 'os';
import path from 'path';
// ====== Row → MemoryEntry =================================================
function rowToEntry(row) {
    let tags = [];
    try {
        tags = JSON.parse(row.tags);
    }
    catch (_a) {
        tags = [];
    }
    const entry = {
        id: row.id,
        kind: row.kind,
        text: row.text,
        source: row.source,
        scope: row.scope,
        tags,
        weight: row.weight,
        applied_count: row.applied_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
    if (row.expires_at != null)
        entry.expires_at = row.expires_at;
    return entry;
}
// ====== Pure Helpers ======================================================
/**
 * Sanitize a user-supplied FTS5 query string.
 *
 * Rules applied (in order):
 * 1. Strip ASCII control characters (U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+007F).
 * 2. Preserve double-quoted phrases verbatim.
 * 3. Normalise `AND` / `OR` / `NOT` / `NEAR` (and `NEAR/N`) operators to uppercase.
 * 4. Strip stray double-quote characters from bare (unquoted) terms.
 * 5. Return `'""'` for blank input so callers always get a valid MATCH expression.
 */
export function sanitizeFtsQuery(raw) {
    // 1. Drop control characters; preserve normal whitespace
    const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, ' ').trim();
    if (!cleaned)
        return '""';
    const tokens = [];
    // Tokenise: quoted phrases | operators (NEAR/N first) | bare terms
    // Pattern 3 uses [^\s]+ (not [^\s"]+) so that mid-word quotes like hel"lo are
    // captured as a single token and then stripped in the else branch below.
    const RE = /"([^"]*?)"|(\bNEAR\s*\/\s*\d+|\bAND\b|\bOR\b|\bNOT\b|\bNEAR\b)|([^\s]+)/gi;
    let m;
    while ((m = RE.exec(cleaned)) !== null) {
        if (m[1] !== undefined) {
            // Quoted phrase — keep as-is inside double-quotes
            tokens.push(`"${m[1]}"`);
        }
        else if (m[2] !== undefined) {
            // Boolean / NEAR operator — normalise to uppercase, collapse internal whitespace
            tokens.push(m[2].replace(/\s+/g, '').toUpperCase());
        }
        else if (m[3]) {
            // Bare term — strip any embedded double-quotes
            const term = m[3].replace(/"/g, '');
            if (term)
                tokens.push(term);
        }
    }
    return tokens.length > 0 ? tokens.join(' ') : '""';
}
/**
 * Build an FTS5 MATCH expression from an array of individual terms.
 * Terms are implicitly AND-ed (FTS5 default when no operator is specified).
 * Stray double-quotes inside terms are stripped.
 */
export function buildMatchExpression(terms) {
    if (terms.length === 0)
        return '""';
    const safe = terms.map(t => t.replace(/"/g, '')).filter(Boolean);
    return safe.length > 0 ? safe.join(' ') : '""';
}
/**
 * Exponential recency decay multiplier in the range `[0, 1]`.
 *
 * ```
 * recencyDecay(now)                ≈ 1.00
 * recencyDecay(now − halfLifeDays) ≈ 0.50
 * recencyDecay(now − 2×halfLife)   ≈ 0.25
 * ```
 *
 * Formula: `2^(−elapsedDays / halfLifeDays)`
 *
 * @param updatedAt     ISO-8601 timestamp of the entry's last update.
 * @param halfLifeDays  Days until the multiplier halves (default 14).
 */
export function recencyDecay(updatedAt, halfLifeDays = 14) {
    const ageMs = Date.now() - new Date(updatedAt).getTime();
    const ageDays = ageMs / 86400000;
    return Math.pow(2, -ageDays / halfLifeDays);
}
// ====== Internal helpers ==================================================
const FTS_OPERATORS = new Set(['AND', 'OR', 'NOT', 'NEAR']);
/** Extract plain search terms from a sanitized FTS5 query (strips operators / NEAR). */
function extractTerms(sanitized) {
    return sanitized
        .split(/\s+/)
        .map(t => t.replace(/^"+|"+$/g, '').replace(/\*$/, ''))
        .filter(t => t.length > 0 && !FTS_OPERATORS.has(t.toUpperCase()) && !/^NEAR\/\d+$/.test(t));
}
// ====== Fts5Search ========================================================
const DEFAULT_DB_PATH = path.join(homedir(), '.pyrfor', 'memory.db');
export class Fts5Search {
    /**
     * @param opts.store   Optional existing MemoryStore (accepted for future compat;
     *                     the raw db handle is not accessible so a separate read-only
     *                     connection is always opened).
     * @param opts.dbPath  Path to the SQLite file.  Defaults to `~/.pyrfor/memory.db`.
     */
    constructor(opts) {
        var _a;
        const dbPath = (_a = opts.dbPath) !== null && _a !== void 0 ? _a : DEFAULT_DB_PATH;
        // MemoryStore hides its db handle in a closure; open our own read-only connection.
        this.db = new Database(dbPath, { readonly: true, fileMustExist: true });
        this.ownsDb = true;
    }
    // ────────────────────────────────────────────────────────────────────────
    // search
    // ────────────────────────────────────────────────────────────────────────
    search(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const { query, scope, kinds, tags, limit = 20, offset = 0, minScore, snippetTokens = 0, rerank = 'bm25', } = opts;
            const sanitized = sanitizeFtsQuery(query);
            const matchedTerms = extractTerms(sanitized);
            // ── SELECT list ───────────────────────────────────────────────────────
            const snippetCol = snippetTokens > 0
                ? `, snippet(memory_fts, 0, '<mark>', '</mark>', '...', ${Math.floor(snippetTokens)}) AS snip`
                : ', NULL AS snip';
            // ── WHERE clause & params ─────────────────────────────────────────────
            const whereClauses = ['memory_fts MATCH ?'];
            const params = [sanitized];
            if (scope !== undefined) {
                const scopes = Array.isArray(scope) ? scope : [scope];
                whereClauses.push(`e.scope IN (${scopes.map(() => '?').join(', ')})`);
                params.push(...scopes);
            }
            if (kinds && kinds.length > 0) {
                whereClauses.push(`e.kind IN (${kinds.map(() => '?').join(', ')})`);
                params.push(...kinds);
            }
            if (tags && tags.length > 0) {
                for (const tag of tags) {
                    whereClauses.push('e.tags LIKE ?');
                    params.push(`%"${tag}"%`);
                }
            }
            // For post-SQL re-ranking, over-fetch rows then slice after sorting.
            const sqlLimit = rerank === 'bm25' ? limit : Math.max(limit * 5, 200);
            const sqlOffset = rerank === 'bm25' ? offset : 0;
            params.push(sqlLimit, sqlOffset);
            const sql = `
      SELECT e.*, bm25(memory_fts) AS bm25_score${snippetCol}
      FROM memory_fts
      JOIN memory_entries e ON e.rowid = memory_fts.rowid
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY bm25(memory_fts) ASC
      LIMIT ? OFFSET ?
    `;
            const rows = this.db.prepare(sql).all(...params);
            // ── Build SearchHit array ─────────────────────────────────────────────
            let hits = rows.map(row => {
                const hit = {
                    entry: rowToEntry(row),
                    score: row.bm25_score,
                    matchedTerms,
                };
                if (row.snip != null)
                    hit.snippet = row.snip;
                return hit;
            });
            // ── minScore filter (BM25 is negative; retain entries whose score ≤ minScore)
            if (minScore !== undefined) {
                hits = hits.filter(h => h.score <= minScore);
            }
            // ── Re-ranking ────────────────────────────────────────────────────────
            if (rerank === 'recency') {
                // Sort by decay descending: highest decay (most recent) first.
                hits.sort((a, b) => recencyDecay(b.entry.updated_at) - recencyDecay(a.entry.updated_at));
            }
            else if (rerank === 'hybrid') {
                // Multiply BM25 score (negative) by decay (0..1).
                // More recent entries keep their score closer to the original BM25 value
                // (more negative = higher rank), while old entries drift toward 0 (lower rank).
                hits = hits.map(h => (Object.assign(Object.assign({}, h), { score: h.score * recencyDecay(h.entry.updated_at) })));
                hits.sort((a, b) => a.score - b.score);
            }
            // ── Paginate JS-reranked results ──────────────────────────────────────
            if (rerank !== 'bm25') {
                hits = hits.slice(offset, offset + limit);
            }
            return hits;
        });
    }
    // ────────────────────────────────────────────────────────────────────────
    // count
    // ────────────────────────────────────────────────────────────────────────
    count(query, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const sanitized = sanitizeFtsQuery(query);
            const whereClauses = ['memory_fts MATCH ?'];
            const params = [sanitized];
            if ((opts === null || opts === void 0 ? void 0 : opts.scope) !== undefined) {
                const scopes = Array.isArray(opts.scope) ? opts.scope : [opts.scope];
                whereClauses.push(`e.scope IN (${scopes.map(() => '?').join(', ')})`);
                params.push(...scopes);
            }
            if ((opts === null || opts === void 0 ? void 0 : opts.kinds) && opts.kinds.length > 0) {
                whereClauses.push(`e.kind IN (${opts.kinds.map(() => '?').join(', ')})`);
                params.push(...opts.kinds);
            }
            if ((opts === null || opts === void 0 ? void 0 : opts.tags) && opts.tags.length > 0) {
                for (const tag of opts.tags) {
                    whereClauses.push('e.tags LIKE ?');
                    params.push(`%"${tag}"%`);
                }
            }
            const sql = `
      SELECT COUNT(*) AS n
      FROM memory_fts
      JOIN memory_entries e ON e.rowid = memory_fts.rowid
      WHERE ${whereClauses.join(' AND ')}
    `;
            const result = this.db.prepare(sql).get(...params);
            return (_a = result === null || result === void 0 ? void 0 : result.n) !== null && _a !== void 0 ? _a : 0;
        });
    }
    // ────────────────────────────────────────────────────────────────────────
    // suggest
    // ────────────────────────────────────────────────────────────────────────
    /**
     * Return up to `limit` word completions for the given `prefix` via FTS5 prefix
     * search (`term*` syntax).
     *
     * Internally issues a MATCH query for `{prefix}*`, collects matching entry texts,
     * then extracts distinct words that begin with the prefix (case-insensitive).
     */
    suggest(prefix_1) {
        return __awaiter(this, arguments, void 0, function* (prefix, limit = 10) {
            const safe = prefix.replace(/"/g, '').trim();
            if (!safe)
                return [];
            const sql = `
      SELECT e.text
      FROM memory_fts
      JOIN memory_entries e ON e.rowid = memory_fts.rowid
      WHERE memory_fts MATCH ?
      ORDER BY bm25(memory_fts) ASC
      LIMIT ?
    `;
            const rows = this.db
                .prepare(sql)
                .all(`${safe}*`, Math.max(limit * 10, 100));
            const prefixLower = safe.toLowerCase();
            const seen = new Set();
            const results = [];
            for (const row of rows) {
                for (const word of row.text.split(/\W+/).filter(Boolean)) {
                    const wl = word.toLowerCase();
                    if (wl.startsWith(prefixLower) && !seen.has(wl)) {
                        seen.add(wl);
                        results.push(word);
                        if (results.length >= limit)
                            return results;
                    }
                }
            }
            return results;
        });
    }
    // ────────────────────────────────────────────────────────────────────────
    // close
    // ────────────────────────────────────────────────────────────────────────
    /** Close the underlying read-only connection (only if Fts5Search opened it). */
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.ownsDb) {
                this.db.close();
            }
        });
    }
}
