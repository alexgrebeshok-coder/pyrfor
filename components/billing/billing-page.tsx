"use client";

import { useMemo, useState } from "react";
import { CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  BillingEventsSection,
  BillingPlanGrid,
  BillingUsageCards,
  formatCount,
} from "@/components/billing/billing-page-sections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  BILLING_PLANS,
  getBillingPlanOrder,
  getBillingPlanSequence,
  type BillingPlanId,
} from "@/lib/billing/plans";
import type { BillingOverview } from "@/lib/billing/types";

interface BillingPageProps {
  initialOverview: BillingOverview;
  initialError?: string | null;
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

        <BillingUsageCards
          aiProgress={aiProgress}
          memberProgress={memberProgress}
          overview={overview}
          projectProgress={projectProgress}
        />
        <BillingPlanGrid
          currentPlanIndex={currentPlanIndex}
          onCheckout={handleCheckout}
          orderedPlans={orderedPlans}
          overview={overview}
          pendingPlan={pendingPlan}
        />
        <BillingEventsSection overview={overview} />
      </div>
    </main>
  );
}
