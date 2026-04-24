var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { startOfDay, subDays } from "date-fns";
import { prisma } from '../prisma';
import { calculateEVM, calculateEVMFromValues, calculateTaskEVM } from "./calculator";
export function getProjectEvmSnapshot(projectId_1) {
    return __awaiter(this, arguments, void 0, function* (projectId, referenceDate = new Date()) {
        const [project, tasks] = yield Promise.all([
            prisma.project.findUnique({
                where: { id: projectId },
                select: {
                    id: true,
                    name: true,
                    budgetPlan: true,
                    budgetFact: true,
                    progress: true,
                    start: true,
                    end: true,
                },
            }),
            prisma.task.findMany({
                where: { projectId },
                select: {
                    id: true,
                    title: true,
                    estimatedCost: true,
                    actualCost: true,
                    percentComplete: true,
                    startDate: true,
                    dueDate: true,
                },
                orderBy: [{ wbs: "asc" }, { dueDate: "asc" }],
            }),
        ]);
        if (!project) {
            throw new Error(`Project "${projectId}" was not found.`);
        }
        return buildProjectEvmSnapshot(project, tasks, referenceDate);
    });
}
export function listWorkspaceEvmSnapshots(workspaceId_1) {
    return __awaiter(this, arguments, void 0, function* (workspaceId, referenceDate = new Date()) {
        const projects = yield prisma.project.findMany({
            where: { workspaceId },
            select: {
                id: true,
                name: true,
                budgetPlan: true,
                budgetFact: true,
                progress: true,
                start: true,
                end: true,
                tasks: {
                    select: {
                        id: true,
                        title: true,
                        estimatedCost: true,
                        actualCost: true,
                        percentComplete: true,
                        startDate: true,
                        dueDate: true,
                    },
                    orderBy: [{ wbs: "asc" }, { dueDate: "asc" }],
                },
            },
            orderBy: { updatedAt: "desc" },
        });
        const snapshots = projects.map((project) => buildProjectEvmSnapshot(project, project.tasks, referenceDate));
        const metrics = calculateEVMFromValues({
            BAC: snapshots.reduce((sum, snapshot) => sum + snapshot.metrics.BAC, 0),
            PV: snapshots.reduce((sum, snapshot) => sum + snapshot.metrics.PV, 0),
            EV: snapshots.reduce((sum, snapshot) => sum + snapshot.metrics.EV, 0),
            AC: snapshots.reduce((sum, snapshot) => sum + snapshot.metrics.AC, 0),
        });
        return {
            referenceDate: referenceDate.toISOString(),
            metrics,
            projects: snapshots,
            summary: {
                projectCount: snapshots.length,
                taskCount: snapshots.reduce((sum, snapshot) => sum + snapshot.summary.taskCount, 0),
                costedTaskCount: snapshots.reduce((sum, snapshot) => sum + snapshot.summary.costedTaskCount, 0),
            },
        };
    });
}
export function saveEvmSnapshot(projectId_1) {
    return __awaiter(this, arguments, void 0, function* (projectId, snapshotDate = new Date()) {
        const payload = yield getProjectEvmSnapshot(projectId, snapshotDate);
        const normalizedDate = startOfDay(snapshotDate);
        const snapshot = yield prisma.evmSnapshot.upsert({
            where: {
                projectId_date: {
                    projectId,
                    date: normalizedDate,
                },
            },
            update: {
                bac: payload.metrics.BAC,
                pv: payload.metrics.PV,
                ev: payload.metrics.EV,
                ac: payload.metrics.AC,
                cpi: payload.metrics.CPI,
                spi: payload.metrics.SPI,
                eac: payload.metrics.EAC,
                tcpi: payload.metrics.TCPI,
            },
            create: {
                id: `evm-snapshot-${normalizedDate.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                projectId,
                date: normalizedDate,
                bac: payload.metrics.BAC,
                pv: payload.metrics.PV,
                ev: payload.metrics.EV,
                ac: payload.metrics.AC,
                cpi: payload.metrics.CPI,
                spi: payload.metrics.SPI,
                eac: payload.metrics.EAC,
                tcpi: payload.metrics.TCPI,
            },
        });
        return {
            snapshot,
            payload,
        };
    });
}
export function getEvmHistory(projectId, options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const toDate = (_a = options === null || options === void 0 ? void 0 : options.toDate) !== null && _a !== void 0 ? _a : new Date();
        const fromDate = (_b = options === null || options === void 0 ? void 0 : options.fromDate) !== null && _b !== void 0 ? _b : subDays(toDate, 90);
        return prisma.evmSnapshot.findMany({
            where: {
                projectId,
                date: {
                    gte: startOfDay(fromDate),
                    lte: startOfDay(toDate),
                },
            },
            orderBy: { date: "asc" },
        });
    });
}
function buildProjectEvmSnapshot(project, tasks, referenceDate) {
    var _a, _b;
    const taskMetrics = tasks
        .filter((task) => { var _a; return ((_a = task.estimatedCost) !== null && _a !== void 0 ? _a : 0) > 0; })
        .map((task) => calculateTaskEVM(task, referenceDate));
    const summary = {
        taskCount: tasks.length,
        costedTaskCount: taskMetrics.length,
        taskBudgetCoverage: tasks.length > 0 ? Math.round((taskMetrics.length / tasks.length) * 1000) / 10 : 0,
    };
    if (taskMetrics.length === 0) {
        return {
            projectId: project.id,
            projectName: project.name,
            referenceDate: referenceDate.toISOString(),
            source: "project_budget",
            metrics: calculateEVM({
                id: project.id,
                name: project.name,
                budgetPlan: (_a = project.budgetPlan) !== null && _a !== void 0 ? _a : 0,
                budgetFact: (_b = project.budgetFact) !== null && _b !== void 0 ? _b : 0,
                progress: project.progress,
                start: project.start,
                end: project.end,
            }, referenceDate),
            summary,
            taskMetrics: [],
        };
    }
    return {
        projectId: project.id,
        projectName: project.name,
        referenceDate: referenceDate.toISOString(),
        source: "task_costs",
        metrics: calculateEVMFromValues({
            BAC: taskMetrics.reduce((sum, task) => sum + task.BAC, 0),
            PV: taskMetrics.reduce((sum, task) => sum + task.PV, 0),
            EV: taskMetrics.reduce((sum, task) => sum + task.EV, 0),
            AC: taskMetrics.reduce((sum, task) => sum + task.AC, 0),
        }),
        summary,
        taskMetrics: taskMetrics.sort((left, right) => right.CPI - left.CPI),
    };
}
