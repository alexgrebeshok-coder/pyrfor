-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "definitionJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowTemplateId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "triggerType" TEXT NOT NULL DEFAULT 'manual',
    "inputJson" TEXT NOT NULL DEFAULT '{}',
    "contextJson" TEXT NOT NULL DEFAULT '{}',
    "resultJson" TEXT,
    "errorMessage" TEXT,
    "createdBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRunStep" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stepType" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dependsOnJson" TEXT NOT NULL DEFAULT '[]',
    "inputJson" TEXT,
    "outputJson" TEXT,
    "errorMessage" TEXT,
    "agentId" TEXT,
    "approvalId" TEXT,
    "checkpointId" TEXT,
    "heartbeatRunId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDelegation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "workflowStepId" TEXT,
    "parentAgentId" TEXT,
    "childAgentId" TEXT NOT NULL,
    "parentRunId" TEXT,
    "childRunId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'delegated',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "AgentDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowTemplate_workspaceId_status_updatedAt_idx" ON "WorkflowTemplate"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowTemplate_workspaceId_slug_key" ON "WorkflowTemplate"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "WorkflowRun_workspaceId_status_createdAt_idx" ON "WorkflowRun"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_workflowTemplateId_createdAt_idx" ON "WorkflowRun"("workflowTemplateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRunStep_heartbeatRunId_key" ON "WorkflowRunStep"("heartbeatRunId");

-- CreateIndex
CREATE INDEX "WorkflowRunStep_workflowRunId_status_seq_idx" ON "WorkflowRunStep"("workflowRunId", "status", "seq");

-- CreateIndex
CREATE INDEX "WorkflowRunStep_agentId_status_idx" ON "WorkflowRunStep"("agentId", "status");

-- CreateIndex
CREATE INDEX "WorkflowRunStep_approvalId_idx" ON "WorkflowRunStep"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRunStep_workflowRunId_nodeId_key" ON "WorkflowRunStep"("workflowRunId", "nodeId");

-- CreateIndex
CREATE INDEX "AgentDelegation_workspaceId_createdAt_idx" ON "AgentDelegation"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDelegation_workflowRunId_idx" ON "AgentDelegation"("workflowRunId");

-- CreateIndex
CREATE INDEX "AgentDelegation_workflowStepId_idx" ON "AgentDelegation"("workflowStepId");

-- CreateIndex
CREATE INDEX "AgentDelegation_parentAgentId_childAgentId_idx" ON "AgentDelegation"("parentAgentId", "childAgentId");

-- CreateIndex
CREATE INDEX "AgentDelegation_parentRunId_idx" ON "AgentDelegation"("parentRunId");

-- CreateIndex
CREATE INDEX "AgentDelegation_childRunId_idx" ON "AgentDelegation"("childRunId");

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowTemplateId_fkey" FOREIGN KEY ("workflowTemplateId") REFERENCES "WorkflowTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRunStep" ADD CONSTRAINT "WorkflowRunStep_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRunStep" ADD CONSTRAINT "WorkflowRunStep_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRunStep" ADD CONSTRAINT "WorkflowRunStep_heartbeatRunId_fkey" FOREIGN KEY ("heartbeatRunId") REFERENCES "HeartbeatRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_parentAgentId_fkey" FOREIGN KEY ("parentAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_childAgentId_fkey" FOREIGN KEY ("childAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "HeartbeatRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDelegation" ADD CONSTRAINT "AgentDelegation_childRunId_fkey" FOREIGN KEY ("childRunId") REFERENCES "HeartbeatRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
