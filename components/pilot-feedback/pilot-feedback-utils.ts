import type {
  PilotFeedbackItemView,
  PilotFeedbackSeverity,
  PilotFeedbackStatus,
  PilotFeedbackTargetType,
} from "@/lib/pilot-feedback";

export const expectedEndpoints = [
  {
    method: "GET" as const,
    note: "Прочитать persisted pilot feedback ledger и увидеть open/in-review/resolved state.",
    path: "/api/pilot-feedback?includeResolved=true&limit=24",
  },
  {
    method: "POST" as const,
    note: "Создать feedback item, привязанный к exception item, workflow run или reconciliation casefile.",
    path: "/api/pilot-feedback",
  },
  {
    method: "PATCH" as const,
    note: "Обновить owner, severity или resolution state для existing feedback item.",
    path: "/api/pilot-feedback/:id",
  },
];

export function severityVariant(severity: PilotFeedbackSeverity) {
  switch (severity) {
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

export function statusVariant(status: PilotFeedbackStatus) {
  switch (status) {
    case "resolved":
      return "success";
    case "in_review":
      return "info";
    case "open":
    default:
      return "warning";
  }
}

export function targetTypeLabel(targetType: PilotFeedbackTargetType) {
  switch (targetType) {
    case "workflow_run":
      return "Workflow run";
    case "reconciliation_casefile":
      return "Reconciliation case";
    case "exception_item":
    default:
      return "Exception item";
  }
}

export function ownerVariant(item: PilotFeedbackItemView) {
  return item.owner.mode === "assigned" ? "success" : "warning";
}

export function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export type FeedbackFormState = {
  details: string;
  ownerId: string;
  projectId: string;
  projectName: string;
  severity: PilotFeedbackSeverity;
  sourceHref: string;
  sourceLabel: string;
  summary: string;
  targetId: string;
  targetLabel: string;
  targetType: PilotFeedbackTargetType;
};

export type PilotFeedbackTargetPrefill = Omit<
  FeedbackFormState,
  "details" | "ownerId" | "severity" | "summary"
>;

export const emptyFormState: FeedbackFormState = {
  details: "",
  ownerId: "",
  projectId: "",
  projectName: "",
  severity: "medium",
  sourceHref: "",
  sourceLabel: "",
  summary: "",
  targetId: "",
  targetLabel: "",
  targetType: "exception_item",
};
