import type { ExceptionInboxItem, ExceptionInboxResult } from "@/lib/command-center";

export const expectedEndpoints = [
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

export function urgencyVariant(urgency: ExceptionInboxItem["urgency"]) {
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

export function urgencyLabel(urgency: ExceptionInboxItem["urgency"]) {
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

export function statusVariant(status: ExceptionInboxItem["status"]) {
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

export function statusLabel(status: ExceptionInboxItem["status"]) {
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

export function layerVariant(layer: ExceptionInboxItem["layer"]) {
  return layer === "escalation" ? "danger" : "info";
}

export function layerLabel(layer: ExceptionInboxItem["layer"]) {
  return layer === "escalation" ? "Эскалация" : "Сверка";
}

export function ownerVariant(item: ExceptionInboxItem) {
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

export function ownerModeLabel(mode: ExceptionInboxItem["owner"]["mode"]) {
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

export function sourceStateLabel(value: string) {
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

export function formatTimestamp(value: string | null) {
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

export function formatSyncLabel(result: ExceptionInboxResult) {
  const escalationStatus = result.sync.escalations?.status ?? "idle";
  const reconciliationStatus = result.sync.reconciliation?.status ?? "idle";
  return `Эск: ${translateSyncStatus(escalationStatus)} · Сверка: ${translateSyncStatus(
    reconciliationStatus
  )}`;
}

export function translateSyncStatus(status: string) {
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
