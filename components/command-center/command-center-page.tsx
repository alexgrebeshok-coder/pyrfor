"use client";

import Link from "next/link";
import { useState } from "react";

import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ExceptionInboxItem, ExceptionInboxResult } from "@/lib/command-center";
import {
  getOperatorTruthBadge,
  type OperatorRuntimeTruth,
} from "@/lib/server/runtime-truth";
import type { WorkReportMemberOption } from "@/lib/work-reports/types";

import { CommandCenterExceptionCard } from "./command-center-exception-card";
import {
  expectedEndpoints,
  formatSyncLabel,
  formatTimestamp,
  translateSyncStatus,
} from "./command-center-page.utils";

export function CommandCenterPage({
  initialInbox,
  liveCommandCenterReady,
  members,
  runtimeTruth,
  fallbackNote,
}: {
  initialInbox: ExceptionInboxResult;
  liveCommandCenterReady: boolean;
  members: WorkReportMemberOption[];
  runtimeTruth: OperatorRuntimeTruth;
  fallbackNote?: string;
}) {
  const [inbox, setInbox] = useState(initialInbox);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runtimeBadge = getOperatorTruthBadge(runtimeTruth);

  const loadInbox = async () => {
    const response = await fetch("/api/command-center/exceptions?limit=24", {
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error?.message ?? "Не удалось обновить exception inbox.");
    }

    setInbox(payload as ExceptionInboxResult);
  };

  const syncInbox = async () => {
    setIsRefreshing(true);
    setError(null);

    try {
      const response = await fetch("/api/command-center/exceptions/sync?limit=24", {
        method: "POST",
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось синхронизировать exception inbox.");
      }

      setInbox(payload as ExceptionInboxResult);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Не удалось синхронизировать exception inbox."
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const updateEscalation = async (
    item: ExceptionInboxItem,
    body: {
      ownerId?: string | null;
      queueStatus?: "open" | "acknowledged" | "resolved";
    }
  ) => {
    setSavingId(item.id);
    setError(null);

    try {
      const response = await fetch(`/api/escalations/${item.sourceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось обновить escalation item.");
      }

      await loadInbox();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Не удалось обновить escalation item."
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="grid min-w-0 gap-4">
      <DomainPageHeader
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/work-reports">
              Открыть рабочие отчёты
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/audit-packs">
              Открыть аудиторские пакеты
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/pilot-feedback">
              Открыть обратную связь пилота
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/integrations">
              Открыть состояние коннекторов
            </Link>
          </>
        }
        chips={[
          ...(fallbackNote ? [{ label: fallbackNote, variant: "warning" as const }] : []),
          { label: runtimeBadge.label, variant: runtimeBadge.variant },
          {
            label: inbox.summary.total > 0 ? `${inbox.summary.total} элементов в очереди` : "Очередь пуста",
            variant: inbox.summary.total > 0 ? "warning" : "success",
          },
          {
            label:
              inbox.summary.critical + inbox.summary.high > 0
                ? `${inbox.summary.critical + inbox.summary.high} критичных/высоких`
                : "Критичных отклонений нет",
            variant: inbox.summary.critical + inbox.summary.high > 0 ? "danger" : "success",
          },
          {
            label:
              inbox.summary.escalations > 0
                ? `${inbox.summary.escalations} эскалаций`
                : "Эскалации не загружены",
            variant: inbox.summary.escalations > 0 ? "warning" : "info",
          },
          {
            label:
              inbox.summary.reconciliation > 0
                ? `${inbox.summary.reconciliation} разрывов сверки`
                : "Разрывы сверки не загружены",
            variant: inbox.summary.reconciliation > 0 ? "info" : "success",
          },
        ]}
        description="Единая операторская очередь поверх эскалаций и сверочных кейсов. Здесь видно, что действительно требует внимания сейчас, кто должен взять это в работу, какой следующий шаг нужен и куда провалиться за деталями источника."
        eyebrow="Операционный контроль"
        title="Центр исключений"
      />

      <OperatorRuntimeCard truth={runtimeTruth} />

      <Card className="min-w-0">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Очередь исключений</CardTitle>
              <CardDescription>
                Самые приоритетные загруженные исключения по эскалациям и разрывам между
                источниками.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="warning">Открыто {inbox.summary.open}</Badge>
              <Badge variant="info">Подтверждено {inbox.summary.acknowledged}</Badge>
              <Badge variant="danger">Критично {inbox.summary.critical}</Badge>
              <Badge variant="warning">Без исполнителя {inbox.summary.unassigned}</Badge>
              <Badge variant="neutral">{formatSyncLabel(inbox)}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)] md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="grid gap-1">
              <div>
                Загружено исключений: <span className="font-semibold text-[var(--ink)]">{inbox.summary.total}</span>
              </div>
              <div>
                Назначено сейчас: <span className="font-semibold text-[var(--ink)]">{inbox.summary.assigned}</span>
              </div>
              <div>
                Последняя общая синхронизация:{" "}
                <span className="font-semibold text-[var(--ink)]">{formatTimestamp(inbox.syncedAt)}</span>
              </div>
              <div>
                Синхронизация сверки:{" "}
                <span className="font-semibold text-[var(--ink)]">
                  {translateSyncStatus(inbox.sync.reconciliation?.status ?? "idle")}
                </span>
              </div>
            </div>
            <div className="flex items-end justify-end">
              <Button
                disabled={!liveCommandCenterReady || isRefreshing}
                onClick={syncInbox}
                size="sm"
                variant="outline"
              >
                {isRefreshing ? "Синхронизация..." : "Синхронизировать входящие"}
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded-[14px] border border-rose-300/70 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {error}
            </div>
          ) : null}

          {liveCommandCenterReady ? (
            inbox.items.length > 0 ? (
              <div className="grid gap-3">
                {inbox.items.map((item) => (
                  <CommandCenterExceptionCard
                    isSaving={savingId === item.id}
                    item={item}
                    key={item.id}
                    members={members}
                    onUpdateEscalation={updateEscalation}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
                Сейчас нет загруженных исключений. Синхронизируйте входящие, если ожидаете новые
                эскалации или разрывы сверки.
              </div>
            )
          ) : (
            <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
              Режим демо или отсутствие живой базы держит центр исключений в безопасном
              предпросмотре. Переключитесь на живые данные, чтобы назначать исполнителей и закрывать
              исключения.
            </div>
          )}
        </CardContent>
      </Card>

      <DomainApiCard
        description="Центр исключений показывает одну операторскую очередь поверх существующих контрактов эскалаций и сверок, а не дублирует эти домены."
        endpoints={expectedEndpoints}
        title="API-эндпоинты"
      />
    </div>
  );
}
