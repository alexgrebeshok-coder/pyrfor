// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { WeightedRecencyLessonSelector, formatLessonsAsPromptFragment } from './lessons-prompt.js';
import type { Lesson } from './lessons-prompt.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLesson(overrides: Partial<Lesson> & { id: string }): Lesson {
  return {
    sessionId: 'sess-1',
    category: 'general',
    insight: 'A lesson.',
    context: 'test context',
    weight: 0.5,
    createdAt: new Date().toISOString(),
    appliedCount: 0,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('WeightedRecencyLessonSelector', () => {
  it('returns at most maxCount lessons', async () => {
    const selector = new WeightedRecencyLessonSelector();
    const lessons = Array.from({ length: 10 }, (_, i) =>
      makeLesson({ id: `l${i}`, weight: 0.8, appliedCount: 2 }),
    );

    const result = await selector.selectRelevant('task', lessons, 3);

    expect(result).toHaveLength(3);
  });

  it('returns all lessons when pool smaller than maxCount', async () => {
    const selector = new WeightedRecencyLessonSelector();
    const lessons = [makeLesson({ id: 'a' }), makeLesson({ id: 'b' })];

    const result = await selector.selectRelevant('task', lessons, 10);

    expect(result).toHaveLength(2);
  });

  it('ranks higher-weight recent lessons above older lower-weight ones', async () => {
    const selector = new WeightedRecencyLessonSelector({ halflifeDays: 14 });

    const recentHigh = makeLesson({
      id: 'recent-high',
      weight: 0.95,
      appliedCount: 3,
      createdAt: new Date().toISOString(), // now
    });

    const oldLow = makeLesson({
      id: 'old-low',
      weight: 0.2,
      appliedCount: 0,
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days ago
    });

    const result = await selector.selectRelevant('task', [oldLow, recentHigh], 2);

    expect(result[0].id).toBe('recent-high');
    expect(result[1].id).toBe('old-low');
  });

  it('higher appliedCount boosts rank among otherwise-equal lessons', async () => {
    const selector = new WeightedRecencyLessonSelector({ halflifeDays: 14 });
    const now = new Date().toISOString();

    const high = makeLesson({ id: 'high-applied', weight: 0.7, appliedCount: 10, createdAt: now });
    const low = makeLesson({ id: 'low-applied', weight: 0.7, appliedCount: 0, createdAt: now });

    const result = await selector.selectRelevant('task', [low, high], 2);

    expect(result[0].id).toBe('high-applied');
  });

  it('returns empty array when no lessons provided', async () => {
    const selector = new WeightedRecencyLessonSelector();
    const result = await selector.selectRelevant('task', [], 5);
    expect(result).toHaveLength(0);
  });
});

describe('formatLessonsAsPromptFragment', () => {
  it('returns empty string for empty lessons array', () => {
    expect(formatLessonsAsPromptFragment([])).toBe('');
  });

  it('renders numbered list with category tags', () => {
    const lessons: Lesson[] = [
      makeLesson({ id: '1', category: 'success-pattern', insight: 'Do X.', context: 'task A' }),
      makeLesson({ id: '2', category: 'failure-mode', insight: 'Avoid Y.', context: 'task B' }),
    ];

    const result = formatLessonsAsPromptFragment(lessons);

    expect(result).toContain('## 📚 Уроки прошлых сессий');
    expect(result).toContain('1. [success-pattern] Do X. (контекст: task A)');
    expect(result).toContain('2. [failure-mode] Avoid Y. (контекст: task B)');
  });

  it('renders lesson without context gracefully', () => {
    const lessons: Lesson[] = [
      makeLesson({ id: '1', category: 'general', insight: 'No context lesson.', context: '' }),
    ];

    const result = formatLessonsAsPromptFragment(lessons);

    expect(result).toContain('[general] No context lesson.');
    expect(result).not.toContain('(контекст: )');
  });

  it('renders exactly one lesson without extra newlines or entries', () => {
    const lessons: Lesson[] = [
      makeLesson({ id: 'solo', category: 'tool-tip', insight: 'Single lesson.', context: 'ctx' }),
    ];

    const result = formatLessonsAsPromptFragment(lessons);
    const lines = result.split('\n').filter(Boolean);

    // header line + blank line produces 2 non-blank lines for 1 lesson
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('## 📚 Уроки прошлых сессий');
    expect(lines[1]).toBe('1. [tool-tip] Single lesson. (контекст: ctx)');
  });
});
