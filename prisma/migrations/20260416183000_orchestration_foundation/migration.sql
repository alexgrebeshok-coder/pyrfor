-- AlterTable
ALTER TABLE "AIRunCost" ADD COLUMN     "agentDbId" TEXT,
ADD COLUMN     "goalId" TEXT,
ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "definitionId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'engineer',
    "status" TEXT NOT NULL DEFAULT 'idle',
    "reportsToId" TEXT,
    "adapterType" TEXT NOT NULL DEFAULT 'internal',
    "adapterConfig" TEXT NOT NULL DEFAULT '{}',
    "runtimeConfig" TEXT NOT NULL DEFAULT '{}',
    "budgetMonthlyCents" INTEGER NOT NULL DEFAULT 0,
    "spentMonthlyCents" INTEGER NOT NULL DEFAULT 0,
    "permissions" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApiKey" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRuntimeState" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCostCents" INTEGER NOT NULL DEFAULT 0,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "successfulRuns" INTEGER NOT NULL DEFAULT 0,
    "lastRunId" TEXT,
    "lastError" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRuntimeState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentWakeupRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "triggerData" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AgentWakeupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeartbeatRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "wakeupRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "invocationSource" TEXT NOT NULL DEFAULT 'on_demand',
    "usageJson" TEXT,
    "resultJson" TEXT,
    "contextSnapshot" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeartbeatRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeartbeatRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeartbeatRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "level" TEXT NOT NULL DEFAULT 'team',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "ownerAgentId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTaskLink" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "goalId" TEXT,
    "runId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTaskLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfigRevision" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConfigRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSecret" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT,
    "key" TEXT NOT NULL,
    "encValue" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionGrant" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agent_workspaceId_status_idx" ON "Agent"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Agent_definitionId_idx" ON "Agent"("definitionId");

-- CreateIndex
CREATE INDEX "Agent_reportsToId_idx" ON "Agent"("reportsToId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_workspaceId_slug_key" ON "Agent"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApiKey_keyHash_key" ON "AgentApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "AgentApiKey_keyHash_idx" ON "AgentApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "AgentApiKey_agentId_idx" ON "AgentApiKey"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRuntimeState_agentId_key" ON "AgentRuntimeState"("agentId");

-- CreateIndex
CREATE INDEX "AgentWakeupRequest_agentId_status_createdAt_idx" ON "AgentWakeupRequest"("agentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "HeartbeatRun_agentId_startedAt_idx" ON "HeartbeatRun"("agentId", "startedAt");

-- CreateIndex
CREATE INDEX "HeartbeatRun_workspaceId_status_createdAt_idx" ON "HeartbeatRun"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "HeartbeatRun_workspaceId_agentId_startedAt_idx" ON "HeartbeatRun"("workspaceId", "agentId", "startedAt");

-- CreateIndex
CREATE INDEX "HeartbeatRunEvent_runId_idx" ON "HeartbeatRunEvent"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "HeartbeatRunEvent_runId_seq_key" ON "HeartbeatRunEvent"("runId", "seq");

-- CreateIndex
CREATE INDEX "Goal_workspaceId_status_idx" ON "Goal"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Goal_parentId_idx" ON "Goal"("parentId");

-- CreateIndex
CREATE INDEX "Goal_ownerAgentId_idx" ON "Goal"("ownerAgentId");

-- CreateIndex
CREATE INDEX "Goal_projectId_idx" ON "Goal"("projectId");

-- CreateIndex
CREATE INDEX "AgentTaskLink_agentId_idx" ON "AgentTaskLink"("agentId");

-- CreateIndex
CREATE INDEX "AgentTaskLink_goalId_idx" ON "AgentTaskLink"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTaskLink_taskId_agentId_key" ON "AgentTaskLink"("taskId", "agentId");

-- CreateIndex
CREATE INDEX "AgentConfigRevision_agentId_changedAt_idx" ON "AgentConfigRevision"("agentId", "changedAt");

-- CreateIndex
CREATE INDEX "AgentSecret_agentId_idx" ON "AgentSecret"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSecret_workspaceId_key_key" ON "AgentSecret"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "PermissionGrant_agentId_idx" ON "PermissionGrant"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionGrant_agentId_resource_action_scope_key" ON "PermissionGrant"("agentId", "resource", "action", "scope");

-- CreateIndex
CREATE INDEX "AIRunCost_agentDbId_createdAt_idx" ON "AIRunCost"("agentDbId", "createdAt");

-- CreateIndex
CREATE INDEX "AIRunCost_projectId_createdAt_idx" ON "AIRunCost"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "AIRunCost" ADD CONSTRAINT "AIRunCost_agentDbId_fkey" FOREIGN KEY ("agentDbId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApiKey" ADD CONSTRAINT "AgentApiKey_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRuntimeState" ADD CONSTRAINT "AgentRuntimeState_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentWakeupRequest" ADD CONSTRAINT "AgentWakeupRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartbeatRun" ADD CONSTRAINT "HeartbeatRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartbeatRunEvent" ADD CONSTRAINT "HeartbeatRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HeartbeatRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_ownerAgentId_fkey" FOREIGN KEY ("ownerAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskLink" ADD CONSTRAINT "AgentTaskLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskLink" ADD CONSTRAINT "AgentTaskLink_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskLink" ADD CONSTRAINT "AgentTaskLink_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConfigRevision" ADD CONSTRAINT "AgentConfigRevision_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSecret" ADD CONSTRAINT "AgentSecret_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
