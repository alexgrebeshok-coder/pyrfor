CREATE TABLE "CutoverDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'executive',
    "tenantSlug" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "warningId" TEXT,
    "warningLabel" TEXT,
    "readinessOutcome" TEXT NOT NULL,
    "readinessOutcomeLabel" TEXT NOT NULL,
    "readinessGeneratedAt" DATETIME NOT NULL,
    "reviewOutcome" TEXT NOT NULL,
    "reviewOutcomeLabel" TEXT NOT NULL,
    "reviewGeneratedAt" DATETIME NOT NULL,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdByRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "CutoverDecision_workspaceId_createdAt_idx"
ON "CutoverDecision"("workspaceId", "createdAt");

CREATE INDEX "CutoverDecision_tenantSlug_createdAt_idx"
ON "CutoverDecision"("tenantSlug", "createdAt");

CREATE INDEX "CutoverDecision_decisionType_createdAt_idx"
ON "CutoverDecision"("decisionType", "createdAt");
