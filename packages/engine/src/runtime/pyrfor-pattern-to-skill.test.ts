import { describe, it, expect, vi } from 'vitest';
import { patternToSkill, emitSkills, type PatternCandidate } from './pyrfor-pattern-to-skill';
import type { SkillWriter, FcSkill } from './pyrfor-fc-skill-writer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCandidate(overrides?: Partial<PatternCandidate>): PatternCandidate {
  return {
    name: 'Test Pattern',
    description: 'A test pattern.',
    triggers: ['test', 'pattern'],
    body: '# Test\nDo something.',
    score: 0.9,
    ...overrides,
  };
}

function makeWriter(): SkillWriter & { written: FcSkill[] } {
  const written: FcSkill[] = [];
  return {
    written,
    write: vi.fn(async (skill: FcSkill) => {
      written.push(skill);
      return `/skills/${skill.fm.name}.md`;
    }),
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pyrfor-pattern-to-skill', () => {
  // 1. patternToSkill basic conversion with source filled
  it('converts a pattern to FcSkill with correct fields', () => {
    const candidate = makeCandidate();
    const skill = patternToSkill(candidate);

    expect(skill.fm.name).toBe('Test Pattern');
    expect(skill.fm.description).toBe('A test pattern.');
    expect(skill.fm.triggers).toEqual(['test', 'pattern']);
    expect(skill.fm.source).toBe('pyrfor-pattern-miner');
    expect(skill.body).toBe('# Test\nDo something.');
    expect(skill.fm.createdAt).toBeTruthy();
  });

  // 2. emitSkills with minScore filter
  it('emitSkills filters candidates below minScore threshold', async () => {
    const writer = makeWriter();
    const candidates: PatternCandidate[] = [
      makeCandidate({ name: 'high', score: 0.9 }),
      makeCandidate({ name: 'low', score: 0.3 }),
      makeCandidate({ name: 'mid', score: 0.6 }),
    ];
    await emitSkills(candidates, writer, { minScore: 0.6 });
    expect(writer.written).toHaveLength(2);
    const names = writer.written.map(s => s.fm.name);
    expect(names).toContain('high');
    expect(names).toContain('mid');
    expect(names).not.toContain('low');
  });

  // 3. emitSkills returns array of file paths
  it('emitSkills returns array of file paths', async () => {
    const writer = makeWriter();
    const candidates = [
      makeCandidate({ name: 'pattern-a', score: 1.0 }),
      makeCandidate({ name: 'pattern-b', score: 1.0 }),
    ];
    const paths = await emitSkills(candidates, writer);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(/pattern-a/);
    expect(paths[1]).toMatch(/pattern-b/);
  });

  // 4. Source defaults applied if not overridden
  it('source defaults to pyrfor-pattern-miner when not specified', () => {
    const skill = patternToSkill(makeCandidate());
    expect(skill.fm.source).toBe('pyrfor-pattern-miner');
  });

  // 5. Custom source overrides default
  it('custom source is used when provided', () => {
    const skill = patternToSkill(makeCandidate(), { source: 'custom-miner' });
    expect(skill.fm.source).toBe('custom-miner');
  });

  // 6. emitSkills with no minScore writes all candidates
  it('emitSkills with no minScore writes all candidates', async () => {
    const writer = makeWriter();
    const candidates = [
      makeCandidate({ name: 'a', score: 0 }),
      makeCandidate({ name: 'b', score: undefined }),
    ];
    const paths = await emitSkills(candidates, writer);
    expect(paths).toHaveLength(2);
  });
});
