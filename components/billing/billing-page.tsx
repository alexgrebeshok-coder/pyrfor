"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  BILLING_PLANS,
  formatBillingLimit,
  getBillingPlanOrder,
  getBillingPlanSequence,
  type BillingPlanId,
} from "@/lib/billing/plans";
import type { BillingOverview } from "@/lib/billing/types";
import { cn } from "@/lib/utils";

interface BillingPageProps {
  initialOverview: BillingOverview;
  initialError?: string | null;
}

function formatCount(count: number, limit: number | null) {
  if (limit === null) {
    return `${count} / ∞`;
  }

  return `${count} / ${limit}`;
}

export function BillingPage({ initialOverview, initialError = null }: BillingPageProps) {
  const [overview] = useState(initialOverview);
  const [error] = useState(initialError);
  const [pendingPlan, setPendingPlan] = useState<BillingPlanId | null>(null);
  const [pendingPortal, setPendingPortal] = useState(false);

  const orderedPlans = useMemo(
    () => getBillingPlanSequence().map((planId) => BILLING_PLANS[planId]),
    []
  );

  const currentPlan = BILLING_PLANS[overview.organization.billingPlan];
  const currentPlanIndex = getBillingPlanOrder(overview.organization.billingPlan);

  const handleCheckout = async (planId: BillingPlanId) => {
    setPendingPlan(planId);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ planId }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { checkoutUrl?: string; error?: string; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || "Не удалось открыть checkout.");
      }

      if (!payload?.checkoutUrl) {
        throw new Error("Stripe checkout URL is missing.");
      }

      window.location.assign(payload.checkoutUrl);
    } catch (checkoutError) {
      toast.error(
        checkoutError instanceof Error ? checkoutError.message : "Не удалось открыть checkout."
      );
    } finally {
      setPendingPlan(null);
    }
  };

  const handleOpenPortal = async () => {
    setPendingPortal(true);

    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
      });

      const payload = (await response.json().catch(() => null)) as
        | { portalUrl?: string; error?: string; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || "Не удалось открыть billing portal.");
      }

      if (!payload?.portalUrl) {
        throw new Error("Stripe portal URL is missing.");
      }

      window.location.assign(payload.portalUrl);
    } catch (portalError) {
      toast.error(
        portalError instanceof Error ? portalError.message : "Не удалось открыть billing portal."
      );
    } finally {
      setPendingPortal(false);
    }
  };

  if (error) {
    return (
      <main className="min-h-[100dvh] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          <Card className="border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-50">
            <CardHeader>
              <Badge variant="danger">Billing unavailable</Badge>
              <CardTitle className="text-2xl tracking-[-0.06em]">Не удалось загрузить billing</CardTitle>
              <CardDescription className="text-sm leading-6 text-inherit/80">{error}</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    );
  }

  const aiProgress =
    overview.plan.limits.aiPerDay === null ? 0 : (overview.usage.aiToday / overview.plan.limits.aiPerDay) * 100;
  const projectProgress =
    overview.plan.limits.projects === null ? 0 : (overview.usage.projects / overview.plan.limits.projects) * 100;
  const memberProgress =
    overview.plan.limits.members === null ? 0 : (overview.usage.members / overview.plan.limits.members) * 100;

  return (
    <main className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_28%),linear-gradient(180deg,var(--surface) 0%,var(--surface-panel) 100%)] px-4 py-6 text-[var(--ink)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[32px] border border-[color:var(--line)] bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_55%,#2563eb_100%)] text-white shadow-[0_30px_120px_rgba(15,23,42,.18)]">
          <div className="grid gap-6 p-6 lg:grid-cols-[1.15fr_.85fr] lg:p-8">
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">Billing</Badge>
                <Badge variant={overview.gatesEnabled ? "success" : "info"}>
                  {overview.gatesEnabled ? "Limits enabled" : "Feature flag off"}
                </Badge>
                <Badge variant={overview.stripeConfigured ? "success" : "neutral"}>
                  {overview.stripeConfigured ? "Stripe configured" : "Stripe env missing"}
                </Badge>
              </div>

              <div className="space-y-4">
                <h1 className="font-heading text-4xl font-semibold tracking-[-0.08em] sm:text-5xl">
                  Планы, лимиты и upgrade path для вашего workspace.
                </h1>
                <p className="max-w-2xl text-base leading-8 text-slate-100/84">
                  Здесь видно, что доступно на текущем плане, сколько уже использовано и как перейти
                  на более высокий тариф через Stripe Checkout.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-sm text-slate-100/90">
                  Org: {overview.organization.slug}
                </div>
                <div className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-sm text-slate-100/90">
                  Workspace: {overview.workspace.name}
                </div>
                <div className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-sm text-slate-100/90">
                  Current plan: {currentPlan.label}
                </div>
                {overview.organization.trialEndsAt ? (
                  <div className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-sm text-slate-100/90">
                    Trial ends {new Date(overview.organization.trialEndsAt).toLocaleDateString("ru-RU")}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/12 bg-white/10 p-5 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Badge variant={overview.organization.billingStatus === "active" ? "success" : "info"}>
                    {overview.organization.billingStatus}
                  </Badge>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.06em] text-white">
                    {currentPlan.label}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-100/80">{currentPlan.description}</p>
                </div>
                <div className="rounded-2xl border border-white/12 bg-white/10 p-3">
                  <CreditCard className="h-5 w-5 text-white" />
                </div>
              </div>

              <div className="mt-5 grid gap-3 text-sm text-slate-100/82">
                <div className="flex items-center justify-between gap-3">
                  <span>Projects used</span>
                  <span className="font-medium text-white">
                    {formatCount(overview.usage.projects, overview.plan.limits.projects)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Members used</span>
                  <span className="font-medium text-white">
                    {formatCount(overview.usage.members, overview.plan.limits.members)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>AI today</span>
                  <span className="font-medium text-white">
                    {formatCount(overview.usage.aiToday, overview.plan.limits.aiPerDay)}
                  </span>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-100/75">
                    <span>AI quota</span>
                    <span>
                      {overview.plan.limits.aiPerDay === null
                        ? "Unlimited"
                        : `${overview.usage.aiRemaining ?? 0} left`}
                    </span>
                  </div>
                  <Progress className="h-2 bg-white/12" value={Math.min(100, aiProgress)} />
                </div>
              </div>

              {overview.organization.stripeCustomerId ? (
                <div className="mt-5">
                  <Button
                    className="w-full"
                    disabled={pendingPortal}
                    onClick={handleOpenPortal}
                    type="button"
                    variant="secondary"
                  >
                    {pendingPortal ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Opening portal…
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4" />
                        Manage subscription
                      </>
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>

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
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Current plan
                    </Badge>
                  ) : (
                    <Button
                      className="w-full"
                      disabled={!canUpgrade || pendingPlan === plan.id}
                      onClick={() => handleCheckout(plan.id)}
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
      </div>
    </main>
  );
}
