import assert from "node:assert/strict";

import { buildAccessProfile } from "@/lib/auth/access-profile";
import type { BriefDeliveryExecutionInput, BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import {
  deliverPilotReviewByEmail,
  executePilotReviewPolicyRun,
  shouldAttemptPilotReviewDeliveryPolicy,
} from "@/lib/pilot-review";
import type {
  PilotReviewDeliveryPolicyRecord,
  PilotReviewScorecard,
} from "@/lib/pilot-review";

function createScorecard(overrides: Partial<PilotReviewScorecard> = {}): PilotReviewScorecard {
  return {
    accessProfile: {
      organizationSlug: "tenant-yamal",
      role: "EXEC",
      workspaceId: "executive",
    },
    artifact: {
      content: "# Pilot review\n\nAll sections stable.",
      fileName: "pilot-review.md",
      format: "markdown",
      mediaType: "text/markdown",
    },
    delivery: {
      entries: [],
      failed: 0,
      lastDeliveredAt: null,
      lastFailureAt: null,
      pending: 0,
      preview: 0,
      stalePending: 0,
      successful: 0,
      total: 0,
    },
    freshness: [],
    generatedAt: "2026-03-12T12:00:00.000Z",
    outcome: "guarded",
    outcomeLabel: "Guarded",
    readiness: {
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
      generatedAt: "2026-03-12T12:00:00.000Z",
      outcome: "guarded",
      outcomeLabel: "Guarded",
      pilotFeedback: {
        critical: 0,
        high: 0,
        inReview: 1,
        open: 1,
        resolved: 0,
        total: 1,
      },
      posture: {
        blockedWorkflows: [],
        configured: true,
        liveMutationAllowed: true,
        runtimeStatus: "live",
        stage: "controlled",
        stageLabel: "Controlled rollout",
        tenantSlug: "tenant-yamal",
        writeWorkspaces: ["delivery", "executive"],
      },
      readySignals: [],
      runtime: {
        dataMode: "live",
        databaseConfigured: true,
        healthStatus: "ok",
      },
      summary: {
        blockers: 0,
        connectorsConfigured: 4,
        connectorsDegraded: 0,
        connectorsOk: 4,
        connectorsPending: 0,
        readySignals: 3,
        unresolvedExceptions: 1,
        unresolvedFeedback: 1,
        warnings: 1,
      },
      tenant: {
        label: "Configured pilot tenant",
        slug: "tenant-yamal",
        source: "pilot_control",
      },
      unresolvedConcerns: {
        acknowledged: 0,
        critical: 0,
        high: 1,
        open: 2,
        resolved: 0,
        total: 2,
      },
      warnings: [],
    },
    runtime: {
      dataMode: "live",
      databaseConfigured: true,
      healthStatus: "ok",
    },
    sections: [],
    summary: {
      blockedSections: 0,
      deliveryFailures: 0,
      openExceptions: 1,
      openFeedback: 1,
      readySections: 2,
      staleSignals: 0,
      warningSections: 1,
    },
    ...overrides,
  };
}

function createLedgerRecord(
  overrides: Partial<BriefDeliveryLedgerRecord> & Pick<BriefDeliveryLedgerRecord, "id" | "status">
): BriefDeliveryLedgerRecord {
  return {
    attemptCount: 0,
    channel: "email",
    contentHash: "hash-1",
    createdAt: "2026-03-12T12:00:00.000Z",
    deliveredAt: null,
    dryRun: true,
    firstAttemptAt: null,
    headline: "Pilot review · tenant-yamal",
    id: overrides.id,
    idempotencyKey: `key-${overrides.id}`,
    lastAttemptAt: null,
    lastError: null,
    locale: "en",
    mode: "scheduled",
    projectId: null,
    projectName: "tenant-yamal",
    provider: "smtp",
    providerMessageId: null,
    retryPosture: "preview_only",
    scheduledPolicyId: "policy-1",
    scope: "governance",
    status: overrides.status,
    target: "board@example.com",
    updatedAt: "2026-03-12T12:00:00.000Z",
    ...overrides,
  };
}

function createPolicy(
  overrides: Partial<PilotReviewDeliveryPolicyRecord> & Pick<PilotReviewDeliveryPolicyRecord, "id">
): PilotReviewDeliveryPolicyRecord {
  return {
    active: true,
    channel: "email",
    createdAt: "2026-03-12T12:00:00.000Z",
    createdByUserId: "demo-user",
    deliveryHour: 9,
    deliveryWeekday: 4,
    id: overrides.id,
    lastAttemptAt: null,
    lastDeliveredAt: null,
    lastError: null,
    recipient: "board@example.com",
    timezone: "UTC",
    updatedAt: "2026-03-12T12:00:00.000Z",
    updatedByUserId: "demo-user",
    workspaceId: "executive",
    ...overrides,
  };
}

async function testEmailPreviewUsesGovernanceLedger() {
  const deliveries: BriefDeliveryExecutionInput[] = [];

  const result = await deliverPilotReviewByEmail(
    {
      dryRun: true,
      env: {
        EMAIL_DEFAULT_TO: "governance@example.com",
      },
      scheduledPolicyId: "policy-1",
    },
    {
      executeDelivery: async (input) => {
        deliveries.push(input);

        return {
          ledger: createLedgerRecord({
            id: "ledger-preview",
            scheduledPolicyId: input.scheduledPolicyId ?? null,
            target: input.target ?? null,
          }),
          providerMessageId: null,
          replayed: false,
        };
      },
      getScorecard: async () => createScorecard(),
    }
  );

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0]?.scope, "governance");
  assert.equal(deliveries[0]?.mode, "scheduled");
  assert.equal(deliveries[0]?.target, "governance@example.com");
  assert.equal(result.delivered, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.recipient, "governance@example.com");
  assert.match(result.subject, /\[Pilot Review\] tenant-yamal · Guarded/);
  assert.match(result.previewText, /2 active concerns/);
  assert.equal(result.ledger?.scope, "governance");
}

async function testLiveEmailRequiresRecipient() {
  await assert.rejects(
    () =>
      deliverPilotReviewByEmail(
        {
          dryRun: false,
          env: {},
        },
        {
          getScorecard: async () => createScorecard(),
        }
      ),
    /Email recipient is required/
  );
}

function testPolicyDueWindowAndRetryRules() {
  const due = shouldAttemptPilotReviewDeliveryPolicy(
    createPolicy({
      id: "due-policy",
    }),
    new Date("2026-03-12T09:15:00.000Z")
  );
  const skippedDeliveredSameWindow = shouldAttemptPilotReviewDeliveryPolicy(
    createPolicy({
      id: "delivered-policy",
      lastAttemptAt: "2026-03-12T09:00:00.000Z",
      lastDeliveredAt: "2026-03-12T09:05:00.000Z",
    }),
    new Date("2026-03-12T09:30:00.000Z")
  );
  const retriedFailedSameWindow = shouldAttemptPilotReviewDeliveryPolicy(
    createPolicy({
      id: "failed-policy",
      lastAttemptAt: "2026-03-12T09:00:00.000Z",
      lastDeliveredAt: null,
      lastError: "SMTP delivery failed.",
    }),
    new Date("2026-03-12T09:30:00.000Z")
  );

  assert.equal(due, true);
  assert.equal(skippedDeliveredSameWindow, false);
  assert.equal(retriedFailedSameWindow, true);
}

async function testExecutionSummaryHandlesPreviewAndFailure() {
  const updatedRows: Array<{
    id: string;
    data: Record<string, unknown>;
  }> = [];

  const summary = await executePilotReviewPolicyRun(
    [
      createPolicy({ id: "preview-policy" }),
      createPolicy({ id: "inactive-policy", active: false }),
      createPolicy({ id: "failed-policy" }),
      createPolicy({ id: "not-due-policy", deliveryHour: 7 }),
    ],
    {
      accessProfile: buildAccessProfile({
        organizationSlug: "tenant-yamal",
        role: "EXEC",
        workspaceId: "executive",
      }),
      deliver: async (input) => {
        if (input.policy.id === "failed-policy") {
          throw new Error("SMTP delivery failed.");
        }

        return {
          delivered: false,
          dryRun: true,
          ledger: {
            deliveredAt: null,
            lastError: null,
            messageId: null,
          },
        };
      },
      dryRun: true,
      now: new Date("2026-03-12T09:00:00.000Z"),
      store: {
        create: async () => {
          throw new Error("not used");
        },
        findMany: async () => [],
        findUnique: async () => null,
        update: async ({ id, data }) => {
          updatedRows.push({ id, data: data as Record<string, unknown> });
          return {
            id,
            workspaceId: "executive",
            channel: "email",
            recipient: "board@example.com",
            timezone: "UTC",
            deliveryHour: 9,
            deliveryWeekday: 4,
            active: true,
            createdByUserId: "demo-user",
            updatedByUserId: typeof data.updatedByUserId === "string" ? data.updatedByUserId : null,
            lastAttemptAt:
              data.lastAttemptAt instanceof Date ? data.lastAttemptAt : new Date("2026-03-12T09:00:00.000Z"),
            lastDeliveredAt:
              data.lastDeliveredAt instanceof Date ? data.lastDeliveredAt : null,
            lastError: typeof data.lastError === "string" ? data.lastError : null,
            createdAt: new Date("2026-03-12T08:00:00.000Z"),
            updatedAt: new Date("2026-03-12T09:00:00.000Z"),
          };
        },
      },
    }
  );

  assert.equal(summary.checkedPolicies, 4);
  assert.equal(summary.duePolicies, 2);
  assert.equal(summary.previewPolicies, 1);
  assert.equal(summary.deliveredPolicies, 0);
  assert.equal(summary.failedPolicies, 1);
  assert.equal(summary.skippedPolicies, 2);
  assert.equal(updatedRows.length, 2);
  assert.equal(updatedRows[0]?.id, "preview-policy");
  assert.equal(updatedRows[0]?.data.updatedByUserId, "system:pilot-review-preview");
  assert.equal(updatedRows[1]?.id, "failed-policy");
  assert.equal(updatedRows[1]?.data.updatedByUserId, "system:pilot-review-schedule");
  assert.match(String(updatedRows[1]?.data.lastError ?? ""), /SMTP delivery failed/);
}

async function main() {
  await testEmailPreviewUsesGovernanceLedger();
  await testLiveEmailRequiresRecipient();
  testPolicyDueWindowAndRetryRules();
  await testExecutionSummaryHandlesPreviewAndFailure();
  console.log("PASS pilot-review-delivery.unit");
}

void main();
