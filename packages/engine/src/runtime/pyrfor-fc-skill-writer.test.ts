import { describe, it, expect, vi } from 'vitest';
import {
  slugify,
  serializeSkill,
  parseSkill,
  createFcSkillWriter,
  type FcSkill,
  type SkillWriterFs,
} from './pyrfor-fc-skill-writer';

// ─── In-memory FS stub ────────────────────────────────────────────────────────

function makeMemFs(): SkillWriterFs & { _files: Map<string, string>; _dirs: Set<string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  return {
    _files: files,
    _dirs: dirs,
    mkdir: vi.fn(async (p: string) => {
      dirs.add(p);
    }),
    writeFile: vi.fn(async (p: string, data: string) => {
      files.set(p, data);
    }),
    readFile: vi.fn(async (p: string, _enc: 'utf8') => {
      if (!files.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return files.get(p)!;
    }),
    readdir: vi.fn(async (p: string) => {
      const prefix = p.endsWith('/') ? p : p + '/';
      const result: string[] = [];
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes('/')) result.push(rest);
        }
      }
      return result;
    }),
  };
}

const TEST_DIR = '/test/skills';

function makeSkill(overrides?: Partial<FcSkill>): FcSkill {
  return {
    fm: {
      name: 'my-skill',
      description: 'Does something useful.',
      triggers: ['foo', 'bar'],
      source: 'test',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    body: '# Skill\nWhen triggered, do X.',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pyrfor-fc-skill-writer', () => {
  // 1. write calls mkdir and writeFile with correct path and content
  it('write() calls mkdir recursive and writeFile at <dir>/<slug>.md', async () => {
    const fs = makeMemFs();
    const writer = createFcSkillWriter({ dir: TEST_DIR, fs });
    const skill = makeSkill();
    const filePath = await writer.write(skill);

    expect(fs.mkdir).toHaveBeenCalledWith(TEST_DIR, { recursive: true });
    expect(filePath).toBe(`${TEST_DIR}/my-skill.md`);
    expect(fs.writeFile).toHaveBeenCalledWith(filePath, expect.stringContaining('---'));
    const content = fs._files.get(filePath)!;
    expect(content).toContain('name: my-skill');
    expect(content).toContain('description: Does something useful.');
    expect(content).toContain('# Skill');
  });

  // 2. serializeSkill round-trips through parseSkill
  it('serializeSkill round-trips via parseSkill (name/description/triggers/body match)', () => {
    const skill = makeSkill();
    const serialized = serializeSkill(skill);
    const parsed = parseSkill(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.fm.name).toBe(skill.fm.name);
    expect(parsed!.fm.description).toBe(skill.fm.description);
    expect(parsed!.fm.triggers).toEqual(skill.fm.triggers);
    expect(parsed!.body.trim()).toBe(skill.body.trim());
  });

  // 3. slugify('Foo Bar Baz') === 'foo-bar-baz'
  it('slugify basic case', () => {
    expect(slugify('Foo Bar Baz')).toBe('foo-bar-baz');
  });

  // 4. slugify with special chars
  it("slugify('My Skill: v2!') → 'my-skill-v2'", () => {
    expect(slugify('My Skill: v2!')).toBe('my-skill-v2');
  });

  // 5. slugify Russian throws with clear message
  it('slugify Russian/empty throws with clear message', () => {
    expect(() => slugify('Анализ кода')).toThrow(/empty slug/);
    expect(() => slugify('')).toThrow(/empty slug/);
    expect(() => slugify('---')).toThrow(/empty slug/);
  });

  // 6. parseSkill on malformed content returns null
  it('parseSkill malformed content returns null (no throw)', () => {
    expect(parseSkill('not yaml at all')).toBeNull();
    expect(parseSkill('--- no closing fence')).toBeNull();
    expect(parseSkill('')).toBeNull();
  });

  // 7. parseSkill missing required fields returns null
  it('parseSkill missing name or description returns null', () => {
    const noName = '---\ndescription: Something\n---\n\nbody';
    const noDesc = '---\nname: test\n---\n\nbody';
    expect(parseSkill(noName)).toBeNull();
    expect(parseSkill(noDesc)).toBeNull();
  });

  // 8. list() reads all .md files, skips bad ones
  it('list() reads all .md files, skips unparseable ones', async () => {
    const fs = makeMemFs();
    const writer = createFcSkillWriter({ dir: TEST_DIR, fs });

    // Seed the in-memory FS directly
    const good = makeSkill({ fm: { name: 'good-skill', description: 'Good.', createdAt: '2024-01-01T00:00:00.000Z' }, body: 'body' });
    const goodContent = serializeSkill(good);
    fs._files.set(`${TEST_DIR}/good-skill.md`, goodContent);
    fs._files.set(`${TEST_DIR}/bad.md`, 'totally broken content');
    fs._files.set(`${TEST_DIR}/not-markdown.txt`, 'ignored');

    const skills = await writer.list();
    expect(skills).toHaveLength(1);
    expect(skills[0].fm.name).toBe('good-skill');
  });

  // 9. get() reads correct file and returns parsed
  it('get() reads correct file and returns parsed skill', async () => {
    const fs = makeMemFs();
    const writer = createFcSkillWriter({ dir: TEST_DIR, fs });
    const skill = makeSkill();
    const content = serializeSkill(skill);
    fs._files.set(`${TEST_DIR}/my-skill.md`, content);

    const result = await writer.get('my-skill');
    expect(result).not.toBeNull();
    expect(result!.fm.name).toBe('my-skill');
  });

  // 10. get returns null if file missing
  it('get() returns null if file does not exist', async () => {
    const fs = makeMemFs();
    const writer = createFcSkillWriter({ dir: TEST_DIR, fs });
    const result = await writer.get('nonexistent');
    expect(result).toBeNull();
  });

  // 11. Triggers serialized as flow array and parsed back
  it('triggers serialized as [a, b, c] flow style and parsed back to array', () => {
    const skill = makeSkill({ fm: { name: 'trig-test', description: 'Desc.', triggers: ['alpha', 'beta', 'gamma'] } });
    const serialized = serializeSkill(skill);
    expect(serialized).toContain('triggers: [alpha, beta, gamma]');
    const parsed = parseSkill(serialized);
    expect(parsed!.fm.triggers).toEqual(['alpha', 'beta', 'gamma']);
  });

  // 12. write() fills createdAt if missing
  it('write() fills createdAt from now() if not provided', async () => {
    const fs = makeMemFs();
    const fixedDate = new Date('2025-06-01T12:00:00.000Z');
    const writer = createFcSkillWriter({ dir: TEST_DIR, fs, now: () => fixedDate });
    const skill: FcSkill = { fm: { name: 'dated-skill', description: 'Desc.' }, body: 'body' };
    const filePath = await writer.write(skill);
    const content = fs._files.get(filePath)!;
    // ISO date contains ':' so quoteIfNeeded wraps it in double quotes
    expect(content).toContain('2025-06-01T12:00:00.000Z');
  });
});
