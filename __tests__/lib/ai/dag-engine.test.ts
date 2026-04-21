import { describe, expect, it } from "vitest";

import { executeWorkflow, type WorkflowDefinition } from "@/lib/ai/orchestration/dag-engine";

describe("dag-engine", () => {
  it("skips dependent nodes after an upstream failure", async () => {
    const definition: WorkflowDefinition = {
      id: "dag-failure",
      name: "dag-failure",
      nodes: [
        {
          id: "risk-analysis",
          agentId: "risk-researcher",
          systemPrompt: "risk",
          promptTemplate: "{{input}}",
          dependencies: [],
        },
        {
          id: "summary",
          agentId: "status-reporter",
          systemPrompt: "summary",
          promptTemplate: "{{risk-analysis}}",
          dependencies: ["risk-analysis"],
        },
      ],
      outputNodes: ["summary"],
    };

    const result = await executeWorkflow(definition, "check", {
      router: {
        chat: async () => {
          throw new Error("failed");
        },
      } as never,
    });

    expect(result.status).toBe("failed");
    expect(result.nodeResults.find((node) => node.nodeId === "summary")?.status).toBe("skipped");
  });

  it("isolates sibling failures within the same layer via Promise.allSettled", async () => {
    const definition: WorkflowDefinition = {
      id: "dag-parallel-failure",
      name: "dag-parallel-failure",
      nodes: [
        {
          id: "ok",
          agentId: "agent-a",
          systemPrompt: "ok",
          promptTemplate: "{{input}}",
          dependencies: [],
        },
        {
          id: "boom",
          agentId: "agent-b",
          systemPrompt: "boom",
          promptTemplate: "{{input}}",
          dependencies: [],
        },
      ],
      outputNodes: ["ok"],
    };

    const result = await executeWorkflow(definition, "check", {
      router: {
        chat: async (_messages: unknown, opts?: { agentId?: string }) => {
          if (opts?.agentId === "agent-b") throw new Error("boom");
          return "ok";
        },
      } as never,
    });

    const okNode = result.nodeResults.find((n) => n.nodeId === "ok");
    const badNode = result.nodeResults.find((n) => n.nodeId === "boom");
    expect(okNode?.status).toBe("success");
    expect(badNode?.status).toBe("failed");
  });

  it("respects node timeout without leaving a dangling timer", async () => {
    const definition: WorkflowDefinition = {
      id: "dag-timeout",
      name: "dag-timeout",
      nodes: [
        {
          id: "slow",
          agentId: "agent-slow",
          systemPrompt: "",
          promptTemplate: "{{input}}",
          dependencies: [],
          timeoutMs: 20,
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
      ],
      outputNodes: ["slow"],
    };

    const result = await executeWorkflow(definition, "check", {
      router: {
        chat: () =>
          new Promise<string>((resolve) => {
            setTimeout(() => resolve("late"), 100);
          }),
      } as never,
    });

    const slow = result.nodeResults.find((n) => n.nodeId === "slow");
    expect(slow?.status).toBe("failed");
    expect(slow?.error ?? "").toMatch(/timeout/i);
  });

  it("resolves hyphenated node ids in templates", async () => {
    const prompts: string[] = [];
    const definition: WorkflowDefinition = {
      id: "dag-hyphen",
      name: "dag-hyphen",
      nodes: [
        {
          id: "risk-analysis",
          agentId: "risk-researcher",
          systemPrompt: "risk",
          promptTemplate: "{{input}}",
          dependencies: [],
        },
        {
          id: "integrated-report",
          agentId: "status-reporter",
          systemPrompt: "summary",
          promptTemplate: "Use {{risk-analysis}} and {{input}}",
          dependencies: ["risk-analysis"],
        },
      ],
      outputNodes: ["integrated-report"],
    };

    const result = await executeWorkflow(definition, "project-x", {
      router: {
        chat: async (messages: Array<{ role: string; content: string }>) => {
          const prompt = messages.at(-1)?.content ?? "";
          prompts.push(prompt);
          return prompt.includes("Use") ? "integrated" : "risk output";
        },
      } as never,
    });

    expect(result.status).toBe("completed");
    expect(prompts.at(-1)).toContain("risk output");
  });
});
