"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useLocale } from "@/contexts/locale-context";
import type { Milestone, Risk } from "@/lib/types";
import { cn, getRiskSeverity, projectStatusMeta } from "@/lib/utils";

export interface ProjectOverviewTabProps {
  projectMilestones: Milestone[];
  projectRisks: Risk[];
}

export function ProjectOverviewTab({
  projectMilestones,
  projectRisks,
}: ProjectOverviewTabProps) {
  const { enumLabel, formatDateLocalized, t } = useLocale();

  return (
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
  );
}
