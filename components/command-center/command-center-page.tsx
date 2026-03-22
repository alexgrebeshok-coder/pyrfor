"use client";

import Link from "next/link";
import { useState } from "react";

import { DomainApiCard } from "@/components/layout/domain-api-card";
import { DomainPageHeader } from "@/components/layout/domain-page-header";
import { OperatorRuntimeCard } from "@/components/layout/operator-runtime-card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldStyles } from "@/components/ui/field";
import type {
  ExceptionInboxItem,
  ExceptionInboxResult,
} from "@/lib/command-center";
import {
  getOperatorTruthBadge,
  type OperatorRuntimeTruth,
} from "@/lib/server/runtime-truth";
import type { WorkReportMemberOption } from "@/lib/work-reports/types";
import { buildPilotFeedbackPrefillHref } from "@/lib/pilot-feedback/types";

const expectedEndpoints = [
  {
    method: "GET" as const,
    note: "Прочитать unified exception inbox поверх escalation queue и reconciliation casefiles.",
    path: "/api/command-center/exceptions?limit=24",
  },
  {
    method: "POST" as const,
    note: "Явно пересобрать exception inbox через escalation и reconciliation sync boundaries.",
    path: "/api/command-center/exceptions/sync?limit=24",
  },
  {
    method: "PATCH" as const,
    note: "Назначить owner или обновить closure state для escalation item прямо из inbox flow.",
    path: "/api/escalations/:escalationId",
  },
  {
    method: "GET" as const,
    note: "Открыть reconciliation source detail для mismatch reasons и linked truth slices.",
    path: "/api/reconciliation/casefiles?limit=12",
  },
];

function urgencyVariant(urgency: ExceptionInboxItem["urgency"]) {
  switch (urgency) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    case "low":
    default:
      return "neutral";
  }
}

function urgencyLabel(urgency: ExceptionInboxItem["urgency"]) {
  switch (urgency) {
    case "critical":
      return "Критично";
    case "high":
      return "Высокий";
    case "medium":
      return "Средний";
    case "low":
    default:
      return "Низкий";
  }
}

function statusVariant(status: ExceptionInboxItem["status"]) {
  switch (status) {
    case "resolved":
      return "success";
    case "acknowledged":
      return "info";
    case "open":
    default:
      return "warning";
  }
}

function statusLabel(status: ExceptionInboxItem["status"]) {
  switch (status) {
    case "resolved":
      return "Закрыто";
    case "acknowledged":
      return "Подтверждено";
    case "open":
    default:
      return "Открыто";
  }
}

function layerVariant(layer: ExceptionInboxItem["layer"]) {
  return layer === "escalation" ? "danger" : "info";
}

function layerLabel(layer: ExceptionInboxItem["layer"]) {
  return layer === "escalation" ? "Эскалация" : "Сверка";
}

function ownerVariant(item: ExceptionInboxItem) {
  switch (item.owner.mode) {
    case "assigned":
      return "success";
    case "suggested":
      return "info";
    case "unassigned":
    default:
      return "warning";
  }
}

function ownerModeLabel(mode: ExceptionInboxItem["owner"]["mode"]) {
  switch (mode) {
    case "assigned":
      return "Назначен";
    case "suggested":
      return "Предложен";
    case "unassigned":
    default:
      return "Не назначен";
  }
}

function sourceStateLabel(value: string) {
  switch (value) {
    case "needs_approval":
      return "Требует подтверждения";
    case "failed":
      return "Сбой";
    case "queued":
      return "В очереди";
    case "open":
      return "Открыто";
    case "acknowledged":
      return "Подтверждено";
    case "resolved":
      return "Закрыто";
    case "contradictory":
      return "Противоречие";
    case "ready":
      return "Готово";
    case "pending":
      return "Ожидание";
    default:
      return value;
  }
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Недоступно";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSyncLabel(result: ExceptionInboxResult) {
  const escalationStatus = result.sync.escalations?.status ?? "idle";
  const reconciliationStatus = result.sync.reconciliation?.status ?? "idle";
  return `Эск: ${translateSyncStatus(escalationStatus)} · Сверка: ${translateSyncStatus(reconciliationStatus)}`;
}

function translateSyncStatus(status: string) {
  switch (status) {
    case "idle":
      return "ожидание";
    case "running":
      return "выполняется";
    case "done":
    case "complete":
      return "готово";
    case "failed":
      return "сбой";
    default:
      return status;
  }
}

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
                Самые приоритетные загруженные исключения по эскалациям и разрывам между источниками.
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
                Последняя общая синхронизация: <span className="font-semibold text-[var(--ink)]">{formatTimestamp(inbox.syncedAt)}</span>
              </div>
              <div>
                Синхронизация сверки: <span className="font-semibold text-[var(--ink)]">{translateSyncStatus(inbox.sync.reconciliation?.status ?? "idle")}</span>
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
                {inbox.items.map((item) => {
                  const assignedOwnerId = item.owner.mode === "assigned" ? item.owner.id ?? "" : "";
                  const isEscalation = item.layer === "escalation";

                  return (
                    <div
                      className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
                      key={item.id}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-[var(--ink)]">{item.title}</div>
                          <div className="mt-1 text-xs text-[var(--ink-soft)]">
                            {item.projectName ?? "Проект не связан"}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={layerVariant(item.layer)}>{layerLabel(item.layer)}</Badge>
                          <Badge variant={urgencyVariant(item.urgency)}>{urgencyLabel(item.urgency)}</Badge>
                          <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                        </div>
                      </div>

                      <div className="mt-3 text-sm text-[var(--ink-soft)]">
                        {item.summary ?? "Дополнительный контекст не указан."}
                      </div>

                      <div className="mt-3 grid gap-3 text-sm grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Источник</div>
                          <div className="mt-1 font-medium text-[var(--ink)]">
                            {item.sourceLabel}
                          </div>
                          <div className="mt-1 text-xs text-[var(--ink-soft)]">{sourceStateLabel(item.sourceState)}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Исполнитель</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <Badge variant={ownerVariant(item)}>{ownerModeLabel(item.owner.mode)}</Badge>
                            <span className="font-medium text-[var(--ink)]">{item.owner.name}</span>
                          </div>
                          <div className="mt-1 text-xs text-[var(--ink-soft)]">
                            {item.owner.role ?? "Роль не указана"}
                          </div>
                        </div>
                        <div className="md:col-span-2">
                          <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Следующее действие</div>
                          <div className="mt-1 text-[var(--ink)]">{item.nextAction}</div>
                          <div className="mt-1 text-xs text-[var(--ink-soft)]">
                            Обнаружено {formatTimestamp(item.observedAt)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          href={buildPilotFeedbackPrefillHref({
                            projectId: item.projectId,
                            projectName: item.projectName,
                            sourceHref: "/command-center",
                            sourceLabel: item.sourceLabel,
                            targetId: item.id,
                            targetLabel: item.title,
                            targetType:
                              item.layer === "reconciliation"
                                ? "reconciliation_casefile"
                                : "exception_item",
                          })}
                        >
                          Зафиксировать отзыв
                        </Link>
                        {item.links.map((link) => (
                          <Link
                            className={buttonVariants({ size: "sm", variant: "outline" })}
                            href={link.href}
                            key={`${item.id}:${link.href}:${link.label}`}
                          >
                            {link.label}
                          </Link>
                        ))}
                      </div>

                      {isEscalation ? (
                        <div className="mt-4 grid gap-3 rounded-[14px] border border-[var(--line)]/80 bg-[var(--surface)]/70 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
                          <label className="grid gap-2 text-sm text-[var(--ink-soft)]">
                            <span>Назначить исполнителя</span>
                            <select
                              className={fieldStyles}
                              disabled={savingId === item.id}
                              onChange={(event) =>
                                updateEscalation(item, {
                                  ownerId: event.target.value || null,
                                })
                              }
                              value={assignedOwnerId}
                            >
                              <option value="">Без исполнителя</option>
                              {members.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.name} {member.role ? `· ${member.role}` : ""}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="flex flex-wrap items-end gap-2">
                            {item.status === "open" ? (
                              <Button
                                disabled={savingId === item.id}
                                onClick={() =>
                                  updateEscalation(item, {
                                    queueStatus: "acknowledged",
                                  })
                                }
                                size="sm"
                                variant="outline"
                              >
                                Подтвердить
                              </Button>
                            ) : null}
                            {item.status !== "resolved" ? (
                              <Button
                                disabled={savingId === item.id}
                                onClick={() =>
                                  updateEscalation(item, {
                                    queueStatus: "resolved",
                                  })
                                }
                                size="sm"
                              >
                                Закрыть
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
                Сейчас нет загруженных исключений. Синхронизируйте входящие, если ожидаете новые эскалации или разрывы сверки.
              </div>
            )
          ) : (
            <div className="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
              Режим демо или отсутствие живой базы держит центр исключений в безопасном предпросмотре. Переключитесь на живые данные, чтобы назначать исполнителей и закрывать исключения.
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
