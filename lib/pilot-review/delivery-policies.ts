import { buildAccessProfile, type AccessProfile } from "@/lib/auth/access-profile";
import { buildScheduledBriefDeliveryIdempotencyKey } from "@/lib/briefs/delivery-ledger";
import { prisma } from "@/lib/prisma";
import { isSupportedTimeZone } from "@/lib/briefs/telegram-delivery-policies";
import { randomUUID } from "node:crypto";

import { deliverPilotReviewByEmail } from "./delivery";
import type {
  CreatePilotReviewDeliveryPolicyInput,
  PilotReviewDeliveryPolicyExecutionResult,
  PilotReviewDeliveryPolicyExecutionSummary,
  PilotReviewDeliveryPolicyRecord,
  UpdatePilotReviewDeliveryPolicyInput,
} from "./types";

interface StoredPilotReviewDeliveryPolicy {
  id: string;
  workspaceId: string;
  channel: string;
  recipient: string | null;
  timezone: string;
  deliveryHour: number;
  deliveryWeekday: number;
  active: boolean;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  lastAttemptAt: Date | null;
  lastDeliveredAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PilotReviewDeliveryPolicyStore {
  create(args: {
    data: {
      id: string;
      active: boolean;
      channel: string;
      createdByUserId: string | null;
      deliveryHour: number;
      deliveryWeekday: number;
      recipient: string | null;
      timezone: string;
      updatedByUserId: string | null;
      updatedAt: Date;
      workspaceId: string;
    };
  }): Promise<StoredPilotReviewDeliveryPolicy>;
  findMany(): Promise<StoredPilotReviewDeliveryPolicy[]>;
  findUnique(args: { id: string }): Promise<StoredPilotReviewDeliveryPolicy | null>;
  update(args: {
    id: string;
    data: Partial<{
      active: boolean;
      deliveryHour: number;
      deliveryWeekday: number;
      lastAttemptAt: Date | null;
      lastDeliveredAt: Date | null;
      lastError: string | null;
      recipient: string | null;
      timezone: string;
      updatedByUserId: string | null;
    }>;
  }): Promise<StoredPilotReviewDeliveryPolicy>;
}

interface ExecutePolicyDeliveryRequest {
  accessProfile: AccessProfile;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  idempotencyKey: string;
  policy: PilotReviewDeliveryPolicyRecord;
}

interface PilotReviewDeliveryPolicyDeps {
  accessProfile?: AccessProfile;
  deliver?: (input: ExecutePolicyDeliveryRequest) => Promise<{
    dryRun: boolean;
    delivered: boolean;
    ledger?: { deliveredAt?: string | null; lastError?: string | null; messageId?: string | null } | null;
    messageId?: string;
  }>;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  store?: PilotReviewDeliveryPolicyStore;
}

const defaultStore: PilotReviewDeliveryPolicyStore = {
  create(args) {
    return prisma.pilotReviewDeliveryPolicy.create(args);
  },
  findMany() {
    return prisma.pilotReviewDeliveryPolicy.findMany({
      orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
    });
  },
  findUnique(args) {
    return prisma.pilotReviewDeliveryPolicy.findUnique({
      where: { id: args.id },
    });
  },
  update(args) {
    return prisma.pilotReviewDeliveryPolicy.update({
      where: { id: args.id },
      data: args.data,
    });
  },
};

export function isSupportedPilotReviewDeliveryTimeZone(value: string) {
  return isSupportedTimeZone(value);
}

export async function listPilotReviewDeliveryPolicies(
  deps: Pick<PilotReviewDeliveryPolicyDeps, "store"> = {}
) {
  const store = deps.store ?? defaultStore;
  const rows = await store.findMany();
  return rows.map(serializePolicy);
}

export async function createPilotReviewDeliveryPolicy(
  input: CreatePilotReviewDeliveryPolicyInput,
  deps: Pick<PilotReviewDeliveryPolicyDeps, "store"> = {}
) {
  const store = deps.store ?? defaultStore;
  const row = await store.create({
    data: {
      id: randomUUID(),
      active: input.active ?? true,
      channel: input.channel ?? "email",
      createdByUserId: normalizeOptionalString(input.createdByUserId),
      deliveryHour: input.deliveryHour,
      deliveryWeekday: input.deliveryWeekday,
      recipient: normalizeOptionalString(input.recipient),
      timezone: input.timezone,
      updatedByUserId: normalizeOptionalString(input.createdByUserId),
      updatedAt: new Date(),
      workspaceId: input.workspaceId ?? "executive",
    },
  });

  return serializePolicy(row);
}

export async function updatePilotReviewDeliveryPolicy(
  id: string,
  input: UpdatePilotReviewDeliveryPolicyInput,
  deps: Pick<PilotReviewDeliveryPolicyDeps, "store"> = {}
) {
  const store = deps.store ?? defaultStore;
  const existing = await store.findUnique({ id });
  if (!existing) {
    throw new Error("Pilot review delivery policy not found.");
  }

  const updated = await store.update({
    id,
    data: {
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.deliveryHour !== undefined ? { deliveryHour: input.deliveryHour } : {}),
      ...(input.deliveryWeekday !== undefined
        ? { deliveryWeekday: input.deliveryWeekday }
        : {}),
      ...(input.recipient !== undefined
        ? { recipient: normalizeOptionalString(input.recipient) }
        : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.updatedByUserId !== undefined
        ? { updatedByUserId: normalizeOptionalString(input.updatedByUserId) }
        : {}),
    },
  });

  return serializePolicy(updated);
}

export async function runDuePilotReviewDeliveryPolicies(
  deps: PilotReviewDeliveryPolicyDeps = {}
) {
  const store = deps.store ?? defaultStore;
  const policies = await listPilotReviewDeliveryPolicies({ store });
  return executePilotReviewPolicyRun(policies, deps);
}

export async function executePilotReviewPolicyRun(
  policies: PilotReviewDeliveryPolicyRecord[],
  deps: PilotReviewDeliveryPolicyDeps = {}
): Promise<PilotReviewDeliveryPolicyExecutionSummary> {
  const now = deps.now ?? new Date();
  const store = deps.store ?? defaultStore;
  const accessProfile = deps.accessProfile ?? buildAccessProfile();
  const deliver =
    deps.deliver ??
    (async (input: ExecutePolicyDeliveryRequest) => {
      const result = await deliverPilotReviewByEmail({
        accessProfile: input.accessProfile,
        dryRun: input.dryRun,
        env: input.env,
        idempotencyKey: input.idempotencyKey,
        recipient: input.policy.recipient,
        scheduledPolicyId: input.policy.id,
      });

      return {
        delivered: result.delivered,
        dryRun: result.dryRun,
        ledger: result.ledger
          ? {
              deliveredAt: result.ledger.deliveredAt,
              lastError: result.ledger.lastError,
              messageId: result.messageId ?? null,
            }
          : null,
        messageId: result.messageId,
      };
    });

  const results: PilotReviewDeliveryPolicyExecutionResult[] = [];
  let duePolicies = 0;
  let deliveredPolicies = 0;
  let failedPolicies = 0;
  let previewPolicies = 0;
  let skippedPolicies = 0;

  for (const policy of policies) {
    if (!policy.active) {
      skippedPolicies += 1;
      results.push({
        delivered: false,
        dryRun: false,
        policyId: policy.id,
        reason: "inactive",
        skipped: true,
      });
      continue;
    }

    if (!shouldAttemptPilotReviewDeliveryPolicy(policy, now)) {
      skippedPolicies += 1;
      results.push({
        delivered: false,
        dryRun: false,
        policyId: policy.id,
        reason: "not_due",
        skipped: true,
      });
      continue;
    }

    duePolicies += 1;
    const dryRun = Boolean(deps.dryRun);
    const windowKey = getPolicyWindowKey(now, policy.timezone).windowKey;

    try {
      const delivery = await deliver({
        accessProfile,
        dryRun,
        env: deps.env,
        idempotencyKey: buildScheduledBriefDeliveryIdempotencyKey({
          channel: "email",
          policyId: policy.id,
          windowKey,
        }),
        policy,
      });

      if (dryRun) {
        previewPolicies += 1;
      } else {
        deliveredPolicies += 1;
      }

      results.push({
        delivered: !dryRun,
        dryRun,
        ...(delivery.messageId ? { messageId: delivery.messageId } : {}),
        policyId: policy.id,
        reason: dryRun ? "previewed" : "delivered",
        skipped: false,
      });

      await store.update({
        id: policy.id,
        data: {
          lastAttemptAt: now,
          ...(dryRun ? {} : { lastDeliveredAt: now }),
          lastError: null,
          updatedByUserId: dryRun
            ? "system:pilot-review-preview"
            : "system:pilot-review-schedule",
        },
      });
    } catch (error) {
      failedPolicies += 1;
      const message =
        error instanceof Error ? error.message : "Pilot review delivery failed.";
      results.push({
        delivered: false,
        dryRun,
        error: message,
        policyId: policy.id,
        reason: "failed",
        skipped: false,
      });

      await store.update({
        id: policy.id,
        data: {
          lastAttemptAt: now,
          lastError: message,
          updatedByUserId: "system:pilot-review-schedule",
        },
      });
    }
  }

  return {
    checkedPolicies: policies.length,
    deliveredPolicies,
    duePolicies,
    failedPolicies,
    previewPolicies,
    results,
    skippedPolicies,
    timestamp: now.toISOString(),
  };
}

export function shouldAttemptPilotReviewDeliveryPolicy(
  policy: Pick<
    PilotReviewDeliveryPolicyRecord,
    "active" | "deliveryHour" | "deliveryWeekday" | "lastAttemptAt" | "lastDeliveredAt" | "lastError" | "timezone"
  >,
  referenceDate: Date = new Date()
) {
  if (!policy.active) {
    return false;
  }

  const currentWindow = getPolicyWindowKey(referenceDate, policy.timezone);
  if (currentWindow.hour !== policy.deliveryHour) {
    return false;
  }

  if (currentWindow.weekday !== policy.deliveryWeekday) {
    return false;
  }

  if (!policy.lastAttemptAt) {
    return true;
  }

  const attemptedAt = new Date(policy.lastAttemptAt);
  if (Number.isNaN(attemptedAt.getTime())) {
    return true;
  }

  const attemptedWindow = getPolicyWindowKey(attemptedAt, policy.timezone).windowKey;
  if (attemptedWindow !== currentWindow.windowKey) {
    return true;
  }

  if (policy.lastDeliveredAt) {
    const deliveredAt = new Date(policy.lastDeliveredAt);
    if (
      !Number.isNaN(deliveredAt.getTime()) &&
      getPolicyWindowKey(deliveredAt, policy.timezone).windowKey === currentWindow.windowKey
    ) {
      return false;
    }
  }

  return Boolean(policy.lastError);
}

function serializePolicy(row: StoredPilotReviewDeliveryPolicy): PilotReviewDeliveryPolicyRecord {
  return {
    active: row.active,
    channel: row.channel as "email",
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
    deliveryHour: row.deliveryHour,
    deliveryWeekday: row.deliveryWeekday,
    id: row.id,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    lastDeliveredAt: row.lastDeliveredAt?.toISOString() ?? null,
    lastError: row.lastError,
    recipient: row.recipient,
    timezone: row.timezone,
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId: row.updatedByUserId,
    workspaceId: row.workspaceId,
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

function normalizeOptionalString(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
