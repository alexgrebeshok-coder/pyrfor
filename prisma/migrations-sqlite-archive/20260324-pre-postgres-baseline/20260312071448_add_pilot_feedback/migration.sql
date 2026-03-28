-- CreateTable
CREATE TABLE "PilotFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "sourceHref" TEXT,
    "projectId" TEXT,
    "projectName" TEXT,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "ownerRole" TEXT,
    "reporterName" TEXT,
    "resolutionNote" TEXT,
    "metadataJson" TEXT,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "PilotFeedback_status_updatedAt_idx" ON "PilotFeedback"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "PilotFeedback_severity_status_updatedAt_idx" ON "PilotFeedback"("severity", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "PilotFeedback_targetType_targetId_updatedAt_idx" ON "PilotFeedback"("targetType", "targetId", "updatedAt");

-- CreateIndex
CREATE INDEX "PilotFeedback_projectId_updatedAt_idx" ON "PilotFeedback"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "PilotFeedback_ownerId_updatedAt_idx" ON "PilotFeedback"("ownerId", "updatedAt");
