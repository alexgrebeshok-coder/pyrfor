import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

import { buildScheduledBriefDeliveryIdempotencyKey } from "./delivery-ledger";
import { deliverBriefToTelegram, type TelegramBriefDeliveryRequest } from "./telegram-delivery";
import { resolveBriefLocale, type BriefLocale } from "./locale";

export type TelegramDeliveryScope = "portfolio" | "project";
export type TelegramDeliveryCadence = "daily" | "weekdays";

export interface TelegramBriefDeliveryPolicyRecord {
  id: string;
  workspaceId: string;
  scope: TelegramDeliveryScope;
  projectId: string | null;
  projectName: string | null;
  locale: BriefLocale;
  chatId: string | null;
  cadence: TelegramDeliveryCadence;
  timezone: string;
  deliveryHour: number;
  active: boolean;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  lastAttemptAt: string | null;
  lastDeliveredAt: string | null;
  lastMessageId: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTelegramBriefDeliveryPolicyInput {
  workspaceId?: string;
  scope: TelegramDeliveryScope;
  projectId?: string | null;
  locale?: BriefLocale;
  chatId?: string | null;
  cadence?: TelegramDeliveryCadence;
  timezone: string;
  deliveryHour: number;
  active?: boolean;
  createdByUserId?: string | null;
}

export interface UpdateTelegramBriefDeliveryPolicyInput {
  scope?: TelegramDeliveryScope;
  projectId?: string | null;
  locale?: BriefLocale;
  chatId?: string | null;
  cadence?: TelegramDeliveryCadence;
  timezone?: string;
  deliveryHour?: number;
  active?: boolean;
  updatedByUserId?: string | null;
}

export interface TelegramPolicyExecutionCandidate {
  id: string;
  scope: TelegramDeliveryScope;
  projectId: string | null;
  locale: BriefLocale;
  chatId: string | null;
  cadence: TelegramDeliveryCadence;
  timezone: string;
  deliveryHour: number;
  active: boolean;
  lastAttemptAt?: string | Date | null;
  lastDeliveredAt?: string | Date | null;
  lastError?: string | null;
}

export interface TelegramPolicyExecutionResult {
  policyId: string;
  scope: TelegramDeliveryScope;
  projectId: string | null;
  delivered: boolean;
  skipped: boolean;
  reason: "inactive" | "not_due" | "delivered" | "failed";
  messageId?: number;
  error?: string;
}

export interface TelegramPolicyExecutionSummary {
  checkedPolicies: number;
  duePolicies: number;
  deliveredPolicies: number;
  failedPolicies: number;
  skippedPolicies: number;
  timestamp: string;
  results: TelegramPolicyExecutionResult[];
}

const policyInclude = {
  project: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

export function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function shouldAttemptTelegramPolicy(
  policy: TelegramPolicyExecutionCandidate,
  referenceDate: Date = new Date()
): boolean {
  if (!policy.active) {
    return false;
  }

  const currentWindow = getPolicyWindowKey(referenceDate, policy.timezone);
  if (currentWindow.hour !== policy.deliveryHour) {
    return false;
  }

  if (policy.cadence === "weekdays" && (currentWindow.weekday === 0 || currentWindow.weekday === 6)) {
    return false;
  }

  if (!policy.lastAttemptAt) {
    return true;
  }

  const attemptedAt =
    policy.lastAttemptAt instanceof Date
      ? policy.lastAttemptAt
      : new Date(policy.lastAttemptAt);

  if (Number.isNaN(attemptedAt.getTime())) {
    return true;
  }

  const attemptedWindow = getPolicyWindowKey(attemptedAt, policy.timezone).windowKey;
  if (attemptedWindow !== currentWindow.windowKey) {
    return true;
  }

  if (policy.lastDeliveredAt) {
    const deliveredAt =
      policy.lastDeliveredAt instanceof Date
        ? policy.lastDeliveredAt
        : new Date(policy.lastDeliveredAt);

    if (
      !Number.isNaN(deliveredAt.getTime()) &&
      getPolicyWindowKey(deliveredAt, policy.timezone).windowKey === currentWindow.windowKey
    ) {
      return false;
    }
  }

  return Boolean(policy.lastError);
}

export async function executeTelegramPolicyRun(
  policies: TelegramPolicyExecutionCandidate[],
  deps: {
    now?: Date;
    deliver?: (request: TelegramBriefDeliveryRequest) => Promise<{ messageId?: number }>;
    persistResult?: (input: {
      policyId: string;
      attemptedAt: Date;
      deliveredAt?: Date | null;
      messageId?: number | null;
      error?: string | null;
    }) => Promise<void>;
  } = {}
): Promise<TelegramPolicyExecutionSummary> {
  const now = deps.now ?? new Date();
  const deliver =
    deps.deliver ??
    (async (request: TelegramBriefDeliveryRequest) => {
      const result = await deliverBriefToTelegram(request);
      return {
        messageId: result.messageId,
      };
    });

  const results: TelegramPolicyExecutionResult[] = [];
  let duePolicies = 0;
  let deliveredPolicies = 0;
  let failedPolicies = 0;
  let skippedPolicies = 0;

  for (const policy of policies) {
    if (!policy.active) {
      skippedPolicies += 1;
      results.push({
        policyId: policy.id,
        scope: policy.scope,
        projectId: policy.projectId,
        delivered: false,
        skipped: true,
        reason: "inactive",
      });
      continue;
    }

    try {
      if (!shouldAttemptTelegramPolicy(policy, now)) {
        skippedPolicies += 1;
        results.push({
          policyId: policy.id,
          scope: policy.scope,
          projectId: policy.projectId,
          delivered: false,
          skipped: true,
          reason: "not_due",
        });
        continue;
      }

      duePolicies += 1;

      const deliveryResult = await deliver({
        scope: policy.scope,
        projectId: policy.projectId ?? undefined,
        locale: policy.locale,
        chatId: policy.chatId,
        idempotencyKey: buildScheduledBriefDeliveryIdempotencyKey({
          channel: "telegram",
          policyId: policy.id,
          windowKey: getPolicyWindowKey(now, policy.timezone).windowKey,
        }),
        scheduledPolicyId: policy.id,
      });

      deliveredPolicies += 1;
      results.push({
        policyId: policy.id,
        scope: policy.scope,
        projectId: policy.projectId,
        delivered: true,
        skipped: false,
        reason: "delivered",
        messageId: deliveryResult.messageId,
      });

      await deps.persistResult?.({
        policyId: policy.id,
        attemptedAt: now,
        deliveredAt: now,
        messageId: deliveryResult.messageId ?? null,
        error: null,
      });
    } catch (error) {
      failedPolicies += 1;
      results.push({
        policyId: policy.id,
        scope: policy.scope,
        projectId: policy.projectId,
        delivered: false,
        skipped: false,
        reason: "failed",
        error: error instanceof Error ? error.message : "Scheduled delivery failed.",
      });

      await deps.persistResult?.({
        policyId: policy.id,
        attemptedAt: now,
        deliveredAt: null,
        error: error instanceof Error ? error.message : "Scheduled delivery failed.",
      });
    }
  }

  return {
    checkedPolicies: policies.length,
    duePolicies,
    deliveredPolicies,
    failedPolicies,
    skippedPolicies,
    timestamp: now.toISOString(),
    results,
  };
}

export async function listTelegramBriefDeliveryPolicies() {
  const policies = await prisma.telegramBriefDeliveryPolicy.findMany({
    include: policyInclude,
    orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
  });

  return policies.map(serializeTelegramBriefDeliveryPolicy);
}

export async function createTelegramBriefDeliveryPolicy(
  input: CreateTelegramBriefDeliveryPolicyInput
) {
  const scope = input.scope;
  const projectId =
    scope === "project" ? normalizeOptionalString(input.projectId) : null;

  if (scope === "project" && !projectId) {
    throw new Error("projectId is required for project delivery policies.");
  }

  if (projectId) {
    await ensureProjectExists(projectId);
  }

  const created = await prisma.telegramBriefDeliveryPolicy.create({
    data: {
      id: randomUUID(),
      workspaceId: input.workspaceId ?? "executive",
      scope,
      projectId,
      locale: resolveBriefLocale(input.locale),
      chatId: normalizeOptionalString(input.chatId),
      cadence: input.cadence ?? "daily",
      timezone: input.timezone,
      deliveryHour: input.deliveryHour,
      active: input.active ?? true,
      createdByUserId: normalizeOptionalString(input.createdByUserId),
      updatedByUserId: normalizeOptionalString(input.createdByUserId),
      updatedAt: new Date(),
    },
    include: policyInclude,
  });

  return serializeTelegramBriefDeliveryPolicy(created);
}

export async function updateTelegramBriefDeliveryPolicy(
  id: string,
  input: UpdateTelegramBriefDeliveryPolicyInput
) {
  const existing = await prisma.telegramBriefDeliveryPolicy.findUnique({
    where: { id },
    select: {
      id: true,
      scope: true,
      projectId: true,
    },
  });

  if (!existing) {
    throw new Error("Telegram brief delivery policy not found.");
  }

  const nextScope = input.scope ?? (existing.scope as TelegramDeliveryScope);
  const nextProjectId =
    nextScope === "project"
      ? normalizeOptionalString(input.projectId) ??
        normalizeOptionalString(existing.projectId)
      : null;

  if (nextScope === "project" && !nextProjectId) {
    throw new Error("projectId is required for project delivery policies.");
  }

  if (nextProjectId) {
    await ensureProjectExists(nextProjectId);
  }

  const updated = await prisma.telegramBriefDeliveryPolicy.update({
    where: { id },
    data: {
      ...(input.scope !== undefined && { scope: input.scope }),
      ...(input.projectId !== undefined || nextScope === "portfolio"
        ? { projectId: nextProjectId }
        : {}),
      ...(input.locale !== undefined && { locale: resolveBriefLocale(input.locale) }),
      ...(input.chatId !== undefined && { chatId: normalizeOptionalString(input.chatId) }),
      ...(input.cadence !== undefined && { cadence: input.cadence }),
      ...(input.timezone !== undefined && { timezone: input.timezone }),
      ...(input.deliveryHour !== undefined && { deliveryHour: input.deliveryHour }),
      ...(input.active !== undefined && { active: input.active }),
      ...(input.updatedByUserId !== undefined && {
        updatedByUserId: normalizeOptionalString(input.updatedByUserId),
      }),
      updatedAt: new Date(),
    },
    include: policyInclude,
  });

  return serializeTelegramBriefDeliveryPolicy(updated);
}

export async function runDueTelegramBriefDeliveryPolicies() {
  const policies = await prisma.telegramBriefDeliveryPolicy.findMany({
    orderBy: [{ active: "desc" }, { updatedAt: "asc" }],
  });

  return executeTelegramPolicyRun(
    policies.map((policy) => ({
      id: policy.id,
      scope: policy.scope as TelegramDeliveryScope,
      projectId: policy.projectId,
      locale: resolveBriefLocale(policy.locale),
      chatId: policy.chatId,
      cadence: policy.cadence as TelegramDeliveryCadence,
      timezone: policy.timezone,
      deliveryHour: policy.deliveryHour,
      active: policy.active,
      lastAttemptAt: policy.lastAttemptAt,
      lastDeliveredAt: policy.lastDeliveredAt,
      lastError: policy.lastError,
    })),
    {
      persistResult: async (input) => {
        await prisma.telegramBriefDeliveryPolicy.update({
          where: { id: input.policyId },
          data: {
            lastAttemptAt: input.attemptedAt,
            ...(input.deliveredAt ? { lastDeliveredAt: input.deliveredAt } : {}),
            ...(input.messageId !== undefined && input.messageId !== null
              ? { lastMessageId: input.messageId }
              : {}),
            lastError: input.error ?? null,
            updatedByUserId: "system:scheduled-digests",
          },
        });
      },
    }
  );
}

function serializeTelegramBriefDeliveryPolicy(
  policy: {
    id: string;
    workspaceId: string;
    scope: string;
    projectId: string | null;
    locale: string;
    chatId: string | null;
    cadence: string;
    timezone: string;
    deliveryHour: number;
    active: boolean;
    createdByUserId: string | null;
    updatedByUserId: string | null;
    lastAttemptAt: Date | null;
    lastDeliveredAt: Date | null;
    lastMessageId: number | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
    project?: { id: string; name: string } | null;
  }
): TelegramBriefDeliveryPolicyRecord {
  return {
    id: policy.id,
    workspaceId: policy.workspaceId,
    scope: policy.scope as TelegramDeliveryScope,
    projectId: policy.projectId,
    projectName: policy.project?.name ?? null,
    locale: resolveBriefLocale(policy.locale),
    chatId: policy.chatId,
    cadence: policy.cadence as TelegramDeliveryCadence,
    timezone: policy.timezone,
    deliveryHour: policy.deliveryHour,
    active: policy.active,
    createdByUserId: policy.createdByUserId,
    updatedByUserId: policy.updatedByUserId,
    lastAttemptAt: policy.lastAttemptAt?.toISOString() ?? null,
    lastDeliveredAt: policy.lastDeliveredAt?.toISOString() ?? null,
    lastMessageId: policy.lastMessageId,
    lastError: policy.lastError,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString(),
  };
}

function getPolicyWindowKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);

  const year = partValue(parts, "year");
  const month = partValue(parts, "month");
  const day = partValue(parts, "day");
  const hour = Number(partValue(parts, "hour"));
  const weekday = normalizeWeekday(partValue(parts, "weekday"));

  return {
    hour,
    weekday,
    windowKey: `${year}-${month}-${day}T${String(hour).padStart(2, "0")}`,
  };
}

function partValue(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPart["type"]
) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function normalizeWeekday(value: string) {
  switch (value) {
    case "Sun":
      return 0;
    case "Mon":
      return 1;
    case "Tue":
      return 2;
    case "Wed":
      return 3;
    case "Thu":
      return 4;
    case "Fri":
      return 5;
    case "Sat":
      return 6;
    default:
      return -1;
  }
}

async function ensureProjectExists(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });

  if (!project) {
    throw new Error("Project not found for Telegram brief delivery policy.");
  }
}

function normalizeOptionalString(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
