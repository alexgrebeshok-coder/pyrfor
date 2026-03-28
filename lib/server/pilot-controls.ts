import type { AccessProfile } from "@/lib/auth/access-profile";
import type { PlatformWorkspaceId } from "@/lib/policy/access";

import {
  getServerRuntimeState,
  type ServerRuntimeState,
} from "./runtime-mode";

export type PilotRolloutStage = "open" | "observe" | "delivery" | "controlled";
export type PilotControlledWorkflow =
  | "ai_apply"
  | "executive_delivery"
  | "scheduled_delivery"
  | "work_report_delivery";

export interface PilotControlState {
  allowedWriteWorkspaces: PlatformWorkspaceId[];
  blockedWorkflows: PilotControlledWorkflow[];
  configured: boolean;
  liveMutationAllowed: boolean;
  runtimeStatus: "degraded" | "live";
  stage: PilotRolloutStage;
  tenantSlug: string | null;
}

export interface PilotWorkflowAccessResult {
  allowed: boolean;
  code: string | null;
  message: string | null;
  state: PilotControlState;
}

type RuntimeEnv = NodeJS.ProcessEnv;

interface EvaluatePilotWorkflowAccessInput {
  accessProfile: AccessProfile;
  dryRun?: boolean;
  env?: RuntimeEnv;
  runtime?: ServerRuntimeState;
  workflow: PilotControlledWorkflow;
}

export function getPilotRolloutStage(env: RuntimeEnv = process.env): PilotRolloutStage {
  switch (env.PILOT_ROLLOUT_STAGE?.trim().toLowerCase()) {
    case "observe":
      return "observe";
    case "delivery":
      return "delivery";
    case "controlled":
      return "controlled";
    default:
      return "open";
  }
}

export function getPilotTenantSlug(env: RuntimeEnv = process.env) {
  const value = env.PILOT_TENANT_SLUG?.trim();
  return value ? value : null;
}

export function getPilotControlState(
  runtime: ServerRuntimeState = getServerRuntimeState(),
  env: RuntimeEnv = process.env
): PilotControlState {
  const stage = getPilotRolloutStage(env);
  const runtimeStatus = runtime.healthStatus === "degraded" ? "degraded" : "live";

  const allowedWriteWorkspaces = resolveAllowedWriteWorkspaces(stage);
  const blockedWorkflows = resolveBlockedWorkflows(stage);

  return {
    allowedWriteWorkspaces,
    blockedWorkflows,
    configured: Boolean(env.PILOT_ROLLOUT_STAGE?.trim() || env.PILOT_TENANT_SLUG?.trim()),
    liveMutationAllowed:
      runtimeStatus === "live" && (stage === "open" || allowedWriteWorkspaces.length > 0),
    runtimeStatus,
    stage,
    tenantSlug: getPilotTenantSlug(env),
  };
}

export function evaluatePilotWorkflowAccess(
  input: EvaluatePilotWorkflowAccessInput
): PilotWorkflowAccessResult {
  const runtime = input.runtime ?? getServerRuntimeState(input.env);
  const state = getPilotControlState(runtime, input.env);

  if (input.dryRun) {
    return allowAccess(state);
  }

  if (!state.configured) {
    return allowAccess(state);
  }

  if (state.runtimeStatus === "degraded") {
    return denyAccess(
      state,
      "PILOT_RUNTIME_DEGRADED",
      "Live pilot workflows are blocked because the server runtime is degraded."
    );
  }

  if (
    (input.workflow === "executive_delivery" || input.workflow === "scheduled_delivery") &&
    state.runtimeStatus !== "live"
  ) {
    return denyAccess(
      state,
      "PILOT_EXECUTIVE_DELIVERY_REQUIRES_LIVE",
      "Executive delivery is blocked unless live portfolio facts are active."
    );
  }

  if (state.tenantSlug && input.accessProfile.organizationSlug !== state.tenantSlug) {
    return denyAccess(
      state,
      "PILOT_TENANT_MISMATCH",
      `Pilot rollout is limited to tenant ${state.tenantSlug}. Current tenant ${input.accessProfile.organizationSlug} is blocked.`
    );
  }

  if (state.stage === "observe") {
    return denyAccess(
      state,
      "PILOT_STAGE_BLOCKED",
      "Observe posture blocks high-risk live workflows until the pilot is promoted."
    );
  }

  if (
    state.stage === "delivery" &&
    (input.workflow === "executive_delivery" || input.workflow === "scheduled_delivery")
  ) {
    return denyAccess(
      state,
      "PILOT_STAGE_BLOCKED",
      "Delivery-only posture blocks executive outbound sends and scheduled digests."
    );
  }

  return allowAccess(state);
}

export function getPilotStageLabel(stage: PilotRolloutStage) {
  switch (stage) {
    case "observe":
      return "Observe only";
    case "delivery":
      return "Delivery only";
    case "controlled":
      return "Controlled rollout";
    case "open":
    default:
      return "Open defaults";
  }
}

export function getPilotWorkflowLabel(workflow: PilotControlledWorkflow) {
  switch (workflow) {
    case "ai_apply":
      return "AI apply";
    case "executive_delivery":
      return "Executive delivery";
    case "scheduled_delivery":
      return "Scheduled delivery";
    case "work_report_delivery":
      return "Work report delivery";
    default:
      return workflow;
  }
}

function resolveAllowedWriteWorkspaces(stage: PilotRolloutStage): PlatformWorkspaceId[] {
  switch (stage) {
    case "delivery":
      return ["delivery"];
    case "controlled":
    case "open":
      return ["delivery", "executive"];
    case "observe":
    default:
      return [];
  }
}

function resolveBlockedWorkflows(stage: PilotRolloutStage): PilotControlledWorkflow[] {
  switch (stage) {
    case "observe":
      return ["ai_apply", "executive_delivery", "scheduled_delivery", "work_report_delivery"];
    case "delivery":
      return ["executive_delivery", "scheduled_delivery"];
    case "controlled":
    case "open":
    default:
      return [];
  }
}

function allowAccess(state: PilotControlState): PilotWorkflowAccessResult {
  return {
    allowed: true,
    code: null,
    message: null,
    state,
  };
}

function denyAccess(
  state: PilotControlState,
  code: string,
  message: string
): PilotWorkflowAccessResult {
  return {
    allowed: false,
    code,
    message,
    state,
  };
}
