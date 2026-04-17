import type {
  TenantOnboardingRunbookRecord,
  TenantOnboardingRunbookStatus,
} from "@/lib/tenant-onboarding";

export interface RunbookEditorState {
  handoffNotes: string;
  operatorNotes: string;
  rollbackPlan: string;
  rolloutScope: string;
  status: TenantOnboardingRunbookStatus;
  summary: string;
  targetCutoverAt: string;
  targetTenantLabel: string;
  targetTenantSlug: string;
}

export function statusVariant(status: TenantOnboardingRunbookStatus) {
  switch (status) {
    case "completed":
      return "success";
    case "scheduled":
      return "info";
    case "prepared":
      return "warning";
    case "draft":
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

function toLocalDateTimeInputValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60_000);
  return localDate.toISOString().slice(0, 16);
}

export function createEmptyEditorState(): RunbookEditorState {
  return {
    handoffNotes: "",
    operatorNotes: "",
    rollbackPlan: "",
    rolloutScope: "",
    status: "draft",
    summary: "",
    targetCutoverAt: "",
    targetTenantLabel: "",
    targetTenantSlug: "",
  };
}

export function createEditorStateFromRunbook(
  entry: TenantOnboardingRunbookRecord
): RunbookEditorState {
  return {
    handoffNotes: entry.handoffNotes ?? "",
    operatorNotes: entry.operatorNotes ?? "",
    rollbackPlan: entry.rollbackPlan ?? "",
    rolloutScope: entry.rolloutScope,
    status: entry.status,
    summary: entry.summary,
    targetCutoverAt: toLocalDateTimeInputValue(entry.targetCutoverAt),
    targetTenantLabel: entry.targetTenantLabel ?? "",
    targetTenantSlug: entry.targetTenantSlug ?? "",
  };
}
