import type { EvidenceListResult, EvidenceRecordView } from "@/lib/evidence";
import type { DerivedSyncStatus } from "@/lib/sync-state";

export type EvidenceStatusFilter = "all" | EvidenceRecordView["verificationStatus"];
export type EvidenceEntityFilter = "all" | "work_report" | "video_fact" | "gps_session";
export type EvidenceLimitOption = "6" | "12" | "24";

export function statusVariant(status: EvidenceRecordView["verificationStatus"]) {
  switch (status) {
    case "verified":
      return "success";
    case "observed":
      return "info";
    case "reported":
    default:
      return "warning";
  }
}

export function syncVariant(status: DerivedSyncStatus) {
  switch (status) {
    case "success":
      return "success";
    case "running":
      return "info";
    case "error":
      return "danger";
    case "idle":
    default:
      return "neutral";
  }
}

export function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function formatTimestamp(value: string | null) {
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

export function formatSyncStatus(evidence: EvidenceListResult) {
  if (!evidence.sync) {
    return "Pending";
  }

  switch (evidence.sync.status) {
    case "success":
      return "Success";
    case "running":
      return "Running";
    case "error":
      return "Failed";
    case "idle":
    default:
      return "Idle";
  }
}

export function entityTypeLabel(value: EvidenceRecordView["entityType"]) {
  switch (value) {
    case "work_report":
      return "Work report";
    case "video_fact":
      return "Video fact";
    case "gps_session":
      return "GPS session";
    default:
      return value;
  }
}

export function formatMetadataValue(value: string | number | boolean | null) {
  if (value === null) {
    return "null";
  }

  return String(value);
}

export function matchesFilters(
  record: EvidenceRecordView,
  filters: {
    entityType: EvidenceEntityFilter;
    verificationStatus: EvidenceStatusFilter;
  }
) {
  if (
    filters.verificationStatus !== "all" &&
    record.verificationStatus !== filters.verificationStatus
  ) {
    return false;
  }

  if (filters.entityType !== "all" && record.entityType !== filters.entityType) {
    return false;
  }

  return true;
}
