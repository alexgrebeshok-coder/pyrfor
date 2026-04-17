import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { EnterpriseTruthOverview } from "@/lib/enterprise-truth";
import type { EscalationListResult } from "@/lib/escalations";
import type { WorkReportView } from "@/lib/work-reports/types";

import {
  formatReportStatus,
  formatRussianQueueItem,
  formatShortDate,
} from "@/components/field-operations/field-operations-utils";

export function FieldOperationsEventsTab({
  escalationQueue,
  latestReports,
  telemetryGaps,
}: {
  escalationQueue: EscalationListResult | null;
  latestReports: WorkReportView[];
  telemetryGaps: EnterpriseTruthOverview["telemetryGaps"];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <Card>
        <CardHeader>
          <CardTitle>События поля</CardTitle>
          <CardDescription>
            Последние отчёты, разрывы телеметрии и точки, где управленческое внимание
            нужно уже сейчас.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {latestReports.length > 0 ? (
            latestReports.map((report) => (
              <div
                className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                key={report.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-[var(--ink)]">
                      {report.reportNumber}
                    </div>
                    <div className="mt-1 text-sm text-[var(--ink-soft)]">
                      {report.project.name} · {report.section}
                    </div>
                  </div>
                  <Badge
                    variant={
                      report.status === "approved"
                        ? "success"
                        : report.status === "rejected"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {formatReportStatus(report.status)}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-1 text-sm text-[var(--ink-muted)]">
                  <div>Дата: {formatShortDate(report.reportDate)}</div>
                  <div>Людей: {report.personnelCount ?? "—"}</div>
                  <div>Техника: {report.equipment ?? "—"}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[18px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)]">
              Пока нет свежих отчётов для показа.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Разрывы телеметрии</CardTitle>
            <CardDescription>
              Объекты, по которым GPS и поле ещё не сходятся в единый слой правды.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {telemetryGaps.length > 0 ? (
              telemetryGaps.map((gap) => (
                <div
                  className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                  key={gap.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-[var(--ink)]">
                        {gap.equipmentId ?? "Без идентификатора техники"}
                      </div>
                      <div className="mt-1 text-xs text-[var(--ink-soft)]">
                        {gap.geofenceName ?? "Геозона не указана"}
                      </div>
                    </div>
                    <Badge variant="warning">разрыв</Badge>
                  </div>
                  <div className="mt-3 text-sm text-[var(--ink-muted)]">
                    {gap.explanation}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[18px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)]">
                Пока разрывов телеметрии не обнаружено.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Эскалации</CardTitle>
            <CardDescription>Текущая очередь для управленческой реакции.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-[var(--ink-soft)]">
            {escalationQueue && escalationQueue.summary.total > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span>Очередь</span>
                  <Badge variant="warning">
                    {escalationQueue.summary.total}{" "}
                    {formatRussianQueueItem(escalationQueue.summary.total)}
                  </Badge>
                </div>
                <div>Открыто: {escalationQueue.summary.open}</div>
                <div>Принято: {escalationQueue.summary.acknowledged}</div>
                <div>Закрыто: {escalationQueue.summary.resolved}</div>
                <div>Критических: {escalationQueue.summary.critical}</div>
              </div>
            ) : (
              <div>Очередь эскалаций пуста или ещё не синхронизирована.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
