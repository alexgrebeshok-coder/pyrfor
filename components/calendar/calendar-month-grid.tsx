import { Clock3, FolderKanban } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { CalendarEvent } from "@/lib/calendar-events";
import { cn } from "@/lib/utils";

import {
  DAYS,
  KIND_META,
  getDateKey,
  getStatusMeta,
  shortDateFormatter,
} from "./calendar-view.utils";

export function CalendarMonthGrid({
  currentDate,
  days,
  eventsByDate,
  isAnimating,
  onSelectEvent,
}: {
  currentDate: Date;
  days: Date[];
  eventsByDate: Map<string, CalendarEvent[]>;
  isAnimating: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const todayKey = getDateKey(new Date());
  const activeDateKey = getDateKey(currentDate);
  const currentMonth = currentDate.getMonth();

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-[var(--line)]">
        {DAYS.map((day) => (
          <div key={day} className="p-3 text-center text-sm font-medium text-[var(--ink-muted)]">
            {day}
          </div>
        ))}
      </div>

      <div
        className={cn("grid grid-cols-7 transition-opacity duration-300", isAnimating && "opacity-50")}
      >
        {days.map((date, index) => {
          const dayKey = getDateKey(date);
          const dayEvents = eventsByDate.get(dayKey) ?? [];
          const isCurrentMonth = date.getMonth() === currentMonth;
          const isToday = dayKey === todayKey;
          const isActive = dayKey === activeDateKey;
          const visibleEvents = isActive ? dayEvents : dayEvents.slice(0, 3);

          return (
            <div
              key={`${dayKey}-${index}`}
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
                  isToday &&
                    "flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-white"
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
                      aria-label={`Open details for ${event.title}`}
                      className="w-full rounded-lg border px-2 py-1.5 text-left text-xs transition-transform duration-200 hover:scale-[1.01] hover:shadow-sm"
                      data-event-id={event.id}
                      data-testid="calendar-event-card"
                      onClick={() => onSelectEvent(event)}
                      style={{
                        backgroundColor: `${event.color}14`,
                        borderColor: `${event.color}2a`,
                      }}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="block truncate font-medium text-[var(--ink)]">
                            {event.title}
                          </span>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge className="shrink-0" variant="neutral">
                              <span className="inline-flex items-center gap-1">
                                <KindIcon className="h-3 w-3" />
                                {kindMeta.label}
                              </span>
                            </Badge>
                            <Badge className="shrink-0" variant={statusMeta.tone}>
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
  );
}
