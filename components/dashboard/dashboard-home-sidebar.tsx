"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowUpRight, BrainCircuit } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { NotificationItem, TeamMember } from "@/lib/types";
import type { ObjectiveSummary, ObjectiveTheme } from "@/lib/goals/objective-summary";
import type { MessageKey } from "@/lib/translations";

const DashboardRiskChart = dynamic(
  () =>
    import("@/components/dashboard/dashboard-risk-chart").then(
      (module) => module.DashboardRiskChart
    ),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

type DashboardHomeRiskDatum = {
  color: string;
  name: string;
  value: number;
};

export function DashboardHomeSidebar({
  features,
  launchPortfolioPreset,
  notifications,
  objectiveSummary,
  onOpenTaskModal,
  riskData,
  t,
  team,
  topObjectiveThemes,
}: {
  features: {
    budgetForecast?: boolean;
    projectAssistant?: boolean;
    riskAnalysis?: boolean;
    taskSuggestions?: boolean;
  };
  launchPortfolioPreset: (
    kind: "budgetForecast" | "riskAnalysis" | "taskSuggestions"
  ) => Promise<void>;
  notifications: NotificationItem[];
  objectiveSummary: ObjectiveSummary;
  onOpenTaskModal: () => void;
  riskData: DashboardHomeRiskDatum[];
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  team: TeamMember[];
  topObjectiveThemes: ObjectiveTheme[];
}) {
  return (
    <div className="grid gap-3">
      <Card className="p-3" data-testid="dashboard-goals">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-medium">Цели и фокус</h3>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Темы, которые объединяют проекты и подсказывают управленческий курс.
            </p>
          </div>
          <Badge variant="neutral">{objectiveSummary.coveragePercent}%</Badge>
        </div>

        {topObjectiveThemes.length === 0 ? (
          <div className="rounded-lg border bg-[var(--panel-soft)]/40 p-2 text-xs text-muted-foreground">
            Добавьте цели в проекты, чтобы здесь появился управленческий фокус.
          </div>
        ) : (
          <div className="max-h-[180px] space-y-1.5 overflow-y-auto">
            {topObjectiveThemes.map((theme) => (
              <div key={theme.objective} className="rounded-lg border bg-[var(--panel-soft)]/40 p-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-xs font-medium leading-5">{theme.objective}</p>
                  <Badge variant="neutral">{theme.count}×</Badge>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {theme.projectCount} проектов · {theme.projectNames.slice(0, 2).join(" · ")}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground">
            {objectiveSummary.coveredProjects} из {objectiveSummary.totalProjects} проектов с целями
          </p>
          <Link
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "h-8 text-xs",
            })}
            href="/goals"
          >
            Цели
            <ArrowUpRight className="ml-auto h-3 w-3" />
          </Link>
        </div>
      </Card>

      {features.projectAssistant ? (
        <Card className="p-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-[var(--brand)]" />
                <h3 className="text-xs font-medium">{t("ai.dashboard.title")}</h3>
              </div>
              <p className="text-[10px] text-muted-foreground">{t("ai.dashboard.description")}</p>
            </div>
            <Badge variant="info">AI</Badge>
          </div>

          <div className="grid gap-1.5">
            {features.taskSuggestions ? (
              <Button
                className="h-8 justify-start text-xs"
                onClick={() => void launchPortfolioPreset("taskSuggestions")}
                size="sm"
                variant="outline"
              >
                {t("ai.action.taskSuggestions")}
              </Button>
            ) : null}
            {features.riskAnalysis ? (
              <Button
                className="h-8 justify-start text-xs"
                onClick={() => void launchPortfolioPreset("riskAnalysis")}
                size="sm"
                variant="outline"
              >
                {t("ai.action.riskAnalysis")}
              </Button>
            ) : null}
            {features.budgetForecast ? (
              <Button
                className="h-8 justify-start text-xs"
                onClick={() => void launchPortfolioPreset("budgetForecast")}
                size="sm"
                variant="outline"
              >
                {t("ai.action.budgetForecast")}
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium">{t("dashboard.criticalFeed")}</h3>
          <span className="text-[10px] text-muted-foreground">{notifications.length} событий</span>
        </div>
        <div className="max-h-[240px] space-y-1.5 overflow-y-auto">
          {notifications.map((notification) => (
            <Link
              key={notification.id}
              className="block rounded border bg-[var(--panel-soft)]/40 p-2 hover:bg-[var(--panel-soft)]/60"
              href={notification.projectId ? `/projects/${notification.projectId}` : "/"}
            >
              <p className="truncate text-xs font-medium">{notification.title}</p>
              <p className="truncate text-[10px] text-muted-foreground">
                {notification.description}
              </p>
            </Link>
          ))}
        </div>
      </Card>

      <Card className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium">{t("dashboard.teamLoad")}</h3>
          <span className="text-[10px] text-muted-foreground">
            {team.length} {t("dashboard.teamMembers")}
          </span>
        </div>
        {team.length === 0 ? (
          <div className="flex h-[100px] items-center justify-center text-xs text-muted-foreground">
            {t("dashboard.noTeamMembers")}
          </div>
        ) : (
          <div className="max-h-[240px] space-y-1.5 overflow-y-auto">
            {team.map((member) => {
              const loadLevel =
                member.allocated >= 90
                  ? "critical"
                  : member.allocated >= 70
                    ? "warning"
                    : "normal";

              return (
                <div
                  key={member.id}
                  className="flex items-center gap-2 rounded border bg-[var(--panel-soft)]/40 p-2 transition-colors hover:bg-[var(--panel-soft)]/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="truncate text-xs font-medium">{member.name}</p>
                      <span
                        className={cn(
                          "text-[10px] font-medium",
                          loadLevel === "critical" && "text-rose-500",
                          loadLevel === "warning" && "text-amber-500",
                          loadLevel === "normal" && "text-muted-foreground"
                        )}
                      >
                        {member.allocated}%
                      </span>
                    </div>
                    <div className="mt-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            loadLevel === "critical" && "bg-rose-500",
                            loadLevel === "warning" && "bg-amber-500",
                            loadLevel === "normal" && "bg-[var(--brand)]"
                          )}
                          style={{ width: `${member.allocated}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-3">
        <h3 className="mb-2 text-xs font-medium">{t("dashboard.riskMix")}</h3>
        <div className="flex flex-col gap-3">
          <div className="h-[140px] w-full">
            <DashboardRiskChart data={riskData} />
          </div>
          <div className="grid grid-cols-2 gap-1">
            {riskData.map((entry) => (
              <div
                key={entry.name}
                className="flex items-center gap-2 rounded border bg-[var(--panel-soft)]/40 p-1.5"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="flex-1 truncate text-[10px]">{entry.name}</span>
                <span className="text-xs font-bold">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card className="p-3">
        <h3 className="mb-2 text-xs font-medium">{t("dashboard.quickActions")}</h3>
        <div className="grid gap-1.5">
          <Button
            className="h-8 justify-start text-xs"
            onClick={onOpenTaskModal}
            size="sm"
            variant="outline"
          >
            {t("action.addTask")}
          </Button>
          <Link
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "h-8 justify-start text-xs",
            })}
            href="/portfolio"
          >
            {t("action.openPortfolio")}
            <ArrowUpRight className="ml-auto h-3 w-3" />
          </Link>
          <Link
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "h-8 justify-start text-xs",
            })}
            href="/analytics"
          >
            {t("nav.analytics")}
            <ArrowUpRight className="ml-auto h-3 w-3" />
          </Link>
        </div>
      </Card>
    </div>
  );
}
