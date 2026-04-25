import { autoScheduleTasks, } from './auto-schedule.js';
import { addDays, getDayOffset, } from './critical-path.js';
export function levelResources(input) {
    var _a, _b, _c, _d, _e, _f;
    const scheduled = autoScheduleTasks(input);
    const metricMap = new Map(scheduled.criticalPath.tasks.map((task) => [task.taskId, task]));
    const taskMap = new Map(input.tasks.map((task) => [task.id, task]));
    const capacityMap = new Map(input.capacities.map((capacity) => [capacity.resourceKey, capacity]));
    const loadMap = new Map();
    for (const assignment of input.assignments) {
        const metric = metricMap.get(assignment.taskId);
        if (!metric || metric.durationDays === 0) {
            continue;
        }
        const resourceKey = assignment.memberId
            ? `member:${assignment.memberId}`
            : assignment.equipmentId
                ? `equipment:${assignment.equipmentId}`
                : null;
        if (!resourceKey) {
            continue;
        }
        const units = Math.max(0, ((_a = assignment.units) !== null && _a !== void 0 ? _a : 100) / 100);
        const startOffset = getDayOffset(metric.earliestStart, scheduled.criticalPath.projectStart);
        const resourceTimeline = (_b = loadMap.get(resourceKey)) !== null && _b !== void 0 ? _b : new Map();
        for (let dayOffset = 0; dayOffset < metric.durationDays; dayOffset += 1) {
            const bucket = (_c = resourceTimeline.get(startOffset + dayOffset)) !== null && _c !== void 0 ? _c : {
                loadUnits: 0,
                taskIds: new Set(),
            };
            bucket.loadUnits += units;
            bucket.taskIds.add(assignment.taskId);
            resourceTimeline.set(startOffset + dayOffset, bucket);
        }
        loadMap.set(resourceKey, resourceTimeline);
    }
    const conflicts = [];
    for (const [resourceKey, resourceTimeline] of loadMap) {
        const capacity = (_d = capacityMap.get(resourceKey)) !== null && _d !== void 0 ? _d : {
            resourceKey,
            resourceId: (_e = resourceKey.split(":")[1]) !== null && _e !== void 0 ? _e : resourceKey,
            resourceType: resourceKey.startsWith("equipment:") ? "equipment" : "member",
            label: resourceKey,
            capacityUnits: 1,
        };
        for (const [offset, bucket] of resourceTimeline) {
            if (bucket.loadUnits <= capacity.capacityUnits) {
                continue;
            }
            conflicts.push({
                resourceKey,
                resourceId: capacity.resourceId,
                resourceType: capacity.resourceType,
                label: capacity.label,
                date: addDays(scheduled.criticalPath.projectStart, offset),
                loadUnits: Number(bucket.loadUnits.toFixed(2)),
                capacityUnits: capacity.capacityUnits,
                overloadUnits: Number((bucket.loadUnits - capacity.capacityUnits).toFixed(2)),
                taskIds: [...bucket.taskIds],
            });
        }
    }
    const shiftByTask = new Map();
    for (const conflict of conflicts) {
        const candidates = conflict.taskIds
            .map((taskId) => {
            const metric = metricMap.get(taskId);
            const task = taskMap.get(taskId);
            if (!metric || !task || metric.isCritical || task.isManualSchedule) {
                return null;
            }
            return { metric, task };
        })
            .filter((candidate) => candidate !== null)
            .sort((left, right) => right.metric.totalFloatDays - left.metric.totalFloatDays);
        const selected = candidates.find((candidate) => {
            var _a;
            const assignedShift = (_a = shiftByTask.get(candidate.metric.taskId)) !== null && _a !== void 0 ? _a : 0;
            return assignedShift < candidate.metric.totalFloatDays;
        });
        if (!selected) {
            continue;
        }
        shiftByTask.set(selected.metric.taskId, ((_f = shiftByTask.get(selected.metric.taskId)) !== null && _f !== void 0 ? _f : 0) + 1);
    }
    const adjustments = [...shiftByTask.entries()].map(([taskId, shiftDays]) => {
        const metric = metricMap.get(taskId);
        return {
            taskId,
            title: metric.title,
            shiftDays,
            newStartDate: addDays(metric.earliestStart, shiftDays),
            newDueDate: addDays(metric.earliestFinish, shiftDays),
            reason: "Resource overallocation leveling",
        };
    });
    return {
        criticalPath: scheduled.criticalPath,
        conflicts,
        adjustments,
    };
}
