import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextAssemblerResult } from "@/lib/ai/context-assembler";

const mocks = vi.hoisted(() => ({
  assembleContext: vi.fn(),
  buildAIChatContextBundle: vi.fn(),
  buildAIChatMessages: vi.fn(),
  buildMemoryContext: vi.fn(),
  buildRAGContext: vi.fn(),
}));

vi.mock("@/lib/ai/context-assembler", () => ({
  assembleContext: mocks.assembleContext,
}));

vi.mock("@/lib/ai/context-builder", () => ({
  buildAIChatContextBundle: mocks.buildAIChatContextBundle,
  buildAIChatMessages: mocks.buildAIChatMessages,
}));

vi.mock("@/lib/ai/memory/agent-memory-store", () => ({
  buildMemoryContext: mocks.buildMemoryContext,
}));

vi.mock("@/lib/ai/rag/document-indexer", () => ({
  buildRAGContext: mocks.buildRAGContext,
}));

import { buildKernelChatContext } from "@/lib/ai/kernel-context-stack";

describe("kernel context stack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assembleContext.mockResolvedValue(createAssemblyResult() as never);
    mocks.buildAIChatContextBundle.mockResolvedValue(createBundle() as never);
    mocks.buildMemoryContext.mockResolvedValue("" as never);
    mocks.buildRAGContext.mockResolvedValue("" as never);
    mocks.buildAIChatMessages.mockReturnValue([
      { role: "system", content: "Ты CEOClaw AI" },
      { role: "user", content: "Покажи риски" },
    ] as never);
  });

  it("feeds assembled snapshot and evidence into the shared chat context builder", async () => {
    const result = await buildKernelChatContext({
      messages: [{ role: "user", content: "Покажи риски" }],
      projectId: "project-1",
    });

    expect(result.bundle.projectId).toBe("project-1");
    expect(result.messages).toHaveLength(2);
    expect(result.assembly).toEqual({
      source: "live",
      scope: "project",
      projectId: "project-1",
      memoryCount: 1,
      agentMemoryInjected: false,
      ragInjected: false,
      issueCount: 0,
      issues: [],
    });

    const [, deps] = mocks.buildAIChatContextBundle.mock.calls[0] ?? [];
    expect(deps).toBeDefined();
    await expect(deps.loadSnapshot()).resolves.toEqual(createAssemblyResult().snapshot);
    await expect(deps.loadEvidence()).resolves.toEqual(createAssemblyResult().evidence);
  });

  it("keeps messages optional and avoids forcing assembled evidence without an explicit project", async () => {
    mocks.assembleContext.mockResolvedValue(
      createAssemblyResult({
        projectId: null,
        scope: "portfolio",
        evidence: null,
      }) as never
    );

    const result = await buildKernelChatContext({
      messages: [{ role: "user", content: "Что по портфелю?" }],
      includeMessages: false,
    });

    expect(result.messages).toBeUndefined();
    const [, deps] = mocks.buildAIChatContextBundle.mock.calls[0] ?? [];
    expect(deps.loadSnapshot).toBeDefined();
    expect(deps.loadEvidence).toBeUndefined();
  });

  it("appends agent memory and RAG context to the system prompt when available", async () => {
    mocks.buildMemoryContext.mockResolvedValue("## Relevant context from previous sessions:\n- Budget drift" as never);
    mocks.buildRAGContext.mockResolvedValue("## Relevant project documents:\n- Contract clause" as never);
    mocks.buildAIChatMessages.mockImplementation((messages, bundle) => [
      { role: "system", content: bundle.systemPrompt },
      ...messages,
    ] as never);

    const result = await buildKernelChatContext({
      messages: [{ role: "user", content: "Show contract risks" }],
      projectId: "project-1",
      agentId: "risk-researcher",
    });

    expect(result.bundle.systemPrompt).toContain("Relevant context from previous sessions");
    expect(result.bundle.systemPrompt).toContain("Relevant project documents");
    expect(result.assembly.agentMemoryInjected).toBe(true);
    expect(result.assembly.ragInjected).toBe(true);
  });
});

function createAssemblyResult(overrides?: Partial<ContextAssemblerResult>): ContextAssemblerResult {
  return {
    ...baseAssemblyResult(),
    ...overrides,
  } as ContextAssemblerResult;
}

function baseAssemblyResult(): ContextAssemblerResult {
  return {
    source: "live" as const,
    scope: "project",
    generatedAt: "2026-03-25T00:00:00.000Z",
    locale: "ru",
    interfaceLocale: "ru",
    projectId: "project-1",
    project: {
      id: "project-1",
      name: "Project 1",
    } as ContextAssemblerResult["project"],
    snapshot: {
      generatedAt: "2026-03-25T00:00:00.000Z",
      projects: [],
      tasks: [],
      risks: [],
      milestones: [],
      workReports: [],
      teamMembers: [],
    } as ContextAssemblerResult["snapshot"],
    alertFeed: {
      generatedAt: "2026-03-25T00:00:00.000Z",
      scope: "project",
      summary: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        averageConfidence: 0,
        averageFreshness: 0,
      },
      alerts: [],
      recommendationsSummary: [],
    } as ContextAssemblerResult["alertFeed"],
    planFact: {
      projectId: "project-1",
      projectName: "Project 1",
    } as ContextAssemblerResult["planFact"],
    evidence: {
      syncedAt: "2026-03-25T00:00:00.000Z",
      summary: {
        total: 1,
        reported: 0,
        observed: 0,
        verified: 1,
        averageConfidence: 0.8,
        lastObservedAt: "2026-03-24T00:00:00.000Z",
      },
      records: [],
      sync: null,
    } as ContextAssemblerResult["evidence"],
    memory: [{ id: "memory-1" }] as ContextAssemblerResult["memory"],
    issues: [],
  };
}

function createBundle() {
  return {
    source: "live",
    locale: "ru",
    scope: "project",
    focus: "risk",
    generatedAt: "2026-03-25T00:00:00.000Z",
    projectId: "project-1",
    projectName: "Project 1",
    projectStatus: "active",
    summary: "Project context summary",
    sections: [],
    evidence: {
      syncedAt: "2026-03-25T00:00:00.000Z",
      summary: {
        total: 0,
        reported: 0,
        observed: 0,
        verified: 0,
        averageConfidence: 0,
        lastObservedAt: null,
      },
      records: [],
      sync: null,
    },
    alertFeed: {
      generatedAt: "2026-03-25T00:00:00.000Z",
      scope: "project",
      summary: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        averageConfidence: 0,
        averageFreshness: 0,
      },
      alerts: [],
      recommendationsSummary: [],
    },
    planFact: {
      projectId: "project-1",
      projectName: "Project 1",
    },
    systemPrompt: "Ты CEOClaw AI",
  };
}
