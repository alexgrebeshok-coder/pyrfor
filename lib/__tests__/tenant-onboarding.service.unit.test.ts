import assert from "node:assert/strict";

import { buildAccessProfile } from "@/lib/auth/access-profile";
import type { CutoverDecisionRegister } from "@/lib/cutover-decisions";
import type { PilotReviewScorecard } from "@/lib/pilot-review";
import {
  createTenantOnboardingRunbook,
  getTenantOnboardingOverview,
  getTenantOnboardingStatusLabel,
  TENANT_ONBOARDING_TEMPLATE_VERSION,
  updateTenantOnboardingRunbook,
} from "@/lib/tenant-onboarding";
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
    generatedAt: "2026-03-12T15:00:00.000Z",
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
      warnings: overrides.outcome === "ready_with_warnings" ? 2 : 1,
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
      fileName: "ceoclaw-pilot-review.md",
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
    generatedAt: "2026-03-12T15:05:00.000Z",
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
      readySections: 4,
      staleSignals: 0,
      warningSections: overrides.outcome === "ready_with_warnings" ? 1 : 0,
    },
    ...overrides,
  };
}

function createDecisionRegister(): CutoverDecisionRegister {
  return {
    entries: [
      {
        createdAt: "2026-03-12T15:10:00.000Z",
        createdByName: "Alex",
        createdByRole: "EXEC",
        createdByUserId: "alex-1",
        decisionLabel: "Warning waiver",
        decisionType: "warning_waiver",
        details: null,
        id: "decision-1",
        readinessGeneratedAt: "2026-03-12T15:00:00.000Z",
        readinessOutcome: "ready_with_warnings",
        readinessOutcomeLabel: "Ready with warnings",
        reviewGeneratedAt: "2026-03-12T15:05:00.000Z",
        reviewOutcome: "guarded",
        reviewOutcomeLabel: "Guarded",
        summary: "Accepted the remaining controlled-rollout warning.",
        tenantSlug: "tenant-yamal",
        warningId: "warning-1",
        warningLabel: "Controlled rollout remains active",
        workspaceId: "executive",
      },
    ],
    latestDecision: {
      createdAt: "2026-03-12T15:10:00.000Z",
      createdByName: "Alex",
      createdByRole: "EXEC",
      createdByUserId: "alex-1",
      decisionLabel: "Warning waiver",
      decisionType: "warning_waiver",
      details: null,
      id: "decision-1",
      readinessGeneratedAt: "2026-03-12T15:00:00.000Z",
      readinessOutcome: "ready_with_warnings",
      readinessOutcomeLabel: "Ready with warnings",
      reviewGeneratedAt: "2026-03-12T15:05:00.000Z",
      reviewOutcome: "guarded",
      reviewOutcomeLabel: "Guarded",
      summary: "Accepted the remaining controlled-rollout warning.",
      tenantSlug: "tenant-yamal",
      warningId: "warning-1",
      warningLabel: "Controlled rollout remains active",
      workspaceId: "executive",
    },
    summary: {
      approvals: 0,
      latestDecisionAt: "2026-03-12T15:10:00.000Z",
      latestRollbackAt: null,
      latestWaiverAt: "2026-03-12T15:10:00.000Z",
      rollbacks: 0,
      total: 1,
      waivers: 1,
    },
  };
}

async function testBuildsOverviewFromCurrentBaseline() {
  const overview = await getTenantOnboardingOverview({
    accessProfile: buildAccessProfile({
      organizationSlug: "tenant-yamal",
      role: "EXEC",
      workspaceId: "executive",
    }),
    decisionRegister: createDecisionRegister(),
    includePersistedState: true,
    now: () => new Date("2026-03-12T15:20:00.000Z"),
    readiness: createReadiness({
      outcome: "ready_with_warnings",
      outcomeLabel: "Ready with warnings",
    }),
    review: createReview({
      outcome: "guarded",
      outcomeLabel: "Guarded",
    }),
    store: {
      create: async () => {
        throw new Error("not used");
      },
      findMany: async () => [
        {
          id: "runbook-1",
          workspaceId: "executive",
          baselineTenantSlug: "tenant-yamal",
          baselineTenantLabel: "Configured pilot tenant",
          targetTenantSlug: "tenant-north",
          targetTenantLabel: "Northern rollout",
          status: "prepared",
          summary: "Prepare the northern tenant rollout.",
          rolloutScope: "Repeat the controlled rollout with the same guardrails.",
          operatorNotes: "Use the existing delivery workspace first.",
          handoffNotes: "Review the governance export before widening.",
          rollbackPlan: "Rollback to the current tenant boundary.",
          targetCutoverAt: new Date("2026-03-14T08:00:00.000Z"),
          templateVersion: TENANT_ONBOARDING_TEMPLATE_VERSION,
          readinessOutcome: "ready_with_warnings",
          readinessOutcomeLabel: "Ready with warnings",
          readinessGeneratedAt: new Date("2026-03-12T15:00:00.000Z"),
          reviewOutcome: "guarded",
          reviewOutcomeLabel: "Guarded",
          reviewGeneratedAt: new Date("2026-03-12T15:05:00.000Z"),
          latestDecisionType: "warning_waiver",
          latestDecisionLabel: "Warning waiver",
          latestDecisionSummary: "Accepted the remaining controlled-rollout warning.",
          latestDecisionAt: new Date("2026-03-12T15:10:00.000Z"),
          blockerCount: 0,
          warningCount: 2,
          createdByUserId: "alex-1",
          createdByName: "Alex",
          createdByRole: "EXEC",
          updatedByUserId: "alex-1",
          createdAt: new Date("2026-03-12T15:11:00.000Z"),
          updatedAt: new Date("2026-03-12T15:12:00.000Z"),
        },
      ],
      findUnique: async () => null,
      update: async () => {
        throw new Error("not used");
      },
    },
  });

  assert.equal(overview.currentReadiness.tenant.slug, "tenant-yamal");
  assert.equal(overview.currentReview.outcomeLabel, "Guarded");
  assert.equal(overview.latestDecision?.decisionLabel, "Warning waiver");
  assert.equal(overview.latestRunbook?.targetTenantSlug, "tenant-north");
  assert.equal(overview.summary.prepared, 1);
  assert.equal(overview.template.items.length, 4);
  assert.equal(overview.template.items[3]?.state, "ready");
}

async function testCreatesRunbookWithCurrentSnapshots() {
  const createdRows: Array<Record<string, unknown>> = [];

  const created = await createTenantOnboardingRunbook(
    {
      handoffNotes: "Hand over to the executive reviewer after the weekly export.",
      operatorNotes: "Limit live writes to delivery first.",
      rolloutScope: "Prepare the next logistics tenant using the current cutover baseline.",
      status: "draft",
      summary: "Prepare logistics tenant rollout.",
      targetCutoverAt: "2026-03-15T09:00:00.000Z",
      targetTenantLabel: "Logistics tenant",
      targetTenantSlug: "tenant-logistics",
    },
    {
      accessProfile: buildAccessProfile({
        name: "Alex",
        organizationSlug: "tenant-yamal",
        role: "EXEC",
        userId: "alex-1",
        workspaceId: "executive",
      }),
      decisionRegister: createDecisionRegister(),
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
          createdRows.push(data as unknown as Record<string, unknown>);
          return {
            id: "runbook-2",
            workspaceId: String(data.workspaceId),
            baselineTenantSlug: String(data.baselineTenantSlug),
            baselineTenantLabel: String(data.baselineTenantLabel),
            targetTenantSlug: data.targetTenantSlug as string | null,
            targetTenantLabel: data.targetTenantLabel as string | null,
            status: String(data.status),
            summary: String(data.summary),
            rolloutScope: String(data.rolloutScope),
            operatorNotes: data.operatorNotes as string | null,
            handoffNotes: data.handoffNotes as string | null,
            rollbackPlan: data.rollbackPlan as string | null,
            targetCutoverAt: data.targetCutoverAt as Date | null,
            templateVersion: String(data.templateVersion),
            readinessOutcome: String(data.readinessOutcome),
            readinessOutcomeLabel: String(data.readinessOutcomeLabel),
            readinessGeneratedAt: data.readinessGeneratedAt as Date,
            reviewOutcome: String(data.reviewOutcome),
            reviewOutcomeLabel: String(data.reviewOutcomeLabel),
            reviewGeneratedAt: data.reviewGeneratedAt as Date,
            latestDecisionType: data.latestDecisionType as string | null,
            latestDecisionLabel: data.latestDecisionLabel as string | null,
            latestDecisionSummary: data.latestDecisionSummary as string | null,
            latestDecisionAt: data.latestDecisionAt as Date | null,
            blockerCount: Number(data.blockerCount),
            warningCount: Number(data.warningCount),
            createdByUserId: data.createdByUserId as string | null,
            createdByName: data.createdByName as string | null,
            createdByRole: data.createdByRole as string | null,
            updatedByUserId: data.updatedByUserId as string | null,
            createdAt: new Date("2026-03-12T15:13:00.000Z"),
            updatedAt: new Date("2026-03-12T15:13:00.000Z"),
          };
        },
        findMany: async () => [],
        findUnique: async () => null,
        update: async () => {
          throw new Error("not used");
        },
      },
    }
  );

  assert.equal(createdRows.length, 1);
  assert.equal(createdRows[0]?.baselineTenantSlug, "tenant-yamal");
  assert.equal(createdRows[0]?.latestDecisionLabel, "Warning waiver");
  assert.equal(createdRows[0]?.templateVersion, TENANT_ONBOARDING_TEMPLATE_VERSION);
  assert.equal(created.targetTenantSlug, "tenant-logistics");
  assert.equal(created.statusLabel, "Draft");
}

async function testUpdatesRunbookAndRefreshesSnapshots() {
  const updated = await updateTenantOnboardingRunbook(
    "runbook-3",
    {
      status: "scheduled",
      summary: "Schedule the northern tenant rollout.",
      targetCutoverAt: "2026-03-18T10:30:00.000Z",
    },
    {
      accessProfile: buildAccessProfile({
        name: "Alex",
        organizationSlug: "tenant-yamal",
        role: "EXEC",
        userId: "alex-1",
        workspaceId: "executive",
      }),
      decisionRegister: {
        ...createDecisionRegister(),
        latestDecision: {
          ...createDecisionRegister().latestDecision!,
          decisionLabel: "Cutover approved",
          decisionType: "cutover_approved",
        },
      },
      readiness: createReadiness({
        outcome: "ready",
        outcomeLabel: "Ready",
      }),
      review: createReview({
        outcome: "ready",
        outcomeLabel: "Ready",
      }),
      store: {
        create: async () => {
          throw new Error("not used");
        },
        findMany: async () => [],
        findUnique: async () => ({
          id: "runbook-3",
          workspaceId: "executive",
          baselineTenantSlug: "tenant-yamal",
          baselineTenantLabel: "Configured pilot tenant",
          targetTenantSlug: "tenant-north",
          targetTenantLabel: "Northern rollout",
          status: "prepared",
          summary: "Prepare the northern tenant rollout.",
          rolloutScope: "Repeat the controlled rollout with the same guardrails.",
          operatorNotes: null,
          handoffNotes: null,
          rollbackPlan: null,
          targetCutoverAt: null,
          templateVersion: TENANT_ONBOARDING_TEMPLATE_VERSION,
          readinessOutcome: "ready_with_warnings",
          readinessOutcomeLabel: "Ready with warnings",
          readinessGeneratedAt: new Date("2026-03-12T15:00:00.000Z"),
          reviewOutcome: "guarded",
          reviewOutcomeLabel: "Guarded",
          reviewGeneratedAt: new Date("2026-03-12T15:05:00.000Z"),
          latestDecisionType: "warning_waiver",
          latestDecisionLabel: "Warning waiver",
          latestDecisionSummary: "Accepted the remaining controlled-rollout warning.",
          latestDecisionAt: new Date("2026-03-12T15:10:00.000Z"),
          blockerCount: 0,
          warningCount: 2,
          createdByUserId: "alex-1",
          createdByName: "Alex",
          createdByRole: "EXEC",
          updatedByUserId: "alex-1",
          createdAt: new Date("2026-03-12T15:11:00.000Z"),
          updatedAt: new Date("2026-03-12T15:12:00.000Z"),
        }),
        update: async ({ data, id }) => ({
          id,
          workspaceId: "executive",
          baselineTenantSlug: String(data.baselineTenantSlug),
          baselineTenantLabel: String(data.baselineTenantLabel),
          targetTenantSlug: data.targetTenantSlug as string | null,
          targetTenantLabel: data.targetTenantLabel as string | null,
          status: String(data.status),
          summary: String(data.summary),
          rolloutScope: String(data.rolloutScope),
          operatorNotes: data.operatorNotes as string | null,
          handoffNotes: data.handoffNotes as string | null,
          rollbackPlan: data.rollbackPlan as string | null,
          targetCutoverAt: data.targetCutoverAt as Date | null,
          templateVersion: String(data.templateVersion),
          readinessOutcome: String(data.readinessOutcome),
          readinessOutcomeLabel: String(data.readinessOutcomeLabel),
          readinessGeneratedAt: data.readinessGeneratedAt as Date,
          reviewOutcome: String(data.reviewOutcome),
          reviewOutcomeLabel: String(data.reviewOutcomeLabel),
          reviewGeneratedAt: data.reviewGeneratedAt as Date,
          latestDecisionType: data.latestDecisionType as string | null,
          latestDecisionLabel: data.latestDecisionLabel as string | null,
          latestDecisionSummary: data.latestDecisionSummary as string | null,
          latestDecisionAt: data.latestDecisionAt as Date | null,
          blockerCount: Number(data.blockerCount),
          warningCount: Number(data.warningCount),
          createdByUserId: "alex-1",
          createdByName: "Alex",
          createdByRole: "EXEC",
          updatedByUserId: data.updatedByUserId as string | null,
          createdAt: new Date("2026-03-12T15:11:00.000Z"),
          updatedAt: new Date("2026-03-12T15:21:00.000Z"),
        }),
      },
    }
  );

  assert.equal(updated?.status, "scheduled");
  assert.equal(updated?.statusLabel, "Scheduled");
  assert.equal(updated?.latestDecisionLabel, "Cutover approved");
  assert.equal(updated?.readinessOutcomeLabel, "Ready");
}

async function main() {
  assert.equal(getTenantOnboardingStatusLabel("completed"), "Completed");

  await testBuildsOverviewFromCurrentBaseline();
  await testCreatesRunbookWithCurrentSnapshots();
  await testUpdatesRunbookAndRefreshesSnapshots();

  console.log("tenant onboarding service tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
