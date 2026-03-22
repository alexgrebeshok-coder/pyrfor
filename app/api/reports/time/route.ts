import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/reports/time — Time report data
 * 
 * Query params:
 * - projectId: Filter by project
 * - memberId: Filter by team member
 * - startDate: Start of period (default: 30 days ago)
 * - endDate: End of period (default: today)
 * - groupBy: Grouping ("day", "week", "month", "task", "member")
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const memberId = searchParams.get("memberId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const groupBy = searchParams.get("groupBy") || "day";

    // Default to last 30 days
    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    // Build where clause
    const where: any = {
      startTime: {
        gte: start,
        lte: end,
      },
      ...(memberId && { memberId }),
      ...(projectId && {
        task: { projectId },
      }),
    };

    // Get time entries
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
      orderBy: { startTime: "asc" },
    });

    const normalizedEntries = entries.map((entry) => ({
      ...entry,
      task: entry.task,
      member: entry.member,
    }));

    // Group data
    const groupedData = groupEntries(normalizedEntries, groupBy);

    // Calculate totals
    const totals = {
      totalEntries: normalizedEntries.length,
      totalSeconds: normalizedEntries.reduce((sum, e) => sum + (e.duration || 0), 0),
      billableSeconds: normalizedEntries
        .filter((e) => e.billable)
        .reduce((sum, e) => sum + (e.duration || 0), 0),
    };

    return NextResponse.json({
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      totals: {
        ...totals,
        totalHours: totals.totalSeconds / 3600,
        billableHours: totals.billableSeconds / 3600,
      },
      grouped: groupedData,
    });
  } catch (error) {
    console.error("[Time Report API] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate time report" },
      { status: 500 }
    );
  }
}

/**
 * Group time entries by specified dimension
 */
function groupEntries(entries: any[], groupBy: string): Record<string, any> {
  if (entries.length === 0) return {};
  
  const groups: Record<string, any> = {};
  
  for (const entry of entries) {
    let key: string;
    let label: string;

    switch (groupBy) {
      case "day":
        const date = entry.startTime.toISOString().split("T")[0];
        key = date;
        label = new Date(date).toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "short",
        });
        break;

      case "week":
        const week = getWeekNumber(entry.startTime);
        key = `week-${week}`;
        label = `Неделя ${week}`;
        break;

      case "month":
        const month = entry.startTime.toISOString().slice(0, 7);
        key = month;
        label = new Date(month + "-01").toLocaleDateString("ru-RU", {
          month: "long",
        });
        break;

      case "task":
        key = entry.taskId;
        label = entry.task?.title || "Unknown";
        break;

      case "member":
        key = entry.memberId || "unassigned";
        label = entry.member?.name || "Не назначен";
        break;

      default:
        key = "all";
        label = "Все";
    }

    if (!groups[key]) {
      groups[key] = {
        label,
        entries: [],
        totalSeconds: 0,
        billableSeconds: 0,
      };
    }

    groups[key].entries.push(entry);
    groups[key].totalSeconds += entry.duration || 0;
    if (entry.billable) {
      groups[key].billableSeconds += entry.duration || 0;
    }
  }

  // Add hours to each group
  for (const key of Object.keys(groups)) {
    groups[key].totalHours = groups[key].totalSeconds / 3600;
    groups[key].billableHours = groups[key].billableSeconds / 3600;
  }

  return groups;
}

/**
 * Get ISO week number
 */
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
