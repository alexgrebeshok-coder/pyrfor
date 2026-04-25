/**
 * pyrfor-fc-lessons-bridge.ts — Bridges Pyrfor's MemoryStore lessons into FC
 * via appendSystemPrompt in FCRunOptions.
 */
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
export function buildLessons(input, opts) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const scopes = (_b = (_a = input.scopes) !== null && _a !== void 0 ? _a : opts.scopes) !== null && _b !== void 0 ? _b : ['lessons', 'project'];
    const topK = (_d = (_c = input.topK) !== null && _c !== void 0 ? _c : opts.topK) !== null && _d !== void 0 ? _d : 8;
    const maxChars = (_f = (_e = input.maxChars) !== null && _e !== void 0 ? _e : opts.maxChars) !== null && _f !== void 0 ? _f : 4000;
    const titlePrefix = (_g = opts.titlePrefix) !== null && _g !== void 0 ? _g : '## Pyrfor Lessons';
    const pinned = (_h = input.pinned) !== null && _h !== void 0 ? _h : [];
    // Collect entries from each scope, dedupe by id
    const seen = new Set();
    const entries = [];
    for (const scope of scopes) {
        const results = opts.store.search(input.task, { scope, limit: topK * 2 });
        for (const entry of results) {
            if (seen.has(entry.id))
                continue;
            // Apply tag filter if provided
            if (input.tags && input.tags.length > 0) {
                const entryTags = (_j = entry.tags) !== null && _j !== void 0 ? _j : [];
                const hasTag = input.tags.some(t => entryTags.includes(t));
                if (!hasTag)
                    continue;
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
    const lines = [titlePrefix, ''];
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
export function lessonsAsFcOptions(input, opts, base) {
    var _a;
    const result = buildLessons(input, opts);
    const existing = (_a = base === null || base === void 0 ? void 0 : base.appendSystemPrompt) !== null && _a !== void 0 ? _a : '';
    const combined = existing
        ? `${existing}\n\n${result.text}`
        : result.text;
    return { appendSystemPrompt: combined };
}
/**
 * After a successful FC run, record that these lessons were applied (useful weight tracking).
 */
export function markLessonsApplied(usedIds, store) {
    for (const id of usedIds) {
        store.recordApplied(id);
    }
}
