import assert from "node:assert/strict";

import { exportWorkReportSignalPacket } from "@/lib/work-reports/packet-export";
import type { WorkReportSignalPacket } from "@/lib/work-reports/types";

const packet: WorkReportSignalPacket = {
  packetId: "work-report-packet-test",
  createdAt: "2026-03-11T08:00:00.000Z",
  reportId: "wr-1",
  reportNumber: "#202603110001",
  reportStatus: "approved",
  projectId: "p6",
  projectName: "Реконструкция офисного здания",
  signal: {
    headline: "Исполнение отстаёт от подтверждённого плана",
    summary: "Полевой отчёт указывает на разрыв между планом и фактом.",
    reportId: "wr-1",
    reportNumber: "#202603110001",
    reportStatus: "approved",
    reportDate: "2026-03-11T00:00:00.000Z",
    section: "Секция А",
    projectId: "p6",
    projectName: "Реконструкция офисного здания",
    planFact: {
      status: "critical",
      plannedProgress: 40,
      actualProgress: 22,
      progressVariance: -18,
      cpi: 0.81,
      spi: 0.55,
      budgetVarianceRatio: 0.08,
      pendingWorkReports: 1,
      daysSinceLastApprovedReport: 1,
    },
    topAlerts: [
      {
        id: "p6-schedule",
        title: "Исполнение отстаёт от подтверждённого плана",
        severity: "critical",
        category: "schedule",
        summary: "Просрочка уже видна на critical path.",
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
        createdAt: "2026-03-11T08:00:00.000Z",
        updatedAt: "2026-03-11T08:01:00.000Z",
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

function testMarkdownExportIncludesPacketSections() {
  const artifact = exportWorkReportSignalPacket(packet, "markdown");

  assert.equal(artifact.contentType, "text/markdown; charset=utf-8");
  assert.match(artifact.fileName, /signal-packet/);
  assert.match(artifact.content, /# Signal packet · #202603110001/);
  assert.match(artifact.content, /## Top alerts/);
  assert.match(artifact.content, /## Run outputs/);
  assert.match(artifact.content, /Execution patch/);
}

function testJsonExportKeepsPacketShape() {
  const artifact = exportWorkReportSignalPacket(packet, "json");

  assert.equal(artifact.contentType, "application\/json; charset=utf-8");
  const parsed = JSON.parse(artifact.content) as WorkReportSignalPacket;
  assert.equal(parsed.packetId, packet.packetId);
  assert.equal(parsed.runs[0]?.run.result?.proposal?.title, "Execution recovery");
}

function main() {
  testMarkdownExportIncludesPacketSections();
  testJsonExportKeepsPacketShape();
  console.log("PASS work-report-packet-export.unit");
}

void main();
