import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { databaseUnavailable, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import {
  createCalendarMilestoneEvent,
  createCalendarTaskEvent,
  sortCalendarEvents,
  type CalendarEvent,
} from "@/lib/calendar-events";

function parseDateParam(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: NextRequest) {
  try {
    const runtime = getServerRuntimeState();

    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { searchParams } = new URL(request.url);
    const rawStartDate = searchParams.get("startDate");
    const rawEndDate = searchParams.get("endDate");
    const startDate = parseDateParam(rawStartDate);
    const endDate = parseDateParam(rawEndDate);

    if ((rawStartDate && !startDate) || (rawEndDate && !endDate)) {
      return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
    }

    const where: Prisma.TaskWhereInput = {};
    const dueDateFilter: Prisma.DateTimeFilter = {};
    const milestoneDateFilter: Prisma.DateTimeFilter = {};

    if (startDate) {
      dueDateFilter.gte = startDate;
      milestoneDateFilter.gte = startDate;
    }

    if (endDate) {
      dueDateFilter.lte = endDate;
      milestoneDateFilter.lte = endDate;
    }

    if (Object.keys(dueDateFilter).length > 0) {
      where.dueDate = dueDateFilter;
    }

    const milestoneWhere: Prisma.MilestoneWhereInput = {};
    if (Object.keys(milestoneDateFilter).length > 0) {
      milestoneWhere.date = milestoneDateFilter;
    }

    const [tasks, milestones] = await Promise.all([
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          dueDate: true,
          status: true,
          projectId: true,
          project: { select: { name: true } },
        },
        orderBy: { dueDate: "asc" },
      }),
      prisma.milestone.findMany({
        where: milestoneWhere,
        select: {
          id: true,
          title: true,
          date: true,
          status: true,
          projectId: true,
          project: { select: { name: true } },
        },
        orderBy: { date: "asc" },
      }),
    ]);

    const events: CalendarEvent[] = sortCalendarEvents([
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

    return NextResponse.json(events);
  } catch (error) {
    console.error("[Calendar API] Error:", error);
    return serverError(error, "Failed to fetch calendar events.");
  }
}
