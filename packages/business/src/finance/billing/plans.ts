export type BillingPlanId = "free" | "starter" | "business" | "team";
export type BillingStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete";

export interface BillingLimits {
  projects: number | null;
  aiPerDay: number | null;
  members: number | null;
}

export interface BillingPlanConfig {
  id: BillingPlanId;
  label: string;
  description: string;
  priceLabel: string;
  featured?: boolean;
  limits: BillingLimits;
  features: string[];
  stripePriceEnv: string;
}

const BILLING_PLAN_SEQUENCE: BillingPlanId[] = ["free", "starter", "business", "team"];

export const BILLING_PLANS: Record<BillingPlanId, BillingPlanConfig> = {
  free: {
    id: "free",
    label: "Free",
    description: "Базовый план для первого проекта и знакомства с продуктом.",
    priceLabel: "$0/mo",
    limits: {
      projects: 1,
      aiPerDay: 20,
      members: 1,
    },
    features: ["1 project", "20 AI/day", "Basic dashboard"],
    stripePriceEnv: "",
  },
  starter: {
    id: "starter",
    label: "Starter",
    description: "Подходит для небольшой команды и ежедневной AI-поддержки.",
    priceLabel: "$19/mo",
    featured: true,
    limits: {
      projects: 5,
      aiPerDay: 100,
      members: 3,
    },
    features: ["5 projects", "3 users", "Telegram briefs", "100 AI/day"],
    stripePriceEnv: "STRIPE_PRICE_ID_STARTER",
  },
  business: {
    id: "business",
    label: "Business",
    description: "Для растущих команд с большим объёмом проектов и аналитики.",
    priceLabel: "$49/mo",
    limits: {
      projects: 20,
      aiPerDay: null,
      members: 10,
    },
    features: ["20 projects", "10 users", "Analytics + EVM", "Unlimited AI"],
    stripePriceEnv: "STRIPE_PRICE_ID_BUSINESS",
  },
  team: {
    id: "team",
    label: "Team",
    description: "Максимальный тариф для расширенных команд и API-интеграций.",
    priceLabel: "$99/mo",
    limits: {
      projects: null,
      aiPerDay: null,
      members: null,
    },
    features: ["Unlimited projects", "API", "Custom agents", "Team performance"],
    stripePriceEnv: "STRIPE_PRICE_ID_TEAM",
  },
};

export function isBillingLimitsEnabled(): boolean {
  return process.env.ENABLE_USAGE_LIMITS === "true";
}

export function getBillingPlanConfig(planId?: string | null): BillingPlanConfig {
  if (!planId) {
    return BILLING_PLANS.free;
  }

  return BILLING_PLANS[planId as BillingPlanId] ?? BILLING_PLANS.free;
}

export function getBillingPlanOrder(planId: BillingPlanId): number {
  return BILLING_PLAN_SEQUENCE.indexOf(planId);
}

export function getStripePriceId(planId: BillingPlanId): string | null {
  const plan = BILLING_PLANS[planId];
  if (!plan.stripePriceEnv) {
    return null;
  }

  const priceId = process.env[plan.stripePriceEnv]?.trim();
  return priceId ? priceId : null;
}

export function getBillingPlanFromPriceId(priceId?: string | null): BillingPlanId | null {
  if (!priceId) {
    return null;
  }

  for (const planId of BILLING_PLAN_SEQUENCE) {
    if (getStripePriceId(planId) === priceId) {
      return planId;
    }
  }

  return null;
}

export function formatBillingLimit(limit: number | null): string {
  if (limit === null || !Number.isFinite(limit)) {
    return "∞";
  }

  return new Intl.NumberFormat("ru-RU").format(limit);
}

export function getBillingPlanSequence(): BillingPlanId[] {
  return [...BILLING_PLAN_SEQUENCE];
}
