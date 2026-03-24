-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "entityType" TEXT NOT NULL,
    "entityRef" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "observedAt" DATETIME NOT NULL,
    "reportedAt" DATETIME,
    "confidence" REAL NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvidenceRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EvidenceRecord_verificationStatus_idx" ON "EvidenceRecord"("verificationStatus");

-- CreateIndex
CREATE INDEX "EvidenceRecord_entityType_entityRef_idx" ON "EvidenceRecord"("entityType", "entityRef");

-- CreateIndex
CREATE INDEX "EvidenceRecord_projectId_idx" ON "EvidenceRecord"("projectId");

-- CreateIndex
CREATE INDEX "EvidenceRecord_observedAt_idx" ON "EvidenceRecord"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_sourceType_entityType_entityRef_key" ON "EvidenceRecord"("sourceType", "entityType", "entityRef");
