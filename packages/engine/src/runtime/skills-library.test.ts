/**
 * skills-library.test.ts — vitest tests for SkillsLibrary and BUILTIN_SKILLS.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SkillsLibrary,
  createSkillsLibrary,
  BUILTIN_SKILLS,
  defaultSkillsLibrary,
  type Skill,
} from './skills-library.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'test-skill',
    name: 'Test Skill',
    description: 'A skill used in unit tests.',
    whenToUse: ['when testing', 'when validating'],
    systemPrompt: 'You are a test assistant.',
    steps: ['Do step one.', 'Do step two.'],
    examples: [{ input: 'Sample input', output: 'Sample output' }],
    tags: ['testing', 'unit-test'],
    ...overrides,
  };
}

// ── SkillsLibrary — basic operations ─────────────────────────────────────────

describe('SkillsLibrary — register', () => {
  it('registers a new skill without error', () => {
    const lib = createSkillsLibrary();
    expect(() => lib.register(makeSkill())).not.toThrow();
  });

  it('throws on duplicate id registration', () => {
    const lib = createSkillsLibrary();
    lib.register(makeSkill({ id: 'alpha' }));
    expect(() => lib.register(makeSkill({ id: 'alpha' }))).toThrow(/alpha/);
  });

  it('registers multiple distinct skills', () => {
    const lib = createSkillsLibrary();
    lib.register(makeSkill({ id: 'a' }));
    lib.register(makeSkill({ id: 'b' }));
    lib.register(makeSkill({ id: 'c' }));
    expect(lib.list().length).toBe(3);
  });

  it('error message contains the duplicate id', () => {
    const lib = createSkillsLibrary();
    lib.register(makeSkill({ id: 'dup-id' }));
    expect(() => lib.register(makeSkill({ id: 'dup-id' }))).toThrow('dup-id');
  });
});

describe('SkillsLibrary — get', () => {
  let lib: SkillsLibrary;
  beforeEach(() => {
    lib = createSkillsLibrary([makeSkill({ id: 'existing' })]);
  });

  it('returns the skill for a registered id', () => {
    const s = lib.get('existing');
    expect(s).toBeDefined();
    expect(s!.id).toBe('existing');
  });

  it('returns undefined for a missing id', () => {
    expect(lib.get('does-not-exist')).toBeUndefined();
  });

  it('returns undefined on empty library', () => {
    expect(createSkillsLibrary().get('anything')).toBeUndefined();
  });
});

describe('SkillsLibrary — list', () => {
  it('returns empty array for empty library', () => {
    expect(createSkillsLibrary().list()).toEqual([]);
  });

  it('returns all registered skills', () => {
    const lib = createSkillsLibrary([
      makeSkill({ id: 'x' }),
      makeSkill({ id: 'y' }),
      makeSkill({ id: 'z' }),
    ]);
    const ids = lib.list().map((s) => s.id).sort();
    expect(ids).toEqual(['x', 'y', 'z']);
  });

  it('includes skills registered after construction', () => {
    const lib = createSkillsLibrary([makeSkill({ id: 'init' })]);
    lib.register(makeSkill({ id: 'late' }));
    expect(lib.list().length).toBe(2);
  });

  it('list length equals registered count', () => {
    const lib = createSkillsLibrary();
    for (let i = 0; i < 10; i++) lib.register(makeSkill({ id: `skill-${i}` }));
    expect(lib.list().length).toBe(10);
  });
});

// ── SkillsLibrary — search ────────────────────────────────────────────────────

describe('SkillsLibrary — search', () => {
  let lib: SkillsLibrary;
  beforeEach(() => {
    lib = createSkillsLibrary([
      makeSkill({ id: 'alpha', name: 'Alpha Tool', tags: ['utility'], description: 'Utility helper' }),
      makeSkill({ id: 'beta', name: 'Beta Service', tags: ['alpha', 'service'], description: 'Service layer' }),
      makeSkill({ id: 'gamma', name: 'Gamma Widget', tags: ['widget'], description: 'An alpha-related widget' }),
    ]);
  });

  it('returns empty array when no skills match', () => {
    expect(lib.search('zzznomatch')).toEqual([]);
  });

  it('name match scores higher than tag match', () => {
    // 'alpha' is in name of 'alpha', in tags of 'beta', in description of 'gamma'
    const results = lib.search('alpha');
    expect(results[0].id).toBe('alpha');  // name match (3pts)
    expect(results[1].id).toBe('beta');   // tag match (2pts)
    expect(results[2].id).toBe('gamma');  // description match (1pt)
  });

  it('tag match scores higher than description-only match', () => {
    const results = lib.search('alpha');
    const tagIdx = results.findIndex((s) => s.id === 'beta');
    const descIdx = results.findIndex((s) => s.id === 'gamma');
    expect(tagIdx).toBeLessThan(descIdx);
  });

  it('search is case-insensitive', () => {
    expect(lib.search('ALPHA')).toHaveLength(3);
    expect(lib.search('alpha')).toHaveLength(3);
    expect(lib.search('Alpha')).toHaveLength(3);
  });

  it('returns only matching skills', () => {
    const results = lib.search('widget');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('gamma');
  });

  it('returns all skills if all match the query', () => {
    // All three have 'a' somewhere but let's use a common description word
    const lib2 = createSkillsLibrary([
      makeSkill({ id: 'a', description: 'common word here' }),
      makeSkill({ id: 'b', description: 'common word there' }),
      makeSkill({ id: 'c', description: 'common word everywhere' }),
    ]);
    expect(lib2.search('common').length).toBe(3);
  });

  it('results are sorted by score descending', () => {
    const results = lib.search('alpha');
    const scores = results.map((s) => {
      let sc = 0;
      if (s.name.toLowerCase().includes('alpha')) sc += 3;
      if (s.tags.some((t) => t.toLowerCase().includes('alpha'))) sc += 2;
      if (s.description.toLowerCase().includes('alpha')) sc += 1;
      return sc;
    });
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });
});

// ── SkillsLibrary — findRelevant ──────────────────────────────────────────────

describe('SkillsLibrary — findRelevant', () => {
  it('returns at most `limit` results', () => {
    const lib = createSkillsLibrary(BUILTIN_SKILLS);
    const results = lib.findRelevant('debug code', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('default limit is 5', () => {
    const lib = createSkillsLibrary(BUILTIN_SKILLS);
    const results = lib.findRelevant('refactor improve code quality clean architecture');
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('returns relevant skill for a clear task description', () => {
    const lib = createSkillsLibrary([
      makeSkill({ id: 'email-writer', name: 'Email Writer', whenToUse: ['writing email', 'composing email'], tags: ['email'] }),
      makeSkill({ id: 'code-helper', name: 'Code Helper', whenToUse: ['writing code', 'fix bug'], tags: ['coding'] }),
    ]);
    const results = lib.findRelevant('I need to write an email to a client');
    const ids = results.map((s) => s.id);
    expect(ids).toContain('email-writer');
  });

  it('returns empty array when no skills match', () => {
    const lib = createSkillsLibrary([
      makeSkill({ id: 'z', whenToUse: ['very specific unique thing xyzzy'], tags: ['unique'] }),
    ]);
    expect(lib.findRelevant('completely unrelated task about cooking soup')).toEqual([]);
  });

  it('findRelevant on empty library returns empty array', () => {
    expect(createSkillsLibrary().findRelevant('anything')).toEqual([]);
  });

  it('findRelevant prefers skills whose whenToUse matches the task', () => {
    const lib = createSkillsLibrary([
      makeSkill({ id: 'tester', whenToUse: ['when running tests', 'test suite failing'], tags: ['testing'] }),
      makeSkill({ id: 'builder', whenToUse: ['building project', 'compile code'], tags: ['build'] }),
    ]);
    const results = lib.findRelevant('running tests after a code change');
    expect(results[0].id).toBe('tester');
  });
});

// ── BUILTIN_SKILLS shape validation ──────────────────────────────────────────

describe('BUILTIN_SKILLS — quantity and shape', () => {
  it('has at least 35 built-in skills', () => {
    expect(BUILTIN_SKILLS.length).toBeGreaterThanOrEqual(35);
  });

  it('all skills have non-empty id', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.id.length).toBeGreaterThan(0);
    }
  });

  it('all skill ids are unique', () => {
    const ids = BUILTIN_SKILLS.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all skill ids are kebab-case', () => {
    const kebab = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
    for (const s of BUILTIN_SKILLS) {
      expect(s.id).toMatch(kebab);
    }
  });

  it('all skills have non-empty name', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.name.length).toBeGreaterThan(0);
    }
  });

  it('all skills have non-empty description', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it('all skills have at least one whenToUse entry', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.whenToUse.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all whenToUse entries are non-empty strings', () => {
    for (const s of BUILTIN_SKILLS) {
      for (const w of s.whenToUse) {
        expect(typeof w).toBe('string');
        expect(w.length).toBeGreaterThan(0);
      }
    }
  });

  it('all skills have a non-empty systemPrompt', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it('all skills have at least 4 steps', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.steps.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('all steps are non-empty strings', () => {
    for (const s of BUILTIN_SKILLS) {
      for (const step of s.steps) {
        expect(typeof step).toBe('string');
        expect(step.length).toBeGreaterThan(0);
      }
    }
  });

  it('all skills have at least one example', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.examples.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all examples have non-empty input and output', () => {
    for (const s of BUILTIN_SKILLS) {
      for (const ex of s.examples) {
        expect(ex.input.length).toBeGreaterThan(0);
        expect(ex.output.length).toBeGreaterThan(0);
      }
    }
  });

  it('all skills have at least one tag', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.tags.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all tags are non-empty strings', () => {
    for (const s of BUILTIN_SKILLS) {
      for (const tag of s.tags) {
        expect(typeof tag).toBe('string');
        expect(tag.length).toBeGreaterThan(0);
      }
    }
  });

  it('estimatedTokens, if present, is a positive number', () => {
    for (const s of BUILTIN_SKILLS) {
      if (s.estimatedTokens !== undefined) {
        expect(s.estimatedTokens).toBeGreaterThan(0);
      }
    }
  });

  it('systemPrompts are substantive (>= 50 characters)', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.systemPrompt.length).toBeGreaterThanOrEqual(50);
    }
  });
});

// ── BUILTIN_SKILLS — category coverage ───────────────────────────────────────

describe('BUILTIN_SKILLS — category coverage', () => {
  const tagSet = new Set(BUILTIN_SKILLS.flatMap((s) => s.tags));

  it('has coding skills', () => {
    expect(tagSet.has('coding')).toBe(true);
  });

  it('has data skills', () => {
    expect(tagSet.has('data')).toBe(true);
  });

  it('has workflow skills', () => {
    expect(tagSet.has('workflow')).toBe(true);
  });

  it('has communication skills', () => {
    expect(tagSet.has('communication')).toBe(true);
  });

  it('has system skills', () => {
    expect(tagSet.has('system')).toBe(true);
  });

  it('has creative skills', () => {
    expect(tagSet.has('creative')).toBe(true);
  });

  it('has research skills', () => {
    expect(tagSet.has('research')).toBe(true);
  });

  it('includes a debugging skill', () => {
    expect(BUILTIN_SKILLS.some((s) => s.id === 'debug')).toBe(true);
  });

  it('includes a code-review skill', () => {
    expect(BUILTIN_SKILLS.some((s) => s.id === 'code-review')).toBe(true);
  });

  it('includes a write-tests skill', () => {
    expect(BUILTIN_SKILLS.some((s) => s.id === 'write-tests')).toBe(true);
  });

  it('includes a git-commit skill', () => {
    expect(BUILTIN_SKILLS.some((s) => s.id === 'git-commit')).toBe(true);
  });

  it('includes a summarize-text skill', () => {
    expect(BUILTIN_SKILLS.some((s) => s.id === 'summarize-text')).toBe(true);
  });

  it('includes a plan-multistep skill', () => {
    expect(BUILTIN_SKILLS.some((s) => s.id === 'plan-multistep')).toBe(true);
  });
});

// ── defaultSkillsLibrary ──────────────────────────────────────────────────────

describe('defaultSkillsLibrary', () => {
  it('contains all BUILTIN_SKILLS', () => {
    expect(defaultSkillsLibrary.list().length).toBe(BUILTIN_SKILLS.length);
  });

  it('can retrieve a known skill by id', () => {
    expect(defaultSkillsLibrary.get('refactor')).toBeDefined();
    expect(defaultSkillsLibrary.get('debug')).toBeDefined();
  });

  it('search works on defaultSkillsLibrary', () => {
    const results = defaultSkillsLibrary.search('typescript');
    expect(results.length).toBeGreaterThan(0);
  });

  it('findRelevant works on defaultSkillsLibrary', () => {
    const results = defaultSkillsLibrary.findRelevant('I need to fix a TypeScript type error');
    expect(results.length).toBeGreaterThan(0);
  });
});

// ── createSkillsLibrary factory ───────────────────────────────────────────────

describe('createSkillsLibrary factory', () => {
  it('creates an empty library when called with no args', () => {
    const lib = createSkillsLibrary();
    expect(lib.list()).toEqual([]);
  });

  it('creates library pre-loaded with initial skills', () => {
    const skills = [makeSkill({ id: 'a' }), makeSkill({ id: 'b' })];
    const lib = createSkillsLibrary(skills);
    expect(lib.list().length).toBe(2);
  });

  it('returns a SkillsLibrary instance', () => {
    expect(createSkillsLibrary()).toBeInstanceOf(SkillsLibrary);
  });

  it('initial skills are retrievable by get()', () => {
    const lib = createSkillsLibrary([makeSkill({ id: 'pre-loaded' })]);
    expect(lib.get('pre-loaded')).toBeDefined();
  });

  it('duplicate ids in initial array cause register to throw on second', () => {
    // First is loaded in constructor, second triggers duplicate detection
    const s1 = makeSkill({ id: 'dupe' });
    const lib = createSkillsLibrary([s1]);
    expect(() => lib.register(makeSkill({ id: 'dupe' }))).toThrow();
  });
});
