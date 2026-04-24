const DAY_MS = 24 * 60 * 60 * 1000;
function normalizeDate(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
export function addDays(date, days) {
    return new Date(normalizeDate(date).getTime() + days * DAY_MS);
}
export function getDayOffset(date, anchor) {
    return Math.round((normalizeDate(date).getTime() - normalizeDate(anchor).getTime()) / DAY_MS);
}
export function normalizeDependencyType(value) {
    switch (value) {
        case "START_TO_START":
        case "FINISH_TO_FINISH":
        case "START_TO_FINISH":
            return value;
        default:
            return "FINISH_TO_START";
    }
}
export function getTaskDurationDays(task) {
    if (task.isMilestone)
        return 0;
    if (task.startDate) {
        const start = normalizeDate(task.startDate);
        const due = normalizeDate(task.dueDate);
        const span = getDayOffset(due, start) + 1;
        return Math.max(1, span);
    }
    if (typeof task.estimatedHours === "number" && Number.isFinite(task.estimatedHours)) {
        return Math.max(1, Math.ceil(task.estimatedHours / 8));
    }
    return 1;
}
export function getTaskStartDate(task) {
    const due = normalizeDate(task.dueDate);
    const durationDays = getTaskDurationDays(task);
    if (task.startDate) {
        return normalizeDate(task.startDate);
    }
    if (durationDays === 0) {
        return due;
    }
    return addDays(due, -(durationDays - 1));
}
export function getTaskFinishDate(task) {
    return normalizeDate(task.dueDate);
}
function prepareTasks(tasks, projectStart) {
    var _a;
    const normalizedProjectStart = projectStart ? normalizeDate(projectStart) : null;
    const anchor = (_a = normalizedProjectStart !== null && normalizedProjectStart !== void 0 ? normalizedProjectStart : tasks.reduce((minDate, task) => {
        const start = getTaskStartDate(task);
        if (!minDate || start < minDate)
            return start;
        return minDate;
    }, null)) !== null && _a !== void 0 ? _a : normalizeDate(new Date());
    const prepared = new Map();
    for (const task of tasks) {
        const normalizedStart = getTaskStartDate(task);
        const normalizedDue = getTaskFinishDate(task);
        const durationDays = getTaskDurationDays(task);
        prepared.set(task.id, Object.assign(Object.assign({}, task), { normalizedStart,
            normalizedDue,
            durationDays, currentStartIndex: getDayOffset(normalizedStart, anchor) }));
    }
    return { anchor, prepared };
}
function topologicalSort(taskIds, dependencies) {
    var _a, _b, _c, _d;
    const inDegree = new Map(taskIds.map((taskId) => [taskId, 0]));
    const outgoing = new Map(taskIds.map((taskId) => [taskId, []]));
    for (const dependency of dependencies) {
        if (!inDegree.has(dependency.taskId) || !inDegree.has(dependency.dependsOnTaskId)) {
            continue;
        }
        inDegree.set(dependency.taskId, ((_a = inDegree.get(dependency.taskId)) !== null && _a !== void 0 ? _a : 0) + 1);
        (_b = outgoing.get(dependency.dependsOnTaskId)) === null || _b === void 0 ? void 0 : _b.push(dependency.taskId);
    }
    const queue = taskIds.filter((taskId) => { var _a; return ((_a = inDegree.get(taskId)) !== null && _a !== void 0 ? _a : 0) === 0; });
    const result = [];
    while (queue.length > 0) {
        const current = queue.shift();
        result.push(current);
        for (const next of (_c = outgoing.get(current)) !== null && _c !== void 0 ? _c : []) {
            const nextInDegree = ((_d = inDegree.get(next)) !== null && _d !== void 0 ? _d : 0) - 1;
            inDegree.set(next, nextInDegree);
            if (nextInDegree === 0) {
                queue.push(next);
            }
        }
    }
    if (result.length !== taskIds.length) {
        throw new Error("Circular dependency detected in scheduling graph");
    }
    return result;
}
function successorMinStart(dependency, predecessor, successorDuration) {
    var _a;
    const lag = (_a = dependency.lagDays) !== null && _a !== void 0 ? _a : 0;
    const type = normalizeDependencyType(dependency.type);
    switch (type) {
        case "START_TO_START":
            return predecessor.es + lag;
        case "FINISH_TO_FINISH":
            return predecessor.ef + lag - successorDuration;
        case "START_TO_FINISH":
            return predecessor.es + lag - successorDuration;
        case "FINISH_TO_START":
        default:
            return predecessor.ef + lag;
    }
}
function predecessorMaxFinish(dependency, successor, predecessorDuration) {
    var _a;
    const lag = (_a = dependency.lagDays) !== null && _a !== void 0 ? _a : 0;
    const type = normalizeDependencyType(dependency.type);
    switch (type) {
        case "START_TO_START":
            return successor.ls - lag + predecessorDuration;
        case "FINISH_TO_FINISH":
            return successor.lf - lag;
        case "START_TO_FINISH":
            return successor.lf - lag + predecessorDuration;
        case "FINISH_TO_START":
        default:
            return successor.ls - lag;
    }
}
function applyEarliestConstraint(startIndex, task, anchor) {
    if (!task.constraintType || !task.constraintDate) {
        return startIndex;
    }
    const constraintIndex = getDayOffset(task.constraintDate, anchor);
    const finishConstraintExclusive = constraintIndex + 1;
    switch (task.constraintType) {
        case "MSO":
            return constraintIndex;
        case "MFO":
            return finishConstraintExclusive - task.durationDays;
        case "SNET":
            return Math.max(startIndex, constraintIndex);
        case "FNET":
            return Math.max(startIndex, finishConstraintExclusive - task.durationDays);
        default:
            return startIndex;
    }
}
function applyLatestConstraint(finishIndex, task, anchor) {
    if (!task.constraintType || !task.constraintDate) {
        return finishIndex;
    }
    const constraintIndex = getDayOffset(task.constraintDate, anchor);
    const finishConstraintExclusive = constraintIndex + 1;
    switch (task.constraintType) {
        case "MSO":
            return constraintIndex + task.durationDays;
        case "MFO":
            return finishConstraintExclusive;
        case "SNLT":
            return Math.min(finishIndex, constraintIndex + task.durationDays);
        case "FNLT":
            return Math.min(finishIndex, finishConstraintExclusive);
        default:
            return finishIndex;
    }
}
function computeFreeFloatDays(taskId, node, outgoingDependencies, nodes) {
    var _a, _b;
    const outgoing = (_a = outgoingDependencies.get(taskId)) !== null && _a !== void 0 ? _a : [];
    if (!outgoing.length) {
        return Math.max(0, node.ls - node.es);
    }
    let minFloat = Number.POSITIVE_INFINITY;
    for (const dependency of outgoing) {
        const successor = nodes.get(dependency.taskId);
        if (!successor)
            continue;
        const lag = (_b = dependency.lagDays) !== null && _b !== void 0 ? _b : 0;
        const type = normalizeDependencyType(dependency.type);
        let candidate = 0;
        switch (type) {
            case "START_TO_START":
                candidate = successor.es - lag - node.es;
                break;
            case "FINISH_TO_FINISH":
                candidate = successor.ef - lag - node.ef;
                break;
            case "START_TO_FINISH":
                candidate = successor.ef - lag - node.es;
                break;
            case "FINISH_TO_START":
            default:
                candidate = successor.es - lag - node.ef;
                break;
        }
        minFloat = Math.min(minFloat, candidate);
    }
    if (!Number.isFinite(minFloat)) {
        return Math.max(0, node.ls - node.es);
    }
    return Math.max(0, minFloat);
}
export function calculateCriticalPath(input) {
    var _a, _b, _c, _d;
    const { tasks, dependencies, projectStart, projectEnd } = input;
    if (tasks.length === 0) {
        const today = normalizeDate(new Date());
        return {
            projectStart: today,
            projectFinish: today,
            tasks: [],
            criticalPath: [],
        };
    }
    const { anchor, prepared } = prepareTasks(tasks, projectStart);
    const taskIds = tasks.map((task) => task.id);
    const orderedTaskIds = topologicalSort(taskIds, dependencies);
    const incomingDependencies = new Map();
    const outgoingDependencies = new Map();
    for (const dependency of dependencies) {
        if (!prepared.has(dependency.taskId) || !prepared.has(dependency.dependsOnTaskId)) {
            continue;
        }
        incomingDependencies.set(dependency.taskId, [
            ...((_a = incomingDependencies.get(dependency.taskId)) !== null && _a !== void 0 ? _a : []),
            dependency,
        ]);
        outgoingDependencies.set(dependency.dependsOnTaskId, [
            ...((_b = outgoingDependencies.get(dependency.dependsOnTaskId)) !== null && _b !== void 0 ? _b : []),
            dependency,
        ]);
    }
    const nodes = new Map();
    for (const taskId of orderedTaskIds) {
        const task = prepared.get(taskId);
        let earliestStart = task.currentStartIndex;
        for (const dependency of (_c = incomingDependencies.get(taskId)) !== null && _c !== void 0 ? _c : []) {
            const predecessor = nodes.get(dependency.dependsOnTaskId);
            if (!predecessor)
                continue;
            earliestStart = Math.max(earliestStart, successorMinStart(dependency, predecessor, task.durationDays));
        }
        earliestStart = applyEarliestConstraint(earliestStart, task, anchor);
        const earliestFinish = earliestStart + task.durationDays;
        nodes.set(taskId, {
            es: earliestStart,
            ef: earliestFinish,
            ls: earliestStart,
            lf: earliestFinish,
        });
    }
    const projectEndIndex = projectEnd && Number.isFinite(projectEnd.getTime())
        ? getDayOffset(projectEnd, anchor) + 1
        : null;
    let finishIndex = projectEndIndex !== null && projectEndIndex !== void 0 ? projectEndIndex : Math.max(...Array.from(nodes.values(), (node) => node.ef));
    for (const taskId of [...orderedTaskIds].reverse()) {
        const task = prepared.get(taskId);
        const outgoing = (_d = outgoingDependencies.get(taskId)) !== null && _d !== void 0 ? _d : [];
        let latestFinish = finishIndex;
        if (outgoing.length > 0) {
            latestFinish = Number.POSITIVE_INFINITY;
            for (const dependency of outgoing) {
                const successor = nodes.get(dependency.taskId);
                if (!successor)
                    continue;
                latestFinish = Math.min(latestFinish, predecessorMaxFinish(dependency, successor, task.durationDays));
            }
            if (!Number.isFinite(latestFinish)) {
                latestFinish = finishIndex;
            }
        }
        latestFinish = applyLatestConstraint(latestFinish, task, anchor);
        const latestStart = latestFinish - task.durationDays;
        nodes.set(taskId, Object.assign(Object.assign({}, nodes.get(taskId)), { ls: latestStart, lf: latestFinish }));
    }
    const taskMetrics = orderedTaskIds.map((taskId) => {
        const task = prepared.get(taskId);
        const node = nodes.get(taskId);
        const durationDays = task.durationDays;
        const earliestStart = addDays(anchor, node.es);
        const earliestFinish = durationDays === 0 ? earliestStart : addDays(anchor, node.ef - 1);
        const latestStart = addDays(anchor, node.ls);
        const latestFinish = durationDays === 0 ? latestStart : addDays(anchor, node.lf - 1);
        const totalFloatDays = Math.max(0, node.ls - node.es);
        const freeFloatDays = computeFreeFloatDays(taskId, node, outgoingDependencies, nodes);
        const isCritical = totalFloatDays === 0;
        return {
            taskId,
            title: task.title,
            earliestStart,
            earliestFinish,
            latestStart,
            latestFinish,
            durationDays,
            totalFloatDays,
            freeFloatDays,
            isCritical,
            percentComplete: task.percentComplete,
            isManualSchedule: task.isManualSchedule,
        };
    });
    finishIndex = Math.max(...Array.from(nodes.values(), (node) => node.ef), finishIndex);
    return {
        projectStart: anchor,
        projectFinish: addDays(anchor, Math.max(0, finishIndex - 1)),
        tasks: taskMetrics,
        criticalPath: taskMetrics.filter((task) => task.isCritical).map((task) => task.taskId),
    };
}
