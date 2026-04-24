// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';

import {
  SkillSynthesizer,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  slugify,
} from './skill-synth.js';
import type { Skill, SkillFrontmatter, SkillSynthLLM, SkillSynthOptions } from './skill-synth.js';
import type { SkillCandidate } from './pattern-miner.js';

// ── Temp-dir helpers ───────────────────────────────────────────────────────

const TEST_TMP_BASE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '__skill_synth_test_tmp__',
);

const _tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  await fsp.mkdir(TEST_TMP_BASE, { recursive: true });
  const unique = `ss-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dir = path.join(TEST_TMP_BASE, unique);
  await fsp.mkdir(dir, { recursive: true });
  _tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of _tmpDirs.splice(0)) {
    await fsp.rm(d, { recursive: true, force: true }).catch(() => undefined);
  }
  await fsp.rm(TEST_TMP_BASE, { recursive: true, force: true }).catch(() => undefined);
});

// ── Fixtures ───────────────────────────────────────────────────────────────

/** Minimal valid body: 200+ chars */
const VALID_BODY =
  '## Steps\n\n' +
  '1. Identify the repeating tool sequence in the trajectory.\n' +
  '2. Verify inputs match expected types before proceeding.\n' +
  '3. Execute the sequence and validate results.\n\n' +
  '## Example\n\n' +
  '```\n' +
  'const result = await executeSequence({ tools, input });\n' +
  'console.log(result);\n' +
  '```\n\n' +
  'Apply this skill when the identified pattern appears repeatedly.';

function validLLMResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'test-skill',
    title: 'Test Skill',
    category: 'general',
    when_to_use: 'Use this skill when the test pattern appears.',
    inputs: ['text'],
    outputs: ['result'],
    body: VALID_BODY,
    ...overrides,
  });
}

function makeCandidate(overrides: Partial<SkillCandidate> = {}): SkillCandidate {
  return {
    id: 'cand-001',
    kind: 'tool-sequence',
    signature: 'read_file -> run_sql -> write_file',
    occurrences: 7,
    exampleInputs: ['analyse sales data'],
    exampleSessionIds: ['sess-001'],
    toolSequence: ['read_file', 'run_sql', 'write_file'],
    averageLatencyMs: 1200,
    successRate: 0.85,
    detectedAt: new Date().toISOString(),
    weight: 0.6,
    ...overrides,
  };
}

function mockLlm(response: string): SkillSynthLLM {
  return { chat: vi.fn().mockResolvedValue(response) };
}

function makeSynth(baseDir: string, llm: SkillSynthLLM, extra: Partial<SkillSynthOptions> = {}): SkillSynthesizer {
  return new SkillSynthesizer({ baseDir, enabled: true, llm, ...extra });
}

/** Fixture: pre-built Skill with filePath = '' (unsaved). */
function makeSkill(baseSlug = 'my-skill'): Skill {
  const now = new Date().toISOString();
  const fm: SkillFrontmatter = {
    name: baseSlug,
    title: 'My Skill',
    category: 'general',
    when_to_use: 'When you need to do something useful.',
    inputs: ['text'],
    outputs: ['result'],
    source: 'auto',
    source_candidate_id: 'cand-001',
    status: 'proposed',
    weight: 0.5,
    applied_count: 0,
    success_count: 0,
    failure_count: 0,
    created_at: now,
    updated_at: now,
  };
  return { frontmatter: fm, body: VALID_BODY, filePath: '' };
}

// ── slugify ────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('converts mixed-case + spaces + punctuation to kebab-case', () => {
    expect(slugify('Code Review TS!')).toBe('code-review-ts');
  });

  it('strips Cyrillic characters and returns "unnamed" when nothing remains', () => {
    // All characters are non-ASCII; after stripping, nothing is left.
    expect(slugify('Анализ кода')).toBe('unnamed');
  });

  it('truncates to 64 characters', () => {
    const result = slugify('a'.repeat(70));
    expect(result).toBe('a'.repeat(64));
    expect(result.length).toBe(64);
  });
});

// ── parseSkillMarkdown / serializeSkillMarkdown ────────────────────────────

describe('parseSkillMarkdown / serializeSkillMarkdown', () => {
  it('round-trips a Skill through serialize → parse', () => {
    const skill = makeSkill();
    skill.filePath = '/fake/path/my-skill.md';

    const serialized = serializeSkillMarkdown(skill);
    const parsed = parseSkillMarkdown(serialized, skill.filePath);

    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter.name).toBe(skill.frontmatter.name);
    expect(parsed!.frontmatter.title).toBe(skill.frontmatter.title);
    expect(parsed!.frontmatter.inputs).toEqual(skill.frontmatter.inputs);
    expect(parsed!.frontmatter.status).toBe(skill.frontmatter.status);
    expect(parsed!.frontmatter.weight).toBe(skill.frontmatter.weight);
    expect(parsed!.frontmatter.applied_count).toBe(0);
    expect(parsed!.body).toBe(skill.body);
    expect(parsed!.filePath).toBe(skill.filePath);
  });

  it('returns null for content without frontmatter delimiters', () => {
    const result = parseSkillMarkdown('no delimiters here\nbody text', '/fake/no-fence.md');
    expect(result).toBeNull();
  });

  it('returns null for frontmatter missing required fields (malformed)', () => {
    // Has delimiters but omits most required fields
    const content = '---\nname: "incomplete"\n---\nbody here';
    const result = parseSkillMarkdown(content, '/fake/bad.md');
    expect(result).toBeNull();
  });
});

// ── SkillSynthesizer.synthesize ────────────────────────────────────────────

describe('SkillSynthesizer.synthesize', () => {
  it('returns a parsed Skill for a valid LLM response', async () => {
    const baseDir = await makeTempDir();
    const llm = mockLlm(validLLMResponse());
    const synth = makeSynth(baseDir, llm);

    const skill = await synth.synthesize(makeCandidate());

    expect(skill).not.toBeNull();
    expect(skill!.frontmatter.name).toBe('test-skill');
    expect(skill!.frontmatter.title).toBe('Test Skill');
    expect(skill!.frontmatter.status).toBe('proposed');
    expect(skill!.frontmatter.source).toBe('auto');
    expect(skill!.frontmatter.source_candidate_id).toBe('cand-001');
    expect(skill!.filePath).toBe(''); // not yet saved
  });

  it('strips markdown code fences before parsing JSON', async () => {
    const baseDir = await makeTempDir();
    const fencedResponse = '```json\n' + validLLMResponse() + '\n```';
    const llm = mockLlm(fencedResponse);
    const synth = makeSynth(baseDir, llm);

    const skill = await synth.synthesize(makeCandidate());
    expect(skill).not.toBeNull();
    expect(skill!.frontmatter.name).toBe('test-skill');
  });

  it('returns null and warns when LLM returns malformed JSON', async () => {
    const baseDir = await makeTempDir();
    const llm = mockLlm('this is not json at all { broken');
    const synth = makeSynth(baseDir, llm);

    const skill = await synth.synthesize(makeCandidate());
    expect(skill).toBeNull();
  });

  it('returns null when LLM response is missing required fields', async () => {
    const baseDir = await makeTempDir();
    // Missing 'title'
    const llm = mockLlm(JSON.stringify({ name: 'my-skill', category: 'general' }));
    const synth = makeSynth(baseDir, llm);

    const skill = await synth.synthesize(makeCandidate());
    expect(skill).toBeNull();
  });

  it('normalises an uppercase name via slugify', async () => {
    const baseDir = await makeTempDir();
    const llm = mockLlm(validLLMResponse({ name: 'Code-Review' }));
    const synth = makeSynth(baseDir, llm);

    const skill = await synth.synthesize(makeCandidate());
    expect(skill).not.toBeNull();
    expect(skill!.frontmatter.name).toBe('code-review');
  });

  it('returns null without calling LLM when disabled', async () => {
    const baseDir = await makeTempDir();
    const chat = vi.fn();
    const llm: SkillSynthLLM = { chat };
    const synth = new SkillSynthesizer({ baseDir, enabled: false, llm });

    const skill = await synth.synthesize(makeCandidate());
    expect(skill).toBeNull();
    expect(chat).not.toHaveBeenCalled();
  });
});

// ── SkillSynthesizer.save ──────────────────────────────────────────────────

describe('SkillSynthesizer.save', () => {
  it('writes the skill markdown to {baseDir}/auto/{slug}.md', async () => {
    const baseDir = await makeTempDir();
    const synth = makeSynth(baseDir, mockLlm(''));

    const skill = makeSkill('save-test');
    const saved = await synth.save(skill);

    const expectedPath = path.join(baseDir, 'auto', 'save-test.md');
    expect(saved.filePath).toBe(expectedPath);
    expect(saved.frontmatter.name).toBe('save-test');

    const content = await fsp.readFile(expectedPath, 'utf8');
    expect(content).toContain('name: "save-test"');
  });

  it('creates subdirectory recursively when it does not exist', async () => {
    const baseDir = await makeTempDir();
    // baseDir itself exists but auto/ does not
    const synth = makeSynth(baseDir, mockLlm(''));

    await expect(synth.save(makeSkill('dir-test'))).resolves.not.toThrow();
    const stat = await fsp.stat(path.join(baseDir, 'auto', 'dir-test.md'));
    expect(stat.isFile()).toBe(true);
  });

  it('appends -1 suffix when a slug collision is detected', async () => {
    const baseDir = await makeTempDir();
    const synth = makeSynth(baseDir, mockLlm(''));

    // Pre-create the file that would normally be claimed
    const autoDir = path.join(baseDir, 'auto');
    await fsp.mkdir(autoDir, { recursive: true });
    await fsp.writeFile(path.join(autoDir, 'collision.md'), 'placeholder', 'utf8');

    const skill = makeSkill('collision');
    const saved = await synth.save(skill);

    expect(saved.frontmatter.name).toBe('collision-1');
    expect(saved.filePath).toBe(path.join(autoDir, 'collision-1.md'));
    const content = await fsp.readFile(saved.filePath, 'utf8');
    expect(content).toContain('name: "collision-1"');
  });
});

// ── SkillSynthesizer.updateStatus ─────────────────────────────────────────

describe('SkillSynthesizer.updateStatus', () => {
  it('loads the skill, mutates status, and atomically rewrites', async () => {
    const baseDir = await makeTempDir();
    const synth = makeSynth(baseDir, mockLlm(''));

    const saved = await synth.save(makeSkill('update-me'));
    expect(saved.frontmatter.status).toBe('proposed');

    const updated = await synth.updateStatus('update-me', 'approved');
    expect(updated).not.toBeNull();
    expect(updated!.frontmatter.status).toBe('approved');

    // Verify persisted on disk
    const reloaded = await synth.load('update-me');
    expect(reloaded!.frontmatter.status).toBe('approved');
  });

  it('returns null when the slug does not exist', async () => {
    const baseDir = await makeTempDir();
    const synth = makeSynth(baseDir, mockLlm(''));

    const result = await synth.updateStatus('ghost-skill', 'approved');
    expect(result).toBeNull();
  });
});

// ── SkillSynthesizer.recordUsage ───────────────────────────────────────────

describe('SkillSynthesizer.recordUsage', () => {
  it('increments applied_count and success_count on success=true', async () => {
    const baseDir = await makeTempDir();
    const synth = makeSynth(baseDir, mockLlm(''));

    await synth.save(makeSkill('usage-ok'));
    await synth.recordUsage('usage-ok', true);

    const skill = await synth.load('usage-ok');
    expect(skill!.frontmatter.applied_count).toBe(1);
    expect(skill!.frontmatter.success_count).toBe(1);
    expect(skill!.frontmatter.failure_count).toBe(0);
  });

  it('increments applied_count and failure_count on success=false', async () => {
    const baseDir = await makeTempDir();
    const synth = makeSynth(baseDir, mockLlm(''));

    await synth.save(makeSkill('usage-fail'));
    await synth.recordUsage('usage-fail', false);

    const skill = await synth.load('usage-fail');
    expect(skill!.frontmatter.applied_count).toBe(1);
    expect(skill!.frontmatter.success_count).toBe(0);
    expect(skill!.frontmatter.failure_count).toBe(1);
  });

  it('produces correct counts under concurrent recordUsage calls (mutex)', async () => {
    const baseDir = await makeTempDir();
    const synth = makeSynth(baseDir, mockLlm(''));

    await synth.save(makeSkill('concurrent'));

    // Fire 10 concurrent calls: 7 successes + 3 failures
    const calls = [
      ...Array(7).fill(true),
      ...Array(3).fill(false),
    ].map((s: boolean) => synth.recordUsage('concurrent', s));
    await Promise.all(calls);

    const skill = await synth.load('concurrent');
    expect(skill!.frontmatter.applied_count).toBe(10);
    expect(skill!.frontmatter.success_count).toBe(7);
    expect(skill!.frontmatter.failure_count).toBe(3);
  });
});

// ── SkillSynthesizer.listAll / listByStatus ────────────────────────────────

describe('SkillSynthesizer.listAll / listByStatus', () => {
  it('walks both auto/ and manual/ subdirs and returns all skills', async () => {
    const baseDir = await makeTempDir();
    const synth = makeSynth(baseDir, mockLlm(''));

    // Save one auto skill
    await synth.save(makeSkill('list-auto'));

    // Manually create a manual/ skill
    const manualDir = path.join(baseDir, 'manual');
    await fsp.mkdir(manualDir, { recursive: true });
    const manualSkill = makeSkill('list-manual');
    manualSkill.frontmatter.source = 'manual';
    const manualPath = path.join(manualDir, 'list-manual.md');
    await fsp.writeFile(manualPath, serializeSkillMarkdown({ ...manualSkill, filePath: manualPath }), 'utf8');

    const all = await synth.listAll();
    const slugs = all.map((s) => s.frontmatter.name).sort();
    expect(slugs).toContain('list-auto');
    expect(slugs).toContain('list-manual');
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('listByStatus filters skills to only the requested status', async () => {
    const baseDir = await makeTempDir();
    const synth = makeSynth(baseDir, mockLlm(''));

    await synth.save(makeSkill('filter-proposed'));
    const approvedSkill = makeSkill('filter-approved');
    const savedApproved = await synth.save(approvedSkill);
    await synth.updateStatus('filter-approved', 'approved');

    // Silence TS — savedApproved is used to confirm save succeeded
    void savedApproved;

    const proposed = await synth.listByStatus('proposed');
    const approved = await synth.listByStatus('approved');

    expect(proposed.map((s) => s.frontmatter.name)).toContain('filter-proposed');
    expect(proposed.map((s) => s.frontmatter.name)).not.toContain('filter-approved');
    expect(approved.map((s) => s.frontmatter.name)).toContain('filter-approved');
  });
});

// ── SkillSynthesizer.synthesizeAndSave ────────────────────────────────────

describe('SkillSynthesizer.synthesizeAndSave', () => {
  it('returns null and does not write any file when synthesize fails', async () => {
    const baseDir = await makeTempDir();
    // LLM returns invalid JSON → synthesize returns null
    const llm = mockLlm('not-json {{');
    const synth = makeSynth(baseDir, llm);

    const result = await synth.synthesizeAndSave(makeCandidate());
    expect(result).toBeNull();

    // No files should have been created
    const autoDir = path.join(baseDir, 'auto');
    let exists = true;
    try {
      await fsp.access(autoDir);
    } catch {
      exists = false;
    }
    // Either dir doesn't exist, or it's empty
    if (exists) {
      const entries = await fsp.readdir(autoDir);
      expect(entries.filter((e) => e.endsWith('.md'))).toHaveLength(0);
    }
  });
});
