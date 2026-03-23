import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyOnboardingTemplate,
  buildOnboardingAiPrompt,
  buildOnboardingDashboardState,
  buildOnboardingProjectPayload,
  buildOnboardingTaskPayloads,
  buildOnboardingTeamPayloads,
  createInitialOnboardingDraft,
  getRoleLabel,
  getTemplateById,
} from "@/lib/onboarding";

describe("onboarding helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-02-01T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a default draft from the universal template", () => {
    const draft = createInitialOnboardingDraft();

    expect(draft.role).toBe("PM");
    expect(draft.templateId).toBe("universal");
    expect(draft.projectName).toBe(getTemplateById("universal").defaultProjectName);
    expect(draft.tasks).toHaveLength(3);
    expect(draft.aiQuestion).toContain("2 недели");
    expect(draft.startDate).toBe("2025-02-01");
    expect(draft.endDate).toBe("2025-04-02");
  });

  it("maps template selection into a fresh draft while preserving role", () => {
    const draft = createInitialOnboardingDraft("EXEC", "universal");
    const nextDraft = applyOnboardingTemplate(draft, "construction");

    expect(nextDraft.role).toBe("EXEC");
    expect(nextDraft.templateId).toBe("construction");
    expect(nextDraft.projectName).toBe(getTemplateById("construction").defaultProjectName);
    expect(nextDraft.tasks).toHaveLength(3);
    expect(nextDraft.aiQuestion).toContain("Строительство");
  });

  it("builds project, team and task payloads from the current draft", () => {
    const draft = applyOnboardingTemplate(createInitialOnboardingDraft("PM"), "software");
    const teamPayloads = buildOnboardingTeamPayloads(draft);
    const projectPayload = buildOnboardingProjectPayload(draft, teamPayloads.map((item, index) => `team-${index + 1}`));
    const taskPayloads = buildOnboardingTaskPayloads(draft, "project-123", ["team-1", "team-2"]);

    expect(teamPayloads).toHaveLength(3);
    expect(teamPayloads[0]).toMatchObject({
      name: expect.stringContaining("Software"),
      capacity: 100,
    });
    expect(projectPayload).toMatchObject({
      name: draft.projectName,
      direction: getTemplateById("software").direction,
      status: "active",
      teamIds: ["team-1", "team-2", "team-3"],
    });
    expect(taskPayloads).toHaveLength(3);
    expect(taskPayloads[0]).toMatchObject({
      projectId: "project-123",
      assigneeId: "team-1",
      status: "todo",
    });
    expect(taskPayloads[1].assigneeId).toBe("team-2");
    expect(taskPayloads[2].assigneeId).toBe("team-1");
  });

  it("builds a prompt that includes the role, template, budget and question", () => {
    const draft = applyOnboardingTemplate(createInitialOnboardingDraft("CURATOR"), "marketing");
    draft.aiQuestion = "Как быстро проверить эффективность кампании?";
    const prompt = buildOnboardingAiPrompt(draft);

    expect(prompt).toContain(getRoleLabel("CURATOR"));
    expect(prompt).toContain(getTemplateById("marketing").label);
    expect(prompt).toContain(draft.aiQuestion);
    expect(prompt).toMatch(/бюджет/i);
    expect(prompt).toContain(draft.projectName);
  });

  it("creates a useful dashboard preview state", () => {
    const draft = applyOnboardingTemplate(createInitialOnboardingDraft("SOLO"), "consulting");
    const state = buildOnboardingDashboardState(draft);

    expect(state.currentUser.role).toBe("SOLO");
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0].id).toBe("onboarding-consulting");
    expect(state.team).toHaveLength(3);
    expect(state.tasks).toHaveLength(3);
    expect(state.team[0].projects).toContain(draft.projectName);
    expect(state.auditLogEntries[0].details).toContain("starter task");
  });
});
