// @ts-nocheck-noop — pure TypeScript, no external deps
/**
 * self-improve-loop.ts — Hermes-style self-improvement loop for Pyrfor.
 *
 * Each completed task produces a TaskOutcome (verdict + reflection). Failures
 * are clustered by signature. When a cluster ≥ clusterThreshold, an LLM-
 * generated (or deterministic stub) Lesson is created. Lessons are injected
 * into prompts via findApplicableLessons() on future runs.
 *
 * Persistence: single JSON file, atomic tmp+rename, debounced flush.
 */

import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export type TaskOutcome = {
  taskId: string;
  verdict: 'success' | 'failure' | 'partial';
  /** Coarse error class / command / stage string, e.g. "tool:bash:ENOENT" */
  signature: string;
  details: string;
  ts: number;
  tags?: string[];
};

export type Lesson = {
  id: string;
  trigger: {
    signature?: string;
    tags?: string[];
    keyword?: string;
  };
  text: string;
  createdAt: number;
  appliedCount: number;
  successAfter: number;
  failureAfter: number;
  sourceOutcomeIds: string[];
};

// ── Internal store shape ──────────────────────────────────────────────────────

interface StoreData {
  outcomes: TaskOutcome[];
  lessons: Lesson[];
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface SelfImproveLoopOptions {
  storePath: string;
  /** Minimum cluster size before generating a lesson (default: 3). */
  clusterThreshold?: number;
  /** Custom LLM lesson generator. Falls back to deterministic stub. */
  lessonGenerator?: (
    cluster: TaskOutcome[],
  ) => Promise<{ text: string; trigger: Lesson['trigger'] }>;
  /** Injectable clock for deterministic testing (default: Date.now). */
  clock?: () => number;
  /** Debounce delay for auto-flush (default: 300 ms). */
  flushDebounceMs?: number;
  logger?: (msg: string, meta?: unknown) => void;
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface SelfImproveLoop {
  recordOutcome(o: TaskOutcome): void;
  listOutcomes(filter?: {
    verdict?: TaskOutcome['verdict'];
    signature?: string;
    sinceTs?: number;
  }): TaskOutcome[];
  listLessons(): Lesson[];
  getLesson(id: string): Lesson | undefined;
  findApplicableLessons(ctx: {
    signature?: string;
    tags?: string[];
    text?: string;
  }): Lesson[];
  markLessonApplied(id: string, outcomeAfter: 'success' | 'failure' | 'partial'): void;
  generateLessonsNow(): Promise<{ created: Lesson[]; skipped: number }>;
  flush(): Promise<void>;
  reset(): void;
  effectiveness(lessonId: string): { applied: number; successRate: number };
}

// ── ID helper ─────────────────────────────────────────────────────────────────

function makeId(): string {
  return Date.now().toString(36) + randomBytes(10).toString('hex');
}

// ── Deterministic fallback lesson generator ───────────────────────────────────

function defaultLessonGenerator(
  cluster: TaskOutcome[],
): Promise<{ text: string; trigger: Lesson['trigger'] }> {
  const sig = cluster[0]!.signature;
  const last = cluster[cluster.length - 1]!;
  return Promise.resolve({
    text: `Avoid pattern: ${sig}. Last details: ${last.details}`,
    trigger: { signature: sig },
  });
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSelfImproveLoop(opts: SelfImproveLoopOptions): SelfImproveLoop {
  const {
    storePath,
    clusterThreshold = 3,
    lessonGenerator = defaultLessonGenerator,
    clock = Date.now,
    flushDebounceMs = 300,
    logger: log = () => {},
  } = opts;

  // ── In-memory state ─────────────────────────────────────────────────────────
  let outcomes: TaskOutcome[] = [];
  let lessons: Lesson[] = [];

  // ── Debounce / in-flight flush ───────────────────────────────────────────────
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;

  function scheduleFlush(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      flush().catch((err) => log('self-improve-loop: background flush error', err));
    }, flushDebounceMs);
  }

  // ── Atomic write ─────────────────────────────────────────────────────────────
  async function atomicWrite(data: StoreData): Promise<void> {
    const tmp = `${storePath}.${process.pid}.tmp`;
    const dir = path.dirname(storePath);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    try {
      await fsp.rename(tmp, storePath);
    } catch (err) {
      await fsp.unlink(tmp).catch(() => {});
      throw err;
    }
  }

  // ── Load on construction (synchronous-ish via top-level await pattern) ────────
  // We use a sync load; file is read inline during factory call.
  try {
    const raw = require('node:fs').readFileSync(storePath, 'utf8');
    const parsed: StoreData = JSON.parse(raw);
    if (Array.isArray(parsed.outcomes)) outcomes = parsed.outcomes;
    if (Array.isArray(parsed.lessons)) lessons = parsed.lessons;
    log('self-improve-loop: loaded store', { outcomes: outcomes.length, lessons: lessons.length });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') {
      // Corrupt or unexpected error — warn and start empty
      log('self-improve-loop: could not load store, starting empty', { error: String(err) });
    }
  }

  // ── Public methods ────────────────────────────────────────────────────────────

  function recordOutcome(o: TaskOutcome): void {
    outcomes.push(o);
    scheduleFlush();
  }

  function listOutcomes(filter?: {
    verdict?: TaskOutcome['verdict'];
    signature?: string;
    sinceTs?: number;
  }): TaskOutcome[] {
    let result = outcomes;
    if (filter?.verdict !== undefined) {
      result = result.filter((o) => o.verdict === filter.verdict);
    }
    if (filter?.signature !== undefined) {
      result = result.filter((o) => o.signature === filter.signature);
    }
    if (filter?.sinceTs !== undefined) {
      result = result.filter((o) => o.ts >= filter.sinceTs!);
    }
    return result;
  }

  function listLessons(): Lesson[] {
    return lessons.slice();
  }

  function getLesson(id: string): Lesson | undefined {
    return lessons.find((l) => l.id === id);
  }

  function findApplicableLessons(ctx: {
    signature?: string;
    tags?: string[];
    text?: string;
  }): Lesson[] {
    return lessons.filter((lesson) => {
      const { trigger } = lesson;
      if (trigger.signature && ctx.signature && trigger.signature === ctx.signature) return true;
      if (trigger.tags && ctx.tags) {
        if (trigger.tags.some((t) => ctx.tags!.includes(t))) return true;
      }
      if (trigger.keyword && ctx.text) {
        if (ctx.text.toLowerCase().includes(trigger.keyword.toLowerCase())) return true;
      }
      return false;
    });
  }

  function markLessonApplied(id: string, outcomeAfter: 'success' | 'failure' | 'partial'): void {
    const lesson = lessons.find((l) => l.id === id);
    if (!lesson) return;
    lesson.appliedCount += 1;
    if (outcomeAfter === 'success') lesson.successAfter += 1;
    else if (outcomeAfter === 'failure') lesson.failureAfter += 1;
    // 'partial' increments neither success nor failure counters
    scheduleFlush();
  }

  async function generateLessonsNow(): Promise<{ created: Lesson[]; skipped: number }> {
    // Cluster failures by signature
    const failureOutcomes = outcomes.filter((o) => o.verdict === 'failure');
    const clusters = new Map<string, TaskOutcome[]>();
    for (const o of failureOutcomes) {
      const list = clusters.get(o.signature) ?? [];
      list.push(o);
      clusters.set(o.signature, list);
    }

    // Signatures already covered by an existing lesson
    const coveredSignatures = new Set(
      lessons.map((l) => l.trigger.signature).filter(Boolean) as string[],
    );

    const created: Lesson[] = [];
    let skipped = 0;

    for (const [sig, cluster] of clusters) {
      if (cluster.length < clusterThreshold) {
        skipped++;
        continue;
      }
      if (coveredSignatures.has(sig)) {
        skipped++;
        continue;
      }

      const { text, trigger } = await lessonGenerator(cluster);
      const lesson: Lesson = {
        id: makeId(),
        trigger,
        text,
        createdAt: clock(),
        appliedCount: 0,
        successAfter: 0,
        failureAfter: 0,
        sourceOutcomeIds: cluster.map((o) => o.taskId),
      };
      lessons.push(lesson);
      coveredSignatures.add(sig);
      created.push(lesson);
      log('self-improve-loop: lesson created', { id: lesson.id, signature: sig });
    }

    if (created.length > 0) {
      await flush();
    }

    return { created, skipped };
  }

  function flush(): Promise<void> {
    // Coalesce concurrent flush calls into a single in-flight promise
    if (flushPromise) return flushPromise;
    // Cancel any pending debounce since we're flushing now
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    flushPromise = atomicWrite({ outcomes, lessons }).then(
      () => {
        flushPromise = null;
      },
      (err) => {
        flushPromise = null;
        throw err;
      },
    );
    return flushPromise;
  }

  function reset(): void {
    outcomes = [];
    lessons = [];
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function effectiveness(lessonId: string): { applied: number; successRate: number } {
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) return { applied: 0, successRate: 0 };
    const total = lesson.successAfter + lesson.failureAfter;
    const successRate = total === 0 ? 0 : lesson.successAfter / total;
    return { applied: lesson.appliedCount, successRate };
  }

  return {
    recordOutcome,
    listOutcomes,
    listLessons,
    getLesson,
    findApplicableLessons,
    markLessonApplied,
    generateLessonsNow,
    flush,
    reset,
    effectiveness,
  };
}
