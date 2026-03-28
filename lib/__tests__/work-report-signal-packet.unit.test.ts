import assert from "node:assert/strict";

import type { AIContextSnapshot, AIRunInput, AIRunRecord } from "@/lib/ai/types";
import type { ExecutiveSnapshot } from "@/lib/briefs/types";
import {
  buildWorkReportSignalRunBlueprints,
  createWorkReportSignalPacket,
} from "@/lib/work-reports/signal-packet";
import type { WorkReportView } from "@/lib/work-reports/types";

const context: AIContextSnapshot = {
  locale: "ru",
  interfaceLocale: "ru",
  generatedAt: "2026-03-11T00:00:00.000Z",
  activeContext: {
    type: "project",
    pathname: "/projects/p6",
    title: "Реконструкция офисного здания",
    subtitle: "Field signal packet",
    projectId: "p6",
  },
  projects: [
    {
      id: "p6",
      name: "Реконструкция офисного здания",
      description: "Капремонт и модернизация инженерных систем.",
      status: "at-risk",
      progress: 22,
      direction: "construction",
      budget: { planned: 12000000, actual: 5200000, currency: "RUB" },
      dates: { start: "2025-09-01", end: "2026-08-31" },
      nextMilestone: { name: "Замена оконных блоков", date: "2026-04-10" },
      team: ["Мария К.", "Анна Л."],
      risks: 3,
      location: "Новосибирск",
      priority: "critical",
      health: 42,
      objectives: [],
      materials: 35,
      laborProductivity: 58,
      safety: { ltifr: 0.5, trir: 1.8 },
      history: [
        {
          date: "2026-03-10T00:00:00.000Z",
          progress: 20,
          budgetPlanned: 4800000,
          budgetActual: 5200000,
        },
      ],
    },
  ],
  tasks: [
    {
      id: "t1",
      projectId: "p6",
      title: "Подготовить допуск техники",
      description: "Закрыть пропуск на площадку.",
      status: "blocked",
      priority: "high",
      dueDate: "2026-03-08",
      assignee: { id: "tm-1", name: "Мария К.", initials: "МК", avatar: null, role: "PM" },
      subtasks: 0,
      progress: 40,
      blockedReason: "Нет согласования доступа",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
      tags: [],
    },
  ],
  team: [],
  risks: [],
  notifications: [],
  project: {
    id: "p6",
    name: "Реконструкция офисного здания",
    description: "Капремонт и модернизация инженерных систем.",
    status: "at-risk",
    progress: 22,
    direction: "construction",
    budget: { planned: 12000000, actual: 5200000, currency: "RUB" },
    dates: { start: "2025-09-01", end: "2026-08-31" },
    nextMilestone: { name: "Замена оконных блоков", date: "2026-04-10" },
    team: ["Мария К.", "Анна Л."],
    risks: 3,
    location: "Новосибирск",
    priority: "critical",
    health: 42,
    objectives: [],
    materials: 35,
    laborProductivity: 58,
    safety: { ltifr: 0.5, trir: 1.8 },
    history: [
      {
        date: "2026-03-10T00:00:00.000Z",
        progress: 20,
        budgetPlanned: 4800000,
        budgetActual: 5200000,
      },
    ],
  },
  projectTasks: [],
};

const report: WorkReportView = {
  id: "wr-1",
  reportNumber: "#202603110001",
  projectId: "p6",
  project: { id: "p6", name: "Реконструкция офисного здания" },
  authorId: "tm-1",
  author: { id: "tm-1", name: "Мария К.", initials: "МК", role: "PM" },
  reviewerId: null,
  reviewer: null,
  section: "Секция А",
  reportDate: "2026-03-11T00:00:00.000Z",
  workDescription: "Подрядчик не смог завести технику на площадку, часть объёма перенесена.",
  volumes: [],
  personnelCount: 8,
  personnelDetails: null,
  equipment: "Автокран 25т",
  weather: "Снег и порывистый ветер",
  issues: "Нет согласования доступа техники.",
  nextDayPlan: "Дожать допуск и вернуть монтаж в график.",
  attachments: [],
  status: "submitted",
  reviewComment: null,
  source: "manual",
  externalReporterTelegramId: null,
  externalReporterName: null,
  submittedAt: "2026-03-11T08:00:00.000Z",
  reviewedAt: null,
  createdAt: "2026-03-11T08:00:00.000Z",
  updatedAt: "2026-03-11T08:00:00.000Z",
};

const snapshot: ExecutiveSnapshot = {
  generatedAt: "2026-03-11T08:00:00.000Z",
  projects: [
    {
      id: "p6",
      name: "Реконструкция офисного здания",
      description: "Капремонт и модернизация инженерных систем.",
      status: "at-risk",
      priority: "critical",
      progress: 22,
      health: 42,
      direction: "construction",
      location: "Новосибирск",
      budget: { planned: 12000000, actual: 5200000, currency: "RUB" },
      dates: { start: "2025-09-01", end: "2026-08-31" },
      nextMilestone: { name: "Замена оконных блоков", date: "2026-04-10" },
      history: [
        {
          date: "2026-03-10T00:00:00.000Z",
          progress: 20,
          budgetPlanned: 4800000,
          budgetActual: 5200000,
        },
      ],
    },
  ],
  tasks: [
    {
      id: "t1",
      projectId: "p6",
      title: "Подготовить допуск техники",
      status: "blocked",
      priority: "high",
      dueDate: "2026-03-08T00:00:00.000Z",
      createdAt: "2026-03-01T00:00:00.000Z",
      completedAt: null,
      assigneeId: "tm-1",
      assigneeName: "Мария К.",
    },
  ],
  risks: [
    {
      id: "r1",
      projectId: "p6",
      title: "Доступ техники на площадку",
      status: "open",
      severity: 0.85,
      probability: 0.85,
      impact: 0.85,
      mitigation: "Эскалировать допуск через технадзор.",
      owner: "Анна Л.",
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-11T07:00:00.000Z",
    },
  ],
  milestones: [
    {
      id: "m1",
      projectId: "p6",
      title: "Замена оконных блоков",
      date: "2026-04-10T00:00:00.000Z",
      status: "upcoming",
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
  ],
  workReports: [
    {
      id: "wr-0",
      projectId: "p6",
      reportNumber: "#202603100001",
      reportDate: "2026-03-10T00:00:00.000Z",
      status: "approved",
      source: "manual",
      authorId: "tm-1",
      reviewerId: "tm-2",
      submittedAt: "2026-03-10T08:00:00.000Z",
      reviewedAt: "2026-03-10T10:00:00.000Z",
    },
    {
      id: "wr-1",
      projectId: "p6",
      reportNumber: "#202603110001",
      reportDate: "2026-03-11T00:00:00.000Z",
      status: "submitted",
      source: "manual",
      authorId: "tm-1",
      reviewerId: null,
      submittedAt: "2026-03-11T08:00:00.000Z",
      reviewedAt: null,
    },
  ],
  teamMembers: [
    {
      id: "tm-1",
      name: "Мария К.",
      role: "PM",
      capacity: 1,
      allocated: 1,
      projectIds: ["p6"],
    },
  ],
};

function testBlueprintsStayPurposeScoped() {
  const signal = {
    headline: "Исполнение отстаёт от подтверждённого плана",
    summary: "Полевой отчёт указывает на разрыв между планом и фактом.",
    reportId: report.id,
    reportNumber: report.reportNumber,
    reportStatus: report.status,
    reportDate: report.reportDate,
    section: report.section,
    projectId: report.projectId,
    projectName: report.project.name,
    planFact: {
      status: "critical" as const,
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
        severity: "critical" as const,
        category: "schedule",
        summary: "Просрочка уже видна на critical path.",
      },
    ],
  };

  const blueprints = buildWorkReportSignalRunBlueprints(context, report, signal, "ru", {
    packetId: "work-report-packet-test",
  });

  assert.equal(blueprints.length, 3);
  assert.equal(blueprints[0]?.purpose, "tasks");
  assert.match(blueprints[0]?.input.prompt ?? "", /Update the execution plan/);
  assert.match(blueprints[0]?.input.prompt ?? "", /#202603110001/);
  assert.equal(blueprints[0]?.input.source?.workflow, "work_report_signal_packet");
  assert.equal(blueprints[0]?.input.source?.packetId, "work-report-packet-test");
  assert.equal(blueprints[1]?.purpose, "risks");
  assert.match(blueprints[1]?.input.prompt ?? "", /Raise risks or blockers/);
  assert.equal(blueprints[2]?.purpose, "status");
  assert.match(blueprints[2]?.input.prompt ?? "", /Draft a concise management status update/);
}

async function testPacketCreatesThreeRuns() {
  const capturedInputs: AIRunInput[] = [];
  const approvedReport: WorkReportView = {
    ...report,
    reviewerId: "tm-2",
    reviewer: { id: "tm-2", name: "Анна Л.", initials: "АЛ", role: "PM" },
    reviewedAt: "2026-03-11T09:00:00.000Z",
    status: "approved",
  };

  const packet = await createWorkReportSignalPacket(
    "wr-1",
    {
      locale: "ru",
      interfaceLocale: "ru",
    },
        {
          now: () => new Date("2026-03-11T08:00:00.000Z"),
          packetIdFactory: () => "work-report-packet-test",
          loadWorkReport: async () => approvedReport,
          loadContext: async () => context,
          loadSnapshot: async () => snapshot,
          createRun: async (input) => {
        capturedInputs.push(input);
        const now = "2026-03-11T08:00:00.000Z";

        return {
          id: `run-${capturedInputs.length}`,
          agentId: input.agent.id,
          title: input.agent.id,
          prompt: input.prompt,
          status: "queued",
          createdAt: now,
          updatedAt: now,
          context: input.context.activeContext,
        } satisfies AIRunRecord;
      },
    }
  );

  assert.equal(packet.packetId, "work-report-packet-test");
  assert.equal(packet.reportId, "wr-1");
  assert.equal(packet.projectId, "p6");
  assert.equal(packet.runs.length, 3);
  assert.deepEqual(
    packet.runs.map((entry) => entry.purpose),
    ["tasks", "risks", "status"]
  );
  assert.equal(packet.signal.topAlerts.length, 3);
  assert.equal(capturedInputs.length, 3);
}

async function testPacketRequiresApprovedReports() {
  await assert.rejects(
    () =>
      createWorkReportSignalPacket(
        "wr-1",
        {
          locale: "ru",
          interfaceLocale: "ru",
        },
        {
          loadWorkReport: async () => report,
          loadContext: async () => context,
          loadSnapshot: async () => snapshot,
        }
      ),
    /Only approved work reports can be converted into action packets\./
  );
}

async function main() {
  testBlueprintsStayPurposeScoped();
  await testPacketCreatesThreeRuns();
  await testPacketRequiresApprovedReports();
  console.log("PASS work-report-signal-packet.unit");
}

void main();
