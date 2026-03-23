import type { Metadata } from "next";

import { BillingPage as BillingPageComponent } from "@/components/billing/billing-page";
import { requireAuth } from "@/lib/auth/get-session";
import { getBillingOverview } from "@/lib/billing";
import type { BillingOverview } from "@/lib/billing/types";

export const metadata: Metadata = {
  title: "Billing — CEOClaw",
  description: "Current plan, usage limits, and Stripe upgrade options for your CEOClaw workspace.",
};

export default async function BillingPage() {
  const user = await requireAuth();

  try {
    const overview = await getBillingOverview({
      organizationSlug: user.organizationSlug ?? "",
      workspaceId: user.workspaceId ?? "executive",
    });

    return <BillingPageComponent initialOverview={overview} />;
  } catch (error) {
    return (
      <BillingPageComponent
        initialError={error instanceof Error ? error.message : "Failed to load billing overview."}
        initialOverview={
          {
            organization: {
              id: "unknown",
              slug: user.organizationSlug ?? "unknown",
              name: "Billing unavailable",
              billingPlan: "free",
              billingStatus: "active",
              stripeCustomerId: null,
              stripeSubscriptionId: null,
              stripePriceId: null,
              trialEndsAt: null,
            },
            workspace: {
              id: user.workspaceId ?? "executive",
              name: user.workspaceId ?? "executive",
              initials: (user.workspaceId ?? "executive").slice(0, 2).toUpperCase(),
            },
            plan: {
              id: "free",
              label: "Free",
              description: "Fallback billing state.",
              priceLabel: "$0/mo",
              limits: {
                projects: 1,
                aiPerDay: 20,
                members: 1,
              },
              features: ["Fallback state"],
              stripePriceEnv: "",
            },
            limits: {
              projects: 1,
              aiPerDay: 20,
              members: 1,
            },
            usage: {
              projects: 0,
              members: 0,
              aiToday: 0,
              aiResetAt: null,
              projectRemaining: 1,
              memberRemaining: 1,
              aiRemaining: 20,
            },
            events: [],
            gatesEnabled: false,
            stripeConfigured: false,
          } satisfies BillingOverview
        }
      />
    );
  }
}
