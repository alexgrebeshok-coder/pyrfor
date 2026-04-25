var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { mkdirSync, writeFileSync, renameSync, readFileSync } from 'fs';
import path from 'path';
// ── Inline ULID ────────────────────────────────────────────────────────────
const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid() {
    let t = Date.now();
    const ts = new Array(10);
    for (let i = 9; i >= 0; i--) {
        ts[i] = ULID_CHARS[t & 31];
        t = Math.floor(t / 32);
    }
    const rand = new Array(16);
    for (let i = 0; i < 16; i++) {
        rand[i] = ULID_CHARS[Math.floor(Math.random() * 32)];
    }
    return ts.join('') + rand.join('');
}
// ── Internal helpers ───────────────────────────────────────────────────────
/**
 * Kahn's topological sort. Returns sorted task list, or null if a cycle exists.
 */
function topoSort(tasks) {
    var _a, _b, _c;
    const idToTask = new Map(tasks.map((t) => [t.id, t]));
    const inDegree = new Map();
    const adj = new Map();
    for (const t of tasks) {
        if (!inDegree.has(t.id))
            inDegree.set(t.id, 0);
        if (!adj.has(t.id))
            adj.set(t.id, []);
        for (const dep of t.dependencies) {
            if (!adj.has(dep))
                adj.set(dep, []);
            adj.get(dep).push(t.id);
            inDegree.set(t.id, ((_a = inDegree.get(t.id)) !== null && _a !== void 0 ? _a : 0) + 1);
        }
    }
    const queue = tasks.filter((t) => { var _a; return ((_a = inDegree.get(t.id)) !== null && _a !== void 0 ? _a : 0) === 0; });
    const result = [];
    while (queue.length > 0) {
        const t = queue.shift();
        result.push(t);
        for (const neighborId of (_b = adj.get(t.id)) !== null && _b !== void 0 ? _b : []) {
            const deg = ((_c = inDegree.get(neighborId)) !== null && _c !== void 0 ? _c : 0) - 1;
            inDegree.set(neighborId, deg);
            if (deg === 0) {
                const neighbor = idToTask.get(neighborId);
                if (neighbor)
                    queue.push(neighbor);
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
function parseTaskLines(text) {
    const result = [];
    let current = null;
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
        }
        else if (current !== null && raw.trim()) {
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
export function defaultExecutor(llmFn) {
    return {
        research(spec) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                if (!llmFn)
                    return '(no research executed)';
                const constraints = (_b = (_a = spec.constraints) === null || _a === void 0 ? void 0 : _a.join(', ')) !== null && _b !== void 0 ? _b : 'none';
                return llmFn(`Summarise the codebase context relevant to: ${spec.goal}. Constraints: ${constraints}.`);
            });
        },
        requirements(spec, research) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!llmFn)
                    return [spec.goal];
                const text = yield llmFn(`Given this research:\n${research}\n\nList requirements as bullet points (- item) for: ${spec.goal}`);
                return text
                    .split('\n')
                    .filter((l) => l.trimStart().startsWith('- '))
                    .map((l) => l.trimStart().slice(2).trim())
                    .filter(Boolean);
            });
        },
        design(spec, requirements) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!llmFn)
                    return '(default minimal design)';
                return llmFn(`Design a solution for: ${spec.goal}\nRequirements:\n${requirements.join('\n')}`);
            });
        },
        tasks(spec, design) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!llmFn) {
                    return [{ title: `Implement: ${spec.goal}`, description: '', dependencies: [] }];
                }
                const text = yield llmFn(`Break down into tasks (each starting with "- "):\nGoal: ${spec.goal}\nDesign:\n${design}`);
                return parseTaskLines(text);
            });
        },
        executeTask(task, _plan) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!llmFn)
                    return { ok: true, summary: '(stub executed)' };
                const output = yield llmFn(`Execute task: ${task.title}\nDescription: ${task.description}`);
                return { ok: true, summary: output };
            });
        },
        verify(_plan) {
            return __awaiter(this, void 0, void 0, function* () {
                return { ok: true, report: 'No verifier configured' };
            });
        },
        report(plan, verifyReport) {
            return __awaiter(this, void 0, void 0, function* () {
                const taskLines = plan.tasks.map((t) => { var _a, _b; return `- [${t.status}] **${t.title}**: ${(_b = (_a = t.result) === null || _a === void 0 ? void 0 : _a.summary) !== null && _b !== void 0 ? _b : '(no result)'}`; });
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
            });
        },
    };
}
// ── Persistence ────────────────────────────────────────────────────────────
/** Atomically write plan to storeDir/{plan.spec.id}/plan.json. Returns file path. */
export function saveQuestPlan(dir, plan) {
    const questDir = path.join(dir, plan.spec.id);
    mkdirSync(questDir, { recursive: true });
    const filePath = path.join(questDir, 'plan.json');
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(plan, null, 2), 'utf8');
    renameSync(tmpPath, filePath);
    return filePath;
}
/** Load plan from storeDir/{id}/plan.json. Returns null if not found. */
export function loadQuestPlan(dir, id) {
    const filePath = path.join(dir, id, 'plan.json');
    try {
        const content = readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    }
    catch (_a) {
        return null;
    }
}
// ── runQuest ───────────────────────────────────────────────────────────────
export function runQuest(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        const { spec, llmFn, abortSignal, onProgress } = opts;
        const storeDir = (_a = opts.storeDir) !== null && _a !== void 0 ? _a : '.pyrfor/quests';
        const maxAttemptsPerTask = (_b = opts.maxAttemptsPerTask) !== null && _b !== void 0 ? _b : 3;
        if (!spec.title)
            throw new Error('spec.title is required');
        if (!spec.goal)
            throw new Error('spec.goal is required');
        // Merge caller executor with defaults; caller overrides win per method.
        const base = defaultExecutor(llmFn);
        const ex = (_c = opts.executor) !== null && _c !== void 0 ? _c : {};
        const executor = {
            research: (_d = ex.research) !== null && _d !== void 0 ? _d : base.research,
            requirements: (_e = ex.requirements) !== null && _e !== void 0 ? _e : base.requirements,
            design: (_f = ex.design) !== null && _f !== void 0 ? _f : base.design,
            tasks: (_g = ex.tasks) !== null && _g !== void 0 ? _g : base.tasks,
            executeTask: (_h = ex.executeTask) !== null && _h !== void 0 ? _h : base.executeTask,
            verify: (_j = ex.verify) !== null && _j !== void 0 ? _j : base.verify,
            report: (_k = ex.report) !== null && _k !== void 0 ? _k : base.report,
        };
        const specForPlan = Object.assign(Object.assign({}, spec), { id: (_l = spec.id) !== null && _l !== void 0 ? _l : ulid() });
        const now = new Date().toISOString();
        const plan = {
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
        const isAborted = () => (abortSignal === null || abortSignal === void 0 ? void 0 : abortSignal.aborted) === true;
        /** Persist + notify; mutates updatedAt in-place. */
        const save = (p) => {
            p.updatedAt = new Date().toISOString();
            saveQuestPlan(storeDir, p);
            try {
                onProgress === null || onProgress === void 0 ? void 0 : onProgress(Object.assign({}, p));
            }
            catch (_a) {
                // ignore listener errors
            }
        };
        try {
            // ── Research ───────────────────────────────────────────────────────────
            if (isAborted())
                return { status: 'aborted', plan };
            plan.phase = 'research';
            plan.research = yield executor.research(spec);
            save(plan);
            // ── Requirements ───────────────────────────────────────────────────────
            if (isAborted())
                return { status: 'aborted', plan };
            plan.phase = 'requirements';
            plan.requirements = yield executor.requirements(spec, plan.research);
            save(plan);
            // ── Design ─────────────────────────────────────────────────────────────
            if (isAborted())
                return { status: 'aborted', plan };
            plan.phase = 'design';
            plan.design = yield executor.design(spec, plan.requirements);
            save(plan);
            // ── Tasks ──────────────────────────────────────────────────────────────
            if (isAborted())
                return { status: 'aborted', plan };
            plan.phase = 'tasks';
            const rawTasks = yield executor.tasks(spec, plan.design);
            plan.tasks = rawTasks.map((t) => ({
                id: ulid(),
                title: t.title,
                description: t.description,
                status: 'pending',
                dependencies: t.dependencies,
                attempts: 0,
            }));
            plan.metrics.tasksTotal = plan.tasks.length;
            // Resolve title-based dependency strings to task IDs (for custom executors
            // that name dependencies by title; ID references pass through unchanged).
            const titleToId = new Map(plan.tasks.map((t) => [t.title, t.id]));
            for (const task of plan.tasks) {
                task.dependencies = task.dependencies.map((dep) => { var _a; return (_a = titleToId.get(dep)) !== null && _a !== void 0 ? _a : dep; });
            }
            save(plan);
            // ── Execute ────────────────────────────────────────────────────────────
            if (plan.tasks.length > 0) {
                if (isAborted())
                    return { status: 'aborted', plan };
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
                    if (isAborted())
                        return { status: 'aborted', plan };
                    let ok = false;
                    let summary = '(not executed)';
                    let costDelta = 0;
                    for (let attempt = 1; attempt <= maxAttemptsPerTask; attempt++) {
                        task.attempts = attempt;
                        task.status = 'in_progress';
                        save(plan);
                        try {
                            const res = yield executor.executeTask(task, plan);
                            ok = res.ok;
                            summary = res.summary;
                            costDelta = (_m = res.costUsd) !== null && _m !== void 0 ? _m : 0;
                        }
                        catch (err) {
                            ok = false;
                            summary = `exception: ${err instanceof Error ? err.message : String(err)}`;
                            costDelta = 0;
                        }
                        if (ok)
                            break;
                    }
                    task.result = { ok, summary, ts: new Date().toISOString() };
                    plan.metrics.costUsd += costDelta;
                    if (ok) {
                        task.status = 'done';
                        plan.metrics.tasksDone++;
                        save(plan);
                    }
                    else {
                        task.status = 'failed';
                        plan.metrics.tasksFailed++;
                        plan.phase = 'failed';
                        plan.finishedAt = new Date().toISOString();
                        save(plan);
                        return { status: 'failed', plan };
                    }
                    if (isAborted())
                        return { status: 'aborted', plan };
                }
            }
            // ── Verify ─────────────────────────────────────────────────────────────
            if (isAborted())
                return { status: 'aborted', plan };
            plan.phase = 'verify';
            save(plan);
            const verifyResult = yield executor.verify(plan);
            // ── Report ─────────────────────────────────────────────────────────────
            if (isAborted())
                return { status: 'aborted', plan };
            plan.phase = 'report';
            save(plan);
            const reportContent = yield executor.report(plan, verifyResult.report);
            const questDir = path.join(storeDir, plan.spec.id);
            mkdirSync(questDir, { recursive: true });
            const reportPath = path.join(questDir, 'report.md');
            writeFileSync(reportPath, reportContent, 'utf8');
            plan.phase = 'done';
            plan.finishedAt = new Date().toISOString();
            save(plan);
            return { status: 'completed', plan, reportPath };
        }
        catch (_o) {
            plan.phase = 'failed';
            plan.finishedAt = new Date().toISOString();
            try {
                save(plan);
            }
            catch (_p) {
                // ignore persistence errors during failure handling
            }
            return { status: 'failed', plan };
        }
    });
}
