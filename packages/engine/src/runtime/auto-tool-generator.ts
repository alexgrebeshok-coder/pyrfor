/**
 * auto-tool-generator.ts — Pyrfor self-improvement: automatic tool draft generator.
 *
 * Takes top PatternCandidates from the pattern miner and synthesises draft ToolSpec
 * objects (TS handler stubs + JSON schemas) for user review and approval.
 *
 * PERSISTENCE MODEL:
 *   The store persists drafts to a single JSON file (default ~/.pyrfor/auto-tools.json).
 *   load() reads the file; save() uses an atomic tmp-then-rename pattern.
 *   Both are synchronous to keep the store interface simple.
 *
 * ATOMIC WRITE:
 *   save() writes to a sibling .tmp file then calls renameSync.
 *   On any write error the tmp file is cleaned up and the error is re-thrown.
 *   load() on a corrupt or missing file silently initialises to an empty store.
 *
 * TRANSITION RULES:
 *   proposed → approved / rejected / archived (all allowed)
 *   approved → approved (idempotent; timestamps updated)
 *   approved → rejected  NOT allowed (returns null)
 *   rejected → archived (allowed)
 *   any → archived (allowed)
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import type { PatternCandidate } from './pattern-miner.js';

export type { PatternCandidate };

// ── Public types ───────────────────────────────────────────────────────────

export type ToolDraftStatus = 'proposed' | 'approved' | 'rejected' | 'archived';

export interface ToolDraft {
  id: string;
  slug: string;
  name: string;
  description: string;
  rationale: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
    additionalProperties?: false;
  };
  /** TS function body — the code inside the handler arrow function. */
  handlerCode: string;
  examples: Array<{ input: Record<string, unknown>; expectedOutputShape: string }>;
  /** IDs of the PatternCandidates that justified this draft. */
  patternIds: string[];
  occurrences: number;
  status: ToolDraftStatus;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reviewerNotes?: string;
}

export interface DraftFromPatternOptions {
  /** Called with a structured prompt; must return strict JSON. */
  llmFn?: (prompt: string) => Promise<string>;
  /** Only patterns with occurrences ≥ this value are considered. Default: 5. */
  minOccurrences?: number;
  /** Maximum drafts to produce per call. Default: 5. */
  maxDrafts?: number;
  /** Existing tool slugs — skip patterns whose derived slug overlaps. */
  existingTools?: string[];
  /** Recorded in the rationale for traceability; not used functionally. */
  scope?: string;
}

export interface ToolGeneratorStore {
  list(filter?: { status?: ToolDraftStatus | ToolDraftStatus[]; slug?: string }): ToolDraft[];
  get(id: string): ToolDraft | null;
  add(draft: ToolDraft): ToolDraft;
  update(id: string, patch: Partial<ToolDraft>): ToolDraft | null;
  approve(id: string, by?: string, notes?: string): ToolDraft | null;
  reject(id: string, by?: string, notes?: string): ToolDraft | null;
  archive(id: string): ToolDraft | null;
  remove(id: string): boolean;
  /** Synchronously reads and replaces the in-memory store from disk. Tolerates missing / corrupt files. */
  load(): void;
  /** Synchronously persists the in-memory store atomically (tmp + rename). */
  save(): void;
}

export interface ToolGeneratorStoreOptions {
  /** Absolute path to the JSON store file. Default: ~/.pyrfor/auto-tools.json */
  filePath?: string;
}

// ── ULID-like ID generation ────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + randomBytes(10).toString('hex');
}

// ── slugify ────────────────────────────────────────────────────────────────

/**
 * Convert arbitrary text to a kebab-case ASCII slug (max 64 chars).
 *
 * - Non-ASCII characters are stripped before conversion.
 * - Consecutive non-alphanumeric characters collapse to a single hyphen.
 * - Leading/trailing hyphens are removed.
 * - If nothing remains, returns 'unnamed'.
 *
 * Examples:
 *   slugify('Code Review TS!')   → 'code-review-ts'
 *   slugify('multi---dashes')    → 'multi-dashes'
 *   slugify('!!!')               → 'unnamed'
 */
export function slugify(input: string): string {
  const result = input
    .toLowerCase()
    .replace(/[^\x00-\x7F]/g, '') // strip non-ASCII
    .replace(/[^a-z0-9]+/g, '-') // collapse non-alnum runs to single hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .slice(0, 64)
    .replace(/-+$/g, ''); // re-trim after slice in case slice exposed a trailing hyphen
  return result || 'unnamed';
}

// ── validateDraft ──────────────────────────────────────────────────────────

/**
 * Returns an array of validation error strings.  Empty array means the draft is valid.
 *
 * Rules:
 *  1. slug must be kebab-case: lowercase alphanumeric + hyphens, no leading/trailing hyphen.
 *  2. name must be non-empty.
 *  3. description must be at least 10 characters.
 *  4. inputSchema.type must === 'object'.
 *  5. handlerCode must be non-empty and contain 'return' or 'await ctx'.
 */
export function validateDraft(d: ToolDraft): string[] {
  const errors: string[] = [];

  if (!d.slug || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(d.slug)) {
    errors.push(
      'slug must be kebab-case (lowercase alphanumeric and hyphens; no leading/trailing hyphens)',
    );
  }

  if (!d.name || d.name.trim().length === 0) {
    errors.push('name must be non-empty');
  }

  if (!d.description || d.description.length < 10) {
    errors.push('description must be at least 10 characters');
  }

  if (!d.inputSchema || d.inputSchema.type !== 'object') {
    errors.push('inputSchema.type must be "object"');
  }

  if (!d.handlerCode || d.handlerCode.trim().length === 0) {
    errors.push('handlerCode must be non-empty');
  } else if (!d.handlerCode.includes('return') && !d.handlerCode.includes('await ctx')) {
    errors.push('handlerCode must contain "return" or "await ctx"');
  }

  return errors;
}

// ── renderToolHandlerStub ──────────────────────────────────────────────────

/**
 * Produces a self-contained TS file body for the handler, ready to be written to disk.
 */
export function renderToolHandlerStub(draft: ToolDraft): string {
  const indentedBody = draft.handlerCode
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return [
    `/**`,
    ` * Auto-generated by Pyrfor (G+9). Slug: ${draft.slug}`,
    ` * Status: ${draft.status}`,
    ` * Source patterns: ${draft.patternIds.join(', ')}`,
    ` */`,
    `import type { ToolHandler } from './tool-types.js';`,
    ``,
    `export const inputSchema = ${JSON.stringify(draft.inputSchema, null, 2)};`,
    ``,
    `export const handler: ToolHandler = async (args, ctx) => {`,
    indentedBody,
    `};`,
  ].join('\n');
}

// ── Deterministic fallback draft builder ───────────────────────────────────

function buildDeterministicDraft(
  pattern: PatternCandidate,
): Omit<ToolDraft, 'id' | 'status' | 'createdAt'> {
  const tools = (pattern.toolSequence ?? []).length > 0
    ? (pattern.toolSequence as string[])
    : [pattern.signature.split(/\s*->\s*/)[0] ?? 'tool'];

  const joinedTools = tools.join(' + ');
  const slug = slugify(joinedTools);

  const description =
    `Executes the tool sequence: ${tools.join(' → ')}. ` +
    `Observed ${pattern.occurrences} time${pattern.occurrences === 1 ? '' : 's'} across trajectories.`;

  const rationale =
    `Pattern detected ${pattern.occurrences} time${pattern.occurrences === 1 ? '' : 's'} ` +
    `with signature: "${pattern.signature}".` +
    (pattern.successRate !== undefined ? ` Success rate: ${(pattern.successRate * 100).toFixed(0)}%.` : '');

  const toolCallLines = tools.map(
    (t, i) => `const result${i} = await ctx.callTool('${t}', args);`,
  );
  const lastIndex = tools.length - 1;
  const handlerCode = [...toolCallLines, `return result${lastIndex};`].join('\n');

  const examples = pattern.exampleInputs.slice(0, 2).map((inp) => ({
    input: { input: inp },
    expectedOutputShape: 'Record<string, unknown>',
  }));

  return {
    slug,
    name: joinedTools,
    description,
    rationale,
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'User input or task description' },
      },
      required: ['input'],
      additionalProperties: false,
    },
    handlerCode,
    examples,
    patternIds: [pattern.id],
    occurrences: pattern.occurrences,
  };
}

// ── LLM helpers ────────────────────────────────────────────────────────────

function buildLLMPrompt(pattern: PatternCandidate, scope?: string): string {
  const tools = pattern.toolSequence ?? [];
  const lines: string[] = [
    "You are Pyrfor's auto-tool generator. Given a detected usage pattern from trajectory analysis,",
    'generate a draft tool spec that a developer can review and approve.',
    '',
    `Pattern signature: ${pattern.signature}`,
    `Tool sequence: ${tools.join(' -> ')}`,
    `Occurrences: ${pattern.occurrences}`,
    `Example inputs: ${pattern.exampleInputs.slice(0, 3).join(' | ')}`,
  ];

  if (scope) lines.push(`Scope: ${scope}`);

  lines.push(
    '',
    'Respond with STRICT JSON only — no markdown fences, no extra text:',
    '{',
    '  "name": "kebab-case-slug (e.g. fetch-and-summarise)",',
    '  "description": "1-3 sentences describing what this tool does",',
    '  "rationale": "why this repeated pattern justifies a dedicated tool",',
    '  "inputSchema": {',
    '    "type": "object",',
    '    "properties": { "fieldName": { "type": "string", "description": "..." } },',
    '    "required": ["fieldName"],',
    '    "additionalProperties": false',
    '  },',
    '  "handlerCode": "// body of the async handler\\nconst r = await ctx.callTool(\'tool\', args); return r;",',
    '  "examples": [{ "input": { "fieldName": "example value" }, "expectedOutputShape": "{ result: string }" }]',
    '}',
  );

  return lines.join('\n');
}

function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

type LLMPayload = {
  name?: unknown;
  description?: unknown;
  rationale?: unknown;
  inputSchema?: unknown;
  handlerCode?: unknown;
  examples?: unknown;
};

function parseLLMResponse(raw: string): LLMPayload | null {
  try {
    return JSON.parse(stripFences(raw)) as LLMPayload;
  } catch {
    return null;
  }
}

function mergeLLMIntoDraft(
  payload: LLMPayload,
  pattern: PatternCandidate,
  id: string,
  fallback: Omit<ToolDraft, 'id' | 'status' | 'createdAt'>,
): ToolDraft {
  const name = typeof payload.name === 'string' && payload.name.trim()
    ? payload.name.trim()
    : fallback.name;

  const slug = slugify(name);

  const description = typeof payload.description === 'string' && payload.description.trim()
    ? payload.description.trim()
    : fallback.description;

  const rationale = typeof payload.rationale === 'string' && payload.rationale.trim()
    ? payload.rationale.trim()
    : fallback.rationale;

  const inputSchema =
    payload.inputSchema &&
    typeof payload.inputSchema === 'object' &&
    (payload.inputSchema as { type?: unknown }).type === 'object'
      ? (payload.inputSchema as ToolDraft['inputSchema'])
      : fallback.inputSchema;

  const handlerCode = typeof payload.handlerCode === 'string' && payload.handlerCode.trim()
    ? payload.handlerCode.trim()
    : fallback.handlerCode;

  const examples = Array.isArray(payload.examples) && payload.examples.length > 0
    ? (payload.examples as ToolDraft['examples'])
    : fallback.examples;

  return {
    id,
    slug,
    name,
    description,
    rationale,
    inputSchema,
    handlerCode,
    examples,
    patternIds: [pattern.id],
    occurrences: pattern.occurrences,
    status: 'proposed',
    createdAt: new Date().toISOString(),
  };
}

// ── draftToolsFromPatterns ─────────────────────────────────────────────────

/**
 * Filters, sorts, and converts PatternCandidates into draft tool specs.
 *
 * If llmFn is provided, calls it for each pattern and parses the JSON response.
 * Falls back to a deterministic stub if:
 *  - llmFn is not provided
 *  - llmFn throws
 *  - the response is not valid JSON
 *  - the produced draft fails validateDraft
 *
 * Patterns whose derived slug overlaps with existingTools are skipped after
 * draft generation (to allow slug normalisation to complete first).
 */
export async function draftToolsFromPatterns(
  patterns: PatternCandidate[],
  opts?: DraftFromPatternOptions,
): Promise<ToolDraft[]> {
  const minOccurrences = opts?.minOccurrences ?? 5;
  const maxDrafts = opts?.maxDrafts ?? 5;
  const existingTools = new Set(opts?.existingTools ?? []);

  const eligible = patterns
    .filter((p) => p.occurrences >= minOccurrences)
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, maxDrafts);

  const drafts: ToolDraft[] = [];

  for (const pattern of eligible) {
    const id = generateId();
    const fallback = buildDeterministicDraft(pattern);
    let draft: ToolDraft | null = null;

    if (opts?.llmFn) {
      try {
        const prompt = buildLLMPrompt(pattern, opts.scope);
        const raw = await opts.llmFn(prompt);
        const payload = parseLLMResponse(raw);
        if (payload) {
          const candidate = mergeLLMIntoDraft(payload, pattern, id, fallback);
          const errors = validateDraft(candidate);
          if (errors.length === 0) {
            draft = candidate;
          }
        }
      } catch {
        // fallthrough to deterministic
      }
    }

    if (!draft) {
      draft = {
        id,
        ...fallback,
        status: 'proposed',
        createdAt: new Date().toISOString(),
      };
    }

    if (existingTools.has(draft.slug)) continue;

    drafts.push(draft);
  }

  return drafts;
}

// ── Atomic write helper (sync) ─────────────────────────────────────────────

function atomicWriteSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.tmp.${randomBytes(4).toString('hex')}`,
  );
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, filePath);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // best effort cleanup
    }
    throw err;
  }
}

// ── createToolGeneratorStore ───────────────────────────────────────────────

export function createToolGeneratorStore(opts?: ToolGeneratorStoreOptions): ToolGeneratorStore {
  const filePath =
    opts?.filePath ?? path.join(homedir(), '.pyrfor', 'auto-tools.json');

  const _drafts = new Map<string, ToolDraft>();

  // ── read helpers ──────────────────────────────────────────────────────────

  function list(
    filter?: { status?: ToolDraftStatus | ToolDraftStatus[]; slug?: string },
  ): ToolDraft[] {
    let items = Array.from(_drafts.values());

    if (filter?.status !== undefined) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      items = items.filter((d) => statuses.includes(d.status));
    }
    if (filter?.slug !== undefined) {
      items = items.filter((d) => d.slug === filter.slug);
    }

    return items;
  }

  function get(id: string): ToolDraft | null {
    return _drafts.get(id) ?? null;
  }

  // ── write helpers ─────────────────────────────────────────────────────────

  function add(draft: ToolDraft): ToolDraft {
    _drafts.set(draft.id, draft);
    return draft;
  }

  function update(id: string, patch: Partial<ToolDraft>): ToolDraft | null {
    const existing = _drafts.get(id);
    if (!existing) return null;
    const updated: ToolDraft = { ...existing, ...patch, id };
    _drafts.set(id, updated);
    return updated;
  }

  function approve(id: string, by?: string, notes?: string): ToolDraft | null {
    const existing = _drafts.get(id);
    if (!existing) return null;
    // Idempotent: approving an already-approved draft refreshes timestamps/notes.
    const updated: ToolDraft = {
      ...existing,
      status: 'approved',
      decidedAt: new Date().toISOString(),
      decidedBy: by,
      reviewerNotes: notes,
    };
    _drafts.set(id, updated);
    return updated;
  }

  function reject(id: string, by?: string, notes?: string): ToolDraft | null {
    const existing = _drafts.get(id);
    if (!existing) return null;
    // Approved → rejected transition is not allowed.
    if (existing.status === 'approved') return null;
    const updated: ToolDraft = {
      ...existing,
      status: 'rejected',
      decidedAt: new Date().toISOString(),
      decidedBy: by,
      reviewerNotes: notes,
    };
    _drafts.set(id, updated);
    return updated;
  }

  function archive(id: string): ToolDraft | null {
    const existing = _drafts.get(id);
    if (!existing) return null;
    const updated: ToolDraft = { ...existing, status: 'archived' };
    _drafts.set(id, updated);
    return updated;
  }

  function remove(id: string): boolean {
    return _drafts.delete(id);
  }

  // ── persistence ───────────────────────────────────────────────────────────

  /**
   * Synchronously load drafts from disk.
   * Tolerates missing file (initialises empty) and corrupt JSON (initialises empty).
   */
  function load(): void {
    _drafts.clear();
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as ToolDraft[];
      if (Array.isArray(parsed)) {
        for (const d of parsed) {
          _drafts.set(d.id, d);
        }
      }
    } catch {
      // missing file or corrupt JSON → start empty
    }
  }

  /**
   * Synchronously persist all drafts atomically (tmp file + rename).
   * Throws on write errors.
   */
  function save(): void {
    const items = Array.from(_drafts.values());
    const content = JSON.stringify(items, null, 2);
    atomicWriteSync(filePath, content);
  }

  return { list, get, add, update, approve, reject, archive, remove, load, save };
}
