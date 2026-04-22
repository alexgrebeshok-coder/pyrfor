import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

import {
  BILLING_PLANS,
  formatBillingLimit,
  getBillingPlanConfig,
  getBillingPlanOrder,
  isBillingLimitsEnabled,
  type BillingPlanId,
  type BillingStatus,
} from "./plans";
import type { BillingOverview } from "./types";

function utcTomorrowReset(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
  );
}

function normalizeAiUsageWindow(
  aiUsageToday: number,
  aiUsageResetAt: Date | null,
  now = new Date()
) {
  const nextResetAt = utcTomorrowReset(now);
  const shouldReset = !aiUsageResetAt || aiUsageResetAt.getTime() <= now.getTime();

  return {
    aiToday: shouldReset ? 0 : aiUsageToday,
    aiResetAt: shouldReset ? nextResetAt : aiUsageResetAt,
    shouldReset,
    nextResetAt,
  };
}

function billingError(status: number, code: string, message: string) {
  return NextResponse.json(
    {
      error: message,
      code,
    },
    { status }
  );
}

export async function getBillingOverview(input: {
  organizationSlug: string;
  workspaceId: string;
}): Promise<BillingOverview> {
  const organization = await prisma.organization.findUnique({
    where: {
      slug: input.organizationSlug,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      billingPlan: true,
      billingStatus: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stripePriceId: true,
      trialEndsAt: true,
      aiUsageToday: true,
      aiUsageResetAt: true,
    },
  });

  if (!organization) {
    throw new Error(`Organization "${input.organizationSlug}" was not found.`);
  }

  const workspace = await prisma.workspace.findUnique({
    where: {
      id: input.workspaceId,
    },
    select: {
      id: true,
      name: true,
      initials: true,
    },
  });

  const plan = getBillingPlanConfig(organization.billingPlan);
  const [projectCount, memberCount] = await Promise.all([
    prisma.project.count({
      where: {
        workspaceId: input.workspaceId,
      },
    }),
    prisma.membership.count({
      where: {
        organizationId: organization.id,
      },
    }),
  ]);

  const aiUsage = normalizeAiUsageWindow(organization.aiUsageToday, organization.aiUsageResetAt);
  const events = await prisma.billingEvent.findMany({
    where: {
      organizationId: organization.id,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 8,
    select: {
      id: true,
      type: true,
      createdAt: true,
      processedAt: true,
    },
  });

  const projectRemaining =
    plan.limits.projects === null ? null : Math.max(0, plan.limits.projects - projectCount);
  const memberRemaining =
    plan.limits.members === null ? null : Math.max(0, plan.limits.members - memberCount);
  const aiRemaining =
    plan.limits.aiPerDay === null ? null : Math.max(0, plan.limits.aiPerDay - aiUsage.aiToday);

  return {
    organization: {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      billingPlan: organization.billingPlan as BillingPlanId,
      billingStatus: organization.billingStatus as BillingStatus,
      stripeCustomerId: organization.stripeCustomerId,
      stripeSubscriptionId: organization.stripeSubscriptionId,
      stripePriceId: organization.stripePriceId,
      trialEndsAt: organization.trialEndsAt ? organization.trialEndsAt.toISOString() : null,
    },
    workspace: {
      id: workspace?.id ?? input.workspaceId,
      name: workspace?.name ?? input.workspaceId,
      initials: workspace?.initials ?? input.workspaceId.slice(0, 2).toUpperCase(),
    },
    plan,
    limits: plan.limits,
    usage: {
      projects: projectCount,
      members: memberCount,
      aiToday: aiUsage.aiToday,
      aiResetAt: aiUsage.aiResetAt?.toISOString() ?? null,
      projectRemaining,
      memberRemaining,
      aiRemaining,
    },
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      createdAt: event.createdAt.toISOString(),
      processedAt: event.processedAt ? event.processedAt.toISOString() : null,
    })),
    gatesEnabled: isBillingLimitsEnabled(),
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  };
}

export async function enforceProjectLimit(input: {
  organizationSlug: string;
  workspaceId: string;
}): Promise<NextResponse | null> {
  if (!isBillingLimitsEnabled()) {
    return null;
  }

  const organization = await prisma.organization.findUnique({
    where: {
      slug: input.organizationSlug,
    },
    select: {
      id: true,
      billingPlan: true,
      name: true,
    },
  });

  if (!organization) {
    return billingError(404, "ORGANIZATION_NOT_FOUND", "Organization was not found.");
  }

  const plan = getBillingPlanConfig(organization.billingPlan);
  if (plan.limits.projects === null) {
    return null;
  }

  const projectCount = await prisma.project.count({
    where: {
      workspaceId: input.workspaceId,
    },
  });

  if (projectCount < plan.limits.projects) {
    return null;
  }

  return billingError(
    402,
    "PROJECT_LIMIT_REACHED",
    `Plan ${plan.label} allows ${formatBillingLimit(plan.limits.projects)} project(s). Upgrade to create more projects.`
  );
}

export async function consumeAiQuota(input: {
  organizationSlug: string;
}): Promise<NextResponse | null> {
  if (!isBillingLimitsEnabled()) {
    return null;
  }

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: {
        slug: input.organizationSlug,
      },
      select: {
        id: true,
        billingPlan: true,
        aiUsageToday: true,
        aiUsageResetAt: true,
      },
    });

    if (!organization) {
      return billingError(404, "ORGANIZATION_NOT_FOUND", "Organization was not found.");
    }

    const plan = getBillingPlanConfig(organization.billingPlan);
    const now = new Date();
    const aiUsage = normalizeAiUsageWindow(organization.aiUsageToday, organization.aiUsageResetAt, now);

    if (aiUsage.shouldReset) {
      await tx.organization.update({
        where: {
          id: organization.id,
        },
        data: {
          aiUsageToday: 0,
          aiUsageResetAt: aiUsage.nextResetAt,
        },
      });
    }

    if (plan.limits.aiPerDay !== null && aiUsage.aiToday >= plan.limits.aiPerDay) {
      return billingError(
        429,
        "AI_DAILY_LIMIT_REACHED",
        `Plan ${plan.label} allows ${formatBillingLimit(plan.limits.aiPerDay)} AI requests per day. Upgrade to continue.`
      );
    }

    await tx.organization.update({
      where: {
        id: organization.id,
      },
      data: {
        aiUsageToday: aiUsage.aiToday + 1,
        aiUsageResetAt: aiUsage.aiResetAt ?? aiUsage.nextResetAt,
      },
    });

    return null;
  });
}

export function getBillingPlanSummary(planId: BillingPlanId) {
  const plan = BILLING_PLANS[planId];

  return {
    id: plan.id,
    label: plan.label,
    description: plan.description,
    priceLabel: plan.priceLabel,
    limits: plan.limits,
    features: plan.features,
    featured: plan.featured ?? false,
    stripePriceId: plan.stripePriceEnv ? process.env[plan.stripePriceEnv]?.trim() ?? null : null,
    upgradeOrder: getBillingPlanOrder(plan.id),
  };
}
