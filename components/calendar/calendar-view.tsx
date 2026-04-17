"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { DataErrorState } from "@/components/ui/data-error-state";
import { api } from "@/lib/client/api-error";
import type { CalendarEvent } from "@/lib/calendar-events";
import { cn } from "@/lib/utils";

import { CalendarEventDialog } from "./calendar-event-dialog";
import { CalendarMonthGrid } from "./calendar-month-grid";
import { CalendarViewEmptyState } from "./calendar-view-empty-state";
import { CalendarViewLegend } from "./calendar-view-legend";
import { CalendarViewLoadingState } from "./calendar-view-loading-state";
import { buildEventsByDate, getDaysInMonth, getMonthLabel } from "./calendar-view.utils";

const monthNavButtonClassName = cn(
  "rounded-lg border border-[var(--line)] p-2 transition-all duration-200",
  "hover:bg-[var(--surface-secondary)] hover:scale-105",
  "active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
);

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

  const days = useMemo(() => getDaysInMonth(currentDate), [currentDate]);
  const eventsByDate = useMemo(() => buildEventsByDate(events), [events]);
  const monthLabel = getMonthLabel(currentDate);

  if (loading) {
    return <CalendarViewLoadingState />;
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
            aria-label="Previous month"
            className={monthNavButtonClassName}
            disabled={isAnimating}
            onClick={() => handleMonthChange("prev")}
            type="button"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            aria-label="Next month"
            className={monthNavButtonClassName}
            disabled={isAnimating}
            onClick={() => handleMonthChange("next")}
            type="button"
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

      {!error && events.length === 0 ? <CalendarViewEmptyState /> : null}

      {!error ? (
        <CalendarMonthGrid
          currentDate={currentDate}
          days={days}
          eventsByDate={eventsByDate}
          isAnimating={isAnimating}
          onSelectEvent={setSelectedEvent}
        />
      ) : null}

      <CalendarViewLegend />

      <CalendarEventDialog
        onClose={() => setSelectedEvent(null)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEvent(null);
          }
        }}
        selectedEvent={selectedEvent}
      />
    </div>
  );
});
