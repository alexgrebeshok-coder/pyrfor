"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Files } from "lucide-react";

import { AIContextActions } from "@/components/ai/ai-context-actions";
import { useDashboard } from "@/components/dashboard-provider";
import type { ProjectGanttApiResponse } from "@/components/gantt/types";
import { ProjectFormModal } from "@/components/projects/project-form-modal";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { Milestone, Task } from "@/lib/types";
import { AuditLogList } from "@/components/projects/audit-log-list";
import { ProjectChartsTab } from "@/components/projects/project-charts-tab";
import { ProjectDetailHeader } from "@/components/projects/project-detail-header";
import { ProjectFinanceTab } from "@/components/projects/project-finance-tab";
import { ProjectGanttTab } from "@/components/projects/project-gantt-tab";
import { ProjectOverviewTab } from "@/components/projects/project-overview-tab";
import { ProjectResourcesTab } from "@/components/projects/project-resources-tab";
import { ProjectRisksTab } from "@/components/projects/project-risks-tab";
import { ProjectTasksTab } from "@/components/projects/project-tasks-tab";
import type { ContractView, EquipmentView, MaterialView } from "@/components/resources/types";
import { formatCurrency } from "@/lib/utils";

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
  const { formatDateLocalized, t } = useLocale();
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
        <ProjectDetailHeader
          project={project}
          canManageTasks={canManageTasks}
          projectTasks={projectTasks}
          projectRisks={projectRisks}
          onEdit={() => setEditingOpen(true)}
          onDuplicate={() => duplicateProject(project.id)}
          onDelete={handleDelete}
          onAddTask={() => setTaskModalOpen(true)}
          onSetStatus={setProjectStatus}
        />

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
            <ProjectOverviewTab
              projectMilestones={projectMilestones}
              projectRisks={projectRisks}
            />
          </TabsContent>

          <TabsContent value="tasks">
            <ProjectTasksTab
              projectTasks={projectTasks}
              canManageTasks={canManageTasks}
              dependencyTaskId={dependencyTaskId}
              setDependencyTaskId={setDependencyTaskId}
              dependencyTask={dependencyTask}
              projectName={project.name}
              mutateTasks={mutateTasks}
              onAddTask={() => setTaskModalOpen(true)}
              updateTaskStatus={updateTaskStatus}
            />
          </TabsContent>

          <TabsContent value="charts">
            <ProjectChartsTab
              budgetSeries={budgetSeries}
              resourceSeries={resourceSeries}
            />
          </TabsContent>

          <TabsContent value="finance">
            <ProjectFinanceTab
              currency={project.budget.currency}
              projectEvm={projectEvm}
              financeSummary={financeSummary}
              evmSeries={evmSeries}
              financeCategorySeries={financeCategorySeries}
              contractItems={contractItems}
              overdueContracts={overdueContracts}
            />
          </TabsContent>

          <TabsContent value="resources">
            <ProjectResourcesTab
              projectTeam={projectTeam}
              resourceUtilization={resourceUtilization}
              equipmentItems={equipmentItems}
              materialItems={materialItems}
              lowStockProjectMaterials={lowStockProjectMaterials}
              resourceSeries={resourceSeries}
              currency={project.budget.currency}
            />
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
            <ProjectRisksTab projectRisks={projectRisks} />
          </TabsContent>

          <TabsContent value="gantt" className="hidden sm:block">
            <ProjectGanttTab
              ganttLoading={ganttLoading}
              ganttSnapshot={ganttSnapshot}
              projectMilestones={projectMilestones}
              projectTasks={projectTasks}
              projectDates={project.dates}
            />
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
