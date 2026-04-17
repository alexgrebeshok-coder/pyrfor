-- AlterTable
ALTER TABLE "AgentRuntimeState" ADD COLUMN     "circuitOpenUntil" TIMESTAMP(3),
ADD COLUMN     "circuitOpenedAt" TIMESTAMP(3),
ADD COLUMN     "circuitState" TEXT NOT NULL DEFAULT 'closed',
ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AgentWakeupRequest" ADD COLUMN     "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastErrorType" TEXT,
ADD COLUMN     "maxRetries" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "HeartbeatRun" ADD COLUMN     "replayOfRunId" TEXT,
ADD COLUMN     "replayReason" TEXT,
ADD COLUMN     "replayedFromCheckpointId" TEXT;

-- CreateTable
CREATE TABLE "HeartbeatRunCheckpoint" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "checkpointType" TEXT NOT NULL,
    "stateJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeartbeatRunCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadLetterJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "wakeupRequestId" TEXT,
    "runId" TEXT,
    "reason" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadLetterJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HeartbeatRunCheckpoint_runId_idx" ON "HeartbeatRunCheckpoint"("runId");

-- CreateIndex
CREATE INDEX "HeartbeatRunCheckpoint_runId_stepKey_idx" ON "HeartbeatRunCheckpoint"("runId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "HeartbeatRunCheckpoint_runId_seq_key" ON "HeartbeatRunCheckpoint"("runId", "seq");

-- CreateIndex
CREATE INDEX "DeadLetterJob_workspaceId_status_createdAt_idx" ON "DeadLetterJob"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DeadLetterJob_agentId_createdAt_idx" ON "DeadLetterJob"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "DeadLetterJob_runId_idx" ON "DeadLetterJob"("runId");

-- CreateIndex
CREATE INDEX "DeadLetterJob_wakeupRequestId_idx" ON "DeadLetterJob"("wakeupRequestId");

-- CreateIndex
CREATE INDEX "AgentRuntimeState_circuitState_circuitOpenUntil_idx" ON "AgentRuntimeState"("circuitState", "circuitOpenUntil");

-- CreateIndex
CREATE INDEX "AgentWakeupRequest_status_availableAt_createdAt_idx" ON "AgentWakeupRequest"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentWakeupRequest_agentId_idempotencyKey_key" ON "AgentWakeupRequest"("agentId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "HeartbeatRun_replayOfRunId_idx" ON "HeartbeatRun"("replayOfRunId");

-- CreateIndex
CREATE INDEX "HeartbeatRun_replayedFromCheckpointId_idx" ON "HeartbeatRun"("replayedFromCheckpointId");

-- AddForeignKey
ALTER TABLE "HeartbeatRun" ADD CONSTRAINT "HeartbeatRun_replayOfRunId_fkey" FOREIGN KEY ("replayOfRunId") REFERENCES "HeartbeatRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartbeatRun" ADD CONSTRAINT "HeartbeatRun_replayedFromCheckpointId_fkey" FOREIGN KEY ("replayedFromCheckpointId") REFERENCES "HeartbeatRunCheckpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartbeatRunCheckpoint" ADD CONSTRAINT "HeartbeatRunCheckpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HeartbeatRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadLetterJob" ADD CONSTRAINT "DeadLetterJob_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadLetterJob" ADD CONSTRAINT "DeadLetterJob_wakeupRequestId_fkey" FOREIGN KEY ("wakeupRequestId") REFERENCES "AgentWakeupRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadLetterJob" ADD CONSTRAINT "DeadLetterJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "HeartbeatRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

