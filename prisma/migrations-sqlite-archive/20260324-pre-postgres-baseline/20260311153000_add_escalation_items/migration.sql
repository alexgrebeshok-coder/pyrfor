-- CreateTable
CREATE TABLE "EscalationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "entityType" TEXT NOT NULL,
    "entityRef" TEXT NOT NULL,
    "projectId" TEXT,
    "projectName" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "purpose" TEXT,
    "urgency" TEXT NOT NULL,
    "queueStatus" TEXT NOT NULL DEFAULT 'open',
    "sourceStatus" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "ownerRole" TEXT,
    "firstObservedAt" DATETIME NOT NULL,
    "lastObservedAt" DATETIME NOT NULL,
    "acknowledgedAt" DATETIME,
    "resolvedAt" DATETIME,
    "slaTargetAt" DATETIME NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "EscalationItem_sourceType_entityType_entityRef_key" ON "EscalationItem"("sourceType", "entityType", "entityRef");

-- CreateIndex
CREATE INDEX "EscalationItem_queueStatus_urgency_idx" ON "EscalationItem"("queueStatus", "urgency");

-- CreateIndex
CREATE INDEX "EscalationItem_projectId_idx" ON "EscalationItem"("projectId");

-- CreateIndex
CREATE INDEX "EscalationItem_ownerId_idx" ON "EscalationItem"("ownerId");

-- CreateIndex
CREATE INDEX "EscalationItem_slaTargetAt_idx" ON "EscalationItem"("slaTargetAt");
