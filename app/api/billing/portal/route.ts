import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { badRequest, serverError, serviceUnavailable } from "@/lib/server/api-utils";
import { siteUrl } from "@/lib/site-url";
import { getStripe, hasStripeSecret } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const organization = await prisma.organization.findUnique({
      where: {
        slug: authResult.accessProfile.organizationSlug,
      },
      select: {
        id: true,
        stripeCustomerId: true,
      },
    });

    if (!organization) {
      return badRequest("Organization was not found.");
    }

    if (!organization.stripeCustomerId) {
      return badRequest(
        "Stripe customer is not configured yet. Subscribe first to access the billing portal.",
        "STRIPE_CUSTOMER_MISSING"
      );
    }

    const stripe = getStripe();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: organization.stripeCustomerId,
      return_url: new URL("/billing", siteUrl).toString(),
    });

    return NextResponse.json({
      portalUrl: portalSession.url,
      sessionId: portalSession.id,
    });
  } catch (error) {
    return serverError(error, "Failed to create billing portal session.");
  }
}
