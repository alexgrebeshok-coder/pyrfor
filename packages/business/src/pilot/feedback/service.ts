import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

import type {
  CreatePilotFeedbackInput,
  PilotFeedbackItemView,
  PilotFeedbackListResult,
  PilotFeedbackOwnerView,
  PilotFeedbackQuery,
  PilotFeedbackSeverity,
  PilotFeedbackStatus,
  PilotFeedbackSummary,
  PilotFeedbackTargetType,
  UpdatePilotFeedbackInput,
} from "./types";

interface StoredPilotFeedback {
  id: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  sourceLabel: string;
  sourceHref: string | null;
  projectId: string | null;
  projectName: string | null;
  severity: string;
  status: string;
  summary: string;
  details: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerRole: string | null;
  reporterName: string | null;
  resolutionNote: string | null;
  metadataJson: string | null;
  openedAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MemberLookupResult {
  id: string;
  name: string;
  role: string | null;
}

interface PilotFeedbackWriteShape {
  id: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  sourceLabel: string;
  sourceHref: string | null;
  projectId: string | null;
  projectName: string | null;
  severity: string;
  status: string;
  summary: string;
  details: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerRole: string | null;
  reporterName: string | null;
  resolutionNote: string | null;
  metadataJson: string | null;
  openedAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date;
}

export interface PilotFeedbackStore {
  create(args: { data: { id: string } & PilotFeedbackWriteShape }): Promise<StoredPilotFeedback>;
  findMany(args: {
    includeResolved: boolean;
    limit: number;
    projectId?: string;
    status?: string;
    targetId?: string;
    targetType?: string;
  }): Promise<StoredPilotFeedback[]>;
  findUnique(args: { id: string }): Promise<StoredPilotFeedback | null>;
  update(args: {
    id: string;
    data: Partial<PilotFeedbackWriteShape>;
  }): Promise<StoredPilotFeedback>;
}

interface PilotFeedbackServiceDeps {
  lookupMember?: (memberId: string) => Promise<MemberLookupResult | null>;
  now?: () => Date;
  store?: PilotFeedbackStore;
}

const defaultStore: PilotFeedbackStore = {
  create(args) {
    return prisma.pilotFeedback.create(args);
  },
  async findMany(args) {
    return prisma.pilotFeedback.findMany({
      where: {
        ...(args.includeResolved ? {} : { status: { not: "resolved" } }),
        ...(args.projectId ? { projectId: args.projectId } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(args.targetId ? { targetId: args.targetId } : {}),
        ...(args.targetType ? { targetType: args.targetType } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: args.limit,
    });
  },
  findUnique(args) {
    return prisma.pilotFeedback.findUnique({
      where: { id: args.id },
    });
  },
  update(args) {
    return prisma.pilotFeedback.update({
      where: { id: args.id },
      data: args.data,
    });
  },
};

const defaultMemberLookup = async (memberId: string): Promise<MemberLookupResult | null> => {
  const member = await prisma.teamMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      name: true,
      role: true,
    },
  });

  if (!member) {
    return null;
  }

  return member;
};

export async function listPilotFeedback(
  query: PilotFeedbackQuery = {},
  deps: Pick<PilotFeedbackServiceDeps, "store"> = {}
): Promise<PilotFeedbackListResult> {
  const store = deps.store ?? defaultStore;
  const rows = await store.findMany({
    includeResolved: query.includeResolved ?? false,
    limit: sanitizeLimit(query.limit, 24, 48),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.targetId ? { targetId: query.targetId } : {}),
    ...(query.targetType ? { targetType: query.targetType } : {}),
  });

  const items = rows.map(serializePilotFeedback).sort(comparePilotFeedback);
  return {
    items,
    summary: summarizePilotFeedback(items),
  };
}

export async function createPilotFeedback(
  input: CreatePilotFeedbackInput,
  deps: PilotFeedbackServiceDeps = {}
): Promise<PilotFeedbackItemView> {
  const now = deps.now ?? (() => new Date());
  const store = deps.store ?? defaultStore;
  const owner = input.ownerId ? await resolveOwner(input.ownerId, deps.lookupMember) : null;
  const row = await store.create({
    data: {
      id: randomUUID(),
      targetType: input.targetType,
      targetId: input.targetId.trim(),
      targetLabel: input.targetLabel.trim(),
      sourceLabel: normalizeOptionalString(input.sourceLabel) ?? getDefaultSourceLabel(input.targetType),
      sourceHref: normalizeOptionalString(input.sourceHref),
      projectId: normalizeOptionalString(input.projectId),
      projectName: normalizeOptionalString(input.projectName),
      severity: input.severity ?? "medium",
      status: "open",
      summary: input.summary.trim(),
      details: normalizeOptionalString(input.details),
      ownerId: owner?.id ?? null,
      ownerName: owner?.name ?? null,
      ownerRole: owner?.role ?? null,
      reporterName: normalizeOptionalString(input.reporterName) ?? "Operator",
      resolutionNote: null,
      metadataJson: stringifyMetadata(input.metadata ?? {}),
      openedAt: now(),
      resolvedAt: null,
      updatedAt: now(),
    },
  });

  return serializePilotFeedback(row);
}

export async function updatePilotFeedback(
  id: string,
  input: UpdatePilotFeedbackInput,
  deps: PilotFeedbackServiceDeps = {}
): Promise<PilotFeedbackItemView | null> {
  const now = deps.now ?? (() => new Date());
  const store = deps.store ?? defaultStore;
  const current = await store.findUnique({ id });
  if (!current) {
    return null;
  }

  const hasOwnerId = Object.prototype.hasOwnProperty.call(input, "ownerId");
  const owner = hasOwnerId
    ? input.ownerId
      ? await resolveOwner(input.ownerId, deps.lookupMember)
      : null
    : undefined;

  const nextStatus = input.status ?? (current.status as PilotFeedbackStatus);
  const row = await store.update({
    id,
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.severity ? { severity: input.severity } : {}),
      ...(input.summary !== undefined ? { summary: input.summary.trim() } : {}),
      ...(input.details !== undefined
        ? { details: normalizeOptionalString(input.details) }
        : {}),
      ...(input.resolutionNote !== undefined
        ? { resolutionNote: normalizeOptionalString(input.resolutionNote) }
        : {}),
      ...(hasOwnerId
        ? {
            ownerId: owner?.id ?? null,
            ownerName: owner?.name ?? null,
            ownerRole: owner?.role ?? null,
          }
        : {}),
      resolvedAt: nextStatus === "resolved" ? now() : null,
    },
  });

  return serializePilotFeedback(row);
}

async function resolveOwner(
  ownerId: string,
  lookupMember = defaultMemberLookup
): Promise<MemberLookupResult | null> {
  const owner = await lookupMember(ownerId);
  if (!owner) {
    throw new Error(`Pilot feedback owner ${ownerId} was not found.`);
  }

  return owner;
}

function serializePilotFeedback(row: StoredPilotFeedback): PilotFeedbackItemView {
  const owner = buildOwnerView(row);
  const targetType = row.targetType as PilotFeedbackTargetType;
  const sourceHref = normalizeOptionalString(row.sourceHref);
  const links = compactLinks([
    sourceHref ? { href: sourceHref, label: row.sourceLabel } : null,
    !sourceHref ? getFallbackTargetLink(targetType, row.targetId) : null,
    row.projectId ? { href: `/projects/${row.projectId}`, label: "Open project" } : null,
  ]);

  return {
    id: row.id,
    targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    sourceLabel: row.sourceLabel,
    sourceHref,
    projectId: row.projectId,
    projectName: row.projectName,
    severity: row.severity as PilotFeedbackSeverity,
    status: row.status as PilotFeedbackStatus,
    summary: row.summary,
    details: row.details,
    reporterName: row.reporterName,
    resolutionNote: row.resolutionNote,
    owner,
    metadata: parseMetadata(row.metadataJson),
    openedAt: row.openedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    links,
  };
}

function buildOwnerView(row: StoredPilotFeedback): PilotFeedbackOwnerView {
  if (row.ownerId && row.ownerName) {
    return {
      id: row.ownerId,
      mode: "assigned",
      name: row.ownerName,
      role: row.ownerRole,
    };
  }

  return {
    id: null,
    mode: "unassigned",
    name: "Unassigned",
    role: null,
  };
}

function summarizePilotFeedback(items: PilotFeedbackItemView[]): PilotFeedbackSummary {
  return {
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
    reconciliationTargets: items.filter((item) => item.targetType === "reconciliation_casefile").length,
  };
}

function comparePilotFeedback(left: PilotFeedbackItemView, right: PilotFeedbackItemView) {
  const statusDiff = getStatusRank(left.status) - getStatusRank(right.status);
  if (statusDiff !== 0) {
    return statusDiff;
  }

  const severityDiff = getSeverityRank(left.severity) - getSeverityRank(right.severity);
  if (severityDiff !== 0) {
    return severityDiff;
  }

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function getStatusRank(status: PilotFeedbackStatus) {
  switch (status) {
    case "open":
      return 0;
    case "in_review":
      return 1;
    case "resolved":
    default:
      return 2;
  }
}

function getSeverityRank(severity: PilotFeedbackSeverity) {
  switch (severity) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
    default:
      return 3;
  }
}

function getDefaultSourceLabel(targetType: PilotFeedbackTargetType) {
  switch (targetType) {
    case "workflow_run":
      return "Audit pack workflow";
    case "reconciliation_casefile":
      return "Reconciliation source";
    case "exception_item":
    default:
      return "Command center exception";
  }
}

function getFallbackTargetLink(
  targetType: PilotFeedbackTargetType,
  targetId: string
): { href: string; label: string } {
  switch (targetType) {
    case "workflow_run":
      return { href: `/audit-packs?runId=${targetId}`, label: "Open audit pack" };
    case "reconciliation_casefile":
      return { href: "/command-center", label: "Open command center" };
    case "exception_item":
    default:
      return { href: "/command-center", label: "Open command center" };
  }
}

function compactLinks<T>(links: Array<T | null | undefined>): T[] {
  return links.filter((link): link is T => Boolean(link));
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringifyMetadata(value: Record<string, unknown>) {
  return JSON.stringify(value);
}

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeLimit(value: number | undefined, fallback: number, maximum: number) {
  if (!value || Number.isNaN(value) || value < 1) {
    return fallback;
  }

  return Math.min(Math.round(value), maximum);
}
