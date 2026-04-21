import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverBudgetAlertToWebhook,
  detectWebhookFormat,
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

  it("detects format from URL host", () => {
    const origForced = process.env.BUDGET_ALERT_WEBHOOK_FORMAT;
    delete process.env.BUDGET_ALERT_WEBHOOK_FORMAT;
    expect(detectWebhookFormat("https://hooks.slack.com/services/T/B/X")).toBe("slack");
    expect(detectWebhookFormat("https://api.telegram.org/bot123:ABC/sendMessage")).toBe(
      "telegram"
    );
    expect(detectWebhookFormat("https://acme.webhook.office.com/webhookb2/abc@123/XYZ")).toBe(
      "teams"
    );
    process.env.BUDGET_ALERT_WEBHOOK_FORMAT = "teams";
    expect(detectWebhookFormat("https://random.example.com/hook")).toBe("teams");
    if (origForced === undefined) {
      delete process.env.BUDGET_ALERT_WEBHOOK_FORMAT;
    } else {
      process.env.BUDGET_ALERT_WEBHOOK_FORMAT = origForced;
    }
  });

  it("emits Telegram-format payload for api.telegram.org URLs", async () => {
    const url = "https://api.telegram.org/bot123:ABC/sendMessage";
    const captured: { body: string | null } = { body: null };
    globalThis.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      captured.body = typeof init?.body === "string" ? init.body : null;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const prevChat = process.env.BUDGET_ALERT_TELEGRAM_CHAT_ID;
    process.env.BUDGET_ALERT_TELEGRAM_CHAT_ID = "-100123";

    const result = await deliverBudgetAlertToWebhook(samplePayload, url);
    expect(result.ok).toBe(true);
    expect(result.format).toBe("telegram");
    const body = JSON.parse(captured.body ?? "{}");
    expect(body.parse_mode).toBe("Markdown");
    expect(body.chat_id).toBe("-100123");
    expect(body.text).toMatch(/AI budget warning/);
    expect(body.text).toMatch(/openai \/ gpt-4o-mini/);

    if (prevChat === undefined) {
      delete process.env.BUDGET_ALERT_TELEGRAM_CHAT_ID;
    } else {
      process.env.BUDGET_ALERT_TELEGRAM_CHAT_ID = prevChat;
    }
  });

  it("emits Teams MessageCard format for webhook.office.com URLs", async () => {
    const url = "https://acme.webhook.office.com/webhookb2/abc@123/XYZ";
    const captured: { body: string | null } = { body: null };
    globalThis.fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      captured.body = typeof init?.body === "string" ? init.body : null;
      return new Response("1", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await deliverBudgetAlertToWebhook(samplePayload, url);
    expect(result.ok).toBe(true);
    expect(result.format).toBe("teams");
    const body = JSON.parse(captured.body ?? "{}");
    expect(body["@type"]).toBe("MessageCard");
    expect(body["@context"]).toBe("https://schema.org/extensions");
    expect(body.themeColor).toBe("F0AD4E");
    const facts = body.sections?.[0]?.facts as Array<{ name: string; value: string }>;
    const severity = facts.find((f) => f.name === "Severity");
    expect(severity?.value).toBe("warning");
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
