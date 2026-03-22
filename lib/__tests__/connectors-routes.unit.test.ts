import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET as getConnectorById } from "../../app/api/connectors/[id]/route";
import { POST as postEmailBrief } from "../../app/api/connectors/email/briefs/route";
import { GET as getGpsSample } from "../../app/api/connectors/gps/sample/route";
import { GET as getGpsTelemetry } from "../../app/api/connectors/gps/telemetry/route";
import { GET as getOneCFinance } from "../../app/api/connectors/one-c/finance/route";
import { GET as getOneCSample } from "../../app/api/connectors/one-c/sample/route";
import { GET as getConnectors } from "../../app/api/connectors/route";
import { GET as getHealth } from "../../app/api/health/route";
import { setEmailTransportFactoryForTests } from "../../lib/connectors/email-client";

const CONNECTOR_ENV_KEYS = [
  "CEOCLAW_SKIP_AUTH",
  "OPENAI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "EMAIL_FROM",
  "EMAIL_DEFAULT_TO",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "GPS_API_URL",
  "GPS_API_KEY",
  "ONE_C_BASE_URL",
  "ONE_C_API_KEY",
] as const;

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function installConnectorFetchMock() {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.includes("/getMe")) {
      return createJsonResponse({
        ok: true,
        result: {
          id: 777000,
          is_bot: true,
          first_name: "CEOClaw Bot",
          username: "ceoclaw_bot",
        },
      });
    }

    if (url.includes("/getWebhookInfo")) {
      return createJsonResponse({
        ok: true,
        result: {
          url: "https://example.com/api/telegram/webhook",
          pending_update_count: 0,
        },
      });
    }

    if (url.includes("gps.example.com") && url.includes("/session-stats")) {
      return createJsonResponse({
        status: "ok",
        provider: "Teltonika Gateway",
        total_equipment: 68,
        online_equipment: 61,
        offline_equipment: 7,
      });
    }

    if (url.includes("gps.example.com") && url.includes("/sessions")) {
      return createJsonResponse({
        equipment_id: "EXC-KOM-01",
        sessions: [
          {
            session_id: "sess-20260207-EXC-KOM-01-003",
            session_type: "work",
            started_at: "2026-02-07T08:00:00Z",
            ended_at: "2026-02-07T10:30:00Z",
            duration_seconds: 9000,
            geofence_name: "Salekhard-Labytnangi Earthwork Zone",
          },
        ],
      });
    }

    if (url.includes("1c.example.com") && url.includes("/project-financials")) {
      if (new URL(url).searchParams.get("page_size") === "1") {
        return createJsonResponse({
          provider: "1C:ERP",
          projects: [
            {
              project_id: "proj-yanao-001",
              project_name: "Yamal Earthwork Package",
              report_date: "2026-03-11",
              planned_budget: 125000000,
              actual_budget: 118000000,
              payments_actual: 79000000,
              acts_actual: 71000000,
            },
          ],
        });
      }

      return createJsonResponse({
        provider: "1C:ERP",
        projects: [
          {
            project_id: "proj-yanao-001",
            project_name: "Yamal Earthwork Package",
            report_date: "2026-03-11",
            planned_budget: 125000000,
            actual_budget: 118000000,
            payments_actual: 79000000,
            acts_actual: 71000000,
          },
          {
            project_id: "proj-yanao-002",
            project_name: "Northern Logistics Hub",
            report_date: "2026-03-11",
            planned_budget: 62000000,
            actual_budget: 65500000,
            payments_actual: 40200000,
            acts_actual: 38800000,
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

function withEnv(
  envPatch: Partial<Record<(typeof CONNECTOR_ENV_KEYS)[number], string>>,
  run: () => Promise<void>
): Promise<void> {
  const previousValues = new Map<string, string | undefined>();

  for (const key of CONNECTOR_ENV_KEYS) {
    previousValues.set(key, process.env[key]);
  }

  for (const key of CONNECTOR_ENV_KEYS) {
    const value = envPatch[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return run().finally(() => {
    for (const key of CONNECTOR_ENV_KEYS) {
      const previousValue = previousValues.get(key);
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  });
}

async function run() {
  const restoreFetch = installConnectorFetchMock();
  const sentEmailPayloads: Array<{
    from: string;
    to: string;
    subject: string;
    text: string;
  }> = [];

  setEmailTransportFactoryForTests(() => ({
    async verify() {},
    async sendMail(input) {
      sentEmailPayloads.push(input);
      return {
        messageId: "email-route-77",
      };
    },
  }));

  try {
    const accessRequest = new NextRequest("http://localhost/api/connectors", {
      headers: {
        "x-ceoclaw-role": "PM",
        "x-ceoclaw-workspace": "executive",
      },
    });

    await withEnv(
      {
        CEOCLAW_SKIP_AUTH: "true",
        OPENAI_API_KEY: "openai-test-key",
        TELEGRAM_BOT_TOKEN: "telegram-token",
        EMAIL_FROM: "ceoclaw@example.com",
        EMAIL_DEFAULT_TO: "hq@example.com",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "smtp-user",
        SMTP_PASSWORD: "smtp-password",
        GPS_API_URL: "https://gps.example.com/api/v1",
        GPS_API_KEY: "gps-api-key",
        ONE_C_BASE_URL: "https://1c.example.com/api/v1",
        ONE_C_API_KEY: "1c-api-key",
      },
      async () => {
        const connectorsResponse = await getConnectors(accessRequest);
        const connectorsBody = await connectorsResponse.json();

        assert.equal(connectorsResponse.status, 200);
        assert.equal(connectorsBody.status, "ok");
        assert.equal(connectorsBody.summary.total, 4);
        assert.equal(connectorsBody.summary.configured, 4);
        assert.equal(connectorsBody.summary.pending, 0);
        assert.equal(connectorsBody.connectors.length, 4);

        const telegramResponse = await getConnectorById(accessRequest, {
          params: Promise.resolve({ id: "telegram" }),
        });
        const telegramBody = await telegramResponse.json();
        assert.equal(telegramResponse.status, 200);
        assert.equal(telegramBody.id, "telegram");
        assert.equal(telegramBody.status, "ok");
        assert.equal(telegramBody.stub, false);
        assert.equal(telegramBody.metadata.webhookConfigured, true);

        const emailResponse = await getConnectorById(accessRequest, {
          params: Promise.resolve({ id: "email" }),
        });
        const emailBody = await emailResponse.json();
        assert.equal(emailResponse.status, 200);
        assert.equal(emailBody.id, "email");
        assert.equal(emailBody.status, "ok");
        assert.equal(emailBody.stub, false);
        assert.equal(emailBody.metadata.host, "smtp.example.com");
        assert.equal(emailBody.metadata.defaultRecipient, "hq@example.com");

        const gpsResponse = await getConnectorById(accessRequest, {
          params: Promise.resolve({ id: "gps" }),
        });
        const gpsBody = await gpsResponse.json();
        assert.equal(gpsResponse.status, 200);
        assert.equal(gpsBody.id, "gps");
        assert.equal(gpsBody.status, "ok");
        assert.equal(gpsBody.stub, false);
        assert.equal(gpsBody.metadata.equipmentCount, 68);

        const oneCResponse = await getConnectorById(accessRequest, {
          params: Promise.resolve({ id: "one-c" }),
        });
        const oneCBody = await oneCResponse.json();
        assert.equal(oneCResponse.status, 200);
        assert.equal(oneCBody.id, "one-c");
        assert.equal(oneCBody.status, "ok");
        assert.equal(oneCBody.stub, false);
        assert.equal(oneCBody.metadata.projectCount, 1);
        assert.equal(oneCBody.metadata.totalActualBudget, 118000000);

        const gpsSampleResponse = await getGpsSample(accessRequest);
        const gpsSampleBody = await gpsSampleResponse.json();
        assert.equal(gpsSampleResponse.status, 200);
        assert.equal(gpsSampleBody.id, "gps");
        assert.equal(gpsSampleBody.status, "ok");
        assert.equal(gpsSampleBody.samples.length, 1);
        assert.equal(gpsSampleBody.samples[0].equipmentId, "EXC-KOM-01");
        assert.equal(gpsSampleBody.samples[0].status, "work");

        const gpsTelemetryResponse = await getGpsTelemetry(accessRequest);
        const gpsTelemetryBody = await gpsTelemetryResponse.json();
        assert.equal(gpsTelemetryResponse.status, 200);
        assert.equal(gpsTelemetryBody.id, "gps");
        assert.equal(gpsTelemetryBody.status, "ok");
        assert.equal(gpsTelemetryBody.summary.sessionCount, 1);
        assert.equal(gpsTelemetryBody.summary.equipmentCount, 1);
        assert.equal(gpsTelemetryBody.summary.geofenceCount, 1);
        assert.equal(gpsTelemetryBody.equipment[0].equipmentId, "EXC-KOM-01");
        assert.equal(
          gpsTelemetryBody.geofences[0].geofenceName,
          "Salekhard-Labytnangi Earthwork Zone"
        );
        assert.equal(gpsTelemetryBody.sessions[0].sessionId, "sess-20260207-EXC-KOM-01-003");

        const oneCSampleResponse = await getOneCSample(accessRequest);
        const oneCSampleBody = await oneCSampleResponse.json();
        assert.equal(oneCSampleResponse.status, 200);
        assert.equal(oneCSampleBody.id, "one-c");
        assert.equal(oneCSampleBody.status, "ok");
        assert.equal(oneCSampleBody.samples.length, 2);
        assert.equal(oneCSampleBody.samples[0].projectId, "proj-yanao-001");
        assert.equal(oneCSampleBody.samples[1].status, "over_budget");

        const oneCFinanceResponse = await getOneCFinance(accessRequest);
        const oneCFinanceBody = await oneCFinanceResponse.json();
        assert.equal(oneCFinanceResponse.status, 200);
        assert.equal(oneCFinanceBody.id, "one-c");
        assert.equal(oneCFinanceBody.status, "ok");
        assert.equal(oneCFinanceBody.summary.projectCount, 2);
        assert.equal(oneCFinanceBody.summary.overPlanCount, 1);
        assert.equal(oneCFinanceBody.summary.underPlanCount, 1);
        assert.equal(oneCFinanceBody.summary.totalBudgetVariance, 3500000);
        assert.equal(oneCFinanceBody.projects[0].projectId, "proj-yanao-002");
        assert.equal(oneCFinanceBody.projects[0].budgetDeltaStatus, "over_plan");
        assert.equal(oneCFinanceBody.projects[1].projectId, "proj-yanao-001");
        assert.equal(oneCFinanceBody.projects[1].budgetDeltaStatus, "under_plan");

        const missingResponse = await getConnectorById(accessRequest, {
          params: Promise.resolve({ id: "missing" }),
        });
        const missingBody = await missingResponse.json();
        assert.equal(missingResponse.status, 404);
        assert.match(missingBody.error, /Unknown connector/);

        const emailBriefRequest = new NextRequest(
          "http://localhost/api/connectors/email/briefs",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-ceoclaw-role": "PM",
              "x-ceoclaw-workspace": "executive",
            },
            body: JSON.stringify({
              scope: "portfolio",
              locale: "ru",
              idempotencyKey: `connectors-route-email-${Date.now()}`,
            }),
          }
        );
        const emailBriefResponse = await postEmailBrief(emailBriefRequest);
        const emailBriefBody = await emailBriefResponse.json();
        assert.equal(emailBriefResponse.status, 201);
        assert.equal(emailBriefBody.delivered, true);
        assert.equal(emailBriefBody.recipient, "hq@example.com");
        assert.equal(emailBriefBody.messageId, "email-route-77");
        assert.equal(sentEmailPayloads.length, 1);
        assert.equal(sentEmailPayloads[0]?.to, "hq@example.com");
        assert.ok((sentEmailPayloads[0]?.subject ?? "").length > 0);

        const healthResponse = await getHealth();
        const healthBody = await healthResponse.json();

        assert.equal(healthResponse.status, 200);
        assert.equal(healthBody.status, "healthy");
        assert.equal(healthBody.checks.database.status, "connected");
        assert.equal(healthBody.checks.ai.status, "available");
        assert.equal(healthBody.checks.storage.status, "ok");
      }
    );

    console.log("PASS connectors-routes.unit");
  } finally {
    setEmailTransportFactoryForTests(null);
    restoreFetch();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
