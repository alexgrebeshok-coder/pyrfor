import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { serverError, serviceUnavailable } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

/**
 * GET /api/analytics/team-performance — Team performance metrics
 * 
 * Query params:
 * - projectId: Filter by project (optional)
 * - startDate: Start of period (optional)
 * - endDate: End of period (optional)
 */

export async function GET(request: NextRequest) {
  try {
    const runtime = getServerRuntimeState();

    if (!runtime.databaseConfigured) {
      return serviceUnavailable(
        "DATABASE_URL is not configured for live mode.",
        "DATABASE_UNAVAILABLE",
        { dataMode: runtime.dataMode }
      );
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    // Get team members with their tasks
    const members = await prisma.teamMember.findMany({
      include: {
        tasks: {
          where: projectId ? { projectId } : undefined,
          select: {
            id: true,
            status: true,
            priority: true,
            dueDate: true,
          },
        },
        timeEntries: {
          select: {
            duration: true,
            billable: true,
            task: {
              select: { projectId: true },
            },
          },
        },
      },
    });

    // Filter time entries by project if needed
    const filteredMembers = members.map((member) => {
      const { tasks, timeEntries, ...rest } = member;
      const filteredEntries = projectId
        ? timeEntries.filter((e) => e.task?.projectId === projectId)
        : timeEntries;

      return {
        ...rest,
        timeEntries: filteredEntries,
        tasks,
      };
    });

    // Calculate performance for each member
    const performance = filteredMembers.map((member) => {
      const tasks = member.tasks;
      const timeEntries = member.timeEntries;

      // Task metrics
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter((t) => t.status === "done").length;
      const inProgressTasks = tasks.filter((t) => t.status === "in_progress").length;
      const overdueTasks = tasks.filter(
        (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "done"
      ).length;

      // Time metrics
      const totalHoursLogged = timeEntries.reduce(
        (sum, e) => sum + (e.duration || 0) / 3600,
        0
      );
      const billableHours = timeEntries
        .filter((e) => e.billable)
        .reduce((sum, e) => sum + (e.duration || 0) / 3600, 0);

      // Task completion rate
      const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

      // Performance score (0-100)
      const performanceScore = calculatePerformanceScore({
        completionRate,
        overdueRate: totalTasks > 0 ? overdueTasks / totalTasks : 0,
      });

      return {
        memberId: member.id,
        memberName: member.name,
        memberInitials: member.initials,
        role: member.role,
        metrics: {
          totalTasks,
          completedTasks,
          inProgressTasks,
          overdueTasks,
          completionRate: Math.round(completionRate),
        },
        time: {
          totalHoursLogged: Math.round(totalHoursLogged * 10) / 10,
          billableHours: Math.round(billableHours * 10) / 10,
        },
        performanceScore,
      };
    });

    // Sort by performance score (descending)
    performance.sort((a, b) => b.performanceScore - a.performanceScore);

    // Team summary
    const summary = {
      totalMembers: members.length,
      totalTasks: performance.reduce((sum, m) => sum + m.metrics.totalTasks, 0),
      totalCompleted: performance.reduce(
        (sum, m) => sum + m.metrics.completedTasks,
        0
      ),
      totalHoursLogged: performance.reduce(
        (sum, m) => sum + m.time.totalHoursLogged,
        0
      ),
      avgPerformanceScore:
        members.length > 0
          ? Math.round(
              performance.reduce((sum, m) => sum + m.performanceScore, 0) /
                members.length
            )
          : 0,
    };

    return NextResponse.json({
      summary,
      members: performance,
    });
  } catch (error) {
    console.error("[Team Performance API] Error:", error);
    return serverError(error, "Failed to fetch analytics team performance.");
  }
}

/**
 * Calculate member performance score (0-100)
 */
function calculatePerformanceScore(data: {
  completionRate: number;
  overdueRate: number;
}): number {
  let score = 0;

  // Completion rate (0-70 points)
  score += data.completionRate * 0.7;

  // Overdue penalty (0-30 points)
  score -= data.overdueRate * 30;

  return Math.max(0, Math.min(100, Math.round(score)));
}
