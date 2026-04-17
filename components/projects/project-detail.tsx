"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { useDashboard } from "@/components/dashboard-provider";
import type { ExpensesResponse } from "@/components/expenses/types";
import type { ProjectGanttApiResponse } from "@/components/gantt/types";
import { ProjectDetailView } from "@/components/projects/project-detail-view";
import type { ContractView, EquipmentView, MaterialView } from "@/components/resources/types";
import { useLocale } from "@/contexts/locale-context";
import { useTasks } from "@/lib/hooks/use-api";
import { usePlatformPermission } from "@/lib/hooks/use-platform-permission";
import type { Milestone, Task } from "@/lib/types";

type ProjectEvmResponse = {
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
};

type ProjectEvmHistoryResponse = {
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
};

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
  const [dependencyTaskId, setDependencyTaskId] = useState<string | null>(null);
  const { tasks: apiTasks, mutate: mutateTasks } = useTasks();

  const project = projects.find((item) => item.id === projectId) ?? null;
  const projectIdForGantt = project?.id ?? null;
  const activeProjectId = project?.id ?? null;

  const { data: ganttSnapshot, isLoading: ganttLoading } = useSWR<ProjectGanttApiResponse>(
    projectIdForGantt ? "/api/projects/" + projectIdForGantt + "/gantt" : null,
    ganttFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    }
  );
  const { data: projectExpenses } = useSWR<ExpensesResponse>(
    project?.id ? "/api/expenses?projectId=" + project.id : null,
    projectDataFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const { data: projectContracts } = useSWR<{ contracts: ContractView[] }>(
    project?.id ? "/api/contracts?projectId=" + project.id : null,
    projectDataFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const { data: projectEquipment } = useSWR<{ equipment: EquipmentView[] }>(
    project?.id ? "/api/equipment?projectId=" + project.id : null,
    projectDataFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const { data: allMaterials } = useSWR<{ materials: MaterialView[] }>(
    project?.id ? "/api/materials" : null,
    projectDataFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const { data: projectEvm } = useSWR<ProjectEvmResponse>(
    project?.id ? "/api/evm?projectId=" + project.id : null,
    projectDataFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );
  const { data: projectEvmHistory } = useSWR<ProjectEvmHistoryResponse>(
    project?.id ? "/api/evm/history?projectId=" + project.id : null,
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
  const projectRisks = useMemo(() => risks.filter((risk) => risk.projectId === projectId), [projectId, risks]);
  const projectDocuments = useMemo(
    () => documents.filter((document) => document.projectId === projectId),
    [documents, projectId]
  );
  const projectMilestones = useMemo(() => {
    const mergedMilestones = new Map<string, Milestone>();

    for (const milestone of initialMilestones) {
      mergedMilestones.set(milestone.id, milestone);
    }

    for (const milestone of milestones) {
      mergedMilestones.set(milestone.id, milestone);
    }

    return Array.from(mergedMilestones.values()).filter((milestone) => milestone.projectId === projectId);
  }, [initialMilestones, milestones, projectId]);
  const projectTeam = useMemo(
    () => team.filter((member) => project?.team.includes(member.name)),
    [project?.team, team]
  );
  const dependencyTask = projectTasks.find((task) => task.id === dependencyTaskId) ?? null;

  const budgetSeries =
    project?.history.map((point) => ({
      name: formatDateLocalized(point.date),
      progress: point.progress,
      planned: Math.round(point.budgetPlanned / 1000),
      actual: Math.round(point.budgetActual / 1000),
    })) ?? [];
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
    if (!project || !canManageTasks) {
      return;
    }

    if (window.confirm(t("project.deleteConfirm", { name: project.name }))) {
      deleteProject(project.id);
      router.push("/projects");
    }
  };

  const handleDuplicate = () => {
    if (project) {
      duplicateProject(project.id);
    }
  };

  return (
    <ProjectDetailView
      auditLogEntries={auditLogEntries}
      budgetSeries={budgetSeries}
      canManageTasks={canManageTasks}
      contractItems={contractItems}
      dependencyTask={dependencyTask}
      dependencyTaskId={dependencyTaskId}
      editingOpen={editingOpen}
      equipmentItems={equipmentItems}
      evmSeries={evmSeries}
      financeCategorySeries={financeCategorySeries}
      financeSummary={financeSummary}
      ganttLoading={ganttLoading}
      ganttSnapshot={ganttSnapshot}
      lowStockProjectMaterials={lowStockProjectMaterials}
      materialItems={materialItems}
      mutateTasks={mutateTasks}
      onAddTask={() => setTaskModalOpen(true)}
      onBackToProjects={() => router.push("/projects")}
      onDelete={handleDelete}
      onDuplicate={handleDuplicate}
      onEdit={() => setEditingOpen(true)}
      onSetStatus={setProjectStatus}
      overdueContracts={overdueContracts}
      project={project}
      projectDocuments={projectDocuments}
      projectEvm={projectEvm}
      projectMilestones={projectMilestones}
      projectRisks={projectRisks}
      projectTasks={projectTasks}
      projectTeam={projectTeam}
      resourceSeries={resourceSeries}
      resourceUtilization={resourceUtilization}
      setDependencyTaskId={setDependencyTaskId}
      setEditingOpen={setEditingOpen}
      setTaskModalOpen={setTaskModalOpen}
      taskModalOpen={taskModalOpen}
      updateTaskStatus={updateTaskStatus}
    />
  );
}
