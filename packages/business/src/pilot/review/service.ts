import { buildAccessProfile, type AccessProfile } from "@/lib/auth/access-profile";
import {
  listBriefDeliveryLedger,
  type BriefDeliveryLedgerRecord,
} from "@/lib/briefs/delivery-ledger";
import { getExecutiveExceptionInbox, type ExceptionInboxResult } from "@/lib/command-center";
import { createConnectorRegistry, type ConnectorStatus } from "@/lib/connectors";
import { EVIDENCE_LEDGER_SYNC_KEY } from "@/lib/evidence/service";
import { listPilotFeedback, type PilotFeedbackListResult } from "@/lib/pilot-feedback";
import { getPilotControlState } from "@/lib/server/pilot-controls";
import {
  canReadLiveOperatorData,
  getServerRuntimeState,
  type ServerRuntimeState,
} from "@/lib/server/runtime-mode";
import { getDerivedSyncCheckpoint, type DerivedSyncCheckpointView } from "@/lib/sync-state";
import { buildTenantReadinessReport } from "@/lib/tenant-readiness/service";
import type { TenantReadinessReport, TenantReadinessState } from "@/lib/tenant-readiness";

import { RECONCILIATION_CASEFILE_SYNC_KEY } from "@/lib/enterprise-truth";
import { ESCALATION_QUEUE_SYNC_KEY } from "@/lib/escalations/service";

import type {
  PilotReviewBuildInput,
  PilotReviewDeliverySummary,
  PilotReviewExportArtifact,
  PilotReviewFreshnessSignal,
  PilotReviewOutcome,
  PilotReviewScorecard,
  PilotReviewSection,
} from "./types";

interface PilotReviewServiceDeps {
  accessProfile?: AccessProfile;
  connectors?: ConnectorStatus[];
  deliveryEntries?: BriefDeliveryLedgerRecord[] | null;
  env?: NodeJS.ProcessEnv;
  feedback?: PilotFeedbackListResult | null;
  getConnectors?: () => Promise<ConnectorStatus[]>;
  getDeliveryEntries?: (limit?: number) => Promise<BriefDeliveryLedgerRecord[]>;
  getFeedback?: (query: {
    includeResolved?: boolean;
    limit?: number;
  }) => Promise<PilotFeedbackListResult>;
  getFreshnessCheckpoint?: (key: string) => Promise<DerivedSyncCheckpointView | null>;
  getInbox?: (query: {
    includeResolved?: boolean;
    limit?: number;
  }) => Promise<ExceptionInboxResult>;
  getReadiness?: () => Promise<TenantReadinessReport>;
  inbox?: ExceptionInboxResult | null;
  now?: () => Date;
  readiness?: TenantReadinessReport;
  runtime?: ServerRuntimeState;
}

const DELIVERY_LIMIT = 12;
const REVIEW_LIMIT = 24;
const STALE_WARNING_HOURS = 24;
const STALE_PENDING_HOURS = 24;

export async function getPilotReviewScorecard(
  deps: PilotReviewServiceDeps = {}
): Promise<PilotReviewScorecard> {
  const env = deps.env ?? process.env;
  const runtime = deps.runtime ?? getServerRuntimeState(env);
  const accessProfile = deps.accessProfile ?? buildAccessProfile();
  const now = deps.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const operatorDataReady = canReadLiveOperatorData(runtime);
  const getConnectors =
    deps.getConnectors ?? (() => createConnectorRegistry(env).getStatuses());
  const getInbox =
    deps.getInbox ??
    ((query: { includeResolved?: boolean; limit?: number }) => getExecutiveExceptionInbox(query));
  const getFeedback =
    deps.getFeedback ??
    ((query: { includeResolved?: boolean; limit?: number }) => listPilotFeedback(query));
  const getDeliveryEntries =
    deps.getDeliveryEntries ??
    ((limit = DELIVERY_LIMIT) =>
      listBriefDeliveryLedger({
        limit,
        scope: "governance",
      }));
  const getFreshnessCheckpoint =
    deps.getFreshnessCheckpoint ?? ((key: string) => getDerivedSyncCheckpoint(key));

  const pilot = getPilotControlState(runtime, env);
  const [connectors, inbox, pilotFeedback, deliveryEntries] = await Promise.all([
    deps.connectors ?? getConnectors(),
    deps.inbox !== undefined
      ? Promise.resolve(deps.inbox)
      : operatorDataReady
        ? getInbox({ limit: REVIEW_LIMIT })
        : Promise.resolve(null),
    deps.feedback !== undefined
      ? Promise.resolve(deps.feedback)
      : operatorDataReady
        ? getFeedback({ includeResolved: true, limit: REVIEW_LIMIT })
        : Promise.resolve(null),
    deps.deliveryEntries !== undefined
      ? Promise.resolve(deps.deliveryEntries)
      : operatorDataReady
        ? getDeliveryEntries(DELIVERY_LIMIT)
        : Promise.resolve(null),
  ]);

  const readiness =
    deps.readiness ??
    (deps.getReadiness
      ? await deps.getReadiness()
      : buildTenantReadinessReport({
          accessProfile,
          connectors,
          feedback: pilotFeedback,
          generatedAt,
          inbox,
          pilot,
          runtime,
        }));

  const [evidenceSync, escalationSync, reconciliationSync] = operatorDataReady
    ? await Promise.all([
        getFreshnessCheckpoint(EVIDENCE_LEDGER_SYNC_KEY),
        getFreshnessCheckpoint(ESCALATION_QUEUE_SYNC_KEY),
        getFreshnessCheckpoint(RECONCILIATION_CASEFILE_SYNC_KEY),
      ])
    : [null, null, null];

  return buildPilotReviewScorecard({
    accessProfile,
    deliveryEntries,
    inbox,
    freshnessSignals: [
      {
        checkpoint: evidenceSync,
        id: "evidence",
        label: "Evidence ledger sync",
        links: [{ href: "/integrations", label: "Open connector health" }],
      },
      {
        checkpoint: escalationSync,
        id: "escalations",
        label: "Escalation queue sync",
        links: [{ href: "/command-center", label: "Open command center" }],
      },
      {
        checkpoint: reconciliationSync,
        id: "reconciliation",
        label: "Reconciliation sync",
        links: [{ href: "/integrations", label: "Open connector health" }],
      },
    ],
    generatedAt,
    pilotFeedback,
    readiness,
    runtime,
  });
}

export function buildPilotReviewScorecard(
  input: PilotReviewBuildInput
): PilotReviewScorecard {
  const reviewDate = new Date(input.generatedAt);
  const readinessSection = buildReadinessSection(input.readiness);
  const exceptionSection = buildExceptionSection(input.inbox, reviewDate);
  const feedbackSection = buildPilotFeedbackSection(input.pilotFeedback, reviewDate);
  const delivery = summarizeDelivery(input.deliveryEntries, reviewDate);
  const deliverySection = buildDeliverySection(input.deliveryEntries, delivery);
  const freshness = buildFreshnessSignals(input.freshnessSignals, reviewDate);
  const freshnessSection = buildFreshnessSection(freshness);

  const sections = [
    readinessSection,
    exceptionSection,
    feedbackSection,
    deliverySection,
    freshnessSection,
  ];
  const outcome = resolveReviewOutcome(input.readiness, sections);
  const artifact = buildPilotReviewArtifact({
    generatedAt: input.generatedAt,
    outcome,
    readiness: input.readiness,
    sections,
  });

  return {
    accessProfile: {
      organizationSlug: input.accessProfile.organizationSlug,
      role: input.accessProfile.role,
      workspaceId: input.accessProfile.workspaceId,
    },
    artifact,
    delivery,
    freshness,
    generatedAt: input.generatedAt,
    outcome,
    outcomeLabel: getOutcomeLabel(outcome),
    readiness: input.readiness,
    runtime: input.runtime,
    sections,
    summary: {
      blockedSections: sections.filter((section) => section.state === "blocked").length,
      deliveryFailures: delivery.failed,
      openExceptions:
        input.inbox?.items.filter((item) => item.status !== "resolved").length ?? 0,
      openFeedback:
        input.pilotFeedback?.items.filter((item) => item.status !== "resolved").length ?? 0,
      readySections: sections.filter((section) => section.state === "ready").length,
      staleSignals: freshness.filter((item) => item.state !== "ready").length,
      warningSections: sections.filter((section) => section.state === "warning").length,
    },
  };
}

function buildReadinessSection(readiness: TenantReadinessReport): PilotReviewSection {
  const state =
    readiness.outcome === "blocked"
      ? "blocked"
      : readiness.outcome === "guarded" || readiness.outcome === "ready_with_warnings"
        ? "warning"
        : "ready";

  return {
    id: "readiness",
    label: "Cutover posture",
    links: [
      { href: "/tenant-readiness", label: "Open tenant readiness" },
      { href: "/pilot-controls", label: "Open pilot controls" },
    ],
    metrics: [
      { label: "Outcome", value: readiness.outcomeLabel },
      { label: "Tenant", value: readiness.tenant.slug },
      { label: "Blockers", value: String(readiness.summary.blockers) },
      { label: "Warnings", value: String(readiness.summary.warnings) },
      {
        label: "Blocked workflows",
        value: String(readiness.posture.blockedWorkflows.length),
      },
    ],
    state,
    summary:
      state === "blocked"
        ? "Tenant promotion is still blocked by readiness posture or unresolved live blockers."
        : state === "warning"
          ? "Tenant promotion is possible only with explicit guardrails or accepted warnings."
          : "Tenant readiness is clear enough to use as the weekly pilot baseline.",
  };
}

function buildExceptionSection(
  inbox: ExceptionInboxResult | null,
  reviewDate: Date
): PilotReviewSection {
  const unresolved = inbox?.items.filter((item) => item.status !== "resolved") ?? [];
  const criticalHigh = unresolved.filter(
    (item) => item.urgency === "critical" || item.urgency === "high"
  );
  const oldestObservedAt = unresolved
    .map((item) => Date.parse(item.observedAt))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)[0];
  const oldestAgeHours =
    oldestObservedAt !== undefined
      ? roundHours((reviewDate.getTime() - oldestObservedAt) / 3_600_000)
      : null;

  const state: TenantReadinessState =
    !inbox
      ? "blocked"
      : criticalHigh.length > 0
        ? "blocked"
        : unresolved.length > 0 || (oldestAgeHours !== null && oldestAgeHours >= 24)
          ? "warning"
          : "ready";

  return {
    id: "exceptions",
    label: "Exception backlog",
    links: [{ href: "/command-center", label: "Open command center" }],
    metrics: [
      { label: "Open items", value: String(unresolved.length) },
      { label: "Critical/high", value: String(criticalHigh.length) },
      {
        label: "Acknowledged",
        value: inbox ? String(inbox.summary.acknowledged) : "Unavailable",
      },
      { label: "Oldest age", value: formatAge(oldestAgeHours) },
    ],
    state,
    summary:
      !inbox
        ? "Command-center backlog is unavailable, so the weekly review cannot confirm whether exceptions are really under control."
        : criticalHigh.length > 0
          ? "Critical or high exception items are still open in the weekly review window."
          : unresolved.length > 0
            ? "Non-critical exception follow-through still remains open."
            : "Exception backlog is clear in the current review window.",
  };
}

function buildPilotFeedbackSection(
  feedback: PilotFeedbackListResult | null,
  reviewDate: Date
): PilotReviewSection {
  const active = feedback?.items.filter((item) => item.status !== "resolved") ?? [];
  const criticalHigh = active.filter(
    (item) => item.severity === "critical" || item.severity === "high"
  );
  const oldestOpenedAt = active
    .map((item) => Date.parse(item.openedAt))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)[0];
  const oldestAgeHours =
    oldestOpenedAt !== undefined
      ? roundHours((reviewDate.getTime() - oldestOpenedAt) / 3_600_000)
      : null;
  const state: TenantReadinessState =
    !feedback
      ? "blocked"
      : criticalHigh.length > 0
        ? "blocked"
        : active.length > 0
          ? "warning"
          : "ready";

  return {
    id: "feedback",
    label: "Pilot feedback loop",
    links: [{ href: "/pilot-feedback", label: "Open pilot feedback" }],
    metrics: [
      { label: "Active items", value: String(active.length) },
      { label: "Critical/high", value: String(criticalHigh.length) },
      {
        label: "Resolved",
        value: feedback ? String(feedback.summary.resolved) : "Unavailable",
      },
      { label: "Oldest age", value: formatAge(oldestAgeHours) },
    ],
    state,
    summary:
      !feedback
        ? "Pilot feedback history is unavailable, so the weekly review cannot verify whether product blockers are really closed."
        : criticalHigh.length > 0
          ? "Critical or high pilot feedback still needs follow-through."
          : active.length > 0
            ? "Pilot feedback remains active but is no longer critical."
            : "Pilot feedback loop is currently resolved for weekly review.",
  };
}

function summarizeDelivery(
  entries: BriefDeliveryLedgerRecord[] | null,
  reviewDate: Date
): PilotReviewDeliverySummary {
  const safeEntries = entries ?? [];
  const delivered = safeEntries.filter((entry) => entry.status === "delivered");
  const failed = safeEntries.filter((entry) => entry.status === "failed");
  const pending = safeEntries.filter((entry) => entry.status === "pending");
  const preview = safeEntries.filter((entry) => entry.status === "preview");
  const stalePending = pending.filter((entry) => {
    if (!entry.lastAttemptAt) {
      return false;
    }

    const attemptedAt = Date.parse(entry.lastAttemptAt);
    if (!Number.isFinite(attemptedAt)) {
      return false;
    }

    return reviewDate.getTime() - attemptedAt >= STALE_PENDING_HOURS * 3_600_000;
  });

  return {
    entries: safeEntries,
    failed: failed.length,
    lastDeliveredAt:
      delivered
        .map((entry) => entry.deliveredAt ?? entry.updatedAt)
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => right.localeCompare(left))[0] ?? null,
    lastFailureAt:
      failed.map((entry) => entry.updatedAt).sort((left, right) => right.localeCompare(left))[0] ??
      null,
    pending: pending.length,
    preview: preview.length,
    stalePending: stalePending.length,
    successful: delivered.length,
    total: safeEntries.length,
  };
}

function buildDeliverySection(
  entries: BriefDeliveryLedgerRecord[] | null,
  delivery: PilotReviewDeliverySummary
): PilotReviewSection {
  const state: TenantReadinessState =
    !entries
      ? "blocked"
      : delivery.failed > 0 && delivery.successful === 0
        ? "blocked"
        : delivery.failed > 0 ||
            delivery.pending > 0 ||
            delivery.stalePending > 0 ||
            delivery.successful === 0
          ? "warning"
          : "ready";

  return {
    id: "delivery",
    label: "Delivery health",
    links: [{ href: "/pilot-review", label: "Open governance delivery" }],
    metrics: [
      { label: "Recent records", value: String(delivery.total) },
      { label: "Delivered", value: String(delivery.successful) },
      { label: "Failed", value: String(delivery.failed) },
      { label: "Pending", value: String(delivery.pending) },
      { label: "Last delivered", value: formatTimestamp(delivery.lastDeliveredAt) },
    ],
    state,
    summary:
      !entries
        ? "Delivery ledger is unavailable, so governance review cannot confirm outbound execution history."
        : delivery.failed > 0 && delivery.successful === 0
          ? "Recent delivery history shows failures without a successful recovery."
          : delivery.failed > 0 || delivery.pending > 0 || delivery.stalePending > 0
            ? "Delivery history still shows recent failures, pending sends, or stale retries."
            : delivery.successful === 0
              ? "No durable delivery records have been captured yet."
              : "Recent delivery history is healthy in the weekly review window.",
  };
}

function buildFreshnessSignals(
  inputs: PilotReviewBuildInput["freshnessSignals"],
  reviewDate: Date
): PilotReviewFreshnessSignal[] {
  return inputs.map((input) => {
    if (!input.checkpoint || !input.checkpoint.lastSuccessAt) {
      const summary =
        input.checkpoint?.status === "error" && input.checkpoint.lastError
          ? `Last sync failed: ${input.checkpoint.lastError}`
          : "No successful sync has been recorded for this signal yet.";

      return {
        ageHours: null,
        id: input.id,
        label: input.label,
        lastSuccessAt: null,
        links: input.links,
        state: "blocked",
        status: input.checkpoint?.status ?? "missing",
        summary,
      };
    }

    const lastSuccessAt = Date.parse(input.checkpoint.lastSuccessAt);
    const ageHours = Number.isFinite(lastSuccessAt)
      ? roundHours((reviewDate.getTime() - lastSuccessAt) / 3_600_000)
      : null;

    let state: TenantReadinessState = "ready";
    let summary = `Last successful sync was ${formatAge(ageHours)} ago.`;

    if (input.checkpoint.status === "error") {
      state = "blocked";
      summary = input.checkpoint.lastError
        ? `Last sync failed: ${input.checkpoint.lastError}`
        : "Last sync failed and needs operator attention.";
    } else if (input.checkpoint.status === "running") {
      state = "warning";
      summary = `Sync is currently running. Last successful run was ${formatAge(ageHours)} ago.`;
    } else if (ageHours !== null && ageHours > STALE_WARNING_HOURS) {
      state = "warning";
      summary = `Last successful sync was ${formatAge(ageHours)} ago, which is outside the expected weekly review freshness window.`;
    }

    return {
      ageHours,
      id: input.id,
      label: input.label,
      lastSuccessAt: input.checkpoint.lastSuccessAt,
      links: input.links,
      state,
      status: input.checkpoint.status,
      summary,
    };
  });
}

function buildFreshnessSection(
  signals: PilotReviewFreshnessSignal[]
): PilotReviewSection {
  const blocked = signals.filter((signal) => signal.state === "blocked").length;
  const warnings = signals.filter((signal) => signal.state === "warning").length;
  const stalestAge = signals
    .map((signal) => signal.ageHours)
    .filter((value): value is number => value !== null)
    .sort((left, right) => right - left)[0] ?? null;
  const state: TenantReadinessState =
    blocked > 0 ? "blocked" : warnings > 0 ? "warning" : "ready";

  return {
    id: "freshness",
    label: "Freshness lag",
    links: [
      { href: "/integrations", label: "Open connector health" },
      { href: "/command-center", label: "Open command center" },
    ],
    metrics: [
      { label: "Blocked signals", value: String(blocked) },
      { label: "Warnings", value: String(warnings) },
      { label: "Stalest age", value: formatAge(stalestAge) },
      { label: "Tracked syncs", value: String(signals.length) },
    ],
    state,
    summary:
      blocked > 0
        ? "At least one core sync signal has no valid success checkpoint for weekly governance review."
        : warnings > 0
          ? "Freshness lag needs attention before the scorecard can be treated as fully current."
          : "Core sync signals are fresh enough for a deterministic weekly review.",
  };
}

function resolveReviewOutcome(
  readiness: TenantReadinessReport,
  sections: PilotReviewSection[]
): PilotReviewOutcome {
  if (sections.some((section) => section.state === "blocked")) {
    return "blocked";
  }

  if (readiness.outcome === "guarded") {
    return "guarded";
  }

  if (sections.some((section) => section.state === "warning")) {
    return "ready_with_warnings";
  }

  return "ready";
}

function buildPilotReviewArtifact(input: {
  generatedAt: string;
  outcome: PilotReviewOutcome;
  readiness: TenantReadinessReport;
  sections: PilotReviewSection[];
}): PilotReviewExportArtifact {
  const content = buildPilotReviewMarkdown(input);

  return {
    content,
    fileName: buildArtifactFileName(input.generatedAt),
    format: "markdown",
    mediaType: "text/markdown",
  };
}

function buildPilotReviewMarkdown(input: {
  generatedAt: string;
  outcome: PilotReviewOutcome;
  readiness: TenantReadinessReport;
  sections: PilotReviewSection[];
}) {
  const lines = [
    "# CEOClaw Pilot Review Scorecard",
    "",
    `Generated at: ${input.generatedAt}`,
    `Tenant: ${input.readiness.tenant.slug}`,
    `Review outcome: ${getOutcomeLabel(input.outcome)}`,
    `Readiness outcome: ${input.readiness.outcomeLabel}`,
    `Pilot posture: ${input.readiness.posture.stageLabel}`,
    "",
    "## Governance Summary",
    "",
    `- Blocked sections: ${input.sections.filter((section) => section.state === "blocked").length}`,
    `- Warning sections: ${input.sections.filter((section) => section.state === "warning").length}`,
    `- Ready sections: ${input.sections.filter((section) => section.state === "ready").length}`,
    "",
    "## Scorecard",
    "",
  ];

  for (const section of input.sections) {
    lines.push(`### ${section.label}`);
    lines.push("");
    lines.push(`State: ${section.state}`);
    lines.push(`Summary: ${section.summary}`);
    lines.push("");
    for (const metric of section.metrics) {
      lines.push(`- ${metric.label}: ${metric.value}`);
    }
    if (section.links.length > 0) {
      lines.push("");
      lines.push("Links:");
      for (const link of section.links) {
        lines.push(`- ${link.label}: ${link.href}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd().concat("\n");
}

function buildArtifactFileName(generatedAt: string) {
  return `ceoclaw-pilot-review-${generatedAt.replace(/[:]/g, "-")}.md`;
}

function getOutcomeLabel(outcome: PilotReviewOutcome) {
  switch (outcome) {
    case "blocked":
      return "Blocked";
    case "guarded":
      return "Guarded";
    case "ready_with_warnings":
      return "Ready with warnings";
    case "ready":
    default:
      return "Ready";
  }
}

function formatAge(ageHours: number | null) {
  if (ageHours === null) {
    return "n/a";
  }

  return `${ageHours}h`;
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "n/a";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function roundHours(value: number) {
  return Math.round(value * 10) / 10;
}
