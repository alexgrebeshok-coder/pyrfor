import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { VideoFactListResult } from "@/lib/video-facts/types";

import {
  formatObservationTypeLabel,
  formatPercent,
  formatShortDate,
  formatVerificationStatus,
} from "@/components/field-operations/field-operations-utils";

export function FieldOperationsMediaTab({
  recentVideoFacts,
  videoFacts,
}: {
  recentVideoFacts: VideoFactListResult["items"];
  videoFacts: VideoFactListResult;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Фото и видео</CardTitle>
          <CardDescription>
            Визуальные факты помогают быстро подтвердить прогресс, блокеры и
            безопасность на площадке.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {recentVideoFacts.length > 0 ? (
            recentVideoFacts.map((item) => (
              <div
                className="rounded-[18px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                key={item.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[var(--ink)]">
                      {item.title}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ink-soft)]">
                      {item.projectName ?? "Проект не указан"}
                      {item.section ? ` · ${item.section}` : ""}
                    </div>
                  </div>
                  <Badge
                    variant={item.verificationStatus === "verified" ? "success" : "info"}
                  >
                    {formatVerificationStatus(item.verificationStatus)}
                  </Badge>
                </div>
                {item.summary ? (
                  <div className="mt-3 text-sm text-[var(--ink-muted)]">{item.summary}</div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
                  <Badge variant="neutral">
                    {formatObservationTypeLabel(item.observationType)}
                  </Badge>
                  <Badge variant="info">{formatPercent(item.confidence)}</Badge>
                  <span>{formatShortDate(item.capturedAt)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[18px] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-soft)]">
              Пока нет визуальных фактов. Добавьте видео или фото к рабочему отчёту, и
              эта вкладка оживёт.
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Сводка визуальных фактов</CardTitle>
              <CardDescription>
                Первый контур визуальных подтверждений: фотографии и видео, связанные с
                отчётами, площадками и статусом проверки.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="info">Зафиксировано {videoFacts.summary.observed}</Badge>
              <Badge variant="success">
                Подтверждено {videoFacts.summary.verified}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)] sm:grid-cols-3">
            <div>
              <div className="font-medium text-[var(--ink)]">Всего фактов</div>
              <div className="mt-1">{videoFacts.summary.total}</div>
            </div>
            <div>
              <div className="font-medium text-[var(--ink)]">Средняя уверенность</div>
              <div className="mt-1">
                {formatPercent(videoFacts.summary.averageConfidence)}
              </div>
            </div>
            <div>
              <div className="font-medium text-[var(--ink)]">Последняя съёмка</div>
              <div className="mt-1">{formatShortDate(videoFacts.summary.lastCapturedAt)}</div>
            </div>
          </div>

          {videoFacts.items.length > 0 ? (
            <div className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
              Последний факт:{" "}
              <span className="font-medium text-[var(--ink)]">
                {videoFacts.items[0]?.title}
              </span>
            </div>
          ) : (
            <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
              Визуальные факты пока не поступают. Когда появятся фото или видео, эта
              сводка оживёт.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
