import { describe, expect, it } from "vitest";

import {
  buildStage1DemoLinks,
  isDeterministicDemoAI,
  isRegistrationFreeDemo,
  pickStage1DemoReport,
} from "@/lib/demo/stage1";

describe("stage1 demo helpers", () => {
  it("prefers the seeded construction report", () => {
    const report = pickStage1DemoReport([
      {
        id: "report-1",
        reportNumber: "#202603190001",
        projectId: "project-1",
        status: "submitted",
        project: { name: "Other project" },
      },
      {
        id: "report-2",
        reportNumber: "#202603190002",
        projectId: "project-2",
        status: "approved",
        project: { name: "Строительство распределительного центра «Восток»" },
      },
      {
        id: "report-3",
        reportNumber: "#202603190003",
        projectId: "project-3",
        status: "submitted",
        project: { name: "Строительство распределительного центра «Восток»" },
      },
    ]);

    expect(report?.id).toBe("report-3");
  });

  it("builds guided links with the report and project identifiers", () => {
    const links = buildStage1DemoLinks({
      id: "report-3",
      reportNumber: "#202603190003",
      projectId: "project-3",
      project: { name: "Строительство распределительного центра «Восток»" },
    });

    expect(links.portfolioHref).toContain("/projects?");
    expect(links.workReportsHref).toContain("demo=stage1");
    expect(links.workReportsHref).toContain("reportId=report-3");
    expect(links.workReportsHref).toContain("query=%23202603190003");
    expect(links.tasksHref).toContain("projectId=project-3");
  });

  it("reads the demo mode flags from env", () => {
    expect(isRegistrationFreeDemo({ NODE_ENV: "development", CEOCLAW_SKIP_AUTH: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isDeterministicDemoAI({ SEOCLAW_AI_MODE: "mock" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
