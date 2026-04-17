import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { deliverWorkReportSignalPacketByEmail } from "@/lib/work-reports/signal-packet-email";
import type { WorkReportSignalPacketPortable } from "@/lib/work-reports/types";

function createEnv(overrides: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "",
    DIRECT_URL: "",
    ...overrides,
  };
}

function createPacket(): WorkReportSignalPacketPortable {
  return {
    packetId: "packet-1",
    createdAt: "2026-03-25T02:00:00.000Z",
    reportId: "wr-1",
    reportNumber: "#202603250001",
    reportStatus: "approved",
    projectId: "project-1",
    projectName: "Northern Rail Cutover",
    signal: {
      headline: "Исполнение отстаёт от подтверждённого плана",
      summary: "Площадка потеряла смену из-за недоступности техники и ждёт перепланирования.",
      reportId: "wr-1",
      reportNumber: "#202603250001",
      reportStatus: "approved",
      reportDate: "2026-03-25T00:00:00.000Z",
      section: "Секция А",
      projectId: "project-1",
      projectName: "Northern Rail Cutover",
      planFact: {
        status: "critical",
        plannedProgress: 54,
        actualProgress: 37,
        progressVariance: -17,
        cpi: 0.91,
        spi: 0.73,
        budgetVarianceRatio: 0.08,
        pendingWorkReports: 2,
        daysSinceLastApprovedReport: 1,
      },
      topAlerts: [
        {
          id: "alert-1",
          title: "Техника не допущена на площадку",
          severity: "critical",
          category: "logistics",
          summary: "Потеряна одна смена и растёт риск срыва следующего окна работ.",
        },
      ],
    },
    runs: [
      {
        purpose: "tasks",
        label: "Execution patch",
        pollPath: "/api/ai/runs/run-1",
        run: {
          id: "run-1",
          status: "completed",
          result: {
            summary: "Перепланировать смену и заэскалировать доступ техники.",
            proposal: {
              id: "proposal-1",
              title: "Shift replanning",
              summary: "Move crew and secure permit escalation.",
              state: "pending",
            },
          },
        },
      },
    ],
  };
}

describe("deliverWorkReportSignalPacketByEmail", () => {
  it("returns an email preview in dry-run mode", async () => {
    const result = await deliverWorkReportSignalPacketByEmail(
      {
        dryRun: true,
        locale: "ru",
        packet: createPacket(),
      },
      {
        env: createEnv({}),
      }
    );

    assert.equal(result.delivered, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.recipient, null);
    assert.match(result.subject, /Signal packet #202603250001/);
    assert.match(result.previewText, /Площадка потеряла смену/);
    assert.match(result.bodyText, /## Summary/);
  });

  it("uses the default recipient and sends the packet over SMTP", async () => {
    let sendPayload:
      | {
          to: string;
          subject: string;
          text: string;
          from: string;
          host: string;
        }
      | null = null;

    const result = await deliverWorkReportSignalPacketByEmail(
      {
        locale: "en",
        packet: createPacket(),
      },
      {
        env: createEnv({
          EMAIL_FROM: "ceoclaw@example.com",
          EMAIL_DEFAULT_TO: "ops@example.com",
          SMTP_HOST: "smtp.example.com",
          SMTP_USER: "smtp-user",
          SMTP_PASSWORD: "smtp-password",
        }),
        sendMessage: async (input) => {
          sendPayload = {
            to: input.to,
            subject: input.subject,
            text: input.text,
            from: input.config.from,
            host: input.config.host,
          };

          return {
            ok: true,
            messageId: "smtp-message-11",
          };
        },
      }
    );

    assert.equal(result.delivered, true);
    assert.equal(result.recipient, "ops@example.com");
    assert.equal(result.messageId, "smtp-message-11");
    assert.deepEqual(sendPayload, {
      to: "ops@example.com",
      subject: result.subject,
      text: result.bodyText,
      from: "ceoclaw@example.com",
      host: "smtp.example.com",
    });
  });

  it("requires a recipient when no default email target is configured", async () => {
    await assert.rejects(
      () =>
        deliverWorkReportSignalPacketByEmail(
          {
            locale: "ru",
            packet: createPacket(),
          },
          {
            env: createEnv({
              EMAIL_FROM: "ceoclaw@example.com",
              SMTP_HOST: "smtp.example.com",
              SMTP_USER: "smtp-user",
              SMTP_PASSWORD: "smtp-password",
            }),
          }
        ),
      /recipient is required/i
    );
  });

  it("propagates SMTP failures", async () => {
    await assert.rejects(
      () =>
        deliverWorkReportSignalPacketByEmail(
          {
            locale: "ru",
            packet: createPacket(),
            recipient: "ops@example.com",
          },
          {
            env: createEnv({
              EMAIL_FROM: "ceoclaw@example.com",
              SMTP_HOST: "smtp.example.com",
              SMTP_USER: "smtp-user",
              SMTP_PASSWORD: "smtp-password",
            }),
            sendMessage: async () => ({
              ok: false,
              message: "SMTP delivery failed: auth rejected",
            }),
          }
        ),
      /SMTP delivery failed: auth rejected/
    );
  });
});
