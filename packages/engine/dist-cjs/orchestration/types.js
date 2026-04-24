"use strict";
// Agent Orchestration Layer — Types
// Dual-source: agents.ts = source of truth (code wins), DB = runtime state
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOAL_LEVELS = exports.DELEGATION_STATUSES = exports.WORKFLOW_NODE_TYPES = exports.WORKFLOW_STEP_STATUSES = exports.WORKFLOW_RUN_STATUSES = exports.WORKFLOW_TEMPLATE_STATUSES = exports.CIRCUIT_STATES = exports.RUN_STATUSES = exports.WAKEUP_STATUSES = exports.WAKEUP_REASONS = exports.ADAPTER_TYPES = exports.AGENT_ROLES = exports.AGENT_STATUSES = void 0;
exports.isAgentStatus = isAgentStatus;
// ── Agent statuses ──────────────────────────────────────────
exports.AGENT_STATUSES = [
    "idle",
    "running",
    "paused",
    "error",
    "pending_approval",
    "terminated",
];
function isAgentStatus(value) {
    return exports.AGENT_STATUSES.includes(value);
}
// ── Agent roles ─────────────────────────────────────────────
exports.AGENT_ROLES = [
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
exports.ADAPTER_TYPES = [
    "internal", // uses existing CEOClaw execution engine
    "openclaw", // SSE adapter for OpenClaw cloud
    "telegram", // Telegram bot adapter
    "webhook", // generic webhook adapter
];
// ── Wakeup reasons ──────────────────────────────────────────
exports.WAKEUP_REASONS = [
    "user",
    "cron",
    "agent",
    "approval_callback",
    "event",
];
exports.WAKEUP_STATUSES = [
    "queued",
    "processing",
    "processed",
    "failed",
    "skipped",
    "cancelled",
];
// ── HeartbeatRun statuses ───────────────────────────────────
exports.RUN_STATUSES = [
    "queued",
    "running",
    "succeeded",
    "failed",
    "timed_out",
    "cancelled",
];
exports.CIRCUIT_STATES = ["closed", "open", "half-open"];
exports.WORKFLOW_TEMPLATE_STATUSES = ["draft", "active", "archived"];
exports.WORKFLOW_RUN_STATUSES = [
    "queued",
    "running",
    "waiting_approval",
    "succeeded",
    "failed",
    "cancelled",
];
exports.WORKFLOW_STEP_STATUSES = [
    "pending",
    "queued",
    "running",
    "waiting_approval",
    "succeeded",
    "failed",
    "skipped",
    "cancelled",
];
exports.WORKFLOW_NODE_TYPES = ["agent", "approval"];
exports.DELEGATION_STATUSES = [
    "delegated",
    "running",
    "succeeded",
    "failed",
    "cancelled",
];
// ── Goal levels ─────────────────────────────────────────────
exports.GOAL_LEVELS = [
    "company",
    "team",
    "agent",
    "task",
];
