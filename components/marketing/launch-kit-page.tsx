import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  FileText,
  Mail,
  MessageSquareText,
  PlayCircle,
  Sparkles,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PRODUCT_HUNT_POINTS = [
  "Title: CEOClaw — AI project cockpit for budgets, evidence, and briefs.",
  "Tagline: Ask for facts, not vibes.",
  "Why now: one developer + AI can ship a real PMO workflow without a large team.",
  "Screenshot order: hero, AI facts block, finance/EVM, Telegram brief, billing/pricing.",
];

const HABR_OUTLINE = [
  "Заголовок: Как я сделал AI PM Dashboard в одиночку: факты, бюджет и Telegram-briefs вместо хаоса.",
  "Вступление: почему PMO-команды тонут в таблицах и разрозненных отчётах.",
  "Середина: как AI отвечает только на фактах из проекта, бюджета и evidence.",
  "Финал: что уже работает в lite-версии и чему научил запуск.",
];

const TELEGRAM_POSTS = [
  {
    title: "Post 1 — teaser",
    body:
      "Собрал CEOClaw — AI project cockpit для проектов, бюджетов и briefs. Идея простая: не ещё один чатбот, а рабочая панель, где ответы привязаны к фактам, а не к ощущениям.",
  },
  {
    title: "Post 2 — demo clip",
    body:
      "Показываю 30 секунд демо: открываем проект, смотрим факты, проверяем бюджет и получаем короткий brief в Telegram. Именно так должен выглядеть PMO-инструмент для busy team.",
  },
  {
    title: "Post 3 — finance angle",
    body:
      "Самая сильная часть продукта — finance-aware AI. Когда в ответе есть план/факт, EVM и риски, решение перестаёт быть 'умным текстом' и становится управленческим действием.",
  },
];

const DEMO_SCRIPT = [
  {
    time: "0:00–0:20",
    title: "Pain",
    body: "Покажите хаос: таблицы, отчёты, уведомления и отсутствие одного места для решения.",
  },
  {
    time: "0:20–0:50",
    title: "Product",
    body: "Покажите проект, AI-ответ с фактами и блок с план/факт, CPI/SPI и рисками.",
  },
  {
    time: "0:50–1:20",
    title: "Retention loop",
    body: "Покажите Telegram brief и weekly digest — продукт возвращает пользователя в работу.",
  },
  {
    time: "1:20–2:00",
    title: "CTA",
    body: "Закончите призывом к публичному демо и короткому signup flow.",
  },
];

const EMAIL_SEQUENCE = [
  {
    day: "Day 0",
    subject: "Welcome to CEOClaw",
    body: "Thanks for signing up — here is your first project, how to ask the AI, and where to find the demo.",
  },
  {
    day: "Day 3",
    subject: "3 ways to get value faster",
    body: "Show the three fastest workflows: project summary, risk check, and budget review.",
  },
  {
    day: "Day 7",
    subject: "Your weekly PMO brief",
    body: "Highlight the new briefing loop: what changed, what needs attention, and what to do next.",
  },
  {
    day: "Day 14",
    subject: "Ready for the upgrade?",
    body: "Explain why teams with more projects, users, and Telegram briefs should move to the next tier.",
  },
];

export function LaunchKitPage() {
  return (
    <main className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_30%),linear-gradient(180deg,var(--surface) 0%,var(--surface-panel) 100%)] px-4 py-6 text-[var(--ink)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[32px] border border-[color:var(--line)] bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_55%,#2563eb_100%)] text-white shadow-[0_30px_120px_rgba(15,23,42,.18)]">
          <div className="grid gap-8 p-6 lg:grid-cols-[1.15fr_.85fr] lg:p-8">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">CEOClaw</Badge>
                <Badge variant="info">Launch kit</Badge>
                <Badge variant="success">Product Hunt</Badge>
                <Badge variant="success">Habr + Telegram</Badge>
              </div>

              <div className="space-y-4">
                <h1 className="font-heading text-4xl font-semibold tracking-[-0.08em] sm:text-5xl">
                  A reusable GTM kit for the first public launch.
                </h1>
                <p className="max-w-2xl text-base leading-8 text-slate-100/84">
                  This page holds the launch-ready copy for Product Hunt, Habr, Telegram, the 2-minute demo,
                  and the welcome emails. Use it as the single source of truth when you prepare the public push.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link className={cn(buttonVariants({ size: "lg" }), "bg-white text-slate-950 hover:bg-slate-100")} href="/demo">
                  Open demo
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
                <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }), "border-white/18 bg-white/10 text-white hover:bg-white/15")} href="/landing">
                  Back to landing
                </Link>
              </div>
            </div>

            <Card className="border-white/12 bg-white/10 text-white shadow-none">
              <CardHeader>
                <Badge className="w-fit" variant="neutral">
                  Launch framing
                </Badge>
                <CardTitle className="text-2xl tracking-[-0.06em] text-white">The story in one sentence</CardTitle>
                <CardDescription className="text-sm leading-6 text-slate-100/80">
                  CEOClaw helps project teams see what changed, why it matters, and what to do next — grounded in facts,
                  finance, and a short Telegram-style brief.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-6 text-slate-100/82">
                <p className="flex gap-2">
                  <Sparkles className="mt-1 h-4 w-4 shrink-0 text-white" />
                  <span>Position the product as a PMO cockpit, not a generic chatbot.</span>
                </p>
                <p className="flex gap-2">
                  <Bot className="mt-1 h-4 w-4 shrink-0 text-white" />
                  <span>Lead with fact-grounded answers and budget-aware recommendations.</span>
                </p>
                <p className="flex gap-2">
                  <Users className="mt-1 h-4 w-4 shrink-0 text-white" />
                  <span>Keep the story simple enough for PMs, PMOs, finance, and operations leaders.</span>
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-2xl tracking-[-0.06em]">Product Hunt listing</CardTitle>
                <Badge variant="info">English</Badge>
              </div>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                Keep the public listing short, clear, and anchored in the problem the product solves.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-6 text-[var(--ink-soft)]">
              <div>
                <p className="font-semibold text-[var(--ink)]">Recommended copy</p>
                <p className="mt-1">CEOClaw — AI project cockpit for budgets, evidence, and briefs.</p>
                <p className="mt-1 text-[var(--ink)]/85">Tagline: Ask for facts, not vibes.</p>
              </div>
              <ul className="space-y-2">
                {PRODUCT_HUNT_POINTS.map((point) => (
                  <li className="flex gap-2" key={point}>
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-2xl tracking-[-0.06em]">Habr article</CardTitle>
                <Badge variant="info">Russian</Badge>
              </div>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                The article should sound like a founder story plus a useful teardown of the product pattern.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-[var(--ink-soft)]">
              {HABR_OUTLINE.map((point) => (
                <p className="flex gap-2" key={point}>
                  <FileText className="mt-1 h-4 w-4 shrink-0 text-[var(--brand)]" />
                  <span>{point}</span>
                </p>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="info">Telegram rollout</Badge>
            <Badge variant="neutral">3 posts</Badge>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {TELEGRAM_POSTS.map((post) => (
              <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96" key={post.title}>
                <CardHeader className="space-y-3">
                  <CardTitle className="text-xl tracking-[-0.05em]">{post.title}</CardTitle>
                  <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                    Short, readable, and easy to paste into PM or AI channels.
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm leading-7 text-[var(--ink-soft)]">{post.body}</CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
          <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-2xl tracking-[-0.06em]">2-minute demo video</CardTitle>
                <Badge variant="info">Video script</Badge>
              </div>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                Keep the demo short. The first 20 seconds should explain the pain, not the UI details.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-[var(--ink-soft)]">
              {DEMO_SCRIPT.map((step) => (
                <div className="rounded-2xl border border-[color:var(--line)] bg-[var(--panel-soft)] p-4" key={step.time}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[var(--ink)]">{step.title}</p>
                    <span className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-soft)]">{step.time}</span>
                  </div>
                  <p className="mt-2">{step.body}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-2xl tracking-[-0.06em]">Welcome email sequence</CardTitle>
                <Badge variant="info">Retention</Badge>
              </div>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                The launch email sequence should teach, activate, and then upgrade without feeling pushy.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-[var(--ink-soft)]">
              {EMAIL_SEQUENCE.map((item) => (
                <div className="rounded-2xl border border-[color:var(--line)] bg-[var(--panel-soft)] p-4" key={item.day}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[var(--ink)]">{item.day}</p>
                    <span className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--ink-soft)]">{item.subject}</span>
                  </div>
                  <p className="mt-2">{item.body}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]">
          <Card className="border-[color:var(--line)] bg-[color:var(--surface-panel)]/96">
            <CardHeader>
              <div className="flex items-center gap-2">
                <MessageSquareText className="h-5 w-5 text-[var(--brand)]" />
                <CardTitle className="text-2xl tracking-[-0.06em]">Use this page as the copy source</CardTitle>
              </div>
              <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
                If you want to rewrite the launch, update this page first. Everything else can point back here.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Link className={cn(buttonVariants({ size: "lg" }), "bg-[var(--brand)] text-white hover:bg-[var(--brand-strong)]")} href="/landing">
                Open landing
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }))} href="/demo">
                Open demo
              </Link>
            </CardContent>
          </Card>

          <Card className="border-[color:var(--line)] bg-[linear-gradient(135deg,#0f172a_0%,#111827_60%,#1d4ed8_100%)] text-white">
            <CardHeader>
              <Badge variant="neutral">Launch reminder</Badge>
              <CardTitle className="text-2xl tracking-[-0.06em] text-white">Ship the story, not just the product.</CardTitle>
              <CardDescription className="text-sm leading-6 text-slate-100/80">
                A clear launch narrative helps the product feel real before the first paid customer even arrives.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-slate-100/82">
              <p className="flex gap-2">
                <PlayCircle className="mt-1 h-4 w-4 shrink-0 text-white" />
                <span>Keep the demo focused on one outcome: the user sees facts and leaves with a decision.</span>
              </p>
              <p className="flex gap-2">
                <Mail className="mt-1 h-4 w-4 shrink-0 text-white" />
                <span>Use the email sequence to teach the workflow and bring people back to the product.</span>
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
