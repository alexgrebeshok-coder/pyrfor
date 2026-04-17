import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCurrency } from "@/lib/utils";

import type { GoalsProjectsPanelProps } from "@/components/goals/goals-page.types";

function ProjectCardSkeleton() {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[color:var(--surface-panel)] p-3 shadow-[0_10px_28px_rgba(15,23,42,.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-3" key={index}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-10" />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-2 w-full rounded-full" />
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-24" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton className="h-6 w-20 rounded-full" key={index} />
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>
    </article>
  );
}

export function GoalsProjectsPanel({
  activeObjective,
  enumLabel,
  onObjectiveChange,
  onQueryChange,
  projectCards,
  query,
  showLoadingState,
  topObjectiveThemes,
}: GoalsProjectsPanelProps) {
  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base tracking-[-0.06em]">
              Проекты и цели
            </CardTitle>
            <CardDescription>
              Каждый проект показывает собственные цели, чтобы связь с целями была видна
              сразу.
            </CardDescription>
          </div>
          <Badge variant="neutral">{projectCards.length} проектов</Badge>
        </div>

        <div className="space-y-2" data-testid="objective-filters">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            Фильтр по целям
          </p>
          {topObjectiveThemes.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/50 p-3 text-xs leading-6 text-[var(--ink-soft)]"
              data-testid="objective-filters-empty"
            >
              Пока управленческих тем нет. Добавьте цели в проекты, и здесь появится
              фильтр по связанным темам.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                className={buttonVariants({
                  variant: activeObjective === null ? "default" : "outline",
                  size: "sm",
                  className: "h-8 rounded-full px-3 text-xs",
                })}
                onClick={() => onObjectiveChange(null)}
                type="button"
              >
                Все цели
              </button>
              {topObjectiveThemes.map((theme, index) => (
                <button
                  aria-pressed={activeObjective === theme.objective}
                  className={buttonVariants({
                    variant: activeObjective === theme.objective ? "default" : "outline",
                    size: "sm",
                    className: "h-8 rounded-full px-3 text-xs",
                  })}
                  data-testid={index === 0 ? "objective-filter-first" : undefined}
                  key={theme.objective}
                  onClick={() => onObjectiveChange(theme.objective)}
                  type="button"
                >
                  {theme.objective}
                </button>
              ))}
              {activeObjective ? (
                <Badge data-testid="active-objective-filter" variant="info">
                  Фильтр: {activeObjective}
                </Badge>
              ) : null}
            </div>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className={cn(fieldStyles, "h-11 w-full text-sm !py-1.5 leading-normal")}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Поиск по проектам и целям"
            value={query}
          />
          <div className="flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/50 px-3 py-2 text-xs text-[var(--ink-soft)]">
            <Search className="h-4 w-4" />
            Фокус на поиске
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid gap-3 xl:grid-cols-2">
          {showLoadingState
            ? Array.from({ length: 4 }, (_, index) => (
                <ProjectCardSkeleton key={index} />
              ))
            : projectCards.length === 0 ? (
                <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)]/40 p-4 text-sm leading-6 text-[var(--ink-soft)] xl:col-span-2">
                  {activeObjective
                    ? `По цели «${activeObjective}» пока не нашлось проектов. Снимите фильтр или выберите другую цель, чтобы увидеть связанные проекты.`
                    : "Пока проектов недостаточно, чтобы связать их с целями. Добавьте проект или дождитесь первой синхронизации, чтобы здесь появились цели и управленческие сигналы."}
                </div>
              ) : (
                projectCards.map(({ project, overdueTasks, warningCount, budgetUsage }) => (
                  <article
                    className="rounded-3xl border border-[var(--line)] bg-[color:var(--surface-panel)] p-3 shadow-[0_14px_40px_rgba(15,23,42,.04)]"
                    key={project.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                          {project.location || "Проект"}
                        </p>
                        <h3 className="mt-1 text-base font-semibold tracking-[-0.04em] text-[var(--ink)]">
                          {project.name}
                        </h3>
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--ink-soft)]">
                          {project.description}
                        </p>
                      </div>
                      <Badge
                        variant={
                          project.status === "at-risk"
                            ? "danger"
                            : project.status === "active"
                              ? "success"
                              : "neutral"
                        }
                      >
                        {enumLabel("projectStatus", project.status)}
                      </Badge>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-2.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                          Прогресс
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                          {project.progress}%
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-2.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                          Бюджет
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                          {project.budget.planned > 0 ? `${budgetUsage}%` : "—"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)]/60 p-2.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                          Сигналы
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                          {warningCount + overdueTasks}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="flex items-center justify-between gap-3 text-xs text-[var(--ink-soft)]">
                        <span>Реализация</span>
                        <span>{project.health}% здоровья</span>
                      </div>
                      <Progress className="mt-2 h-2" value={project.health} />
                    </div>

                    <div className="mt-3 space-y-2">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                        Связанные цели
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {project.objectives.slice(0, 3).map((objective) => (
                          <Badge key={objective} variant="neutral">
                            {objective}
                          </Badge>
                        ))}
                        {project.objectives.length > 3 ? (
                          <Badge variant="info">+{project.objectives.length - 3}</Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-[var(--ink-soft)]">
                        План: {formatCurrency(project.budget.planned, "RUB")} · Факт:{" "}
                        {formatCurrency(project.budget.actual, "RUB")}
                      </p>
                      <Link
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                        href={`/projects/${project.id}`}
                      >
                        <ArrowUpRight className="h-4 w-4" />
                        Открыть проект
                      </Link>
                    </div>
                  </article>
                ))
              )}
        </div>

      </CardContent>
    </Card>
  );
}
