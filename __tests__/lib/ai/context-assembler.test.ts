import { describe, expect, it, vi } from "vitest";

import { assembleContext } from "@/lib/ai/context-assembler";

describe("context assembler", () => {
  it("assembles project-scoped server context with evidence and memory", async () => {
    const snapshot = createSnapshot();
    const evidence = createEvidence();
    const loadSnapshot = vi.fn().mockResolvedValue(snapshot);
    const loadEvidence = vi.fn().mockResolvedValue(evidence);
    const loadMemory = vi.fn().mockResolvedValue([createMemoryEntry()]);

    const result = await assembleContext(
      {
        projectId: "project-1",
        locale: "ru",
        includeEvidence: true,
        includeMemory: true,
      },
      {
        loadSnapshot,
        loadEvidence,
        loadMemory,
      }
    );

    expect(result.scope).toBe("project");
    expect(result.projectId).toBe("project-1");
    expect(result.project?.name).toBe("Склад Южный");
    expect(result.alertFeed.scope).toBe("project");
    expect(result.evidence?.summary.total).toBe(1);
    expect(result.memory).toHaveLength(1);
    expect(result.issues).toEqual([]);
    expect(result.planFact).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        projectName: "Склад Южный",
      })
    );
    expect(loadSnapshot).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(loadEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 5,
        projectId: "project-1",
      })
    );
    expect(loadMemory).toHaveBeenCalledWith("project-1");
  });

  it("falls back to a mock snapshot in non-production when live data is empty", async () => {
    const liveSnapshot = createEmptySnapshot();
    const mockSnapshot = createSnapshot();

    const result = await assembleContext(
      {
        projectId: "project-1",
      },
      {
        loadSnapshot: vi.fn().mockResolvedValue(liveSnapshot),
        loadMockSnapshot: vi.fn().mockResolvedValue(mockSnapshot),
      }
    );

    expect(result.source).toBe("mock");
    expect(result.projectId).toBe("project-1");
  });

  it("throws when the requested project does not exist in the assembled snapshot", async () => {
    await expect(
      assembleContext(
        {
          projectId: "missing-project",
        },
        {
          loadSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
        }
      )
    ).rejects.toThrow('Project "missing-project" was not found.');
  });

  it("records memory issues without failing the full assembly", async () => {
    const result = await assembleContext(
      {
        projectId: "project-1",
        includeMemory: true,
      },
      {
        loadSnapshot: vi.fn().mockResolvedValue(createSnapshot()),
        loadMemory: vi.fn().mockRejectedValue(new Error("Memory backend offline")),
      }
    );

    expect(result.memory).toHaveLength(0);
    expect(result.issues).toEqual([
      {
        source: "memory",
        message: "Memory backend offline",
      },
    ]);
  });
});

function createSnapshot() {
  return {
    generatedAt: "2026-03-25T00:00:00.000Z",
    projects: [
      {
        id: "project-1",
        name: "Склад Южный",
        description: "Строительство склада",
        status: "active",
        priority: "high",
        progress: 64,
        health: 42,
        direction: "construction",
        location: "Сургут",
        budget: {
          planned: 5_200_000,
          actual: 6_100_000,
          currency: "RUB",
        },
        dates: {
          start: "2026-03-01T00:00:00.000Z",
          end: "2026-04-30T00:00:00.000Z",
        },
        nextMilestone: {
          name: "Кровля",
          date: "2026-03-28T00:00:00.000Z",
        },
        history: [
          {
            date: "2026-03-10T00:00:00.000Z",
            progress: 40,
            budgetPlanned: 1_800_000,
            budgetActual: 2_100_000,
          },
          {
            date: "2026-03-22T00:00:00.000Z",
            progress: 64,
            budgetPlanned: 3_600_000,
            budgetActual: 6_100_000,
          },
        ],
      },
    ],
    tasks: [
      {
        id: "task-1",
        projectId: "project-1",
        title: "Проверить смету",
        status: "blocked",
        priority: "high",
        dueDate: "2026-03-20T00:00:00.000Z",
        createdAt: "2026-03-01T00:00:00.000Z",
        completedAt: null,
        assigneeId: "member-1",
        assigneeName: "Иван",
      },
      {
        id: "task-2",
        projectId: "project-1",
        title: "Согласовать график",
        status: "in_progress",
        priority: "medium",
        dueDate: "2026-03-24T00:00:00.000Z",
        createdAt: "2026-03-05T00:00:00.000Z",
        completedAt: null,
        assigneeId: "member-1",
        assigneeName: "Иван",
      },
    ],
    risks: [
      {
        id: "risk-1",
        projectId: "project-1",
        title: "Задержка поставок",
        status: "open",
        severity: 5,
        probability: 0.8,
        impact: 0.8,
        mitigation: "Запасной поставщик",
        owner: "Анна",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
      },
    ],
    milestones: [
      {
        id: "ms-1",
        projectId: "project-1",
        title: "Кровля",
        date: "2026-03-28T00:00:00.000Z",
        status: "upcoming",
        updatedAt: "2026-03-22T00:00:00.000Z",
      },
    ],
    workReports: [
      {
        id: "wr-1",
        projectId: "project-1",
        reportNumber: "#202603250001",
        reportDate: "2026-03-24T00:00:00.000Z",
        status: "approved",
        source: "manual",
        authorId: "author-1",
        reviewerId: "reviewer-1",
        submittedAt: "2026-03-24T00:00:00.000Z",
        reviewedAt: "2026-03-24T00:00:00.000Z",
      },
    ],
    teamMembers: [
      {
        id: "member-1",
        name: "Иван",
        role: "PM",
        capacity: 100,
        allocated: 95,
        projectIds: ["project-1"],
      },
      {
        id: "member-2",
        name: "Пётр",
        role: "Engineer",
        capacity: 100,
        allocated: 70,
        projectIds: ["project-1"],
      },
    ],
  };
}

function createEmptySnapshot() {
  return {
    generatedAt: "2026-03-25T00:00:00.000Z",
    projects: [],
    tasks: [],
    risks: [],
    milestones: [],
    workReports: [],
    teamMembers: [],
  };
}

function createEvidence() {
  return {
    syncedAt: "2026-03-25T00:00:00.000Z",
    summary: {
      total: 1,
      reported: 0,
      observed: 0,
      verified: 1,
      averageConfidence: 0.82,
      lastObservedAt: "2026-03-24T00:00:00.000Z",
    },
    records: [
      {
        id: "evidence-1",
        sourceType: "work_report:manual",
        sourceRef: "#202603250001",
        entityType: "work_report",
        entityRef: "wr-1",
        projectId: "project-1",
        title: "#202603250001 · approved",
        summary: "Field report approved",
        observedAt: "2026-03-24T00:00:00.000Z",
        reportedAt: "2026-03-24T00:00:00.000Z",
        confidence: 0.82,
        verificationStatus: "verified",
        metadata: {
          projectName: "Склад Южный",
        },
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
      },
    ],
    sync: null,
  };
}

function createMemoryEntry() {
  return {
    id: "memory-1",
    type: "episodic" as const,
    category: "project" as const,
    key: "project-1-last-decision",
    value: "Сместить поставку на 2 дня",
    validFrom: new Date("2026-03-24T00:00:00.000Z"),
    validUntil: null,
    confidence: 90,
    source: "analysis" as const,
    createdAt: new Date("2026-03-24T00:00:00.000Z"),
    updatedAt: new Date("2026-03-24T00:00:00.000Z"),
  };
}
