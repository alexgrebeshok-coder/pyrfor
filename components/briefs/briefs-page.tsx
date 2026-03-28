import Link from "next/link";

import { BriefDeliveryLedgerCard } from "@/components/briefs/brief-delivery-ledger-card";
import { BriefQueueTable } from "@/components/briefs/brief-queue-table";
import { KnowledgeLoopCard } from "@/components/briefs/knowledge-loop-card";
import { BriefRequestForm } from "@/components/briefs/brief-request-form";
import { BriefsOverviewCard } from "@/components/briefs/briefs-overview-card";
import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type { PortfolioBrief, ProjectBrief } from "@/lib/briefs/types";
import type { KnowledgeLoopOverview } from "@/lib/knowledge";
import {
  getOperatorTruthBadge,
  type OperatorRuntimeTruth,
} from "@/lib/server/runtime-truth";

const expectedEndpoints = [
  {
    method: "GET" as const,
    note: "Получить сводку портфеля с заголовком, разделами, форматами и главными сигналами.",
    path: "/api/briefs/portfolio?locale=ru",
  },
  {
    method: "GET" as const,
    note: "Получить проектную сводку для конкретного проекта с рекомендациями и форматами доставки.",
    path: "/api/briefs/project/:projectId?locale=ru",
  },
  {
    method: "GET" as const,
    note: "Получить приоритизированную ленту сигналов, на которой строится руководительский обзор.",
    path: "/api/alerts/prioritized?limit=5&locale=ru",
  },
  {
    method: "POST" as const,
    note: "Предпросмотр или отправка руководительской сводки в Telegram через живой коннектор.",
    path: "/api/connectors/telegram/briefs",
  },
  {
    method: "POST" as const,
    note: "Предпросмотр или отправка руководительской сводки по email через живой SMTP-коннектор.",
    path: "/api/connectors/email/briefs",
  },
  {
    method: "GET" as const,
    note: "Получить сохранённые правила плановой доставки для Telegram-сводок.",
    path: "/api/connectors/telegram/briefs/policies",
  },
  {
    method: "POST" as const,
    note: "Запустить сводки, которые уже должны выйти по расписанию, через безопасный cron-эндпоинт.",
    path: "/api/connectors/telegram/briefs/policies/run-due",
  },
  {
    method: "POST" as const,
    note: "Отправить недельный AI Digest email всем opt-in получателям через retention cron.",
    path: "/api/retention/email-digest/run-due",
  },
  {
    method: "POST" as const,
    note: "Отправить утренний Telegram brief через retention cron.",
    path: "/api/retention/telegram-morning-brief/run-due",
  },
  {
    method: "POST" as const,
    note: "Прогнать welcome sequence Day1→Day14 для новых пользователей через retention cron.",
    path: "/api/retention/welcome-sequence/run-due",
  },
  {
    method: "GET" as const,
    note: "Получить переиспользуемые playbook'и и рекомендации на основе бенчмарков и истории эскалаций.",
    path: "/api/briefs/knowledge?limit=4",
  },
];

export function BriefsPage({
  portfolioBrief,
  projectBriefs,
  projectOptions,
  knowledgeLoop,
  knowledgeLoopAvailabilityNote,
  deliveryLedgerEntries,
  deliveryLedgerAvailabilityNote,
  runtimeTruth,
  fallbackNote,
}: {
  portfolioBrief: PortfolioBrief;
  projectBriefs: ProjectBrief[];
  projectOptions: Array<{ id: string; name: string }>;
  knowledgeLoop: KnowledgeLoopOverview;
  knowledgeLoopAvailabilityNote?: string;
  deliveryLedgerEntries: BriefDeliveryLedgerRecord[];
  deliveryLedgerAvailabilityNote?: string;
  runtimeTruth: OperatorRuntimeTruth;
  fallbackNote?: string;
}) {
  const leadProjectBrief = projectBriefs[0] ?? null;
  const runtimeBadge = getOperatorTruthBadge(runtimeTruth);
  const valuePath = [
    {
      body: "Один brief должен сразу показать, где риск, где деньги и что важнее сегодня.",
      step: "1",
      title: "Понять картину дня",
    },
    {
      body: "Каждая сводка должна объяснять, почему это важно, а не только перечислять цифры.",
      step: "2",
      title: "Понять причину",
    },
    {
      body: "Сводку можно сразу отправить в Telegram или email без ручной переписки.",
      step: "3",
      title: "Понять, куда отправить",
    },
  ];

  return (
    <div className="grid gap-4">
      <DomainPageHeader
        actions={
          <Link className={buttonVariants({ variant: "outline" })} href="/analytics">
            Сверить сигналы портфеля
          </Link>
        }
        chips={[
          ...(fallbackNote ? [{ label: fallbackNote, variant: "warning" as const }] : []),
          { label: runtimeBadge.label, variant: runtimeBadge.variant },
          {
            label: `${portfolioBrief.topAlerts.length} критичных сигналов`,
            variant: portfolioBrief.topAlerts.length > 0 ? "warning" : "success",
          },
          { label: "Форматы на русском и английском", variant: "info" },
          { label: "Доставка в Telegram", variant: "info" },
          { label: "Доставка по email", variant: "info" },
          { label: "Плановые сводки", variant: "info" },
          { label: "Контур знаний", variant: "info" },
        ]}
        description="Страница сводок уже опирается на живой движок брифов: сводку портфеля, сводки по проектам, форматы доставки и переиспользуемые знания оператора поверх истории эскалаций."
        eyebrow="Коммуникации для руководства"
        title="Сводки для руководства"
      />

      <section className="grid gap-4 md:grid-cols-3">
        {valuePath.map((item) => (
          <Card key={item.step} className="border-[var(--line)] bg-[var(--surface-panel)]">
            <CardHeader className="gap-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--panel-soft)] text-[var(--brand)]">
                  {item.step}
                </span>
                Value path
              </div>
              <CardTitle className="text-lg tracking-[-0.04em]">{item.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-[var(--ink-soft)]">{item.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <OperatorRuntimeCard truth={runtimeTruth} />

      <BriefsOverviewCard portfolioBrief={portfolioBrief} />

      <KnowledgeLoopCard
        availabilityNote={knowledgeLoopAvailabilityNote}
        overview={knowledgeLoop}
      />

      <BriefDeliveryLedgerCard
        availabilityNote={deliveryLedgerAvailabilityNote}
        entries={deliveryLedgerEntries}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <BriefQueueTable portfolioBrief={portfolioBrief} projectBriefs={projectBriefs} />
        <BriefRequestForm
          portfolioBrief={portfolioBrief}
          projectBrief={leadProjectBrief}
          projectOptions={projectOptions}
        />
      </div>

      <DomainApiCard
        description="Интерфейс теперь соответствует реальным эндпоинтам сводок и сигналов, а не вымышленной модели очереди публикаций."
        endpoints={expectedEndpoints}
        title="API-эндпоинты"
      />
    </div>
  );
}
