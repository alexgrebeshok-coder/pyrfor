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
import type { MemoryEntry, MemoryKind, MemoryStore } from '../runtime/memory-store.js';
export interface SearchOptions {
    /** FTS5 query string – sanitized internally before being passed to SQLite. */
    query: string;
    /** Restrict results to one or more memory scopes. */
    scope?: string | string[];
    /** Restrict results to specific MemoryKind values. */
    kinds?: MemoryKind[];
    /** ALL-of tag filter: only entries that carry *every* listed tag are returned. */
    tags?: string[];
    /** Maximum number of results to return (default 20). */
    limit?: number;
    /** Zero-based result offset (default 0). */
    offset?: number;
    /**
     * BM25 score cutoff.  BM25 values are negative; lower (more negative) = more
     * relevant.  Entries whose `score > minScore` are excluded.
     * Example: `minScore: -0.05` discards very weak matches.
     */
    minScore?: number;
    /**
     * Number of tokens around each match included in the FTS5 snippet.
     * `0` (default) = snippet disabled.  Otherwise uses `snippet()` with
     * `<mark>` / `</mark>` wrappers.
     */
    snippetTokens?: number;
    /**
     * Re-ranking strategy:
     * - `'bm25'`    – default; SQL ORDER BY bm25(memory_fts) ASC (lower = better).
     * - `'recency'` – sort by recency decay (most recently updated first).
     * - `'hybrid'`  – combined score: bm25_score × recencyDecay(updated_at).
     */
    rerank?: 'bm25' | 'recency' | 'hybrid';
}
export interface SearchHit {
    /** The matching MemoryEntry. */
    entry: MemoryEntry;
    /**
     * Sort score.  For `bm25` and `hybrid` this is a negative float (lower = more
     * relevant).  For `recency` this is the recencyDecay value (higher = more recent).
     */
    score: number;
    /** Highlighted text excerpt (only present when `SearchOptions.snippetTokens > 0`). */
    snippet?: string;
    /** Plain search terms extracted from the (sanitized) query that matched this entry. */
    matchedTerms: string[];
}
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
export declare function sanitizeFtsQuery(raw: string): string;
/**
 * Build an FTS5 MATCH expression from an array of individual terms.
 * Terms are implicitly AND-ed (FTS5 default when no operator is specified).
 * Stray double-quotes inside terms are stripped.
 */
export declare function buildMatchExpression(terms: string[]): string;
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
export declare function recencyDecay(updatedAt: string, halfLifeDays?: number): number;
export declare class Fts5Search {
    /**
     * Read-only better-sqlite3 connection.
     *
     * Because MemoryStore does not expose its underlying Database handle, Fts5Search
     * always opens a separate read-only connection using:
     *
     *   new Database(dbPath, { readonly: true, fileMustExist: true })
     *
     * `ownsDb` is always `true` in the current implementation.
     */
    private db;
    private readonly ownsDb;
    /**
     * @param opts.store   Optional existing MemoryStore (accepted for future compat;
     *                     the raw db handle is not accessible so a separate read-only
     *                     connection is always opened).
     * @param opts.dbPath  Path to the SQLite file.  Defaults to `~/.pyrfor/memory.db`.
     */
    constructor(opts: {
        store?: MemoryStore;
        dbPath?: string;
    });
    search(opts: SearchOptions): Promise<SearchHit[]>;
    count(query: string, opts?: Pick<SearchOptions, 'scope' | 'kinds' | 'tags'>): Promise<number>;
    /**
     * Return up to `limit` word completions for the given `prefix` via FTS5 prefix
     * search (`term*` syntax).
     *
     * Internally issues a MATCH query for `{prefix}*`, collects matching entry texts,
     * then extracts distinct words that begin with the prefix (case-insensitive).
     */
    suggest(prefix: string, limit?: number): Promise<string[]>;
    /** Close the underlying read-only connection (only if Fts5Search opened it). */
    close(): Promise<void>;
}
//# sourceMappingURL=fts5-search.d.ts.map