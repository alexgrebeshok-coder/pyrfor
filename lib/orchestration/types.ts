// Agent Orchestration Layer — Types
// Dual-source: agents.ts = source of truth (code wins), DB = runtime state

import type { Agent, AgentApiKey, AgentRuntimeState } from "@prisma/client";

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
