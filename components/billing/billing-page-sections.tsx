import { CheckCircle2, CreditCard, Loader2, ShieldCheck, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  formatBillingLimit,
  getBillingPlanOrder,
  type BillingPlanConfig,
  type BillingPlanId,
} from "@/lib/billing/plans";
import type { BillingOverview } from "@/lib/billing/types";
import { cn } from "@/lib/utils";

export function formatCount(count: number, limit: number | null) {
  if (limit === null) {
    return `${count} / ∞`;
  }

  return `${count} / ${limit}`;
}

interface BillingUsageCardsProps {
  aiProgress: number;
  memberProgress: number;
  overview: BillingOverview;
  projectProgress: number;
}

export function BillingUsageCards({
  aiProgress,
  memberProgress,
  overview,
  projectProgress,
}: BillingUsageCardsProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
        <CardHeader className="space-y-2">
          <Badge variant="info">Projects</Badge>
          <CardTitle className="text-xl tracking-[-0.05em]">Project limit</CardTitle>
          <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
            Лимит считается по текущему workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm text-[var(--ink-soft)]">
            <span>{formatCount(overview.usage.projects, overview.plan.limits.projects)}</span>
            <span>
              {overview.usage.projectRemaining === null
                ? "Unlimited"
                : `${overview.usage.projectRemaining} left`}
            </span>
          </div>
          <Progress className="h-2" value={Math.min(100, projectProgress)} />
        </CardContent>
      </Card>

      <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
        <CardHeader className="space-y-2">
          <Badge variant="info">Team</Badge>
          <CardTitle className="text-xl tracking-[-0.05em]">User seats</CardTitle>
          <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
            Считается по количеству memberships в организации.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm text-[var(--ink-soft)]">
            <span>{formatCount(overview.usage.members, overview.plan.limits.members)}</span>
            <span>
              {overview.usage.memberRemaining === null
                ? "Unlimited"
                : `${overview.usage.memberRemaining} left`}
            </span>
          </div>
          <Progress className="h-2" value={Math.min(100, memberProgress)} />
        </CardContent>
      </Card>

      <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
        <CardHeader className="space-y-2">
          <Badge variant="info">AI</Badge>
          <CardTitle className="text-xl tracking-[-0.05em]">Daily quota</CardTitle>
          <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
            Использование AI сбрасывается раз в сутки по UTC.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm text-[var(--ink-soft)]">
            <span>{formatCount(overview.usage.aiToday, overview.plan.limits.aiPerDay)}</span>
            <span>
              {overview.usage.aiRemaining === null ? "Unlimited" : `${overview.usage.aiRemaining} left`}
            </span>
          </div>
          <Progress className="h-2" value={Math.min(100, aiProgress)} />
        </CardContent>
      </Card>
    </section>
  );
}

interface BillingPlanGridProps {
  currentPlanIndex: number;
  onCheckout: (planId: BillingPlanId) => Promise<void> | void;
  orderedPlans: BillingPlanConfig[];
  overview: BillingOverview;
  pendingPlan: BillingPlanId | null;
}

export function BillingPlanGrid({
  currentPlanIndex,
  onCheckout,
  orderedPlans,
  overview,
  pendingPlan,
}: BillingPlanGridProps) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {orderedPlans.map((plan) => {
        const isCurrent = plan.id === overview.organization.billingPlan;
        const canUpgrade = getBillingPlanOrder(plan.id) > currentPlanIndex;
        const checkoutEnabled = overview.stripeConfigured && Boolean(plan.stripePriceEnv);

        return (
          <Card
            className={cn(
              "border-[color:var(--line)] bg-[color:var(--surface-panel)]/96",
              isCurrent && "border-[var(--brand)] bg-[var(--brand)]/6"
            )}
            key={plan.id}
          >
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-xl tracking-[-0.05em]">{plan.label}</CardTitle>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em] text-[var(--ink)]">
                    {plan.priceLabel}
                  </p>
                </div>
                {plan.featured ? <Badge variant="info">Recommended</Badge> : null}
              </div>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                {plan.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 text-sm text-[var(--ink-soft)]">
                {plan.features.map((feature) => (
                  <div className="flex items-center gap-2" key={feature}>
                    <Sparkles className="h-4 w-4 text-[var(--brand)]" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-[color:var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
                <div className="flex items-center justify-between gap-3">
                  <span>Projects</span>
                  <span className="font-medium text-[var(--ink)]">
                    {formatBillingLimit(plan.limits.projects)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span>AI/day</span>
                  <span className="font-medium text-[var(--ink)]">
                    {formatBillingLimit(plan.limits.aiPerDay)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span>Users</span>
                  <span className="font-medium text-[var(--ink)]">
                    {formatBillingLimit(plan.limits.members)}
                  </span>
                </div>
              </div>

              {isCurrent ? (
                <Badge className="gap-1" variant="success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Current plan
                </Badge>
              ) : (
                <Button
                  className="w-full"
                  disabled={!canUpgrade || pendingPlan === plan.id}
                  onClick={() => void onCheckout(plan.id)}
                  type="button"
                >
                  {pendingPlan === plan.id ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Opening checkout…
                    </>
                  ) : checkoutEnabled ? (
                    <>
                      <CreditCard className="h-4 w-4" />
                      Upgrade to {plan.label}
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-4 w-4" />
                      Stripe not configured
                    </>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

interface BillingEventsSectionProps {
  overview: BillingOverview;
}

export function BillingEventsSection({ overview }: BillingEventsSectionProps) {
  return (
    <section className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
      <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
        <CardHeader className="space-y-2">
          <Badge variant="neutral">Subscription history</Badge>
          <CardTitle className="text-xl tracking-[-0.05em]">Recent billing events</CardTitle>
          <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
            Последние Stripe события, чтобы понимать, что произошло с подпиской и webhook-ами.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {overview.events.length ? (
            overview.events.map((event) => (
              <div
                className="flex items-start justify-between gap-4 rounded-2xl border border-[color:var(--line)] bg-[var(--panel-soft)] px-4 py-3"
                key={event.id}
              >
                <div className="space-y-1">
                  <p className="font-medium text-[var(--ink)]">{event.type}</p>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {new Date(event.createdAt).toLocaleString("ru-RU")}
                  </p>
                </div>
                <Badge variant={event.processedAt ? "success" : "info"}>
                  {event.processedAt ? "processed" : "pending"}
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-sm leading-6 text-[var(--ink-soft)]">
              Billing events will appear here after the first checkout or subscription update.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
        <CardHeader className="space-y-2">
          <Badge variant="info">Upgrade path</Badge>
          <CardTitle className="text-xl tracking-[-0.05em]">How billing flows work</CardTitle>
          <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
            Upgrade opens Stripe Checkout. Subscription changes and cancellation happen in the
            portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-[var(--ink-soft)]">
          <p>
            Free plan is capped at 1 project, 1 user, and 20 AI calls per day. Higher plans lift
            those limits automatically after webhook confirmation.
          </p>
          <p>
            If Stripe is configured, you can always open the portal to update payment details or
            downgrade/cancel the subscription.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
