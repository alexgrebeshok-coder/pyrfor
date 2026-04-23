/**
 * Daily overallocation calculator
 * Reads ResourceAssignment + Task dates → daily load per resource
 */

import { prisma } from '../db';

export interface DailyResourceLoad {
  date: string; // ISO date YYYY-MM-DD
  resourceId: string;
  resourceName: string;
  resourceType: "member" | "equipment";
  allocatedHours: number;
  capacityHours: number;
  overallocated: boolean;
}

/**
 * Calculate daily resource load for a project within a date range
 */
export async function calculateDailyLoad(
  projectId: string,
  startDate: Date,
  endDate: Date
): Promise<DailyResourceLoad[]> {
  const assignments = await prisma.resourceAssignment.findMany({
    where: {
      task: { projectId },
      OR: [
        {
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
        {
          startDate: null,
          task: {
            startDate: { lte: endDate },
            dueDate: { gte: startDate },
          },
        },
      ],
    },
    include: {
      task: {
        select: {
          startDate: true,
          dueDate: true,
          estimatedHours: true,
        },
      },
      member: {
        select: { id: true, name: true, capacity: true },
      },
      equipment: {
        select: { id: true, name: true },
      },
    },
  });

  // Build daily load map: resourceId → date → hours
  const loadMap = new Map<
    string,
    {
      name: string;
      type: "member" | "equipment";
      capacityHours: number;
      days: Map<string, number>;
    }
  >();

  for (const a of assignments) {
    const resourceId = a.memberId || a.equipmentId;
    if (!resourceId) continue;

    const resourceName =
      a.member?.name || a.equipment?.name || "Unknown";
    const resourceType: "member" | "equipment" = a.memberId
      ? "member"
      : "equipment";
    const capacityHours = a.member?.capacity
      ? (a.member.capacity / 100) * 8
      : 8;

    if (!loadMap.has(resourceId)) {
      loadMap.set(resourceId, {
        name: resourceName,
        type: resourceType,
        capacityHours,
        days: new Map(),
      });
    }

    const entry = loadMap.get(resourceId)!;

    // Determine assignment date range
    const aStart = a.startDate || a.task.startDate || startDate;
    const aEnd = a.endDate || a.task.dueDate || endDate;
    if (!aStart || !aEnd) continue;

    const units = (a.units ?? 100) / 100;
    const dailyHours = 8 * units;

    // Walk each day
    const cursor = new Date(
      Math.max(aStart.getTime(), startDate.getTime())
    );
    const limit = new Date(
      Math.min(aEnd.getTime(), endDate.getTime())
    );

    while (cursor <= limit) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) {
        // Skip weekends
        const key = cursor.toISOString().split("T")[0];
        entry.days.set(key, (entry.days.get(key) || 0) + dailyHours);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // Flatten to result array
  const results: DailyResourceLoad[] = [];
  for (const [resourceId, entry] of loadMap) {
    for (const [date, allocatedHours] of entry.days) {
      results.push({
        date,
        resourceId,
        resourceName: entry.name,
        resourceType: entry.type,
        allocatedHours: Math.round(allocatedHours * 100) / 100,
        capacityHours: entry.capacityHours,
        overallocated: allocatedHours > entry.capacityHours,
      });
    }
  }

  return results.sort(
    (a, b) => a.date.localeCompare(b.date) || a.resourceId.localeCompare(b.resourceId)
  );
}

/**
 * Get summary: overallocated days per resource
 */
export async function getOverallocationSummary(
  projectId: string,
  startDate: Date,
  endDate: Date
): Promise<
  Array<{
    resourceId: string;
    resourceName: string;
    overallocatedDays: number;
    maxOverload: number;
  }>
> {
  const daily = await calculateDailyLoad(projectId, startDate, endDate);
  const summary = new Map<
    string,
    { name: string; days: number; maxOverload: number }
  >();

  for (const d of daily) {
    if (!d.overallocated) continue;
    const existing = summary.get(d.resourceId) || {
      name: d.resourceName,
      days: 0,
      maxOverload: 0,
    };
    existing.days++;
    existing.maxOverload = Math.max(
      existing.maxOverload,
      d.allocatedHours - d.capacityHours
    );
    summary.set(d.resourceId, existing);
  }

  return Array.from(summary.entries()).map(([resourceId, s]) => ({
    resourceId,
    resourceName: s.name,
    overallocatedDays: s.days,
    maxOverload: Math.round(s.maxOverload * 100) / 100,
  }));
}
