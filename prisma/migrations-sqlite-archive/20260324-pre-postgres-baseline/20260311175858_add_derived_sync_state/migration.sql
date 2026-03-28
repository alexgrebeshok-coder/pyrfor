-- CreateTable
CREATE TABLE "DerivedSyncState" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "lastStartedAt" DATETIME,
    "lastCompletedAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastError" TEXT,
    "lastResultCount" INTEGER,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "DerivedSyncState_status_updatedAt_idx" ON "DerivedSyncState"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "DerivedSyncState_lastSuccessAt_idx" ON "DerivedSyncState"("lastSuccessAt");
