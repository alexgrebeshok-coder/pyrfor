import { buildAccessProfile, type AccessProfile } from "@/lib/auth/access-profile";
import type { CutoverDecisionRecord } from "@/lib/cutover-decisions";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import {
  getTenantOnboardingOverview,
  type TenantOnboardingOverview,
  type TenantOnboardingRunbookRecord,
} from "@/lib/tenant-onboarding";
import type { TenantReadinessLinkView, TenantReadinessState } from "@/lib/tenant-readiness";

import type {
  TenantRolloutPacket,
  TenantRolloutPacketArtifact,
  TenantRolloutPacketHandoff,
  TenantRolloutPacketSection,
} from "./types";

interface TenantRolloutPacketDeps {
  accessProfile?: AccessProfile;
  env?: NodeJS.ProcessEnv;
  getOverview?: () => Promise<TenantOnboardingOverview>;
  includePersistedState?: boolean;
  now?: () => Date;
  overview?: TenantOnboardingOverview;
}

export async function getTenantRolloutPacket(
  deps: TenantRolloutPacketDeps = {}
): Promise<TenantRolloutPacket> {
  const accessProfile = deps.accessProfile ?? buildAccessProfile();
  const env = deps.env ?? process.env;
  const runtime = getServerRuntimeState(env);
  const overview =
    deps.overview ??
    (deps.getOverview
      ? await deps.getOverview()
      : await getTenantOnboardingOverview({
          accessProfile,
          env,
          includePersistedState: deps.includePersistedState ?? runtime.databaseConfigured,
        }));
  const generatedAt = (deps.now ?? (() => new Date()))().toISOString();
  const latestRunbook = overview.latestRunbook;
  const handoff = buildHandoff({
    generatedAt,
    latestDecision: overview.latestDecision,
    latestRunbook,
    overview,
  });
  const sections = buildSections({
    handoff,
    latestDecision: overview.latestDecision,
    latestRunbook,
    overview,
  });

  return {
    accessProfile: {
      organizationSlug: overview.accessProfile.organizationSlug,
      role: overview.accessProfile.role,
      workspaceId: overview.accessProfile.workspaceId,
    },
    artifact: buildArtifact({
      generatedAt,
      handoff,
      latestDecision: overview.latestDecision,
      latestRunbook,
      overview,
      sections,
    }),
    currentReadiness: overview.currentReadiness,
    currentReview: overview.currentReview,
    generatedAt,
    handoff,
    latestDecision: overview.latestDecision,
    latestRunbook,
    persistenceAvailable: overview.persistenceAvailable,
    sections,
    sourceLinks: uniqueLinks(sections.flatMap((section) => section.links)),
    templateVersion: latestRunbook?.templateVersion ?? overview.template.version,
  };
}

function buildHandoff(input: {
  generatedAt: string;
  latestDecision: CutoverDecisionRecord | null;
  latestRunbook: TenantOnboardingRunbookRecord | null;
  overview: TenantOnboardingOverview;
}): TenantRolloutPacketHandoff {
  const { latestDecision, latestRunbook, overview } = input;
  const blockedBaseline =
    latestDecision?.decisionType === "rollback" ||
    overview.currentReadiness.outcome === "blocked" ||
    overview.currentReview.outcome === "blocked";
  const warningBaseline =
    overview.currentReadiness.outcome !== "ready" ||
    overview.currentReview.outcome !== "ready" ||
    latestDecision?.decisionType === "warning_waiver";

  if (blockedBaseline) {
    return {
      generatedAt: input.generatedAt,
      isRunbookBacked: latestRunbook !== null,
      state: "blocked",
      stateLabel:
        latestDecision?.decisionType === "rollback" ? "Rollback active" : "Blocked baseline",
      summary:
        latestDecision?.decisionType === "rollback"
          ? "The latest recorded decision is a rollback. Keep this packet as traceable handoff context, not as a promotion-ready widening package."
          : "Current readiness or governance review is still blocked. Operators can export this packet, but it should stay inside planning and recovery conversations.",
      targetCutoverAt: latestRunbook?.targetCutoverAt ?? null,
      targetTenantLabel: latestRunbook?.targetTenantLabel ?? null,
      targetTenantSlug: latestRunbook?.targetTenantSlug ?? null,
    };
  }

  if (!latestRunbook) {
    return {
      generatedAt: input.generatedAt,
      isRunbookBacked: false,
      state: "warning",
      stateLabel: "Runbook missing",
      summary:
        "No persisted onboarding runbook exists yet. Create or update a runbook first so the next tenant conversation has explicit scope, handoff notes, and rollback posture.",
      targetCutoverAt: null,
      targetTenantLabel: null,
      targetTenantSlug: null,
    };
  }

  if (latestRunbook.status === "draft") {
    return {
      generatedAt: input.generatedAt,
      isRunbookBacked: true,
      state: "warning",
      stateLabel: "Draft handoff",
      summary:
        "The latest runbook is still draft-only. Fill the target-tenant, handoff, and rollback sections before treating this packet as the bounded operator handoff.",
      targetCutoverAt: latestRunbook.targetCutoverAt,
      targetTenantLabel: latestRunbook.targetTenantLabel,
      targetTenantSlug: latestRunbook.targetTenantSlug,
    };
  }

  if (!latestDecision) {
    return {
      generatedAt: input.generatedAt,
      isRunbookBacked: true,
      state: "warning",
      stateLabel: "Decision missing",
      summary:
        "The runbook is persisted, but there is still no explicit cutover decision recorded for the current baseline. Keep this packet inside controlled rollout discussion until that gap is closed.",
      targetCutoverAt: latestRunbook.targetCutoverAt,
      targetTenantLabel: latestRunbook.targetTenantLabel,
      targetTenantSlug: latestRunbook.targetTenantSlug,
    };
  }

  if (warningBaseline) {
    return {
      generatedAt: input.generatedAt,
      isRunbookBacked: true,
      state: "warning",
      stateLabel: "Controlled rollout",
      summary:
        "The packet is deterministic and exportable, but it still reflects accepted warnings or guarded rollout posture. Share it as a controlled-widening handoff, not as an unqualified promotion.",
      targetCutoverAt: latestRunbook.targetCutoverAt,
      targetTenantLabel: latestRunbook.targetTenantLabel,
      targetTenantSlug: latestRunbook.targetTenantSlug,
    };
  }

  return {
    generatedAt: input.generatedAt,
    isRunbookBacked: true,
    state: "ready",
    stateLabel: "Ready to share",
    summary:
      "The latest onboarding runbook, governance review, and cutover approval now form one deterministic rollout packet that operators can reuse in the next tenant widening conversation.",
    targetCutoverAt: latestRunbook.targetCutoverAt,
    targetTenantLabel: latestRunbook.targetTenantLabel,
    targetTenantSlug: latestRunbook.targetTenantSlug,
  };
}

function buildSections(input: {
  handoff: TenantRolloutPacketHandoff;
  latestDecision: CutoverDecisionRecord | null;
  latestRunbook: TenantOnboardingRunbookRecord | null;
  overview: TenantOnboardingOverview;
}): TenantRolloutPacketSection[] {
  const { handoff, latestDecision, latestRunbook, overview } = input;
  const activeWarnings =
    overview.currentReadiness.summary.warnings + overview.currentReview.summary.warningSections;

  return [
    {
      id: "readiness",
      label: "Tenant readiness",
      links: [{ href: "/tenant-readiness", label: "Open tenant readiness" }],
      lines: [
        `Baseline tenant: ${overview.currentReadiness.tenant.slug}`,
        `Outcome: ${overview.currentReadiness.outcomeLabel}`,
        `Pilot posture: ${overview.currentReadiness.posture.stageLabel}`,
        `Write workspaces: ${
          overview.currentReadiness.posture.writeWorkspaces.length > 0
            ? overview.currentReadiness.posture.writeWorkspaces.join(", ")
            : "No explicit write scope"
        }`,
        `Open blockers: ${overview.currentReadiness.summary.blockers}`,
        `Open warnings: ${overview.currentReadiness.summary.warnings}`,
        `Generated: ${formatTimestamp(overview.currentReadiness.generatedAt)}`,
      ],
      state: toStateFromOutcome(overview.currentReadiness.outcome),
      summary:
        overview.currentReadiness.outcome === "blocked"
          ? "The baseline tenant is still blocked and should not be treated as a promotion-ready widening template."
          : overview.currentReadiness.outcome === "ready"
            ? "The readiness baseline is clean enough to reuse directly in the packet."
            : "The readiness baseline is usable, but operators still need to carry forward explicit warning or guardrail context.",
    },
    {
      id: "review",
      label: "Pilot review artifact",
      links: [
        { href: "/pilot-review", label: "Open pilot review" },
        { href: "/api/pilot-review?format=markdown&download=1", label: "Download pilot review" },
      ],
      lines: [
        `Outcome: ${overview.currentReview.outcomeLabel}`,
        `Artifact: ${overview.currentReview.artifact.fileName}`,
        `Blocked sections: ${overview.currentReview.summary.blockedSections}`,
        `Warning sections: ${overview.currentReview.summary.warningSections}`,
        `Open exceptions: ${overview.currentReview.summary.openExceptions}`,
        `Open feedback: ${overview.currentReview.summary.openFeedback}`,
        `Generated: ${formatTimestamp(overview.currentReview.generatedAt)}`,
      ],
      state: toStateFromOutcome(overview.currentReview.outcome),
      summary:
        overview.currentReview.outcome === "blocked"
          ? "The governance scorecard still reports blocked sections. Use it to frame the conversation, but do not flatten that risk away in handoff."
          : overview.currentReview.outcome === "ready"
            ? "The governance review is already clean and attachable as the current decision-grade baseline."
            : "The governance review is attachable, but accepted warnings or guarded posture still belong in the packet summary.",
    },
    {
      id: "decision",
      label: "Cutover decision trail",
      links: [{ href: "/tenant-readiness", label: "Open decision register" }],
      lines: latestDecision
        ? [
            `Decision: ${latestDecision.decisionLabel}`,
            `Summary: ${latestDecision.summary}`,
            `Readiness at decision time: ${latestDecision.readinessOutcomeLabel}`,
            `Review at decision time: ${latestDecision.reviewOutcomeLabel}`,
            `Recorded: ${formatTimestamp(latestDecision.createdAt)}`,
          ]
        : [
            "Decision: No decision recorded",
            "Summary: The packet still lacks an explicit approval, waiver, or rollback record for the current baseline.",
          ],
      state: latestDecision ? toDecisionState(latestDecision.decisionType) : "warning",
      summary: latestDecision
        ? latestDecision.decisionType === "rollback"
          ? "A rollback is explicitly recorded, so the packet should travel with recovery context rather than promotion intent."
          : latestDecision.decisionType === "warning_waiver"
            ? "The decision trail is present, but it still encodes accepted warning posture."
            : "The decision trail is explicit and current enough to anchor the widening handoff."
        : "No decision trail is attached yet, so operators still need to resolve that governance gap before widening.",
    },
    {
      id: "runbook",
      label: "Persisted onboarding runbook",
      links: [{ href: "/tenant-onboarding", label: "Open tenant onboarding" }],
      lines: latestRunbook
        ? [
            `Status: ${latestRunbook.statusLabel}`,
            `Target tenant: ${latestRunbook.targetTenantSlug ?? latestRunbook.targetTenantLabel ?? "Not set"}`,
            `Target cutover: ${formatOptionalTimestamp(latestRunbook.targetCutoverAt)}`,
            `Summary: ${latestRunbook.summary}`,
            `Rollout scope: ${latestRunbook.rolloutScope}`,
            `Updated: ${formatTimestamp(latestRunbook.updatedAt)}`,
          ]
        : [
            "Status: Not started",
            "Target tenant: Not set",
            "Summary: Create a persisted onboarding runbook to turn this packet into durable handoff state.",
          ],
      state:
        latestRunbook === null
          ? "warning"
          : latestRunbook.status === "draft"
            ? "warning"
            : "ready",
      summary:
        latestRunbook === null
          ? "There is no persisted runbook yet, so target-tenant details and operator notes still live only in surrounding surfaces."
          : latestRunbook.status === "draft"
            ? "The runbook exists, but it still needs a non-draft handoff status before widening."
            : "The latest runbook already carries bounded target-tenant and rollback details for this packet.",
    },
    {
      id: "handoff",
      label: "Operator handoff",
      links: [{ href: "/tenant-rollout-packet", label: "Open rollout packet" }],
      lines: [
        `Handoff state: ${handoff.stateLabel}`,
        `Target tenant: ${
          handoff.targetTenantSlug ?? handoff.targetTenantLabel ?? overview.currentReadiness.tenant.slug
        }`,
        `Target cutover: ${formatOptionalTimestamp(handoff.targetCutoverAt)}`,
        `Runbook-backed: ${handoff.isRunbookBacked ? "Yes" : "No"}`,
        `Active warnings: ${activeWarnings}`,
        `Packet summary: ${handoff.summary}`,
      ],
      state: handoff.state,
      summary: handoff.summary,
    },
  ];
}

function buildArtifact(input: {
  generatedAt: string;
  handoff: TenantRolloutPacketHandoff;
  latestDecision: CutoverDecisionRecord | null;
  latestRunbook: TenantOnboardingRunbookRecord | null;
  overview: TenantOnboardingOverview;
  sections: TenantRolloutPacketSection[];
}): TenantRolloutPacketArtifact {
  const targetTenant =
    input.handoff.targetTenantSlug ??
    input.handoff.targetTenantLabel ??
    input.latestRunbook?.baselineTenantSlug ??
    input.overview.currentReadiness.tenant.slug;
  const fileName = `tenant-rollout-packet-${sanitizeFileSegment(targetTenant)}.md`;
  const runbook = input.latestRunbook;
  const lines = [
    "# Tenant rollout packet",
    "",
    `Generated: ${formatTimestamp(input.generatedAt)}`,
    `Viewer: ${input.overview.accessProfile.organizationSlug} · ${input.overview.accessProfile.role} · ${input.overview.accessProfile.workspaceId}`,
    `Handoff state: ${input.handoff.stateLabel}`,
    `Template version: ${runbook?.templateVersion ?? input.overview.template.version}`,
    "",
    "## Rollout scope",
    `- Baseline tenant: ${input.overview.currentReadiness.tenant.slug}`,
    `- Target tenant: ${
      runbook?.targetTenantSlug ?? runbook?.targetTenantLabel ?? "Not captured in runbook"
    }`,
    `- Latest runbook status: ${runbook?.statusLabel ?? "Not started"}`,
    `- Target cutover: ${formatOptionalTimestamp(runbook?.targetCutoverAt ?? null)}`,
    `- Latest decision: ${input.latestDecision?.decisionLabel ?? "No decision recorded"}`,
    `- Packet summary: ${input.handoff.summary}`,
    "",
    "## Packet inputs",
    ...input.sections.flatMap((section) => [
      `### ${section.label}`,
      ...section.lines.map((line) => `- ${line}`),
      "",
    ]),
    "## Handoff notes",
    runbook?.handoffNotes ?? "Not captured in the latest runbook.",
    "",
    "## Operator notes",
    runbook?.operatorNotes ?? "Not captured in the latest runbook.",
    "",
    "## Rollback plan",
    runbook?.rollbackPlan ?? "Not captured in the latest runbook.",
    "",
    "## Source links",
    "- /tenant-readiness",
    "- /pilot-review",
    "- /tenant-onboarding",
    "- /tenant-rollout-packet",
  ];

  return {
    content: lines.join("\n"),
    fileName,
    format: "markdown",
    mediaType: "text/markdown",
  };
}

function uniqueLinks(links: TenantReadinessLinkView[]) {
  const seen = new Set<string>();

  return links.filter((link) => {
    if (seen.has(link.href)) {
      return false;
    }

    seen.add(link.href);
    return true;
  });
}

function toStateFromOutcome(
  outcome: TenantOnboardingOverview["currentReadiness"]["outcome"] | TenantOnboardingOverview["currentReview"]["outcome"]
): TenantReadinessState {
  switch (outcome) {
    case "blocked":
      return "blocked";
    case "guarded":
    case "ready_with_warnings":
      return "warning";
    case "ready":
    default:
      return "ready";
  }
}

function toDecisionState(decisionType: CutoverDecisionRecord["decisionType"]): TenantReadinessState {
  switch (decisionType) {
    case "rollback":
      return "blocked";
    case "warning_waiver":
      return "warning";
    case "cutover_approved":
    default:
      return "ready";
  }
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatOptionalTimestamp(value: string | null) {
  return value ? formatTimestamp(value) : "Not scheduled";
}

function sanitizeFileSegment(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const safe = normalized.replace(/^-+|-+$/g, "");
  return safe || "current-baseline";
}
