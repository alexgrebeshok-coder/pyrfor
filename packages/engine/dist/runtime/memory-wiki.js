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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
// ─── Utilities ────────────────────────────────────────────────────────────────
/**
 * Convert arbitrary text into a canonical lowercase-kebab slug.
 * Rules: lowercase → replace non-alnum with '-' → collapse repeats → trim '-' → cap 80 chars.
 */
export function slugify(title) {
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
export function parseWikilinks(body) {
    const regex = /\[\[([^\]\n]+?)\]\]/g;
    const seen = new Set();
    const result = [];
    let match;
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
export function createMemoryWiki(opts) {
    var _a, _b, _c, _d;
    const storePath = opts === null || opts === void 0 ? void 0 : opts.storePath;
    const debounceMs = (_a = opts === null || opts === void 0 ? void 0 : opts.autosaveDebounceMs) !== null && _a !== void 0 ? _a : 200;
    const clock = (_b = opts === null || opts === void 0 ? void 0 : opts.clock) !== null && _b !== void 0 ? _b : (() => Date.now());
    const log = (_c = opts === null || opts === void 0 ? void 0 : opts.logger) !== null && _c !== void 0 ? _c : (() => { });
    // Primary storage: slug → WikiPage
    const pages = new Map();
    // ── Load from disk ────────────────────────────────────────────────────────
    if (storePath) {
        try {
            const raw = readFileSync(storePath, 'utf8');
            const data = JSON.parse(raw);
            for (const page of (_d = data.pages) !== null && _d !== void 0 ? _d : []) {
                pages.set(page.slug, page);
            }
            log('info', 'memory-wiki loaded', { count: pages.size, path: storePath });
        }
        catch (err) {
            const e = err;
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
    let debounceTimer;
    let flushInFlight;
    function scheduleFlush() {
        if (!storePath)
            return;
        if (debounceTimer !== undefined)
            clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = undefined;
            flushNow().catch((err) => {
                log('error', 'memory-wiki: background flush failed', {
                    error: err.message,
                });
            });
        }, debounceMs);
    }
    function flushNow() {
        if (!storePath)
            return Promise.resolve();
        // Coalesce concurrent calls: return the in-flight promise if present
        if (flushInFlight !== undefined)
            return flushInFlight;
        const content = JSON.stringify({ pages: Array.from(pages.values()) }, null, 2);
        const dir = path.dirname(path.resolve(storePath));
        const tmp = path.join(dir, `.memory-wiki.tmp.${randomBytes(4).toString('hex')}`);
        flushInFlight = new Promise((resolve, reject) => {
            try {
                mkdirSync(dir, { recursive: true });
                writeFileSync(tmp, content, 'utf8');
                renameSync(tmp, storePath);
                log('info', 'memory-wiki flushed', { path: storePath });
                resolve();
            }
            catch (err) {
                try {
                    unlinkSync(tmp);
                }
                catch ( /* best-effort cleanup */_a) { /* best-effort cleanup */ }
                log('error', 'memory-wiki: flush failed', {
                    error: err.message,
                });
                reject(err);
            }
            finally {
                flushInFlight = undefined;
            }
        });
        return flushInFlight;
    }
    // ── Helpers ───────────────────────────────────────────────────────────────
    function nowStr() {
        return new Date(clock()).toISOString();
    }
    // ── MemoryWiki interface methods ──────────────────────────────────────────
    function upsert(input) {
        var _a, _b, _c, _d;
        if (!input.title || !input.title.trim())
            throw new Error('title required');
        const slug = (_a = input.slug) !== null && _a !== void 0 ? _a : slugify(input.title);
        if (!slug)
            throw new Error('invalid title');
        const now = nowStr();
        const existing = pages.get(slug);
        let page;
        if (existing) {
            const body = input.body !== undefined ? input.body : existing.body;
            const tags = input.tags !== undefined ? input.tags : existing.tags;
            const attributes = input.attributes !== undefined ? input.attributes : existing.attributes;
            page = Object.assign(Object.assign({}, existing), { body,
                tags,
                attributes, links: parseWikilinks(body), updatedAt: now, version: existing.version + 1 });
        }
        else {
            const body = (_b = input.body) !== null && _b !== void 0 ? _b : '';
            const tags = (_c = input.tags) !== null && _c !== void 0 ? _c : [];
            const attributes = (_d = input.attributes) !== null && _d !== void 0 ? _d : {};
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
    function get(slug) {
        return pages.get(slug);
    }
    function list(opts) {
        let result = Array.from(pages.values());
        if ((opts === null || opts === void 0 ? void 0 : opts.tag) !== undefined) {
            const tag = opts.tag;
            result = result.filter(p => p.tags.includes(tag));
        }
        if ((opts === null || opts === void 0 ? void 0 : opts.limit) !== undefined) {
            result = result.slice(0, opts.limit);
        }
        return result;
    }
    function remove(slug) {
        if (!pages.has(slug))
            return false;
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
    function search(query, opts) {
        var _a;
        const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
        if (tokens.length === 0)
            return [];
        const limit = (_a = opts === null || opts === void 0 ? void 0 : opts.limit) !== null && _a !== void 0 ? _a : 20;
        const filterTag = opts === null || opts === void 0 ? void 0 : opts.tag;
        let candidates = Array.from(pages.values());
        if (filterTag !== undefined) {
            candidates = candidates.filter(p => p.tags.includes(filterTag));
        }
        const hits = [];
        for (const page of candidates) {
            const titleLower = page.title.toLowerCase();
            const bodyLower = page.body.toLowerCase();
            let score = 0;
            let firstMatchedToken;
            for (const token of tokens) {
                let titleHits = 0;
                let pos = titleLower.indexOf(token);
                while (pos !== -1) {
                    titleHits++;
                    pos = titleLower.indexOf(token, pos + 1);
                }
                let bodyHits = 0;
                pos = bodyLower.indexOf(token);
                while (pos !== -1) {
                    bodyHits++;
                    pos = bodyLower.indexOf(token, pos + 1);
                }
                let tagHits = 0;
                for (const tag of page.tags) {
                    if (tag.toLowerCase().includes(token))
                        tagHits++;
                }
                const tokenScore = titleHits * 3 + bodyHits + tagHits * 2;
                if (tokenScore > 0 && firstMatchedToken === undefined) {
                    firstMatchedToken = token;
                }
                score += tokenScore;
            }
            if (score === 0)
                continue;
            let snippet;
            if (page.body) {
                if (firstMatchedToken !== undefined) {
                    const matchPos = bodyLower.indexOf(firstMatchedToken);
                    if (matchPos !== -1) {
                        const start = Math.max(0, matchPos - 20);
                        snippet = page.body.slice(start, start + 120);
                    }
                    else {
                        snippet = page.body.slice(0, 120);
                    }
                }
                else {
                    snippet = page.body.slice(0, 120);
                }
            }
            else {
                snippet = page.title;
            }
            hits.push({ slug: page.slug, title: page.title, score, snippet });
        }
        hits.sort((a, b) => b.score !== a.score ? b.score - a.score : a.slug.localeCompare(b.slug));
        return hits.slice(0, limit);
    }
    /** All pages whose outbound links include the given slug. */
    function backlinks(slug) {
        const result = [];
        for (const page of pages.values()) {
            if (page.links.includes(slug))
                result.push(page.slug);
        }
        return result;
    }
    /**
     * Pages with NO outbound links and NO inbound backlinks.
     * Self-links count as outbound (so a self-linking page is never an orphan).
     */
    function orphans() {
        const result = [];
        for (const page of pages.values()) {
            const hasOutbound = page.links.length > 0;
            const hasInbound = backlinks(page.slug).length > 0;
            if (!hasOutbound && !hasInbound)
                result.push(page.slug);
        }
        return result;
    }
    /** Every outbound wikilink that points to a non-existent page. */
    function brokenLinks() {
        const result = [];
        for (const page of pages.values()) {
            for (const link of page.links) {
                if (!pages.has(link))
                    result.push({ from: page.slug, to: link });
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
    function rename(oldSlug, newSlug) {
        if (oldSlug === newSlug)
            return true;
        if (!pages.has(oldSlug))
            return false;
        if (pages.has(newSlug))
            throw new Error('slug collision');
        const page = pages.get(oldSlug);
        const now = nowStr();
        // Move the page
        const renamedPage = Object.assign(Object.assign({}, page), { slug: newSlug, updatedAt: now, version: page.version + 1 });
        pages.delete(oldSlug);
        pages.set(newSlug, renamedPage);
        // Rewrite backlinks in every other page
        for (const [slug, p] of pages.entries()) {
            if (slug === newSlug)
                continue; // skip the just-moved page
            if (!p.links.includes(oldSlug))
                continue;
            const newBody = p.body.replace(/\[\[([^\]\n]+?)\]\]/g, (match, capture) => {
                return slugify(capture) === oldSlug ? `[[${newSlug}]]` : match;
            });
            const updated = Object.assign(Object.assign({}, p), { body: newBody, links: parseWikilinks(newBody), updatedAt: now, version: p.version + 1 });
            pages.set(slug, updated);
        }
        scheduleFlush();
        return true;
    }
    /** Cancel any pending debounce timer and immediately write to disk. */
    function flush() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!storePath)
                return;
            if (debounceTimer !== undefined) {
                clearTimeout(debounceTimer);
                debounceTimer = undefined;
            }
            return flushNow();
        });
    }
    /** Clear all pages and schedule an autosave (writes empty store). */
    function reset() {
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
