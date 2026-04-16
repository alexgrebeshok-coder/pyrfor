import { NextResponse } from "next/server";

/**
 * GET /api/orchestration/docs — API documentation (OpenAPI-style overview)
 */
export async function GET() {
  return NextResponse.json({
    title: "CEOClaw Agent Orchestration API",
    version: "1.0.0",
    description: "Agent lifecycle management, heartbeat execution, goals, and task enrichment",
    endpoints: [
      {
        path: "/api/orchestration/agents",
        methods: ["GET", "POST"],
        description: "List agents (GET) or create a new agent (POST)",
      },
      {
        path: "/api/orchestration/agents/:id",
        methods: ["GET", "PATCH", "DELETE"],
        description: "Get, update, or delete a specific agent",
      },
      {
        path: "/api/orchestration/agents/:id/keys",
        methods: ["GET", "POST"],
        description: "List or create API keys for an agent",
      },
      {
        path: "/api/orchestration/agents/:id/keys/:keyId",
        methods: ["DELETE"],
        description: "Revoke an API key",
      },
      {
        path: "/api/orchestration/agents/:id/wakeup",
        methods: ["POST"],
        description: "Trigger an agent heartbeat run",
      },
      {
        path: "/api/orchestration/agents/:id/runs",
        methods: ["GET"],
        description: "List heartbeat runs for an agent",
      },
      {
        path: "/api/orchestration/agents/:id/revisions",
        methods: ["GET"],
        description: "Get config change history for an agent",
      },
      {
        path: "/api/orchestration/runs/:runId",
        methods: ["GET"],
        description: "Get details of a specific heartbeat run",
      },
      {
        path: "/api/orchestration/goals",
        methods: ["GET", "POST"],
        description: "List goals as tree (GET) or create a goal (POST)",
      },
      {
        path: "/api/orchestration/goals/:id",
        methods: ["GET", "PATCH", "DELETE"],
        description: "Get, update, or delete a specific goal",
      },
      {
        path: "/api/orchestration/task-links",
        methods: ["GET", "POST"],
        description: "List or create agent-task links",
      },
      {
        path: "/api/orchestration/task-links/:id",
        methods: ["DELETE"],
        description: "Remove an agent-task link",
      },
      {
        path: "/api/orchestration/comments",
        methods: ["GET", "POST"],
        description: "List or create task comments",
      },
      {
        path: "/api/orchestration/comments/:id",
        methods: ["DELETE"],
        description: "Delete a comment",
      },
      {
        path: "/api/orchestration/labels",
        methods: ["GET", "POST"],
        description: "List or create labels",
      },
      {
        path: "/api/orchestration/labels/:id",
        methods: ["PATCH", "DELETE"],
        description: "Update label (and link/unlink tasks) or delete",
      },
      {
        path: "/api/orchestration/templates",
        methods: ["GET", "POST"],
        description: "List presets (GET) or create agent from preset (POST)",
      },
      {
        path: "/api/orchestration/org-chart",
        methods: ["GET"],
        description: "Get agent org chart as tree",
      },
      {
        path: "/api/orchestration/sync",
        methods: ["POST"],
        description: "Sync code-defined agents to DB (seed)",
      },
      {
        path: "/api/orchestration/activity",
        methods: ["GET"],
        description: "Unified activity feed (cursor-paginated)",
      },
      {
        path: "/api/orchestration/docs",
        methods: ["GET"],
        description: "This endpoint — API documentation",
      },
      {
        path: "/api/orchestration/secrets",
        methods: ["GET", "POST", "DELETE"],
        description: "Manage encrypted agent secrets (CRUD)",
      },
      {
        path: "/api/orchestration/permissions",
        methods: ["GET", "POST", "DELETE"],
        description: "Manage agent permission grants (RBAC)",
      },
      {
        path: "/api/orchestration/ask-project",
        methods: ["POST"],
        description: "Natural language query over project data (Спроси проект)",
      },
    ],
    auth: {
      user: "NextAuth session cookie",
      agent: "Authorization: Bearer sk-agent-... (API key)",
    },
    models: {
      Agent: "DB-persisted agent with status, budget, config, org hierarchy",
      AgentApiKey: "SHA-256 hashed API key for agent authentication",
      AgentRuntimeState: "Aggregated runtime stats (tokens, cost, runs)",
      AgentWakeupRequest: "Queue item for scheduled/triggered agent runs",
      HeartbeatRun: "Individual agent execution record",
      HeartbeatRunEvent: "Seq-ordered events within a run",
      Goal: "Hierarchical goal (company → team → agent → task)",
      AgentTaskLink: "Join table: agent ↔ task ↔ goal",
      TaskComment: "Thread comments on tasks",
      Label: "Workspace-scoped labels",
      TaskLabel: "Many-to-many task ↔ label",
      AgentConfigRevision: "Config change audit trail",
      AgentSecret: "AES-256-GCM encrypted secrets for agent configs",
      PermissionGrant: "Granular RBAC grants (resource + action + scope)",
    },
  });
}
