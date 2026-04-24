import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'fs';
import path from 'path';

// ── Inline ULID ────────────────────────────────────────────────────────────

const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(): string {
  let t = Date.now();
  const ts: string[] = new Array(10);
  for (let i = 9; i >= 0; i--) {
    ts[i] = ULID_CHARS[t & 31]!;
    t = Math.floor(t / 32);
  }
  const rand: string[] = new Array(16);
  for (let i = 0; i < 16; i++) {
    rand[i] = ULID_CHARS[Math.floor(Math.random() * 32)]!;
  }
  return ts.join('') + rand.join('');
}

// ── Types ──────────────────────────────────────────────────────────────────

export type QuestPhase =
  | 'research'
  | 'requirements'
  | 'design'
  | 'tasks'
  | 'execute'
  | 'verify'
  | 'report'
  | 'done'
  | 'failed';

export interface QuestSpec {
  id?: string;
  title: string;
  goal: string;
  context?: string;
  acceptance?: string[];
  constraints?: string[];
  files?: string[];
  budgetUsd?: number;
}

export interface QuestTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
  dependencies: string[];
  result?: { summary: string; ok: boolean; ts: string };
  attempts: number;
}

export interface QuestPlan {
  spec: Required<Omit<QuestSpec, 'context' | 'acceptance' | 'constraints' | 'files' | 'budgetUsd'>> &
    QuestSpec;
  research: string;
  requirements: string[];
  design: string;
  tasks: QuestTask[];
  phase: QuestPhase;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  metrics: { tasksTotal: number; tasksDone: number; tasksFailed: number; costUsd: number };
}

export interface QuestExecutor {
  research?(spec: QuestSpec): Promise<string>;
  requirements?(spec: QuestSpec, research: string): Promise<string[]>;
  design?(spec: QuestSpec, requirements: string[]): Promise<string>;
  tasks?(
    spec: QuestSpec,
    design: string,
  ): Promise<Array<Pick<QuestTask, 'title' | 'description' | 'dependencies'>>>;
  executeTask?(
    task: QuestTask,
    plan: QuestPlan,
  ): Promise<{ ok: boolean; summary: string; costUsd?: number }>;
  verify?(plan: QuestPlan): Promise<{ ok: boolean; report: string }>;
  report?(plan: QuestPlan, verifyReport: string): Promise<string>;
}

export interface QuestRunOptions {
  spec: QuestSpec;
  executor?: QuestExecutor;
  llmFn?: (prompt: string) => Promise<string>;
  storeDir?: string;
  abortSignal?: AbortSignal;
  onProgress?: (plan: QuestPlan) => void;
  maxAttemptsPerTask?: number;
}

export interface QuestResult {
  status: 'completed' | 'failed' | 'aborted';
  plan: QuestPlan;
  reportPath?: string;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Kahn's topological sort. Returns sorted task list, or null if a cycle exists.
 */
function topoSort(tasks: QuestTask[]): QuestTask[] | null {
  const idToTask = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const t of tasks) {
    if (!inDegree.has(t.id)) inDegree.set(t.id, 0);
    if (!adj.has(t.id)) adj.set(t.id, []);
    for (const dep of t.dependencies) {
      if (!adj.has(dep)) adj.set(dep, []);
      adj.get(dep)!.push(t.id);
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
    }
  }

  const queue: QuestTask[] = tasks.filter((t) => (inDegree.get(t.id) ?? 0) === 0);
  const result: QuestTask[] = [];

  while (queue.length > 0) {
    const t = queue.shift()!;
    result.push(t);
    for (const neighborId of adj.get(t.id) ?? []) {
      const deg = (inDegree.get(neighborId) ?? 0) - 1;
      inDegree.set(neighborId, deg);
      if (deg === 0) {
        const neighbor = idToTask.get(neighborId);
        if (neighbor) queue.push(neighbor);
      }
    }
  }

  return result.length === tasks.length ? result : null;
}

/**
 * Parses lines starting with "- " into task stubs.
 * Title = text after "- " on that line.
 * Description = subsequent non-bullet lines until next "- ".
 * Dependencies always [].
 */
function parseTaskLines(
  text: string,
): Array<Pick<QuestTask, 'title' | 'description' | 'dependencies'>> {
  const result: Array<Pick<QuestTask, 'title' | 'description' | 'dependencies'>> = [];
  let current: { title: string; descLines: string[] } | null = null;

  for (const raw of text.split('\n')) {
    const trimmed = raw.trimStart();
    if (trimmed.startsWith('- ')) {
      if (current !== null) {
        result.push({
          title: current.title.trim(),
          description: current.descLines.join('\n').trim(),
          dependencies: [],
        });
      }
      current = { title: trimmed.slice(2), descLines: [] };
    } else if (current !== null && raw.trim()) {
      current.descLines.push(raw.trim());
    }
  }

  if (current !== null) {
    result.push({
      title: current.title.trim(),
      description: current.descLines.join('\n').trim(),
      dependencies: [],
    });
  }

  return result;
}

// ── Default executor ───────────────────────────────────────────────────────

export function defaultExecutor(
  llmFn?: (p: string) => Promise<string>,
): Required<QuestExecutor> {
  return {
    async research(spec: QuestSpec): Promise<string> {
      if (!llmFn) return '(no research executed)';
      const constraints = spec.constraints?.join(', ') ?? 'none';
      return llmFn(
        `Summarise the codebase context relevant to: ${spec.goal}. Constraints: ${constraints}.`,
      );
    },

    async requirements(spec: QuestSpec, research: string): Promise<string[]> {
      if (!llmFn) return [spec.goal];
      const text = await llmFn(
        `Given this research:\n${research}\n\nList requirements as bullet points (- item) for: ${spec.goal}`,
      );
      return text
        .split('\n')
        .filter((l) => l.trimStart().startsWith('- '))
        .map((l) => l.trimStart().slice(2).trim())
        .filter(Boolean);
    },

    async design(spec: QuestSpec, requirements: string[]): Promise<string> {
      if (!llmFn) return '(default minimal design)';
      return llmFn(
        `Design a solution for: ${spec.goal}\nRequirements:\n${requirements.join('\n')}`,
      );
    },

    async tasks(
      spec: QuestSpec,
      design: string,
    ): Promise<Array<Pick<QuestTask, 'title' | 'description' | 'dependencies'>>> {
      if (!llmFn) {
        return [{ title: `Implement: ${spec.goal}`, description: '', dependencies: [] }];
      }
      const text = await llmFn(
        `Break down into tasks (each starting with "- "):\nGoal: ${spec.goal}\nDesign:\n${design}`,
      );
      return parseTaskLines(text);
    },

    async executeTask(
      task: QuestTask,
      _plan: QuestPlan,
    ): Promise<{ ok: boolean; summary: string; costUsd?: number }> {
      if (!llmFn) return { ok: true, summary: '(stub executed)' };
      const output = await llmFn(
        `Execute task: ${task.title}\nDescription: ${task.description}`,
      );
      return { ok: true, summary: output };
    },

    async verify(_plan: QuestPlan): Promise<{ ok: boolean; report: string }> {
      return { ok: true, report: 'No verifier configured' };
    },

    async report(plan: QuestPlan, verifyReport: string): Promise<string> {
      const taskLines = plan.tasks.map(
        (t) => `- [${t.status}] **${t.title}**: ${t.result?.summary ?? '(no result)'}`,
      );
      return [
        `# Quest Report: ${plan.spec.title}`,
        '',
        `**Goal:** ${plan.spec.goal}`,
        `**Phase:** ${plan.phase}`,
        `**Started:** ${plan.startedAt}`,
        '',
        '## Tasks',
        ...taskLines,
        '',
        '## Verification',
        verifyReport,
        '',
        '## Metrics',
        `- Total: ${plan.metrics.tasksTotal}`,
        `- Done: ${plan.metrics.tasksDone}`,
        `- Failed: ${plan.metrics.tasksFailed}`,
        `- Cost: $${plan.metrics.costUsd.toFixed(4)}`,
      ].join('\n');
    },
  };
}

// ── Persistence ────────────────────────────────────────────────────────────

/** Atomically write plan to storeDir/{plan.spec.id}/plan.json. Returns file path. */
export function saveQuestPlan(dir: string, plan: QuestPlan): string {
  const questDir = path.join(dir, plan.spec.id);
  mkdirSync(questDir, { recursive: true });
  const filePath = path.join(questDir, 'plan.json');
  const tmpPath = filePath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(plan, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
  return filePath;
}

/** Load plan from storeDir/{id}/plan.json. Returns null if not found. */
export function loadQuestPlan(dir: string, id: string): QuestPlan | null {
  const filePath = path.join(dir, id, 'plan.json');
  try {
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as QuestPlan;
  } catch {
    return null;
  }
}

// ── runQuest ───────────────────────────────────────────────────────────────

export async function runQuest(opts: QuestRunOptions): Promise<QuestResult> {
  const { spec, llmFn, abortSignal, onProgress } = opts;
  const storeDir = opts.storeDir ?? '.pyrfor/quests';
  const maxAttemptsPerTask = opts.maxAttemptsPerTask ?? 3;

  if (!spec.title) throw new Error('spec.title is required');
  if (!spec.goal) throw new Error('spec.goal is required');

  // Merge caller executor with defaults; caller overrides win per method.
  const base = defaultExecutor(llmFn);
  const ex = opts.executor ?? {};
  const executor: Required<QuestExecutor> = {
    research: ex.research ?? base.research,
    requirements: ex.requirements ?? base.requirements,
    design: ex.design ?? base.design,
    tasks: ex.tasks ?? base.tasks,
    executeTask: ex.executeTask ?? base.executeTask,
    verify: ex.verify ?? base.verify,
    report: ex.report ?? base.report,
  };

  const specForPlan = { ...spec, id: spec.id ?? ulid() } as QuestPlan['spec'];
  const now = new Date().toISOString();

  const plan: QuestPlan = {
    spec: specForPlan,
    research: '',
    requirements: [],
    design: '',
    tasks: [],
    phase: 'research',
    startedAt: now,
    updatedAt: now,
    metrics: { tasksTotal: 0, tasksDone: 0, tasksFailed: 0, costUsd: 0 },
  };

  const isAborted = (): boolean => abortSignal?.aborted === true;

  /** Persist + notify; mutates updatedAt in-place. */
  const save = (p: QuestPlan): void => {
    p.updatedAt = new Date().toISOString();
    saveQuestPlan(storeDir, p);
    try {
      onProgress?.({ ...p });
    } catch {
      // ignore listener errors
    }
  };

  try {
    // ── Research ───────────────────────────────────────────────────────────
    if (isAborted()) return { status: 'aborted', plan };
    plan.phase = 'research';
    plan.research = await executor.research(spec);
    save(plan);

    // ── Requirements ───────────────────────────────────────────────────────
    if (isAborted()) return { status: 'aborted', plan };
    plan.phase = 'requirements';
    plan.requirements = await executor.requirements(spec, plan.research);
    save(plan);

    // ── Design ─────────────────────────────────────────────────────────────
    if (isAborted()) return { status: 'aborted', plan };
    plan.phase = 'design';
    plan.design = await executor.design(spec, plan.requirements);
    save(plan);

    // ── Tasks ──────────────────────────────────────────────────────────────
    if (isAborted()) return { status: 'aborted', plan };
    plan.phase = 'tasks';
    const rawTasks = await executor.tasks(spec, plan.design);
    plan.tasks = rawTasks.map((t) => ({
      id: ulid(),
      title: t.title,
      description: t.description,
      status: 'pending' as const,
      dependencies: t.dependencies,
      attempts: 0,
    }));
    plan.metrics.tasksTotal = plan.tasks.length;

    // Resolve title-based dependency strings to task IDs (for custom executors
    // that name dependencies by title; ID references pass through unchanged).
    const titleToId = new Map(plan.tasks.map((t) => [t.title, t.id]));
    for (const task of plan.tasks) {
      task.dependencies = task.dependencies.map((dep) => titleToId.get(dep) ?? dep);
    }

    save(plan);

    // ── Execute ────────────────────────────────────────────────────────────
    if (plan.tasks.length > 0) {
      if (isAborted()) return { status: 'aborted', plan };
      plan.phase = 'execute';
      save(plan);

      const sorted = topoSort(plan.tasks);
      if (sorted === null) {
        plan.phase = 'failed';
        plan.finishedAt = new Date().toISOString();
        save(plan);
        return { status: 'failed', plan };
      }

      for (const task of sorted) {
        if (isAborted()) return { status: 'aborted', plan };

        let ok = false;
        let summary = '(not executed)';
        let costDelta = 0;

        for (let attempt = 1; attempt <= maxAttemptsPerTask; attempt++) {
          task.attempts = attempt;
          task.status = 'in_progress';
          save(plan);

          try {
            const res = await executor.executeTask(task, plan);
            ok = res.ok;
            summary = res.summary;
            costDelta = res.costUsd ?? 0;
          } catch (err) {
            ok = false;
            summary = `exception: ${err instanceof Error ? err.message : String(err)}`;
            costDelta = 0;
          }

          if (ok) break;
        }

        task.result = { ok, summary, ts: new Date().toISOString() };
        plan.metrics.costUsd += costDelta;

        if (ok) {
          task.status = 'done';
          plan.metrics.tasksDone++;
          save(plan);
        } else {
          task.status = 'failed';
          plan.metrics.tasksFailed++;
          plan.phase = 'failed';
          plan.finishedAt = new Date().toISOString();
          save(plan);
          return { status: 'failed', plan };
        }

        if (isAborted()) return { status: 'aborted', plan };
      }
    }

    // ── Verify ─────────────────────────────────────────────────────────────
    if (isAborted()) return { status: 'aborted', plan };
    plan.phase = 'verify';
    save(plan);
    const verifyResult = await executor.verify(plan);

    // ── Report ─────────────────────────────────────────────────────────────
    if (isAborted()) return { status: 'aborted', plan };
    plan.phase = 'report';
    save(plan);
    const reportContent = await executor.report(plan, verifyResult.report);

    const questDir = path.join(storeDir, plan.spec.id);
    mkdirSync(questDir, { recursive: true });
    const reportPath = path.join(questDir, 'report.md');
    writeFileSync(reportPath, reportContent, 'utf8');

    plan.phase = 'done';
    plan.finishedAt = new Date().toISOString();
    save(plan);

    return { status: 'completed', plan, reportPath };
  } catch {
    plan.phase = 'failed';
    plan.finishedAt = new Date().toISOString();
    try {
      save(plan);
    } catch {
      // ignore persistence errors during failure handling
    }
    return { status: 'failed', plan };
  }
}
