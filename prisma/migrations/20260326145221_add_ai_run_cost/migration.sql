-- CreateTable
CREATE TABLE "AiApplyDecisionLedger" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "proposalType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "operatorId" TEXT,
    "toolCallIdsJson" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "errorMessage" TEXT,
    "compensationMode" TEXT,
    "compensationSummary" TEXT,
    "executedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiApplyDecisionLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT,
    "accountLabel" TEXT,
    "accountEmail" TEXT,
    "metadata" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorSyncEntry" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "syncToken" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ConnectorSyncEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIRunCost" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "costRub" DOUBLE PRECISION NOT NULL,
    "agentId" TEXT,
    "sessionId" TEXT,
    "workspaceId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIRunCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiApplyDecisionLedger_idempotencyKey_key" ON "AiApplyDecisionLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AiApplyDecisionLedger_runId_updatedAt_idx" ON "AiApplyDecisionLedger"("runId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiApplyDecisionLedger_status_updatedAt_idx" ON "AiApplyDecisionLedger"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiApplyDecisionLedger_runId_proposalId_key" ON "AiApplyDecisionLedger"("runId", "proposalId");

-- CreateIndex
CREATE INDEX "ConnectorCredential_workspaceId_idx" ON "ConnectorCredential"("workspaceId");

-- CreateIndex
CREATE INDEX "ConnectorCredential_connectorId_idx" ON "ConnectorCredential"("connectorId");

-- CreateIndex
CREATE INDEX "ConnectorCredential_provider_idx" ON "ConnectorCredential"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorCredential_workspaceId_connectorId_key" ON "ConnectorCredential"("workspaceId", "connectorId");

-- CreateIndex
CREATE INDEX "ConnectorSyncEntry_credentialId_startedAt_idx" ON "ConnectorSyncEntry"("credentialId", "startedAt");

-- CreateIndex
CREATE INDEX "ConnectorSyncEntry_status_idx" ON "ConnectorSyncEntry"("status");

-- CreateIndex
CREATE INDEX "AIRunCost_provider_createdAt_idx" ON "AIRunCost"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "AIRunCost_workspaceId_createdAt_idx" ON "AIRunCost"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AIRunCost_agentId_createdAt_idx" ON "AIRunCost"("agentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConnectorSyncEntry" ADD CONSTRAINT "ConnectorSyncEntry_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ConnectorCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
