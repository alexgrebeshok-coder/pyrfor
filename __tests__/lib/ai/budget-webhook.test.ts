import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverBudgetAlertToWebhook,
  getRecentBudgetWebhookDeliveries,
  __resetBudgetWebhookForTests,
} from "@/lib/ai/messaging/budget-webhook";
import type { BudgetAlertPayload } from "@/lib/ai/cost-tracker";

const samplePayload: BudgetAlertPayload = {
  workspaceId: "executive",
  severity: "warning",
  threshold: 0.8,
  totalUsdToday: 40,
  dailyLimitUsd: 50,
  utilization: 0.8,
  triggeredBy: {
    agentId: "planner",
    runId: "run-abc",
    provider: "openai",
    model: "gpt-4o-mini",
    costUsd: 0.42,
  },
  at: new Date("2026-04-21T10:00:00Z").toISOString(),
};

describe("budget-webhook deliverBudgetAlertToWebhook", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.BUDGET_ALERT_WEBHOOK_URL;

  beforeEach(() => {
    __resetBudgetWebhookForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.BUDGET_ALERT_WEBHOOK_URL = originalEnv;
    __resetBudgetWebhookForTests();
  });

  it("no-ops and records a failure when no webhook URL is configured", async () => {
    delete process.env.BUDGET_ALERT_WEBHOOK_URL;
    const result = await deliverBudgetAlertToWebhook(samplePayload);
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error).toMatch(/not set/);
  });

  it("posts a Slack-compatible body and records a successful delivery", async () => {
    const url = "https://hooks.example.com/services/TEST/XYZ";
    const captured: { body: string | null } = { body: null };
    globalThis.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      captured.body = typeof init?.body === "string" ? init.body : null;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await deliverBudgetAlertToWebhook(samplePayload, url);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.attempts).toBe(1);

    const body = JSON.parse(captured.body ?? "{}");
    expect(body.text).toMatch(/AI budget warning/);
    expect(body.text).toMatch(/executive/);
    expect(Array.isArray(body.attachments)).toBe(true);
    expect(body.attachments[0].fields.find((f: { title: string }) => f.title === "Severity").value).toBe("warning");

    const deliveries = getRecentBudgetWebhookDeliveries(5);
    expect(deliveries[0]?.ok).toBe(true);
  });

  it("retries on 5xx and surfaces the final failure", async () => {
    const url = "https://hooks.example.com/x";
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response("boom", { status: 503 });
    }) as unknown as typeof fetch;

    const result = await deliverBudgetAlertToWebhook(samplePayload, url);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(calls).toBe(2); // 1 initial + 1 retry
    expect(result.attempts).toBe(2);
  });

  it("does not retry on 4xx", async () => {
    const url = "https://hooks.example.com/x";
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response("bad", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await deliverBudgetAlertToWebhook(samplePayload, url);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(calls).toBe(1);
  });

  it("serialises a breach severity with the correct emoji", async () => {
    const url = "https://hooks.example.com/x";
    const captured: { body: string | null } = { body: null };
    globalThis.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      captured.body = typeof init?.body === "string" ? init.body : null;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const breachPayload: BudgetAlertPayload = {
      ...samplePayload,
      severity: "breach",
      threshold: 1,
      totalUsdToday: 55,
      utilization: 1.1,
    };

    const result = await deliverBudgetAlertToWebhook(breachPayload, url);
    expect(result.ok).toBe(true);
    const body = JSON.parse(captured.body ?? "{}");
    expect(body.text).toMatch(/AI budget breach/);
    expect(body.attachments[0].color).toBe("#d9534f");
  });
});
