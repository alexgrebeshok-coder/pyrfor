import { CalendarView } from "@/components/calendar/calendar-view";
import { prisma } from "@/lib/prisma";
import {
  createCalendarMilestoneEvent,
  createCalendarTaskEvent,
  sortCalendarEvents,
} from "@/lib/calendar-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const [tasks, milestones] = await Promise.all([
    prisma.task.findMany({
      select: {
        id: true,
        title: true,
        dueDate: true,
        status: true,
        projectId: true,
        project: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { dueDate: "asc" },
    }),
    prisma.milestone.findMany({
      select: {
        id: true,
        title: true,
        date: true,
        status: true,
        projectId: true,
        project: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { date: "asc" },
    }),
  ]);

  const initialEvents = sortCalendarEvents([
    ...tasks.map((task) =>
      createCalendarTaskEvent({
        id: task.id,
        title: task.title,
        dueDate: task.dueDate,
        status: task.status,
        projectId: task.projectId,
        projectName: task.project.name,
      })
    ),
    ...milestones.map((milestone) =>
      createCalendarMilestoneEvent({
        id: milestone.id,
        title: milestone.title,
        date: milestone.date,
        status: milestone.status,
        projectId: milestone.projectId,
        projectName: milestone.project.name,
      })
    ),
  ]);

  return (
    <div className="container mx-auto py-6" data-testid="calendar-page">
      <div className="mb-6">
        <h1 className="text-xl font-bold">Calendar</h1>
        <p className="mt-2 text-[var(--ink-muted)]">
          Live task deadlines and milestones
        </p>
      </div>

      <CalendarView initialEvents={initialEvents} />
    </div>
  );
}
