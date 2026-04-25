/**
 * lessons-prompt — Select and format stored lessons for system prompt injection.
 */

import type { Lesson } from './reflection.js';

export type { Lesson };

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface LessonSelector {
  selectRelevant(currentTask: string, allLessons: Lesson[], maxCount: number): Promise<Lesson[]>;
}

// ── WeightedRecencyLessonSelector ──────────────────────────────────────────

export interface WeightedRecencyOptions {
  halflifeDays?: number;
}

/**
 * Scores lessons by:  weight × exp(-ageInDays / halflife) × log(1 + appliedCount)
 * No embedding required.
 */
export class WeightedRecencyLessonSelector implements LessonSelector {
  private readonly halflifeDays: number;

  constructor(opts?: WeightedRecencyOptions) {
    this.halflifeDays = opts?.halflifeDays ?? 14;
  }

  async selectRelevant(
    _currentTask: string,
    allLessons: Lesson[],
    maxCount: number,
  ): Promise<Lesson[]> {
    const now = Date.now();
    const halflifeMs = this.halflifeDays * 24 * 60 * 60 * 1000;

    const scored = allLessons.map((lesson) => {
      const ageMs = now - new Date(lesson.createdAt).getTime();
      const ageInHalflives = ageMs / halflifeMs;
      const score =
        lesson.weight *
        Math.exp(-ageInHalflives) *
        Math.log(1 + lesson.appliedCount);
      return { lesson, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxCount).map((s) => s.lesson);
  }
}

// ── formatLessonsAsPromptFragment ──────────────────────────────────────────

/**
 * Format selected lessons as a system-prompt fragment.
 * Returns empty string when lessons array is empty.
 */
export function formatLessonsAsPromptFragment(lessons: Lesson[]): string {
  if (lessons.length === 0) return '';

  const lines = lessons.map(
    (l, i) =>
      `${i + 1}. [${l.category}] ${l.insight}${l.context ? ` (контекст: ${l.context})` : ''}`,
  );

  return `## 📚 Уроки прошлых сессий\n\n${lines.join('\n')}`;
}
