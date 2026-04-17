// Agent Orchestration Layer — Types
// Dual-source: agents.ts = source of truth (code wins), DB = runtime state

import type { Agent, AgentRuntimeState } from "@prisma/client";

// ── Agent statuses ──────────────────────────────────────────
export const AGENT_STATUSES = [
  "idle",
  "running",
  "paused",
  "error",
  "pending_approval",
  "terminated",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export function isAgentStatus(value: string): value is AgentStatus {
  return (AGENT_STATUSES as readonly string[]).includes(value);
}

// ── Agent roles ─────────────────────────────────────────────
export const AGENT_ROLES = [
  "ceo",
  "cto",
  "pm",
  "analyst",
  "engineer",
  "finance",
  "communicator",
  "specialist",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

// ── Adapter types ───────────────────────────────────────────
export const ADAPTER_TYPES = [
  "internal",   // uses existing CEOClaw execution engine
  "openclaw",   // SSE adapter for OpenClaw cloud
  "telegram",   // Telegram bot adapter
  "webhook",    // generic webhook adapter
] as const;
export type AdapterType = (typeof ADAPTER_TYPES)[number];

// ── Wakeup reasons ──────────────────────────────────────────
export const WAKEUP_REASONS = [
  "user",
  "cron",
  "agent",
  "approval_callback",
  "event",
] as const;
export type WakeupReason = (typeof WAKEUP_REASONS)[number];

export const WAKEUP_STATUSES = [
  "queued",
  "processing",
  "processed",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type WakeupStatus = (typeof WAKEUP_STATUSES)[number];

// ── HeartbeatRun statuses ───────────────────────────────────
export const RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const CIRCUIT_STATES = ["closed", "open", "half-open"] as const;
export type CircuitState = (typeof CIRCUIT_STATES)[number];

export const WORKFLOW_TEMPLATE_STATUSES = ["draft", "active", "archived"] as const;
export type WorkflowTemplateStatus = (typeof WORKFLOW_TEMPLATE_STATUSES)[number];

export const WORKFLOW_RUN_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_STEP_STATUSES = [
  "pending",
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

export const WORKFLOW_NODE_TYPES = ["agent", "approval"] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const DELEGATION_STATUSES = [
  "delegated",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type DelegationStatus = (typeof DELEGATION_STATUSES)[number];

// ── Goal levels ─────────────────────────────────────────────
export const GOAL_LEVELS = [
  "company",
  "team",
  "agent",
  "task",
] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];

// ── Runtime config (persisted in Agent.runtimeConfig JSON) ──
export interface AgentRuntimeConfig {
  schedule?: string;           // cron expression, e.g. "0 6 * * *"
  modelOverride?: string;
  providerOverride?: string;
  temperature?: number;
  maxTokens?: number;
  systemPromptPrefix?: string;
  systemPromptSuffix?: string;
  timeoutSec?: number;
  maxRetries?: number;
  retryBackoffBaseSec?: number;
  circuitFailureThreshold?: number;
  circuitCooldownSec?: number;
}

// ── Adapter config (persisted in Agent.adapterConfig JSON) ──
export interface OpenClawAdapterConfig {
  url: string;
  headers?: Record<string, string>;
  timeoutSec?: number;
  sessionKeyStrategy?: "fixed" | "issue" | "run";
  sessionKey?: string;
  model?: string;
}

// ── Agent permissions ───────────────────────────────────────
export interface AgentPermissions {
  canCreateAgents?: boolean;
  canApprove?: boolean;
  canCreateTasks?: boolean;
  canModifyBudget?: boolean;
}

// ── Unified Actor context ───────────────────────────────────
export type Actor =
  | { type: "user"; id: string; workspaceId: string }
  | { type: "agent"; id: string; workspaceId: string; definitionId: string | null };

// ── Agent with relations (common query result) ──────────────
export type AgentWithState = Agent & {
  runtimeState: AgentRuntimeState | null;
  _count?: {
    heartbeatRuns: number;
    taskLinks: number;
    reports: number;
  };
};

// ── Create / Update DTOs ────────────────────────────────────
export interface CreateAgentInput {
  workspaceId: string;
  definitionId?: string;
  name: string;
  slug: string;
  role?: string;
  reportsToId?: string | null;
  adapterType?: string;
  adapterConfig?: Record<string, unknown>;
  runtimeConfig?: AgentRuntimeConfig;
  budgetMonthlyCents?: number;
  permissions?: AgentPermissions;
}

export interface UpdateAgentInput {
  name?: string;
  role?: string;
  status?: AgentStatus;
  reportsToId?: string | null;
  adapterType?: string;
  adapterConfig?: Record<string, unknown>;
  runtimeConfig?: AgentRuntimeConfig;
  budgetMonthlyCents?: number;
  permissions?: AgentPermissions;
}
