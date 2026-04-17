import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type { WorkReportView } from "@/lib/work-reports/types";

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function severityVariant(severity: "critical" | "high" | "medium" | "low") {
  switch (severity) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "medium":
      return "info";
    case "low":
    default:
      return "success";
  }
}

export function statusVariant(status: WorkReportView["status"]) {
  switch (status) {
    case "approved":
      return "success";
    case "rejected":
      return "danger";
    case "submitted":
    default:
      return "warning";
  }
}

export function safetyVariant(level: "low" | "medium" | "high") {
  switch (level) {
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
    default:
      return "info";
  }
}

export function executionModeLabel(mode: "preview_only" | "guarded_patch" | "guarded_communication") {
  switch (mode) {
    case "preview_only":
      return "preview only";
    case "guarded_patch":
      return "guarded patch";
    case "guarded_communication":
      return "guarded communication";
  }
}

export function deliveryStatusVariant(status: BriefDeliveryLedgerRecord["status"]) {
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

export function deliveryStatusLabel(status: BriefDeliveryLedgerRecord["status"]) {
  switch (status) {
    case "delivered":
      return "sent";
    case "failed":
      return "failed";
    case "pending":
      return "pending";
    case "preview":
    default:
      return "preview";
  }
}

export function retryPostureLabel(value: BriefDeliveryLedgerRecord["retryPosture"]) {
  switch (value) {
    case "sealed":
      return "sealed";
    case "retryable":
      return "retryable";
    case "preview_only":
    default:
      return "preview only";
  }
}

export function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "not yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
