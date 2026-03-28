-- CreateTable
CREATE TABLE "TenantOnboardingRunbook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'executive',
    "baselineTenantSlug" TEXT NOT NULL,
    "baselineTenantLabel" TEXT NOT NULL,
    "targetTenantSlug" TEXT,
    "targetTenantLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL,
    "rolloutScope" TEXT NOT NULL,
    "operatorNotes" TEXT,
    "handoffNotes" TEXT,
    "rollbackPlan" TEXT,
    "targetCutoverAt" DATETIME,
    "templateVersion" TEXT NOT NULL DEFAULT 'tenant-rollout-v1',
    "readinessOutcome" TEXT NOT NULL,
    "readinessOutcomeLabel" TEXT NOT NULL,
    "readinessGeneratedAt" DATETIME NOT NULL,
    "reviewOutcome" TEXT NOT NULL,
    "reviewOutcomeLabel" TEXT NOT NULL,
    "reviewGeneratedAt" DATETIME NOT NULL,
    "latestDecisionType" TEXT,
    "latestDecisionLabel" TEXT,
    "latestDecisionSummary" TEXT,
    "latestDecisionAt" DATETIME,
    "blockerCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdByRole" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "TenantOnboardingRunbook_workspaceId_updatedAt_idx" ON "TenantOnboardingRunbook"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "TenantOnboardingRunbook_baselineTenantSlug_updatedAt_idx" ON "TenantOnboardingRunbook"("baselineTenantSlug", "updatedAt");

-- CreateIndex
CREATE INDEX "TenantOnboardingRunbook_status_updatedAt_idx" ON "TenantOnboardingRunbook"("status", "updatedAt");
