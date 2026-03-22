import assert from "node:assert/strict";

import { buildAccessProfile } from "@/lib/auth/access-profile";
import {
  createCutoverDecision,
  getCutoverDecisionLabel,
  listCutoverDecisionRegister,
} from "@/lib/cutover-decisions";
import type { PilotReviewScorecard } from "@/lib/pilot-review";
import type { TenantReadinessReport } from "@/lib/tenant-readiness";

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
    generatedAt: "2026-03-12T14:15:00.000Z",
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
      blockers: overrides.outcome === "blocked" ? 2 : 0,
      connectorsConfigured: 4,
      connectorsDegraded: 0,
      connectorsOk: 4,
      connectorsPending: 0,
      readySignals: 3,
      unresolvedExceptions: 0,
      unresolvedFeedback: 0,
      warnings: overrides.outcome === "ready_with_warnings" ? 1 : 0,
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

function createReview(
  overrides: Partial<PilotReviewScorecard> & Pick<PilotReviewScorecard, "outcome" | "outcomeLabel">
): PilotReviewScorecard {
  return {
    accessProfile: {
      organizationSlug: "tenant-yamal",
      role: "EXEC",
      workspaceId: "executive",
    },
    artifact: {
      content: "# Pilot review",
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
    generatedAt: "2026-03-12T14:16:00.000Z",
    outcome: overrides.outcome,
    outcomeLabel: overrides.outcomeLabel,
    readiness: createReadiness({
      outcome: overrides.outcome === "blocked" ? "blocked" : "ready_with_warnings",
      outcomeLabel: overrides.outcome === "blocked" ? "Blocked" : "Ready with warnings",
    }),
    runtime: {
      dataMode: "live",
      databaseConfigured: true,
      healthStatus: "ok",
    },
    sections: [],
    summary: {
      blockedSections: overrides.outcome === "blocked" ? 1 : 0,
      deliveryFailures: 0,
      openExceptions: 0,
      openFeedback: 0,
      readySections: 3,
      staleSignals: 0,
      warningSections: overrides.outcome === "ready_with_warnings" ? 1 : 0,
    },
    ...overrides,
  };
}

async function testListsRegisterSummary() {
  const register = await listCutoverDecisionRegister(10, {
    store: {
      create: async () => {
        throw new Error("not used");
      },
      findMany: async () => [
        {
          id: "rollback-1",
          workspaceId: "executive",
          tenantSlug: "tenant-yamal",
          decisionType: "rollback",
          summary: "Rollback recorded after evidence drift.",
          details: null,
          warningId: null,
          warningLabel: null,
          readinessOutcome: "blocked",
          readinessOutcomeLabel: "Blocked",
          readinessGeneratedAt: new Date("2026-03-12T14:10:00.000Z"),
          reviewOutcome: "blocked",
          reviewOutcomeLabel: "Blocked",
          reviewGeneratedAt: new Date("2026-03-12T14:11:00.000Z"),
          createdByUserId: "u-1",
          createdByName: "Operator",
          createdByRole: "EXEC",
          createdAt: new Date("2026-03-12T14:20:00.000Z"),
        },
        {
          id: "waiver-1",
          workspaceId: "executive",
          tenantSlug: "tenant-yamal",
          decisionType: "warning_waiver",
          summary: "Accepted remaining controlled-rollout warning.",
          details: null,
          warningId: "warning-1",
          warningLabel: "Tenant stays under controlled rollout",
          readinessOutcome: "ready_with_warnings",
          readinessOutcomeLabel: "Ready with warnings",
          readinessGeneratedAt: new Date("2026-03-12T13:10:00.000Z"),
          reviewOutcome: "ready_with_warnings",
          reviewOutcomeLabel: "Ready with warnings",
          reviewGeneratedAt: new Date("2026-03-12T13:11:00.000Z"),
          createdByUserId: "u-1",
          createdByName: "Operator",
          createdByRole: "EXEC",
          createdAt: new Date("2026-03-12T13:20:00.000Z"),
        },
      ],
    },
  });

  assert.equal(register.summary.total, 2);
  assert.equal(register.summary.rollbacks, 1);
  assert.equal(register.summary.waivers, 1);
  assert.equal(register.latestDecision?.id, "rollback-1");
}

async function testBlocksApprovalWhileReadinessIsBlocked() {
  await assert.rejects(
    () =>
      createCutoverDecision(
        {
          decisionType: "cutover_approved",
          summary: "Approve cutover despite blockers.",
        },
        {
          accessProfile: buildAccessProfile({
            organizationSlug: "tenant-yamal",
            role: "EXEC",
            workspaceId: "executive",
          }),
          readiness: createReadiness({
            outcome: "blocked",
            outcomeLabel: "Blocked",
          }),
          review: createReview({
            outcome: "ready_with_warnings",
            outcomeLabel: "Ready with warnings",
          }),
          store: {
            create: async () => {
              throw new Error("should not be called");
            },
            findMany: async () => [],
          },
        }
      ),
    /Cutover approval is blocked/
  );
}

async function testCreatesWarningWaiverWithSnapshots() {
  const createdRows: Array<Record<string, unknown>> = [];

  const decision = await createCutoverDecision(
    {
      decisionType: "warning_waiver",
      summary: "Accept the remaining controlled-rollout warning for this week.",
      warningId: "rollout-stage-controlled",
      warningLabel: "Tenant stays under controlled rollout",
    },
    {
      accessProfile: buildAccessProfile({
        name: "Alex",
        organizationSlug: "tenant-yamal",
        role: "EXEC",
        userId: "alex-1",
        workspaceId: "executive",
      }),
      readiness: createReadiness({
        outcome: "ready_with_warnings",
        outcomeLabel: "Ready with warnings",
      }),
      review: createReview({
        outcome: "guarded",
        outcomeLabel: "Guarded",
      }),
      store: {
        create: async ({ data }) => {
          createdRows.push(data as Record<string, unknown>);

          return {
            id: "decision-1",
            workspaceId: String(data.workspaceId),
            tenantSlug: String(data.tenantSlug),
            decisionType: String(data.decisionType),
            summary: String(data.summary),
            details: (data.details as string | null) ?? null,
            warningId: (data.warningId as string | null) ?? null,
            warningLabel: (data.warningLabel as string | null) ?? null,
            readinessOutcome: String(data.readinessOutcome),
            readinessOutcomeLabel: String(data.readinessOutcomeLabel),
            readinessGeneratedAt: data.readinessGeneratedAt as Date,
            reviewOutcome: String(data.reviewOutcome),
            reviewOutcomeLabel: String(data.reviewOutcomeLabel),
            reviewGeneratedAt: data.reviewGeneratedAt as Date,
            createdByUserId: (data.createdByUserId as string | null) ?? null,
            createdByName: (data.createdByName as string | null) ?? null,
            createdByRole: (data.createdByRole as string | null) ?? null,
            createdAt: new Date("2026-03-12T14:20:00.000Z"),
          };
        },
        findMany: async () => [],
      },
    }
  );

  assert.equal(createdRows.length, 1);
  assert.equal(createdRows[0]?.decisionType, "warning_waiver");
  assert.equal(createdRows[0]?.readinessOutcome, "ready_with_warnings");
  assert.equal(createdRows[0]?.reviewOutcome, "guarded");
  assert.equal(decision.decisionLabel, getCutoverDecisionLabel("warning_waiver"));
  assert.equal(decision.warningId, "rollout-stage-controlled");
  assert.equal(decision.createdByUserId, "alex-1");
}

async function main() {
  await testListsRegisterSummary();
  await testBlocksApprovalWhileReadinessIsBlocked();
  await testCreatesWarningWaiverWithSnapshots();
  console.log("PASS cutover-decision-register.unit");
}

void main();
