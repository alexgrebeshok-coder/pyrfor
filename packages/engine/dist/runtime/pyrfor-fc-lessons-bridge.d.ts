/**
 * pyrfor-fc-lessons-bridge.ts — Bridges Pyrfor's MemoryStore lessons into FC
 * via appendSystemPrompt in FCRunOptions.
 */
import type { MemoryStore } from './memory-store';
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
export declare function buildLessons(input: BuildLessonsInput, opts: LessonsBridgeOptions): BuildLessonsResult;
/**
 * Convenience: build lessons + return an FCRunOptions partial with appendSystemPrompt set.
 * Does NOT mutate caller's options.
 */
export declare function lessonsAsFcOptions(input: BuildLessonsInput, opts: LessonsBridgeOptions, base?: {
    appendSystemPrompt?: string;
}): {
    appendSystemPrompt: string;
};
/**
 * After a successful FC run, record that these lessons were applied (useful weight tracking).
 */
export declare function markLessonsApplied(usedIds: string[], store: MemoryStore): void;
//# sourceMappingURL=pyrfor-fc-lessons-bridge.d.ts.map