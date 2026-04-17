import type { Project } from "@/lib/types";

export interface DashboardLocationContour {
  location: string;
  attentionCount: number;
  progress: number;
  projectCount: number;
  summary: string;
  tone: "danger" | "neutral" | "success" | "warning";
}

export function formatRussianCount(value: number, one: string, few: string, many: string) {
  const remainder100 = value % 100;
  const remainder10 = value % 10;

  if (remainder100 >= 11 && remainder100 <= 14) {
    return many;
  }

  if (remainder10 === 1) {
    return one;
  }

  if (remainder10 >= 2 && remainder10 <= 4) {
    return few;
  }

  return many;
}

export function buildPortfolioTrend(
  projects: Project[],
  formatDateLocalized: (date: string, pattern?: string) => string
) {
  if (!projects.length) return [];

  const longestHistory = Math.max(...projects.map((project) => project.history.length));
  return Array.from({ length: longestHistory }, (_, index) => {
    const points = projects.map((project) => project.history[index]).filter(Boolean);

    return {
      name: points[0]?.date ? formatDateLocalized(points[0].date) : `P${index + 1}`,
      progress: Math.round(
        points.reduce((sum, point) => sum + point.progress, 0) / Math.max(points.length, 1)
      ),
      actual: Math.round(points.reduce((sum, point) => sum + point.budgetActual, 0) / 1000),
      planned: Math.round(points.reduce((sum, point) => sum + point.budgetPlanned, 0) / 1000),
    };
  });
}

export function buildLocationContours(
  projects: Project[],
  notifications: Array<{ projectId?: string; severity: "critical" | "info" | "warning" }>
): DashboardLocationContour[] {
  const notificationsByProject = new Map<string, number>();

  for (const notification of notifications) {
    if (!notification.projectId || notification.severity === "info") {
      continue;
    }

    notificationsByProject.set(
      notification.projectId,
      (notificationsByProject.get(notification.projectId) ?? 0) + 1
    );
  }

  const grouped = new Map<
    string,
    { attentionCount: number; progressTotal: number; projectCount: number }
  >();

  for (const project of projects) {
    if (!project.location) {
      continue;
    }

    const attentionSignals =
      (project.status === "at-risk" ? 1 : 0) +
      (project.health < 60 ? 1 : 0) +
      (notificationsByProject.get(project.id) ?? 0);

    const current = grouped.get(project.location) ?? {
      attentionCount: 0,
      progressTotal: 0,
      projectCount: 0,
    };

    current.attentionCount += attentionSignals;
    current.progressTotal += project.progress;
    current.projectCount += 1;
    grouped.set(project.location, current);
  }

  return Array.from(grouped.entries())
    .map(([location, entry]) => {
      const progress = Math.round(entry.progressTotal / Math.max(entry.projectCount, 1));
      const tone: DashboardLocationContour["tone"] =
        entry.attentionCount >= 3
          ? "danger"
          : entry.attentionCount >= 2
            ? "warning"
            : entry.attentionCount === 1
              ? "neutral"
              : "success";
      const summary =
        entry.attentionCount > 0
          ? `${formatRussianCount(
              entry.attentionCount,
              "Сигнал внимания",
              "Сигнала внимания",
              "Сигналов внимания"
            )}`
          : "Ритм стабилен";

      return {
        location,
        attentionCount: entry.attentionCount,
        progress,
        projectCount: entry.projectCount,
        summary,
        tone,
      };
    })
    .sort((left, right) => {
      if (right.attentionCount !== left.attentionCount) {
        return right.attentionCount - left.attentionCount;
      }

      if (right.projectCount !== left.projectCount) {
        return right.projectCount - left.projectCount;
      }

      return left.location.localeCompare(right.location, "ru");
    });
}
