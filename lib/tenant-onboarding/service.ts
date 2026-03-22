import { buildAccessProfile, type AccessProfile } from "@/lib/auth/access-profile";
import {
  listCutoverDecisionRegister,
  type CutoverDecisionRecord,
  type CutoverDecisionRegister,
} from "@/lib/cutover-decisions";
import { prisma } from "@/lib/prisma";
import { getPilotReviewScorecard, type PilotReviewScorecard } from "@/lib/pilot-review";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { getTenantReadiness, type TenantReadinessReport } from "@/lib/tenant-readiness";
import { randomUUID } from "node:crypto";

import type {
  CreateTenantOnboardingRunbookInput,
  TenantOnboardingCurrentReadinessView,
  TenantOnboardingCurrentReviewView,
  TenantOnboardingOverview,
  TenantOnboardingRunbookListResult,
  TenantOnboardingRunbookRecord,
  TenantOnboardingRunbookStatus,
  TenantOnboardingTemplateItem,
  UpdateTenantOnboardingRunbookInput,
} from "./types";

export const TENANT_ONBOARDING_TEMPLATE_VERSION = "tenant-rollout-v1";

interface StoredTenantOnboardingRunbook {
  baselineTenantLabel: string;
  baselineTenantSlug: string;
  blockerCount: number;
  createdAt: Date;
  createdByName: string | null;
  createdByRole: string | null;
  createdByUserId: string | null;
  handoffNotes: string | null;
  id: string;
  latestDecisionAt: Date | null;
  latestDecisionLabel: string | null;
  latestDecisionSummary: string | null;
  latestDecisionType: string | null;
  operatorNotes: string | null;
  readinessGeneratedAt: Date;
  readinessOutcome: string;
  readinessOutcomeLabel: string;
  reviewGeneratedAt: Date;
  reviewOutcome: string;
  reviewOutcomeLabel: string;
  rollbackPlan: string | null;
  rolloutScope: string;
  status: string;
  summary: string;
  targetCutoverAt: Date | null;
  targetTenantLabel: string | null;
  targetTenantSlug: string | null;
  templateVersion: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  warningCount: number;
  workspaceId: string;
}

interface TenantOnboardingRunbookWriteShape {
  baselineTenantLabel: string;
  baselineTenantSlug: string;
  blockerCount: number;
  createdByName: string | null;
  createdByRole: string | null;
  createdByUserId: string | null;
  handoffNotes: string | null;
  latestDecisionAt: Date | null;
  latestDecisionLabel: string | null;
  latestDecisionSummary: string | null;
  latestDecisionType: string | null;
  operatorNotes: string | null;
  readinessGeneratedAt: Date;
  readinessOutcome: string;
  readinessOutcomeLabel: string;
  reviewGeneratedAt: Date;
  reviewOutcome: string;
  reviewOutcomeLabel: string;
  rollbackPlan: string | null;
  rolloutScope: string;
  status: string;
  summary: string;
  targetCutoverAt: Date | null;
  targetTenantLabel: string | null;
  targetTenantSlug: string | null;
  templateVersion: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  warningCount: number;
  workspaceId: string;
}

interface TenantOnboardingRunbookStore {
  create(args: {
    data: { id: string } & TenantOnboardingRunbookWriteShape;
  }): Promise<StoredTenantOnboardingRunbook>;
  findMany(args: { limit: number }): Promise<StoredTenantOnboardingRunbook[]>;
  findUnique(args: { id: string }): Promise<StoredTenantOnboardingRunbook | null>;
  update(args: {
    data: Partial<TenantOnboardingRunbookWriteShape>;
    id: string;
  }): Promise<StoredTenantOnboardingRunbook>;
}

interface TenantOnboardingServiceDeps {
  accessProfile?: AccessProfile;
  decisionRegister?: CutoverDecisionRegister | null;
  env?: NodeJS.ProcessEnv;
  getDecisionRegister?: (limit?: number) => Promise<CutoverDecisionRegister>;
  getReadiness?: () => Promise<TenantReadinessReport>;
  getReview?: () => Promise<PilotReviewScorecard>;
  includePersistedState?: boolean;
  now?: () => Date;
  readiness?: TenantReadinessReport;
  runbookLimit?: number;
  review?: PilotReviewScorecard;
  store?: TenantOnboardingRunbookStore;
}

const defaultStore: TenantOnboardingRunbookStore = {
  create(args) {
    return prisma.tenantOnboardingRunbook.create(args);
  },
  findMany(args) {
    return prisma.tenantOnboardingRunbook.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: args.limit,
    });
  },
  findUnique(args) {
    return prisma.tenantOnboardingRunbook.findUnique({
      where: { id: args.id },
    });
  },
  update(args) {
    return prisma.tenantOnboardingRunbook.update({
      where: { id: args.id },
      data: args.data,
    });
  },
};

export async function getTenantOnboardingOverview(
  deps: TenantOnboardingServiceDeps = {}
): Promise<TenantOnboardingOverview> {
  const accessProfile = deps.accessProfile ?? buildAccessProfile();
  const env = deps.env ?? process.env;
  const runtime = getServerRuntimeState(env);
  const includePersistedState = deps.includePersistedState ?? runtime.databaseConfigured;
  const runbookLimit = sanitizeLimit(deps.runbookLimit ?? 8, 8, 24);
  const now = deps.now ?? (() => new Date());
  const readiness =
    deps.readiness ??
    (deps.getReadiness
      ? await deps.getReadiness()
      : await getTenantReadiness({
          accessProfile,
          env,
          runtime,
        }));
  const review =
    deps.review ??
    (deps.getReview
      ? await deps.getReview()
      : await getPilotReviewScorecard({
          accessProfile,
          env,
          readiness,
          runtime,
        }));
  const [decisionRegister, runbooks] = await Promise.all([
    includePersistedState
      ? deps.decisionRegister ??
        (deps.getDecisionRegister
          ? deps.getDecisionRegister(6)
          : listCutoverDecisionRegister(6))
      : Promise.resolve(null),
    includePersistedState
      ? listTenantOnboardingRunbooks(runbookLimit, { store: deps.store })
      : Promise.resolve(emptyRunbookList()),
  ]);

  const latestDecision = decisionRegister?.latestDecision ?? null;
  const currentReadiness = projectReadiness(readiness);
  const currentReview = projectReview(review);

  return {
    accessProfile: {
      organizationSlug: accessProfile.organizationSlug,
      role: accessProfile.role,
      workspaceId: accessProfile.workspaceId,
    },
    currentReadiness,
    currentReview,
    generatedAt: now().toISOString(),
    latestDecision,
    latestRunbook: runbooks.latestRunbook,
    persistenceAvailable: includePersistedState,
    runbooks: runbooks.entries,
    summary: runbooks.summary,
    template: {
      intro:
        "Use the current readiness, pilot review, and latest governance decision as the baseline. Persist one narrow rollout runbook so the next tenant widening conversation does not depend on memory alone.",
      items: buildTemplateItems({
        currentReadiness,
        currentReview,
        latestDecision,
        latestRunbook: runbooks.latestRunbook,
      }),
      version: TENANT_ONBOARDING_TEMPLATE_VERSION,
    },
  };
}

export async function listTenantOnboardingRunbooks(
  limit = 8,
  deps: Pick<TenantOnboardingServiceDeps, "store"> = {}
): Promise<TenantOnboardingRunbookListResult> {
  const store = deps.store ?? defaultStore;
  const rows = await store.findMany({
    limit: sanitizeLimit(limit, 8, 24),
  });
  const entries = rows.map(serializeRunbook);

  return {
    entries,
    latestRunbook: entries[0] ?? null,
    summary: {
      completed: entries.filter((entry) => entry.status === "completed").length,
      draft: entries.filter((entry) => entry.status === "draft").length,
      prepared: entries.filter((entry) => entry.status === "prepared").length,
      scheduled: entries.filter((entry) => entry.status === "scheduled").length,
      total: entries.length,
    },
  };
}

export async function createTenantOnboardingRunbook(
  input: CreateTenantOnboardingRunbookInput,
  deps: TenantOnboardingServiceDeps = {}
): Promise<TenantOnboardingRunbookRecord> {
  const accessProfile = deps.accessProfile ?? buildAccessProfile();
  const now = deps.now ?? (() => new Date());
  const context = await resolveSnapshotContext({ ...deps, accessProfile });
  const store = deps.store ?? defaultStore;
  const latestDecision = context.decisionRegister?.latestDecision ?? null;
  const row = await store.create({
    data: {
      id: randomUUID(),
      ...buildRunbookWriteShape({
        accessProfile,
        current: null,
        input,
        latestDecision,
        readiness: context.readiness,
        review: context.review,
      }),
      updatedAt: now(),
    },
  });

  return serializeRunbook(row);
}

export async function updateTenantOnboardingRunbook(
  id: string,
  input: UpdateTenantOnboardingRunbookInput,
  deps: TenantOnboardingServiceDeps = {}
): Promise<TenantOnboardingRunbookRecord | null> {
  const accessProfile = deps.accessProfile ?? buildAccessProfile();
  const now = deps.now ?? (() => new Date());
  const store = deps.store ?? defaultStore;
  const current = await store.findUnique({ id });
  if (!current) {
    return null;
  }

  const context = await resolveSnapshotContext({ ...deps, accessProfile });
  const latestDecision = context.decisionRegister?.latestDecision ?? null;
  const row = await store.update({
    id,
    data: {
      ...buildRunbookWriteShape({
        accessProfile,
        current,
        input,
        latestDecision,
        readiness: context.readiness,
        review: context.review,
      }),
      updatedAt: now(),
    },
  });

  return serializeRunbook(row);
}

export function getTenantOnboardingStatusLabel(status: TenantOnboardingRunbookStatus) {
  switch (status) {
    case "prepared":
      return "Prepared";
    case "scheduled":
      return "Scheduled";
    case "completed":
      return "Completed";
    case "draft":
    default:
      return "Draft";
  }
}

async function resolveSnapshotContext(
  deps: TenantOnboardingServiceDeps & { accessProfile: AccessProfile }
): Promise<{
  decisionRegister: CutoverDecisionRegister | null;
  readiness: TenantReadinessReport;
  review: PilotReviewScorecard;
}> {
  const env = deps.env ?? process.env;
  const runtime = getServerRuntimeState(env);
  const includePersistedState = deps.includePersistedState ?? runtime.databaseConfigured;
  const readiness =
    deps.readiness ??
    (deps.getReadiness
      ? await deps.getReadiness()
      : await getTenantReadiness({
          accessProfile: deps.accessProfile,
          env,
          runtime,
        }));
  const review =
    deps.review ??
    (deps.getReview
      ? await deps.getReview()
      : await getPilotReviewScorecard({
          accessProfile: deps.accessProfile,
          env,
          readiness,
          runtime,
        }));
  const decisionRegister =
    includePersistedState
      ? deps.decisionRegister ??
        (deps.getDecisionRegister
          ? await deps.getDecisionRegister(1)
          : await listCutoverDecisionRegister(1))
      : null;

  return {
    decisionRegister,
    readiness,
    review,
  };
}

function projectReadiness(readiness: TenantReadinessReport): TenantOnboardingCurrentReadinessView {
  return {
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
  };
}

function projectReview(review: PilotReviewScorecard): TenantOnboardingCurrentReviewView {
  return {
    artifact: {
      fileName: review.artifact.fileName,
      format: review.artifact.format,
    },
    generatedAt: review.generatedAt,
    outcome: review.outcome,
    outcomeLabel: review.outcomeLabel,
    summary: {
      blockedSections: review.summary.blockedSections,
      openExceptions: review.summary.openExceptions,
      openFeedback: review.summary.openFeedback,
      warningSections: review.summary.warningSections,
    },
  };
}

function buildTemplateItems(input: {
  currentReadiness: TenantOnboardingCurrentReadinessView;
  currentReview: TenantOnboardingCurrentReviewView;
  latestDecision: CutoverDecisionRecord | null;
  latestRunbook: TenantOnboardingRunbookRecord | null;
}): TenantOnboardingTemplateItem[] {
  const readinessState = toState(input.currentReadiness.outcome);
  const reviewState = toState(input.currentReview.outcome);
  const latestRunbook = input.latestRunbook;
  const latestDecision = input.latestDecision;
  const runbookState =
    !latestRunbook
      ? "warning"
      : latestRunbook.status === "draft"
        ? "warning"
        : "ready";

  return [
    {
      id: "baseline-readiness",
      label: "Baseline tenant readiness",
      links: [{ href: "/tenant-readiness", label: "Open tenant readiness" }],
      state: readinessState,
      summary:
        readinessState === "blocked"
          ? "The current baseline tenant still has explicit blockers. Do not treat this runbook as a promotion-ready template yet."
          : readinessState === "warning"
            ? "The current baseline tenant is usable as a template, but warning posture still needs explicit operator acceptance."
            : "The current baseline tenant is stable enough to reuse as the rollout baseline.",
      value: `${input.currentReadiness.outcomeLabel} · ${input.currentReadiness.tenant.slug}`,
    },
    {
      id: "governance-review",
      label: "Governance review artifact",
      links: [{ href: "/pilot-review", label: "Open pilot review" }],
      state: reviewState,
      summary:
        reviewState === "blocked"
          ? "The current governance scorecard is still blocked by readiness, backlog, freshness, or delivery issues."
          : reviewState === "warning"
            ? "The governance baseline exists, but warnings still need an explicit decision before wider rollout."
            : "The governance baseline is exportable and ready to attach to the next rollout conversation.",
      value: `${input.currentReview.outcomeLabel} · ${input.currentReview.artifact.fileName}`,
    },
    {
      id: "decision-trail",
      label: "Latest cutover decision",
      links: [{ href: "/tenant-readiness", label: "Open decision register" }],
      state: latestDecision ? toDecisionState(latestDecision.decisionType) : "warning",
      summary: latestDecision
        ? `${latestDecision.decisionLabel} captured at ${formatTimestamp(latestDecision.createdAt)}.`
        : "No explicit cutover approval, waiver, or rollback is recorded yet for the current baseline.",
      value: latestDecision
        ? `${latestDecision.decisionLabel} · ${latestDecision.readinessOutcomeLabel} readiness`
        : "No decision recorded",
    },
    {
      id: "runbook-handoff",
      label: "Persisted rollout runbook",
      links: [{ href: "/tenant-onboarding", label: "Open tenant onboarding" }],
      state: runbookState,
      summary:
        !latestRunbook
          ? "Create the first rollout runbook so operator handoff notes, rollback posture, and target tenant context stop living only in memory."
          : latestRunbook.status === "draft"
            ? "The latest runbook exists but is still draft-only. Fill the handoff and rollback sections before scheduling rollout."
            : "A persisted rollout runbook already exists for the current preparation cycle.",
      value: latestRunbook
        ? `${latestRunbook.statusLabel} · ${latestRunbook.targetTenantSlug ?? latestRunbook.targetTenantLabel ?? latestRunbook.baselineTenantSlug}`
        : "Not started",
    },
  ];
}

function buildRunbookWriteShape(input: {
  accessProfile: AccessProfile;
  current: StoredTenantOnboardingRunbook | null;
  input: CreateTenantOnboardingRunbookInput | UpdateTenantOnboardingRunbookInput;
  latestDecision: CutoverDecisionRecord | null;
  readiness: TenantReadinessReport;
  review: PilotReviewScorecard;
}): TenantOnboardingRunbookWriteShape {
  const updatedAt = new Date();
  const targetCutoverAt = parseOptionalDate(
    getInputValue(input.input, "targetCutoverAt", input.current?.targetCutoverAt?.toISOString() ?? null)
  );
  const status = (
    getInputValue(
      input.input,
      "status",
      (input.current?.status as TenantOnboardingRunbookStatus | undefined) ?? "draft"
    ) ?? "draft"
  ) as TenantOnboardingRunbookStatus;
  const targetTenantSlug = normalizeOptionalString(
    getInputValue(input.input, "targetTenantSlug", input.current?.targetTenantSlug ?? null)
  );
  const targetTenantLabel = normalizeOptionalString(
    getInputValue(input.input, "targetTenantLabel", input.current?.targetTenantLabel ?? null)
  );

  return {
    baselineTenantLabel: input.readiness.tenant.label,
    baselineTenantSlug: input.readiness.tenant.slug,
    blockerCount: input.readiness.summary.blockers,
    createdByName: input.current?.createdByName ?? normalizeOptionalString(input.accessProfile.name),
    createdByRole: input.current?.createdByRole ?? input.accessProfile.role,
    createdByUserId: input.current?.createdByUserId ?? normalizeOptionalString(input.accessProfile.userId),
    handoffNotes: normalizeOptionalString(
      getInputValue(input.input, "handoffNotes", input.current?.handoffNotes ?? null)
    ),
    latestDecisionAt: input.latestDecision ? new Date(input.latestDecision.createdAt) : null,
    latestDecisionLabel: input.latestDecision?.decisionLabel ?? null,
    latestDecisionSummary: input.latestDecision?.summary ?? null,
    latestDecisionType: input.latestDecision?.decisionType ?? null,
    operatorNotes: normalizeOptionalString(
      getInputValue(input.input, "operatorNotes", input.current?.operatorNotes ?? null)
    ),
    readinessGeneratedAt: new Date(input.readiness.generatedAt),
    readinessOutcome: input.readiness.outcome,
    readinessOutcomeLabel: input.readiness.outcomeLabel,
    reviewGeneratedAt: new Date(input.review.generatedAt),
    reviewOutcome: input.review.outcome,
    reviewOutcomeLabel: input.review.outcomeLabel,
    rollbackPlan: normalizeOptionalString(
      getInputValue(input.input, "rollbackPlan", input.current?.rollbackPlan ?? null)
    ),
    rolloutScope: getRequiredStringValue(
      getInputValue(input.input, "rolloutScope", input.current?.rolloutScope ?? "")
    ),
    status,
    summary: getRequiredStringValue(getInputValue(input.input, "summary", input.current?.summary ?? "")),
    targetCutoverAt,
    targetTenantLabel,
    targetTenantSlug,
    templateVersion: TENANT_ONBOARDING_TEMPLATE_VERSION,
    updatedAt,
    updatedByUserId: normalizeOptionalString(input.accessProfile.userId),
    warningCount: input.readiness.summary.warnings,
    workspaceId: input.current?.workspaceId ?? input.accessProfile.workspaceId,
  };
}

function serializeRunbook(row: StoredTenantOnboardingRunbook): TenantOnboardingRunbookRecord {
  const status = row.status as TenantOnboardingRunbookStatus;

  return {
    baselineTenantLabel: row.baselineTenantLabel,
    baselineTenantSlug: row.baselineTenantSlug,
    blockerCount: row.blockerCount,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
    createdByRole: row.createdByRole,
    createdByUserId: row.createdByUserId,
    handoffNotes: row.handoffNotes,
    id: row.id,
    latestDecisionAt: row.latestDecisionAt?.toISOString() ?? null,
    latestDecisionLabel: row.latestDecisionLabel,
    latestDecisionSummary: row.latestDecisionSummary,
    latestDecisionType: row.latestDecisionType as CutoverDecisionRecord["decisionType"] | null,
    operatorNotes: row.operatorNotes,
    readinessGeneratedAt: row.readinessGeneratedAt.toISOString(),
    readinessOutcome: row.readinessOutcome as TenantReadinessReport["outcome"],
    readinessOutcomeLabel: row.readinessOutcomeLabel,
    reviewGeneratedAt: row.reviewGeneratedAt.toISOString(),
    reviewOutcome: row.reviewOutcome as PilotReviewScorecard["outcome"],
    reviewOutcomeLabel: row.reviewOutcomeLabel,
    rollbackPlan: row.rollbackPlan,
    rolloutScope: row.rolloutScope,
    status,
    statusLabel: getTenantOnboardingStatusLabel(status),
    summary: row.summary,
    targetCutoverAt: row.targetCutoverAt?.toISOString() ?? null,
    targetTenantLabel: row.targetTenantLabel,
    targetTenantSlug: row.targetTenantSlug,
    templateVersion: row.templateVersion,
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId: row.updatedByUserId,
    warningCount: row.warningCount,
    workspaceId: row.workspaceId,
  };
}

function emptyRunbookList(): TenantOnboardingRunbookListResult {
  return {
    entries: [],
    latestRunbook: null,
    summary: {
      completed: 0,
      draft: 0,
      prepared: 0,
      scheduled: 0,
      total: 0,
    },
  };
}

function toState(
  outcome: TenantReadinessReport["outcome"] | PilotReviewScorecard["outcome"]
): "blocked" | "ready" | "warning" {
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

function toDecisionState(
  decisionType: CutoverDecisionRecord["decisionType"]
): "blocked" | "ready" | "warning" {
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

function normalizeOptionalString(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function getRequiredStringValue(value: string | null | undefined) {
  const normalized = normalizeOptionalString(value);
  return normalized ?? "";
}

function sanitizeLimit(value: number, fallback: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(max, Math.round(value)));
}

function getInputValue<
  Key extends keyof (CreateTenantOnboardingRunbookInput & UpdateTenantOnboardingRunbookInput),
>(
  input: CreateTenantOnboardingRunbookInput | UpdateTenantOnboardingRunbookInput,
  key: Key,
  fallback: (CreateTenantOnboardingRunbookInput & UpdateTenantOnboardingRunbookInput)[Key]
) {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : fallback;
}
