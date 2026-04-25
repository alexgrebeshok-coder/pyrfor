/**
 * skill-synth.ts — Pyrfor self-improvement: auto-skill synthesis.
 *
 * Takes a SkillCandidate from pattern-miner, drafts a markdown skill via LLM,
 * and persists it as 'proposed' under {baseDir}/auto/{slug}.md for user review.
 */

import { promises as fsp } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { logger } from '../observability/logger.js';
import type { SkillCandidate } from './pattern-miner.js';

// ── Public types ───────────────────────────────────────────────────────────

export type SkillStatus = 'proposed' | 'approved' | 'rejected' | 'archived';

export interface SkillFrontmatter {
  name: string;
  title: string;
  category: string;
  when_to_use: string;
  inputs: string[];
  outputs: string[];
  source: 'auto' | 'manual';
  source_candidate_id?: string;
  status: SkillStatus;
  weight: number;
  applied_count: number;
  success_count: number;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export interface Skill {
  frontmatter: SkillFrontmatter;
  body: string;
  /** Absolute path to file. Empty string means not yet persisted. */
  filePath: string;
}

export interface SkillSynthLLM {
  chat(
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    opts?: { model?: string; temperature?: number },
  ): Promise<string>;
}

export interface SkillSynthOptions {
  /** Root directory for skill storage. Subdirs auto/ and manual/ are created as needed. */
  baseDir: string;
  enabled: boolean;
  llm: SkillSynthLLM;
  /** Default: 'glm-4.5-flash' */
  llmModel?: string;
  /** Fallback category if LLM omits it. Default: 'general' */
  autoCategory?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_LLM_MODEL = 'glm-4.5-flash';
const BODY_MIN_LEN = 200;
const BODY_MAX_LEN = 1500;

const SKILL_SYNTH_SYSTEM_PROMPT = `Ты — синтезатор навыков для AI-агента Pyrfor. На основе обнаруженного паттерна в трейекториях ты должен создать черновик навыка (skill) — markdown-документ, который агент будет использовать как подсказку в будущем.

Формат ответа — СТРОГО валидный JSON без markdown-обёртки:
{
  "name": "kebab-case-slug",
  "title": "Человекочитаемое название",
  "category": "одна из: code-review, data-analysis, file-ops, web-research, debugging, refactoring, general",
  "when_to_use": "1-2 предложения: когда применять этот навык",
  "inputs": ["тип1", "тип2"],
  "outputs": ["тип1"],
  "body": "## Шаги\\n\\n1. Шаг 1\\n2. Шаг 2\\n\\n## Пример\\n\\n\`\`\`\\n...\\n\`\`\`"
}

Правила для body (markdown):
- Конкретные шаги, не общие фразы
- Минимум 1 пример вызова
- Если паттерн — failure-mode: добавь раздел "## Чего избегать"
- Если паттерн — user-correction: добавь раздел "## Предпочтения пользователя"
- Длина body: 200-1500 символов`;

// ── Per-file mutex ─────────────────────────────────────────────────────────

class Mutex {
  private _queue: Array<() => void> = [];
  private _locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this._locked) {
          this._locked = true;
          resolve(() => {
            this._locked = false;
            const next = this._queue.shift();
            if (next) next();
          });
        } else {
          this._queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }
}

// ── Internal helpers ───────────────────────────────────────────────────────

function stripMarkdownFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/**
 * Atomic write: write to a sibling .tmp file, then rename.
 * Keeps writes in the same directory to ensure same-filesystem rename.
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.tmp.${randomBytes(4).toString('hex')}`,
  );
  try {
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, filePath);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => undefined);
    throw err;
  }
}

// ── Pure helpers (exported for tests) ─────────────────────────────────────

/**
 * Convert arbitrary text to a kebab-case ASCII slug (max 64 chars).
 *
 * Non-ASCII characters (including Cyrillic, CJK, etc.) are stripped before
 * conversion. If nothing remains after stripping, returns `'unnamed'`.
 *
 * Examples:
 *   slugify('Code Review TS!')  → 'code-review-ts'
 *   slugify('Анализ кода')      → 'unnamed'  (all chars stripped)
 *   slugify('a'.repeat(70))     → 'a'.repeat(64)
 */
export function slugify(input: string): string {
  const result = input
    .toLowerCase()
    .replace(/[^\x00-\x7F]/g, '') // strip non-ASCII (Cyrillic, CJK, etc.)
    .replace(/[^a-z0-9]+/g, '-') // collapse non-alnum runs to single hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .slice(0, 64)
    .replace(/-+$/g, ''); // re-trim after slice (may expose trailing hyphen)
  return result || 'unnamed';
}

// ── YAML-like serializer ───────────────────────────────────────────────────

const FM_KEY_ORDER: Array<keyof SkillFrontmatter> = [
  'name',
  'title',
  'category',
  'when_to_use',
  'inputs',
  'outputs',
  'source',
  'source_candidate_id',
  'status',
  'weight',
  'applied_count',
  'success_count',
  'failure_count',
  'created_at',
  'updated_at',
];

function serializeFMValue(v: unknown): string {
  if (Array.isArray(v)) {
    return `[${v.map((x) => JSON.stringify(String(x))).join(', ')}]`;
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(String(v));
}

export function serializeSkillMarkdown(skill: Skill): string {
  const lines: string[] = ['---'];
  for (const key of FM_KEY_ORDER) {
    const v = skill.frontmatter[key];
    if (v === undefined) continue;
    lines.push(`${key}: ${serializeFMValue(v)}`);
  }
  lines.push('---');
  lines.push('');
  lines.push(skill.body);
  return lines.join('\n');
}

// ── YAML-like parser ───────────────────────────────────────────────────────

function parseFMValue(raw: string): unknown {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v.startsWith('[')) {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v !== '') {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return v;
}

const VALID_STATUSES = new Set<string>(['proposed', 'approved', 'rejected', 'archived']);

function isFrontmatter(fm: Record<string, unknown>): fm is SkillFrontmatter & Record<string, unknown> {
  return (
    typeof fm['name'] === 'string' &&
    fm['name'].length > 0 &&
    typeof fm['title'] === 'string' &&
    fm['title'].length > 0 &&
    typeof fm['category'] === 'string' &&
    fm['category'].length > 0 &&
    typeof fm['when_to_use'] === 'string' &&
    Array.isArray(fm['inputs']) &&
    Array.isArray(fm['outputs']) &&
    (fm['source'] === 'auto' || fm['source'] === 'manual') &&
    VALID_STATUSES.has(fm['status'] as string) &&
    typeof fm['weight'] === 'number' &&
    typeof fm['applied_count'] === 'number' &&
    typeof fm['success_count'] === 'number' &&
    typeof fm['failure_count'] === 'number' &&
    typeof fm['created_at'] === 'string' &&
    typeof fm['updated_at'] === 'string'
  );
}

/**
 * Parse a skill markdown file into a Skill object.
 * Returns null (with a warn log) if the file is malformed.
 */
export function parseSkillMarkdown(content: string, filePath: string): Skill | null {
  const lines = content.split('\n');

  // Locate opening ---
  let firstIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      firstIdx = i;
      break;
    }
  }
  if (firstIdx === -1) {
    logger.warn('[SkillSynth] No opening frontmatter delimiter', { filePath });
    return null;
  }

  // Locate closing ---
  let secondIdx = -1;
  for (let i = firstIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      secondIdx = i;
      break;
    }
  }
  if (secondIdx === -1) {
    logger.warn('[SkillSynth] No closing frontmatter delimiter', { filePath });
    return null;
  }

  const fmLines = lines.slice(firstIdx + 1, secondIdx);
  const body = lines
    .slice(secondIdx + 1)
    .join('\n')
    .trim();

  const fm: Record<string, unknown> = {};
  for (const line of fmLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const ci = trimmed.indexOf(':');
    if (ci === -1) continue;
    const key = trimmed.slice(0, ci).trim();
    const val = trimmed.slice(ci + 1).trim();
    fm[key] = parseFMValue(val);
  }

  if (!isFrontmatter(fm)) {
    logger.warn('[SkillSynth] Invalid or missing frontmatter fields', { filePath });
    return null;
  }

  return { frontmatter: fm, body, filePath };
}

// ── LLM response types ─────────────────────────────────────────────────────

interface RawSkillDraft {
  name: string;
  title: string;
  category: string;
  when_to_use: string;
  inputs: unknown[];
  outputs: unknown[];
  body: string;
}

function isRawSkillDraft(v: unknown): v is RawSkillDraft {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['name'] === 'string' &&
    r['name'].length > 0 &&
    typeof r['title'] === 'string' &&
    r['title'].length > 0 &&
    typeof r['category'] === 'string' &&
    r['category'].length > 0 &&
    typeof r['when_to_use'] === 'string' &&
    r['when_to_use'].length > 0 &&
    Array.isArray(r['inputs']) &&
    Array.isArray(r['outputs']) &&
    typeof r['body'] === 'string'
  );
}

// ── SkillSynthesizer ───────────────────────────────────────────────────────

export class SkillSynthesizer {
  private readonly baseDir: string;
  private readonly enabled: boolean;
  private readonly llm: SkillSynthLLM;
  private readonly llmModel: string;
  private readonly autoCategory: string;
  private readonly _mutexes = new Map<string, Mutex>();

  constructor(opts: SkillSynthOptions) {
    this.baseDir = opts.baseDir;
    this.enabled = opts.enabled;
    this.llm = opts.llm;
    this.llmModel = opts.llmModel ?? DEFAULT_LLM_MODEL;
    this.autoCategory = opts.autoCategory ?? 'general';
  }

  private _getMutex(fp: string): Mutex {
    let m = this._mutexes.get(fp);
    if (!m) {
      m = new Mutex();
      this._mutexes.set(fp, m);
    }
    return m;
  }

  /** Locate the on-disk file for a slug, checking auto/ then manual/. */
  private async _findFilePath(slug: string): Promise<string | null> {
    for (const sub of ['auto', 'manual'] as const) {
      const fp = path.join(this.baseDir, sub, `${slug}.md`);
      try {
        await fsp.access(fp);
        return fp;
      } catch {
        // not found in this subdir
      }
    }
    return null;
  }

  /**
   * Generate a skill draft from a SkillCandidate via LLM.
   * Returns the Skill object but does NOT write to disk (filePath = '').
   * Returns null if disabled, LLM fails, or response is invalid.
   */
  async synthesize(candidate: SkillCandidate): Promise<Skill | null> {
    if (!this.enabled) return null;

    const userMsg = JSON.stringify(
      {
        kind: candidate.kind,
        signature: candidate.signature,
        occurrences: candidate.occurrences,
        successRate: candidate.successRate ?? null,
        averageLatencyMs: candidate.averageLatencyMs ?? null,
        exampleInputs: candidate.exampleInputs,
        toolSequence: candidate.toolSequence ?? null,
        failureSignature: candidate.failureSignature ?? null,
      },
      null,
      2,
    );

    let raw: string;
    try {
      raw = await this.llm.chat(
        [
          { role: 'system', content: SKILL_SYNTH_SYSTEM_PROMPT },
          { role: 'user', content: userMsg },
        ],
        { model: this.llmModel, temperature: 0.4 },
      );
    } catch (err) {
      logger.warn('[SkillSynth] LLM call failed', { err });
      return null;
    }

    const stripped = stripMarkdownFences(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      logger.warn('[SkillSynth] Failed to parse LLM response as JSON', { raw });
      return null;
    }

    if (!isRawSkillDraft(parsed)) {
      logger.warn('[SkillSynth] LLM response missing required fields', { parsed });
      return null;
    }

    const body = parsed.body.trim();
    if (body.length < BODY_MIN_LEN || body.length > BODY_MAX_LEN) {
      logger.warn('[SkillSynth] Body length out of range', { len: body.length });
      return null;
    }

    const slug = slugify(parsed.name);
    const now = new Date().toISOString();

    return {
      frontmatter: {
        name: slug,
        title: parsed.title.trim(),
        category: parsed.category.trim() || this.autoCategory,
        when_to_use: parsed.when_to_use.trim(),
        inputs: parsed.inputs.map((x) => String(x)),
        outputs: parsed.outputs.map((x) => String(x)),
        source: 'auto',
        source_candidate_id: candidate.id,
        status: 'proposed',
        weight: candidate.weight,
        applied_count: 0,
        success_count: 0,
        failure_count: 0,
        created_at: now,
        updated_at: now,
      },
      body,
      filePath: '', // not yet persisted
    };
  }

  /**
   * Persist a skill to {baseDir}/auto/{slug}.md (or manual/).
   *
   * - If skill.filePath is set (non-empty), overwrites that file (update path).
   * - If skill.filePath is empty (new skill), resolves slug collisions by
   *   appending -1, -2, … until a unique filename is found.
   *
   * Returns the saved Skill with filePath and final slug populated.
   */
  async save(skill: Skill): Promise<Skill> {
    const subDir = skill.frontmatter.source === 'auto' ? 'auto' : 'manual';
    const dir = path.join(this.baseDir, subDir);
    await fsp.mkdir(dir, { recursive: true });

    let slug = skill.frontmatter.name;
    let filePath: string;

    if (skill.filePath) {
      // Update existing file — overwrite in place
      filePath = skill.filePath;
    } else {
      // New skill — find a unique slug
      const base = slug;
      filePath = path.join(dir, `${slug}.md`);
      for (let i = 1; ; i++) {
        try {
          await fsp.access(filePath);
          // Collision — append suffix
          slug = `${base}-${i}`;
          filePath = path.join(dir, `${slug}.md`);
        } catch {
          break; // path is available
        }
      }
    }

    const saved: Skill = {
      frontmatter: { ...skill.frontmatter, name: slug },
      body: skill.body,
      filePath,
    };

    const release = await this._getMutex(filePath).acquire();
    try {
      await atomicWrite(filePath, serializeSkillMarkdown(saved));
    } finally {
      release();
    }

    return saved;
  }

  /** Convenience: synthesize + save in one call. Returns null on LLM failure. */
  async synthesizeAndSave(candidate: SkillCandidate): Promise<Skill | null> {
    const skill = await this.synthesize(candidate);
    if (!skill) return null;
    return this.save(skill);
  }

  /**
   * Update the status field of a skill (proposed → approved / rejected / archived).
   * Loads, mutates, and atomically rewrites under per-file mutex.
   * Returns null if slug not found.
   */
  async updateStatus(slug: string, status: SkillStatus): Promise<Skill | null> {
    const fp = await this._findFilePath(slug);
    if (!fp) return null;

    const release = await this._getMutex(fp).acquire();
    try {
      let content: string;
      try {
        content = await fsp.readFile(fp, 'utf8');
      } catch {
        return null;
      }
      const skill = parseSkillMarkdown(content, fp);
      if (!skill) return null;

      const updated: Skill = {
        ...skill,
        frontmatter: {
          ...skill.frontmatter,
          status,
          updated_at: new Date().toISOString(),
        },
      };
      await atomicWrite(fp, serializeSkillMarkdown(updated));
      return updated;
    } finally {
      release();
    }
  }

  /**
   * Increment applied_count and success_count or failure_count.
   * Re-reads file under mutex to avoid lost-update under concurrency.
   */
  async recordUsage(slug: string, success: boolean): Promise<void> {
    const fp = await this._findFilePath(slug);
    if (!fp) {
      logger.warn('[SkillSynth] recordUsage: skill not found', { slug });
      return;
    }

    const release = await this._getMutex(fp).acquire();
    try {
      let content: string;
      try {
        content = await fsp.readFile(fp, 'utf8');
      } catch {
        logger.warn('[SkillSynth] recordUsage: cannot read file', { fp });
        return;
      }

      const skill = parseSkillMarkdown(content, fp);
      if (!skill) return;

      const fm = skill.frontmatter;
      const updated: Skill = {
        ...skill,
        frontmatter: {
          ...fm,
          applied_count: fm.applied_count + 1,
          success_count: fm.success_count + (success ? 1 : 0),
          failure_count: fm.failure_count + (success ? 0 : 1),
          updated_at: new Date().toISOString(),
        },
      };
      await atomicWrite(fp, serializeSkillMarkdown(updated));
    } finally {
      release();
    }
  }

  /** Walk auto/ and manual/ subdirs; skip non-.md and malformed files. */
  async listAll(): Promise<Skill[]> {
    const skills: Skill[] = [];
    for (const sub of ['auto', 'manual'] as const) {
      const dir = path.join(this.baseDir, sub);
      let entries: string[];
      try {
        entries = await fsp.readdir(dir);
      } catch {
        continue; // subdir doesn't exist yet
      }
      for (const name of entries) {
        if (!name.endsWith('.md')) continue;
        const fp = path.join(dir, name);
        try {
          const content = await fsp.readFile(fp, 'utf8');
          const skill = parseSkillMarkdown(content, fp);
          if (skill) {
            skills.push(skill);
          } else {
            logger.warn('[SkillSynth] listAll: skipping malformed file', { fp });
          }
        } catch (err) {
          logger.warn('[SkillSynth] listAll: error reading file', { fp, err });
        }
      }
    }
    return skills;
  }

  /** Return only skills matching the given status. */
  async listByStatus(status: SkillStatus): Promise<Skill[]> {
    const all = await this.listAll();
    return all.filter((s) => s.frontmatter.status === status);
  }

  /** Load a single skill by slug from auto/ or manual/. Returns null if not found. */
  async load(slug: string): Promise<Skill | null> {
    const fp = await this._findFilePath(slug);
    if (!fp) return null;
    try {
      const content = await fsp.readFile(fp, 'utf8');
      return parseSkillMarkdown(content, fp);
    } catch (err) {
      logger.warn('[SkillSynth] load: error reading file', { fp, err });
      return null;
    }
  }
}
