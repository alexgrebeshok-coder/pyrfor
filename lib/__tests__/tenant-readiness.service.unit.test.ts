import assert from "node:assert/strict";

import { buildAccessProfile } from "@/lib/auth/access-profile";
import type { ExceptionInboxResult } from "@/lib/command-center";
import type { ConnectorStatus } from "@/lib/connectors";
import type { PilotFeedbackListResult } from "@/lib/pilot-feedback";
import { getTenantReadiness } from "@/lib/tenant-readiness";

const liveRuntime = {
  dataMode: "live" as const,
  databaseConfigured: true,
  healthStatus: "ok" as const,
};

function createPilot(stage: "controlled" | "delivery" | "open") {
  return {
    allowedWriteWorkspaces:
      stage === "delivery" ? ["delivery"] : ["delivery", "executive"],
    blockedWorkflows:
      stage === "delivery"
        ? (["executive_delivery", "scheduled_delivery"] as const)
        : ([] as const),
    configured: true,
    liveMutationAllowed: true,
    runtimeStatus: "live" as const,
    stage,
    tenantSlug: "tenant-yamal",
  };
}

function createConnectors(
  overrides: Partial<Record<ConnectorStatus["id"], Partial<ConnectorStatus>>> = {}
): ConnectorStatus[] {
  const base: ConnectorStatus[] = [
    {
      id: "telegram",
      name: "Telegram",
      description: "Telegram connector",
      direction: "bidirectional",
      sourceSystem: "Telegram",
      operations: [],
      credentials: [],
      apiSurface: [],
      stub: false,
      status: "ok",
      configured: true,
      checkedAt: "2026-03-12T08:00:00.000Z",
      message: "ok",
      missingSecrets: [],
    },
    {
      id: "email",
      name: "Email",
      description: "Email connector",
      direction: "outbound",
      sourceSystem: "SMTP",
      operations: [],
      credentials: [],
      apiSurface: [],
      stub: false,
      status: "ok",
      configured: true,
      checkedAt: "2026-03-12T08:00:00.000Z",
      message: "ok",
      missingSecrets: [],
    },
    {
      id: "gps",
      name: "GPS/GLONASS",
      description: "GPS connector",
      direction: "inbound",
      sourceSystem: "GPS",
      operations: [],
      credentials: [],
      apiSurface: [],
      stub: false,
      status: "ok",
      configured: true,
      checkedAt: "2026-03-12T08:00:00.000Z",
      message: "ok",
      missingSecrets: [],
    },
    {
      id: "one-c",
      name: "1C",
      description: "1C connector",
      direction: "inbound",
      sourceSystem: "1C",
      operations: [],
      credentials: [],
      apiSurface: [],
      stub: false,
      status: "ok",
      configured: true,
      checkedAt: "2026-03-12T08:00:00.000Z",
      message: "ok",
      missingSecrets: [],
    },
  ];

  return base.map((connector) => ({
    ...connector,
    ...(overrides[connector.id] ?? {}),
  }));
}

function createInbox(
  items: ExceptionInboxResult["items"]
): ExceptionInboxResult {
  return {
    syncedAt: "2026-03-12T08:05:00.000Z",
    summary: {
      total: items.length,
      open: items.filter((item) => item.status === "open").length,
      acknowledged: items.filter((item) => item.status === "acknowledged").length,
      resolved: items.filter((item) => item.status === "resolved").length,
      critical: items.filter((item) => item.urgency === "critical").length,
      high: items.filter((item) => item.urgency === "high").length,
      assigned: items.filter((item) => item.owner.mode === "assigned").length,
      unassigned: items.filter((item) => item.owner.mode === "unassigned").length,
      escalations: items.filter((item) => item.layer === "escalation").length,
      reconciliation: items.filter((item) => item.layer === "reconciliation").length,
    },
    items,
    sync: {
      escalations: null,
      reconciliation: null,
    },
  };
}

function createFeedback(
  items: PilotFeedbackListResult["items"]
): PilotFeedbackListResult {
  return {
    items,
    summary: {
      total: items.length,
      open: items.filter((item) => item.status === "open").length,
      inReview: items.filter((item) => item.status === "in_review").length,
      resolved: items.filter((item) => item.status === "resolved").length,
      critical: items.filter((item) => item.severity === "critical").length,
      high: items.filter((item) => item.severity === "high").length,
      assigned: items.filter((item) => item.owner.mode === "assigned").length,
      unassigned: items.filter((item) => item.owner.mode === "unassigned").length,
      workflowRuns: items.filter((item) => item.targetType === "workflow_run").length,
      exceptionItems: items.filter((item) => item.targetType === "exception_item").length,
      reconciliationTargets: items.filter(
        (item) => item.targetType === "reconciliation_casefile"
      ).length,
    },
  };
}

async function testBlockedReadiness() {
  const report = await getTenantReadiness({
    accessProfile: buildAccessProfile({
      organizationSlug: "tenant-yamal",
      role: "PM",
      workspaceId: "executive",
    }),
    connectors: createConnectors({
      gps: {
        configured: false,
        message: "GPS live probe is waiting for GPS_API_URL and GPS_API_KEY.",
        missingSecrets: ["GPS_API_URL", "GPS_API_KEY"],
        status: "pending",
      },
    }),
    feedback: null,
    inbox: null,
    now: () => new Date("2026-03-12T08:10:00.000Z"),
    pilot: createPilot("delivery"),
    runtime: {
      dataMode: "demo" as const,
      databaseConfigured: false,
      healthStatus: "ok" as const,
    },
  });

  assert.equal(report.outcome, "blocked");
  assert.equal(report.summary.blockers > 0, true);
  assert.equal(report.checklist.find((item) => item.id === "runtime")?.state, "blocked");
  assert.equal(report.checklist.find((item) => item.id === "rollout")?.state, "blocked");
  assert.equal(report.checklist.find((item) => item.id === "connectors")?.state, "blocked");
  assert.match(
    report.blockers.map((item) => item.title).join(" "),
    /Portfolio runtime is not live|Rollout posture still blocks live promotion|GPS\/GLONASS is waiting for credentials/i
  );
}

async function testGuardedReadiness() {
  const report = await getTenantReadiness({
    accessProfile: buildAccessProfile({
      organizationSlug: "tenant-yamal",
      role: "EXEC",
      workspaceId: "executive",
    }),
    connectors: createConnectors(),
    feedback: createFeedback([
      {
        id: "feedback-1",
        targetType: "workflow_run",
        targetId: "run-1",
        targetLabel: "Workflow 1",
        sourceLabel: "Audit pack workflow",
        sourceHref: "/audit-packs?runId=run-1",
        projectId: "project-1",
        projectName: "Yamal",
        severity: "medium",
        status: "in_review",
        summary: "Operator copy needs one more pass.",
        details: null,
        reporterName: "Operator",
        resolutionNote: null,
        owner: {
          id: "member-1",
          mode: "assigned",
          name: "Olga",
          role: "OPS",
        },
        metadata: {},
        openedAt: "2026-03-12T07:00:00.000Z",
        resolvedAt: null,
        createdAt: "2026-03-12T07:00:00.000Z",
        updatedAt: "2026-03-12T07:10:00.000Z",
        links: [{ href: "/audit-packs?runId=run-1", label: "Open audit pack" }],
      },
    ]),
    inbox: createInbox([
      {
        id: "exception-1",
        sourceId: "case-1",
        layer: "reconciliation",
        title: "Telemetry gap",
        summary: "One medium telemetry gap remains.",
        projectId: "project-1",
        projectName: "Yamal",
        urgency: "medium",
        status: "open",
        owner: {
          id: null,
          mode: "suggested",
          name: "OPS follow-through",
          role: "OPS",
        },
        sourceLabel: "Reconciliation casefile",
        sourceState: "partial",
        nextAction: "Investigate the telemetry gap.",
        observedAt: "2026-03-12T07:30:00.000Z",
        links: [{ href: "/command-center", label: "Open command center" }],
      },
    ]),
    now: () => new Date("2026-03-12T08:20:00.000Z"),
    pilot: createPilot("controlled"),
    runtime: liveRuntime,
  });

  assert.equal(report.outcome, "guarded");
  assert.equal(report.summary.blockers, 0);
  assert.equal(report.summary.warnings >= 1, true);
  assert.equal(report.checklist.find((item) => item.id === "rollout")?.state, "warning");
  assert.equal(report.checklist.find((item) => item.id === "follow-through")?.state, "warning");
}

async function testReadyWithWarningsReadiness() {
  const report = await getTenantReadiness({
    accessProfile: buildAccessProfile({
      organizationSlug: "tenant-yamal",
      role: "EXEC",
      workspaceId: "executive",
    }),
    connectors: createConnectors({
      email: {
        configured: false,
        message: "Email live probe is waiting for SMTP configuration.",
        missingSecrets: ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"],
        status: "pending",
      },
    }),
    feedback: createFeedback([]),
    inbox: createInbox([]),
    now: () => new Date("2026-03-12T08:25:00.000Z"),
    pilot: createPilot("open"),
    runtime: liveRuntime,
  });

  assert.equal(report.outcome, "ready_with_warnings");
  assert.equal(report.summary.blockers, 0);
  assert.equal(report.checklist.find((item) => item.id === "connectors")?.state, "warning");
}

async function main() {
  await testBlockedReadiness();
  await testGuardedReadiness();
  await testReadyWithWarningsReadiness();
  console.log("PASS tenant-readiness.service.unit");
}

void main();
