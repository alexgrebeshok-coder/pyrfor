"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
  FolderKanban,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataErrorState } from "@/components/ui/data-error-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/client/api-error";
import type { CalendarEvent } from "@/lib/calendar-events";
import { cn } from "@/lib/utils";

const DAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const STATUS_META: Record<
  string,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }
> = {
  todo: { label: "Todo", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  blocked: { label: "Blocked", tone: "danger" },
  done: { label: "Done", tone: "success" },
  cancelled: { label: "Cancelled", tone: "warning" },
  upcoming: { label: "Upcoming", tone: "info" },
  overdue: { label: "Overdue", tone: "danger" },
};

const KIND_META: Record<CalendarEvent["kind"], { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  task: { label: "Task", icon: Clock3 },
  milestone: { label: "Milestone", icon: Flag },
};

const shortDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
});

const longDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function getDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStatusMeta(status: string) {
  return STATUS_META[status] ?? { label: status.replace(/_/g, " "), tone: "neutral" as const };
}

export const CalendarView = React.memo(function CalendarView({
  initialEvents = [],
}: {
  initialEvents?: CalendarEvent[];
}) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>(() => initialEvents);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const animationRef = useRef<number>(0);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await api.get<CalendarEvent[]>("/api/calendar/events");
      setEvents(Array.isArray(data) ? data : []);
    } catch (fetchError) {
      console.error("[CalendarView] Error:", fetchError);
      setEvents([]);
      setSelectedEvent(null);
      setError("Живые данные календаря сейчас недоступны. Попробуйте повторить запрос.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (initialEvents.length > 0) {
      setEvents((current) => (current.length > 0 ? current : initialEvents));
    }
  }, [initialEvents]);

  const getDaysInMonth = useCallback((date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const days: Date[] = [];

    const startPadding = firstDay.getDay();
    for (let i = startPadding - 1; i >= 0; i -= 1) {
      days.push(new Date(year, month, -i));
    }

    for (let i = 1; i <= lastDay.getDate(); i += 1) {
      days.push(new Date(year, month, i));
    }

    const endPadding = 42 - days.length;
    for (let i = 1; i <= endPadding; i += 1) {
      days.push(new Date(year, month + 1, i));
    }

    return days;
  }, []);

  const eventsByDate = useMemo(() => {
    const index = new Map<string, CalendarEvent[]>();

    for (const event of events) {
      const dateKey = getDateKey(new Date(event.start));
      const bucket = index.get(dateKey);
      if (bucket) {
        bucket.push(event);
      } else {
        index.set(dateKey, [event]);
      }
    }

    return index;
  }, [events]);

  const getEventsForDay = useCallback(
    (date: Date) => eventsByDate.get(getDateKey(date)) || [],
    [eventsByDate]
  );

  const handleMonthChange = useCallback(
    (direction: "prev" | "next") => {
      if (isAnimating) {
        return;
      }

      setIsAnimating(true);

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      const newDate =
        direction === "prev"
          ? new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)
          : new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);

      setCurrentDate(newDate);

      animationRef.current = requestAnimationFrame(() => {
        setTimeout(() => setIsAnimating(false), 300);
      });
    },
    [currentDate, isAnimating]
  );

  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  const days = getDaysInMonth(currentDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthLabel = `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-8 w-56 animate-pulse rounded bg-[var(--surface-secondary)]" />
            <div className="h-4 w-64 animate-pulse rounded bg-[var(--surface-secondary)]" />
          </div>
          <div className="flex gap-2">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-[var(--surface-secondary)]" />
            <div className="h-10 w-10 animate-pulse rounded-lg bg-[var(--surface-secondary)]" />
          </div>
        </div>
        <Card className="p-6">
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)]">
            {Array.from({ length: 28 }).map((_, index) => (
              <div
                key={index}
                className="min-h-[96px] bg-[var(--surface-panel)] p-3"
              >
                <div className="h-4 w-4 animate-pulse rounded bg-[var(--surface-secondary)]" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold transition-all duration-300">{monthLabel}</h2>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Live task deadlines and project milestones.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleMonthChange("prev")}
            disabled={isAnimating}
            className={cn(
              "rounded-lg border border-[var(--line)] p-2 transition-all duration-200",
              "hover:bg-[var(--surface-secondary)] hover:scale-105",
              "active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            )}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => handleMonthChange("next")}
            disabled={isAnimating}
            className={cn(
              "rounded-lg border border-[var(--line)] p-2 transition-all duration-200",
              "hover:bg-[var(--surface-secondary)] hover:scale-105",
              "active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            )}
            aria-label="Next month"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {error ? (
        <DataErrorState
          actionLabel="Попробовать снова"
          description={error}
          onRetry={() => {
            void fetchEvents();
          }}
          title="Не удалось загрузить календарь"
        />
      ) : null}

      {!error && events.length === 0 ? (
        <Card className="border-dashed p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--panel-soft)] text-[var(--ink-muted)]">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-[var(--ink)]">No calendar events yet</h3>
              <p className="max-w-2xl text-sm leading-7 text-[var(--ink-soft)]">
                There are no tasks with due dates in the current dataset, so the calendar is
                empty for this month.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {!error ? (
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-7 border-b border-[var(--line)]">
            {DAYS.map((day) => (
              <div key={day} className="p-3 text-center text-sm font-medium text-[var(--ink-muted)]">
                {day}
              </div>
            ))}
          </div>

          <div
            className={cn(
              "grid grid-cols-7 transition-opacity duration-300",
              isAnimating && "opacity-50"
            )}
          >
            {days.map((date, index) => {
              const dayEvents = getEventsForDay(date);
              const isCurrentMonth = date.getMonth() === currentDate.getMonth();
              const isToday = date.getTime() === today.getTime();
              const isActive = getDateKey(date) === getDateKey(currentDate);
              const visibleEvents = isActive ? dayEvents : dayEvents.slice(0, 3);

              return (
                <div
                  key={`${getDateKey(date)}-${index}`}
                  className={cn(
                    "min-h-[112px] border-b border-r border-[var(--line)] p-2",
                    "transition-all duration-200 hover:bg-[var(--surface-secondary)]/50",
                    !isCurrentMonth && "bg-[var(--surface-secondary)]/50"
                  )}
                >
                  <div
                    className={cn(
                      "mb-2 text-sm font-medium transition-all duration-200",
                      !isCurrentMonth && "text-[var(--ink-muted)]",
                      isToday && "flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-white"
                    )}
                  >
                    {date.getDate()}
                  </div>

                  <div className="space-y-1.5">
                    {visibleEvents.map((event) => {
                      const statusMeta = getStatusMeta(event.status);
                      const dueDateLabel = shortDateFormatter.format(new Date(event.start));
                      const kindMeta = KIND_META[event.kind];
                      const KindIcon = kindMeta.icon;

                      return (
                        <button
                          key={event.id}
                          data-testid="calendar-event-card"
                          data-event-id={event.id}
                          type="button"
                          onClick={() => setSelectedEvent(event)}
                        className="w-full rounded-lg border px-2 py-1.5 text-left text-xs transition-transform duration-200 hover:scale-[1.01] hover:shadow-sm"
                        style={{
                          backgroundColor: `${event.color}14`,
                          borderColor: `${event.color}2a`,
                        }}
                        aria-label={`Open details for ${event.title}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="block truncate font-medium text-[var(--ink)]">
                                {event.title}
                              </span>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <Badge variant="neutral" className="shrink-0">
                                  <span className="inline-flex items-center gap-1">
                                    <KindIcon className="h-3 w-3" />
                                    {kindMeta.label}
                                  </span>
                                </Badge>
                                <Badge variant={statusMeta.tone} className="shrink-0">
                                  {statusMeta.label}
                                </Badge>
                              </div>
                            </div>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
                            <FolderKanban className="h-3 w-3 shrink-0" />
                            <span className="truncate">{event.resource.projectName}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
                            <Clock3 className="h-3 w-3 shrink-0" />
                            <span>{dueDateLabel}</span>
                          </div>
                        </button>
                      );
                    })}
                    {!isActive && dayEvents.length > 3 ? (
                      <div className="px-1 text-xs text-[var(--ink-muted)]">
                        +{dayEvents.length - 3} more
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded" style={{ backgroundColor: "#3b82f6" }} />
          <span>In Progress</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded" style={{ backgroundColor: "#22c55e" }} />
          <span>Done</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded" style={{ backgroundColor: "#f43f5e" }} />
          <span>Blocked</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded" style={{ backgroundColor: "#94a3b8" }} />
          <span>Todo</span>
        </div>
      </div>

      <Dialog
        open={Boolean(selectedEvent)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEvent(null);
          }
        }}
      >
        <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-[560px]">
          {selectedEvent ? (
            <>
              <DialogHeader>
                <DialogTitle>{selectedEvent.title}</DialogTitle>
                <DialogDescription>
                  {selectedEvent.kind === "milestone"
                    ? "Milestone details from the live calendar feed."
                    : "Task details from the live calendar feed."}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                    <p className="text-sm text-[var(--ink-soft)]">Type</p>
                    <div className="mt-2">
                      <Badge variant="neutral">{KIND_META[selectedEvent.kind].label}</Badge>
                    </div>
                  </div>

                  <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                    <p className="text-sm text-[var(--ink-soft)]">Status</p>
                    <div className="mt-2">
                      <Badge variant={getStatusMeta(selectedEvent.status).tone}>
                        {getStatusMeta(selectedEvent.status).label}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                  <p className="text-sm text-[var(--ink-soft)]">Project</p>
                  <p className="mt-1 font-medium text-[var(--ink)]">
                    {selectedEvent.resource.projectName}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                    <p className="text-sm text-[var(--ink-soft)]">
                      {selectedEvent.kind === "milestone" ? "Milestone date" : "Due date"}
                    </p>
                    <p className="mt-1 font-medium text-[var(--ink)]">
                      {longDateFormatter.format(new Date(selectedEvent.start))}
                    </p>
                  </div>
                </div>

                <div className="rounded-[12px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                  <p className="text-sm text-[var(--ink-soft)]">Event color</p>
                  <div className="mt-2 flex items-center gap-3">
                    <span
                      className="h-4 w-4 rounded-full border border-white/30"
                      style={{ backgroundColor: selectedEvent.color }}
                    />
                    <span className="text-sm text-[var(--ink)]">
                      {selectedEvent.color.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSelectedEvent(null);
                  }}
                >
                  Close
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
});
