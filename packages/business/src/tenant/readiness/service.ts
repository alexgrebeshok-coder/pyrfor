import { buildAccessProfile, type AccessProfile } from "@/lib/auth/access-profile";
import { getExecutiveExceptionInbox, type ExceptionInboxResult } from "@/lib/command-center";
import {
  createConnectorRegistry,
  summarizeConnectorStatuses,
  type ConnectorStatus,
} from "@/lib/connectors";
import {
  listPilotFeedback,
  type PilotFeedbackItemView,
  type PilotFeedbackListResult,
} from "@/lib/pilot-feedback";
import {
  getPilotControlState,
  getPilotStageLabel,
  getPilotWorkflowLabel,
  type PilotControlState,
} from "@/lib/server/pilot-controls";
import {
  canReadLiveOperatorData,
  getServerRuntimeState,
  type ServerRuntimeState,
} from "@/lib/server/runtime-mode";

import type {
  TenantReadinessBuildInput,
  TenantReadinessChecklistItem,
  TenantReadinessFinding,
  TenantReadinessLinkView,
  TenantReadinessOutcome,
  TenantReadinessReport,
  TenantReadinessTenantView,
} from "./types";
import { isCriticalConcern, isCriticalFeedback } from "./types";

interface TenantReadinessServiceDeps {
  accessProfile?: AccessProfile;
  connectors?: ConnectorStatus[];
  env?: NodeJS.ProcessEnv;
  feedback?: PilotFeedbackListResult | null;
  getConnectors?: () => Promise<ConnectorStatus[]>;
  getFeedback?: (query: {
    includeResolved?: boolean;
    limit?: number;
  }) => Promise<PilotFeedbackListResult>;
  getInbox?: (query: {
    includeResolved?: boolean;
    limit?: number;
  }) => Promise<ExceptionInboxResult>;
  inbox?: ExceptionInboxResult | null;
  now?: () => Date;
  pilot?: PilotControlState;
  runtime?: ServerRuntimeState;
}

const CONNECTOR_LIMIT = 24;
const CUTOVER_CONNECTORS = new Set(["gps", "one-c"]);

export async function getTenantReadiness(
  deps: TenantReadinessServiceDeps = {}
): Promise<TenantReadinessReport> {
  const env = deps.env ?? process.env;
  const runtime = deps.runtime ?? getServerRuntimeState(env);
  const pilot = deps.pilot ?? getPilotControlState(runtime, env);
  const accessProfile = deps.accessProfile ?? buildAccessProfile();
  const now = deps.now ?? (() => new Date());
  const getConnectors =
    deps.getConnectors ?? (() => createConnectorRegistry(env).getStatuses());
  const getInbox =
    deps.getInbox ?? ((query: { includeResolved?: boolean; limit?: number }) => getExecutiveExceptionInbox(query));
  const getFeedback =
    deps.getFeedback ??
    ((query: { includeResolved?: boolean; limit?: number }) => listPilotFeedback(query));
  const operatorDataReady = canReadLiveOperatorData(runtime);

  const [connectors, inbox, feedback] = await Promise.all([
    deps.connectors ?? getConnectors(),
    deps.inbox !== undefined
      ? deps.inbox
      : operatorDataReady
        ? getInbox({ limit: CONNECTOR_LIMIT })
        : Promise.resolve(null),
    deps.feedback !== undefined
      ? deps.feedback
      : operatorDataReady
        ? getFeedback({ includeResolved: true, limit: CONNECTOR_LIMIT })
        : Promise.resolve(null),
  ]);

  return buildTenantReadinessReport({
    accessProfile,
    connectors,
    feedback,
    generatedAt: now().toISOString(),
    inbox,
    pilot,
    runtime,
  });
}

export function buildTenantReadinessReport(
  input: TenantReadinessBuildInput
): TenantReadinessReport {
  const connectorSummary = summarizeConnectorStatuses(input.connectors);
  const tenant = resolveTenant(input.accessProfile, input.pilot);

  const runtimeBlockers: TenantReadinessFinding[] = [];
  const runtimeReadySignals: TenantReadinessFinding[] = [];
  if (input.runtime.healthStatus === "degraded") {
    runtimeBlockers.push({
      action: "Restore DATABASE_URL-backed live runtime before widening the tenant cutover.",
      category: "runtime",
      id: "runtime-degraded",
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state: "blocked",
      summary:
        "Live runtime is requested, but DATABASE_URL is missing or invalid so the server cannot guarantee live portfolio facts.",
      title: "Runtime is degraded",
    });
  } else if (!input.runtime.databaseConfigured) {
    runtimeBlockers.push({
      action:
        "Switch the runtime to live or auto with DATABASE_URL configured before judging tenant promotion.",
      category: "runtime",
      id: "runtime-demo",
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state: "blocked",
      summary:
        "This tenant is still running on demo or unavailable portfolio facts, so the readiness view cannot claim a real cutover posture.",
      title: "Portfolio runtime is not live",
    });
  } else {
    runtimeReadySignals.push({
      action: "Keep runtime truth pinned to live database-backed facts during cutover review.",
      category: "runtime",
      id: "runtime-live",
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state: "ready",
      summary:
        "Portfolio context is reading from the live database, so readiness decisions are tied to persisted runtime truth.",
      title: "Live runtime is active",
    });
  }

  const rolloutBlockers: TenantReadinessFinding[] = [];
  const rolloutWarnings: TenantReadinessFinding[] = [];
  const rolloutReadySignals: TenantReadinessFinding[] = [];

  if (!input.pilot.configured) {
    rolloutBlockers.push({
      action: "Set an explicit pilot rollout stage and tenant slug before promoting beyond the current pilot.",
      category: "rollout",
      id: "rollout-config-missing",
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state: "blocked",
      summary:
        "Pilot controls are still using the default open posture. Wider live cutover needs an explicit rollout stage and tenant boundary.",
      title: "Pilot posture is not configured explicitly",
    });
  }

  if (!input.pilot.tenantSlug) {
    rolloutBlockers.push({
      action: "Set PILOT_TENANT_SLUG so high-risk workflows stay limited to one explicit tenant.",
      category: "rollout",
      id: "rollout-tenant-missing",
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state: "blocked",
      summary:
        "No tenant boundary is locked for this pilot yet, so promotion would overstate how safely live workflows are scoped.",
      title: "Tenant boundary is not fixed",
    });
  } else {
    rolloutReadySignals.push({
      action: "Keep promotion decisions scoped to this tenant until the pilot is intentionally widened.",
      category: "rollout",
      id: "rollout-tenant-fixed",
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state: "ready",
      summary: `High-risk pilot workflows are scoped to tenant ${input.pilot.tenantSlug}.`,
      title: "Tenant boundary is explicit",
    });
  }

  if (input.pilot.stage === "observe" || input.pilot.stage === "delivery") {
    rolloutBlockers.push({
      action: "Promote the rollout posture only after the blocked workflows and related operators are ready.",
      category: "rollout",
      id: `rollout-stage-${input.pilot.stage}`,
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state: "blocked",
      summary: `Current posture is ${getPilotStageLabel(input.pilot.stage)} and still blocks ${input.pilot.blockedWorkflows
        .map((workflow) => getPilotWorkflowLabel(workflow))
        .join(", ")}.`,
      title: "Rollout posture still blocks live promotion",
    });
  } else if (input.pilot.stage === "controlled") {
    rolloutWarnings.push({
      action: "Keep the tenant under explicit guardrails until the remaining warnings are accepted for wider cutover.",
      category: "rollout",
      id: "rollout-stage-controlled",
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state: "warning",
      summary:
        "Controlled rollout keeps promotion narrow and explicit. This is safer than open cutover, but it still signals a guarded posture.",
      title: "Tenant stays under controlled rollout",
    });
  } else {
    rolloutReadySignals.push({
      action: "Continue using pilot controls as the narrow cutover boundary while the tenant stays live.",
      category: "rollout",
      id: "rollout-stage-open",
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state: "ready",
      summary:
        "Pilot posture no longer blocks the highest-risk workflows, so cutover is not limited by stage-level workflow guards.",
      title: "Rollout posture is open",
    });
  }

  if (input.pilot.liveMutationAllowed) {
    rolloutReadySignals.push({
      action: "Keep high-risk writes limited to the currently allowed workspaces during promotion.",
      category: "rollout",
      id: "rollout-mutations-live",
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state: "ready",
      summary: `Live mutations are allowed inside ${input.pilot.allowedWriteWorkspaces.join(", ")}.`,
      title: "Write scope is explicit",
    });
  }

  const connectorBlockers: TenantReadinessFinding[] = [];
  const connectorWarnings: TenantReadinessFinding[] = [];
  const connectorReadySignals: TenantReadinessFinding[] = [];

  for (const connector of input.connectors) {
    if (connector.status === "degraded") {
      connectorBlockers.push({
        action: "Repair the live probe and confirm the connector health surface before cutover.",
        category: "connector",
        id: `connector-degraded-${connector.id}`,
        links: connectorLinks(connector.id),
        state: "blocked",
        summary: connector.message,
        title: `${connector.name} is degraded`,
      });
      continue;
    }

    if (!connector.configured) {
      const finding: TenantReadinessFinding = {
        action: "Finish credential setup and rerun connector health before promotion decisions depend on this surface.",
        category: "connector",
        id: `connector-pending-${connector.id}`,
        links: connectorLinks(connector.id),
        state: CUTOVER_CONNECTORS.has(connector.id) ? "blocked" : "warning",
        summary:
          connector.missingSecrets.length > 0
            ? `Missing ${connector.missingSecrets.join(", ")}. ${connector.message}`
            : connector.message,
        title: `${connector.name} is waiting for credentials`,
      };

      if (finding.state === "blocked") {
        connectorBlockers.push(finding);
      } else {
        connectorWarnings.push(finding);
      }
    }
  }

  if (input.connectors.length > 0 && connectorSummary.ok === input.connectors.length) {
    connectorReadySignals.push({
      action: "Keep validating connector health from the readiness checklist before expanding the rollout.",
      category: "connector",
      id: "connectors-healthy",
      links: [{ href: "/integrations", label: "Open connector health" }],
      state: "ready",
      summary: `All ${input.connectors.length} live connector probes are healthy in the current posture.`,
      title: "Connector health is green",
    });
  }

  const commandCenterBlockers: TenantReadinessFinding[] = [];
  const commandCenterWarnings: TenantReadinessFinding[] = [];
  const commandCenterReadySignals: TenantReadinessFinding[] = [];
  const pilotFeedbackBlockers: TenantReadinessFinding[] = [];
  const pilotFeedbackWarnings: TenantReadinessFinding[] = [];
  const pilotFeedbackReadySignals: TenantReadinessFinding[] = [];

  const unresolvedExceptions =
    input.inbox?.items.filter((item) => item.status !== "resolved") ?? [];
  const criticalExceptions = unresolvedExceptions.filter((item) =>
    isCriticalConcern(item.urgency)
  );

  if (!input.inbox) {
    commandCenterBlockers.push({
      action: "Enable live operator data so the command center can confirm whether unresolved cutover exceptions remain.",
      category: "command_center",
      id: "command-center-unavailable",
      links: [{ href: "/command-center", label: "Open command center" }],
      state: "blocked",
      summary:
        "The shared exception inbox is unavailable until live operator data is enabled, so cutover blockers cannot be verified honestly.",
      title: "Command center follow-through is unavailable",
    });
  } else if (criticalExceptions.length > 0) {
    commandCenterBlockers.push({
      action: "Clear or explicitly resolve the critical/high exception backlog from the command center before promotion.",
      category: "command_center",
      id: "command-center-critical",
      links: [{ href: "/command-center", label: "Open command center" }],
      state: "blocked",
      summary: `${criticalExceptions.length} critical/high exception item${
        criticalExceptions.length === 1 ? "" : "s"
      } remain unresolved across escalations or reconciliation gaps.`,
      title: "Critical command-center concerns remain",
    });
  } else if (unresolvedExceptions.length > 0) {
    commandCenterWarnings.push({
      action: "Review the remaining medium/low exception backlog and decide whether it is acceptable for this cutover window.",
      category: "command_center",
      id: "command-center-warning",
      links: [{ href: "/command-center", label: "Open command center" }],
      state: "warning",
      summary: `${unresolvedExceptions.length} unresolved exception item${
        unresolvedExceptions.length === 1 ? "" : "s"
      } still need operator follow-through.`,
      title: "Exception inbox still has open items",
    });
  } else {
    commandCenterReadySignals.push({
      action: "Keep exception syncs fresh so the readiness surface stays honest.",
      category: "command_center",
      id: "command-center-clear",
      links: [{ href: "/command-center", label: "Open command center" }],
      state: "ready",
      summary: "No unresolved command-center exceptions are blocking this tenant cutover right now.",
      title: "Exception inbox is clear",
    });
  }

  const unresolvedFeedback =
    input.feedback?.items.filter((item) => item.status !== "resolved") ?? [];
  const criticalFeedback = unresolvedFeedback.filter((item) =>
    isCriticalFeedback(item.severity)
  );

  if (!input.feedback) {
    pilotFeedbackBlockers.push({
      action: "Enable live operator data so the pilot feedback ledger can confirm whether unresolved product blockers remain.",
      category: "pilot_feedback",
      id: "pilot-feedback-unavailable",
      links: [{ href: "/pilot-feedback", label: "Open pilot feedback" }],
      state: "blocked",
      summary:
        "The persisted pilot feedback ledger is unavailable until live operator data is enabled, so cutover cannot rely on a real closure loop.",
      title: "Pilot feedback ledger is unavailable",
    });
  } else if (criticalFeedback.length > 0) {
    pilotFeedbackBlockers.push({
      action: "Resolve or downgrade the critical/high pilot feedback items before promoting the tenant.",
      category: "pilot_feedback",
      id: "pilot-feedback-critical",
      links: [{ href: "/pilot-feedback", label: "Open pilot feedback" }],
      state: "blocked",
      summary: `${criticalFeedback.length} critical/high feedback item${
        criticalFeedback.length === 1 ? "" : "s"
      } are still open or in review.`,
      title: "Critical pilot feedback remains open",
    });
  } else if (unresolvedFeedback.length > 0) {
    pilotFeedbackWarnings.push({
      action: "Review the remaining non-critical feedback items and make an explicit acceptance call for this cutover.",
      category: "pilot_feedback",
      id: "pilot-feedback-warning",
      links: [{ href: "/pilot-feedback", label: "Open pilot feedback" }],
      state: "warning",
      summary: `${unresolvedFeedback.length} pilot feedback item${
        unresolvedFeedback.length === 1 ? "" : "s"
      } remain open or in review.`,
      title: "Pilot feedback still has active follow-through",
    });
  } else {
    pilotFeedbackReadySignals.push({
      action: "Keep using the persisted feedback ledger as the durable closure loop for future pilot changes.",
      category: "pilot_feedback",
      id: "pilot-feedback-clear",
      links: [{ href: "/pilot-feedback", label: "Open pilot feedback" }],
      state: "ready",
      summary: "No active pilot feedback items are blocking this tenant cutover right now.",
      title: "Pilot feedback loop is clear",
    });
  }

  const blockers = [
    ...runtimeBlockers,
    ...rolloutBlockers,
    ...connectorBlockers,
    ...commandCenterBlockers,
    ...pilotFeedbackBlockers,
  ];
  const warnings = [
    ...rolloutWarnings,
    ...connectorWarnings,
    ...commandCenterWarnings,
    ...pilotFeedbackWarnings,
  ];
  const readySignals = [
    ...runtimeReadySignals,
    ...rolloutReadySignals,
    ...connectorReadySignals,
    ...commandCenterReadySignals,
    ...pilotFeedbackReadySignals,
  ];

  const checklist = buildChecklist({
    accessProfile: input.accessProfile,
    blockerCounts: {
      connectors: connectorBlockers.length,
      followThrough:
        commandCenterBlockers.length + pilotFeedbackBlockers.length,
      rollout: rolloutBlockers.length,
      runtime: runtimeBlockers.length,
    },
    connectorSummary,
    pilot: input.pilot,
    tenant,
    unresolvedFeedback,
    unresolvedExceptions,
    warningCounts: {
      connectors: connectorWarnings.length,
      followThrough:
        commandCenterWarnings.length + pilotFeedbackWarnings.length,
      rollout: rolloutWarnings.length,
    },
  });
  const outcome = resolveOutcome(checklist);

  return {
    accessProfile: {
      organizationSlug: input.accessProfile.organizationSlug,
      role: input.accessProfile.role,
      workspaceId: input.accessProfile.workspaceId,
    },
    blockers,
    checklist,
    connectorSummary,
    connectors: input.connectors,
    generatedAt: input.generatedAt,
    outcome,
    outcomeLabel: getOutcomeLabel(outcome),
    pilotFeedback: summarizeFeedback(input.feedback),
    posture: {
      blockedWorkflows: input.pilot.blockedWorkflows.map((workflow) => ({
        id: workflow,
        label: getPilotWorkflowLabel(workflow),
      })),
      configured: input.pilot.configured,
      liveMutationAllowed: input.pilot.liveMutationAllowed,
      runtimeStatus: input.pilot.runtimeStatus,
      stage: input.pilot.stage,
      stageLabel: getPilotStageLabel(input.pilot.stage),
      tenantSlug: input.pilot.tenantSlug,
      writeWorkspaces: input.pilot.allowedWriteWorkspaces,
    },
    readySignals,
    runtime: input.runtime,
    summary: {
      blockers: blockers.length,
      connectorsConfigured: connectorSummary.configured,
      connectorsDegraded: connectorSummary.degraded,
      connectorsOk: connectorSummary.ok,
      connectorsPending: connectorSummary.pending,
      readySignals: readySignals.length,
      unresolvedExceptions: unresolvedExceptions.length,
      unresolvedFeedback: unresolvedFeedback.length,
      warnings: warnings.length,
    },
    tenant,
    unresolvedConcerns: summarizeInbox(input.inbox),
    warnings,
  };
}

function buildChecklist(input: {
  accessProfile: AccessProfile;
  blockerCounts: {
    connectors: number;
    followThrough: number;
    rollout: number;
    runtime: number;
  };
  connectorSummary: ReturnType<typeof summarizeConnectorStatuses>;
  pilot: PilotControlState;
  tenant: TenantReadinessTenantView;
  unresolvedFeedback: PilotFeedbackItemView[];
  unresolvedExceptions: ExceptionInboxResult["items"];
  warningCounts: {
    connectors: number;
    followThrough: number;
    rollout: number;
  };
}): TenantReadinessChecklistItem[] {
  return [
    {
      id: "runtime",
      label: "Runtime truth",
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state: input.blockerCounts.runtime > 0 ? "blocked" : "ready",
      summary:
        input.blockerCounts.runtime > 0
          ? "Live portfolio facts are not available yet for honest tenant promotion."
          : "Live database-backed portfolio facts are active.",
      value: input.pilot.runtimeStatus === "live" ? "Live database" : "Demo or degraded",
    },
    {
      id: "rollout",
      label: "Rollout posture",
      links: [{ href: "/pilot-controls", label: "Open pilot controls" }],
      state:
        input.blockerCounts.rollout > 0
          ? "blocked"
          : input.warningCounts.rollout > 0
            ? "warning"
            : "ready",
      summary:
        input.blockerCounts.rollout > 0
          ? "Tenant boundary or pilot stage still blocks broader live cutover."
          : input.warningCounts.rollout > 0
            ? "Tenant is live, but rollout remains explicitly guarded."
            : "Tenant boundary and pilot posture are explicit for promotion.",
      value: `${getPilotStageLabel(input.pilot.stage)} · ${input.pilot.tenantSlug ?? input.tenant.slug}`,
    },
    {
      id: "connectors",
      label: "Connector readiness",
      links: [{ href: "/integrations", label: "Open connector health" }],
      state:
        input.blockerCounts.connectors > 0
          ? "blocked"
          : input.warningCounts.connectors > 0
            ? "warning"
            : "ready",
      summary:
        input.blockerCounts.connectors > 0
          ? "One or more truth or delivery connectors still block promotion."
          : input.warningCounts.connectors > 0
            ? "Connector warnings remain, mostly around incomplete optional channels."
            : "Live connector probes are healthy for the current posture.",
      value: `${input.connectorSummary.ok} ok · ${input.connectorSummary.pending} pending · ${input.connectorSummary.degraded} degraded`,
    },
    {
      id: "follow-through",
      label: "Operator follow-through",
      links: [
        { href: "/command-center", label: "Open command center" },
        { href: "/pilot-feedback", label: "Open pilot feedback" },
      ],
      state:
        input.blockerCounts.followThrough > 0
          ? "blocked"
          : input.warningCounts.followThrough > 0
            ? "warning"
            : "ready",
      summary:
        input.blockerCounts.followThrough > 0
          ? "Critical rollout concerns or unavailable operator data still block promotion."
          : input.warningCounts.followThrough > 0
            ? "Non-critical command-center or feedback follow-through still needs an explicit acceptance call."
            : "Exception backlog and pilot feedback are clear for this tenant.",
      value: `${input.unresolvedExceptions.length} exceptions · ${input.unresolvedFeedback.length} feedback items`,
    },
  ];
}

function resolveOutcome(
  checklist: TenantReadinessChecklistItem[]
): TenantReadinessOutcome {
  if (checklist.some((item) => item.state === "blocked")) {
    return "blocked";
  }

  if (checklist.find((item) => item.id === "rollout")?.state === "warning") {
    return "guarded";
  }

  if (checklist.some((item) => item.state === "warning")) {
    return "ready_with_warnings";
  }

  return "ready";
}

function resolveTenant(
  accessProfile: AccessProfile,
  pilot: PilotControlState
): TenantReadinessTenantView {
  if (pilot.tenantSlug) {
    return {
      label: "Configured pilot tenant",
      slug: pilot.tenantSlug,
      source: "pilot_control",
    };
  }

  if (accessProfile.organizationSlug.trim()) {
    return {
      label: "Current operator tenant",
      slug: accessProfile.organizationSlug,
      source: "access_profile",
    };
  }

  return {
    label: "Default tenant",
    slug: "ceoclaw-demo",
    source: "default",
  };
}

function summarizeInbox(inbox: ExceptionInboxResult | null) {
  if (!inbox) {
    return {
      acknowledged: 0,
      critical: 0,
      high: 0,
      open: 0,
      resolved: 0,
      total: 0,
    };
  }

  return {
    acknowledged: inbox.summary.acknowledged,
    critical: inbox.summary.critical,
    high: inbox.summary.high,
    open: inbox.summary.open,
    resolved: inbox.summary.resolved,
    total: inbox.summary.total,
  };
}

function summarizeFeedback(feedback: PilotFeedbackListResult | null) {
  if (!feedback) {
    return {
      critical: 0,
      high: 0,
      inReview: 0,
      open: 0,
      resolved: 0,
      total: 0,
    };
  }

  return {
    critical: feedback.summary.critical,
    high: feedback.summary.high,
    inReview: feedback.summary.inReview,
    open: feedback.summary.open,
    resolved: feedback.summary.resolved,
    total: feedback.summary.total,
  };
}

function getOutcomeLabel(outcome: TenantReadinessOutcome) {
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

function connectorLinks(id: string): TenantReadinessLinkView[] {
  if (id === "email" || id === "telegram") {
    return [
      { href: "/integrations", label: "Open connector health" },
      { href: "/briefs", label: "Open executive briefs" },
    ];
  }

  return [{ href: "/integrations", label: "Open connector health" }];
}
