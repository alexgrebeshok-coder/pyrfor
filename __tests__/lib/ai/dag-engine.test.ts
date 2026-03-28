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
