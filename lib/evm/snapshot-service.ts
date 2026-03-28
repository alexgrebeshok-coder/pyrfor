import { startOfDay, subDays } from "date-fns";

import { prisma } from "@/lib/prisma";

import { calculateEVM, calculateEVMFromValues, calculateTaskEVM } from "./calculator";
import type { EVMResult, TaskEVMResult } from "./types";

type ProjectRecord = {
  id: string;
  name: string;
  budgetPlan: number | null;
  budgetFact: number | null;
  progress: number;
  start: Date;
  end: Date;
};

type TaskRecord = {
  id: string;
  title: string;
  estimatedCost: number | null;
  actualCost: number | null;
  percentComplete: number;
  startDate: Date | null;
  dueDate: Date;
};

export interface ProjectEvmSnapshotPayload {
  projectId: string;
  projectName: string;
  referenceDate: string;
  source: "task_costs" | "project_budget";
  metrics: EVMResult;
  summary: {
    taskCount: number;
    costedTaskCount: number;
    taskBudgetCoverage: number;
  };
  taskMetrics: TaskEVMResult[];
}

export async function getProjectEvmSnapshot(
  projectId: string,
  referenceDate = new Date()
): Promise<ProjectEvmSnapshotPayload> {
  const [project, tasks] = await Promise.all([
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
}

export async function listWorkspaceEvmSnapshots(
  workspaceId: string,
  referenceDate = new Date()
) {
  const projects = await prisma.project.findMany({
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

  const snapshots = projects.map((project) =>
    buildProjectEvmSnapshot(project, project.tasks, referenceDate)
  );

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
}

export async function saveEvmSnapshot(projectId: string, snapshotDate = new Date()) {
  const payload = await getProjectEvmSnapshot(projectId, snapshotDate);
  const normalizedDate = startOfDay(snapshotDate);

  const snapshot = await prisma.evmSnapshot.upsert({
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

export async function getEvmHistory(
  projectId: string,
  options?: { fromDate?: Date; toDate?: Date }
) {
  const toDate = options?.toDate ?? new Date();
  const fromDate = options?.fromDate ?? subDays(toDate, 90);

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
}

function buildProjectEvmSnapshot(
  project: ProjectRecord,
  tasks: TaskRecord[],
  referenceDate: Date
): ProjectEvmSnapshotPayload {
  const taskMetrics = tasks
    .filter((task) => (task.estimatedCost ?? 0) > 0)
    .map((task) => calculateTaskEVM(task, referenceDate));

  const summary = {
    taskCount: tasks.length,
    costedTaskCount: taskMetrics.length,
    taskBudgetCoverage:
      tasks.length > 0 ? Math.round((taskMetrics.length / tasks.length) * 1000) / 10 : 0,
  };

  if (taskMetrics.length === 0) {
    return {
      projectId: project.id,
      projectName: project.name,
      referenceDate: referenceDate.toISOString(),
      source: "project_budget",
      metrics: calculateEVM(
        {
          id: project.id,
          name: project.name,
          budgetPlan: project.budgetPlan ?? 0,
          budgetFact: project.budgetFact ?? 0,
          progress: project.progress,
          start: project.start,
          end: project.end,
        },
        referenceDate
      ),
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
