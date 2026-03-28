/**
 * Internal calendar provider — reads tasks + milestones from database
 * This is the default "no external provider" mode
 */

import { prisma } from "@/lib/db";
import type {
  CalendarProvider,
  CalendarInfo,
  CalendarEvent,
  NewCalendarEvent,
} from "../calendar-provider";

export class InternalCalendarProvider implements CalendarProvider {
  readonly id = "internal";
  readonly name = "CEOClaw Tasks & Milestones";

  async listCalendars(): Promise<CalendarInfo[]> {
    return [
      {
        id: "tasks",
        name: "Tasks",
        primary: true,
        accessRole: "owner",
        color: "#3b82f6",
      },
      {
        id: "milestones",
        name: "Milestones",
        primary: false,
        accessRole: "owner",
        color: "#f59e0b",
      },
    ];
  }

  async listEvents(
    _credentialId: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date
  ): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];

    if (calendarId === "tasks" || calendarId === "all") {
      const tasks = await prisma.task.findMany({
        where: {
          OR: [
            {
              startDate: { gte: timeMin, lte: timeMax },
            },
            {
              dueDate: { gte: timeMin, lte: timeMax },
            },
          ],
        },
        select: {
          id: true,
          title: true,
          description: true,
          startDate: true,
          dueDate: true,
          status: true,
          projectId: true,
        },
        take: 200,
      });

      for (const task of tasks) {
        events.push({
          id: `task-${task.id}`,
          title: task.title,
          description: task.description || undefined,
          start: task.startDate || task.dueDate || timeMin,
          end: task.dueDate || task.startDate || timeMax,
          allDay: true,
          source: "internal",
          sourceCalendarId: "tasks",
          color: task.status === "done" ? "#22c55e" : "#3b82f6",
        });
      }
    }

    if (calendarId === "milestones" || calendarId === "all") {
      const milestones = await prisma.milestone.findMany({
        where: {
          date: { gte: timeMin, lte: timeMax },
        },
        select: {
          id: true,
          title: true,
          date: true,
          status: true,
          projectId: true,
        },
        take: 100,
      });

      for (const ms of milestones) {
        events.push({
          id: `milestone-${ms.id}`,
          title: `🏁 ${ms.title}`,
          start: ms.date,
          end: ms.date,
          allDay: true,
          source: "internal",
          sourceCalendarId: "milestones",
          color: ms.status === "completed" ? "#22c55e" : "#f59e0b",
        });
      }
    }

    return events.sort(
      (a, b) => a.start.getTime() - b.start.getTime()
    );
  }

  async createEvent(
    _credentialId: string,
    _calendarId: string,
    _event: NewCalendarEvent
  ): Promise<CalendarEvent> {
    throw new Error(
      "Internal calendar: create tasks via /api/tasks instead"
    );
  }

  async updateEvent(
    _credentialId: string,
    _calendarId: string,
    _eventId: string,
    _updates: Partial<NewCalendarEvent>
  ): Promise<CalendarEvent> {
    throw new Error(
      "Internal calendar: update tasks via /api/tasks/[id] instead"
    );
  }

  async deleteEvent(): Promise<void> {
    throw new Error(
      "Internal calendar: delete tasks via /api/tasks/[id] instead"
    );
  }
}
