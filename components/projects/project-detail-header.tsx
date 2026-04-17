"use client";

import { ArrowRight, Copy, Download, Trash2 } from "lucide-react";

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
import { useLocale } from "@/contexts/locale-context";
import type { Project, ProjectStatus, Risk, Task } from "@/lib/types";
import { cn, formatCurrency, projectStatusMeta } from "@/lib/utils";

export interface ProjectDetailHeaderProps {
  project: Project;
  canManageTasks: boolean;
  projectTasks: Task[];
  projectRisks: Risk[];
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddTask: () => void;
  onSetStatus: (projectId: string, status: ProjectStatus) => void | Promise<void>;
}

export function ProjectDetailHeader({
  project,
  canManageTasks,
  projectTasks,
  projectRisks,
  onEdit,
  onDuplicate,
  onDelete,
  onAddTask,
  onSetStatus,
}: ProjectDetailHeaderProps) {
  const { enumLabel, formatDateLocalized, t } = useLocale();

  const healthTone =
    project.health >= 75 ? "success" : project.health >= 60 ? "warning" : "danger";

  return (
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
              <Button disabled={!canManageTasks} onClick={onEdit} variant="secondary">
                {t("action.edit")}
              </Button>
              <Button
                disabled={!canManageTasks}
                onClick={onDuplicate}
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
                onClick={onAddTask}
                variant="outline"
              >
                {t("action.addTask")}
              </Button>
              <Button disabled={!canManageTasks} onClick={onDelete} variant="danger">
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
                  onClick={() => onSetStatus(project.id, "active")}
                  size="sm"
                  variant="secondary"
                >
                  {enumLabel("projectStatus", "active")}
                </Button>
                <Button
                  onClick={() => onSetStatus(project.id, "on-hold")}
                  size="sm"
                  variant="secondary"
                >
                  {enumLabel("projectStatus", "on-hold")}
                </Button>
                <Button
                  onClick={() => onSetStatus(project.id, "at-risk")}
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
  );
}
