import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { readJsonBody } from "@/lib/server/api-validation";
import { badRequest, serverError, serviceUnavailable } from "@/lib/server/api-utils";
import { siteUrl } from "@/lib/site-url";
import {
  getBillingPlanConfig,
  getBillingPlanOrder,
  getStripePriceId,
  type BillingPlanId,
} from "@/lib/billing";
import { getStripe, hasStripeSecret } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkoutSchema = z.object({
  planId: z.enum(["starter", "business", "team"]),
});

export async function POST(request: NextRequest) {
  try {
    const authResult = await authorizeRequest(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    if (!hasStripeSecret()) {
      return serviceUnavailable(
        "STRIPE_SECRET_KEY is not configured.",
        "STRIPE_NOT_CONFIGURED"
      );
    }

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) {
      return body;
    }

    const parsed = checkoutSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid billing plan.");
    }

    const { planId } = parsed.data;
    const organizationSlug = authResult.accessProfile.organizationSlug;
    const organization = await prisma.organization.findUnique({
      where: {
        slug: organizationSlug,
      },
      select: {
        id: true,
        slug: true,
        billingPlan: true,
        stripeCustomerId: true,
      },
    });

    if (!organization) {
      return badRequest("Organization was not found.");
    }

    const currentPlan = getBillingPlanConfig(organization.billingPlan).id;
    if (getBillingPlanOrder(currentPlan) >= getBillingPlanOrder(planId as BillingPlanId)) {
      return badRequest("Please choose a higher plan to upgrade.");
    }

    const priceId = getStripePriceId(planId as BillingPlanId);
    if (!priceId) {
      return serviceUnavailable(
        `Stripe price ID is not configured for ${planId}.`,
        "STRIPE_PRICE_NOT_CONFIGURED"
      );
    }

    const currentUserMembership = await prisma.membership.findFirst({
      where: {
        organizationId: organization.id,
        userId: authResult.accessProfile.userId,
      },
      select: {
        email: true,
        displayName: true,
      },
    });

    const stripe = getStripe();
    const successUrl = new URL("/billing?checkout=success", siteUrl).toString();
    const cancelUrl = new URL("/billing?checkout=cancelled", siteUrl).toString();
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: organization.id,
      customer: organization.stripeCustomerId ?? undefined,
      customer_email: organization.stripeCustomerId ? undefined : currentUserMembership?.email ?? undefined,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      metadata: {
        organizationId: organization.id,
        organizationSlug: organization.slug,
        planId,
        stripePriceId: priceId,
        workspaceId: authResult.accessProfile.workspaceId,
      },
      subscription_data: {
        metadata: {
          organizationId: organization.id,
          organizationSlug: organization.slug,
          planId,
          stripePriceId: priceId,
          workspaceId: authResult.accessProfile.workspaceId,
        },
      },
    });

    if (!checkoutSession.url) {
      return serverError(new Error("Stripe checkout session URL was not returned."), "Failed to create billing checkout session.");
    }

    return NextResponse.json({
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id,
    });
  } catch (error) {
    return serverError(error, "Failed to create billing checkout session.");
  }
}
