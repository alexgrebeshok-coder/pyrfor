import Link from "next/link";
import { ArrowUpRight, Bot, Clock3, MessageSquareText, ShieldCheck, Sparkles, TrendingUp, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { cn } from "@/lib/utils";

const FEATURE_CARDS = [
  {
    title: "AI answers from facts",
    description:
      "The assistant reads projects, tasks, risks, budgets, evidence and work reports before it speaks.",
    icon: Bot,
    badge: "Grounded",
  },
  {
    title: "Finance and EVM",
    description:
      "Plan vs fact, variance, CPI, SPI, EAC and VAC are built into the product story from day one.",
    icon: TrendingUp,
    badge: "Finance-first",
  },
  {
    title: "Telegram briefs",
    description:
      "Daily and weekly updates are designed to reach managers where they already work.",
    icon: MessageSquareText,
    badge: "Retention loop",
  },
];

const LAUNCH_KIT = [
  {
    title: "Product Hunt",
    badge: "Launch copy",
    description: "AI project cockpit that turns project facts, budgets, and briefs into one action loop.",
    points: [
      "Open with the pain: too many spreadsheets, not enough signal.",
      "Show the public demo and the 5-message cap.",
      "Lead with AI + EVM + Telegram in one sentence.",
    ],
  },
  {
    title: "Habr article",
    badge: "Story angle",
    description: "How a solo developer + AI shipped a finance-aware PM dashboard.",
    points: [
      "Problem → prototype → retention loops.",
      "Show why facts beat generic chatbot answers.",
      "Include one screenshot of the briefs flow.",
    ],
  },
  {
    title: "Telegram rollout",
    badge: "Distribution",
    description: "Three posts: teaser, demo clip, and a short case-study hook.",
    points: [
      "Post 1: what the product does in one screenshot.",
      "Post 2: 30-second walkthrough of the demo.",
      "Post 3: why finance + AI matters for PMO teams.",
    ],
  },
  {
    title: "2-minute demo video",
    badge: "Video script",
    description: "A short demo should tell the full story before viewers bounce.",
    points: [
      "0:00–0:20 — pain and audience.",
      "0:20–1:20 — show facts, EVM, and AI answer.",
      "1:20–2:00 — CTA to /demo and /signup.",
    ],
  },
];

const KPI_CARDS = [
  {
    title: "Core loops",
    value: "3",
    description: "AI, finance, and Telegram are the main product loops.",
    icon: <Sparkles className="h-5 w-5" />,
  },
  {
    title: "Time to value",
    value: "5 min",
    description: "The product should show value before the first long meeting ends.",
    icon: <Clock3 className="h-5 w-5" />,
  },
  {
    title: "Teams covered",
    value: "PMO → finance",
    description: "Works for project managers, analysts, and operators in one surface.",
    icon: <Users className="h-5 w-5" />,
  },
];

export function LandingPage() {
  return (
    <main className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_30%),linear-gradient(180deg,var(--surface) 0%,var(--surface-panel) 100%)] px-4 py-6 text-[var(--ink)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[32px] border border-[color:var(--line)] bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_55%,#2563eb_100%)] text-white shadow-[0_30px_120px_rgba(15,23,42,.18)]">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.15fr_.85fr] lg:p-8">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">CEOClaw</Badge>
                <Badge variant="info">Lite launch</Badge>
                <Badge variant="success">PH ready</Badge>
                <Badge variant="success">1 dev + AI</Badge>
              </div>

              <div className="space-y-4">
                <h1 className="font-heading text-4xl font-semibold tracking-[-0.08em] sm:text-5xl">
                  AI product cockpit for projects, budgets, evidence, and team briefings.
                </h1>
                <p className="max-w-2xl text-base leading-8 text-slate-100/84">
                  CEOClaw helps teams see what changed, why it matters, and what to do next — without
                  another spreadsheet maze or a generic chatbot.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link className={cn(buttonVariants({ size: "lg" }), "bg-white text-slate-950 hover:bg-slate-100")} href="/demo">
                  Open demo
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
                <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/18 bg-white/10 text-white hover:bg-white/15")} href="/signup">
                  Request access
                </Link>
              </div>

              <div className="flex flex-wrap gap-3 text-sm text-slate-100/80">
                <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5">Facts over guesses</span>
                <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5">Budget + EVM</span>
                <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5">Telegram-ready loops</span>
              </div>
            </div>

            <div className="grid gap-3 rounded-[28px] border border-white/12 bg-white/10 p-5 backdrop-blur">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <ShieldCheck className="h-4 w-4" />
                    Safe by design
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">No blank screens</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">
                    The product surfaces real dashboards, not empty tables or hidden modes.
                  </p>
                </div>

                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <Sparkles className="h-4 w-4" />
                    What makes it work
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">RAG + EVM + briefings</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">
                    The product is not a generic dashboard; it is an operational truth spine.
                  </p>
                </div>

                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <MessageSquareText className="h-4 w-4" />
                    Use case
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">Managers + specialists</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">
                    PMs, finance, and operations all see the same source of truth.
                  </p>
                </div>

                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <Bot className="h-4 w-4" />
                    AI behavior
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">Short and factual</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">
                    AI should answer with facts, recommendation, and the next step.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {KPI_CARDS.map((card) => (
            <KpiCard key={card.title} {...card} />
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {FEATURE_CARDS.map((feature) => (
            <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96" key={feature.title}>
              <CardHeader className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--panel-soft)] text-[var(--brand)]">
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <Badge variant="info">{feature.badge}</Badge>
                </div>
                <div>
                  <CardTitle className="text-xl tracking-[-0.05em]">{feature.title}</CardTitle>
                  <CardDescription className="mt-2 text-sm leading-6">{feature.description}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
          <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[var(--brand)]" />
                <CardTitle className="text-2xl tracking-[-0.06em]">Launch packages</CardTitle>
              </div>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                Pricing is intentionally simple. The product should be easy to understand before it is easy to buy.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {PRICING_PLANS.map((plan) => (
                <div
                  className={cn(
                    "rounded-2xl border p-4",
                    plan.highlighted ? "border-[var(--brand)] bg-[var(--brand)]/6" : "border-[var(--line)] bg-[var(--panel-soft)]"
                  )}
                  key={plan.name}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-[var(--ink)]">{plan.name}</h3>
                      <p className="mt-1 text-2xl font-semibold tracking-[-0.05em] text-[var(--ink)]">{plan.price}</p>
                    </div>
                    {plan.highlighted ? <Badge variant="info">Recommended</Badge> : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{plan.description}</p>
                  <ul className="mt-3 space-y-1 text-sm text-[var(--ink-soft)]">
                    {plan.features.map((feature) => (
                      <li className="flex items-center gap-2" key={feature}>
                        <Sparkles className="h-4 w-4 text-[var(--brand)]" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-[color:var(--line)] bg-[linear-gradient(135deg,#0f172a_0%,#111827_60%,#1d4ed8_100%)] text-white">
            <CardHeader>
              <Badge variant="neutral">Ready to test?</Badge>
              <CardTitle className="text-2xl tracking-[-0.06em] text-white">Open the live demo and ask a real question.</CardTitle>
              <CardDescription className="text-sm leading-6 text-slate-100/80">
                The next click takes you to the public demo, where the assistant uses seed data and a strict five-message cap.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Link className={cn(buttonVariants({ size: "lg" }), "bg-white text-slate-950 hover:bg-slate-100")} href="/demo">
                Open demo
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/18 bg-white/10 text-white hover:bg-white/15")} href="/login">
                Sign in
              </Link>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="info">Launch kit</Badge>
                <Badge variant="neutral">Product Hunt + Habr + Telegram</Badge>
              </div>
              <h2 className="font-heading text-2xl font-semibold tracking-[-0.06em] text-[var(--ink)]">
                GTM assets are part of the product story.
              </h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link className={cn(buttonVariants({ variant: "outline" }))} href="/launch">
                Launch kit
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link className={cn(buttonVariants({ variant: "outline" }))} href="/demo">
                Open demo
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {LAUNCH_KIT.map((item) => (
              <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96" key={item.title}>
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-xl tracking-[-0.05em]">{item.title}</CardTitle>
                    <Badge variant="info">{item.badge}</Badge>
                  </div>
                  <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                    {item.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm leading-6 text-[var(--ink-soft)]">
                    {item.points.map((point) => (
                      <li className="flex gap-2" key={point}>
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

type PricingPlan = {
  name: string;
  price: string;
  description: string;
  features: readonly string[];
  highlighted?: boolean;
};

const PRICING_PLANS: PricingPlan[] = [
  {
    name: "Free",
    price: "$0",
    description: "1 project, 1 user, 20 AI/day, basic dashboard.",
    features: ["1 project", "1 user", "20 AI/day"],
  },
  {
    name: "Starter",
    price: "$19",
    description: "5 projects, 3 users, 100 AI/day, Telegram briefs.",
    features: ["5 projects", "3 users", "Telegram", "100 AI/day"],
    highlighted: true,
  },
  {
    name: "Business",
    price: "$49",
    description: "20 projects, 10 users, unlimited AI, analytics + EVM.",
    features: ["20 projects", "10 users", "Analytics", "EVM"],
  },
  {
    name: "Team",
    price: "$99",
    description: "Unlimited, API, custom agents, team performance.",
    features: ["Unlimited", "API", "Custom agents", "Team performance"],
  },
];
