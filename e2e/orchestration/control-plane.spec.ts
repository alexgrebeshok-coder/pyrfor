import { randomUUID } from "node:crypto";

import { expect, test, type APIResponse } from "@playwright/test";

async function expectJson<T>(
  response: APIResponse,
  action: string
): Promise<T> {
  const body = await response.text();
  expect(
    response.ok(),
    `${action} failed with ${response.status()}: ${body}`
  ).toBeTruthy();
  return JSON.parse(body) as T;
}

test("orchestration control plane renders seeded agents, workflows, and runs", async ({
  page,
  request,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const agentName = `CI Smoke Agent ${suffix}`;
  const templateName = `CI Smoke Workflow ${suffix}`;
  const nodeName = `Implementation ${suffix}`;

  const agentPayload = await expectJson<{ agent: { id: string } }>(
    await request.post("/api/orchestration/agents", {
      data: {
        workspaceId: "executive",
        name: agentName,
        slug: `ci-smoke-agent-${suffix}`,
        role: "engineer",
      },
    }),
    "Create orchestration agent"
  );

  const templatePayload = await expectJson<{ template: { id: string } }>(
    await request.post("/api/orchestration/workflows", {
      data: {
        workspaceId: "executive",
        name: templateName,
        slug: `ci-smoke-workflow-${suffix}`,
        description: "Smoke workflow for the unified orchestration control plane.",
        status: "active",
        definition: {
          nodes: [
            {
              id: "implementation",
              name: nodeName,
              kind: "agent",
              agentId: agentPayload.agent.id,
              taskTemplate: "Implement {{input.brief}}",
            },
          ],
          outputNodes: ["implementation"],
        },
      },
    }),
    "Create workflow template"
  );

  const runPayload = await expectJson<{ run: { id: string } }>(
    await request.post(`/api/orchestration/workflows/${templatePayload.template.id}/runs`, {
      data: {
        workspaceId: "executive",
        triggerType: "manual",
        input: {
          brief: `Ship the CI smoke validation ${suffix}`,
        },
      },
    }),
    "Create workflow run"
  );

  await page.goto("/settings/agents");
  await expect(
    page.getByRole("heading", { name: "Agent Orchestration", exact: true })
  ).toBeVisible();
  await expect(page.getByText(agentName, { exact: true })).toBeVisible();

  await page.goto("/settings/agents/workflows");
  await expect(
    page.getByRole("heading", { name: "Workflow Builder", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(templateName) })).toBeVisible();

  await page.goto(`/settings/agents/workflows/runs/${runPayload.run.id}`);
  await expect(page.getByRole("heading", { name: templateName, exact: true })).toBeVisible();
  await expect(page.getByText("Workflow input", { exact: true })).toBeVisible();
  await expect(page.getByText("Step graph", { exact: true })).toBeVisible();
  await expect(page.getByText(nodeName, { exact: true })).toBeVisible();
  await expect(page.getByText("Delegation lineage", { exact: true })).toBeVisible();
});
