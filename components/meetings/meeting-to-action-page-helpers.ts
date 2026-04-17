import type { AIRunRecord } from "@/lib/ai/types";

export const expectedEndpoints = [
  {
    method: "POST" as const,
    note: "Создать packet из meeting notes и запустить runs для tasks, risks и status report.",
    path: "/api/meetings/to-action",
  },
  {
    method: "GET" as const,
    note: "Проверить статус отдельного AI run внутри packet.",
    path: "/api/ai/runs/:runId",
  },
  {
    method: "POST" as const,
    note: "Применить approved proposal из выбранного run.",
    path: "/api/ai/runs/:runId/proposals/:proposalId/apply",
  },
];

export function mapStatusVariant(status: AIRunRecord["status"]) {
  switch (status) {
    case "done":
      return "success";
    case "needs_approval":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "info";
  }
}

export function mapStatusLabel(status: AIRunRecord["status"]) {
  switch (status) {
    case "done":
      return "Готово";
    case "needs_approval":
      return "Нужно подтверждение";
    case "failed":
      return "Сбой";
    case "running":
      return "Выполняется";
    case "queued":
    default:
      return "В очереди";
  }
}
