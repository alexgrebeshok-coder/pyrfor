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
        path: "/api/orchestration/runs/:runId/replay",
        methods: ["POST"],
        description: "Queue replay of a heartbeat run from start or checkpoint",
      },
      {
        path: "/api/orchestration/dlq",
        methods: ["GET"],
        description: "Inspect dead-letter incidents for failed orchestrator jobs",
      },
      {
        path: "/api/orchestration/workflows",
        methods: ["GET", "POST"],
        description: "List workflow templates or create a reusable orchestration graph",
      },
      {
        path: "/api/orchestration/workflows/:id",
        methods: ["GET", "PATCH"],
        description: "Read or update a workflow template definition",
      },
      {
        path: "/api/orchestration/workflows/:id/runs",
        methods: ["POST"],
        description: "Start a workflow run from a saved template",
      },
      {
        path: "/api/orchestration/workflow-runs",
        methods: ["GET"],
        description: "List workflow runs with per-step summaries",
      },
      {
        path: "/api/orchestration/workflow-runs/:runId",
        methods: ["GET"],
        description: "Inspect a workflow run, its steps, approvals, and delegation lineage",
      },
      {
        path: "/api/orchestration/workflow-runs/:runId/advance",
        methods: ["POST"],
        description: "Force reconciliation of workflow state against heartbeat runs and approvals",
      },
      {
        path: "/api/orchestration/ops",
        methods: ["GET"],
        description: "Operational snapshot: workflow state, DLQ, circuits, approvals, and recent runs",
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
      HeartbeatRunCheckpoint: "Replay-safe execution snapshots for run recovery and audit",
      DeadLetterJob: "Terminal failed jobs kept for operator recovery and replay",
      WorkflowTemplate: "Reusable orchestration DAG with agent and approval nodes",
      WorkflowRun: "Execution lifecycle for one workflow instance",
      WorkflowRunStep: "Per-node status, retries, approval links, and run attachments",
      AgentDelegation: "Explicit parent→child delegation lineage across workflow and heartbeat runs",
      Goal: "Hierarchical goal (company → team → agent → task)",
      AgentTaskLink: "Join table: agent ↔ task ↔ goal",
      TaskComment: "Thread comments on tasks",
      Label: "Workspace-scoped labels",
      TaskLabel: "Many-to-many task ↔ label",
      AgentConfigRevision: "Config change audit trail",
      AgentSecret: "AES-256-GCM encrypted secrets for agent configs",
      PermissionGrant: "Granular RBAC grants (resource + action + scope)",
    },
    scenarios: [
      {
        id: "concept-to-execution",
        title: "Concept → architecture → coding → approval → final review",
        description:
          "A reusable workflow template decomposes the user brief into scoped design, implementation, approval, and final review steps with explicit delegation lineage.",
        steps: [
          "User starts workflow with a concept brief.",
          "Planner/architect agent produces scoped implementation plan.",
          "Implementation agent executes the coding step.",
          "Human approval gate pauses the flow on a reviewable checkpoint.",
          "Reviewer agent assembles final result and handoff summary.",
        ],
      },
      {
        id: "incident-recovery",
        title: "Failure recovery with checkpoint, DLQ, and replay",
        description:
          "A failed heartbeat run becomes visible in DLQ, retains checkpoints, and can be replayed or reattached into the workflow without losing audit lineage.",
        steps: [
          "Scheduler classifies failure and moves terminal case to DLQ.",
          "Operator inspects failed run, checkpoints, and dead-letter context.",
          "Replay or workflow advance requeues only the affected step.",
          "Delegation lineage and workflow summary stay intact for audit.",
        ],
      },
      {
        id: "approval-governed-delegation",
        title: "Governed delegation with human override",
        description:
          "Workflow steps can stop on approval gates while still preserving downstream task context, runtime visibility, and the ability to resume automatically.",
        steps: [
          "Workflow step creates approval item with canonical workflow link.",
          "Approval queue or workflow inspector shows waiting state.",
          "Reviewer approves or rejects directly from the approval system.",
          "Workflow engine reconciles state and continues or fails safely.",
        ],
      },
    ],
    roadmap: [
      {
        phase: "Reliability core",
        status: "implemented",
        outcome:
          "Retry, circuit breaker, DLQ, idempotent wakeups, and run checkpoints are active in the orchestration runtime.",
      },
      {
        phase: "Workflow and delegation",
        status: "implemented",
        outcome:
          "Reusable workflow templates, workflow runs, step state, approval gates, and explicit delegation lineage are available through services, API, and UI.",
      },
      {
        phase: "Operations visibility",
        status: "implemented",
        outcome:
          "Dashboard/runtime surfaces expose circuits, DLQ, workflow health, recent runs, roadmap, scenarios, and the target operating model.",
      },
      {
        phase: "Further scale-out",
        status: "next",
        outcome:
          "Extend with multi-project workload routing, richer policy automation, and broader end-to-end coverage on top of the now-stable orchestration base.",
      },
    ],
    definitionOfDone: [
      "Workflow templates can express agent and approval nodes with DAG dependencies.",
      "Starting a workflow creates step state, queues child heartbeat runs, and records explicit delegations.",
      "Heartbeat completion or failure reconciles the workflow automatically.",
      "Approval decisions resume or fail the workflow without manual DB intervention.",
      "Operators can inspect workflow runs, step lineage, checkpoints, DLQ, and circuit state in UI.",
      "Runtime docs expose scenarios, roadmap, and the target operating model directly inside the product.",
    ],
    finalExpectedResult: {
      product:
        "CEOClaw becomes an enterprise orchestration surface where user intent is translated into reusable execution graphs, delegated safely across agents, and audited end-to-end.",
      operator:
        "An operator can see who is running, who delegated, what is blocked on approval, what failed, how to replay it, and how close the system is to the target operating model.",
      system:
        "The runtime remains resilient under failure via retries, circuits, DLQ, checkpoints, workflow reconciliation, and human override points.",
    },
  });
}
