// Agent Orchestration Layer — Types
// Dual-source: agents.ts = source of truth (code wins), DB = runtime state
// ── Agent statuses ──────────────────────────────────────────
export const AGENT_STATUSES = [
    "idle",
    "running",
    "paused",
    "error",
    "pending_approval",
    "terminated",
];
export function isAgentStatus(value) {
    return AGENT_STATUSES.includes(value);
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
];
// ── Adapter types ───────────────────────────────────────────
export const ADAPTER_TYPES = [
    "internal", // uses existing CEOClaw execution engine
    "openclaw", // SSE adapter for OpenClaw cloud
    "telegram", // Telegram bot adapter
    "webhook", // generic webhook adapter
];
// ── Wakeup reasons ──────────────────────────────────────────
export const WAKEUP_REASONS = [
    "user",
    "cron",
    "agent",
    "approval_callback",
    "event",
];
export const WAKEUP_STATUSES = [
    "queued",
    "processing",
    "processed",
    "failed",
    "skipped",
    "cancelled",
];
// ── HeartbeatRun statuses ───────────────────────────────────
export const RUN_STATUSES = [
    "queued",
    "running",
    "succeeded",
    "failed",
    "timed_out",
    "cancelled",
];
export const CIRCUIT_STATES = ["closed", "open", "half-open"];
export const WORKFLOW_TEMPLATE_STATUSES = ["draft", "active", "archived"];
export const WORKFLOW_RUN_STATUSES = [
    "queued",
    "running",
    "waiting_approval",
    "succeeded",
    "failed",
    "cancelled",
];
export const WORKFLOW_STEP_STATUSES = [
    "pending",
    "queued",
    "running",
    "waiting_approval",
    "succeeded",
    "failed",
    "skipped",
    "cancelled",
];
export const WORKFLOW_NODE_TYPES = ["agent", "approval"];
export const DELEGATION_STATUSES = [
    "delegated",
    "running",
    "succeeded",
    "failed",
    "cancelled",
];
// ── Goal levels ─────────────────────────────────────────────
export const GOAL_LEVELS = [
    "company",
    "team",
    "agent",
    "task",
];
