import { calculateCriticalPath, getTaskFinishDate, getTaskStartDate, } from './critical-path.js';
export function autoScheduleTasks(input) {
    const criticalPath = calculateCriticalPath(input);
    const taskMap = new Map(input.tasks.map((task) => [task.id, task]));
    const updatedTasks = criticalPath.tasks.flatMap((metrics) => {
        const task = taskMap.get(metrics.taskId);
        if (!task || task.isManualSchedule) {
            return [];
        }
        const oldStartDate = getTaskStartDate(task);
        const oldDueDate = getTaskFinishDate(task);
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
