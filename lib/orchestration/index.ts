// Agent Orchestration Layer — public API
export * from "./types";
export * from "./agent-service";
export * from "./actor";
export { jobQueue } from "./job-queue";
export type { IJobQueue, Job, JobPayload } from "./job-queue";
export {
  executeHeartbeatRun,
  processWakeupQueue,
  checkBudget,
} from "./heartbeat-executor";
export type { HeartbeatRunInput, HeartbeatRunResult } from "./heartbeat-executor";
export { AGENT_PRESETS, getPreset } from "./agent-presets";
export type { AgentPreset } from "./agent-presets";
export { getAdapter, registerAdapter, OpenClawAdapter, WebhookAdapter } from "./adapters";
export type { ExternalAdapter, AdapterResult } from "./adapters";
export {
  sendHeartbeatTelegramNotification,
  sendBudgetWarningTelegram,
} from "./telegram-notify";
export {
  setSecret,
  getSecret,
  listSecrets,
  deleteSecret,
  resolveSecretRefs,
} from "./agent-secrets";
export {
  hasPermission,
  requirePermission,
  grantPermission,
  revokePermission,
  listPermissions,
  setPermissions,
} from "./permission-grants";
export type { PermissionCheck } from "./permission-grants";
