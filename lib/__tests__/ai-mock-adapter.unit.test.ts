import assert from "node:assert/strict";

import { buildMockFinalRun } from "@/lib/ai/mock-adapter";
import type {
  AIAgentDefinition,
  AIContextSnapshot,
  AIQuickActionDefinition,
} from "@/lib/ai/types";
import type { MessageKey } from "@/lib/translations";
import { initialDashboardState } from "@/lib/mock-data";

const agent: AIAgentDefinition = {
  id: "status-reporter",
  kind: "reporter",
  nameKey: "agent.autoRouting" as MessageKey,
  accentClass: "text-sky-500",
  icon: "sparkles",
  category: "communication",
};

function createContextSnapshot(): AIContextSnapshot {
  const project = initialDashboardState.projects[0];

  return {
    locale: "en",
    interfaceLocale: "en",
    generatedAt: "2026-03-11T00:00:00.000Z",
    activeContext: {
      type: "project",
      pathname: `/projects/${project.id}`,
      title: project.name,
      subtitle: "Project",
      projectId: project.id,
    },
    projects: initialDashboardState.projects,
    tasks: initialDashboardState.tasks,
    team: initialDashboardState.team,
    risks: initialDashboardState.risks,
    notifications: [],
    project,
    projectTasks: initialDashboardState.tasks.filter((task) => task.projectId === project.id),
  };
}

function createQuickAction(kind: AIQuickActionDefinition["kind"]): AIQuickActionDefinition {
  return {
    id: `qa-${kind}`,
    kind,
    agentId: agent.id,
    labelKey: "ai.emptyBadge" as MessageKey,
    descriptionKey: "ai.emptyDescription" as MessageKey,
    promptKey: "chat.run.manual" as MessageKey,
    contextTypes: ["project"],
  };
}

async function testMockAdapterBuildsStatusProposal() {
  const run = buildMockFinalRun({
    agent,
    prompt: "Draft a status update",
    context: createContextSnapshot(),
    quickAction: createQuickAction("draft_status_report"),
  });

  assert.equal(run.status, "needs_approval");
  assert.equal(run.result?.proposal?.type, "draft_status_report");
  assert.ok(run.result?.facts?.length);
  assert.ok(run.result?.confidence);
}

async function testMockAdapterBuildsTaskTriageProposal() {
  const run = buildMockFinalRun({
    agent: { ...agent, id: "risk-researcher", kind: "researcher", category: "knowledge" },
    prompt: "Triage current tasks",
    context: {
      ...createContextSnapshot(),
      activeContext: {
        type: "tasks",
        pathname: "/tasks",
        title: "Tasks",
        subtitle: "Queue",
      },
    },
    quickAction: {
      ...createQuickAction("triage_tasks"),
      contextTypes: ["tasks"],
    },
  });

  assert.ok(
    run.result?.proposal?.type === "reschedule_tasks" ||
      run.result?.proposal?.type === "update_tasks"
  );
  assert.ok(run.result?.facts?.length);
  assert.ok(run.result?.confidence);
}

async function testMeetingTaskPromptDoesNotCollapseIntoNotifyProposal() {
  const run = buildMockFinalRun({
    agent: { ...agent, id: "execution-planner", kind: "planner", category: "planning" },
    prompt:
      "Meeting-to-action for project. Create concrete follow-up tasks. Команда должна обновить график и закрыть вопрос по допуску техники.",
    context: createContextSnapshot(),
  });

  assert.ok(
    run.result?.proposal?.type === "create_tasks" ||
      run.result?.proposal?.type === "update_tasks" ||
      run.result?.proposal?.type === "reschedule_tasks"
  );
}

async function main() {
  await testMockAdapterBuildsStatusProposal();
  await testMockAdapterBuildsTaskTriageProposal();
  await testMeetingTaskPromptDoesNotCollapseIntoNotifyProposal();
  console.log("PASS ai-mock-adapter.unit");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
