"use client";

import type { Dispatch, SetStateAction } from "react";
import { Files } from "lucide-react";

import { AIContextActions } from "@/components/ai/ai-context-actions";
import { AuditLogList } from "@/components/projects/audit-log-list";
import { ProjectChartsTab } from "@/components/projects/project-charts-tab";
import { ProjectDetailHeader, type ProjectDetailHeaderProps } from "@/components/projects/project-detail-header";
import { ProjectFinanceTab, type ProjectFinanceTabProps } from "@/components/projects/project-finance-tab";
import { ProjectFormModal } from "@/components/projects/project-form-modal";
import { ProjectGanttTab, type ProjectGanttTabProps } from "@/components/projects/project-gantt-tab";
import { ProjectOverviewTab, type ProjectOverviewTabProps } from "@/components/projects/project-overview-tab";
import { ProjectResourcesTab, type ProjectResourcesTabProps } from "@/components/projects/project-resources-tab";
import { ProjectRisksTab } from "@/components/projects/project-risks-tab";
import { ProjectTasksTab, type ProjectTasksTabProps } from "@/components/projects/project-tasks-tab";
import { TaskFormModal } from "@/components/tasks/task-form-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/contexts/locale-context";
import type { AuditLogEntry, Project, ProjectDocument, TeamMember } from "@/lib/types";

interface ProjectDetailViewProps {
  auditLogEntries: AuditLogEntry[];
  budgetSeries: Array<{ name: string; progress: number; planned: number; actual: number }>;
  canManageTasks: boolean;
  contractItems: ProjectFinanceTabProps["contractItems"];
  dependencyTask: ProjectTasksTabProps["dependencyTask"];
  dependencyTaskId: ProjectTasksTabProps["dependencyTaskId"];
  editingOpen: boolean;
  equipmentItems: ProjectResourcesTabProps["equipmentItems"];
  evmSeries: ProjectFinanceTabProps["evmSeries"];
  financeCategorySeries: ProjectFinanceTabProps["financeCategorySeries"];
  financeSummary?: ProjectFinanceTabProps["financeSummary"];
  ganttLoading: ProjectGanttTabProps["ganttLoading"];
  ganttSnapshot?: ProjectGanttTabProps["ganttSnapshot"];
  lowStockProjectMaterials: ProjectResourcesTabProps["lowStockProjectMaterials"];
  materialItems: ProjectResourcesTabProps["materialItems"];
  mutateTasks: ProjectTasksTabProps["mutateTasks"];
  onAddTask: () => void;
  onBackToProjects: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onSetStatus: ProjectDetailHeaderProps["onSetStatus"];
  overdueContracts: ProjectFinanceTabProps["overdueContracts"];
  project: Project | null;
  projectDocuments: ProjectDocument[];
  projectEvm?: ProjectFinanceTabProps["projectEvm"];
  projectMilestones: ProjectOverviewTabProps["projectMilestones"];
  projectRisks: ProjectDetailHeaderProps["projectRisks"];
  projectTasks: ProjectDetailHeaderProps["projectTasks"];
  projectTeam: TeamMember[];
  resourceSeries: ProjectResourcesTabProps["resourceSeries"];
  resourceUtilization: ProjectResourcesTabProps["resourceUtilization"];
  setDependencyTaskId: ProjectTasksTabProps["setDependencyTaskId"];
  setEditingOpen: Dispatch<SetStateAction<boolean>>;
  setTaskModalOpen: Dispatch<SetStateAction<boolean>>;
  taskModalOpen: boolean;
  updateTaskStatus: ProjectTasksTabProps["updateTaskStatus"];
}

export function ProjectDetailView({
  auditLogEntries,
  budgetSeries,
  canManageTasks,
  contractItems,
  dependencyTask,
  dependencyTaskId,
  editingOpen,
  equipmentItems,
  evmSeries,
  financeCategorySeries,
  financeSummary,
  ganttLoading,
  ganttSnapshot,
  lowStockProjectMaterials,
  materialItems,
  mutateTasks,
  onAddTask,
  onBackToProjects,
  onDelete,
  onDuplicate,
  onEdit,
  onSetStatus,
  overdueContracts,
  project,
  projectDocuments,
  projectEvm,
  projectMilestones,
  projectRisks,
  projectTasks,
  projectTeam,
  resourceSeries,
  resourceUtilization,
  setDependencyTaskId,
  setEditingOpen,
  setTaskModalOpen,
  taskModalOpen,
  updateTaskStatus,
}: ProjectDetailViewProps) {
  const { formatDateLocalized, t } = useLocale();

  if (!project) {
    return (
      <Card>
        <CardContent className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-10 text-center">
          <h2 className="font-heading text-xl font-semibold tracking-[-0.06em] text-[var(--ink)]">
            {t("project.notFound")}
          </h2>
          <p className="max-w-md text-sm text-[var(--ink-soft)]">{t("project.notFoundDescription")}</p>
          <Button onClick={onBackToProjects}>{t("nav.projects")}</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4">
        <ProjectDetailHeader
          canManageTasks={canManageTasks}
          onAddTask={onAddTask}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onEdit={onEdit}
          onSetStatus={onSetStatus}
          project={project}
          projectRisks={projectRisks}
          projectTasks={projectTasks}
        />

        <AIContextActions />

        <Tabs defaultValue="overview">
          <TabsList className="w-full flex-nowrap justify-start overflow-x-auto sm:justify-center">
            <TabsTrigger value="overview">{t("project.overview")}</TabsTrigger>
            <TabsTrigger value="tasks">{t("project.tasks")}</TabsTrigger>
            <TabsTrigger value="charts">{t("project.charts")}</TabsTrigger>
            <TabsTrigger value="finance">Finance</TabsTrigger>
            <TabsTrigger value="resources">Resources</TabsTrigger>
            <TabsTrigger value="documents">{t("project.documents")}</TabsTrigger>
            <TabsTrigger value="team">{t("project.team")}</TabsTrigger>
            <TabsTrigger value="risks">{t("project.risks")}</TabsTrigger>
            <TabsTrigger className="hidden sm:flex" value="gantt">
              {t("project.gantt")}
            </TabsTrigger>
            <TabsTrigger value="history">{t("project.history")}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <ProjectOverviewTab projectMilestones={projectMilestones} projectRisks={projectRisks} />
          </TabsContent>

          <TabsContent value="tasks">
            <ProjectTasksTab
              canManageTasks={canManageTasks}
              dependencyTask={dependencyTask}
              dependencyTaskId={dependencyTaskId}
              mutateTasks={mutateTasks}
              onAddTask={onAddTask}
              projectName={project.name}
              projectTasks={projectTasks}
              setDependencyTaskId={setDependencyTaskId}
              updateTaskStatus={updateTaskStatus}
            />
          </TabsContent>

          <TabsContent value="charts">
            <ProjectChartsTab budgetSeries={budgetSeries} resourceSeries={resourceSeries} />
          </TabsContent>

          <TabsContent value="finance">
            <ProjectFinanceTab
              contractItems={contractItems}
              currency={project.budget.currency}
              evmSeries={evmSeries}
              financeCategorySeries={financeCategorySeries}
              financeSummary={financeSummary}
              overdueContracts={overdueContracts}
              projectEvm={projectEvm}
            />
          </TabsContent>

          <TabsContent value="resources">
            <ProjectResourcesTab
              currency={project.budget.currency}
              equipmentItems={equipmentItems}
              lowStockProjectMaterials={lowStockProjectMaterials}
              materialItems={materialItems}
              projectTeam={projectTeam}
              resourceSeries={resourceSeries}
              resourceUtilization={resourceUtilization}
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
                    <Badge variant="info">{formatDateLocalized(document.updatedAt, "d MMM yyyy")}</Badge>
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

          <TabsContent className="hidden sm:block" value="gantt">
            <ProjectGanttTab
              ganttLoading={ganttLoading}
              ganttSnapshot={ganttSnapshot}
              projectDates={project.dates}
              projectMilestones={projectMilestones}
              projectTasks={projectTasks}
            />
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>{t("project.history")}</CardTitle>
                <CardDescription>{t("project.historyDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <AuditLogList entries={auditLogEntries} projectId={project.id} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <ProjectFormModal onOpenChange={setEditingOpen} open={canManageTasks && editingOpen} project={project} />
      <TaskFormModal onOpenChange={setTaskModalOpen} open={canManageTasks && taskModalOpen} projectId={project.id} />
    </>
  );
}
