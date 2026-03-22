import { loadExecutiveSnapshot } from "./snapshot";
import type { ExecutiveSnapshot } from "./types";

export async function loadExecutiveSnapshotSafe(
  filter: { projectId?: string; generatedAt?: string | Date } = {}
): Promise<{ snapshot: ExecutiveSnapshot; usingFallback: boolean; error?: string }> {
  try {
    const snapshot = await loadExecutiveSnapshot(filter);
    return { snapshot, usingFallback: false };
  } catch (error) {
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

function normalizeGeneratedAt(value?: string | Date): string {
  if (!value) {
    return new Date().toISOString();
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
