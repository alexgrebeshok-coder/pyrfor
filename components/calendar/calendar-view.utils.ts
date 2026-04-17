import type { ComponentType } from "react";
import { Clock3, Flag } from "lucide-react";

import type { CalendarEvent } from "@/lib/calendar-events";

export const DAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
export const MONTHS = [
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

export const STATUS_META: Record<
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

export const KIND_META: Record<
  CalendarEvent["kind"],
  { label: string; icon: ComponentType<{ className?: string }> }
> = {
  task: { label: "Task", icon: Clock3 },
  milestone: { label: "Milestone", icon: Flag },
};

export const shortDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
});

export const longDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function getDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getStatusMeta(status: string) {
  return STATUS_META[status] ?? {
    label: status.replace(/_/g, " "),
    tone: "neutral" as const,
  };
}

export function getDaysInMonth(date: Date) {
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
}

export function buildEventsByDate(events: CalendarEvent[]) {
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
}

export function getMonthLabel(date: Date) {
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
