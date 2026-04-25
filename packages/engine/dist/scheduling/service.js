var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../prisma.js';
export function createSchedulingId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
export function getProjectSchedulingContext(projectId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const project = yield prisma.project.findUnique({
            where: { id: projectId },
            select: {
                id: true,
                start: true,
                end: true,
            },
        });
        if (!project) {
            return null;
        }
        const [tasks, assignments] = yield Promise.all([
            prisma.task.findMany({
                where: { projectId },
                select: {
                    id: true,
                    title: true,
                    projectId: true,
                    startDate: true,
                    dueDate: true,
                    estimatedHours: true,
                    percentComplete: true,
                    isMilestone: true,
                    isManualSchedule: true,
                    constraintType: true,
                    constraintDate: true,
                    dependencies: {
                        select: {
                            id: true,
                            taskId: true,
                            dependsOnTaskId: true,
                            type: true,
                            lagDays: true,
                        },
                    },
                },
                orderBy: [{ startDate: "asc" }, { dueDate: "asc" }, { createdAt: "asc" }],
            }),
            prisma.resourceAssignment.findMany({
                where: {
                    task: {
                        projectId,
                    },
                },
                select: {
                    id: true,
                    taskId: true,
                    memberId: true,
                    equipmentId: true,
                    units: true,
                    member: {
                        select: {
                            id: true,
                            name: true,
                            capacity: true,
                        },
                    },
                    equipment: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            }),
        ]);
        const dependencies = tasks.flatMap((task) => task.dependencies);
        const capacities = new Map();
        for (const assignment of assignments) {
            if (assignment.memberId && assignment.member) {
                capacities.set(`member:${assignment.memberId}`, {
                    resourceKey: `member:${assignment.memberId}`,
                    resourceId: assignment.memberId,
                    resourceType: "member",
                    label: assignment.member.name,
                    capacityUnits: Math.max(0.1, assignment.member.capacity / 100),
                });
            }
            if (assignment.equipmentId) {
                capacities.set(`equipment:${assignment.equipmentId}`, {
                    resourceKey: `equipment:${assignment.equipmentId}`,
                    resourceId: assignment.equipmentId,
                    resourceType: "equipment",
                    label: (_b = (_a = assignment.equipment) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : assignment.equipmentId,
                    capacityUnits: 1,
                });
            }
        }
        return {
            project,
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
            dependencies,
            assignments: assignments.map((assignment) => ({
                id: assignment.id,
                taskId: assignment.taskId,
                memberId: assignment.memberId,
                equipmentId: assignment.equipmentId,
                units: assignment.units,
            })),
            capacities: [...capacities.values()],
        };
    });
}
export function serializeCriticalPath(result) {
    return {
        projectStart: result.projectStart.toISOString(),
        projectFinish: result.projectFinish.toISOString(),
        criticalPath: result.criticalPath,
        tasks: result.tasks.map((task) => (Object.assign(Object.assign({}, task), { earliestStart: task.earliestStart.toISOString(), earliestFinish: task.earliestFinish.toISOString(), latestStart: task.latestStart.toISOString(), latestFinish: task.latestFinish.toISOString() }))),
    };
}
