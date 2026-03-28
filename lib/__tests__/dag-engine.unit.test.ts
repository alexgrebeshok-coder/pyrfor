import assert from "node:assert/strict";

import { executeWorkflow, type WorkflowDefinition } from "@/lib/ai/orchestration/dag-engine";

async function testSkipsDependentsAfterFailure() {
  const definition: WorkflowDefinition = {
    id: "dag-failure-propagation",
    name: "dag-failure-propagation",
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

  const fakeRouter = {
    chat: async () => {
      throw new Error("upstream failed");
    },
  };

  const result = await executeWorkflow(definition, "check", {
    router: fakeRouter as never,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.nodeResults.find((node) => node.nodeId === "summary")?.status, "skipped");
}

async function testResolvesHyphenatedNodeIds() {
  const capturedPrompts: string[] = [];
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

  const fakeRouter = {
    chat: async (messages: Array<{ role: string; content: string }>) => {
      const prompt = messages.at(-1)?.content ?? "";
      capturedPrompts.push(prompt);
      return prompt.includes("Use") ? "integrated" : "risk output";
    },
  };

  const result = await executeWorkflow(definition, "project-x", {
    router: fakeRouter as never,
  });

  assert.equal(result.status, "completed");
  assert.match(capturedPrompts.at(-1) ?? "", /risk output/);
}

async function testNodeTimeout() {
  const definition: WorkflowDefinition = {
    id: "dag-timeout",
    name: "dag-timeout",
    nodes: [
      {
        id: "slow-node",
        agentId: "status-reporter",
        systemPrompt: "slow",
        promptTemplate: "{{input}}",
        dependencies: [],
        timeoutMs: 10,
      },
    ],
    outputNodes: ["slow-node"],
  };

  const fakeRouter = {
    chat: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "late";
    },
  };

  const result = await executeWorkflow(definition, "slow", {
    router: fakeRouter as never,
  });

  assert.equal(result.status, "failed");
  assert.match(result.nodeResults[0]?.error ?? "", /Node timeout/);
}

async function run() {
  await testSkipsDependentsAfterFailure();
  await testResolvesHyphenatedNodeIds();
  await testNodeTimeout();
  console.log("PASS dag-engine.unit");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
