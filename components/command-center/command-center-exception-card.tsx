import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { fieldStyles } from "@/components/ui/field";
import type { ExceptionInboxItem } from "@/lib/command-center";
import { buildPilotFeedbackPrefillHref } from "@/lib/pilot-feedback/types";
import type { WorkReportMemberOption } from "@/lib/work-reports/types";

import {
  formatTimestamp,
  layerLabel,
  layerVariant,
  ownerModeLabel,
  ownerVariant,
  sourceStateLabel,
  statusLabel,
  statusVariant,
  urgencyLabel,
  urgencyVariant,
} from "./command-center-page.utils";

type EscalationUpdatePayload = {
  ownerId?: string | null;
  queueStatus?: "open" | "acknowledged" | "resolved";
};

export function CommandCenterExceptionCard({
  item,
  members,
  isSaving,
  onUpdateEscalation,
}: {
  item: ExceptionInboxItem;
  members: WorkReportMemberOption[];
  isSaving: boolean;
  onUpdateEscalation: (item: ExceptionInboxItem, body: EscalationUpdatePayload) => Promise<void>;
}) {
  const assignedOwnerId = item.owner.mode === "assigned" ? item.owner.id ?? "" : "";
  const isEscalation = item.layer === "escalation";

  return (
    <div className="rounded-[16px] border border-[var(--line)] bg-[var(--panel-soft)] p-4">
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

      <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            Источник
          </div>
          <div className="mt-1 font-medium text-[var(--ink)]">{item.sourceLabel}</div>
          <div className="mt-1 text-xs text-[var(--ink-soft)]">
            {sourceStateLabel(item.sourceState)}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            Исполнитель
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant={ownerVariant(item)}>{ownerModeLabel(item.owner.mode)}</Badge>
            <span className="font-medium text-[var(--ink)]">{item.owner.name}</span>
          </div>
          <div className="mt-1 text-xs text-[var(--ink-soft)]">
            {item.owner.role ?? "Роль не указана"}
          </div>
        </div>
        <div className="md:col-span-2">
          <div className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            Следующее действие
          </div>
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
              item.layer === "reconciliation" ? "reconciliation_casefile" : "exception_item",
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
              disabled={isSaving}
              onChange={(event) =>
                void onUpdateEscalation(item, {
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
                disabled={isSaving}
                onClick={() =>
                  void onUpdateEscalation(item, {
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
                disabled={isSaving}
                onClick={() =>
                  void onUpdateEscalation(item, {
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
}
