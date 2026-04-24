// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createLessonsStore, extractLessons } from './ralph-lessons-store.js';

function tmpDir(suffix: string): string {
  const d = path.join(os.tmpdir(), `ralph-lessons-test-${suffix}-${Date.now()}`);
  return d;
}

describe('ralph-lessons-store', () => {
  it('add returns entry with id and createdAt', () => {
    const dir = tmpDir('add');
    const store = createLessonsStore({ dir });
    const entry = store.add({ iteration: 1, text: 'hello', tags: ['a'], weight: 0.9 });
    expect(entry.id).toBeTruthy();
    expect(entry.createdAt).toBeTruthy();
    expect(entry.text).toBe('hello');
    expect(entry.weight).toBe(0.9);
  });

  it('list returns all entries', () => {
    const dir = tmpDir('list');
    const store = createLessonsStore({ dir });
    store.add({ iteration: 1, text: 'first', tags: ['x'], weight: 0.5 });
    store.add({ iteration: 2, text: 'second', tags: ['y'], weight: 0.7 });
    const all = store.list();
    expect(all).toHaveLength(2);
  });

  it('topN sorts by weight descending', () => {
    const dir = tmpDir('topN');
    const store = createLessonsStore({ dir });
    store.add({ iteration: 1, text: 'low', tags: [], weight: 0.2 });
    store.add({ iteration: 2, text: 'high', tags: [], weight: 0.9 });
    store.add({ iteration: 3, text: 'mid', tags: [], weight: 0.5 });
    const top2 = store.topN(2);
    expect(top2[0]!.weight).toBe(0.9);
    expect(top2[1]!.weight).toBe(0.5);
  });

  it('filter by tag (intersect)', () => {
    const dir = tmpDir('tag');
    const store = createLessonsStore({ dir });
    store.add({ iteration: 1, text: 'tagged', tags: ['alpha', 'beta'], weight: 0.5 });
    store.add({ iteration: 2, text: 'other', tags: ['gamma'], weight: 0.5 });
    const result = store.list({ tags: ['alpha'] });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('tagged');
  });

  it('filter by sinceDays', () => {
    const dir = tmpDir('since');
    const store = createLessonsStore({ dir });
    // Add an old entry by manually writing a file
    fs.mkdirSync(dir, { recursive: true });
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const oldContent = `## ${oldDate} | weight=0.5 | tags: old | id=old123 | iteration=1\nold lesson\n`;
    fs.writeFileSync(path.join(dir, '2000-01-01.md'), oldContent, 'utf8');

    store.load();
    store.add({ iteration: 2, text: 'recent', tags: ['new'], weight: 0.5 });

    const recent = store.list({ sinceDays: 1 });
    const texts = recent.map((e) => e.text);
    expect(texts).toContain('recent');
    expect(texts).not.toContain('old lesson');
  });

  it('renderMarkdown contains entries', () => {
    const dir = tmpDir('render');
    const store = createLessonsStore({ dir });
    store.add({ iteration: 1, text: 'a lesson', tags: ['x'], weight: 0.8 });
    const md = store.renderMarkdown();
    expect(md).toContain('# Lessons');
    expect(md).toContain('a lesson');
  });

  it('multiple files (today + yesterday) merged on load', () => {
    const dir = tmpDir('multi');
    fs.mkdirSync(dir, { recursive: true });

    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const makeContent = (isoDate: string, text: string, id: string) =>
      `## ${isoDate} | weight=0.5 | tags: tag | id=${id} | iteration=1\n${text}\n`;

    const todayFile = `${fmt(today)}.md`;
    const yesterdayFile = `${fmt(yesterday)}.md`;

    fs.writeFileSync(path.join(dir, todayFile), makeContent(today.toISOString(), 'today entry', 'id1'), 'utf8');
    fs.writeFileSync(path.join(dir, yesterdayFile), makeContent(yesterday.toISOString(), 'yesterday entry', 'id2'), 'utf8');

    const store = createLessonsStore({ dir });
    store.load();
    const all = store.list();
    const texts = all.map((e) => e.text);
    expect(texts).toContain('today entry');
    expect(texts).toContain('yesterday entry');
  });

  it('clear removes files but not archive', () => {
    const dir = tmpDir('clear');
    const store = createLessonsStore({ dir });
    store.add({ iteration: 1, text: 'to be cleared', tags: [], weight: 0.5 });

    // Ensure archive subdir exists with a file
    const archiveDir = path.join(dir, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, 'old.md'), '# archived', 'utf8');

    store.clear();

    const mdFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(mdFiles).toHaveLength(0);

    // Archive should still be there
    expect(fs.existsSync(path.join(archiveDir, 'old.md'))).toBe(true);
  });

  it('flush writes file to disk', () => {
    const dir = tmpDir('flush');
    const store = createLessonsStore({ dir });
    store.add({ iteration: 1, text: 'flushed', tags: [], weight: 0.5 });
    store.flush();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    const content = fs.readFileSync(path.join(dir, files[0]!), 'utf8');
    expect(content).toContain('flushed');
  });

  it('load tolerates corrupt file', () => {
    const dir = tmpDir('corrupt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'corrupt.md'), 'NOT VALID MARKDOWN AT ALL %%%%', 'utf8');
    const store = createLessonsStore({ dir });
    // Should not throw
    expect(() => store.load()).not.toThrow();
    expect(store.list()).toHaveLength(0);
  });

  describe('extractLessons', () => {
    it('emits "what worked" lesson on pass', () => {
      const lessons = extractLessons({
        iteration: 1,
        agentOutput: 'did something',
        verifySummary: 'all checks passed',
        task: 'fix bug',
      });
      expect(lessons.some((l) => l.text.includes('What worked'))).toBe(true);
    });

    it('emits "what to avoid" lesson on failure', () => {
      const lessons = extractLessons({
        iteration: 2,
        agentOutput: 'tried something',
        verifySummary: 'tests failed badly',
        task: 'add feature',
      });
      expect(lessons.some((l) => l.text.includes('What to avoid'))).toBe(true);
    });

    it('tags are inferred from task keywords (3 longest)', () => {
      const lessons = extractLessons({
        iteration: 1,
        agentOutput: '',
        verifySummary: 'passed',
        task: 'implement authentication middleware layer',
      });
      expect(lessons.length).toBeGreaterThan(0);
      const tags = lessons[0]!.tags;
      expect(tags).toHaveLength(3);
      // The 3 longest words: 'authentication'(14), 'middleware'(10), 'implement'(9)
      expect(tags).toContain('authentication');
      expect(tags).toContain('middleware');
    });

    it('both passed and failed in summary → two lessons', () => {
      const lessons = extractLessons({
        iteration: 1,
        agentOutput: '',
        verifySummary: 'some checks passed some failed',
      });
      expect(lessons).toHaveLength(2);
    });
  });

  it('maxEntries archives oldest file', () => {
    const dir = tmpDir('maxent');
    fs.mkdirSync(dir, { recursive: true });

    // Create two files with many entries each
    const makeEntries = (count: number, prefix: string, dateIso: string) =>
      Array.from({ length: count }, (_, i) =>
        `## ${dateIso} | weight=0.5 | tags: t | id=${prefix}${i} | iteration=${i}\nlesson ${i}\n`
      ).join('\n');

    const old = new Date('2020-01-01T00:00:00Z');
    const newer = new Date('2020-01-02T00:00:00Z');

    fs.writeFileSync(path.join(dir, '2020-01-01.md'), makeEntries(300, 'old', old.toISOString()), 'utf8');
    fs.writeFileSync(path.join(dir, '2020-01-02.md'), makeEntries(250, 'new', newer.toISOString()), 'utf8');

    const store = createLessonsStore({ dir, maxEntries: 400 });
    store.load();

    // After load, oldest file should be archived
    const archiveDir = path.join(dir, 'archive');
    const archived = fs.existsSync(archiveDir) && fs.readdirSync(archiveDir).length > 0;
    expect(archived).toBe(true);
  });
});
