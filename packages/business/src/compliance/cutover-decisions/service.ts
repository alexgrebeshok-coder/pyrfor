import { randomUUID } from "node:crypto";

import { buildAccessProfile } from "@/lib/auth/access-profile";
import { getPilotReviewScorecard, type PilotReviewScorecard } from "@/lib/pilot-review";
import { prisma } from "@/lib/prisma";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { getTenantReadiness, type TenantReadinessReport } from "@/lib/tenant-readiness";

import type {
  CreateCutoverDecisionDeps,
  CreateCutoverDecisionInput,
  CutoverDecisionRecord,
  CutoverDecisionRegister,
  CutoverDecisionType,
} from "./types";

interface StoredCutoverDecision {
  createdAt: Date;
  createdByName: string | null;
  createdByRole: string | null;
  createdByUserId: string | null;
  decisionType: string;
  details: string | null;
  id: string;
  readinessGeneratedAt: Date;
  readinessOutcome: string;
  readinessOutcomeLabel: string;
  reviewGeneratedAt: Date;
  reviewOutcome: string;
  reviewOutcomeLabel: string;
  summary: string;
  tenantSlug: string;
  warningId: string | null;
  warningLabel: string | null;
  workspaceId: string;
}

interface CutoverDecisionStore {
  create(args: {
    data: {
      id: string;
      createdByName: string | null;
      createdByRole: string | null;
      createdByUserId: string | null;
      decisionType: string;
      details: string | null;
      readinessGeneratedAt: Date;
      readinessOutcome: string;
      readinessOutcomeLabel: string;
      reviewGeneratedAt: Date;
      reviewOutcome: string;
      reviewOutcomeLabel: string;
      summary: string;
      tenantSlug: string;
      warningId: string | null;
      warningLabel: string | null;
      workspaceId: string;
      updatedAt: Date;
    };
  }): Promise<StoredCutoverDecision>;
  findMany(args: {
    limit: number;
  }): Promise<StoredCutoverDecision[]>;
}

interface CutoverDecisionServiceDeps extends CreateCutoverDecisionDeps {
  store?: CutoverDecisionStore;
}

const defaultStore: CutoverDecisionStore = {
  create(args) {
    return prisma.cutoverDecision.create(args);
  },
  findMany(args) {
    return prisma.cutoverDecision.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: args.limit,
    });
  },
};

export async function listCutoverDecisionRegister(
  limit = 12,
  deps: Pick<CutoverDecisionServiceDeps, "store"> = {}
): Promise<CutoverDecisionRegister> {
  const store = deps.store ?? defaultStore;
  const rows = await store.findMany({ limit });
  const entries = rows.map(serializeDecision);

  return {
    entries,
    latestDecision: entries[0] ?? null,
    summary: {
      approvals: entries.filter((entry) => entry.decisionType === "cutover_approved").length,
      latestDecisionAt: entries[0]?.createdAt ?? null,
      latestRollbackAt:
        entries.find((entry) => entry.decisionType === "rollback")?.createdAt ?? null,
      latestWaiverAt:
        entries.find((entry) => entry.decisionType === "warning_waiver")?.createdAt ?? null,
      rollbacks: entries.filter((entry) => entry.decisionType === "rollback").length,
      total: entries.length,
      waivers: entries.filter((entry) => entry.decisionType === "warning_waiver").length,
    },
  };
}

export async function createCutoverDecision(
  input: CreateCutoverDecisionInput,
  deps: CutoverDecisionServiceDeps = {}
): Promise<CutoverDecisionRecord> {
  const accessProfile = deps.accessProfile ?? buildAccessProfile();
  const env = deps.env ?? process.env;
  const runtime = getServerRuntimeState(env);
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
  const store = deps.store ?? defaultStore;
  const warningLabel = normalizeOptionalString(input.warningLabel);

  if (input.decisionType === "warning_waiver" && !warningLabel) {
    throw new Error("warningLabel is required for warning waivers.");
  }

  if (
    input.decisionType === "cutover_approved" &&
    (readiness.outcome === "blocked" || review.outcome === "blocked")
  ) {
    throw new Error(
      "Cutover approval is blocked while tenant readiness or pilot review is still blocked."
    );
  }

  const created = await store.create({
    data: {
      id: randomUUID(),
      createdByName: normalizeOptionalString(accessProfile.name),
      createdByRole: accessProfile.role,
      createdByUserId: normalizeOptionalString(accessProfile.userId),
      decisionType: input.decisionType,
      details: normalizeOptionalString(input.details),
      readinessGeneratedAt: new Date(readiness.generatedAt),
      readinessOutcome: readiness.outcome,
      readinessOutcomeLabel: readiness.outcomeLabel,
      reviewGeneratedAt: new Date(review.generatedAt),
      reviewOutcome: review.outcome,
      reviewOutcomeLabel: review.outcomeLabel,
      summary: input.summary.trim(),
      tenantSlug: readiness.tenant.slug,
      warningId: normalizeOptionalString(input.warningId),
      warningLabel,
      workspaceId: accessProfile.workspaceId,
      updatedAt: new Date(),
    },
  });

  return serializeDecision(created);
}

export function getCutoverDecisionLabel(value: CutoverDecisionType) {
  switch (value) {
    case "cutover_approved":
      return "Cutover approved";
    case "warning_waiver":
      return "Warning waiver";
    case "rollback":
    default:
      return "Rollback recorded";
  }
}

function serializeDecision(row: StoredCutoverDecision): CutoverDecisionRecord {
  const decisionType = row.decisionType as CutoverDecisionType;

  return {
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
    createdByRole: row.createdByRole,
    createdByUserId: row.createdByUserId,
    decisionLabel: getCutoverDecisionLabel(decisionType),
    decisionType,
    details: row.details,
    id: row.id,
    readinessGeneratedAt: row.readinessGeneratedAt.toISOString(),
    readinessOutcome: row.readinessOutcome as TenantReadinessReport["outcome"],
    readinessOutcomeLabel: row.readinessOutcomeLabel,
    reviewGeneratedAt: row.reviewGeneratedAt.toISOString(),
    reviewOutcome: row.reviewOutcome as PilotReviewScorecard["outcome"],
    reviewOutcomeLabel: row.reviewOutcomeLabel,
    summary: row.summary,
    tenantSlug: row.tenantSlug,
    warningId: row.warningId,
    warningLabel: row.warningLabel,
    workspaceId: row.workspaceId,
  };
}

function normalizeOptionalString(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
