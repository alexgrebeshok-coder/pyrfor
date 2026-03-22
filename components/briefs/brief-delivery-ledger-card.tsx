import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";

function resolveStatusVariant(status: BriefDeliveryLedgerRecord["status"]) {
  switch (status) {
    case "delivered":
      return "success";
    case "failed":
      return "danger";
    case "pending":
      return "warning";
    case "preview":
    default:
      return "info";
  }
}

function resolveStatusLabel(status: BriefDeliveryLedgerRecord["status"]) {
  switch (status) {
    case "delivered":
      return "Отправлено";
    case "failed":
      return "Сбой";
    case "pending":
      return "В очереди";
    case "preview":
    default:
      return "Предпросмотр";
  }
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "еще нет";
  }

  return new Date(value).toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

export function BriefDeliveryLedgerCard({
  entries,
  availabilityNote,
}: {
  entries: BriefDeliveryLedgerRecord[];
  availabilityNote?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Журнал доставок</CardTitle>
        <CardDescription>
          Устойчивый журнал исходящих отправок в Telegram, email и по расписанию.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {availabilityNote ? (
          <div className="rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            {availabilityNote}
          </div>
        ) : null}

        {!availabilityNote && entries.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4 text-sm text-[var(--ink-soft)]">
            Пока нет устойчивых записей о доставках.
          </div>
        ) : null}

        {!availabilityNote
          ? entries.map((entry) => (
              <div
                key={entry.id}
                className="grid gap-2 rounded-[14px] border border-[var(--line)] bg-[var(--panel-soft)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={resolveStatusVariant(entry.status)}>{resolveStatusLabel(entry.status)}</Badge>
                  <Badge variant="neutral">{entry.channel}</Badge>
                  <Badge variant={entry.retryPosture === "retryable" ? "warning" : "info"}>
                    повтор: {entry.retryPosture}
                  </Badge>
                  <span className="text-xs text-[var(--ink-soft)]">
                    {entry.scope} · {entry.mode} · попыток {entry.attemptCount}
                  </span>
                </div>
                <div className="text-sm font-medium text-[var(--ink)]">{entry.headline}</div>
                <div className="text-xs text-[var(--ink-soft)]">
                  Цель {entry.target ?? "значение коннектора по умолчанию"} · обновлено {formatTimestamp(entry.updatedAt)}
                  {entry.providerMessageId ? ` · провайдер ${entry.providerMessageId}` : ""}
                </div>
                {entry.lastError ? (
                  <div className="text-xs text-rose-700">{entry.lastError}</div>
                ) : null}
              </div>
            ))
          : null}
      </CardContent>
    </Card>
  );
}
