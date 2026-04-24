import type { Agent, AgentRuntimeState } from "@prisma/client";
export declare const AGENT_STATUSES: readonly ["idle", "running", "paused", "error", "pending_approval", "terminated"];
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export declare function isAgentStatus(value: string): value is AgentStatus;
export declare const AGENT_ROLES: readonly ["ceo", "cto", "pm", "analyst", "engineer", "finance", "communicator", "specialist"];
export type AgentRole = (typeof AGENT_ROLES)[number];
export declare const ADAPTER_TYPES: readonly ["internal", "openclaw", "telegram", "webhook"];
export type AdapterType = (typeof ADAPTER_TYPES)[number];
export declare const WAKEUP_REASONS: readonly ["user", "cron", "agent", "approval_callback", "event"];
export type WakeupReason = (typeof WAKEUP_REASONS)[number];
export declare const WAKEUP_STATUSES: readonly ["queued", "processing", "processed", "failed", "skipped", "cancelled"];
export type WakeupStatus = (typeof WAKEUP_STATUSES)[number];
export declare const RUN_STATUSES: readonly ["queued", "running", "succeeded", "failed", "timed_out", "cancelled"];
export type RunStatus = (typeof RUN_STATUSES)[number];
export declare const CIRCUIT_STATES: readonly ["closed", "open", "half-open"];
export type CircuitState = (typeof CIRCUIT_STATES)[number];
export declare const WORKFLOW_TEMPLATE_STATUSES: readonly ["draft", "active", "archived"];
export type WorkflowTemplateStatus = (typeof WORKFLOW_TEMPLATE_STATUSES)[number];
export declare const WORKFLOW_RUN_STATUSES: readonly ["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled"];
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];
export declare const WORKFLOW_STEP_STATUSES: readonly ["pending", "queued", "running", "waiting_approval", "succeeded", "failed", "skipped", "cancelled"];
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];
export declare const WORKFLOW_NODE_TYPES: readonly ["agent", "approval"];
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];
export declare const DELEGATION_STATUSES: readonly ["delegated", "running", "succeeded", "failed", "cancelled"];
export type DelegationStatus = (typeof DELEGATION_STATUSES)[number];
export declare const GOAL_LEVELS: readonly ["company", "team", "agent", "task"];
export type GoalLevel = (typeof GOAL_LEVELS)[number];
export interface AgentRuntimeConfig {
    schedule?: string;
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
export interface OpenClawAdapterConfig {
    url: string;
    headers?: Record<string, string>;
    timeoutSec?: number;
    sessionKeyStrategy?: "fixed" | "issue" | "run";
    sessionKey?: string;
    model?: string;
}
export interface AgentPermissions {
    canCreateAgents?: boolean;
    canApprove?: boolean;
    canCreateTasks?: boolean;
    canModifyBudget?: boolean;
}
export type Actor = {
    type: "user";
    id: string;
    workspaceId: string;
} | {
    type: "agent";
    id: string;
    workspaceId: string;
    definitionId: string | null;
};
export type AgentWithState = Agent & {
    runtimeState: AgentRuntimeState | null;
    _count?: {
        heartbeatRuns: number;
        taskLinks: number;
        reports: number;
    };
};
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
//# sourceMappingURL=types.d.ts.map