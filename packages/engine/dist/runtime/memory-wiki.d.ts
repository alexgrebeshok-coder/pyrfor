/**
 * memory-wiki.ts — Structured knowledge-graph store for Pyrfor.
 *
 * Complements the episodic memory-store (Phase D) with entity-attribute-value
 * pages connected by [[wikilink]] cross-references.
 *
 * Features:
 *  - Slug-keyed WikiPages with free-form body, tags, and typed attributes
 *  - [[wikilink]] parsing for automatic outbound-link derivation
 *  - Full-text search with title/tag/body scoring weights
 *  - Backlink index, orphan detection, broken-link report
 *  - Atomic JSON persistence (tmp + rename) with debounced autosave
 *  - Concurrency-safe: concurrent flush() calls coalesce into one write
 */
export interface WikiPage {
    slug: string;
    title: string;
    body: string;
    tags: string[];
    attributes: Record<string, string | number | boolean>;
    links: string[];
    createdAt: string;
    updatedAt: string;
    version: number;
}
export interface WikiSearchHit {
    slug: string;
    title: string;
    score: number;
    snippet: string;
}
export interface CreateMemoryWikiOptions {
    /** JSON file path; store is in-memory only when omitted. */
    storePath?: string;
    /** Debounce window for autosave (default 200 ms). */
    autosaveDebounceMs?: number;
    /** Replaceable clock for deterministic testing. */
    clock?: () => number;
    logger?: (l: 'info' | 'warn' | 'error', m: string, meta?: unknown) => void;
}
export interface MemoryWiki {
    upsert(input: {
        slug?: string;
        title: string;
        body?: string;
        tags?: string[];
        attributes?: Record<string, string | number | boolean>;
    }): WikiPage;
    get(slug: string): WikiPage | undefined;
    list(opts?: {
        tag?: string;
        limit?: number;
    }): WikiPage[];
    remove(slug: string): boolean;
    search(query: string, opts?: {
        limit?: number;
        tag?: string;
    }): WikiSearchHit[];
    backlinks(slug: string): string[];
    /** Pages with no outbound links AND no inbound backlinks. Self-links count as outbound. */
    orphans(): string[];
    /** Wikilinks pointing to non-existent slugs. */
    brokenLinks(): Array<{
        from: string;
        to: string;
    }>;
    /** Moves page to newSlug and rewrites all backlink bodies. Throws on slug collision. */
    rename(oldSlug: string, newSlug: string): boolean;
    flush(): Promise<void>;
    reset(): void;
}
/**
 * Convert arbitrary text into a canonical lowercase-kebab slug.
 * Rules: lowercase → replace non-alnum with '-' → collapse repeats → trim '-' → cap 80 chars.
 */
export declare function slugify(title: string): string;
/**
 * Extract [[wikilink]] targets from a markdown body, slugify each, dedupe,
 * and preserve first-seen order.
 */
export declare function parseWikilinks(body: string): string[];
export declare function createMemoryWiki(opts?: CreateMemoryWikiOptions): MemoryWiki;
//# sourceMappingURL=memory-wiki.d.ts.map