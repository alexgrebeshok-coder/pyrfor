import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { prisma } from "@/lib/prisma";
import { serverError, serviceUnavailable } from "@/lib/server/api-utils";
import {
  getBillingPlanFromPriceId,
  type BillingPlanId,
  type BillingStatus,
} from "@/lib/billing";
import {
  getStripe,
  hasStripeSecret,
  hasStripeWebhookSecret,
} from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StripeSubscription = Stripe.Subscription;
type StripeCheckoutSession = Stripe.Checkout.Session;
type StripeInvoice = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription | null;
  customer?: string | Stripe.Customer | null;
};

function toIsoDate(value: number | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  return new Date(value * 1000);
}

function normalizeBillingStatus(status: Stripe.Subscription.Status): BillingStatus {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "incomplete":
      return status;
    default:
      return "active";
  }
}

async function findOrganizationBySubscription(input: {
  organizationId?: string | null;
  organizationSlug?: string | null;
  subscriptionId?: string | null;
  customerId?: string | null;
}) {
  if (input.organizationId) {
    return prisma.organization.findUnique({
      where: { id: input.organizationId },
    });
  }

  if (input.organizationSlug) {
    return prisma.organization.findUnique({
      where: { slug: input.organizationSlug },
    });
  }

  if (input.subscriptionId) {
    return prisma.organization.findUnique({
      where: { stripeSubscriptionId: input.subscriptionId },
    });
  }

  if (input.customerId) {
    return prisma.organization.findUnique({
      where: { stripeCustomerId: input.customerId },
    });
  }

  return null;
}

async function recordBillingEvent(params: {
  eventId: string;
  type: string;
  organizationId?: string | null;
  payload: unknown;
}) {
  await prisma.billingEvent.upsert({
    where: {
      id: params.eventId,
    },
    create: {
      id: params.eventId,
      type: params.type,
      organizationId: params.organizationId ?? null,
      payloadJson: JSON.stringify(params.payload),
      processedAt: null,
      updatedAt: new Date(),
    },
    update: {
      type: params.type,
      organizationId: params.organizationId ?? null,
      payloadJson: JSON.stringify(params.payload),
      updatedAt: new Date(),
    },
  });
}

async function updateOrganizationFromCheckoutSession(session: StripeCheckoutSession) {
  const organization = await findOrganizationBySubscription({
    organizationId: session.metadata?.organizationId,
    organizationSlug: session.metadata?.organizationSlug,
    subscriptionId: typeof session.subscription === "string" ? session.subscription : null,
    customerId: typeof session.customer === "string" ? session.customer : null,
  });

  if (!organization) {
    return null;
  }

  const planId = (session.metadata?.planId as BillingPlanId | undefined) ?? organization.billingPlan;
  const priceId = session.metadata?.stripePriceId ?? organization.stripePriceId;

  await prisma.organization.update({
    where: {
      id: organization.id,
    },
    data: {
      billingPlan: planId,
      billingStatus: "active",
      stripeCustomerId: typeof session.customer === "string" ? session.customer : organization.stripeCustomerId,
      stripeSubscriptionId:
        typeof session.subscription === "string" ? session.subscription : organization.stripeSubscriptionId,
      stripePriceId: priceId,
    },
  });

  return organization.id;
}

async function updateOrganizationFromSubscription(subscription: StripeSubscription) {
  const organization = await findOrganizationBySubscription({
    organizationId: subscription.metadata?.organizationId,
    organizationSlug: subscription.metadata?.organizationSlug,
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === "string" ? subscription.customer : null,
  });

  if (!organization) {
    return null;
  }

  const planId =
    (subscription.metadata?.planId as BillingPlanId | undefined) ??
    getBillingPlanFromPriceId(subscription.items.data[0]?.price?.id ?? null) ??
    organization.billingPlan;
  const status = normalizeBillingStatus(subscription.status);
  const priceId = subscription.items.data[0]?.price?.id ?? organization.stripePriceId;

  await prisma.organization.update({
    where: {
      id: organization.id,
    },
    data: {
      billingPlan: planId,
      billingStatus: status,
      stripeCustomerId:
        typeof subscription.customer === "string" ? subscription.customer : organization.stripeCustomerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      trialEndsAt: toIsoDate(subscription.trial_end),
    },
  });

  return organization.id;
}

async function cancelOrganizationSubscription(subscription: StripeSubscription) {
  const organization = await findOrganizationBySubscription({
    organizationId: subscription.metadata?.organizationId,
    organizationSlug: subscription.metadata?.organizationSlug,
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === "string" ? subscription.customer : null,
  });

  if (!organization) {
    return null;
  }

  await prisma.organization.update({
    where: {
      id: organization.id,
    },
    data: {
      billingPlan: "free",
      billingStatus: "canceled",
      stripeSubscriptionId: null,
      stripePriceId: null,
      trialEndsAt: null,
    },
  });

  return organization.id;
}

export async function POST(request: NextRequest) {
  if (!hasStripeSecret() || !hasStripeWebhookSecret()) {
    return serviceUnavailable(
      "Stripe webhook secrets are not configured.",
      "STRIPE_WEBHOOK_NOT_CONFIGURED"
    );
  }

  const stripe = getStripe();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      {
        error: "Stripe signature header is required.",
        code: "STRIPE_SIGNATURE_REQUIRED",
      },
      { status: 400 }
    );
  }

  const payload = await request.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid Stripe webhook signature.",
        code: "STRIPE_SIGNATURE_INVALID",
      },
      { status: 400 }
    );
  }

  try {
    let organizationId: string | null = null;

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as StripeCheckoutSession;
      organizationId = await updateOrganizationFromCheckoutSession(session);
    } else if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as StripeSubscription;
      organizationId =
        event.type === "customer.subscription.deleted"
          ? await cancelOrganizationSubscription(subscription)
          : await updateOrganizationFromSubscription(subscription);
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as StripeInvoice;
      const organization = await findOrganizationBySubscription({
        subscriptionId: typeof invoice.subscription === "string" ? invoice.subscription : null,
        customerId: typeof invoice.customer === "string" ? invoice.customer : null,
      });

      if (organization) {
        organizationId = organization.id;
        await prisma.organization.update({
          where: {
            id: organization.id,
          },
          data: {
            billingStatus: "past_due",
          },
        });
      }
    }

    await recordBillingEvent({
      eventId: event.id,
      type: event.type,
      organizationId,
      payload: event,
    });

    await prisma.billingEvent.update({
      where: {
        id: event.id,
      },
      data: {
        processedAt: new Date(),
      },
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    return serverError(error, "Failed to process Stripe webhook.");
  }
}
