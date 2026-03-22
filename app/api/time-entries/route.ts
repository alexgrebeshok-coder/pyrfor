import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { badRequest, databaseUnavailable, notFound, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

/**
 * GET /api/time-entries — List time entries
 * POST /api/time-entries — Start timer (create time entry)
 */

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();
    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const memberId = searchParams.get("memberId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const entries = await prisma.timeEntry.findMany({
      where: {
        ...(taskId && { taskId }),
        ...(memberId && { memberId }),
        ...(startDate && {
          startTime: { gte: new Date(startDate) },
        }),
        ...(endDate && {
          startTime: { lte: new Date(endDate) },
        }),
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            project: { select: { id: true, name: true } },
          },
        },
        member: {
          select: { id: true, name: true, initials: true },
        },
      },
      orderBy: { startTime: "desc" },
    });

    return NextResponse.json(
      entries.map((entry) => ({
        ...entry,
        task: entry.task,
        member: entry.member,
      }))
    );
  } catch (error) {
    console.error("[Time Entries API] Error:", error);
    return serverError(error, "Failed to fetch time entries");
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();
    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const body = await request.json();
    const { taskId, memberId, description, billable = true } = body;

    if (!taskId) {
      return badRequest("taskId is required");
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true },
    });

    if (!task) {
      return notFound("Task not found");
    }

    if (memberId) {
      const member = await prisma.teamMember.findUnique({
        where: { id: memberId },
        select: { id: true },
      });

      if (!member) {
        return notFound("Member not found");
      }
    }

    const activeEntry = await prisma.timeEntry.findFirst({
      where: {
        taskId,
        memberId: memberId || null,
        endTime: null,
      },
    });

    if (activeEntry) {
      return badRequest("Timer already running for this task", "TIMER_ALREADY_RUNNING", {
        activeEntry,
      });
    }

    const entryData: Prisma.TimeEntryUncheckedCreateInput = {
      id: randomUUID(),
      taskId,
      memberId: memberId ?? null,
      startTime: new Date(),
      description: description ?? null,
      billable,
      updatedAt: new Date(),
    };

    const entry = await prisma.timeEntry.create({
      data: entryData,
      include: {
        task: {
          select: { id: true, title: true },
        },
        member: {
          select: { id: true, name: true, initials: true },
        },
      },
    });

    return NextResponse.json(
      {
        ...entry,
        task: entry.task,
        member: entry.member,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Time Entries API] Error:", error);
    return serverError(error, "Failed to start timer");
  }
}
