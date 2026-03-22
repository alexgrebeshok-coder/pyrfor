import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { databaseUnavailable, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

type ProjectStatsBucket = {
  project: { id: string; name: string } | null;
  totalSeconds: number;
  entryCount: number;
};

type MemberStatsBucket = {
  member: { id: string; name: string; initials: string | null } | null;
  totalSeconds: number;
  entryCount: number;
};

type TaskStatsBucket = {
  task: { id: string; title: string };
  totalSeconds: number;
  entryCount: number;
};

/**
 * GET /api/time-entries/stats — Time tracking statistics
 * 
 * Query params:
 * - projectId: Filter by project
 * - memberId: Filter by team member
 * - startDate: Start of period
 * - endDate: End of period
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
    const projectId = searchParams.get("projectId");
    const memberId = searchParams.get("memberId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const where: {
      memberId?: string;
      startTime?: { gte?: Date; lte?: Date };
      task?: { projectId?: string };
    } = {};

    if (memberId) {
      where.memberId = memberId;
    }

    if (projectId) {
      where.task = { projectId };
    }

    if (startDate || endDate) {
      where.startTime = {};
      if (startDate) where.startTime.gte = new Date(startDate);
      if (endDate) where.startTime.lte = new Date(endDate);
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            projectId: true,
            project: { select: { id: true, name: true } },
          },
        },
        member: {
          select: { id: true, name: true, initials: true },
        },
      },
    });

    const totalSeconds = entries.reduce(
      (sum, e) => sum + (e.duration || 0),
      0
    );

    const billableSeconds = entries
      .filter((e) => e.billable)
      .reduce((sum, e) => sum + (e.duration || 0), 0);

    const byProject = entries.reduce((acc, e) => {
      const projectId = e.task.projectId;
      if (!acc[projectId]) {
        acc[projectId] = {
          project: e.task.project,
          totalSeconds: 0,
          entryCount: 0,
        };
      }
      acc[projectId].totalSeconds += e.duration || 0;
      acc[projectId].entryCount++;
      return acc;
    }, {} as Record<string, ProjectStatsBucket>);

    const byMember = entries.reduce((acc, e) => {
      const memberId = e.memberId || "unassigned";
      if (!acc[memberId]) {
        acc[memberId] = {
          member: e.member,
          totalSeconds: 0,
          entryCount: 0,
        };
      }
      acc[memberId].totalSeconds += e.duration || 0;
      acc[memberId].entryCount++;
      return acc;
    }, {} as Record<string, MemberStatsBucket>);

    const byTask = entries.reduce((acc, e) => {
      const taskId = e.taskId;
      if (!acc[taskId]) {
        acc[taskId] = {
          task: { id: e.task.id, title: e.task.title },
          totalSeconds: 0,
          entryCount: 0,
        };
      }
      acc[taskId].totalSeconds += e.duration || 0;
      acc[taskId].entryCount++;
      return acc;
    }, {} as Record<string, TaskStatsBucket>);

    return NextResponse.json({
      summary: {
        totalEntries: entries.length,
        totalHours: Math.round((totalSeconds / 3600) * 100) / 100,
        totalSeconds,
        billableHours: Math.round((billableSeconds / 3600) * 100) / 100,
        billableSeconds,
      },
      byProject: Object.values(byProject),
      byMember: Object.values(byMember),
      byTask: Object.values(byTask),
    });
  } catch (error) {
    console.error("[Time Stats API] Error:", error);
    return serverError(error, "Failed to fetch time statistics");
  }
}
