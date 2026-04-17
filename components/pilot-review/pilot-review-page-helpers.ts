import type {
  PilotReviewFreshnessSignal,
  PilotReviewOutcome,
  PilotReviewSection,
} from "@/lib/pilot-review";

export const expectedEndpoints = [
  {
    method: "GET" as const,
    note: "Прочитать deterministic pilot review scorecard поверх readiness, backlog, freshness и delivery signals.",
    path: "/api/pilot-review",
  },
  {
    method: "GET" as const,
    note: "Открыть governance artifact как markdown preview без отдельной office-export subsystem.",
    path: "/api/pilot-review?format=markdown",
  },
  {
    method: "GET" as const,
    note: "Скачать тот же markdown artifact для recurring steering review или weekly governance pack.",
    path: "/api/pilot-review?format=markdown&download=1",
  },
  {
    method: "GET" as const,
    note: "Прочитать persisted weekly schedules и governance-scoped delivery history для pilot review.",
    path: "/api/pilot-review/policies",
  },
  {
    method: "POST" as const,
    note: "Создать новый weekly email schedule для recurring governance review.",
    path: "/api/pilot-review/policies",
  },
  {
    method: "POST" as const,
    note: "Preview или выполнить все due pilot-review deliveries через bounded scheduled-delivery workflow.",
    path: "/api/pilot-review/policies/run-due",
  },
];

export function outcomeVariant(outcome: PilotReviewOutcome) {
  switch (outcome) {
    case "blocked":
      return "danger";
    case "guarded":
      return "warning";
    case "ready_with_warnings":
      return "info";
    case "ready":
    default:
      return "success";
  }
}

export function stateVariant(section: PilotReviewSection | PilotReviewFreshnessSignal) {
  switch (section.state) {
    case "blocked":
      return "danger";
    case "warning":
      return "warning";
    case "ready":
    default:
      return "success";
  }
}

export function formatStateLabel(state: PilotReviewSection["state"]) {
  switch (state) {
    case "blocked":
      return "blocked";
    case "warning":
      return "warning";
    case "ready":
    default:
      return "ready";
  }
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

export function reviewCopy(outcome: PilotReviewOutcome) {
  switch (outcome) {
    case "blocked":
      return "Weekly governance review is still blocked. Resolve the blocked sections before treating this pilot as promotable or stable.";
    case "guarded":
      return "Weekly governance review can proceed, but the tenant still lives inside explicit rollout guardrails.";
    case "ready_with_warnings":
      return "The pilot is reviewable and exportable, but remaining warnings still need an explicit operator acceptance decision.";
    case "ready":
    default:
      return "The pilot review is clean enough to use as the current recurring governance baseline.";
  }
}
