"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoScheduleTasks = autoScheduleTasks;
const critical_path_1 = require("./critical-path");
function autoScheduleTasks(input) {
    const criticalPath = (0, critical_path_1.calculateCriticalPath)(input);
    const taskMap = new Map(input.tasks.map((task) => [task.id, task]));
    const updatedTasks = criticalPath.tasks.flatMap((metrics) => {
        const task = taskMap.get(metrics.taskId);
        if (!task || task.isManualSchedule) {
            return [];
        }
        const oldStartDate = (0, critical_path_1.getTaskStartDate)(task);
        const oldDueDate = (0, critical_path_1.getTaskFinishDate)(task);
        const newStartDate = metrics.earliestStart;
        const newDueDate = metrics.earliestFinish;
        const changed = oldStartDate.getTime() !== newStartDate.getTime() ||
            oldDueDate.getTime() !== newDueDate.getTime() ||
            task.startDate === null;
        if (!changed) {
            return [];
        }
        return [
            {
                taskId: metrics.taskId,
                title: metrics.title,
                oldStartDate,
                newStartDate,
                oldDueDate,
                newDueDate,
                durationDays: metrics.durationDays,
                totalFloatDays: metrics.totalFloatDays,
                isCritical: metrics.isCritical,
            },
        ];
    });
    return {
        criticalPath,
        updatedTasks,
    };
}
