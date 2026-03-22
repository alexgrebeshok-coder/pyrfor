import {
  getEscalationQueueOverview,
  syncEscalationQueue,
  type EscalationListResult,
  type EscalationRecordView,
} from "@/lib/escalations";
import {
  getReconciliationCasefiles,
  syncReconciliationCasefiles,
  type ReconciliationCasefileListResult,
  type ReconciliationCasefileView,
} from "@/lib/enterprise-truth";

import type {
  ExceptionInboxItem,
  ExceptionInboxOwnerView,
  ExceptionInboxQuery,
  ExceptionInboxResult,
  ExceptionInboxStatus,
  ExceptionInboxSummary,
  ExceptionInboxUrgency,
} from "./types";

interface ExceptionInboxDeps {
  escalations?: EscalationListResult;
  getEscalations?: (query: {
    includeResolved?: boolean;
    limit?: number;
  }) => Promise<EscalationListResult>;
  getReconciliation?: (query: {
    limit?: number;
    resolutionStatus?: "open" | "resolved";
  }) => Promise<ReconciliationCasefileListResult>;
  reconciliation?: ReconciliationCasefileListResult;
  syncEscalations?: () => Promise<void>;
  syncReconciliation?: () => Promise<void>;
}

export async function getExecutiveExceptionInbox(
  query: ExceptionInboxQuery = {},
  deps: ExceptionInboxDeps = {}
): Promise<ExceptionInboxResult> {
  const limit = sanitizeLimit(query.limit, 24, 48);
  const getEscalations =
    deps.getEscalations ??
    ((input: { includeResolved?: boolean; limit?: number }) =>
      getEscalationQueueOverview(input));
  const getReconciliation =
    deps.getReconciliation ??
    ((input: { limit?: number; resolutionStatus?: "open" | "resolved" }) =>
      getReconciliationCasefiles(input));

  const [escalations, reconciliation] = await Promise.all([
    deps.escalations ??
      getEscalations({
        includeResolved: query.includeResolved,
        limit,
      }),
    deps.reconciliation ??
      getReconciliation({
        limit,
        ...(query.includeResolved ? {} : { resolutionStatus: "open" }),
      }),
  ]);

  const items = [
    ...escalations.items.map(mapEscalationInboxItem),
    ...reconciliation.cases.map(mapReconciliationInboxItem),
  ]
    .filter((item) => query.includeResolved || item.status !== "resolved")
    .sort(compareInboxItems)
    .slice(0, limit);

  return {
    syncedAt: maxTimestamp([escalations.syncedAt, reconciliation.syncedAt]),
    summary: summarizeInboxItems(items),
    items,
    sync: {
      escalations: escalations.sync,
      reconciliation: reconciliation.sync,
    },
  };
}

export async function syncExecutiveExceptionInbox(
  query: ExceptionInboxQuery = {},
  deps: ExceptionInboxDeps = {}
): Promise<ExceptionInboxResult> {
  const syncEscalations = deps.syncEscalations ?? (() => syncEscalationQueue());
  const syncReconciliation = deps.syncReconciliation ?? (() => syncReconciliationCasefiles());

  await Promise.all([syncEscalations(), syncReconciliation()]);

  return getExecutiveExceptionInbox(query, deps);
}

function mapEscalationInboxItem(item: EscalationRecordView): ExceptionInboxItem {
  return {
    id: `escalation:${item.id}`,
    sourceId: item.id,
    layer: "escalation",
    title: item.title,
    summary: item.summary,
    projectId: item.projectId,
    projectName: item.projectName,
    urgency: item.urgency,
    status: normalizeEscalationStatus(item.queueStatus),
    owner: item.owner
      ? {
          id: item.owner.id,
          mode: "assigned",
          name: item.owner.name,
          role: item.owner.role,
        }
      : item.recommendedOwnerRole
        ? {
            id: null,
            mode: "suggested",
            name: `${formatRoleLabel(item.recommendedOwnerRole)} на сопровождение`,
            role: item.recommendedOwnerRole,
          }
        : {
            id: null,
            mode: "unassigned",
            name: "Не назначен",
            role: null,
          },
    sourceLabel: "Очередь эскалаций",
    sourceState: item.sourceStatus,
    nextAction: buildEscalationNextAction(item),
    observedAt: item.lastObservedAt,
    links: compactLinks([
      { href: "/work-reports", label: "Открыть рабочие отчёты" },
      item.metadata.runId
        ? { href: `/audit-packs?runId=${item.metadata.runId}`, label: "Открыть аудиторский пакет" }
        : null,
      item.projectId
        ? { href: `/projects/${item.projectId}`, label: "Открыть проект" }
        : null,
    ]),
  };
}

function mapReconciliationInboxItem(item: ReconciliationCasefileView): ExceptionInboxItem {
  return {
    id: `reconciliation:${item.id}`,
    sourceId: item.id,
    layer: "reconciliation",
    title: item.title,
    summary: item.explanation,
    projectId: item.projectId,
    projectName: item.projectName,
    urgency: deriveReconciliationUrgency(item),
    status: item.resolutionStatus === "resolved" ? "resolved" : "open",
    owner: deriveReconciliationOwner(item),
    sourceLabel: "Кейс сверки",
    sourceState: item.truthStatus,
    nextAction: buildReconciliationNextAction(item),
    observedAt: item.lastObservedAt,
    links: compactLinks([
      { href: "/integrations", label: "Открыть состояние коннекторов" },
      item.evidenceRecordIds.length > 0 || item.fusionFactIds.length > 0
        ? { href: "/work-reports", label: "Открыть рабочие отчёты" }
        : null,
      item.projectId
        ? { href: `/projects/${item.projectId}`, label: "Открыть проект" }
        : null,
    ]),
  };
}

function summarizeInboxItems(items: ExceptionInboxItem[]): ExceptionInboxSummary {
  return {
    total: items.length,
    open: items.filter((item) => item.status === "open").length,
    acknowledged: items.filter((item) => item.status === "acknowledged").length,
    resolved: items.filter((item) => item.status === "resolved").length,
    critical: items.filter((item) => item.urgency === "critical").length,
    high: items.filter((item) => item.urgency === "high").length,
    assigned: items.filter((item) => item.owner.mode === "assigned").length,
    unassigned: items.filter((item) => item.owner.mode === "unassigned").length,
    escalations: items.filter((item) => item.layer === "escalation").length,
    reconciliation: items.filter((item) => item.layer === "reconciliation").length,
  };
}

function buildEscalationNextAction(item: EscalationRecordView) {
  if (!item.owner) {
    return "Назначьте исполнителя и подтвердите элемент до того, как он выйдет за SLA.";
  }

  if (item.queueStatus === "open" && item.sourceStatus === "needs_approval") {
    return "Проверьте заблокированное предложение, примите решение по подтверждению и зафиксируйте передачу.";
  }

  if (item.queueStatus === "open" && item.sourceStatus === "failed") {
    return "Проверьте сбойный запуск, решите, нужен ли повтор или компенсация, и зафиксируйте передачу исполнителю.";
  }

  if (item.queueStatus === "acknowledged") {
    return "Доведите исправление до конца, затем закройте элемент во входящих.";
  }

  return "Проверьте исходный рабочий процесс и решите, должен ли элемент оставаться открытым.";
}

function deriveReconciliationUrgency(
  item: ReconciliationCasefileView
): ExceptionInboxUrgency {
  if (item.truthStatus === "contradictory" && item.reasonCodes.includes("finance_over_plan")) {
    return "critical";
  }

  if (item.truthStatus === "contradictory") {
    return "high";
  }

  if (item.caseType === "telemetry_gap") {
    return "medium";
  }

  if (
    item.reasonCodes.includes("finance_missing") ||
    item.reasonCodes.includes("field_missing") ||
    item.reasonCodes.includes("telemetry_unmatched")
  ) {
    return "medium";
  }

  return "low";
}

function deriveReconciliationOwner(
  item: ReconciliationCasefileView
): ExceptionInboxOwnerView {
  if (item.truthStatus === "contradictory") {
    return {
      id: null,
      mode: "suggested",
      name: "ПМ на сопровождение",
      role: "PM",
    };
  }

  if (item.caseType === "telemetry_gap" || item.reasonCodes.includes("telemetry_unmatched")) {
    return {
      id: null,
      mode: "suggested",
      name: "OPS на сопровождение",
      role: "OPS",
    };
  }

  if (item.reasonCodes.includes("finance_missing") || item.finance?.budgetDeltaStatus === "over_plan") {
    return {
      id: null,
      mode: "suggested",
      name: "Финансовая проверка",
      role: "FINANCE",
    };
  }

    return {
      id: null,
      mode: "suggested",
      name: "ПМ на сопровождение",
      role: "PM",
    };
  }

function buildReconciliationNextAction(item: ReconciliationCasefileView) {
  if (item.truthStatus === "contradictory") {
    return "Скоординируйте поле, телеметрию и финансы, исправьте расхождение у источника и запустите сверку заново.";
  }

  if (item.caseType === "telemetry_gap") {
    return "Проверьте GPS/geofence-активность, подтвердите, не потерян ли рабочий отчёт или привязка к проекту, и повторите сверку.";
  }

  if (item.reasonCodes.includes("finance_missing") && item.reasonCodes.includes("field_present")) {
    return "Проверьте привязку проекта в 1С или дождитесь следующего окна чтения финансов, затем повторите сверку.";
  }

  if (item.reasonCodes.includes("field_missing") && item.reasonCodes.includes("finance_present")) {
    return "Проверьте, не потеряны ли полевые доказательства или видеофакты по проекту перед следующим циклом сверки.";
  }

  return "Откройте связанный источник, закройте недостающий факт и повторите сверку, чтобы очистить кейс.";
}

function compareInboxItems(left: ExceptionInboxItem, right: ExceptionInboxItem) {
  const statusDiff = getStatusRank(left.status) - getStatusRank(right.status);
  if (statusDiff !== 0) {
    return statusDiff;
  }

  const urgencyDiff = getUrgencyRank(left.urgency) - getUrgencyRank(right.urgency);
  if (urgencyDiff !== 0) {
    return urgencyDiff;
  }

  const layerDiff = getLayerRank(left.layer) - getLayerRank(right.layer);
  if (layerDiff !== 0) {
    return layerDiff;
  }

  return Date.parse(right.observedAt) - Date.parse(left.observedAt);
}

function getStatusRank(status: ExceptionInboxStatus) {
  switch (status) {
    case "open":
      return 0;
    case "acknowledged":
      return 1;
    case "resolved":
    default:
      return 2;
  }
}

function getUrgencyRank(urgency: ExceptionInboxUrgency) {
  switch (urgency) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
    default:
      return 3;
  }
}

function getLayerRank(layer: ExceptionInboxItem["layer"]) {
  return layer === "escalation" ? 0 : 1;
}

function normalizeEscalationStatus(
  status: EscalationRecordView["queueStatus"]
): ExceptionInboxStatus {
  switch (status) {
    case "acknowledged":
      return "acknowledged";
    case "resolved":
      return "resolved";
    case "open":
    default:
      return "open";
  }
}

function formatRoleLabel(value: string) {
  switch (value.toUpperCase()) {
    case "EXEC":
      return "Руководитель";
    case "FINANCE":
      return "Финансы";
    case "OPS":
      return "Операции";
    case "PM":
    default:
      return "ПМ";
  }
}

function compactLinks(items: Array<{ href: string; label: string } | null>) {
  return items.filter((item): item is { href: string; label: string } => Boolean(item));
}

function maxTimestamp(values: Array<string | null>) {
  const timestamps = values.filter((value): value is string => Boolean(value));
  if (timestamps.length === 0) {
    return null;
  }

  return timestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function sanitizeLimit(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value), 1), max);
}
