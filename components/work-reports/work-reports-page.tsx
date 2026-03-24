import Link from "next/link";

import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { EscalationQueueCard } from "@/components/work-reports/escalation-queue-card";
import { ReportReviewWorkspace } from "@/components/work-reports/report-review-workspace";
import { ReportBuilderForm } from "@/components/work-reports/report-builder-form";
import { VideoFactIntakeForm } from "@/components/work-reports/video-fact-intake-form";
import { VideoFactSummaryCard } from "@/components/work-reports/video-fact-summary-card";
import { WorkReportActionPilot } from "@/components/work-reports/work-report-action-pilot";
import { WorkReportsOverviewCard } from "@/components/work-reports/work-reports-overview-card";
import type { EscalationListResult } from "@/lib/escalations";
import {
  getOperatorTruthBadge,
  type OperatorRuntimeTruth,
} from "@/lib/server/runtime-truth";
import type { VideoFactListResult } from "@/lib/video-facts/types";
import type {
  WorkReportMemberOption,
  WorkReportProjectOption,
  WorkReportView,
} from "@/lib/work-reports/types";

const expectedEndpoints = [
  {
    method: "GET" as const,
    note: "Получить project-scoped список полевых отчётов с review-статусом и metadata.",
    path: "/api/work-reports",
  },
  {
    method: "POST" as const,
    note: "Создать новый полевой отчёт через manual intake или mapped legacy payload.",
    path: "/api/work-reports",
  },
  {
    method: "POST" as const,
    note: "Подтвердить отчёт и зафиксировать reviewer/comment.",
    path: "/api/work-reports/:reportId/approve",
  },
  {
    method: "POST" as const,
    note: "Отклонить отчёт с обязательным review comment.",
    path: "/api/work-reports/:reportId/reject",
  },
  {
    method: "POST" as const,
    note: "Собрать signal packet из полевого отчёта и запустить runs для tasks, risks и status.",
    path: "/api/work-reports/:reportId/signal-packet",
  },
  {
    method: "POST" as const,
    note: "Скачать собранный signal packet в markdown или JSON для operator handoff.",
    path: "/api/work-reports/:reportId/signal-packet/export",
  },
  {
    method: "POST" as const,
    note: "Отправить approved signal packet в Telegram через delivery ledger или получить dry-run preview.",
    path: "/api/work-reports/:reportId/signal-packet/telegram",
  },
  {
    method: "GET" as const,
    note: "Получить visual evidence summary, собранный из video facts поверх work-report domain.",
    path: "/api/work-reports/video-facts",
  },
  {
    method: "POST" as const,
    note: "Зарегистрировать metadata-only video fact и проверить его against linked work report.",
    path: "/api/work-reports/video-facts",
  },
  {
    method: "GET" as const,
    note: "Посмотреть provenance/trace summary для конкретного AI run из signal packet.",
    path: "/api/ai/runs/:runId/trace",
  },
  {
    method: "GET" as const,
    note: "Прочитать persisted operator escalation queue и увидеть freshness последнего sync job.",
    path: "/api/escalations",
  },
  {
    method: "POST" as const,
    note: "Явно запустить derived sync job для escalation queue поверх work-report signal runs.",
    path: "/api/escalations/sync",
  },
  {
    method: "PATCH" as const,
    note: "Назначить owner или обновить status для escalation item.",
    path: "/api/escalations/:escalationId",
  },
];

export function WorkReportsPage({
  escalationQueue,
  demoMode,
  liveWorkflowReady,
  members,
  projects,
  selectedReportId,
  reports,
  runtimeTruth,
  videoFacts,
}: {
  escalationQueue: EscalationListResult | null;
  demoMode?: string;
  liveWorkflowReady: boolean;
  members: WorkReportMemberOption[];
  projects: WorkReportProjectOption[];
  selectedReportId?: string;
  reports: WorkReportView[];
  runtimeTruth: OperatorRuntimeTruth;
  videoFacts: VideoFactListResult;
}) {
  const pendingReports = reports.filter((report) => report.status === "submitted").length;
  const approvedReports = reports.filter((report) => report.status === "approved").length;
  const telegramBotReports = reports.filter((report) => report.source === "telegram_bot").length;
  const runtimeBadge = getOperatorTruthBadge(runtimeTruth);

  return (
    <div className="grid min-w-0 gap-4">
      <DomainPageHeader
        actions={
          <Link className={buttonVariants({ variant: "outline" })} href="/projects">
            Открыть портфель проектов
          </Link>
        }
        chips={[
          { label: runtimeBadge.label, variant: runtimeBadge.variant },
          { label: liveWorkflowReady ? "Live workflow" : "Safe preview", variant: liveWorkflowReady ? "success" : "warning" },
          { label: "Approval gate", variant: "info" },
          { label: "Telegram-ready", variant: "success" },
          { label: videoFacts.summary.total > 0 ? `${videoFacts.summary.total} video facts` : "Video facts pending", variant: videoFacts.summary.total > 0 ? "info" : "warning" },
          { label: escalationQueue && escalationQueue.summary.total > 0 ? `${escalationQueue.summary.total} escalation items` : "Escalation queue idle", variant: escalationQueue && escalationQueue.summary.total > 0 ? "warning" : "success" },
        ]}
        description="Раздел уже подключён к живому work-reports backend: можно создавать отчёты, ревьюить их в dedicated panel, фиксировать visual facts, видеть проектную ленту, собирать approval-gated signal packets и управлять escalation queue по AI actions."
        eyebrow="Delivery cadence"
        title="Work Reports"
      />

      <OperatorRuntimeCard truth={runtimeTruth} />

      {demoMode === "stage1" ? (
        <Card className="min-w-0 border-[var(--line)] bg-[var(--surface-panel)]">
          <CardHeader>
            <CardTitle>Guided Stage 1 mode</CardTitle>
            <CardDescription className="text-sm leading-6 text-[var(--ink-soft)]">
              Follow the highlighted report, then jump to the signal-packet action pilot below.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <WorkReportsOverviewCard
        approvedReports={approvedReports}
        pendingReports={pendingReports}
        telegramBotReports={telegramBotReports}
        totalReports={reports.length}
      />

      {liveWorkflowReady ? (
        <>
          <ReportReviewWorkspace
            initialSelectedReportId={selectedReportId}
            members={members}
            reports={reports}
            videoFacts={videoFacts}
          />

          <div className="grid gap-4 xl:grid-cols-2">
            <ReportBuilderForm members={members} projects={projects} />
            <VideoFactIntakeForm reports={reports} />
          </div>

          <VideoFactSummaryCard videoFacts={videoFacts} />

          <div id="stage1-action-pilot">
            <WorkReportActionPilot initialReportId={selectedReportId} reports={reports} />
          </div>

          {escalationQueue ? (
            <EscalationQueueCard initialQueue={escalationQueue} members={members} />
          ) : null}
        </>
      ) : null}

      {!liveWorkflowReady ? (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Live delivery workflow is paused</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-[var(--ink-soft)]">
            Demo mode or missing live database configuration keeps this page in a safe preview state. To create reports, review field intake, build signal packets, or manage escalation owners, switch the server back to live data.
          </CardContent>
        </Card>
      ) : null}

      <DomainApiCard
        description="UI уже привязана к реальным backend-контрактам для create/list/review, signal packets, trace inspection и операторской escalation queue."
        endpoints={expectedEndpoints}
        title="Backend Endpoints"
      />
    </div>
  );
}
