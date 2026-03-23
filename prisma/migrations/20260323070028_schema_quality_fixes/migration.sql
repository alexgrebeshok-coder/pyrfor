-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "organizationId" TEXT,
    "payloadJson" TEXT NOT NULL,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EvidenceRecord" (
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
    CONSTRAINT "EvidenceRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EvidenceRecord" ("confidence", "createdAt", "entityRef", "entityType", "id", "metadataJson", "observedAt", "projectId", "reportedAt", "sourceRef", "sourceType", "summary", "title", "updatedAt", "verificationStatus") SELECT "confidence", "createdAt", "entityRef", "entityType", "id", "metadataJson", "observedAt", "projectId", "reportedAt", "sourceRef", "sourceType", "summary", "title", "updatedAt", "verificationStatus" FROM "EvidenceRecord";
DROP TABLE "EvidenceRecord";
ALTER TABLE "new_EvidenceRecord" RENAME TO "EvidenceRecord";
CREATE INDEX "EvidenceRecord_observedAt_idx" ON "EvidenceRecord"("observedAt");
CREATE INDEX "EvidenceRecord_projectId_idx" ON "EvidenceRecord"("projectId");
CREATE INDEX "EvidenceRecord_entityType_entityRef_idx" ON "EvidenceRecord"("entityType", "entityRef");
CREATE INDEX "EvidenceRecord_verificationStatus_idx" ON "EvidenceRecord"("verificationStatus");
CREATE UNIQUE INDEX "EvidenceRecord_sourceType_entityType_entityRef_key" ON "EvidenceRecord"("sourceType", "entityType", "entityRef");
CREATE TABLE "new_Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "teamMemberId" TEXT,
    "externalUserId" TEXT,
    "email" TEXT,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Membership_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Membership" ("createdAt", "displayName", "email", "externalUserId", "id", "organizationId", "role", "teamMemberId", "updatedAt", "userId") SELECT "createdAt", "displayName", "email", "externalUserId", "id", "organizationId", "role", "teamMemberId", "updatedAt", "userId" FROM "Membership";
DROP TABLE "Membership";
ALTER TABLE "new_Membership" RENAME TO "Membership";
CREATE UNIQUE INDEX "Membership_externalUserId_key" ON "Membership"("externalUserId");
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");
CREATE INDEX "Membership_teamMemberId_idx" ON "Membership"("teamMemberId");
CREATE INDEX "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");
CREATE TABLE "new_Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "billingPlan" TEXT NOT NULL DEFAULT 'free',
    "billingStatus" TEXT NOT NULL DEFAULT 'active',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "trialEndsAt" DATETIME,
    "aiUsageToday" INTEGER NOT NULL DEFAULT 0,
    "aiUsageResetAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Organization" ("createdAt", "description", "id", "name", "slug", "updatedAt") SELECT "createdAt", "description", "id", "name", "slug", "updatedAt" FROM "Organization";
DROP TABLE "Organization";
ALTER TABLE "new_Organization" RENAME TO "Organization";
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "Organization_stripeCustomerId_key" ON "Organization"("stripeCustomerId");
CREATE UNIQUE INDEX "Organization_stripeSubscriptionId_key" ON "Organization"("stripeSubscriptionId");
CREATE INDEX "Organization_billingStatus_idx" ON "Organization"("billingStatus");
CREATE INDEX "Organization_createdAt_idx" ON "Organization"("createdAt");
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "health" TEXT NOT NULL DEFAULT 'good',
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "budgetPlan" REAL,
    "budgetFact" REAL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT,
    "workspaceId" TEXT NOT NULL DEFAULT 'executive'
);
INSERT INTO "new_Project" ("budgetFact", "budgetPlan", "createdAt", "description", "direction", "end", "health", "id", "location", "name", "priority", "progress", "start", "status", "updatedAt") SELECT "budgetFact", "budgetPlan", "createdAt", "description", "direction", "end", "health", "id", "location", "name", "priority", "progress", "start", "status", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE INDEX "Project_status_health_idx" ON "Project"("status", "health");
CREATE INDEX "Project_status_priority_idx" ON "Project"("status", "priority");
CREATE INDEX "Project_health_idx" ON "Project"("health");
CREATE INDEX "Project_direction_idx" ON "Project"("direction");
CREATE INDEX "Project_status_idx" ON "Project"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BillingEvent_type_createdAt_idx" ON "BillingEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "BillingEvent_organizationId_createdAt_idx" ON "BillingEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
