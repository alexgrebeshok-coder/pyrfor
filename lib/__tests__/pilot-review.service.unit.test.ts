import assert from "node:assert/strict";

import { buildAccessProfile } from "@/lib/auth/access-profile";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type { ExceptionInboxResult } from "@/lib/command-center";
import { EVIDENCE_LEDGER_SYNC_KEY } from "@/lib/evidence/service";
import type { PilotFeedbackListResult } from "@/lib/pilot-feedback";
import { getPilotReviewScorecard } from "@/lib/pilot-review";
import type { ServerRuntimeState } from "@/lib/server/runtime-mode";
import type { DerivedSyncCheckpointView } from "@/lib/sync-state";
import type { TenantReadinessReport } from "@/lib/tenant-readiness";

const liveRuntime: ServerRuntimeState = {
  dataMode: "live",
  databaseConfigured: true,
  healthStatus: "ok",
};

function createReadiness(
  overrides: Partial<TenantReadinessReport> & Pick<TenantReadinessReport, "outcome" | "outcomeLabel">
): TenantReadinessReport {
  return {
    accessProfile: {
      organizationSlug: "tenant-yamal",
      role: "EXEC",
      workspaceId: "executive",
    },
    blockers: [],
    checklist: [],
    connectorSummary: {
      configured: 4,
      degraded: 0,
      ok: 4,
      pending: 0,
      status: "ok",
      total: 4,
    },
    connectors: [],
    generatedAt: "2026-03-12T09:00:00.000Z",
    outcome: overrides.outcome,
    outcomeLabel: overrides.outcomeLabel,
    pilotFeedback: {
      critical: 0,
      high: 0,
      inReview: 0,
      open: 0,
      resolved: 0,
      total: 0,
    },
    posture: {
      blockedWorkflows: [],
      configured: true,
      liveMutationAllowed: true,
      runtimeStatus: "live",
      stage: overrides.outcome === "guarded" ? "controlled" : "open",
      stageLabel: overrides.outcome === "guarded" ? "Controlled rollout" : "Open rollout",
      tenantSlug: "tenant-yamal",
      writeWorkspaces: ["delivery", "executive"],
    },
    readySignals: [],
    runtime: liveRuntime,
    summary: {
      blockers: overrides.outcome === "blocked" ? 2 : 0,
      connectorsConfigured: 4,
      connectorsDegraded: 0,
      connectorsOk: 4,
      connectorsPending: 0,
      readySignals: overrides.outcome === "ready" ? 5 : 3,
      unresolvedExceptions: 0,
      unresolvedFeedback: 0,
      warnings:
        overrides.outcome === "guarded" || overrides.outcome === "ready_with_warnings" ? 1 : 0,
    },
    tenant: {
      label: "Configured pilot tenant",
      slug: "tenant-yamal",
      source: "pilot_control",
    },
    unresolvedConcerns: {
      acknowledged: 0,
      critical: 0,
      high: 0,
      open: 0,
      resolved: 0,
      total: 0,
    },
    warnings: [],
    ...overrides,
  };
}

function createInbox(items: ExceptionInboxResult["items"]): ExceptionInboxResult {
  return {
    syncedAt: "2026-03-12T09:00:00.000Z",
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

function createFeedback(items: PilotFeedbackListResult["items"]): PilotFeedbackListResult {
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

function createDeliveryEntry(
  overrides: Partial<BriefDeliveryLedgerRecord> & Pick<BriefDeliveryLedgerRecord, "id" | "status">
): BriefDeliveryLedgerRecord {
  return {
    attemptCount: 1,
    channel: "telegram",
    contentHash: "hash-1",
    createdAt: "2026-03-12T08:00:00.000Z",
    deliveredAt: overrides.status === "delivered" ? "2026-03-12T08:05:00.000Z" : null,
    dryRun: false,
    firstAttemptAt: "2026-03-12T08:01:00.000Z",
    headline: "Executive brief",
    id: overrides.id,
    idempotencyKey: `key-${overrides.id}`,
    lastAttemptAt: "2026-03-12T08:02:00.000Z",
    lastError: overrides.status === "failed" ? "SMTP timeout" : null,
    locale: "ru",
    mode: "manual",
    projectId: null,
    projectName: null,
    provider: "smtp",
    providerMessageId: overrides.status === "delivered" ? "message-1" : null,
    retryPosture: overrides.status === "failed" ? "retryable" : "sealed",
    scheduledPolicyId: null,
    scope: "portfolio",
    status: overrides.status,
    target: "exec@example.com",
    updatedAt: "2026-03-12T08:05:00.000Z",
    ...overrides,
  };
}

function createCheckpoint(
  key: string,
  overrides: Partial<DerivedSyncCheckpointView>
): DerivedSyncCheckpointView {
  return {
    createdAt: "2026-03-12T08:00:00.000Z",
    key,
    lastCompletedAt: "2026-03-12T08:00:00.000Z",
    lastError: null,
    lastResultCount: 1,
    lastStartedAt: "2026-03-12T07:59:00.000Z",
    lastSuccessAt: "2026-03-12T08:00:00.000Z",
    metadata: {},
    status: "success",
    updatedAt: "2026-03-12T08:00:00.000Z",
    ...overrides,
  };
}

async function testBlockedScorecard() {
  const scorecard = await getPilotReviewScorecard({
    accessProfile: buildAccessProfile({
      organizationSlug: "tenant-yamal",
      role: "EXEC",
      workspaceId: "executive",
    }),
    connectors: [],
    deliveryEntries: [
      createDeliveryEntry({
        id: "delivery-1",
        lastError: "SMTP timeout",
        status: "failed",
      }),
    ],
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
        severity: "critical",
        status: "open",
        summary: "Pilot blocker is still open.",
        details: null,
        reporterName: "Operator",
        resolutionNote: null,
        owner: {
          id: null,
          mode: "unassigned",
          name: "Unassigned",
          role: null,
        },
        metadata: {},
        openedAt: "2026-03-11T10:00:00.000Z",
        resolvedAt: null,
        createdAt: "2026-03-11T10:00:00.000Z",
        updatedAt: "2026-03-12T08:00:00.000Z",
        links: [{ href: "/pilot-feedback", label: "Open pilot feedback" }],
      },
    ]),
    getFreshnessCheckpoint: async (key) =>
      key === EVIDENCE_LEDGER_SYNC_KEY
        ? createCheckpoint(key, {
            lastError: "Evidence sync failed",
            lastSuccessAt: null,
            status: "error",
          })
        : createCheckpoint(key, {}),
    inbox: createInbox([
      {
        id: "exception-1",
        sourceId: "case-1",
        layer: "reconciliation",
        title: "Finance mismatch",
        summary: "Critical mismatch remains.",
        projectId: "project-1",
        projectName: "Yamal",
        urgency: "critical",
        status: "open",
        owner: {
          id: null,
          mode: "unassigned",
          name: "Unassigned",
          role: null,
        },
        sourceLabel: "Reconciliation casefile",
        sourceState: "blocked",
        nextAction: "Resolve the mismatch.",
        observedAt: "2026-03-11T09:00:00.000Z",
        links: [{ href: "/command-center", label: "Open command center" }],
      },
    ]),
    now: () => new Date("2026-03-12T10:00:00.000Z"),
    readiness: createReadiness({
      outcome: "blocked",
      outcomeLabel: "Blocked",
    }),
    runtime: liveRuntime,
  });

  assert.equal(scorecard.outcome, "blocked");
  assert.equal(scorecard.summary.blockedSections >= 3, true);
  assert.equal(
    scorecard.sections.find((section) => section.id === "exceptions")?.state,
    "blocked"
  );
  assert.equal(
    scorecard.sections.find((section) => section.id === "freshness")?.state,
    "blocked"
  );
  assert.match(scorecard.artifact.content, /Review outcome: Blocked/);
}

async function testGuardedScorecard() {
  const scorecard = await getPilotReviewScorecard({
    accessProfile: buildAccessProfile({
      organizationSlug: "tenant-yamal",
      role: "EXEC",
      workspaceId: "executive",
    }),
    connectors: [],
    deliveryEntries: [
      createDeliveryEntry({
        deliveredAt: "2026-03-12T09:20:00.000Z",
        id: "delivery-2",
        lastAttemptAt: "2026-03-12T09:20:00.000Z",
        providerMessageId: "message-2",
        status: "delivered",
        updatedAt: "2026-03-12T09:20:00.000Z",
      }),
    ],
    feedback: createFeedback([]),
    getFreshnessCheckpoint: async (key) => createCheckpoint(key, {}),
    inbox: createInbox([]),
    now: () => new Date("2026-03-12T10:00:00.000Z"),
    readiness: createReadiness({
      outcome: "guarded",
      outcomeLabel: "Guarded",
    }),
    runtime: liveRuntime,
  });

  assert.equal(scorecard.outcome, "guarded");
  assert.equal(scorecard.summary.blockedSections, 0);
  assert.equal(scorecard.summary.warningSections, 1);
  assert.equal(
    scorecard.sections.find((section) => section.id === "readiness")?.state,
    "warning"
  );
}

async function testReadyWithWarningsScorecard() {
  const scorecard = await getPilotReviewScorecard({
    accessProfile: buildAccessProfile({
      organizationSlug: "tenant-yamal",
      role: "EXEC",
      workspaceId: "executive",
    }),
    connectors: [],
    deliveryEntries: [
      createDeliveryEntry({
        id: "delivery-3",
        lastAttemptAt: "2026-03-11T08:00:00.000Z",
        status: "pending",
      }),
      createDeliveryEntry({
        deliveredAt: "2026-03-12T09:20:00.000Z",
        id: "delivery-4",
        lastAttemptAt: "2026-03-12T09:20:00.000Z",
        providerMessageId: "message-4",
        status: "delivered",
        updatedAt: "2026-03-12T09:20:00.000Z",
      }),
    ],
    feedback: createFeedback([]),
    getFreshnessCheckpoint: async (key) =>
      key === EVIDENCE_LEDGER_SYNC_KEY
        ? createCheckpoint(key, {
            lastSuccessAt: "2026-03-11T08:00:00.000Z",
          })
        : createCheckpoint(key, {}),
    inbox: createInbox([]),
    now: () => new Date("2026-03-12T10:00:00.000Z"),
    readiness: createReadiness({
      outcome: "ready",
      outcomeLabel: "Ready",
    }),
    runtime: liveRuntime,
  });

  assert.equal(scorecard.outcome, "ready_with_warnings");
  assert.equal(scorecard.summary.staleSignals, 1);
  assert.equal(
    scorecard.sections.find((section) => section.id === "delivery")?.state,
    "warning"
  );
  assert.equal(
    scorecard.sections.find((section) => section.id === "freshness")?.state,
    "warning"
  );
}

async function main() {
  await testBlockedScorecard();
  await testGuardedScorecard();
  await testReadyWithWarningsScorecard();

  console.log("PASS pilot-review.service.unit");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
