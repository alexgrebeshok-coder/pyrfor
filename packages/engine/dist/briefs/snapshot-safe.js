var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { loadExecutiveSnapshot } from "./snapshot.js";
export function loadExecutiveSnapshotSafe() {
    return __awaiter(this, arguments, void 0, function* (filter = {}) {
        try {
            const snapshot = yield loadExecutiveSnapshot(filter);
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
    });
}
function normalizeGeneratedAt(value) {
    if (!value) {
        return new Date().toISOString();
    }
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
