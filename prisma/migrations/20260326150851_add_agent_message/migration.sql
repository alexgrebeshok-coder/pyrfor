-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "workspaceId" TEXT,
    "runId" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMessage_type_createdAt_idx" ON "AgentMessage"("type", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMessage_source_createdAt_idx" ON "AgentMessage"("source", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMessage_workspaceId_createdAt_idx" ON "AgentMessage"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMessage_runId_idx" ON "AgentMessage"("runId");
