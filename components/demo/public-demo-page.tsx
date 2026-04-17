import Link from "next/link";
import { AlertTriangle, ArrowUpRight, BarChart3, Bot, CheckCircle2, Clock3, RefreshCw, ShieldCheck, Sparkles, Users } from "lucide-react";

import { PublicDemoChat } from "@/components/demo/public-demo-chat";
import {
  DemoProjectCard,
  formatMetric,
  MiniStat,
  PRICING_PLANS,
  PricingCard,
} from "@/components/demo/public-demo-page-cards";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { cn } from "@/lib/utils";
import { generatePortfolioBriefFromSnapshot } from "@/lib/briefs/generate";
import { loadDemoSnapshot } from "@/lib/demo/context";

function rankProjects<T extends { health: number; status: string; progress: number }>(projects: T[]): T[] {
  return [...projects].sort((left, right) => scoreProject(right) - scoreProject(left));
}

function scoreProject(project: { health: number; status: string; progress: number }): number {
  const statusScore = project.status === "at-risk" || project.status === "at_risk" ? 100 : project.status === "active" ? 60 : project.status === "planning" ? 40 : 20;
  return statusScore + (100 - project.health) + (100 - project.progress) / 2;
}

export default async function PublicDemoPage() {
  const { snapshot, source } = await loadDemoSnapshot();
  const portfolioBrief = generatePortfolioBriefFromSnapshot(snapshot, { locale: "ru" });
  const featuredProjects = rankProjects(snapshot.projects).slice(0, 3);
  const valuePath = [
    {
      body: "Сразу видно, какой риск сейчас главный и где портфель теряет управляемость.",
      step: "1",
      title: "Понять, что горит",
    },
    {
      body: "AI показывает факты, plan vs fact и evidence, а не просто красивую диаграмму.",
      step: "2",
      title: "Понять, почему",
    },
    {
      body: "Каждый ответ заканчивается next step, который можно переслать команде без переписывания.",
      step: "3",
      title: "Понять, что делать дальше",
    },
  ];

  const kpis = [
    {
      title: "Проекты в демо",
      value: String(portfolioBrief.portfolio.totalProjects),
      description: "Живая портфельная витрина на seed-данных",
      icon: <Users className="h-5 w-5" />,
      tone: "neutral" as const,
    },
    {
      title: "Критические сигналы",
      value: String(portfolioBrief.portfolio.criticalProjects),
      description: "Сигналы, которые можно обсудить в чате",
      icon: <AlertTriangle className="h-5 w-5" />,
      tone: portfolioBrief.portfolio.criticalProjects > 0 ? ("danger" as const) : ("success" as const),
    },
    {
      title: "Отклонение бюджета",
      value: `${portfolioBrief.portfolio.budgetVarianceRatio >= 0 ? "+" : ""}${(
        portfolioBrief.portfolio.budgetVarianceRatio * 100
      ).toFixed(1)}%`,
      description: "План-факт и EVM уже готовы к обсуждению",
      icon: <BarChart3 className="h-5 w-5" />,
      tone:
        Math.abs(portfolioBrief.portfolio.budgetVarianceRatio) >= 0.1
          ? ("warning" as const)
          : ("success" as const),
    },
    {
      title: "Просроченные задачи",
      value: String(portfolioBrief.portfolio.overdueTasks),
      description: "Сразу видно, где нужен следующий owner",
      icon: <Clock3 className="h-5 w-5" />,
      tone: portfolioBrief.portfolio.overdueTasks > 0 ? ("warning" as const) : ("success" as const),
    },
  ];

  return (
    <main className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_28%),linear-gradient(180deg,var(--surface) 0%,var(--surface-panel) 100%)] px-4 py-6 text-[var(--ink)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[32px] border border-[color:var(--line)] bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_55%,#2563eb_100%)] text-white shadow-[0_30px_120px_rgba(15,23,42,.18)]">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.15fr_.85fr] lg:p-8">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">Public demo</Badge>
                <Badge variant="info">{source === "mock" ? "Preview data" : "Seeded data"}</Badge>
                <Badge variant="success">5 requests</Badge>
              </div>

              <div className="space-y-4">
                <h1 className="font-heading text-4xl font-semibold tracking-[-0.08em] sm:text-5xl">
                  CEOClaw показывает не общий чат, а факты по проектам, бюджету и рискам.
                </h1>
                <p className="max-w-2xl text-base leading-8 text-slate-100/84">
                  Это публичное демо для первой встречи с продуктом. Здесь уже есть seed-данные,
                  план-факт, evidence и короткий AI-ответ без регистрации.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
              <Link className={cn(buttonVariants({ size: "lg" }), "bg-white text-slate-950 hover:bg-slate-100")} href="#demo-chat">
                Попробовать demo
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/18 bg-white/10 text-white hover:bg-white/15")} href="/demo/stage1">
                Guided Stage 1 demo
              </Link>
              <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/18 bg-white/10 text-white hover:bg-white/15")} href="/signup">
                Запросить доступ
              </Link>
              </div>

              <div className="flex flex-wrap gap-3 text-sm text-slate-100/80">
                <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5">Live brief context</span>
                <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5">Finance + EVM</span>
                <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5">Telegram-ready workflow</span>
              </div>
            </div>

            <div className="grid gap-3 rounded-[28px] border border-white/12 bg-white/10 p-5 backdrop-blur">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <Sparkles className="h-4 w-4" />
                    Что получает пользователь
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">Факты вместо догадок</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">
                    AI читает план-факт, риски, evidence и work reports перед ответом.
                  </p>
                </div>

                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <Bot className="h-4 w-4" />
                    Почему это отличается
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">Lean + useful</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">
                    Продукт можно вести одному разработчику, а ценность уже видна менеджеру.
                  </p>
                </div>

                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <ShieldCheck className="h-4 w-4" />
                    Безопасность
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">Нет регистрации</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">
                    Демо открывается сразу и не трогает закрытые рабочие данные.
                  </p>
                </div>

                <div className="rounded-[20px] border border-white/12 bg-white/8 p-4">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-200/80">
                    <RefreshCw className="h-4 w-4" />
                    Ограничение
                  </div>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.06em]">5 запросов</p>
                  <p className="mt-1 text-sm leading-6 text-slate-100/80">
                    Этого достаточно, чтобы понять ценность, не перегружая API.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {kpis.map((card) => (
            <KpiCard key={card.title} {...card} />
          ))}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {valuePath.map((item) => (
            <Card key={item.step} className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
              <CardHeader className="space-y-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--panel-soft)] text-[var(--brand)]">
                    {item.step}
                  </span>
                  Value path
                </div>
                <CardTitle className="text-xl tracking-[-0.06em]">{item.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-[var(--ink-soft)]">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
          <div className="space-y-6">
            <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="info">Portfolio brief</Badge>
                  <Badge variant="success">Generated now</Badge>
                </div>
                <CardTitle className="text-2xl tracking-[-0.06em]">{portfolioBrief.headline}</CardTitle>
                <CardDescription className="max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">
                  {portfolioBrief.summary}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <MiniStat label="План" value={`${portfolioBrief.portfolio.planFact.plannedProgress.toFixed(1)}%`} />
                  <MiniStat label="Факт" value={`${portfolioBrief.portfolio.planFact.actualProgress.toFixed(1)}%`} />
                  <MiniStat label="CPI / SPI" value={`${formatMetric(portfolioBrief.portfolio.planFact.cpi)} / ${formatMetric(portfolioBrief.portfolio.planFact.spi)}`} />
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-[var(--ink)]">Top alerts</h3>
                  <div className="space-y-2">
                    {portfolioBrief.topAlerts.slice(0, 3).map((alert) => (
                      <div
                        className="flex flex-col gap-2 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                        key={alert.id}
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={alert.severity === "critical" ? "danger" : alert.severity === "high" ? "warning" : "neutral"}>
                              {alert.severity}
                            </Badge>
                            <span className="text-sm font-medium text-[var(--ink)]">{alert.title}</span>
                          </div>
                          <p className="text-sm leading-6 text-[var(--ink-soft)]">{alert.summary}</p>
                        </div>
                        <p className="text-sm leading-6 text-[var(--ink-soft)] sm:max-w-xs sm:text-right">
                          {alert.recommendedAction}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-[var(--brand)]" />
                  <CardTitle className="text-2xl tracking-[-0.06em]">Примеры проектов</CardTitle>
                </div>
                <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                  В демо сразу видны и healthy-проекты, и те, где нужен риск-менеджмент.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {featuredProjects.map((project) => (
                  <DemoProjectCard key={project.id} project={project} />
                ))}
              </CardContent>
            </Card>
          </div>

          <div id="demo-chat" className="min-h-[720px]">
            <PublicDemoChat />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
          <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[var(--brand)]" />
                <CardTitle className="text-2xl tracking-[-0.06em]">Пакеты и pricing</CardTitle>
              </div>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                План нужен для ясности, а не для красивого слайда. Ниже — честная шкала запуска.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {PRICING_PLANS.map((plan) => (
                <PricingCard key={plan.name} {...plan} />
              ))}
            </CardContent>
          </Card>

          <Card className="border-[color:var(--line)] bg-[linear-gradient(135deg,#0f172a_0%,#111827_60%,#1d4ed8_100%)] text-white">
            <CardHeader>
              <Badge variant="neutral">Next step</Badge>
              <CardTitle className="text-2xl tracking-[-0.06em] text-white">Готовы посмотреть на реальную работу?</CardTitle>
              <CardDescription className="text-sm leading-6 text-slate-100/80">
                Демо уже открыто. Когда будете готовы, можно перейти к входу или запросить доступ к основному продукту.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Link className={cn(buttonVariants({ size: "lg" }), "bg-white text-slate-950 hover:bg-slate-100")} href="/demo">
                Открыть demo
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/18 bg-white/10 text-white hover:bg-white/15")} href="/demo/stage1">
                Guided Stage 1 demo
              </Link>
              <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/18 bg-white/10 text-white hover:bg-white/15")} href="/login">
                Войти
              </Link>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
