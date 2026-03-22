"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { AlertTriangle, CheckCircle2, Flag, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";

import { useDashboard } from "@/components/dashboard-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/contexts/locale-context";
import { getTodayDate, getTodayIsoDate } from "@/lib/date";

type CalendarView = "week" | "month";

export function CalendarPage() {
  const { formatDateLocalized, t } = useLocale();
  const { projects, tasks } = useDashboard();
  const [view, setView] = useState<CalendarView>("week");
  const [cursorDate, setCursorDate] = useState(() => getTodayDate());
  const [selectedDay, setSelectedDay] = useState(() => getTodayIsoDate());

  const interval = useMemo(() => {
    if (view === "week") {
      return {
        start: startOfWeek(cursorDate, { weekStartsOn: 1 }),
        end: endOfWeek(cursorDate, { weekStartsOn: 1 }),
      };
    }

    return {
      start: startOfWeek(startOfMonth(cursorDate), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(cursorDate), { weekStartsOn: 1 }),
    };
  }, [cursorDate, view]);

  const dayCells = useMemo(() => {
    const days: Date[] = [];
    for (
      let current = interval.start;
      current <= interval.end;
      current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1)
    ) {
      days.push(current);
    }
    return days;
  }, [interval]);

  const projectNameById = useMemo(
    () => Object.fromEntries(projects.map((project) => [project.id, project.name])),
    [projects]
  );

  const eventsByDate = useMemo(() => {
    const entries: Record<
      string,
      Array<{
        id: string;
        title: string;
        type: "task" | "milestone";
        subtitle: string;
        tone: "info" | "success" | "danger";
      }>
    > = {};

    tasks.forEach((task) => {
      entries[task.dueDate] ??= [];
      const projectLabel = projectNameById[task.projectId] ?? "";
      const subtitle = [projectLabel, task.assignee?.name].filter(Boolean).join(" • ");
      entries[task.dueDate].push({
        id: task.id,
        title: task.title,
        type: "task",
        subtitle: subtitle || projectLabel || task.assignee?.name || "",
        tone: task.status === "blocked" ? "danger" : task.status === "done" ? "success" : "info",
      });
    });

    projects.forEach((project) => {
      if (!project.nextMilestone) return;
      entries[project.nextMilestone.date] ??= [];
      entries[project.nextMilestone.date].push({
        id: `${project.id}-milestone`,
        title: project.nextMilestone.name,
        type: "milestone",
        subtitle: project.name,
        tone: project.status === "at-risk" ? "danger" : "info",
      });
    });

    return entries;
  }, [projectNameById, projects, tasks]);

  const selectedEvents = eventsByDate[selectedDay] ?? [];

  const handleNavigate = (direction: "prev" | "next") => {
    setCursorDate((current) =>
      direction === "prev"
        ? view === "week"
          ? subWeeks(current, 1)
          : subMonths(current, 1)
        : view === "week"
          ? addWeeks(current, 1)
          : addMonths(current, 1)
    );
  };

  return (
    <div className="grid gap-4" data-testid="calendar-page">
      <Card>
        <CardHeader className="flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <CardTitle>{t("calendar.title")}</CardTitle>
            <p className="text-sm text-[var(--ink-soft)]">{t("calendar.description")}</p>
          </div>
          <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-[auto_auto] md:flex md:flex-wrap md:items-center" data-testid="calendar-controls">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
              <Button className="w-full sm:w-auto" data-testid="calendar-prev-button" onClick={() => handleNavigate("prev")} variant="secondary">
                {t("calendar.previous")}
              </Button>
              <Button className="w-full sm:w-auto" data-testid="calendar-next-button" onClick={() => handleNavigate("next")} variant="secondary">
                {t("calendar.next")}
              </Button>
            </div>
            <div className="grid grid-cols-2 rounded-2xl bg-[var(--panel-soft)] p-1 sm:flex" data-testid="calendar-view-toggle">
              <Button
                aria-label={t("calendar.week")}
                className="h-9 rounded-xl"
                data-testid="calendar-week-view"
                onClick={() => setView("week")}
                variant={view === "week" ? "default" : "ghost"}
              >
                {t("calendar.week")}
              </Button>
              <Button
                aria-label={t("calendar.month")}
                className="h-9 rounded-xl"
                data-testid="calendar-month-view"
                onClick={() => setView("month")}
                variant={view === "month" ? "default" : "ghost"}
              >
                {t("calendar.month")}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <CardContent className="overflow-x-auto p-3 sm:p-4 xl:p-5">
            <div
              className={cn(
                "grid auto-rows-fr gap-3",
                view === "week"
                  ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:min-w-[980px] xl:grid-cols-7 2xl:min-w-0"
                  : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:min-w-[980px] xl:grid-cols-7 2xl:min-w-0"
              )}
            >
              {dayCells.map((day) => {
              const dayKey = format(day, "yyyy-MM-dd");
              const events = eventsByDate[dayKey] ?? [];
              const visibleEvents = events.slice(0, view === "week" ? 3 : 2);
              const hiddenEventsCount = Math.max(events.length - visibleEvents.length, 0);
              const isActive = dayKey === selectedDay;
              const muted = view === "month" && !isSameMonth(day, cursorDate);

              return (
                <button
                  aria-label={`${formatDateLocalized(dayKey, "d MMM yyyy")} — ${events.length}`}
                  data-testid="calendar-day-cell"
                  data-day={dayKey}
                  key={dayKey}
                  className={`
                    flex min-h-[160px] min-w-0 flex-col overflow-hidden rounded-[12px] border p-3 text-left transition-all duration-200 sm:min-h-[188px] sm:p-3.5
                    ${isActive ? "border-[var(--brand)] bg-[color:var(--surface-panel)]" : "border-[var(--line)] bg-[var(--panel-soft)]"}
                    ${muted ? "opacity-55" : "opacity-100"}
                  `}
                  onClick={() => setSelectedDay(dayKey)}
                  type="button"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                        {formatDateLocalized(dayKey, view === "week" ? "EEEE" : "EEE")}
                      </p>
                      <p className="font-heading text-2xl font-semibold tracking-[-0.05em] text-[var(--ink)]">
                        {format(day, "d")}
                      </p>
                    </div>
                    {events.length > 0 ? <Badge variant="info">{events.length}</Badge> : null}
                  </div>
                  <div className="grid min-h-0 flex-1 content-start gap-2 overflow-hidden">
                    {visibleEvents.map((event) => (
                      <button
                        key={event.id}
                        data-testid="calendar-event-card"
                        data-event-id={event.id}
                        type="button"
                        onClick={() => {
                          // Navigate to task/project
                          if (event.type === "task") {
                            window.location.href = `/tasks?highlight=${event.id}`;
                          } else {
                            window.location.href = `/projects?highlight=${event.id.replace('-milestone', '')}`;
                          }
                        }}
                        className={
                          event.type === "milestone"
                            ? "min-w-0 rounded-[10px] border border-[var(--brand)]/25 bg-[color:var(--surface-panel)] p-2.5 text-left transition hover:scale-[1.02] hover:shadow-md"
                            : "min-w-0 rounded-[10px] border border-[var(--line)] bg-[color:var(--surface-panel)] p-2.5 text-left transition hover:scale-[1.02] hover:shadow-md"
                        }
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              event.tone === "danger"
                                ? "h-2 w-2 shrink-0 rounded-full bg-rose-500"
                                : event.tone === "success"
                                  ? "h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                                  : "h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]"
                            }
                          />
                          <p
                            className={
                              event.type === "milestone"
                                ? "text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand)]"
                                : "text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]"
                            }
                          >
                            {event.type === "milestone" ? t("calendar.milestone") : t("calendar.task")}
                          </p>
                        </div>
                        <p
                          className={
                            event.type === "milestone"
                              ? "mt-1.5 overflow-hidden break-normal hyphens-auto text-[13px] font-semibold leading-5 text-[var(--ink)] [display:-webkit-box] [overflow-wrap:normal] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]"
                              : "mt-1.5 overflow-hidden break-normal hyphens-auto text-[13px] font-semibold leading-5 text-[var(--ink)] [display:-webkit-box] [overflow-wrap:normal] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]"
                          }
                        >
                          {event.title}
                        </p>
                        <p
                          className={
                            event.type === "milestone"
                              ? "mt-1 overflow-hidden break-normal hyphens-auto text-[11px] leading-4 text-[var(--ink-soft)] [display:-webkit-box] [overflow-wrap:normal] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
                              : "mt-1 overflow-hidden break-normal hyphens-auto text-[11px] leading-4 text-[var(--ink-soft)] [display:-webkit-box] [overflow-wrap:normal] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
                          }
                        >
                          {event.subtitle}
                        </p>
                      </button>
                    ))}
                    {hiddenEventsCount > 0 ? (
                      <div className="rounded-[18px] border border-dashed border-[var(--line)] bg-[color:var(--surface-panel)]/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                        {t("calendar.moreEvents", { count: hiddenEventsCount })}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
            </div>
          </CardContent>
        </Card>

        <Card className="xl:self-start" data-testid="calendar-selected-day-panel">
          <CardHeader>
            <CardTitle>{t("calendar.selectedDay")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="rounded-[24px] border border-[var(--line)] bg-[var(--panel-soft)]/70 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                {t("calendar.openDay")}
              </div>
              <div className="mt-2 font-heading text-xl font-semibold tracking-[-0.05em] text-[var(--ink)]">
                {formatDateLocalized(selectedDay, "d MMM yyyy")}
              </div>
            </div>

            {selectedEvents.length ? (
              selectedEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-[14px] border border-[var(--line)] bg-[color:var(--surface-panel)] p-4"
                  data-testid="calendar-selected-event"
                  data-event-id={event.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        {event.type === "milestone" ? (
                          <Flag className="h-4 w-4 text-[var(--brand)]" />
                        ) : event.tone === "danger" ? (
                          <AlertTriangle className="h-4 w-4 text-rose-500" />
                        ) : event.tone === "success" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <ListTodo className="h-4 w-4 text-[var(--brand)]" />
                        )}
                        <p className="font-medium text-[var(--ink)]">{event.title}</p>
                      </div>
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">{event.subtitle}</p>
                    </div>
                    <Badge
                      variant={
                        event.tone === "danger"
                          ? "danger"
                          : event.tone === "success"
                            ? "success"
                            : "info"
                      }
                    >
                      {event.type === "milestone" ? t("calendar.milestone") : t("calendar.task")}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)]/55 p-6 text-sm text-[var(--ink-soft)]">
                {t("calendar.emptyDay")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
