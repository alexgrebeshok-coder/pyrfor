"use strict";
/**
 * Daily overallocation calculator
 * Reads ResourceAssignment + Task dates → daily load per resource
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDailyLoad = calculateDailyLoad;
exports.getOverallocationSummary = getOverallocationSummary;
const db_1 = require("../db");
/**
 * Calculate daily resource load for a project within a date range
 */
async function calculateDailyLoad(projectId, startDate, endDate) {
    const assignments = await db_1.prisma.resourceAssignment.findMany({
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
    const loadMap = new Map();
    for (const a of assignments) {
        const resourceId = a.memberId || a.equipmentId;
        if (!resourceId)
            continue;
        const resourceName = a.member?.name || a.equipment?.name || "Unknown";
        const resourceType = a.memberId
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
        const entry = loadMap.get(resourceId);
        // Determine assignment date range
        const aStart = a.startDate || a.task.startDate || startDate;
        const aEnd = a.endDate || a.task.dueDate || endDate;
        if (!aStart || !aEnd)
            continue;
        const units = (a.units ?? 100) / 100;
        const dailyHours = 8 * units;
        // Walk each day
        const cursor = new Date(Math.max(aStart.getTime(), startDate.getTime()));
        const limit = new Date(Math.min(aEnd.getTime(), endDate.getTime()));
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
    const results = [];
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
    return results.sort((a, b) => a.date.localeCompare(b.date) || a.resourceId.localeCompare(b.resourceId));
}
/**
 * Get summary: overallocated days per resource
 */
async function getOverallocationSummary(projectId, startDate, endDate) {
    const daily = await calculateDailyLoad(projectId, startDate, endDate);
    const summary = new Map();
    for (const d of daily) {
        if (!d.overallocated)
            continue;
        const existing = summary.get(d.resourceId) || {
            name: d.resourceName,
            days: 0,
            maxOverload: 0,
        };
        existing.days++;
        existing.maxOverload = Math.max(existing.maxOverload, d.allocatedHours - d.capacityHours);
        summary.set(d.resourceId, existing);
    }
    return Array.from(summary.entries()).map(([resourceId, s]) => ({
        resourceId,
        resourceName: s.name,
        overallocatedDays: s.days,
        maxOverload: Math.round(s.maxOverload * 100) / 100,
    }));
}
