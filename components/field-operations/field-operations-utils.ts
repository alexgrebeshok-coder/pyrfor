import { initialDashboardState } from "@/lib/mock-data";

import type { FieldMapProject } from "@/components/field-operations/field-operations.types";

export const PREVIEW_FIELD_PROJECTS: FieldMapProject[] = initialDashboardState.projects.map(
  (project) => ({
    id: project.id,
    name: project.name,
    location: project.location,
    status: normalizePreviewProjectStatus(project.status),
    progress: project.progress,
    health: project.health,
  })
);

export function normalizePreviewProjectStatus(value: string) {
  return value === "at-risk" ? "at_risk" : value;
}

export function formatShortDate(value: string | null) {
  if (!value) return "нет данных";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatPercent(value: number | null) {
  if (value === null) return "нет данных";
  return `${Math.round(value * 100)}%`;
}

export function formatEquipmentStatus(value: string | null | undefined) {
  switch (value) {
    case "work":
      return "В работе";
    case "idle":
      return "Простой";
    case "travel":
      return "В пути";
    case "pending":
      return "Ожидание";
    case "unknown":
    case null:
    case undefined:
    default:
      return "Неизвестно";
  }
}

export function formatReportStatus(value: string) {
  switch (value) {
    case "approved":
      return "Одобрен";
    case "rejected":
      return "Отклонён";
    case "submitted":
      return "На проверке";
    default:
      return value;
  }
}

export function formatVerificationStatus(value: string) {
  switch (value) {
    case "verified":
      return "Подтверждён";
    case "observed":
      return "Зафиксирован";
    default:
      return value;
  }
}

export function projectHealthScore(health: string, status: string, progress: number) {
  if (status === "completed" || progress >= 100) {
    return 95;
  }

  if (status === "at_risk") {
    return 35;
  }

  if (status === "on_hold") {
    return 48;
  }

  switch (health) {
    case "good":
      return 82;
    case "warning":
      return 62;
    case "critical":
      return 32;
    default:
      return 65;
  }
}

export function formatRussianQueueItem(value: number) {
  const remainder100 = value % 100;
  const remainder10 = value % 10;

  if (remainder100 >= 11 && remainder100 <= 14) {
    return "элементов";
  }

  if (remainder10 === 1) {
    return "элемент";
  }

  if (remainder10 >= 2 && remainder10 <= 4) {
    return "элемента";
  }

  return "элементов";
}

export function formatObservationTypeLabel(value: string) {
  switch (value) {
    case "progress_visible":
      return "Прогресс виден";
    case "blocked_area":
      return "Заблокированная зона";
    case "idle_equipment":
      return "Простой техники";
    case "safety_issue":
      return "Вопрос безопасности";
    default:
      return value;
  }
}
