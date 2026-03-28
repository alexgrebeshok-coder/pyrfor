-- CreateTable
CREATE TABLE "AiRunLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "origin" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "quickActionId" TEXT,
    "projectId" TEXT,
    "workflow" TEXT,
    "sourceEntityType" TEXT,
    "sourceEntityId" TEXT,
    "inputJson" TEXT NOT NULL,
    "runJson" TEXT NOT NULL,
    "runCreatedAt" DATETIME NOT NULL,
    "runUpdatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AiRunLedger_status_runUpdatedAt_idx" ON "AiRunLedger"("status", "runUpdatedAt");

-- CreateIndex
CREATE INDEX "AiRunLedger_workflow_idx" ON "AiRunLedger"("workflow");

-- CreateIndex
CREATE INDEX "AiRunLedger_projectId_idx" ON "AiRunLedger"("projectId");

-- CreateIndex
CREATE INDEX "AiRunLedger_runCreatedAt_idx" ON "AiRunLedger"("runCreatedAt");
