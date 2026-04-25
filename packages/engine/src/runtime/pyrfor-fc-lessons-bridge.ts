/**
 * pyrfor-fc-lessons-bridge.ts — Bridges Pyrfor's MemoryStore lessons into FC
 * via appendSystemPrompt in FCRunOptions.
 */

import type { MemoryStore, MemoryEntry } from './memory-store';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LessonsBridgeOptions {
  store: MemoryStore;
  /** Memory scopes to draw lessons from. Default: ['lessons','project']. */
  scopes?: string[];
  /** Max lessons to include. Default 8. */
  topK?: number;
  /** Max total chars in the resulting prompt. Default 4000. */
  maxChars?: number;
  /** Title prefix in output. Default '## Pyrfor Lessons'. */
  titlePrefix?: string;
}

export interface BuildLessonsInput {
  /** Free-text task description; used to query memory. */
  task: string;
  /** Optional tags to filter by. */
  tags?: string[];
  /** Optional explicit lessons to prepend (already curated). */
  pinned?: string[];
  /** Override scopes/topK/maxChars per call. */
  scopes?: string[];
  topK?: number;
  maxChars?: number;
}

export interface BuildLessonsResult {
  /** Markdown-formatted lessons block to pass to FC --append-system-prompt. */
  text: string;
  /** IDs of memory entries used (for recordApplied later). */
  usedIds: string[];
  /** Were any lessons truncated by maxChars? */
  truncated: boolean;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Build a lessons block from MemoryStore, ranked by FTS5 relevance to `task`.
 * - Query store.search(task) for each scope, dedupe by id, take topK.
 * - Always include pinned lines verbatim at top.
 * - Format: `### <kind>: <text>` per item.
 * - Truncate to maxChars; mark truncated=true if any dropped.
 * - Returns { text, usedIds, truncated }.
 *
 * Empty store / no hits → returns { text: '', usedIds: [], truncated: false }.
 */
export function buildLessons(
  input: BuildLessonsInput,
  opts: LessonsBridgeOptions,
): BuildLessonsResult {
  const scopes = input.scopes ?? opts.scopes ?? ['lessons', 'project'];
  const topK = input.topK ?? opts.topK ?? 8;
  const maxChars = input.maxChars ?? opts.maxChars ?? 4000;
  const titlePrefix = opts.titlePrefix ?? '## Pyrfor Lessons';
  const pinned = input.pinned ?? [];

  // Collect entries from each scope, dedupe by id
  const seen = new Set<string>();
  const entries: MemoryEntry[] = [];

  for (const scope of scopes) {
    const results = opts.store.search(input.task, { scope, limit: topK * 2 });
    for (const entry of results) {
      if (seen.has(entry.id)) continue;
      // Apply tag filter if provided
      if (input.tags && input.tags.length > 0) {
        const entryTags = entry.tags ?? [];
        const hasTag = input.tags.some(t => entryTags.includes(t));
        if (!hasTag) continue;
      }
      seen.add(entry.id);
      entries.push(entry);
    }
  }

  // Take topK
  const taken = entries.slice(0, topK);
  const remaining = entries.slice(topK);
  const truncated = remaining.length > 0;

  if (pinned.length === 0 && taken.length === 0) {
    return { text: '', usedIds: [], truncated: false };
  }

  // Build lines
  const lines: string[] = [titlePrefix, ''];

  for (const p of pinned) {
    lines.push(p);
  }

  for (const entry of taken) {
    lines.push(`### ${entry.kind}: ${entry.text}`);
  }

  let text = lines.join('\n');

  // Truncate to maxChars
  let actualTruncated = truncated;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    actualTruncated = true;
  }

  return {
    text,
    usedIds: taken.map(e => e.id),
    truncated: actualTruncated,
  };
}

/**
 * Convenience: build lessons + return an FCRunOptions partial with appendSystemPrompt set.
 * Does NOT mutate caller's options.
 */
export function lessonsAsFcOptions(
  input: BuildLessonsInput,
  opts: LessonsBridgeOptions,
  base?: { appendSystemPrompt?: string },
): { appendSystemPrompt: string } {
  const result = buildLessons(input, opts);
  const existing = base?.appendSystemPrompt ?? '';
  const combined = existing
    ? `${existing}\n\n${result.text}`
    : result.text;
  return { appendSystemPrompt: combined };
}

/**
 * After a successful FC run, record that these lessons were applied (useful weight tracking).
 */
export function markLessonsApplied(usedIds: string[], store: MemoryStore): void {
  for (const id of usedIds) {
    store.recordApplied(id);
  }
}
