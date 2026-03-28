-- CreateTable
CREATE TABLE "DeliveryLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "projectId" TEXT,
    "projectName" TEXT,
    "locale" TEXT NOT NULL,
    "target" TEXT,
    "headline" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "scheduledPolicyId" TEXT,
    "status" TEXT NOT NULL,
    "retryPosture" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "providerMessageId" TEXT,
    "contentHash" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "responseJson" TEXT,
    "lastError" TEXT,
    "firstAttemptAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryLedger_idempotencyKey_key" ON "DeliveryLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DeliveryLedger_channel_updatedAt_idx" ON "DeliveryLedger"("channel", "updatedAt");

-- CreateIndex
CREATE INDEX "DeliveryLedger_status_updatedAt_idx" ON "DeliveryLedger"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "DeliveryLedger_projectId_updatedAt_idx" ON "DeliveryLedger"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "DeliveryLedger_scheduledPolicyId_updatedAt_idx" ON "DeliveryLedger"("scheduledPolicyId", "updatedAt");
