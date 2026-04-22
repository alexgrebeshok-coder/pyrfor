import type { BillingLimits, BillingPlanConfig, BillingPlanId, BillingStatus } from "./plans";

export interface BillingOverview {
  organization: {
    id: string;
    slug: string;
    name: string;
    billingPlan: BillingPlanId;
    billingStatus: BillingStatus;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    stripePriceId: string | null;
    trialEndsAt: string | null;
  };
  workspace: {
    id: string;
    name: string;
    initials: string;
  };
  plan: BillingPlanConfig;
  limits: BillingLimits;
  usage: {
    projects: number;
    members: number;
    aiToday: number;
    aiResetAt: string | null;
    projectRemaining: number | null;
    memberRemaining: number | null;
    aiRemaining: number | null;
  };
  events: Array<{
    id: string;
    type: string;
    createdAt: string;
    processedAt: string | null;
  }>;
  gatesEnabled: boolean;
  stripeConfigured: boolean;
}
