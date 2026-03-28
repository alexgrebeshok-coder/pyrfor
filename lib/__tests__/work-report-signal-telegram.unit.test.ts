import assert from "node:assert/strict";

import { deliverWorkReportSignalPacketToTelegram } from "@/lib/work-reports/signal-packet-telegram";
import type { WorkReportSignalPacket } from "@/lib/work-reports/types";

const packet: WorkReportSignalPacket = {
  packetId: "work-report-packet-telegram-test",
  createdAt: "2026-03-24T12:00:00.000Z",
  reportId: "wr-telegram-1",
  reportNumber: "#202603240001",
  reportStatus: "approved",
  projectId: "p6",
  projectName: "Реконструкция офисного здания",
  signal: {
    headline: "Исполнение отстаёт от подтверждённого плана",
    summary:
      "Полевая фиксация подтверждает отставание по critical path и требует handoff в delivery контур.",
    reportId: "wr-telegram-1",
    reportNumber: "#202603240001",
    reportStatus: "approved",
    reportDate: "2026-03-24T00:00:00.000Z",
    section: "Секция А",
    projectId: "p6",
    projectName: "Реконструкция офисного здания",
    planFact: {
      status: "critical",
      plannedProgress: 48,
      actualProgress: 29,
      progressVariance: -19,
      cpi: 0.81,
      spi: 0.6,
      budgetVarianceRatio: 0.08,
      pendingWorkReports: 1,
      daysSinceLastApprovedReport: 2,
    },
    topAlerts: [
      {
        id: "p6-schedule",
        title: "Исполнение отстаёт от подтверждённого плана",
        severity: "critical",
        category: "schedule",
        summary: "Просрочка уже влияет на ближайший milestone.",
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
        agentId: "execution-planner",
        title: "execution-planner",
        prompt: "Prompt",
        status: "completed",
        createdAt: "2026-03-24T12:00:00.000Z",
        updatedAt: "2026-03-24T12:01:00.000Z",
        context: {
          type: "project",
          pathname: "/projects/p6",
          title: "Реконструкция офисного здания",
          projectId: "p6",
        },
        result: {
          summary: "Создать recovery-задачу по допуску техники.",
          proposal: {
            id: "proposal-1",
            type: "task_batch",
            state: "pending",
            title: "Execution recovery",
            summary: "Добавить задачу на эскалацию допуска техники.",
            items: [],
          },
        },
      },
    },
  ],
};

async function testDryRunReturnsPreview() {
  const result = await deliverWorkReportSignalPacketToTelegram({
    packet,
    locale: "ru",
    dryRun: true,
  });

  assert.equal(result.delivered, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.chatId, null);
  assert.match(result.messageText, /Полевой сигнал #202603240001/);
  assert.match(result.messageText, /Execution patch/);
}

async function testSendUsesDefaultChatId() {
  let sendPayload: { token: string; chatId: string | number; text: string } | null = null;

  const result = await deliverWorkReportSignalPacketToTelegram(
    {
      packet,
      locale: "ru",
    },
    {
      env: {
        TELEGRAM_BOT_TOKEN: "telegram-token",
        TELEGRAM_DEFAULT_CHAT_ID: "-10012345",
      } as NodeJS.ProcessEnv,
      sendMessage: async (input) => {
        sendPayload = input;
        return {
          ok: true,
          result: {
            message_id: 88,
          },
        };
      },
    }
  );

  assert.equal(result.delivered, true);
  assert.equal(result.chatId, "-10012345");
  assert.equal(result.messageId, 88);
  assert.deepEqual(sendPayload, {
    token: "telegram-token",
    chatId: "-10012345",
    text: result.messageText,
  });
}

async function testSendRequiresChatIdWithoutDefault() {
  await assert.rejects(
    () =>
      deliverWorkReportSignalPacketToTelegram(
        {
          packet,
          locale: "ru",
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: "telegram-token",
          } as NodeJS.ProcessEnv,
        }
      ),
    /chat id is required/i
  );
}

async function main() {
  await testDryRunReturnsPreview();
  await testSendUsesDefaultChatId();
  await testSendRequiresChatIdWithoutDefault();
  console.log("PASS work-report-signal-telegram.unit");
}

void main();
