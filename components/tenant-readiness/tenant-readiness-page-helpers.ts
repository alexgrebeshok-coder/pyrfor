import type {
  TenantReadinessFindingCategory,
  TenantReadinessOutcome,
  TenantReadinessState,
} from "@/lib/tenant-readiness";

export const expectedEndpoints = [
  {
    method: "GET" as const,
    note: "Прочитать tenant-level readiness outcome, checklist rows и drillback links для cutover review.",
    path: "/api/tenant-readiness",
  },
  {
    method: "GET" as const,
    note: "Открыть текущую pilot posture, tenant boundary и stage-based workflow guards.",
    path: "/api/pilot-controls",
  },
  {
    method: "GET" as const,
    note: "Проверить connector health, missing secrets и live truth probes перед promotion.",
    path: "/api/connectors",
  },
  {
    method: "GET" as const,
    note: "Проверить unresolved escalations и reconciliation gaps из command center.",
    path: "/api/command-center/exceptions?limit=24",
  },
  {
    method: "GET" as const,
    note: "Проверить open/in-review pilot feedback items, которые всё ещё влияют на cutover.",
    path: "/api/pilot-feedback?includeResolved=true&limit=24",
  },
  {
    method: "GET" as const,
    note: "Прочитать durable cutover approvals, warning waivers и rollback entries.",
    path: "/api/tenant-readiness/decisions",
  },
  {
    method: "POST" as const,
    note: "Записать cutover approval, warning waiver или rollback вместе с текущим readiness/review snapshot.",
    path: "/api/tenant-readiness/decisions",
  },
];

export function outcomeVariant(outcome: TenantReadinessOutcome) {
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

export function stateVariant(state: TenantReadinessState) {
  switch (state) {
    case "blocked":
      return "danger";
    case "warning":
      return "warning";
    case "ready":
    default:
      return "success";
  }
}

export function formatStateLabel(state: TenantReadinessState) {
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

export function categoryLabel(category: TenantReadinessFindingCategory) {
  switch (category) {
    case "command_center":
      return "Command center";
    case "pilot_feedback":
      return "Pilot feedback";
    case "connector":
      return "Connector";
    case "rollout":
      return "Rollout";
    case "runtime":
    default:
      return "Runtime";
  }
}

export function promotionCopy(outcome: TenantReadinessOutcome) {
  switch (outcome) {
    case "blocked":
      return "Not safe to promote. Resolve the blockers from the linked surfaces first.";
    case "guarded":
      return "Promotion can proceed only inside the current controlled rollout guardrails.";
    case "ready_with_warnings":
      return "Promotion is technically possible, but the remaining warnings still need an explicit acceptance decision.";
    case "ready":
    default:
      return "This tenant is clear to promote from the surfaces tracked here.";
  }
}
