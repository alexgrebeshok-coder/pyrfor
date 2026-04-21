import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetBudgetMirrorForTest,
  forwardBudgetAlertToMirrors,
  getRecentBudgetMirrorDeliveries,
  isBudgetMirrorConfigured,
  parseSentryDsn,
} from "@/lib/ai/messaging/budget-mirror";
import type { BudgetAlertPayload } from "@/lib/ai/cost-tracker";

const originalFetch = globalThis.fetch;

function makeAlert(
  overrides: Partial<BudgetAlertPayload> = {}
): BudgetAlertPayload {
  return {
    workspaceId: "ops",
    period: "day",
    severity: "warning",
    threshold: 0.8,
    spentUsd: 8,
    limitUsd: 10,
    ratio: 0.8,
    triggeredAt: "2026-04-21T08:00:00.000Z",
    ...overrides,
  };
}

describe("parseSentryDsn", () => {
  it("parses a well-formed DSN", () => {
    const parsed = parseSentryDsn(
      "https://abc123@o123.ingest.sentry.io/4501"
    );
    expect(parsed).toEqual({
      endpoint: "https://o123.ingest.sentry.io/api/4501/store/",
      publicKey: "abc123",
      projectId: "4501",
    });
  });

  it("returns null when the DSN is malformed", () => {
    expect(parseSentryDsn("not-a-url")).toBeNull();
    expect(parseSentryDsn("https://o.sentry.io/4501")).toBeNull(); // missing key
    expect(parseSentryDsn("https://abc@o.sentry.io/")).toBeNull(); // missing project id
  });
});

describe("isBudgetMirrorConfigured", () => {
  const orig = {
    sentry: process.env.BUDGET_ALERT_SENTRY_DSN,
    datadog: process.env.BUDGET_ALERT_DATADOG_API_KEY,
  };

  afterEach(() => {
    if (orig.sentry === undefined) delete process.env.BUDGET_ALERT_SENTRY_DSN;
    else process.env.BUDGET_ALERT_SENTRY_DSN = orig.sentry;
    if (orig.datadog === undefined) delete process.env.BUDGET_ALERT_DATADOG_API_KEY;
    else process.env.BUDGET_ALERT_DATADOG_API_KEY = orig.datadog;
  });

  it("reflects env configuration state per target", () => {
    delete process.env.BUDGET_ALERT_SENTRY_DSN;
    delete process.env.BUDGET_ALERT_DATADOG_API_KEY;
    expect(isBudgetMirrorConfigured()).toEqual({ sentry: false, datadog: false });

    process.env.BUDGET_ALERT_SENTRY_DSN =
      "https://k@o123.ingest.sentry.io/1";
    expect(isBudgetMirrorConfigured()).toEqual({ sentry: true, datadog: false });

    process.env.BUDGET_ALERT_DATADOG_API_KEY = "dd-key";
    expect(isBudgetMirrorConfigured()).toEqual({ sentry: true, datadog: true });
  });
});

describe("forwardBudgetAlertToMirrors", () => {
  const orig = {
    sentry: process.env.BUDGET_ALERT_SENTRY_DSN,
    datadog: process.env.BUDGET_ALERT_DATADOG_API_KEY,
    site: process.env.BUDGET_ALERT_DATADOG_SITE,
  };

  beforeEach(() => {
    __resetBudgetMirrorForTest();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (orig.sentry === undefined) delete process.env.BUDGET_ALERT_SENTRY_DSN;
    else process.env.BUDGET_ALERT_SENTRY_DSN = orig.sentry;
    if (orig.datadog === undefined) delete process.env.BUDGET_ALERT_DATADOG_API_KEY;
    else process.env.BUDGET_ALERT_DATADOG_API_KEY = orig.datadog;
    if (orig.site === undefined) delete process.env.BUDGET_ALERT_DATADOG_SITE;
    else process.env.BUDGET_ALERT_DATADOG_SITE = orig.site;
  });

  it("is a no-op when no targets are configured", async () => {
    delete process.env.BUDGET_ALERT_SENTRY_DSN;
    delete process.env.BUDGET_ALERT_DATADOG_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const results = await forwardBudgetAlertToMirrors(makeAlert());
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("delivers to Sentry with the correct auth header and payload shape", async () => {
    process.env.BUDGET_ALERT_SENTRY_DSN =
      "https://pub@o1.ingest.sentry.io/42";
    delete process.env.BUDGET_ALERT_DATADOG_API_KEY;

    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ id: "evt1" }), { status: 200 })
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const results = await forwardBudgetAlertToMirrors(
      makeAlert({ severity: "breach", spentUsd: 15, ratio: 1.5 })
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      target: "sentry",
      ok: true,
      status: 200,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://o1.ingest.sentry.io/api/42/store/");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Sentry-Auth"]).toMatch(/sentry_key=pub/);
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.level).toBe("error");
    expect(body.tags).toMatchObject({ workspace: "ops", severity: "breach" });
    expect(body.extra).toMatchObject({ spentUsd: 15, ratio: 1.5 });
  });

  it("delivers to Datadog with api-key header and status code", async () => {
    delete process.env.BUDGET_ALERT_SENTRY_DSN;
    process.env.BUDGET_ALERT_DATADOG_API_KEY = "dd-test";
    process.env.BUDGET_ALERT_DATADOG_SITE = "datadoghq.eu";

    const fetchSpy = vi.fn(async () => new Response("ok", { status: 202 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const results = await forwardBudgetAlertToMirrors(makeAlert());
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      target: "datadog",
      ok: true,
      status: 202,
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://http-intake.logs.datadoghq.eu/api/v2/logs");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["DD-API-KEY"]).toBe("dd-test");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({
      status: "warn",
      "budget.workspace": "ops",
      "budget.severity": "warning",
    });
  });

  it("retries on 5xx and surfaces the final failure", async () => {
    delete process.env.BUDGET_ALERT_SENTRY_DSN;
    process.env.BUDGET_ALERT_DATADOG_API_KEY = "dd-test";

    const fetchSpy = vi.fn(async () => new Response("boom", { status: 503 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const results = await forwardBudgetAlertToMirrors(makeAlert());
    expect(results[0]).toMatchObject({ ok: false, status: 503, attempts: 2 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx", async () => {
    delete process.env.BUDGET_ALERT_SENTRY_DSN;
    process.env.BUDGET_ALERT_DATADOG_API_KEY = "dd-test";

    const fetchSpy = vi.fn(async () => new Response("bad", { status: 403 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const results = await forwardBudgetAlertToMirrors(makeAlert());
    expect(results[0]).toMatchObject({ ok: false, status: 403, attempts: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("records deliveries in the ring buffer", async () => {
    delete process.env.BUDGET_ALERT_SENTRY_DSN;
    process.env.BUDGET_ALERT_DATADOG_API_KEY = "dd-test";

    globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;

    await forwardBudgetAlertToMirrors(makeAlert({ workspaceId: "w1" }));
    await forwardBudgetAlertToMirrors(makeAlert({ workspaceId: "w2" }));

    const recent = getRecentBudgetMirrorDeliveries(10);
    expect(recent).toHaveLength(2);
    // Most recent first
    expect(recent[0].workspaceId).toBe("w2");
    expect(recent[1].workspaceId).toBe("w1");
  });
});
