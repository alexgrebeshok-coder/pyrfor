"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProjectEvmSnapshot = getProjectEvmSnapshot;
exports.listWorkspaceEvmSnapshots = listWorkspaceEvmSnapshots;
exports.saveEvmSnapshot = saveEvmSnapshot;
exports.getEvmHistory = getEvmHistory;
const date_fns_1 = require("date-fns");
const prisma_1 = require("../prisma");
const calculator_1 = require("./calculator");
async function getProjectEvmSnapshot(projectId, referenceDate = new Date()) {
    const [project, tasks] = await Promise.all([
        prisma_1.prisma.project.findUnique({
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
        prisma_1.prisma.task.findMany({
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
}
async function listWorkspaceEvmSnapshots(workspaceId, referenceDate = new Date()) {
    const projects = await prisma_1.prisma.project.findMany({
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
    const metrics = (0, calculator_1.calculateEVMFromValues)({
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
}
async function saveEvmSnapshot(projectId, snapshotDate = new Date()) {
    const payload = await getProjectEvmSnapshot(projectId, snapshotDate);
    const normalizedDate = (0, date_fns_1.startOfDay)(snapshotDate);
    const snapshot = await prisma_1.prisma.evmSnapshot.upsert({
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
}
async function getEvmHistory(projectId, options) {
    const toDate = options?.toDate ?? new Date();
    const fromDate = options?.fromDate ?? (0, date_fns_1.subDays)(toDate, 90);
    return prisma_1.prisma.evmSnapshot.findMany({
        where: {
            projectId,
            date: {
                gte: (0, date_fns_1.startOfDay)(fromDate),
                lte: (0, date_fns_1.startOfDay)(toDate),
            },
        },
        orderBy: { date: "asc" },
    });
}
function buildProjectEvmSnapshot(project, tasks, referenceDate) {
    const taskMetrics = tasks
        .filter((task) => (task.estimatedCost ?? 0) > 0)
        .map((task) => (0, calculator_1.calculateTaskEVM)(task, referenceDate));
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
            metrics: (0, calculator_1.calculateEVM)({
                id: project.id,
                name: project.name,
                budgetPlan: project.budgetPlan ?? 0,
                budgetFact: project.budgetFact ?? 0,
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
        metrics: (0, calculator_1.calculateEVMFromValues)({
            BAC: taskMetrics.reduce((sum, task) => sum + task.BAC, 0),
            PV: taskMetrics.reduce((sum, task) => sum + task.PV, 0),
            EV: taskMetrics.reduce((sum, task) => sum + task.EV, 0),
            AC: taskMetrics.reduce((sum, task) => sum + task.AC, 0),
        }),
        summary,
        taskMetrics: taskMetrics.sort((left, right) => right.CPI - left.CPI),
    };
}
