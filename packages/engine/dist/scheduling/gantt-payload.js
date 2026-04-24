var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../prisma';
import { calculateCriticalPath } from './critical-path';
export function buildProjectGanttSnapshot(projectId) {
    return __awaiter(this, void 0, void 0, function* () {
        const project = yield prisma.project.findUnique({
            where: { id: projectId },
            select: {
                id: true,
                name: true,
                start: true,
                end: true,
                status: true,
                progress: true,
            },
        });
        if (!project) {
            return null;
        }
        const tasks = yield prisma.task.findMany({
            where: { projectId },
            select: {
                id: true,
                title: true,
                status: true,
                projectId: true,
                startDate: true,
                dueDate: true,
                estimatedHours: true,
                estimatedCost: true,
                actualCost: true,
                percentComplete: true,
                wbs: true,
                parentTaskId: true,
                isMilestone: true,
                isManualSchedule: true,
                constraintType: true,
                constraintDate: true,
                dependencies: {
                    select: {
                        id: true,
                        dependsOnTaskId: true,
                        type: true,
                        lagDays: true,
                        dependsOnTask: {
                            select: {
                                title: true,
                            },
                        },
                    },
                },
                baselines: {
                    orderBy: [{ baselineNumber: "asc" }, { createdAt: "asc" }],
                    select: {
                        id: true,
                        baselineNumber: true,
                        startDate: true,
                        finishDate: true,
                        duration: true,
                        cost: true,
                        work: true,
                    },
                },
                resourceAssignments: {
                    select: {
                        id: true,
                        memberId: true,
                        member: {
                            select: {
                                name: true,
                            },
                        },
                        equipmentId: true,
                        equipment: {
                            select: {
                                name: true,
                            },
                        },
                        units: true,
                        plannedHours: true,
                        actualHours: true,
                        costRate: true,
                    },
                },
            },
            orderBy: [{ wbs: "asc" }, { startDate: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
        });
        const criticalPath = calculateCriticalPath({
            tasks: tasks.map((task) => ({
                id: task.id,
                title: task.title,
                projectId: task.projectId,
                startDate: task.startDate,
                dueDate: task.dueDate,
                estimatedHours: task.estimatedHours,
                percentComplete: task.percentComplete,
                isMilestone: task.isMilestone,
                isManualSchedule: task.isManualSchedule,
                constraintType: task.constraintType,
                constraintDate: task.constraintDate,
            })),
            dependencies: tasks.flatMap((task) => task.dependencies.map((dependency) => ({
                id: dependency.id,
                taskId: task.id,
                dependsOnTaskId: dependency.dependsOnTaskId,
                type: dependency.type,
                lagDays: dependency.lagDays,
            }))),
            projectStart: project.start,
            projectEnd: project.end,
        });
        const metricsByTaskId = new Map(criticalPath.tasks.map((task) => [task.taskId, task]));
        return {
            project: {
                id: project.id,
                name: project.name,
                start: project.start.toISOString(),
                end: project.end.toISOString(),
                status: project.status,
                progress: project.progress,
            },
            tasks: tasks.map((task) => {
                var _a, _b, _c, _d, _e, _f, _g;
                const metrics = metricsByTaskId.get(task.id);
                const progress = task.status === "done"
                    ? 100
                    : typeof task.percentComplete === "number"
                        ? task.percentComplete
                        : task.status === "in_progress"
                            ? 50
                            : 0;
                return {
                    id: task.id,
                    name: task.title,
                    title: task.title,
                    start: ((_b = (_a = metrics === null || metrics === void 0 ? void 0 : metrics.earliestStart) !== null && _a !== void 0 ? _a : task.startDate) !== null && _b !== void 0 ? _b : task.dueDate).toISOString(),
                    end: ((_c = metrics === null || metrics === void 0 ? void 0 : metrics.earliestFinish) !== null && _c !== void 0 ? _c : task.dueDate).toISOString(),
                    progress,
                    status: task.status,
                    projectId: task.projectId,
                    type: task.status,
                    dependencies: task.dependencies.map((dependency) => dependency.dependsOnTaskId),
                    wbs: task.wbs,
                    parentTaskId: task.parentTaskId,
                    isMilestone: task.isMilestone,
                    isManualSchedule: task.isManualSchedule,
                    durationDays: (_d = metrics === null || metrics === void 0 ? void 0 : metrics.durationDays) !== null && _d !== void 0 ? _d : 0,
                    totalFloatDays: (_e = metrics === null || metrics === void 0 ? void 0 : metrics.totalFloatDays) !== null && _e !== void 0 ? _e : 0,
                    freeFloatDays: (_f = metrics === null || metrics === void 0 ? void 0 : metrics.freeFloatDays) !== null && _f !== void 0 ? _f : 0,
                    isCritical: (_g = metrics === null || metrics === void 0 ? void 0 : metrics.isCritical) !== null && _g !== void 0 ? _g : false,
                    estimatedHours: task.estimatedHours,
                    estimatedCost: task.estimatedCost,
                    actualCost: task.actualCost,
                    resourceAssignments: task.resourceAssignments.map((assignment) => {
                        var _a, _b, _c, _d;
                        return ({
                            id: assignment.id,
                            memberId: assignment.memberId,
                            memberName: (_b = (_a = assignment.member) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : null,
                            equipmentId: assignment.equipmentId,
                            equipmentName: (_d = (_c = assignment.equipment) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : null,
                            units: assignment.units,
                            plannedHours: assignment.plannedHours,
                            actualHours: assignment.actualHours,
                            costRate: assignment.costRate,
                        });
                    }),
                    baselines: task.baselines.map((baseline) => ({
                        id: baseline.id,
                        baselineNumber: baseline.baselineNumber,
                        startDate: baseline.startDate.toISOString(),
                        finishDate: baseline.finishDate.toISOString(),
                        duration: baseline.duration,
                        cost: baseline.cost,
                        work: baseline.work,
                    })),
                };
            }),
            dependencies: tasks.flatMap((task) => task.dependencies.map((dependency) => {
                var _a, _b;
                return ({
                    id: dependency.id,
                    source: dependency.dependsOnTaskId,
                    target: task.id,
                    type: dependency.type,
                    lagDays: dependency.lagDays,
                    isCritical: Boolean((_a = metricsByTaskId.get(task.id)) === null || _a === void 0 ? void 0 : _a.isCritical) &&
                        Boolean((_b = metricsByTaskId.get(dependency.dependsOnTaskId)) === null || _b === void 0 ? void 0 : _b.isCritical),
                    sourceTask: dependency.dependsOnTask.title,
                    targetTask: task.title,
                });
            })),
        };
    });
}
