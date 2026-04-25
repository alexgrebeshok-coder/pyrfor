/**
 * Daily overallocation calculator
 * Reads ResourceAssignment + Task dates → daily load per resource
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../db.js';
/**
 * Calculate daily resource load for a project within a date range
 */
export function calculateDailyLoad(projectId, startDate, endDate) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const assignments = yield prisma.resourceAssignment.findMany({
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
            const resourceName = ((_a = a.member) === null || _a === void 0 ? void 0 : _a.name) || ((_b = a.equipment) === null || _b === void 0 ? void 0 : _b.name) || "Unknown";
            const resourceType = a.memberId
                ? "member"
                : "equipment";
            const capacityHours = ((_c = a.member) === null || _c === void 0 ? void 0 : _c.capacity)
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
            const units = ((_d = a.units) !== null && _d !== void 0 ? _d : 100) / 100;
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
    });
}
/**
 * Get summary: overallocated days per resource
 */
export function getOverallocationSummary(projectId, startDate, endDate) {
    return __awaiter(this, void 0, void 0, function* () {
        const daily = yield calculateDailyLoad(projectId, startDate, endDate);
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
    });
}
