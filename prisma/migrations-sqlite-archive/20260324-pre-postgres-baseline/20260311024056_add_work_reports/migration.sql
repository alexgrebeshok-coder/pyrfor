-- CreateTable
CREATE TABLE "WorkReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportNumber" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "section" TEXT NOT NULL,
    "reportDate" DATETIME NOT NULL,
    "workDescription" TEXT NOT NULL,
    "volumesJson" TEXT NOT NULL DEFAULT '[]',
    "personnelCount" INTEGER,
    "personnelDetails" TEXT,
    "equipment" TEXT,
    "weather" TEXT,
    "issues" TEXT,
    "nextDayPlan" TEXT,
    "attachmentsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "reviewComment" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "externalReporterTelegramId" TEXT,
    "externalReporterName" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "TeamMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkReport_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkReport_reportNumber_key" ON "WorkReport"("reportNumber");

-- CreateIndex
CREATE INDEX "WorkReport_projectId_idx" ON "WorkReport"("projectId");

-- CreateIndex
CREATE INDEX "WorkReport_authorId_idx" ON "WorkReport"("authorId");

-- CreateIndex
CREATE INDEX "WorkReport_reviewerId_idx" ON "WorkReport"("reviewerId");

-- CreateIndex
CREATE INDEX "WorkReport_reportDate_idx" ON "WorkReport"("reportDate");

-- CreateIndex
CREATE INDEX "WorkReport_status_idx" ON "WorkReport"("status");

-- CreateIndex
CREATE INDEX "WorkReport_projectId_reportDate_idx" ON "WorkReport"("projectId", "reportDate");
