import assert from "node:assert/strict";

import { getAgentById } from "@/lib/ai/agents";
import { getQuickActionById } from "@/lib/ai/quick-actions";
import {
  buildCollaborativePlan,
  executeCollaborativeRun,
  shouldUseCollaborativeRun,
} from "@/lib/ai/multi-agent-runtime";
import type { AIContextSnapshot, AIRunInput } from "@/lib/ai/types";
import type { AIRouter } from "@/lib/ai/providers";

function getStatusBlueprintInput(): AIRunInput {
  const agent = getAgentById("status-reporter");
  const quickAction = getQuickActionById("status-report");

  assert.ok(agent);
  assert.ok(quickAction);

  const context: AIContextSnapshot = {
    locale: "ru",
    interfaceLocale: "ru",
    generatedAt: "2026-03-19T08:00:00.000Z",
    activeContext: {
      type: "project",
      pathname: "/projects/project-arctic-road",
      title: "Arctic Road",
      subtitle: "Project execution",
      projectId: "project-arctic-road",
    },
    projects: [],
    tasks: [],
    team: [],
    risks: [],
    notifications: [],
  };

  return {
    agent,
    prompt: "Draft a board-ready status report for Arctic Road.",
    context,
    quickAction,
  };
}

async function testCollaborativePlanActivatesForStatusBlueprint() {
  const input = getStatusBlueprintInput();

  assert.equal(shouldUseCollaborativeRun(input), true);

  const plan = buildCollaborativePlan(input);
  assert.equal(plan.collaborative, true);
  assert.equal(plan.leaderAgentId, "status-reporter");
  assert.deepEqual(plan.support.map((item) => item.agentId), ["budget-controller", "quality-guardian"]);
  assert.ok(plan.reason.length > 0);
}

async function testCollaborativePlanStaysSingleAgentForLowSignalInput() {
  const input = getStatusBlueprintInput();
  const lowSignalInput: AIRunInput = {
    ...input,
    prompt: "Hello",
    quickAction: undefined,
  };

  assert.equal(shouldUseCollaborativeRun(lowSignalInput), false);

  const plan = buildCollaborativePlan(lowSignalInput);
  assert.equal(plan.collaborative, false);
  assert.deepEqual(plan.support, []);
}

async function testCollaborativeRunSynthesizesACouncilResult() {
  const input = getStatusBlueprintInput();
  const prompts: string[] = [];

  const fakeRouter = {
    getAvailableProviders: () => ["openrouter"],
    chat: async (messages: Array<{ role: string; content: string }>) => {
      const prompt = messages[0]?.content ?? "";
      prompts.push(prompt);

      if (prompt.includes("Specialist focus for Budget Controller")) {
        return JSON.stringify({
          title: "Budget controller view",
          summary: "Budget pressure is manageable.",
          highlights: ["Budget variance remains within a narrow band."],
          nextSteps: ["Track the spend trend."],
          proposal: null,
        });
      }

      if (prompt.includes("Specialist focus for Quality Guardian")) {
        return JSON.stringify({
          title: "Quality guardian view",
          summary: "The report needs one more acceptance check.",
          highlights: ["Clarify the completion gate."],
          nextSteps: ["Add one final review step."],
          proposal: null,
        });
      }

      if (prompt.includes("You are now the final synthesizer")) {
        return JSON.stringify({
          title: "Council synthesis",
          summary: "The council aligned on an execution-ready status report.",
          highlights: ["Sequence the remaining work", "Treat permit as blocker"],
          nextSteps: ["Confirm owner", "Review dependencies"],
          proposal: null,
        });
      }

      throw new Error(`Unexpected prompt: ${prompt.slice(0, 120)}`);
    },
  } as unknown as AIRouter;

  const result = await executeCollaborativeRun(input, "ai-run-council", "provider", {
    router: fakeRouter,
    forceCollaborative: true,
  });

  assert.equal(result.title, "Council synthesis");
  assert.equal(result.summary, "The council aligned on an execution-ready status report.");
  assert.equal(result.collaboration?.mode, "collaborative");
  assert.equal(result.collaboration?.leaderAgentId, "status-reporter");
  assert.deepEqual(result.collaboration?.supportAgentIds, ["budget-controller", "quality-guardian"]);
  assert.equal(result.collaboration?.steps.length, 3);
  assert.equal(result.collaboration?.steps[0]?.agentId, "budget-controller");
  assert.equal(result.collaboration?.steps[1]?.agentId, "quality-guardian");
  assert.equal(result.collaboration?.steps[2]?.agentId, "status-reporter");
  assert.ok((result.collaboration?.consensus.length ?? 0) > 0);
  assert.ok(prompts.some((prompt) => prompt.includes("Specialist focus for Budget Controller")));
  assert.ok(prompts.some((prompt) => prompt.includes("Specialist focus for Quality Guardian")));
  assert.ok(prompts.some((prompt) => prompt.includes("You are now the final synthesizer")));
}

async function main() {
  await testCollaborativePlanActivatesForStatusBlueprint();
  await testCollaborativePlanStaysSingleAgentForLowSignalInput();
  await testCollaborativeRunSynthesizesACouncilResult();
  console.log("PASS multi-agent-runtime.unit");
}

void main();
