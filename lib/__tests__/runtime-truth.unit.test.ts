import assert from "node:assert/strict";

import type { ConnectorStatus, ConnectorStatusSummary } from "@/lib/connectors";
import type { EscalationListResult } from "@/lib/escalations";
import type { PilotReviewScorecard } from "@/lib/pilot-review";
import type { ServerRuntimeState } from "@/lib/server/runtime-mode";
import {
  buildBriefsRuntimeTruth,
  buildIntegrationsRuntimeTruth,
  buildTenantOnboardingRuntimeTruth,
  buildTenantRolloutPacketRuntimeTruth,
  buildPilotReviewRuntimeTruth,
  buildTenantReadinessRuntimeTruth,
  buildWorkReportsRuntimeTruth,
  getOperatorTruthBadge,
} from "@/lib/server/runtime-truth";
import type { TenantOnboardingOverview } from "@/lib/tenant-onboarding";
import type { TenantRolloutPacket } from "@/lib/tenant-rollout-packet";
import type { TenantReadinessReport } from "@/lib/tenant-readiness";

const connectorSummary: ConnectorStatusSummary = {
  status: "ok",
  total: 4,
  configured: 3,
  ok: 3,
  pending: 1,
  degraded: 0,
};

const telegramConnector: ConnectorStatus = {
  id: "telegram",
  name: "Telegram",
  description: "Telegram connector",
  direction: "outbound",
  sourceSystem: "Telegram Bot API",
  operations: ["delivery"],
  credentials: [],
  apiSurface: [],
  stub: false,
  status: "ok",
  configured: true,
  checkedAt: "2026-03-11T00:00:00.000Z",
  message: "ok",
  missingSecrets: [],
};

const emailConnector: ConnectorStatus = {
  id: "email",
  name: "Email",
  description: "Email connector",
  direction: "outbound",
  sourceSystem: "SMTP",
  operations: ["delivery"],
  credentials: [],
  apiSurface: [],
  stub: false,
  status: "ok",
  configured: true,
  checkedAt: "2026-03-11T00:00:00.000Z",
  message: "ok",
  missingSecrets: [],
};

const demoRuntime: ServerRuntimeState = {
  dataMode: "demo",
  databaseConfigured: true,
  healthStatus: "ok",
};

const liveRuntime: ServerRuntimeState = {
  dataMode: "live",
  databaseConfigured: true,
  healthStatus: "ok",
};

const degradedRuntime: ServerRuntimeState = {
  dataMode: "live",
  databaseConfigured: false,
  healthStatus: "degraded",
};

const queue: EscalationListResult = {
  syncedAt: "2026-03-11T00:00:00.000Z",
  summary: {
    total: 2,
    open: 2,
    acknowledged: 0,
    resolved: 0,
    critical: 1,
    high: 1,
    dueSoon: 0,
    breached: 0,
    unassigned: 2,
  },
  items: [],
  sync: null,
};

const readiness: TenantReadinessReport = {
  accessProfile: {
    organizationSlug: "ceoclaw-demo",
    role: "EXEC",
    workspaceId: "executive",
  },
  blockers: [],
  checklist: [],
  connectorSummary,
  connectors: [telegramConnector, emailConnector],
  generatedAt: "2026-03-12T08:00:00.000Z",
  outcome: "guarded",
  outcomeLabel: "Guarded",
  pilotFeedback: {
    total: 1,
    open: 1,
    inReview: 0,
    resolved: 0,
    critical: 0,
    high: 0,
  },
  posture: {
    blockedWorkflows: [],
    configured: true,
    liveMutationAllowed: true,
    runtimeStatus: "live",
    stage: "controlled",
    stageLabel: "Controlled rollout",
    tenantSlug: "ceoclaw-demo",
    writeWorkspaces: ["delivery", "executive"],
  },
  readySignals: [],
  runtime: liveRuntime,
  summary: {
    blockers: 0,
    connectorsConfigured: 2,
    connectorsDegraded: 0,
    connectorsOk: 2,
    connectorsPending: 0,
    readySignals: 3,
    unresolvedExceptions: 1,
    unresolvedFeedback: 1,
    warnings: 2,
  },
  tenant: {
    label: "Configured pilot tenant",
    slug: "ceoclaw-demo",
    source: "pilot_control",
  },
  unresolvedConcerns: {
    total: 1,
    open: 1,
    acknowledged: 0,
    resolved: 0,
    critical: 0,
    high: 0,
  },
  warnings: [],
};

const pilotReview: PilotReviewScorecard = {
  accessProfile: readiness.accessProfile,
  artifact: {
    content: "# Scorecard\n",
    fileName: "ceoclaw-pilot-review-2026-03-12T08-00-00.000Z.md",
    format: "markdown",
    mediaType: "text/markdown",
  },
  delivery: {
    entries: [],
    failed: 0,
    lastDeliveredAt: "2026-03-12T08:00:00.000Z",
    lastFailureAt: null,
    pending: 0,
    preview: 0,
    stalePending: 0,
    successful: 2,
    total: 2,
  },
  freshness: [],
  generatedAt: "2026-03-12T08:00:00.000Z",
  outcome: "ready_with_warnings",
  outcomeLabel: "Ready with warnings",
  readiness,
  runtime: liveRuntime,
  sections: [],
  summary: {
    blockedSections: 0,
    deliveryFailures: 0,
    openExceptions: 1,
    openFeedback: 1,
    readySections: 4,
    staleSignals: 1,
    warningSections: 1,
  },
};

const integrationsTruth = buildIntegrationsRuntimeTruth({
  connectorSummary,
  evidenceCount: 3,
  gpsSample: {
    id: "gps",
    checkedAt: "2026-03-11T00:00:00.000Z",
    configured: true,
    message: "ok",
    missingSecrets: [],
    sampleUrl: "/api/v1/sessions",
    samples: [],
    status: "ok",
  },
  oneCSample: {
    id: "one-c",
    checkedAt: "2026-03-11T00:00:00.000Z",
    configured: true,
    message: "ok",
    missingSecrets: [],
    sampleUrl: "/api/v1/project-financials",
    samples: [],
    status: "pending",
  },
  runtime: demoRuntime,
});
assert.equal(integrationsTruth.status, "live");
assert.equal(getOperatorTruthBadge(integrationsTruth).label, "Live facts");

const workReportsTruth = buildWorkReportsRuntimeTruth({
  queue,
  reportCount: 0,
  runtime: demoRuntime,
});
assert.equal(workReportsTruth.status, "live");
assert.match(workReportsTruth.description, /live delivery data/i);

const briefsTruth = buildBriefsRuntimeTruth({
  portfolioAlertCount: 4,
  projectBriefCount: 2,
  runtime: demoRuntime,
  telegramConnector,
  emailConnector,
});
assert.equal(briefsTruth.status, "live");
assert.equal(briefsTruth.facts.find((fact) => fact.label === "Email delivery")?.value, "Live connector");

const degradedTruth = buildWorkReportsRuntimeTruth({
  queue: null,
  reportCount: 0,
  runtime: degradedRuntime,
});
assert.equal(degradedTruth.status, "degraded");
assert.equal(getOperatorTruthBadge(degradedTruth).variant, "danger");

const liveBriefsTruth = buildBriefsRuntimeTruth({
  portfolioAlertCount: 2,
  projectBriefCount: 1,
  runtime: liveRuntime,
  telegramConnector,
  emailConnector,
});
assert.equal(liveBriefsTruth.status, "live");

const readinessTruth = buildTenantReadinessRuntimeTruth({
  readiness,
  runtime: liveRuntime,
});
assert.equal(readinessTruth.status, "live");
assert.equal(
  readinessTruth.facts.find((fact) => fact.label === "Readiness outcome")?.value,
  "Guarded"
);
assert.equal(
  readinessTruth.facts.find((fact) => fact.label === "Open concerns")?.value,
  "2"
);

const reviewTruth = buildPilotReviewRuntimeTruth({
  runtime: liveRuntime,
  scorecard: pilotReview,
});
assert.equal(reviewTruth.status, "live");
assert.equal(
  reviewTruth.facts.find((fact) => fact.label === "Review outcome")?.value,
  "Ready with warnings"
);

const demoReadinessTruth = buildTenantReadinessRuntimeTruth({
  readiness,
  runtime: demoRuntime,
});
assert.equal(
  demoReadinessTruth.facts.find((fact) => fact.label === "Open concerns")?.value,
  "2"
);

const demoReviewTruth = buildPilotReviewRuntimeTruth({
  runtime: demoRuntime,
  scorecard: pilotReview,
});
assert.equal(
  demoReviewTruth.facts.find((fact) => fact.label === "Active concerns")?.value,
  "2"
);

const tenantOnboardingOverview: TenantOnboardingOverview = {
  accessProfile: readiness.accessProfile,
  currentReadiness: {
    generatedAt: readiness.generatedAt,
    outcome: readiness.outcome,
    outcomeLabel: readiness.outcomeLabel,
    posture: {
      liveMutationAllowed: readiness.posture.liveMutationAllowed,
      stage: readiness.posture.stage,
      stageLabel: readiness.posture.stageLabel,
      tenantSlug: readiness.posture.tenantSlug,
      writeWorkspaces: readiness.posture.writeWorkspaces,
    },
    summary: {
      blockers: readiness.summary.blockers,
      warnings: readiness.summary.warnings,
    },
    tenant: readiness.tenant,
  },
  currentReview: {
    artifact: {
      fileName: pilotReview.artifact.fileName,
      format: pilotReview.artifact.format,
    },
    generatedAt: pilotReview.generatedAt,
    outcome: "ready",
    outcomeLabel: "Ready",
    summary: {
      blockedSections: 0,
      openExceptions: 0,
      openFeedback: 0,
      warningSections: 0,
    },
  },
  generatedAt: "2026-03-12T08:10:00.000Z",
  latestDecision: {
    createdAt: "2026-03-12T08:07:00.000Z",
    createdByName: "Alex",
    createdByRole: "EXEC",
    createdByUserId: "alex-1",
    decisionLabel: "Cutover approved",
    decisionType: "cutover_approved",
    details: null,
    id: "decision-1",
    readinessGeneratedAt: readiness.generatedAt,
    readinessOutcome: readiness.outcome,
    readinessOutcomeLabel: readiness.outcomeLabel,
    reviewGeneratedAt: pilotReview.generatedAt,
    reviewOutcome: "ready",
    reviewOutcomeLabel: "Ready",
    summary: "Approved the next rollout window.",
    tenantSlug: readiness.tenant.slug,
    warningId: null,
    warningLabel: null,
    workspaceId: "executive",
  },
  latestRunbook: {
    baselineTenantLabel: readiness.tenant.label,
    baselineTenantSlug: readiness.tenant.slug,
    blockerCount: 0,
    createdAt: "2026-03-12T08:06:00.000Z",
    createdByName: "Alex",
    createdByRole: "EXEC",
    createdByUserId: "alex-1",
    handoffNotes: "Share with executive reviewer.",
    id: "runbook-1",
    latestDecisionAt: "2026-03-12T08:07:00.000Z",
    latestDecisionLabel: "Cutover approved",
    latestDecisionSummary: "Approved the next rollout window.",
    latestDecisionType: "cutover_approved",
    operatorNotes: "Start in delivery workspace.",
    readinessGeneratedAt: readiness.generatedAt,
    readinessOutcome: readiness.outcome,
    readinessOutcomeLabel: readiness.outcomeLabel,
    reviewGeneratedAt: pilotReview.generatedAt,
    reviewOutcome: "ready",
    reviewOutcomeLabel: "Ready",
    rollbackPlan: "Return to current tenant only.",
    rolloutScope: "Prepare the northern tenant rollout.",
    status: "prepared",
    statusLabel: "Prepared",
    summary: "Prepare the northern tenant rollout.",
    targetCutoverAt: "2026-03-15T09:00:00.000Z",
    targetTenantLabel: "Northern tenant",
    targetTenantSlug: "tenant-north",
    templateVersion: "tenant-rollout-v1",
    updatedAt: "2026-03-12T08:09:00.000Z",
    updatedByUserId: "alex-1",
    warningCount: 0,
    workspaceId: "executive",
  },
  persistenceAvailable: true,
  runbooks: [],
  summary: {
    completed: 0,
    draft: 0,
    prepared: 1,
    scheduled: 0,
    total: 1,
  },
  template: {
    intro: "Onboarding template",
    items: [],
    version: "tenant-rollout-v1",
  },
};

const tenantOnboardingTruth = buildTenantOnboardingRuntimeTruth({
  overview: tenantOnboardingOverview,
  runtime: liveRuntime,
});
assert.equal(tenantOnboardingTruth.status, "live");
assert.equal(
  tenantOnboardingTruth.facts.find((fact) => fact.label === "Latest runbook")?.value,
  "Prepared"
);

const tenantOnboardingDemoTruth = buildTenantOnboardingRuntimeTruth({
  overview: {
    ...tenantOnboardingOverview,
    latestRunbook: null,
    persistenceAvailable: false,
    summary: {
      completed: 0,
      draft: 0,
      prepared: 0,
      scheduled: 0,
      total: 0,
    },
  },
  runtime: demoRuntime,
});
assert.equal(tenantOnboardingDemoTruth.status, "live");
assert.equal(
  tenantOnboardingDemoTruth.facts.find((fact) => fact.label === "Saved runbooks")?.value,
  "0"
);

const tenantRolloutPacket: TenantRolloutPacket = {
  accessProfile: tenantOnboardingOverview.accessProfile,
  artifact: {
    content: "# Tenant rollout packet",
    fileName: "tenant-rollout-packet-tenant-north.md",
    format: "markdown",
    mediaType: "text/markdown",
  },
  currentReadiness: tenantOnboardingOverview.currentReadiness,
  currentReview: tenantOnboardingOverview.currentReview,
  generatedAt: "2026-03-12T08:11:00.000Z",
  handoff: {
    generatedAt: "2026-03-12T08:11:00.000Z",
    isRunbookBacked: true,
    state: "ready",
    stateLabel: "Ready to share",
    summary: "Deterministic rollout packet is ready for the next widening conversation.",
    targetCutoverAt: "2026-03-15T09:00:00.000Z",
    targetTenantLabel: "Northern tenant",
    targetTenantSlug: "tenant-north",
  },
  latestDecision: tenantOnboardingOverview.latestDecision,
  latestRunbook: tenantOnboardingOverview.latestRunbook,
  persistenceAvailable: true,
  sections: [],
  sourceLinks: [{ href: "/tenant-onboarding", label: "Open tenant onboarding" }],
  templateVersion: "tenant-rollout-v1",
};

const tenantRolloutPacketTruth = buildTenantRolloutPacketRuntimeTruth({
  packet: tenantRolloutPacket,
  runtime: liveRuntime,
});
assert.equal(tenantRolloutPacketTruth.status, "live");
assert.equal(
  tenantRolloutPacketTruth.facts.find((fact) => fact.label === "Artifact")?.value,
  "tenant-rollout-packet-tenant-north.md"
);

const tenantRolloutPacketPreviewTruth = buildTenantRolloutPacketRuntimeTruth({
  packet: {
    ...tenantRolloutPacket,
    handoff: {
      ...tenantRolloutPacket.handoff,
      isRunbookBacked: false,
      state: "warning",
      stateLabel: "Runbook missing",
    },
    latestDecision: null,
    latestRunbook: null,
    persistenceAvailable: false,
  },
  runtime: demoRuntime,
});
assert.equal(tenantRolloutPacketPreviewTruth.status, "live");
assert.equal(
  tenantRolloutPacketPreviewTruth.facts.find((fact) => fact.label === "Latest runbook")?.value,
  "Not started"
);

console.log("PASS runtime-truth.unit");
