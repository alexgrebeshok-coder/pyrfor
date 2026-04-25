// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { promises as fsp } from 'fs';

import {
  slugify,
  validateDraft,
  renderToolHandlerStub,
  draftToolsFromPatterns,
  createToolGeneratorStore,
} from './auto-tool-generator.js';
import type { ToolDraft, PatternCandidate } from './auto-tool-generator.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

function makePattern(overrides: Partial<PatternCandidate> = {}): PatternCandidate {
  return {
    id: 'pat-001',
    kind: 'tool-sequence',
    signature: 'fetch -> process -> save',
    occurrences: 10,
    exampleInputs: ['analyse this file', 'process data'],
    exampleSessionIds: ['s1', 's2'],
    toolSequence: ['fetch', 'process', 'save'],
    detectedAt: new Date().toISOString(),
    weight: 0.8,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<ToolDraft> = {}): ToolDraft {
  return {
    id: 'draft-001',
    slug: 'fetch-process-save',
    name: 'fetch + process + save',
    description: 'Executes the fetch, process, and save sequence.',
    rationale: 'Seen 10 times in trajectories.',
    inputSchema: {
      type: 'object',
      properties: { input: { type: 'string', description: 'User input' } },
      required: ['input'],
      additionalProperties: false,
    },
    handlerCode: "const r = await ctx.callTool('fetch', args);\nreturn r;",
    examples: [{ input: { input: 'test' }, expectedOutputShape: 'Record<string, unknown>' }],
    patternIds: ['pat-001'],
    occurrences: 10,
    status: 'proposed',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Store file path in os.tmpdir() ─────────────────────────────────────────

function tmpStorePath(suffix = ''): string {
  const dir = path.join(os.tmpdir(), `pyrfor-atg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `auto-tools${suffix}.json`);
}

// ═══════════════════════════════════════════════════════════════════════════
// slugify
// ═══════════════════════════════════════════════════════════════════════════

describe('slugify', () => {
  it('lowercases input', () => {
    expect(slugify('HELLO')).toBe('hello');
  });

  it('replaces spaces with hyphens', () => {
    expect(slugify('hello world')).toBe('hello-world');
  });

  it('strips punctuation', () => {
    expect(slugify('Code Review TS!')).toBe('code-review-ts');
  });

  it('collapses multiple dashes into one', () => {
    expect(slugify('multi---dashes')).toBe('multi-dashes');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --hello--  ')).toBe('hello');
  });

  it('returns "unnamed" for empty / all-special input', () => {
    expect(slugify('')).toBe('unnamed');
    expect(slugify('!!!')).toBe('unnamed');
  });

  it('strips non-ASCII characters', () => {
    expect(slugify('Analyse кода')).toBe('analyse');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// validateDraft
// ═══════════════════════════════════════════════════════════════════════════

describe('validateDraft', () => {
  it('returns [] for a valid draft', () => {
    expect(validateDraft(makeDraft())).toEqual([]);
  });

  it('errors when slug contains uppercase', () => {
    const errors = validateDraft(makeDraft({ slug: 'FetchData' }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/slug/i);
  });

  it('errors when slug has a leading hyphen', () => {
    const errors = validateDraft(makeDraft({ slug: '-bad-slug' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('errors when slug has a trailing hyphen', () => {
    const errors = validateDraft(makeDraft({ slug: 'bad-slug-' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('errors when name is empty', () => {
    const errors = validateDraft(makeDraft({ name: '' }));
    expect(errors).toContainEqual(expect.stringMatching(/name/i));
  });

  it('errors when name is whitespace only', () => {
    const errors = validateDraft(makeDraft({ name: '   ' }));
    expect(errors).toContainEqual(expect.stringMatching(/name/i));
  });

  it('errors when description is shorter than 10 chars', () => {
    const errors = validateDraft(makeDraft({ description: 'Short' }));
    expect(errors).toContainEqual(expect.stringMatching(/description/i));
  });

  it('accepts description of exactly 10 chars', () => {
    const errors = validateDraft(makeDraft({ description: '1234567890' }));
    expect(errors.filter((e) => /description/i.test(e))).toHaveLength(0);
  });

  it('errors when inputSchema.type is not "object"', () => {
    const draft = makeDraft();
    (draft.inputSchema as unknown as { type: string }).type = 'array';
    const errors = validateDraft(draft);
    expect(errors).toContainEqual(expect.stringMatching(/inputSchema/i));
  });

  it('errors when handlerCode is empty', () => {
    const errors = validateDraft(makeDraft({ handlerCode: '' }));
    expect(errors).toContainEqual(expect.stringMatching(/handlerCode/i));
  });

  it('errors when handlerCode has neither "return" nor "await ctx"', () => {
    const errors = validateDraft(makeDraft({ handlerCode: 'console.log("noop");' }));
    expect(errors).toContainEqual(expect.stringMatching(/handlerCode/i));
  });

  it('accepts handlerCode containing "return"', () => {
    const errors = validateDraft(makeDraft({ handlerCode: 'return args;' }));
    expect(errors.filter((e) => /handlerCode/i.test(e))).toHaveLength(0);
  });

  it('accepts handlerCode containing "await ctx"', () => {
    const errors = validateDraft(makeDraft({ handlerCode: 'const r = await ctx.callTool("x", args); return r;' }));
    expect(errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// renderToolHandlerStub
// ═══════════════════════════════════════════════════════════════════════════

describe('renderToolHandlerStub', () => {
  const draft = makeDraft({
    slug: 'fetch-process-save',
    status: 'proposed',
    handlerCode: "const r = await ctx.callTool('fetch', args);\nreturn r;",
    patternIds: ['pat-001', 'pat-002'],
  });

  it('contains the slug in the header comment', () => {
    expect(renderToolHandlerStub(draft)).toContain('Slug: fetch-process-save');
  });

  it('contains the status in the header comment', () => {
    expect(renderToolHandlerStub(draft)).toContain('Status: proposed');
  });

  it('contains source pattern ids', () => {
    expect(renderToolHandlerStub(draft)).toContain('pat-001');
    expect(renderToolHandlerStub(draft)).toContain('pat-002');
  });

  it('embeds the JSON inputSchema', () => {
    const stub = renderToolHandlerStub(draft);
    expect(stub).toContain('"type": "object"');
    expect(stub).toContain('inputSchema');
  });

  it('contains the handlerCode body', () => {
    const stub = renderToolHandlerStub(draft);
    expect(stub).toContain("ctx.callTool('fetch', args)");
    expect(stub).toContain('return r;');
  });

  it('imports ToolHandler from tool-types.js', () => {
    expect(renderToolHandlerStub(draft)).toContain("from './tool-types.js'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// draftToolsFromPatterns
// ═══════════════════════════════════════════════════════════════════════════

describe('draftToolsFromPatterns', () => {
  it('uses deterministic fallback when llmFn is missing', async () => {
    const patterns = [makePattern({ occurrences: 8 })];
    const drafts = await draftToolsFromPatterns(patterns);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe('proposed');
    expect(drafts[0].handlerCode).toContain('await ctx.callTool');
    expect(drafts[0].patternIds).toContain('pat-001');
  });

  it('filters out patterns below minOccurrences', async () => {
    const patterns = [
      makePattern({ id: 'p1', occurrences: 3 }),
      makePattern({ id: 'p2', occurrences: 8 }),
    ];
    const drafts = await draftToolsFromPatterns(patterns, { minOccurrences: 5 });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].patternIds).toContain('p2');
  });

  it('caps results at maxDrafts', async () => {
    const patterns = Array.from({ length: 10 }, (_, i) =>
      makePattern({ id: `p${i}`, occurrences: 10 + i }),
    );
    const drafts = await draftToolsFromPatterns(patterns, { maxDrafts: 3 });
    expect(drafts).toHaveLength(3);
  });

  it('skips patterns whose derived slug overlaps with existingTools', async () => {
    const patterns = [makePattern({ occurrences: 10 })];
    const drafts = await draftToolsFromPatterns(patterns, {
      existingTools: ['fetch-process-save'],
    });
    expect(drafts).toHaveLength(0);
  });

  it('calls llmFn with a prompt that mentions the tool sequence', async () => {
    const llmFn = vi.fn().mockRejectedValue(new Error('ignore'));
    const pattern = makePattern({ toolSequence: ['search', 'rank', 'return-top'] });
    await draftToolsFromPatterns([pattern], { llmFn });
    expect(llmFn).toHaveBeenCalledTimes(1);
    expect(llmFn.mock.calls[0][0]).toContain('search');
    expect(llmFn.mock.calls[0][0]).toContain('rank');
  });

  it('uses llmFn JSON response when valid', async () => {
    const payload = {
      name: 'search-and-rank',
      description: 'Searches the corpus and ranks results by relevance score.',
      rationale: 'Repeated pattern found 10 times.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
        additionalProperties: false,
      },
      handlerCode: "const r = await ctx.callTool('search', { query: args.query }); return r;",
      examples: [{ input: { query: 'hello' }, expectedOutputShape: '{ results: string[] }' }],
    };
    const llmFn = vi.fn().mockResolvedValue(JSON.stringify(payload));
    const drafts = await draftToolsFromPatterns([makePattern()], { llmFn });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].name).toBe('search-and-rank');
    expect(drafts[0].slug).toBe('search-and-rank');
    expect(drafts[0].description).toContain('Searches the corpus');
  });

  it('falls back deterministically when llmFn returns garbage', async () => {
    const llmFn = vi.fn().mockResolvedValue('this is { not valid json !!');
    const drafts = await draftToolsFromPatterns([makePattern()], { llmFn });
    expect(drafts).toHaveLength(1);
    // Deterministic fallback uses the tool sequence
    expect(drafts[0].handlerCode).toContain('await ctx.callTool');
  });

  it('falls back deterministically when llmFn produces an invalid draft', async () => {
    // Name is empty → validateDraft will fail → fallback
    const payload = {
      name: '',
      description: 'x', // too short
      rationale: '',
      inputSchema: { type: 'array' }, // wrong type
      handlerCode: 'console.log("no return");',
      examples: [],
    };
    const llmFn = vi.fn().mockResolvedValue(JSON.stringify(payload));
    const drafts = await draftToolsFromPatterns([makePattern()], { llmFn });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].handlerCode).toContain('await ctx.callTool');
  });

  it('falls back deterministically when llmFn rejects (no throw)', async () => {
    const llmFn = vi.fn().mockRejectedValue(new Error('network error'));
    const drafts = await draftToolsFromPatterns([makePattern()], { llmFn });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].handlerCode).toContain('await ctx.callTool');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ToolGeneratorStore
// ═══════════════════════════════════════════════════════════════════════════

describe('ToolGeneratorStore', () => {
  it('add returns the same draft; list returns it', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    const draft = makeDraft();
    const returned = store.add(draft);
    expect(returned).toEqual(draft);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toEqual(draft);
  });

  it('list filters by single status', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    store.add(makeDraft({ id: 'd1', slug: 'd1', status: 'proposed' }));
    store.add(makeDraft({ id: 'd2', slug: 'd2', status: 'approved' }));
    const proposed = store.list({ status: 'proposed' });
    expect(proposed).toHaveLength(1);
    expect(proposed[0].id).toBe('d1');
  });

  it('list filters by status array', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    store.add(makeDraft({ id: 'd1', slug: 'd1', status: 'proposed' }));
    store.add(makeDraft({ id: 'd2', slug: 'd2', status: 'approved' }));
    store.add(makeDraft({ id: 'd3', slug: 'd3', status: 'archived' }));
    const results = store.list({ status: ['proposed', 'archived'] });
    expect(results).toHaveLength(2);
    const ids = results.map((d) => d.id);
    expect(ids).toContain('d1');
    expect(ids).toContain('d3');
  });

  it('list filters by slug', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    store.add(makeDraft({ id: 'd1', slug: 'alpha' }));
    store.add(makeDraft({ id: 'd2', slug: 'beta' }));
    const results = store.list({ slug: 'alpha' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('d1');
  });

  it('get returns draft by id', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    const draft = makeDraft({ id: 'known' });
    store.add(draft);
    expect(store.get('known')).toEqual(draft);
  });

  it('get returns null for missing id', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    expect(store.get('nonexistent')).toBeNull();
  });

  it('update mutates fields and returns updated draft', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    store.add(makeDraft({ id: 'd1', slug: 'd1' }));
    const updated = store.update('d1', { reviewerNotes: 'looks good' });
    expect(updated).not.toBeNull();
    expect(updated!.reviewerNotes).toBe('looks good');
    expect(store.get('d1')!.reviewerNotes).toBe('looks good');
  });

  it('update returns null for missing id', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    expect(store.update('missing', { reviewerNotes: 'x' })).toBeNull();
  });

  it('approve sets status to "approved" and records decidedAt', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    store.add(makeDraft({ id: 'd1', slug: 'd1' }));
    const result = store.approve('d1', 'alice', 'LGTM');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('approved');
    expect(result!.decidedBy).toBe('alice');
    expect(result!.reviewerNotes).toBe('LGTM');
    expect(result!.decidedAt).toBeDefined();
  });

  it('reject sets status to "rejected" and records decidedAt', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    store.add(makeDraft({ id: 'd1', slug: 'd1', status: 'proposed' }));
    const result = store.reject('d1', 'bob', 'not needed');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('rejected');
    expect(result!.decidedBy).toBe('bob');
    expect(result!.decidedAt).toBeDefined();
  });

  it('approve of already-approved draft is idempotent (returns updated draft)', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    store.add(makeDraft({ id: 'd1', slug: 'd1', status: 'approved' }));
    const result = store.approve('d1', 'carol');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('approved');
    expect(result!.decidedBy).toBe('carol');
  });

  it('reject after approve returns null (forbidden transition)', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    store.add(makeDraft({ id: 'd1', slug: 'd1', status: 'approved' }));
    const result = store.reject('d1', 'dan');
    expect(result).toBeNull();
    // status must remain approved
    expect(store.get('d1')!.status).toBe('approved');
  });

  it('archive sets status to "archived"', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    store.add(makeDraft({ id: 'd1', slug: 'd1' }));
    const result = store.archive('d1');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('archived');
    expect(store.get('d1')!.status).toBe('archived');
  });

  it('remove returns true for existing id, then false', () => {
    const store = createToolGeneratorStore({ filePath: tmpStorePath() });
    store.add(makeDraft({ id: 'd1', slug: 'd1' }));
    expect(store.remove('d1')).toBe(true);
    expect(store.remove('d1')).toBe(false);
  });

  it('save + load round-trip preserves drafts', () => {
    const fp = tmpStorePath();
    const store = createToolGeneratorStore({ filePath: fp });
    const d1 = makeDraft({ id: 'rt1', slug: 'rt1' });
    const d2 = makeDraft({ id: 'rt2', slug: 'rt2', status: 'approved' });
    store.add(d1);
    store.add(d2);
    store.save();

    const store2 = createToolGeneratorStore({ filePath: fp });
    store2.load();
    expect(store2.list()).toHaveLength(2);
    expect(store2.get('rt1')).toMatchObject({ id: 'rt1', status: 'proposed' });
    expect(store2.get('rt2')).toMatchObject({ id: 'rt2', status: 'approved' });
  });

  it('load with missing file initialises to empty store', () => {
    const fp = path.join(
      os.tmpdir(),
      `pyrfor-missing-${Date.now()}.json`,
    );
    const store = createToolGeneratorStore({ filePath: fp });
    store.load(); // file does not exist
    expect(store.list()).toHaveLength(0);
  });

  it('load with corrupt JSON initialises to empty store (graceful degradation)', () => {
    const fp = tmpStorePath('-corrupt');
    // Write a half-written / corrupt JSON file
    writeFileSync(fp, '[ { "id": "x", "slug": "half', 'utf8');
    const store = createToolGeneratorStore({ filePath: fp });
    store.load();
    // Corrupt file → empty store, no throw
    expect(store.list()).toHaveLength(0);
  });
});
