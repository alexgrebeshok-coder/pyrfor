/**
 * pyrfor-fc-skill-writer.ts — Write FC skills to ~/.freeclaude/skills/.
 *
 * Handcrafted YAML frontmatter (no external deps).
 * slugify: lowercase, non-alphanumeric runs → '-', trim edges, collapse multiples.
 * Non-ASCII is stripped (Cyrillic → empty → throws with clear message).
 */

import { homedir } from 'os';
import path from 'path';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SkillFrontmatter {
  name: string;
  description: string;
  triggers?: string[];
  source?: string;
  createdAt?: string;
}

export interface FcSkill {
  fm: SkillFrontmatter;
  body: string;
}

export interface SkillWriterFs {
  mkdir: (p: string, opts: { recursive: boolean }) => Promise<void>;
  writeFile: (p: string, data: string) => Promise<void>;
  readFile: (p: string, enc: 'utf8') => Promise<string>;
  readdir: (p: string) => Promise<string[]>;
  stat?: (p: string) => Promise<any>;
}

export interface SkillWriterOptions {
  /** Skills dir. Default: ~/.freeclaude/skills */
  dir?: string;
  /** Filesystem (for tests). Default: node:fs/promises. */
  fs?: SkillWriterFs;
  /** Clock. */
  now?: () => Date;
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
}

export interface SkillWriter {
  /**
   * Write a new skill (overwrite if file exists).
   * Filename: slugified(fm.name) + '.md'.
   * Returns the file path.
   */
  write(skill: FcSkill): Promise<string>;

  /** Read all skills from dir; skip files that don't parse. */
  list(): Promise<FcSkill[]>;

  /** Get one by name (slugified). */
  get(name: string): Promise<FcSkill | null>;
}

// ─── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * slugify: lowercase, strip non-ASCII, replace non-alphanumeric runs with '-',
 * trim edges, collapse multiples.
 *
 * Non-ASCII chars (e.g. Cyrillic) are stripped before processing.
 * If the result is empty or only '-', throws with a clear message.
 */
export function slugify(input: string): string {
  const result = input
    .toLowerCase()
    .replace(/[^\x00-\x7F]/g, '') // strip non-ASCII
    .replace(/[^a-z0-9]+/g, '-') // non-alnum → hyphen
    .replace(/^-+|-+$/g, '') // trim edges
    .replace(/-{2,}/g, '-'); // collapse multiples

  if (!result || result === '-') {
    throw new Error(
      `slugify: input "${input}" produces an empty slug after stripping non-ASCII and non-alphanumeric characters`,
    );
  }

  return result;
}

/** Quote a YAML scalar string if it contains ':' or '#'. */
function quoteIfNeeded(s: string): string {
  if (s.includes(':') || s.includes('#') || s.includes('"') || s.includes("'")) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** Serialize array as flow-style YAML: [a, b, c] */
function serializeArray(arr: string[]): string {
  return `[${arr.map(quoteIfNeeded).join(', ')}]`;
}

/**
 * Serialize FcSkill to markdown string with YAML frontmatter.
 * Only known fields serialized; arrays as flow-style.
 */
export function serializeSkill(skill: FcSkill): string {
  const { fm, body } = skill;
  const lines: string[] = ['---'];

  lines.push(`name: ${quoteIfNeeded(fm.name)}`);
  lines.push(`description: ${quoteIfNeeded(fm.description)}`);

  if (fm.triggers && fm.triggers.length > 0) {
    lines.push(`triggers: ${serializeArray(fm.triggers)}`);
  }

  if (fm.source) {
    lines.push(`source: ${quoteIfNeeded(fm.source)}`);
  }

  if (fm.createdAt) {
    lines.push(`createdAt: ${quoteIfNeeded(fm.createdAt)}`);
  }

  lines.push('---');
  lines.push('');
  lines.push(body);

  return lines.join('\n');
}

/** Parse flow-style array `[a, b, c]` → string[] */
function parseFlowArray(raw: string): string[] {
  const inner = raw.trim();
  if (!inner.startsWith('[') || !inner.endsWith(']')) return [];
  const content = inner.slice(1, -1).trim();
  if (!content) return [];

  const items: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuote) {
      if (ch === '\\' && i + 1 < content.length) {
        i++;
        current += content[i];
      } else if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ',') {
      items.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

/** Unquote a YAML scalar string value. */
function unquote(s: string): string {
  const trimmed = s.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

/**
 * Parse a markdown string with YAML frontmatter into FcSkill.
 * Returns null on any parse failure (no throw).
 */
export function parseSkill(content: string): FcSkill | null {
  try {
    // Frontmatter must start at position 0
    if (!content.startsWith('---')) return null;

    const afterFirst = content.slice(3);
    // Allow '---\n' or '---\r\n'
    const restAfterOpen = afterFirst.startsWith('\n')
      ? afterFirst.slice(1)
      : afterFirst.startsWith('\r\n')
      ? afterFirst.slice(2)
      : null;

    if (restAfterOpen === null) return null;

    // Find closing ---
    const closeMatch = restAfterOpen.match(/^([\s\S]*?)\n---(?:\r?\n|$)/);
    if (!closeMatch) return null;

    const fmRaw = closeMatch[1];
    const afterFm = restAfterOpen.slice(closeMatch[0].length);
    // Strip single leading newline from body
    const body = afterFm.startsWith('\n') ? afterFm.slice(1) : afterFm;

    // Parse frontmatter key-value pairs
    const fm: Partial<SkillFrontmatter> = {};

    for (const line of fmRaw.split('\n')) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const key = line.slice(0, colon).trim();
      const rawVal = line.slice(colon + 1).trim();

      if (!key) continue;

      if (rawVal.startsWith('[')) {
        const arr = parseFlowArray(rawVal);
        if (key === 'triggers') fm.triggers = arr;
      } else {
        const val = unquote(rawVal);
        if (key === 'name') fm.name = val;
        else if (key === 'description') fm.description = val;
        else if (key === 'source') fm.source = val;
        else if (key === 'createdAt') fm.createdAt = val;
      }
    }

    if (!fm.name || !fm.description) return null;

    return {
      fm: fm as SkillFrontmatter,
      body,
    };
  } catch {
    return null;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createFcSkillWriter(opts?: SkillWriterOptions): SkillWriter {
  const dir = opts?.dir ?? path.join(homedir(), '.freeclaude', 'skills');
  const now = opts?.now ?? (() => new Date());
  const log = opts?.logger ?? (() => {});

  // Lazy-load real fs so tests can inject stubs
  let _fs: SkillWriterFs | null = opts?.fs ?? null;
  const getFs = (): SkillWriterFs => {
    if (_fs) return _fs;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fsp = require('fs').promises as SkillWriterFs;
    _fs = fsp;
    return _fs;
  };

  return {
    async write(skill: FcSkill): Promise<string> {
      const fsi = getFs();
      const slug = slugify(skill.fm.name);
      const filledFm: SkillFrontmatter = {
        ...skill.fm,
        createdAt: skill.fm.createdAt ?? now().toISOString(),
      };
      const filled: FcSkill = { fm: filledFm, body: skill.body };
      const content = serializeSkill(filled);
      const filePath = path.join(dir, `${slug}.md`);

      await fsi.mkdir(dir, { recursive: true });
      await fsi.writeFile(filePath, content);
      log('info', `Skill written: ${filePath}`);
      return filePath;
    },

    async list(): Promise<FcSkill[]> {
      const fsi = getFs();
      let files: string[];
      try {
        files = await fsi.readdir(dir);
      } catch {
        return [];
      }

      const skills: FcSkill[] = [];
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        try {
          const content = await fsi.readFile(path.join(dir, file), 'utf8');
          const skill = parseSkill(content);
          if (skill) {
            skills.push(skill);
          } else {
            log('warn', `Skipping unparseable skill file: ${file}`);
          }
        } catch (err) {
          log('warn', `Failed to read skill file: ${file}`, err);
        }
      }
      return skills;
    },

    async get(name: string): Promise<FcSkill | null> {
      const fsi = getFs();
      const slug = slugify(name);
      const filePath = path.join(dir, `${slug}.md`);
      try {
        const content = await fsi.readFile(filePath, 'utf8');
        return parseSkill(content);
      } catch {
        return null;
      }
    },
  };
}
