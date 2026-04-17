import type { BriefDeliveryLedgerRecord } from "@/lib/briefs/delivery-ledger";
import type {
  PilotReviewDeliveryPolicyExecutionResult,
  PilotReviewDeliveryPolicyRecord,
} from "@/lib/pilot-review";

export interface DeliveryStatePayload {
  history: BriefDeliveryLedgerRecord[];
  policies: PilotReviewDeliveryPolicyRecord[];
}

export interface DeliveryStateErrorPayload {
  error?: {
    message?: string;
  };
}

export const weekdayOptions = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

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

export function executionResultVariant(reason: PilotReviewDeliveryPolicyExecutionResult["reason"]) {
  switch (reason) {
    case "failed":
      return "danger";
    case "delivered":
      return "success";
    case "previewed":
      return "info";
    case "inactive":
    case "not_due":
    default:
      return "neutral";
  }
}

export function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not yet";
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

export function formatPolicySchedule(policy: PilotReviewDeliveryPolicyRecord) {
  const weekdayLabel =
    weekdayOptions.find((option) => option.value === policy.deliveryWeekday)?.label ??
    `Day ${policy.deliveryWeekday}`;
  return `${weekdayLabel} at ${String(policy.deliveryHour).padStart(2, "0")}:00 ${policy.timezone}`;
}
