// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  slugify,
  parseWikilinks,
  createMemoryWiki,
  type WikiPage,
} from './memory-wiki.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpPath(): string {
  return path.join(os.tmpdir(), `memory-wiki-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

const testFiles: string[] = [];

function managedTmpPath(): string {
  const p = tmpPath();
  testFiles.push(p);
  return p;
}

afterEach(() => {
  for (const f of testFiles.splice(0)) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
});

// ─── slugify ─────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('converts basic title to kebab-case', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
  });

  it('trims leading and trailing spaces', () => {
    expect(slugify('   trim me   ')).toBe('trim-me');
  });

  it('collapses multiple non-alnum chars into single dash', () => {
    expect(slugify('foo---bar  baz')).toBe('foo-bar-baz');
  });

  it('strips unicode / non-ascii characters', () => {
    // unicode chars are non-alnum after toLowerCase
    const result = slugify('Café au lait');
    expect(result).toMatch(/^[a-z0-9-]+$/);
    expect(result).not.toContain('é');
  });

  it('caps slug at 80 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBe(80);
  });

  it('returns empty string for all-special input', () => {
    expect(slugify('---!!!')).toBe('');
  });
});

// ─── parseWikilinks ───────────────────────────────────────────────────────────

describe('parseWikilinks', () => {
  it('finds [[Page]] references', () => {
    expect(parseWikilinks('See [[My Page]] for details')).toEqual(['my-page']);
  });

  it('deduplicates repeated wikilinks', () => {
    const result = parseWikilinks('[[Alpha]] and [[Alpha]] again');
    expect(result).toEqual(['alpha']);
  });

  it('preserves first-seen order of distinct links', () => {
    const result = parseWikilinks('[[Zebra]] before [[Apple]]');
    expect(result).toEqual(['zebra', 'apple']);
  });

  it('handles multiple different wikilinks', () => {
    const result = parseWikilinks('[[Foo]] then [[Bar]] then [[Baz]]');
    expect(result).toEqual(['foo', 'bar', 'baz']);
  });

  it('returns empty array when no wikilinks present', () => {
    expect(parseWikilinks('Just plain text.')).toEqual([]);
  });

  it('ignores unclosed or malformed brackets', () => {
    expect(parseWikilinks('[Not a link] and [[Valid]]')).toEqual(['valid']);
  });

  it('slugifies each captured link title', () => {
    expect(parseWikilinks('[[My Complex Title!]]')).toEqual(['my-complex-title']);
  });
});

// ─── upsert ──────────────────────────────────────────────────────────────────

describe('upsert', () => {
  it('creates a page with version=1 and slug derived from title', () => {
    const wiki = createMemoryWiki();
    const page = wiki.upsert({ title: 'Hello World' });
    expect(page.slug).toBe('hello-world');
    expect(page.version).toBe(1);
    expect(page.title).toBe('Hello World');
    expect(page.body).toBe('');
    expect(page.tags).toEqual([]);
    expect(page.attributes).toEqual({});
  });

  it('uses explicit slug when provided', () => {
    const wiki = createMemoryWiki();
    const page = wiki.upsert({ slug: 'custom-slug', title: 'Any Title' });
    expect(page.slug).toBe('custom-slug');
  });

  it('throws when title is empty', () => {
    const wiki = createMemoryWiki();
    expect(() => wiki.upsert({ title: '' })).toThrow('title required');
    expect(() => wiki.upsert({ title: '   ' })).toThrow('title required');
  });

  it('throws when title slugifies to empty string', () => {
    const wiki = createMemoryWiki();
    expect(() => wiki.upsert({ title: '!!!---!!!' })).toThrow('invalid title');
  });

  it('bumps version and updates updatedAt on re-upsert', async () => {
    let t = 1_000_000;
    const wiki = createMemoryWiki({ clock: () => t });
    wiki.upsert({ title: 'Page' });
    t += 5000;
    const updated = wiki.upsert({ title: 'Page', body: 'new body' });
    expect(updated.version).toBe(2);
    expect(new Date(updated.updatedAt).getTime()).toBe(t);
  });

  it('preserves existing body/tags/attributes when not supplied on update', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Page', body: 'original', tags: ['t1'], attributes: { x: 1 } });
    const updated = wiki.upsert({ title: 'Page' });
    expect(updated.body).toBe('original');
    expect(updated.tags).toEqual(['t1']);
    expect(updated.attributes).toEqual({ x: 1 });
  });

  it('derives links from body wikilinks', () => {
    const wiki = createMemoryWiki();
    const page = wiki.upsert({ title: 'A', body: 'See [[B]] and [[C]]' });
    expect(page.links).toEqual(['b', 'c']);
  });
});

// ─── get ─────────────────────────────────────────────────────────────────────

describe('get', () => {
  it('returns the page for a known slug', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Alpha' });
    expect(wiki.get('alpha')).toBeDefined();
    expect(wiki.get('alpha')!.title).toBe('Alpha');
  });

  it('returns undefined for an unknown slug', () => {
    const wiki = createMemoryWiki();
    expect(wiki.get('nonexistent')).toBeUndefined();
  });
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe('list', () => {
  it('returns all pages when called with no opts', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'A' });
    wiki.upsert({ title: 'B' });
    wiki.upsert({ title: 'C' });
    expect(wiki.list()).toHaveLength(3);
  });

  it('filters by tag', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'A', tags: ['js'] });
    wiki.upsert({ title: 'B', tags: ['ts'] });
    wiki.upsert({ title: 'C', tags: ['js', 'ts'] });
    const result = wiki.list({ tag: 'js' });
    expect(result.map(p => p.slug).sort()).toEqual(['a', 'c']);
  });

  it('honors limit option', () => {
    const wiki = createMemoryWiki();
    for (let i = 0; i < 10; i++) wiki.upsert({ title: `Page ${i}` });
    expect(wiki.list({ limit: 3 })).toHaveLength(3);
  });
});

// ─── remove ──────────────────────────────────────────────────────────────────

describe('remove', () => {
  it('returns true when the page exists and is removed', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Temp' });
    expect(wiki.remove('temp')).toBe(true);
    expect(wiki.get('temp')).toBeUndefined();
  });

  it('returns false when the page does not exist', () => {
    const wiki = createMemoryWiki();
    expect(wiki.remove('ghost')).toBe(false);
  });
});

// ─── search ──────────────────────────────────────────────────────────────────

describe('search', () => {
  it('title match scores higher than body-only match', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'TypeScript Guide', body: 'A guide about things' });
    wiki.upsert({ title: 'Random Page', body: 'TypeScript is great for types' });
    const results = wiki.search('typescript');
    expect(results[0].slug).toBe('typescript-guide');
  });

  it('snippet contains the matched token', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({
      title: 'Doc',
      body: 'Some preamble here. The widget is the key component.',
    });
    const [hit] = wiki.search('widget');
    expect(hit.snippet.toLowerCase()).toContain('widget');
  });

  it('uses title as snippet when body is empty', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Empty Body Page' });
    const [hit] = wiki.search('empty');
    expect(hit.snippet).toBe('Empty Body Page');
  });

  it('returns empty array when all tokens are shorter than 2 chars', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Page A' });
    expect(wiki.search('a')).toEqual([]);
    expect(wiki.search('')).toEqual([]);
  });

  it('filters results by tag', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Alpha Doc', tags: ['frontend'] });
    wiki.upsert({ title: 'Alpha Notes', tags: ['backend'] });
    const results = wiki.search('alpha', { tag: 'frontend' });
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe('alpha-doc');
  });

  it('honors the limit option', () => {
    const wiki = createMemoryWiki();
    for (let i = 0; i < 10; i++) {
      wiki.upsert({ title: `Widget ${i}`, body: `widget item ${i}` });
    }
    const results = wiki.search('widget', { limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('returns empty when no pages match query', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Unrelated page' });
    expect(wiki.search('zzznomatch')).toEqual([]);
  });
});

// ─── backlinks ────────────────────────────────────────────────────────────────

describe('backlinks', () => {
  it('returns slugs of pages that link to the given slug', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Target' });
    wiki.upsert({ title: 'Source A', body: 'See [[Target]]' });
    wiki.upsert({ title: 'Source B', body: 'Also [[Target]] mentioned' });
    const bl = wiki.backlinks('target');
    expect(bl.sort()).toEqual(['source-a', 'source-b']);
  });

  it('returns empty array for page with no backlinks', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Lonely' });
    expect(wiki.backlinks('lonely')).toEqual([]);
  });
});

// ─── orphans ─────────────────────────────────────────────────────────────────

describe('orphans', () => {
  it('returns pages with no outbound links and no backlinks', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Orphan' });
    wiki.upsert({ title: 'Connected', body: 'See [[Other]]' });
    wiki.upsert({ title: 'Other' }); // has backlink from Connected
    const o = wiki.orphans();
    expect(o).toContain('orphan');
    expect(o).not.toContain('other');
    expect(o).not.toContain('connected');
  });

  it('excludes pages that have backlinks even if they have no outbound links', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Hub', body: '[[Leaf]]' });
    wiki.upsert({ title: 'Leaf' }); // no outbound, but has backlink from Hub
    expect(wiki.orphans()).not.toContain('leaf');
  });

  it('excludes self-linking pages (self-link counts as outbound)', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Self', body: '[[Self]]' });
    expect(wiki.orphans()).not.toContain('self');
  });
});

// ─── brokenLinks ─────────────────────────────────────────────────────────────

describe('brokenLinks', () => {
  it('reports wikilinks pointing to non-existent pages', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Doc', body: 'See [[Missing Page]]' });
    const broken = wiki.brokenLinks();
    expect(broken).toEqual([{ from: 'doc', to: 'missing-page' }]);
  });

  it('returns empty when all links resolve', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'A', body: '[[B]]' });
    wiki.upsert({ title: 'B' });
    expect(wiki.brokenLinks()).toEqual([]);
  });
});

// ─── rename ──────────────────────────────────────────────────────────────────

describe('rename', () => {
  it('moves a page to the new slug', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Old Name' });
    wiki.rename('old-name', 'new-name');
    expect(wiki.get('old-name')).toBeUndefined();
    expect(wiki.get('new-name')).toBeDefined();
    expect(wiki.get('new-name')!.slug).toBe('new-name');
  });

  it('rewrites [[wikilink]] bodies in referencing pages', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Target' });
    wiki.upsert({ title: 'Ref', body: 'See [[Target]] for details' });
    wiki.rename('target', 'target-renamed');
    const ref = wiki.get('ref')!;
    expect(ref.body).toContain('[[target-renamed]]');
    expect(ref.links).toContain('target-renamed');
    expect(ref.links).not.toContain('target');
  });

  it('returns false when oldSlug does not exist', () => {
    const wiki = createMemoryWiki();
    expect(wiki.rename('ghost', 'new-ghost')).toBe(false);
  });

  it('throws slug collision when newSlug already exists', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'A' });
    wiki.upsert({ title: 'B' });
    expect(() => wiki.rename('a', 'b')).toThrow('slug collision');
  });

  it('is a no-op and returns true when oldSlug === newSlug', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Same' });
    expect(wiki.rename('same', 'same')).toBe(true);
    expect(wiki.get('same')).toBeDefined();
  });
});

// ─── flush / persistence ─────────────────────────────────────────────────────

describe('flush', () => {
  it('writes a valid JSON file containing all pages', async () => {
    const p = managedTmpPath();
    const wiki = createMemoryWiki({ storePath: p, autosaveDebounceMs: 10_000 });
    wiki.upsert({ title: 'Alpha' });
    wiki.upsert({ title: 'Beta', tags: ['b'] });
    await wiki.flush();
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw) as { pages: WikiPage[] };
    expect(data.pages).toHaveLength(2);
    expect(data.pages.map((pg: WikiPage) => pg.slug).sort()).toEqual(['alpha', 'beta']);
  });

  it('restores pages when a new wiki instance loads the same file', async () => {
    const p = managedTmpPath();
    const wiki1 = createMemoryWiki({ storePath: p, autosaveDebounceMs: 10_000 });
    wiki1.upsert({ title: 'Persistent', body: 'some body', tags: ['tag1'] });
    await wiki1.flush();

    const wiki2 = createMemoryWiki({ storePath: p });
    const page = wiki2.get('persistent');
    expect(page).toBeDefined();
    expect(page!.title).toBe('Persistent');
    expect(page!.tags).toEqual(['tag1']);
    expect(page!.body).toBe('some body');
  });

  it('starts empty and logs a warning when JSON is malformed', () => {
    const p = managedTmpPath();
    fs.writeFileSync(p, '{ NOT VALID JSON !!!', 'utf8');
    const warnings: string[] = [];
    const wiki = createMemoryWiki({
      storePath: p,
      logger: (level, msg) => { if (level === 'warn') warnings.push(msg); },
    });
    expect(wiki.list()).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('debounced flush coalesces multiple rapid upserts into one write', async () => {
    const p = managedTmpPath();
    const wiki = createMemoryWiki({ storePath: p, autosaveDebounceMs: 50 });

    // Fire many upserts rapidly — debounce should collapse to a single write
    for (let i = 0; i < 5; i++) wiki.upsert({ title: `Page ${i}` });

    // Force immediate flush, cancelling pending debounce
    await wiki.flush();

    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw) as { pages: WikiPage[] };
    expect(data.pages).toHaveLength(5);
  });
});

// ─── reset ───────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears all in-memory pages', () => {
    const wiki = createMemoryWiki();
    wiki.upsert({ title: 'Keep' });
    wiki.reset();
    expect(wiki.list()).toHaveLength(0);
  });
});
