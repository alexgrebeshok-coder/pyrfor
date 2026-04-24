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

import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface WikiPage {
  slug: string;
  title: string;
  body: string;
  tags: string[];
  attributes: Record<string, string | number | boolean>;
  links: string[];      // outbound slugs derived from [[wikilink]] parse
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
  list(opts?: { tag?: string; limit?: number }): WikiPage[];
  remove(slug: string): boolean;
  search(query: string, opts?: { limit?: number; tag?: string }): WikiSearchHit[];
  backlinks(slug: string): string[];
  /** Pages with no outbound links AND no inbound backlinks. Self-links count as outbound. */
  orphans(): string[];
  /** Wikilinks pointing to non-existent slugs. */
  brokenLinks(): Array<{ from: string; to: string }>;
  /** Moves page to newSlug and rewrites all backlink bodies. Throws on slug collision. */
  rename(oldSlug: string, newSlug: string): boolean;
  flush(): Promise<void>;
  reset(): void;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Convert arbitrary text into a canonical lowercase-kebab slug.
 * Rules: lowercase → replace non-alnum with '-' → collapse repeats → trim '-' → cap 80 chars.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Extract [[wikilink]] targets from a markdown body, slugify each, dedupe,
 * and preserve first-seen order.
 */
export function parseWikilinks(body: string): string[] {
  const regex = /\[\[([^\]\n]+?)\]\]/g;
  const seen = new Set<string>();
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const slug = slugify(match[1]);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      result.push(slug);
    }
  }
  return result;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createMemoryWiki(opts?: CreateMemoryWikiOptions): MemoryWiki {
  const storePath = opts?.storePath;
  const debounceMs = opts?.autosaveDebounceMs ?? 200;
  const clock: () => number = opts?.clock ?? (() => Date.now());
  const log: NonNullable<CreateMemoryWikiOptions['logger']> =
    opts?.logger ?? (() => { /* noop */ });

  // Primary storage: slug → WikiPage
  const pages = new Map<string, WikiPage>();

  // ── Load from disk ────────────────────────────────────────────────────────

  if (storePath) {
    try {
      const raw = readFileSync(storePath, 'utf8');
      const data = JSON.parse(raw) as { pages: WikiPage[] };
      for (const page of data.pages ?? []) {
        pages.set(page.slug, page);
      }
      log('info', 'memory-wiki loaded', { count: pages.size, path: storePath });
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') {
        log('warn', 'memory-wiki: failed to load store, starting empty', {
          error: e.message,
          path: storePath,
        });
      }
      // ENOENT is expected on first run — silently start empty
    }
  }

  // ── Debounced flush ───────────────────────────────────────────────────────

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let flushInFlight: Promise<void> | undefined;

  function scheduleFlush(): void {
    if (!storePath) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      flushNow().catch((err: unknown) => {
        log('error', 'memory-wiki: background flush failed', {
          error: (err as Error).message,
        });
      });
    }, debounceMs);
  }

  function flushNow(): Promise<void> {
    if (!storePath) return Promise.resolve();
    // Coalesce concurrent calls: return the in-flight promise if present
    if (flushInFlight !== undefined) return flushInFlight;

    const content = JSON.stringify({ pages: Array.from(pages.values()) }, null, 2);
    const dir = path.dirname(path.resolve(storePath));
    const tmp = path.join(
      dir,
      `.memory-wiki.tmp.${randomBytes(4).toString('hex')}`,
    );

    flushInFlight = new Promise<void>((resolve, reject) => {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(tmp, content, 'utf8');
        renameSync(tmp, storePath as string);
        log('info', 'memory-wiki flushed', { path: storePath });
        resolve();
      } catch (err: unknown) {
        try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
        log('error', 'memory-wiki: flush failed', {
          error: (err as Error).message,
        });
        reject(err);
      } finally {
        flushInFlight = undefined;
      }
    });

    return flushInFlight;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function nowStr(): string {
    return new Date(clock()).toISOString();
  }

  // ── MemoryWiki interface methods ──────────────────────────────────────────

  function upsert(input: {
    slug?: string;
    title: string;
    body?: string;
    tags?: string[];
    attributes?: Record<string, string | number | boolean>;
  }): WikiPage {
    if (!input.title || !input.title.trim()) throw new Error('title required');
    const slug = input.slug ?? slugify(input.title);
    if (!slug) throw new Error('invalid title');

    const now = nowStr();
    const existing = pages.get(slug);

    let page: WikiPage;
    if (existing) {
      const body = input.body !== undefined ? input.body : existing.body;
      const tags = input.tags !== undefined ? input.tags : existing.tags;
      const attributes =
        input.attributes !== undefined ? input.attributes : existing.attributes;
      page = {
        ...existing,
        body,
        tags,
        attributes,
        links: parseWikilinks(body),
        updatedAt: now,
        version: existing.version + 1,
      };
    } else {
      const body = input.body ?? '';
      const tags = input.tags ?? [];
      const attributes = input.attributes ?? {};
      page = {
        slug,
        title: input.title,
        body,
        tags,
        attributes,
        links: parseWikilinks(body),
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
    }

    pages.set(slug, page);
    scheduleFlush();
    return page;
  }

  function get(slug: string): WikiPage | undefined {
    return pages.get(slug);
  }

  function list(opts?: { tag?: string; limit?: number }): WikiPage[] {
    let result = Array.from(pages.values());
    if (opts?.tag !== undefined) {
      const tag = opts.tag;
      result = result.filter(p => p.tags.includes(tag));
    }
    if (opts?.limit !== undefined) {
      result = result.slice(0, opts.limit);
    }
    return result;
  }

  function remove(slug: string): boolean {
    if (!pages.has(slug)) return false;
    pages.delete(slug);
    scheduleFlush();
    return true;
  }

  /**
   * Full-text search.
   *
   * Scoring per token:
   *   title occurrences × 3 + body occurrences × 1 + tag occurrences × 2
   *
   * Snippet: first 120 chars of body starting near the first matched token;
   * falls back to first 120 chars of body; empty body → title as snippet.
   *
   * Sort: score desc, then slug lex asc. Capped at limit (default 20).
   */
  function search(
    query: string,
    opts?: { limit?: number; tag?: string },
  ): WikiSearchHit[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    if (tokens.length === 0) return [];

    const limit = opts?.limit ?? 20;
    const filterTag = opts?.tag;

    let candidates = Array.from(pages.values());
    if (filterTag !== undefined) {
      candidates = candidates.filter(p => p.tags.includes(filterTag));
    }

    const hits: WikiSearchHit[] = [];

    for (const page of candidates) {
      const titleLower = page.title.toLowerCase();
      const bodyLower = page.body.toLowerCase();

      let score = 0;
      let firstMatchedToken: string | undefined;

      for (const token of tokens) {
        let titleHits = 0;
        let pos = titleLower.indexOf(token);
        while (pos !== -1) { titleHits++; pos = titleLower.indexOf(token, pos + 1); }

        let bodyHits = 0;
        pos = bodyLower.indexOf(token);
        while (pos !== -1) { bodyHits++; pos = bodyLower.indexOf(token, pos + 1); }

        let tagHits = 0;
        for (const tag of page.tags) {
          if (tag.toLowerCase().includes(token)) tagHits++;
        }

        const tokenScore = titleHits * 3 + bodyHits + tagHits * 2;
        if (tokenScore > 0 && firstMatchedToken === undefined) {
          firstMatchedToken = token;
        }
        score += tokenScore;
      }

      if (score === 0) continue;

      let snippet: string;
      if (page.body) {
        if (firstMatchedToken !== undefined) {
          const matchPos = bodyLower.indexOf(firstMatchedToken);
          if (matchPos !== -1) {
            const start = Math.max(0, matchPos - 20);
            snippet = page.body.slice(start, start + 120);
          } else {
            snippet = page.body.slice(0, 120);
          }
        } else {
          snippet = page.body.slice(0, 120);
        }
      } else {
        snippet = page.title;
      }

      hits.push({ slug: page.slug, title: page.title, score, snippet });
    }

    hits.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.slug.localeCompare(b.slug),
    );

    return hits.slice(0, limit);
  }

  /** All pages whose outbound links include the given slug. */
  function backlinks(slug: string): string[] {
    const result: string[] = [];
    for (const page of pages.values()) {
      if (page.links.includes(slug)) result.push(page.slug);
    }
    return result;
  }

  /**
   * Pages with NO outbound links and NO inbound backlinks.
   * Self-links count as outbound (so a self-linking page is never an orphan).
   */
  function orphans(): string[] {
    const result: string[] = [];
    for (const page of pages.values()) {
      const hasOutbound = page.links.length > 0;
      const hasInbound = backlinks(page.slug).length > 0;
      if (!hasOutbound && !hasInbound) result.push(page.slug);
    }
    return result;
  }

  /** Every outbound wikilink that points to a non-existent page. */
  function brokenLinks(): Array<{ from: string; to: string }> {
    const result: Array<{ from: string; to: string }> = [];
    for (const page of pages.values()) {
      for (const link of page.links) {
        if (!pages.has(link)) result.push({ from: page.slug, to: link });
      }
    }
    return result;
  }

  /**
   * Rename a page slug. If oldSlug is missing → false.
   * If newSlug already exists (and differs) → throws 'slug collision'.
   * Rewrites all backlink bodies: every `[[X]]` where slugify(X) === oldSlug
   * is replaced by `[[newSlug]]`, then links are recomputed.
   */
  function rename(oldSlug: string, newSlug: string): boolean {
    if (oldSlug === newSlug) return true;
    if (!pages.has(oldSlug)) return false;
    if (pages.has(newSlug)) throw new Error('slug collision');

    const page = pages.get(oldSlug)!;
    const now = nowStr();

    // Move the page
    const renamedPage: WikiPage = {
      ...page,
      slug: newSlug,
      updatedAt: now,
      version: page.version + 1,
    };
    pages.delete(oldSlug);
    pages.set(newSlug, renamedPage);

    // Rewrite backlinks in every other page
    for (const [slug, p] of pages.entries()) {
      if (slug === newSlug) continue;   // skip the just-moved page
      if (!p.links.includes(oldSlug)) continue;

      const newBody = p.body.replace(/\[\[([^\]\n]+?)\]\]/g, (match, capture) => {
        return slugify(capture) === oldSlug ? `[[${newSlug}]]` : match;
      });
      const updated: WikiPage = {
        ...p,
        body: newBody,
        links: parseWikilinks(newBody),
        updatedAt: now,
        version: p.version + 1,
      };
      pages.set(slug, updated);
    }

    scheduleFlush();
    return true;
  }

  /** Cancel any pending debounce timer and immediately write to disk. */
  async function flush(): Promise<void> {
    if (!storePath) return;
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    return flushNow();
  }

  /** Clear all pages and schedule an autosave (writes empty store). */
  function reset(): void {
    pages.clear();
    scheduleFlush();
  }

  return {
    upsert,
    get,
    list,
    remove,
    search,
    backlinks,
    orphans,
    brokenLinks,
    rename,
    flush,
    reset,
  };
}
