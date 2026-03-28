-- CreateTable
CREATE TABLE "ReconciliationCasefile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "truthStatus" TEXT NOT NULL,
    "resolutionStatus" TEXT NOT NULL DEFAULT 'open',
    "projectId" TEXT,
    "projectName" TEXT,
    "financeProjectId" TEXT,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "reasonCodesJson" TEXT NOT NULL,
    "evidenceRecordIdsJson" TEXT NOT NULL,
    "fusionFactIdsJson" TEXT NOT NULL,
    "telemetryRefsJson" TEXT NOT NULL,
    "financeJson" TEXT,
    "fieldJson" TEXT,
    "telemetryJson" TEXT,
    "lastObservedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationCasefile_key_key" ON "ReconciliationCasefile"("key");

-- CreateIndex
CREATE INDEX "ReconciliationCasefile_resolutionStatus_updatedAt_idx" ON "ReconciliationCasefile"("resolutionStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "ReconciliationCasefile_truthStatus_updatedAt_idx" ON "ReconciliationCasefile"("truthStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "ReconciliationCasefile_projectId_idx" ON "ReconciliationCasefile"("projectId");

-- CreateIndex
CREATE INDEX "ReconciliationCasefile_caseType_updatedAt_idx" ON "ReconciliationCasefile"("caseType", "updatedAt");

-- CreateIndex
CREATE INDEX "ReconciliationCasefile_lastObservedAt_idx" ON "ReconciliationCasefile"("lastObservedAt");
