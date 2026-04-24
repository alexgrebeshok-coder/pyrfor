/**
 * memory-nudge.ts — Pyrfor Memory Nudge module (G+5).
 *
 * Captures skill-applied events as episodic memory and surfaces relevant
 * memories as a "nudge" to be injected into the system prompt before
 * handling a new task.
 */

import type { MemoryStore, MemoryEntry } from './memory-store.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SkillAppliedEvent {
  skillId: string;
  skillName: string;
  scope: string;                 // global|userId|chatId|project
  task: string;                  // user input
  outcome: 'success' | 'failure' | 'partial';
  toolsUsed?: string[];
  timestamp?: string;
}

export interface MemoryNudgeOptions {
  memory: MemoryStore;
  defaultScope?: string;         // fallback if event has none
  weightSuccess?: number;        // default 0.6
  weightFailure?: number;        // default 0.4
  weightPartial?: number;        // default 0.5
  expireDays?: number;           // default 90
  maxNudgesPerCall?: number;     // default 5
  minScore?: number;             // default 0 — filter relevance
  buildText?: (e: SkillAppliedEvent) => string;
  scoringFn?: (m: MemoryEntry, query: string) => number;
  clock?: () => number;
}

export interface NudgeRequest {
  query: string;                 // user task / message
  scope?: string;
  limit?: number;
  tags?: string[];
}

export interface NudgeResult {
  entries: MemoryEntry[];
  promptInjection: string;       // formatted markdown ready to splice into system prompt
  scores: Array<{ id: string; score: number }>;
}

export interface MemoryNudge {
  recordSkillApplied(event: SkillAppliedEvent): MemoryEntry;
  nudge(req: NudgeRequest): NudgeResult;
  ingestLesson(
    text: string,
    opts?: { scope?: string; tags?: string[]; weight?: number; expireDays?: number },
  ): MemoryEntry;
  forget(id: string): boolean;
  prune(): number;
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

export function defaultBuildText(e: SkillAppliedEvent): string {
  const tools = e.toolsUsed && e.toolsUsed.length > 0
    ? e.toolsUsed.join(', ')
    : '';
  return `Skill '${e.skillName}' was ${e.outcome} for task: ${e.task}. Tools: [${tools}]`;
}

/**
 * Default scoring heuristic:
 *   score = weight * 0.5 + recencyBoost * 0.3 + textOverlap * 0.2
 *
 * recencyBoost = max(0, 1 - daysOld / 90)   — fades to 0 after 90 days
 * textOverlap  = sharedTokens / queryTokens  — token-level Jaccard-lite
 */
export function defaultScoring(m: MemoryEntry, query: string): number {
  const weightComponent = m.weight * 0.5;

  const updatedMs = new Date(m.updated_at).getTime();
  const nowMs = Date.now();
  const daysOld = (nowMs - updatedMs) / 86_400_000;
  const recencyBoost = Math.max(0, 1 - daysOld / 90) * 0.3;

  let textOverlap = 0;
  if (query.trim().length > 0) {
    const queryTokens = tokenize(query);
    if (queryTokens.size > 0) {
      const entryTokens = tokenize(m.text);
      let shared = 0;
      for (const t of queryTokens) {
        if (entryTokens.has(t)) shared++;
      }
      textOverlap = (shared / queryTokens.size) * 0.2;
    }
  }

  return weightComponent + recencyBoost + textOverlap;
}

export function formatPromptInjection(entries: MemoryEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map(
    (e) => `- (${e.kind}, weight=${e.weight.toFixed(2)}) ${e.text}`,
  );
  return `## Relevant memory\n${lines.join('\n')}`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

const EMPTY_RESULT: NudgeResult = { entries: [], promptInjection: '', scores: [] };

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createMemoryNudge(opts: MemoryNudgeOptions): MemoryNudge {
  const {
    memory,
    defaultScope = 'global',
    weightSuccess = 0.6,
    weightFailure = 0.4,
    weightPartial = 0.5,
    expireDays = 90,
    maxNudgesPerCall = 5,
    minScore = 0,
    clock = () => Date.now(),
  } = opts;

  const buildText = opts.buildText ?? defaultBuildText;
  const scoringFn = opts.scoringFn ?? defaultScoring;

  function expiresAt(days: number): string {
    return new Date(clock() + days * 86_400_000).toISOString();
  }

  // ── recordSkillApplied ────────────────────────────────────────────────

  function recordSkillApplied(event: SkillAppliedEvent): MemoryEntry {
    const text = buildText(event);

    const rawTags = [event.skillName, event.outcome, ...(event.toolsUsed ?? [])];
    const tags = [...new Set(rawTags)].slice(0, 10);

    const weightMap: Record<string, number> = {
      success: weightSuccess,
      failure: weightFailure,
      partial: weightPartial,
    };
    const weight = weightMap[event.outcome] ?? weightPartial;

    const scope = event.scope || defaultScope;

    return memory.add({
      kind: 'episode',
      text,
      source: 'agent',
      scope,
      tags,
      weight,
      expires_at: expiresAt(expireDays),
    });
  }

  // ── ingestLesson ──────────────────────────────────────────────────────

  function ingestLesson(
    text: string,
    lessonOpts?: { scope?: string; tags?: string[]; weight?: number; expireDays?: number },
  ): MemoryEntry {
    const scope = lessonOpts?.scope ?? defaultScope;
    const tags = lessonOpts?.tags ?? [];
    const weight = lessonOpts?.weight ?? 0.7;
    const days = lessonOpts?.expireDays ?? expireDays;

    return memory.add({
      kind: 'lesson',
      text,
      source: 'agent',
      scope,
      tags,
      weight,
      expires_at: expiresAt(days),
    });
  }

  // ── nudge ─────────────────────────────────────────────────────────────

  function nudge(req: NudgeRequest): NudgeResult {
    if (!req.query || req.query.trim().length === 0) return EMPTY_RESULT;

    const effectiveMax = req.limit ?? maxNudgesPerCall;
    if (effectiveMax <= 0) return EMPTY_RESULT;

    let candidates: MemoryEntry[];
    try {
      candidates = memory.search(req.query, {
        ...(req.scope !== undefined ? { scope: req.scope } : {}),
        limit: effectiveMax * 3,
      });
    } catch {
      return EMPTY_RESULT;
    }

    // Tag intersection filter: entry must share at least one tag with the request.
    if (req.tags && req.tags.length > 0) {
      const reqTagSet = new Set(req.tags);
      candidates = candidates.filter(
        (m) => m.tags.length > 0 && m.tags.some((t) => reqTagSet.has(t)),
      );
    }

    // Score, filter by minScore, sort desc, cap.
    const scored = candidates.map((m) => ({ entry: m, score: scoringFn(m, req.query) }));
    const filtered = scored
      .filter(({ score }) => score > minScore || (minScore === 0 && score >= 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, effectiveMax);

    const entries = filtered.map(({ entry }) => entry);
    const scores = filtered.map(({ entry, score }) => ({ id: entry.id, score }));
    const promptInjection = formatPromptInjection(entries);

    return { entries, promptInjection, scores };
  }

  // ── forget ────────────────────────────────────────────────────────────

  function forget(id: string): boolean {
    return memory.delete(id);
  }

  // ── prune ─────────────────────────────────────────────────────────────

  function prune(): number {
    return memory.prune({ olderThanDays: expireDays * 2 });
  }

  return { recordSkillApplied, nudge, ingestLesson, forget, prune };
}
