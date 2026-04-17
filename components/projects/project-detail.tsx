"use client";

import { Fragment, useMemo, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Copy,
  Download,
  Files,
  Link2,
  Package,
  ShieldAlert,
  Trash2,
  Truck,
  Wallet,
} from "lucide-react";
import {
  eachWeekOfInterval,
  endOfWeek,
  isAfter,
  isBefore,
  parseISO,
  startOfWeek,
} from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AIContextActions } from "@/components/ai/ai-context-actions";
import { useDashboard } from "@/components/dashboard-provider";
import type { ProjectGanttApiResponse } from "@/components/gantt/types";
import { ProjectFormModal } from "@/components/projects/project-form-modal";
import { TaskDependencyBadges } from "@/components/tasks/task-dependency-badges";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { TaskDependencyWorkspace } from "@/components/tasks/task-dependency-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientChart } from "@/components/ui/client-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/contexts/locale-context";
import type { ExpensesResponse } from "@/components/expenses/types";
import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";
import { useTasks } from "@/lib/hooks/use-api";
import { Milestone, Task, TaskStatus } from "@/lib/types";
import { AuditLogList } from "@/components/projects/audit-log-list";
import type { ContractView, EquipmentView, MaterialView } from "@/components/resources/types";
import {
  cn,
  formatCurrency,
  getRiskSeverity,
  priorityMeta,
  projectStatusMeta,
  riskStatusMeta,
  safePercent,
  taskStatusMeta,
} from "@/lib/utils";

const columnOrder: TaskStatus[] = ["todo", "in-progress", "blocked", "done"];

const nextStatus: Partial<Record<TaskStatus, TaskStatus>> = {
  todo: "in-progress",
  "in-progress": "done",
  blocked: "in-progress",
};

function getOverlapIndex(
  itemStart: Date,
  itemEnd: Date,
  boundaries: { start: Date; end: Date }[]
) {
  const startIndex = boundaries.findIndex(
    (boundary) => !isAfter(boundary.start, itemEnd) && !isBefore(boundary.end, itemStart)
  );

  if (startIndex === -1) return null;

  let endIndex = startIndex;
  for (let index = startIndex; index < boundaries.length; index += 1) {
    if (
      !isAfter(boundaries[index].start, itemEnd) &&
      !isBefore(boundaries[index].end, itemStart)
    ) {
      endIndex = index;
    }
  }

  return { startIndex, endIndex };
}

type GanttStatus = "completed" | "at-risk" | "planning" | "active";

interface ProjectEvmResponse {
  projectId: string;
  projectName: string;
  source: "task_costs" | "project_budget";
  metrics: {
    BAC: number;
    PV: number;
    EV: number;
    AC: number;
    CV: number;
    SV: number;
    CPI: number;
    SPI: number;
    EAC: number;
    ETC: number;
    VAC: number;
    TCPI: number | null;
    TCPI_EAC: number | null;
  };
  summary: {
    taskCount: number;
    costedTaskCount: number;
    taskBudgetCoverage: number;
  };
}

interface ProjectEvmHistoryResponse {
  projectId: string;
  snapshots: Array<{
    id: string;
    date: string;
    bac: number;
    pv: number;
    ev: number;
    ac: number;
    cpi: number | null;
    spi: number | null;
    eac: number | null;
    tcpi: number | null;
  }>;
}

const ganttFetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load Gantt data");
  }
  return response.json();
};

const projectDataFetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to load project detail tab data");
  }
  return response.json();
};

const normalizeGanttStatus = (status?: string): GanttStatus => {
  if (status === "done") {
    return "completed";
  }
  if (status === "blocked") {
    return "at-risk";
  }
  if (status === "todo") {
    return "planning";
  }
  return "active";
};

export function ProjectDetail({
  projectId,
  initialTasks = [],
  initialMilestones = [],
}: {
  projectId: string;
  initialTasks?: Task[];
  initialMilestones?: Milestone[];
}) {
  const router = useRouter();
  const { enumLabel, formatDateLocalized, locale, t } = useLocale();
  const { allowed: canManageTasks } = usePlatformPermission("MANAGE_TASKS");
  const {
    auditLogEntries,
    deleteProject,
    documents,
    duplicateProject,
    milestones,
    projects,
    risks,
    setProjectStatus,
    team,
    tasks: dashboardTasks,
    updateTaskStatus,
  } = useDashboard();
  const [editingOpen, setEditingOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const { tasks: apiTasks, mutate: mutateTasks } = useTasks();
  const [dependencyTaskId, setDependencyTaskId] = useState<string | null>(null);

  const project = projects.find((item) => item.id === projectId);
  const activeProjectId = project?.id ?? null;
  const projectIdForGantt = project?.id ?? null;
  const { data: ganttSnapshot, isLoading: ganttLoading } = useSWR<ProjectGanttApiResponse>(
    projectIdForGantt ? `/api/projects/${projectIdForGantt}/gantt` : null,
    ganttFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    }
  );
  const { data: projectExpenses } = useSWR<ExpensesResponse>(
    project?.id ? `/api/expenses?projectId=${project.id}` : null,
    projectDataFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const { data: projectContracts } = useSWR<{ contracts: ContractView[] }>(
    project?.id ? `/api/contracts?projectId=${project.id}` : null,
    projectDataFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const { data: projectEquipment } = useSWR<{ equipment: EquipmentView[] }>(
    project?.id ? `/api/equipment?projectId=${project.id}` : null,
    projectDataFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const { data: allMaterials } = useSWR<{ materials: MaterialView[] }>(
    project?.id ? "/api/materials" : null,
    projectDataFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const { data: projectEvm } = useSWR<ProjectEvmResponse>(
    project?.id ? `/api/evm?projectId=${project.id}` : null,
    projectDataFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const { data: projectEvmHistory } = useSWR<ProjectEvmHistoryResponse>(
    project?.id ? `/api/evm/history?projectId=${project.id}` : null,
    projectDataFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );

  const projectTasks = useMemo(() => {
    const mergedTasks = new Map<string, (typeof dashboardTasks)[number]>();

    for (const task of initialTasks) {
      mergedTasks.set(task.id, task);
    }

    for (const task of dashboardTasks) {
      mergedTasks.set(task.id, task);
    }

    for (const task of apiTasks) {
      mergedTasks.set(task.id, task);
    }

    return Array.from(mergedTasks.values()).filter((task) => task.projectId === projectId);
  }, [apiTasks, dashboardTasks, initialTasks, projectId]);
  const projectRisks = useMemo(
    () => risks.filter((risk) => risk.projectId === projectId),
    [projectId, risks]
  );
  const projectDocuments = useMemo(
    () => documents.filter((document) => document.projectId === projectId),
    [documents, projectId]
  );
  const projectMilestones = useMemo(
    () => {
      const mergedMilestones = new Map<string, Milestone>();

      for (const milestone of initialMilestones) {
        mergedMilestones.set(milestone.id, milestone);
      }

      for (const milestone of milestones) {
        mergedMilestones.set(milestone.id, milestone);
      }

      return Array.from(mergedMilestones.values()).filter(
        (milestone) => milestone.projectId === projectId
      );
    },
    [initialMilestones, milestones, projectId]
  );
  const projectTeam = useMemo(
    () => team.filter((member) => project?.team.includes(member.name)),
    [project?.team, team]
  );
  const dependencyTask = projectTasks.find((task) => task.id === dependencyTaskId) ?? null;

  const apiGanttItems = useMemo(
    () =>
      (ganttSnapshot?.tasks ?? []).map((task) => ({
        id: task.id,
        label: task.name,
        start: task.start,
        end: task.end,
        status: normalizeGanttStatus(task.type),
        meta: `${Math.round(task.progress ?? 0)}%`,
        kind: "task" as const,
      })) ?? [],
    [ganttSnapshot]
  );

  const fallbackGanttItems = useMemo(
    () => [
      ...projectMilestones.map((milestone) => ({
        id: milestone.id,
        label: milestone.name,
        start: milestone.start,
        end: milestone.end,
        status: milestone.status,
        meta: `${milestone.progress}%`,
        kind: "milestone" as const,
      })),
      ...projectTasks.map((task) => ({
        id: task.id,
        label: task.title,
        start: task.createdAt,
        end: task.dueDate,
        status:
          task.status === "done"
            ? ("completed" as const)
            : task.status === "blocked"
              ? ("at-risk" as const)
              : task.status === "todo"
                ? ("planning" as const)
                : ("active" as const),
        meta: enumLabel("taskStatus", task.status),
        kind: "task" as const,
      })),
    ],
    [enumLabel, projectMilestones, projectTasks]
  );

  const ganttItems = apiGanttItems.length ? apiGanttItems : fallbackGanttItems;

  const ganttBounds = useMemo(() => {
    const fallbackStart = project?.dates?.start
      ? parseISO(project.dates.start)
      : new Date();
    const fallbackEnd = project?.dates?.end ? parseISO(project.dates.end) : new Date();

    if (!ganttItems.length) {
      return {
        start: startOfWeek(fallbackStart, { weekStartsOn: 1 }),
        end: endOfWeek(fallbackEnd, { weekStartsOn: 1 }),
      };
    }

    const minStart = ganttItems.reduce((min, item) => {
      const date = parseISO(item.start);
      return isBefore(date, min) ? date : min;
    }, fallbackStart);
    const maxEnd = ganttItems.reduce((max, item) => {
      const date = parseISO(item.end);
      return isAfter(date, max) ? date : max;
    }, fallbackEnd);

    return {
      start: startOfWeek(minStart, { weekStartsOn: 1 }),
      end: endOfWeek(maxEnd, { weekStartsOn: 1 }),
    };
  }, [ganttItems, project?.dates?.start, project?.dates?.end]);

  const timelineColumns = useMemo(
    () =>
      eachWeekOfInterval(
        { start: ganttBounds.start, end: ganttBounds.end },
        { weekStartsOn: 1 }
      ),
    [ganttBounds]
  );

  const boundaries = useMemo(
    () =>
      timelineColumns.map((column) => ({
        start: startOfWeek(column, { weekStartsOn: 1 }),
        end: endOfWeek(column, { weekStartsOn: 1 }),
      })),
    [timelineColumns]
  );

  if (!project) {
    return (
      <Card>
        <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-10 text-center">
          <h2 className="font-heading text-xl font-semibold tracking-[-0.06em] text-[var(--ink)]">
            {t("project.notFound")}
          </h2>
          <p className="max-w-md text-sm text-[var(--ink-soft)]">
            {t("project.notFoundDescription")}
          </p>
          <Button onClick={() => router.push("/projects")}>{t("nav.projects")}</Button>
        </CardContent>
      </Card>
    );
  }

  const healthTone =
    project.health >= 75 ? "success" : project.health >= 60 ? "warning" : "danger";

  const budgetSeries = project.history.map((point) => ({
    name: formatDateLocalized(point.date),
    progress: point.progress,
    planned: Math.round(point.budgetPlanned / 1000),
    actual: Math.round(point.budgetActual / 1000),
  }));

  const resourceSeries = projectTeam.map((member) => ({
    name: member.name,
    capacity: member.capacity,
    allocated: member.allocated,
  }));
  const financeSummary = projectExpenses?.summary;
  const contractItems = projectContracts?.contracts ?? [];
  const equipmentItems = projectEquipment?.equipment ?? [];
  const materialItems = activeProjectId
    ? (allMaterials?.materials ?? []).filter((material) =>
        material.movements.some((movement) => movement.project.id === activeProjectId)
      )
    : [];
  const lowStockProjectMaterials = materialItems.filter(
    (material) => material.currentStock <= material.minStock
  );
  const financeCategorySeries =
    financeSummary?.byCategory.slice(0, 6).map((entry) => ({
      name: entry.name,
      amount: Math.round(entry.amount),
    })) ?? [];
  const evmSeries =
    projectEvmHistory?.snapshots.map((snapshot) => ({
      label: formatDateLocalized(snapshot.date, "d MMM"),
      PV: snapshot.pv,
      EV: snapshot.ev,
      AC: snapshot.ac,
    })) ?? [];
  const overdueContracts = contractItems.filter((contract) => {
    const endDate = new Date(contract.endDate).getTime();
    return Number.isFinite(endDate) && endDate < Date.now() && contract.paidAmount < contract.amount;
  });
  const resourceUtilization = projectTeam.length
    ? Math.round(projectTeam.reduce((sum, member) => sum + member.allocated, 0) / projectTeam.length)
    : 0;

  const handleDelete = () => {
    if (!canManageTasks) {
      return;
    }

    if (window.confirm(t("project.deleteConfirm", { name: project.name }))) {
      deleteProject(project.id);
      router.push("/projects");
    }
  };

  return (
    <>
      <div className="grid gap-4">
        <section className="grid gap-4 grid-cols-1 xl:grid-cols-[1.15fr_.85fr]">
          <Card className="overflow-hidden">
            <CardContent className="grid gap-6 p-4 md:p-6 grid-cols-1 lg:grid-cols-[1.1fr_.9fr]">
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={cn("ring-1", projectStatusMeta[project.status].className)}>
                      {enumLabel("projectStatus", project.status)}
                    </Badge>
                    <Badge variant="neutral">
                      {project.location}
                    </Badge>
                  </div>
                  <h2 className="font-heading text-xl font-semibold tracking-[-0.06em] text-[var(--ink)] sm:text-4xl">
                    {project.name}
                  </h2>
                  <p className="max-w-2xl text-sm leading-7 text-[var(--ink-soft)] sm:text-base">
                    {project.description}
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button disabled={!canManageTasks} onClick={() => setEditingOpen(true)} variant="secondary">
                    {t("action.edit")}
                  </Button>
                  <Button
                    disabled={!canManageTasks}
                    onClick={() => duplicateProject(project.id)}
                    variant="outline"
                  >
                    <Copy className="h-4 w-4" />
                    {t("action.duplicate")}
                  </Button>
                  <Button
                    onClick={async () => {
                      const { downloadProjectPdf } = await import("@/lib/export");
                      downloadProjectPdf(project, projectTasks, projectRisks);
                    }}
                    variant="outline"
                  >
                    <Download className="h-4 w-4" />
                    {t("action.exportPdf")}
                  </Button>
                  <Button
                    onClick={async () => {
                      const { downloadTasksCsv } = await import("@/lib/export");
                      downloadTasksCsv(projectTasks);
                    }}
                    variant="outline"
                  >
                    {t("action.exportExcel")}
                  </Button>
                  <Button
                    data-testid="create-task-button"
                    disabled={!canManageTasks}
                    onClick={() => setTaskModalOpen(true)}
                    variant="outline"
                  >
                    {t("action.addTask")}
                  </Button>
                  <Button disabled={!canManageTasks} onClick={handleDelete} variant="danger">
                    <Trash2 className="h-4 w-4" />
                    {t("action.delete")}
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-[8px] border border-[var(--line)] bg-[var(--panel-soft)] p-5">
                  <p className="text-sm text-[var(--ink-soft)]">{t("project.budgetBurn")}</p>
                  <p className="mt-3 font-heading text-5xl font-semibold tracking-[-0.08em]">
                    {Math.round((project.budget.actual / project.budget.planned) * 100)}%
                  </p>
                  <p className="mt-2 text-sm text-[var(--ink-soft)]">
                    {formatCurrency(project.budget.actual, project.budget.currency)} /{" "}
                    {formatCurrency(project.budget.planned, project.budget.currency)}
                  </p>
                </div>
                <div className="rounded-[8px] border border-[var(--line)] bg-[var(--panel-soft)] p-5">
                  <p className="text-sm text-[var(--ink-soft)]">{t("project.decisionControls")}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      onClick={() => setProjectStatus(project.id, "active")}
                      size="sm"
                      variant="secondary"
                    >
                      {enumLabel("projectStatus", "active")}
                    </Button>
                    <Button
                      onClick={() => setProjectStatus(project.id, "on-hold")}
                      size="sm"
                      variant="secondary"
                    >
                      {enumLabel("projectStatus", "on-hold")}
                    </Button>
                    <Button
                      onClick={() => setProjectStatus(project.id, "at-risk")}
                      size="sm"
                      variant="secondary"
                    >
                      {enumLabel("projectStatus", "at-risk")}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 grid-cols-1 xl:grid-cols-1">
            <Card>
              <CardHeader>
                <CardTitle>{t("project.keyMetrics")}</CardTitle>
                <CardDescription>{t("project.keyMetricsDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-[8px] bg-[var(--panel-soft)] p-4">
                  <p className="text-sm text-[var(--ink-muted)]">{t("project.progress")}</p>
                  <p className="mt-2 font-heading text-xl md:text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    {project.progress}%
                  </p>
                  <div className="mt-3">
                    <Progress value={project.progress} />
                  </div>
                </div>
                <div className="rounded-[8px] bg-[var(--panel-soft)] p-4">
                  <p className="text-sm text-[var(--ink-muted)]">{t("project.health")}</p>
                  <p className="mt-2 font-heading text-xl md:text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                    {project.health}%
                  </p>
                  <Badge className="mt-3" variant={healthTone}>
                    {project.health >= 75
                      ? enumLabel("severity", "info")
                      : project.health >= 60
                        ? enumLabel("severity", "warning")
                        : enumLabel("severity", "critical")}
                  </Badge>
                </div>
                <div className="rounded-[8px] bg-[var(--panel-soft)] p-4">
                  <p className="text-sm text-[var(--ink-muted)]">{t("project.safetyKpi")}</p>
                  <p className="mt-2 font-heading text-xl font-semibold tracking-[-0.06em] text-[var(--ink)]">
                    LTIFR {project.safety.ltifr}
                  </p>
                  <p className="text-sm text-[var(--ink-soft)]">TRIR {project.safety.trir}</p>
                </div>
                <div className="rounded-[8px] bg-[var(--panel-soft)] p-4">
                  <p className="text-sm text-[var(--ink-muted)]">{t("project.nextMilestone")}</p>
                  <p className="mt-2 font-medium text-[var(--ink)]">
                    {project.nextMilestone?.name ?? t("project.none")}
                  </p>
                  <p className="text-sm text-[var(--ink-soft)]">
                    {project.nextMilestone
                      ? formatDateLocalized(project.nextMilestone.date, "d MMM yyyy")
                      : "—"}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("project.summary")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {project.objectives.map((objective) => (
                  <div
                    key={objective}
                    className="flex items-start gap-3 rounded-[22px] border border-[var(--line)] bg-[var(--panel-soft)]/70 px-4 py-3"
                  >
                    <ArrowRight className="mt-0.5 h-4 w-4 text-[var(--brand)]" />
                    <span className="text-sm leading-6 text-[var(--ink-soft)]">{objective}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <AIContextActions />

        <Tabs defaultValue="overview">
          <TabsList className="w-full overflow-x-auto flex-nowrap justify-start sm:justify-center">
            <TabsTrigger value="overview">{t("project.overview")}</TabsTrigger>
            <TabsTrigger value="tasks">{t("project.tasks")}</TabsTrigger>
            <TabsTrigger value="charts">{t("project.charts")}</TabsTrigger>
            <TabsTrigger value="finance">Finance</TabsTrigger>
            <TabsTrigger value="resources">Resources</TabsTrigger>
            <TabsTrigger value="documents">{t("project.documents")}</TabsTrigger>
            <TabsTrigger value="team">{t("project.team")}</TabsTrigger>
            <TabsTrigger value="risks">{t("project.risks")}</TabsTrigger>
            <TabsTrigger value="gantt" className="hidden sm:flex">{t("project.gantt")}</TabsTrigger>
            <TabsTrigger value="history">{t("project.history")}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              <Card>
                <CardHeader>
                  <CardTitle>{t("project.milestones")}</CardTitle>
                  <CardDescription>{t("project.milestonesDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {projectMilestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className="rounded-[24px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-[var(--ink)]">{milestone.name}</p>
                          <p className="text-sm text-[var(--ink-soft)]">
                            {formatDateLocalized(milestone.start, "d MMM")} →{" "}
                            {formatDateLocalized(milestone.end, "d MMM yyyy")}
                          </p>
                        </div>
                        <Badge className={cn("ring-1", projectStatusMeta[milestone.status].className)}>
                          {enumLabel("projectStatus", milestone.status)}
                        </Badge>
                      </div>
                      <div className="mt-4">
                        <Progress value={milestone.progress} />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("project.topRisks")}</CardTitle>
                  <CardDescription>{t("project.topRisksDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {projectRisks.slice(0, 3).map((risk) => (
                    <div
                      key={risk.id}
                      className="rounded-[24px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-[var(--ink)]">{risk.title}</p>
                          <p className="mt-1 text-sm text-[var(--ink-soft)]">{risk.mitigation}</p>
                        </div>
                        <Badge
                          variant={
                            getRiskSeverity(risk.probability, risk.impact) === "critical"
                              ? "danger"
                              : "warning"
                          }
                        >
                          {risk.probability}×{risk.impact}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="tasks">
            <Card className="mb-4">
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="font-medium text-[var(--ink)]">{t("project.tasks")}</p>
                  <p className="text-sm text-[var(--ink-soft)]">{t("project.taskBoardDescription")}</p>
                </div>
                <Button
                  data-testid="create-task-button"
                  disabled={!canManageTasks}
                  onClick={() => setTaskModalOpen(true)}
                >
                  {t("action.addTask")}
                </Button>
              </CardContent>
            </Card>
            {dependencyTask ? (
              <div className="mb-4">
                <TaskDependencyWorkspace
                  onClose={() => setDependencyTaskId(null)}
                  onDependenciesUpdated={async () => {
                    await mutateTasks();
                  }}
                  projectName={project.name}
                  readOnly={!canManageTasks}
                  task={dependencyTask}
                />
              </div>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-4">
              {columnOrder.map((status) => (
                <Card key={status} className="bg-[var(--panel-soft)]/55">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle>{enumLabel("taskStatus", status)}</CardTitle>
                      <Badge className={cn("ring-1", taskStatusMeta[status].className)}>
                        {projectTasks.filter((task) => task.status === status).length}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {projectTasks
                      .filter((task) => task.status === status)
                      .map((task) => (
                        <div
                          key={task.id}
                          className="rounded-[22px] border border-[var(--line)] bg-[color:var(--surface-panel-strong)] p-4 shadow-[0_10px_28px_rgba(15,23,42,.06)]"
                          data-testid="project-task-card"
                          data-task-id={task.id}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-[var(--ink)]">{task.title}</p>
                              <p className="mt-1 text-sm text-[var(--ink-soft)]">{task.description}</p>
                            </div>
                            <Badge className={cn("ring-1", priorityMeta[task.priority].className)}>
                              {enumLabel("priority", task.priority)}
                            </Badge>
                          </div>
                          <div className="mt-4 text-sm text-[var(--ink-soft)]">
                            <div>{task.assignee?.name || "-"}</div>
                            <div>
                              {t("tasks.dueDate")}{" "}
                              {formatDateLocalized(task.dueDate, "d MMM yyyy")}
                            </div>
                          </div>
                          <TaskDependencyBadges task={task} />
                          <Button
                            className="mt-3 w-full"
                            size="sm"
                            variant={dependencyTaskId === task.id ? "secondary" : "outline"}
                            onClick={() =>
                              setDependencyTaskId((current) => (current === task.id ? null : task.id))
                            }
                          >
                            <Link2 className="h-4 w-4" />
                            {locale === "ru"
                              ? "Зависимости"
                              : locale === "zh"
                                ? "依赖关系"
                                : "Dependencies"}
                          </Button>
                          {nextStatus[task.status] ? (
                          <Button
                            className="mt-4 w-full"
                            disabled={!canManageTasks}
                            size="sm"
                            variant="secondary"
                            data-testid="project-task-status-button"
                              data-task-id={task.id}
                              onClick={() =>
                                updateTaskStatus([task.id], nextStatus[task.status] as TaskStatus)
                              }
                            >
                              {t("action.updateStatus")}{" "}
                              {enumLabel(
                                "taskStatus",
                                nextStatus[task.status] as TaskStatus
                              )}
                            </Button>
                          ) : null}
                        </div>
                      ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="charts">
            <div className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>{t("project.progressTimeline")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ClientChart className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={budgetSeries}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} />
                        <Tooltip />
                        <Line
                          dataKey="progress"
                          stroke="var(--brand)"
                          strokeWidth={3}
                          dot={{ r: 3 }}
                          type="monotone"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </ClientChart>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("project.budgetCurve")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ClientChart className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={budgetSeries}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="planned" fill="#cbd5e1" radius={[10, 10, 0, 0]} />
                        <Bar dataKey="actual" fill="var(--brand)" radius={[10, 10, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ClientChart>
                </CardContent>
              </Card>

              <Card className="xl:col-span-2">
                <CardHeader>
                  <CardTitle>{t("project.resourceLoad")}</CardTitle>
                  <CardDescription>{t("project.resourceLoadDescription")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ClientChart className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={resourceSeries} layout="vertical" margin={{ left: 24 }}>
                        <XAxis type="number" tickLine={false} axisLine={false} />
                        <YAxis
                          dataKey="name"
                          type="category"
                          tickLine={false}
                          axisLine={false}
                          width={120}
                        />
                        <Tooltip />
                        <Bar dataKey="capacity" fill="#e2e8f0" radius={[10, 10, 10, 10]} />
                        <Bar dataKey="allocated" fill="#0f172a" radius={[10, 10, 10, 10]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ClientChart>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="finance">
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-[var(--ink-muted)]">BAC / AC</p>
                    <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                      {projectEvm ? formatCurrency(projectEvm.metrics.BAC, project.budget.currency) : "—"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      Факт: {projectEvm ? formatCurrency(projectEvm.metrics.AC, project.budget.currency) : "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                      <Wallet className="h-4 w-4" />
                      CPI / SPI
                    </p>
                    <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                      {projectEvm ? `${projectEvm.metrics.CPI.toFixed(2)} / ${projectEvm.metrics.SPI.toFixed(2)}` : "—"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      TCPI {projectEvm?.metrics.TCPI?.toFixed(2) ?? "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-[var(--ink-muted)]">Expenses</p>
                    <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                      {financeSummary ? formatCurrency(financeSummary.total, project.budget.currency) : "—"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      Pending: {financeSummary ? formatCurrency(financeSummary.pending, project.budget.currency) : "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-[var(--ink-muted)]">Contracts at risk</p>
                    <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                      {overdueContracts.length}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      Открытых контрактов: {contractItems.length}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>EVM S-curve</CardTitle>
                    <CardDescription>
                      {projectEvm?.source === "task_costs"
                        ? "Собрана по costed tasks"
                        : "Собрана по бюджету проекта"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {evmSeries.length ? (
                      <ClientChart className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={evmSeries}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="label" tickLine={false} axisLine={false} />
                            <YAxis tickLine={false} axisLine={false} />
                            <Tooltip />
                            <Legend />
                            <Line dataKey="PV" stroke="#0ea5e9" strokeWidth={2} type="monotone" />
                            <Line dataKey="EV" stroke="#10b981" strokeWidth={2} type="monotone" />
                            <Line dataKey="AC" stroke="#f97316" strokeWidth={2} type="monotone" />
                          </LineChart>
                        </ResponsiveContainer>
                      </ClientChart>
                    ) : (
                      <div className="rounded-[20px] border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-soft)]">
                        История snapshots ещё не накоплена. Текущий EAC:{" "}
                        {projectEvm ? formatCurrency(projectEvm.metrics.EAC, project.budget.currency) : "—"}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Expense mix</CardTitle>
                    <CardDescription>Топ-категории расходов по проекту</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {financeCategorySeries.length ? (
                      <>
                        <ClientChart className="h-[240px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={financeCategorySeries} layout="vertical" margin={{ left: 20 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                              <XAxis type="number" tickLine={false} axisLine={false} />
                              <YAxis
                                dataKey="name"
                                type="category"
                                tickLine={false}
                                axisLine={false}
                                width={120}
                              />
                              <Tooltip />
                              <Bar dataKey="amount" fill="var(--brand)" radius={[10, 10, 10, 10]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </ClientChart>
                        <div className="grid gap-2">
                          {financeSummary?.byCategory.slice(0, 4).map((entry) => (
                            <div
                              key={entry.categoryId}
                              className="flex items-center justify-between rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)]/60 px-4 py-3"
                            >
                              <span className="text-sm text-[var(--ink)]">{entry.name}</span>
                              <span className="text-sm font-medium text-[var(--ink)]">
                                {formatCurrency(entry.amount, project.budget.currency)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="rounded-[20px] border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-soft)]">
                        По проекту пока нет расходов с категоризацией.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Contract register</CardTitle>
                  <CardDescription>Статус обязательств и оплат по проекту</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {contractItems.length ? (
                    contractItems.map((contract) => {
                      const usage = safePercent(contract.paidAmount, contract.amount);
                      return (
                        <div
                          key={contract.id}
                          className="rounded-[22px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-medium text-[var(--ink)]">
                                {contract.number} · {contract.title}
                              </p>
                              <p className="text-sm text-[var(--ink-soft)]">
                                {contract.supplier.name} · {formatDateLocalized(contract.endDate, "d MMM yyyy")}
                              </p>
                            </div>
                            <Badge
                              variant={
                                usage >= 100
                                  ? "success"
                                  : new Date(contract.endDate).getTime() < Date.now()
                                    ? "danger"
                                    : "warning"
                              }
                            >
                              {contract.status}
                            </Badge>
                          </div>
                          <div className="mt-4">
                            <Progress value={Math.min(usage, 100)} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--ink-soft)]">
                            <span>{formatCurrency(contract.paidAmount, contract.currency)} оплачено</span>
                            <span>{formatCurrency(contract.amount, contract.currency)} всего</span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-[20px] border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-soft)]">
                      Для проекта пока нет зарегистрированных контрактов.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="resources">
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-[var(--ink-muted)]">Team assigned</p>
                    <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                      {projectTeam.length}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      Avg load {resourceUtilization}%
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                      <Truck className="h-4 w-4" />
                      Equipment assigned
                    </p>
                    <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                      {equipmentItems.length}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      Активных назначений: {equipmentItems.reduce((sum, item) => sum + item.assignments.length, 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                      <Package className="h-4 w-4" />
                      Materials in use
                    </p>
                    <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                      {materialItems.length}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      Low stock: {lowStockProjectMaterials.length}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                      <AlertTriangle className="h-4 w-4" />
                      Overallocated
                    </p>
                    <p className="mt-2 font-heading text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                      {projectTeam.filter((member) => member.allocated > member.capacity).length}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      Требуют resource leveling
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>People load</CardTitle>
                    <CardDescription>Загрузка участников проекта</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ClientChart className="h-[320px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={resourceSeries} layout="vertical" margin={{ left: 24 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tickLine={false} axisLine={false} />
                          <YAxis
                            dataKey="name"
                            type="category"
                            tickLine={false}
                            axisLine={false}
                            width={120}
                          />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="capacity" fill="#e2e8f0" radius={[10, 10, 10, 10]} />
                          <Bar dataKey="allocated" fill="#0f172a" radius={[10, 10, 10, 10]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </ClientChart>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Field resource watchlist</CardTitle>
                    <CardDescription>Техника и материалы с самым высоким риском</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {equipmentItems.slice(0, 3).map((item) => (
                      <div
                        key={item.id}
                        className="rounded-[20px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-[var(--ink)]">{item.name}</p>
                            <p className="text-sm text-[var(--ink-soft)]">{item.type}</p>
                          </div>
                          <Badge variant={item.status === "available" ? "success" : "warning"}>
                            {item.status}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm text-[var(--ink-soft)]">
                          {item.location ?? "Локация не указана"} ·{" "}
                          {item.dailyRate
                            ? formatCurrency(item.dailyRate, project.budget.currency)
                            : item.hourlyRate
                              ? formatCurrency(item.hourlyRate, project.budget.currency)
                              : "Без ставки"}
                        </p>
                      </div>
                    ))}
                    {lowStockProjectMaterials.slice(0, 3).map((material) => (
                      <div
                        key={material.id}
                        className="rounded-[20px] border border-amber-200 bg-amber-50 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-[var(--ink)]">{material.name}</p>
                            <p className="text-sm text-[var(--ink-soft)]">{material.category}</p>
                          </div>
                          <Badge variant="warning">
                            {material.currentStock}/{material.minStock} {material.unit}
                          </Badge>
                        </div>
                      </div>
                    ))}
                    {!equipmentItems.length && !lowStockProjectMaterials.length ? (
                      <div className="rounded-[20px] border border-dashed border-[var(--line)] p-6 text-sm text-[var(--ink-soft)]">
                        По проекту пока нет техники или материалов с риск-сигналами.
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <CardTitle>{t("project.documents")}</CardTitle>
                <CardDescription>{t("dashboard.documents")}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {projectDocuments.map((document) => (
                  <div
                    key={document.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-[var(--brand)]">
                        <Files className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-medium text-[var(--ink)]">{document.title}</p>
                        <p className="text-sm text-[var(--ink-soft)]">
                          {document.type} • {document.size} • {document.owner}
                        </p>
                      </div>
                    </div>
                    <Badge variant="info">
                      {formatDateLocalized(document.updatedAt, "d MMM yyyy")}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="team">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {projectTeam.map((member) => (
                <Card key={member.id}>
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-heading text-xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                          {member.name}
                        </p>
                        <p className="text-sm text-[var(--ink-soft)]">{member.role}</p>
                      </div>
                      <Badge
                        variant={
                          member.allocated >= 85
                            ? "danger"
                            : member.allocated >= 70
                              ? "warning"
                              : "success"
                        }
                      >
                        {member.allocated}%
                      </Badge>
                    </div>
                    <Progress value={member.allocated} />
                    <div className="space-y-1 text-sm text-[var(--ink-soft)]">
                      <p>{member.location}</p>
                      <p>{member.email}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="risks">
            <div className="grid gap-4 xl:grid-cols-[1fr_.9fr]">
              <Card>
                <CardHeader>
                  <CardTitle>{t("project.riskMatrix")}</CardTitle>
                  <CardDescription>{t("project.riskMatrixDescription")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Array.from({ length: 5 }, (_, rowIndex) => 5 - rowIndex).map((probability) => (
                    <div key={probability} className="grid grid-cols-[80px_repeat(5,minmax(0,1fr))] gap-2">
                      <div className="flex items-center text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                        P{probability}
                      </div>
                      {Array.from({ length: 5 }, (_, columnIndex) => columnIndex + 1).map((impact) => {
                        const cellRisks = projectRisks.filter(
                          (risk) => risk.probability === probability && risk.impact === impact
                        );
                        const danger = probability * impact >= 16;
                        const warning = probability * impact >= 9;
                        return (
                          <div
                            key={`${probability}-${impact}`}
                            className={cn(
                              "group relative min-h-[96px] rounded-[18px] border p-3 transition-all hover:scale-[1.02] hover:shadow-md",
                              danger
                                ? "border-rose-200 bg-rose-50"
                                : warning
                                  ? "border-amber-200 bg-amber-50"
                                  : "border-slate-200 bg-slate-50"
                            )}
                          >
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                              I{impact}
                            </div>
                            <div className="mt-2 grid gap-2">
                              {cellRisks.slice(0, 2).map((risk) => (
                                <div
                                  key={risk.id}
                                  className="truncate rounded-xl bg-white/80 px-2 py-1.5 text-xs font-medium text-[var(--ink)]"
                                  title={risk.title}
                                >
                                  {risk.title}
                                </div>
                              ))}
                              {cellRisks.length > 2 && (
                                <div className="rounded-xl bg-white/60 px-2 py-1 text-xs text-[var(--ink-muted)]">
                                  +{cellRisks.length - 2} more
                                </div>
                              )}
                            </div>
                            {/* Hover tooltip for all risks */}
                            {cellRisks.length > 0 && (
                              <div className="absolute left-0 top-full z-10 mt-2 hidden w-48 rounded-lg border border-[var(--line)] bg-[var(--surface-panel)] p-3 shadow-lg group-hover:block">
                                <div className="text-xs font-semibold text-[var(--ink)] mb-2">
                                  {cellRisks.length} risk{cellRisks.length > 1 ? 's' : ''} in this cell
                                </div>
                                {cellRisks.map((risk) => (
                                  <div key={risk.id} className="text-xs text-[var(--ink-soft)] py-1">
                                    • {risk.title}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("project.riskRegister")}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {projectRisks.map((risk) => (
                    <div
                      key={risk.id}
                      className="rounded-[24px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-[var(--ink)]">{risk.title}</p>
                          <p className="mt-1 text-sm text-[var(--ink-soft)]">{risk.mitigation}</p>
                        </div>
                        <Badge className={cn("ring-1", riskStatusMeta[risk.status].className)}>
                          {enumLabel("riskStatus", risk.status)}
                        </Badge>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--ink-soft)]">
                        <span className="flex items-center gap-1">
                          <ShieldAlert className="h-4 w-4 text-[var(--ink-muted)]" />
                          {risk.owner}
                        </span>
                        <span className="flex items-center gap-1">
                          <BarChart3 className="h-4 w-4 text-[var(--ink-muted)]" />
                          {risk.probability} × {risk.impact}
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="h-4 w-4 text-[var(--ink-muted)]" />
                          {risk.category}
                        </span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="gantt" className="hidden sm:block">
            <Card>
              <CardHeader>
                <CardTitle>{t("project.gantt")}</CardTitle>
                <CardDescription>{t("gantt.description")}</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {ganttLoading ? (
                  <div className="min-h-[260px] flex items-center justify-center">
                    <p className="text-sm text-[var(--ink-muted)]">Загрузка диаграммы Ганта…</p>
                  </div>
                ) : !ganttItems.length ? (
                  <div className="min-h-[260px] flex items-center justify-center">
                    <p className="text-sm text-[var(--ink-muted)]">Нет задач для диаграммы Ганта.</p>
                  </div>
                ) : (
                  <div
                    className="min-w-[1080px]"
                    style={{
                      display: "grid",
                      gridTemplateColumns: `280px repeat(${timelineColumns.length}, minmax(96px, 1fr))`,
                    }}
                  >
                    <div className="sticky left-0 z-10 border-b border-r border-[var(--line)] bg-[color:var(--surface-panel)] p-4 font-semibold text-[var(--ink)]">
                      {t("gantt.item")}
                    </div>
                    {timelineColumns.map((column) => (
                      <div
                        key={column.toISOString()}
                        className="border-b border-r border-[var(--line)] bg-[var(--panel-soft)]/70 px-2 py-4 text-center text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]"
                      >
                        {formatDateLocalized(column.toISOString(), "d MMM")}
                      </div>
                    ))}

                    {ganttItems.map((item) => {
                      const overlap = getOverlapIndex(
                        parseISO(item.start),
                        parseISO(item.end),
                        boundaries
                      );

                      return (
                        <Fragment key={item.id}>
                          <div
                            className="sticky left-0 z-10 border-b border-r border-[var(--line)] bg-[color:var(--surface-panel)] p-4"
                            data-item-id={item.id}
                            data-task-id={item.kind === "task" ? item.id : undefined}
                            data-testid={
                              item.kind === "task" ? "gantt-task-item" : "gantt-project-item"
                            }
                          >
                            <div className="font-medium text-[var(--ink)]">{item.label}</div>
                            <div className="text-sm text-[var(--ink-soft)]">{item.meta}</div>
                          </div>
                          <div
                            className="relative col-span-full border-b border-[var(--line)]"
                            style={{ gridColumn: `2 / span ${timelineColumns.length}` }}
                          >
                            <div
                              className="absolute inset-0 grid"
                              style={{
                                gridTemplateColumns: `repeat(${timelineColumns.length}, minmax(96px, 1fr))`,
                              }}
                            >
                              {timelineColumns.map((column) => (
                                <div
                                  key={`${item.id}-${column.toISOString()}`}
                                  className="border-r border-[var(--line)]/80"
                                />
                              ))}
                            </div>
                            {overlap ? (
                              <div
                                className="relative grid h-[72px]"
                                style={{
                                  gridTemplateColumns: `repeat(${timelineColumns.length}, minmax(96px, 1fr))`,
                                }}
                              >
                                <div
                                  className="z-[1] m-3 flex items-center rounded-[10px] px-4 text-sm font-semibold text-white"
                                  style={{
                                    gridColumn: `${overlap.startIndex + 1} / ${overlap.endIndex + 2}`,
                                    background:
                                      item.status === "at-risk"
                                        ? "linear-gradient(135deg,#fb7185 0%,#f97316 100%)"
                                        : item.status === "completed"
                                          ? "linear-gradient(135deg,#10b981 0%,#0f766e 100%)"
                                          : "linear-gradient(135deg,#3b82f6 0%,#2563eb 100%)",
                                  }}
                                >
                                  {enumLabel("projectStatus", item.status)}
                                </div>
                              </div>
                            ) : (
                              <div className="h-[72px]" />
                            )}
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>{t("project.history")}</CardTitle>
                <CardDescription>{t("project.historyDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <AuditLogList projectId={project.id} entries={auditLogEntries} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <ProjectFormModal
        open={canManageTasks && editingOpen}
        onOpenChange={setEditingOpen}
        project={project}
      />
      <TaskFormModal
        open={canManageTasks && taskModalOpen}
        onOpenChange={setTaskModalOpen}
        projectId={project.id}
      />
    </>
  );
}
