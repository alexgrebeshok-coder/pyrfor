export type CalendarEventKind = "task" | "milestone";

export interface CalendarEventResource {
  projectId: string;
  projectName: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: true;
  color: string;
  status: string;
  kind: CalendarEventKind;
  resource: CalendarEventResource;
}

export interface CalendarTaskSource {
  id: string;
  title: string;
  dueDate: string | Date;
  status: string;
  projectId: string;
  projectName: string;
}

export interface CalendarMilestoneSource {
  id: string;
  title: string;
  date: string | Date;
  status: string;
  projectId: string;
  projectName: string;
}

function asIsoDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

export function getCalendarEventColor(kind: CalendarEventKind, status: string): string {
  if (kind === "milestone") {
    switch (status) {
      case "completed":
        return "#22c55e";
      case "overdue":
        return "#f43f5e";
      case "in_progress":
        return "#f59e0b";
      case "upcoming":
      default:
        return "#3b82f6";
    }
  }

  switch (status) {
    case "done":
      return "#22c55e";
    case "in_progress":
      return "#3b82f6";
    case "blocked":
      return "#f43f5e";
    case "todo":
      return "#94a3b8";
    default:
      return "#f59e0b";
  }
}

export function createCalendarTaskEvent(task: CalendarTaskSource): CalendarEvent {
  const start = asIsoDate(task.dueDate);

  return {
    id: task.id,
    title: task.title,
    start,
    end: start,
    allDay: true,
    color: getCalendarEventColor("task", task.status),
    status: task.status,
    kind: "task",
    resource: {
      projectId: task.projectId,
      projectName: task.projectName,
    },
  };
}

export function createCalendarMilestoneEvent(
  milestone: CalendarMilestoneSource
): CalendarEvent {
  const start = asIsoDate(milestone.date);

  return {
    id: milestone.id,
    title: milestone.title,
    start,
    end: start,
    allDay: true,
    color: getCalendarEventColor("milestone", milestone.status),
    status: milestone.status,
    kind: "milestone",
    resource: {
      projectId: milestone.projectId,
      projectName: milestone.projectName,
    },
  };
}

export function sortCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((left, right) => {
    const startCompare = left.start.localeCompare(right.start);
    if (startCompare !== 0) {
      return startCompare;
    }

    if (left.kind !== right.kind) {
      return left.kind === "milestone" ? -1 : 1;
    }

    return left.title.localeCompare(right.title);
  });
}
