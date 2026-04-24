"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadExecutiveSnapshotSafe = loadExecutiveSnapshotSafe;
const snapshot_1 = require("./snapshot");
async function loadExecutiveSnapshotSafe(filter = {}) {
    try {
        const snapshot = await (0, snapshot_1.loadExecutiveSnapshot)(filter);
        return { snapshot, usingFallback: false };
    }
    catch (error) {
        console.error("[loadExecutiveSnapshotSafe] Failed to load live snapshot, returning empty state:", error);
        return {
            snapshot: {
                generatedAt: normalizeGeneratedAt(filter.generatedAt),
                projects: [],
                tasks: [],
                risks: [],
                milestones: [],
                workReports: [],
                teamMembers: [],
            },
            usingFallback: true,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
function normalizeGeneratedAt(value) {
    if (!value) {
        return new Date().toISOString();
    }
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
