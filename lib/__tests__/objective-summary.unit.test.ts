import { describe, expect, it } from "vitest";

import { summarizeObjectiveThemes } from "@/lib/goals/objective-summary";
import type { Project } from "@/lib/types";

const projects = [
  {
    id: "project-1",
    name: "Мост",
    objectives: ["Стабилизировать поставку", "Снизить перерасход", "Стабилизировать поставку"],
  },
  {
    id: "project-2",
    name: "Логистика",
    objectives: ["Стабилизировать поставку", "Обновить отчётность"],
  },
  {
    id: "project-3",
    name: "Пустой",
    objectives: [],
  },
] as unknown as Project[];

describe("summarizeObjectiveThemes", () => {
  it("counts recurring themes and coverage correctly", () => {
    const summary = summarizeObjectiveThemes(projects);

    expect(summary.totalProjects).toBe(3);
    expect(summary.coveredProjects).toBe(2);
    expect(summary.coveragePercent).toBe(67);
    expect(summary.themes).toHaveLength(3);
    expect(summary.themes[0]).toMatchObject({
      objective: "Стабилизировать поставку",
      count: 2,
      projectCount: 2,
    });
  });
});
