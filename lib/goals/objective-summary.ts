import type { Project } from "@/lib/types";

export type ObjectiveTheme = {
  objective: string;
  count: number;
  projectCount: number;
  projectNames: string[];
};

export type ObjectiveSummary = {
  themes: ObjectiveTheme[];
  coveredProjects: number;
  coveragePercent: number;
  totalProjects: number;
};

export function summarizeObjectiveThemes(projects: Project[]): ObjectiveSummary {
  const themes = new Map<
    string,
    {
      objective: string;
      count: number;
      projectIds: Set<string>;
      projectNames: Set<string>;
    }
  >();

  let coveredProjects = 0;

  for (const project of projects) {
    const uniqueObjectives = new Set(
      project.objectives
        .map((objective) => objective.trim())
        .filter((objective) => objective.length > 0)
    );

    if (uniqueObjectives.size > 0) {
      coveredProjects += 1;
    }

    for (const objective of uniqueObjectives) {
      const existing = themes.get(objective);
      if (existing) {
        existing.count += 1;
        existing.projectIds.add(project.id);
        existing.projectNames.add(project.name);
        continue;
      }

      themes.set(objective, {
        objective,
        count: 1,
        projectIds: new Set([project.id]),
        projectNames: new Set([project.name]),
      });
    }
  }

  const sortedThemes = Array.from(themes.values())
    .map((theme) => ({
      objective: theme.objective,
      count: theme.count,
      projectCount: theme.projectIds.size,
      projectNames: Array.from(theme.projectNames),
    }))
    .sort((left, right) => right.count - left.count || left.objective.localeCompare(right.objective));

  return {
    themes: sortedThemes,
    coveredProjects,
    coveragePercent: projects.length > 0 ? Math.round((coveredProjects / projects.length) * 100) : 0,
    totalProjects: projects.length,
  };
}
