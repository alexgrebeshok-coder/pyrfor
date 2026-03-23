import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export function hasStripeSecret(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function hasStripeWebhookSecret(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim());
}

export function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  if (!stripeInstance) {
    stripeInstance = new Stripe(secretKey);
  }

  return stripeInstance;
}
