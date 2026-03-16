CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Project" (
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
    "location" TEXT
);
CREATE TABLE IF NOT EXISTS "Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "order" INTEGER NOT NULL DEFAULT 0,
    "dueDate" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "projectId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "columnId" TEXT,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Task_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "Column" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "initials" TEXT,
    "role" TEXT NOT NULL,
    "email" TEXT,
    "avatar" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "Membership" (
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
    CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Membership_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "WorkspaceMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceMembership_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Risk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "probability" TEXT NOT NULL DEFAULT 'medium',
    "impact" TEXT NOT NULL DEFAULT 'medium',
    "severity" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'open',
    "ownerId" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Risk_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Risk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Milestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER,
    "ownerId" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Board" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Board_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Column" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "boardId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Column_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "TaskDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'FINISH_TO_START',
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "TimeEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "memberId" TEXT,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME,
    "duration" INTEGER,
    "description" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimeEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "TelegramBriefDeliveryPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'executive',
    "scope" TEXT NOT NULL,
    "projectId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "chatId" TEXT,
    "cadence" TEXT NOT NULL DEFAULT 'daily',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "deliveryHour" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "lastAttemptAt" DATETIME,
    "lastDeliveredAt" DATETIME,
    "lastMessageId" INTEGER,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TelegramBriefDeliveryPolicy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "PilotReviewDeliveryPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL DEFAULT 'executive',
    "channel" TEXT NOT NULL DEFAULT 'email',
    "recipient" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "deliveryHour" INTEGER NOT NULL,
    "deliveryWeekday" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "lastAttemptAt" DATETIME,
    "lastDeliveredAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "CutoverDecision" (
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
CREATE TABLE IF NOT EXISTS "TenantOnboardingRunbook" (
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
CREATE TABLE IF NOT EXISTS "DeliveryLedger" (
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
CREATE TABLE IF NOT EXISTS "PilotFeedback" (
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
CREATE TABLE IF NOT EXISTS "WorkReport" (
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
CREATE TABLE IF NOT EXISTS "EvidenceRecord" (
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
CREATE TABLE IF NOT EXISTS "EscalationItem" (
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
CREATE TABLE IF NOT EXISTS "AiRunLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "origin" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "quickActionId" TEXT,
    "projectId" TEXT,
    "workflow" TEXT,
    "sourceEntityType" TEXT,
    "sourceEntityId" TEXT,
    "inputJson" TEXT NOT NULL,
    "runJson" TEXT NOT NULL,
    "runCreatedAt" DATETIME NOT NULL,
    "runUpdatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "DerivedSyncState" (
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
CREATE TABLE IF NOT EXISTS "ReconciliationCasefile" (
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
CREATE TABLE IF NOT EXISTS "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "confidence" REAL NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "task" TEXT,
    "result" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "cost" REAL NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "triggers" TEXT,
    "config" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "Communication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "response" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "AIProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "baseUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "models" TEXT NOT NULL,
    "defaultModel" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "ContextSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "projectId" TEXT,
    "data" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "_ProjectToTeamMember" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ProjectToTeamMember_A_fkey" FOREIGN KEY ("A") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ProjectToTeamMember_B_fkey" FOREIGN KEY ("B") REFERENCES "TeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "Workspace_organizationId_idx" ON "Workspace"("organizationId");
CREATE UNIQUE INDEX "Workspace_organizationId_key_key" ON "Workspace"("organizationId", "key");
CREATE INDEX "Project_status_idx" ON "Project"("status");
CREATE INDEX "Project_direction_idx" ON "Project"("direction");
CREATE INDEX "Project_health_idx" ON "Project"("health");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE INDEX "Task_priority_idx" ON "Task"("priority");
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");
CREATE INDEX "Task_projectId_status_order_idx" ON "Task"("projectId", "status", "order");
CREATE INDEX "Task_columnId_idx" ON "Task"("columnId");
CREATE INDEX "TeamMember_name_idx" ON "TeamMember"("name");
CREATE UNIQUE INDEX "Membership_externalUserId_key" ON "Membership"("externalUserId");
CREATE INDEX "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");
CREATE INDEX "Membership_teamMemberId_idx" ON "Membership"("teamMemberId");
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");
CREATE INDEX "WorkspaceMembership_membershipId_idx" ON "WorkspaceMembership"("membershipId");
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_membershipId_key" ON "WorkspaceMembership"("workspaceId", "membershipId");
CREATE INDEX "Risk_status_idx" ON "Risk"("status");
CREATE INDEX "Risk_severity_idx" ON "Risk"("severity");
CREATE INDEX "Risk_projectId_idx" ON "Risk"("projectId");
CREATE INDEX "Milestone_date_idx" ON "Milestone"("date");
CREATE INDEX "Milestone_status_idx" ON "Milestone"("status");
CREATE INDEX "Milestone_projectId_idx" ON "Milestone"("projectId");
CREATE INDEX "Document_type_idx" ON "Document"("type");
CREATE INDEX "Document_projectId_idx" ON "Document"("projectId");
CREATE INDEX "Board_projectId_idx" ON "Board"("projectId");
CREATE INDEX "Column_boardId_idx" ON "Column"("boardId");
CREATE INDEX "Column_boardId_order_idx" ON "Column"("boardId", "order");
CREATE INDEX "TaskDependency_taskId_idx" ON "TaskDependency"("taskId");
CREATE INDEX "TaskDependency_dependsOnTaskId_idx" ON "TaskDependency"("dependsOnTaskId");
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key" ON "TaskDependency"("taskId", "dependsOnTaskId");
CREATE INDEX "TimeEntry_taskId_idx" ON "TimeEntry"("taskId");
CREATE INDEX "TimeEntry_memberId_idx" ON "TimeEntry"("memberId");
CREATE INDEX "TimeEntry_startTime_idx" ON "TimeEntry"("startTime");
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");
CREATE INDEX "Notification_read_idx" ON "Notification"("read");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
CREATE INDEX "TelegramBriefDeliveryPolicy_workspaceId_active_idx" ON "TelegramBriefDeliveryPolicy"("workspaceId", "active");
CREATE INDEX "TelegramBriefDeliveryPolicy_projectId_idx" ON "TelegramBriefDeliveryPolicy"("projectId");
CREATE INDEX "TelegramBriefDeliveryPolicy_deliveryHour_active_idx" ON "TelegramBriefDeliveryPolicy"("deliveryHour", "active");
CREATE INDEX "PilotReviewDeliveryPolicy_workspaceId_active_idx" ON "PilotReviewDeliveryPolicy"("workspaceId", "active");
CREATE INDEX "PilotReviewDeliveryPolicy_deliveryWeekday_deliveryHour_active_idx" ON "PilotReviewDeliveryPolicy"("deliveryWeekday", "deliveryHour", "active");
CREATE INDEX "CutoverDecision_workspaceId_createdAt_idx" ON "CutoverDecision"("workspaceId", "createdAt");
CREATE INDEX "CutoverDecision_tenantSlug_createdAt_idx" ON "CutoverDecision"("tenantSlug", "createdAt");
CREATE INDEX "CutoverDecision_decisionType_createdAt_idx" ON "CutoverDecision"("decisionType", "createdAt");
CREATE INDEX "TenantOnboardingRunbook_workspaceId_updatedAt_idx" ON "TenantOnboardingRunbook"("workspaceId", "updatedAt");
CREATE INDEX "TenantOnboardingRunbook_baselineTenantSlug_updatedAt_idx" ON "TenantOnboardingRunbook"("baselineTenantSlug", "updatedAt");
CREATE INDEX "TenantOnboardingRunbook_status_updatedAt_idx" ON "TenantOnboardingRunbook"("status", "updatedAt");
CREATE UNIQUE INDEX "DeliveryLedger_idempotencyKey_key" ON "DeliveryLedger"("idempotencyKey");
CREATE INDEX "DeliveryLedger_channel_updatedAt_idx" ON "DeliveryLedger"("channel", "updatedAt");
CREATE INDEX "DeliveryLedger_status_updatedAt_idx" ON "DeliveryLedger"("status", "updatedAt");
CREATE INDEX "DeliveryLedger_projectId_updatedAt_idx" ON "DeliveryLedger"("projectId", "updatedAt");
CREATE INDEX "DeliveryLedger_scheduledPolicyId_updatedAt_idx" ON "DeliveryLedger"("scheduledPolicyId", "updatedAt");
CREATE INDEX "PilotFeedback_status_updatedAt_idx" ON "PilotFeedback"("status", "updatedAt");
CREATE INDEX "PilotFeedback_severity_status_updatedAt_idx" ON "PilotFeedback"("severity", "status", "updatedAt");
CREATE INDEX "PilotFeedback_targetType_targetId_updatedAt_idx" ON "PilotFeedback"("targetType", "targetId", "updatedAt");
CREATE INDEX "PilotFeedback_projectId_updatedAt_idx" ON "PilotFeedback"("projectId", "updatedAt");
CREATE INDEX "PilotFeedback_ownerId_updatedAt_idx" ON "PilotFeedback"("ownerId", "updatedAt");
CREATE UNIQUE INDEX "WorkReport_reportNumber_key" ON "WorkReport"("reportNumber");
CREATE INDEX "WorkReport_projectId_idx" ON "WorkReport"("projectId");
CREATE INDEX "WorkReport_authorId_idx" ON "WorkReport"("authorId");
CREATE INDEX "WorkReport_reviewerId_idx" ON "WorkReport"("reviewerId");
CREATE INDEX "WorkReport_reportDate_idx" ON "WorkReport"("reportDate");
CREATE INDEX "WorkReport_status_idx" ON "WorkReport"("status");
CREATE INDEX "WorkReport_projectId_reportDate_idx" ON "WorkReport"("projectId", "reportDate");
CREATE INDEX "EvidenceRecord_verificationStatus_idx" ON "EvidenceRecord"("verificationStatus");
CREATE INDEX "EvidenceRecord_entityType_entityRef_idx" ON "EvidenceRecord"("entityType", "entityRef");
CREATE INDEX "EvidenceRecord_projectId_idx" ON "EvidenceRecord"("projectId");
CREATE INDEX "EvidenceRecord_observedAt_idx" ON "EvidenceRecord"("observedAt");
CREATE UNIQUE INDEX "EvidenceRecord_sourceType_entityType_entityRef_key" ON "EvidenceRecord"("sourceType", "entityType", "entityRef");
CREATE INDEX "EscalationItem_queueStatus_urgency_idx" ON "EscalationItem"("queueStatus", "urgency");
CREATE INDEX "EscalationItem_projectId_idx" ON "EscalationItem"("projectId");
CREATE INDEX "EscalationItem_ownerId_idx" ON "EscalationItem"("ownerId");
CREATE INDEX "EscalationItem_slaTargetAt_idx" ON "EscalationItem"("slaTargetAt");
CREATE UNIQUE INDEX "EscalationItem_sourceType_entityType_entityRef_key" ON "EscalationItem"("sourceType", "entityType", "entityRef");
CREATE INDEX "AiRunLedger_status_runUpdatedAt_idx" ON "AiRunLedger"("status", "runUpdatedAt");
CREATE INDEX "AiRunLedger_workflow_idx" ON "AiRunLedger"("workflow");
CREATE INDEX "AiRunLedger_projectId_idx" ON "AiRunLedger"("projectId");
CREATE INDEX "AiRunLedger_runCreatedAt_idx" ON "AiRunLedger"("runCreatedAt");
CREATE INDEX "DerivedSyncState_status_updatedAt_idx" ON "DerivedSyncState"("status", "updatedAt");
CREATE INDEX "DerivedSyncState_lastSuccessAt_idx" ON "DerivedSyncState"("lastSuccessAt");
CREATE UNIQUE INDEX "ReconciliationCasefile_key_key" ON "ReconciliationCasefile"("key");
CREATE INDEX "ReconciliationCasefile_resolutionStatus_updatedAt_idx" ON "ReconciliationCasefile"("resolutionStatus", "updatedAt");
CREATE INDEX "ReconciliationCasefile_truthStatus_updatedAt_idx" ON "ReconciliationCasefile"("truthStatus", "updatedAt");
CREATE INDEX "ReconciliationCasefile_projectId_idx" ON "ReconciliationCasefile"("projectId");
CREATE INDEX "ReconciliationCasefile_caseType_updatedAt_idx" ON "ReconciliationCasefile"("caseType", "updatedAt");
CREATE INDEX "ReconciliationCasefile_lastObservedAt_idx" ON "ReconciliationCasefile"("lastObservedAt");
CREATE INDEX "Memory_type_category_idx" ON "Memory"("type", "category");
CREATE INDEX "Memory_key_idx" ON "Memory"("key");
CREATE INDEX "AgentSession_agentId_status_idx" ON "AgentSession"("agentId", "status");
CREATE INDEX "AgentSession_createdAt_idx" ON "AgentSession"("createdAt");
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");
CREATE INDEX "Skill_category_enabled_idx" ON "Skill"("category", "enabled");
CREATE INDEX "Communication_channel_createdAt_idx" ON "Communication"("channel", "createdAt");
CREATE UNIQUE INDEX "AIProvider_name_key" ON "AIProvider"("name");
CREATE INDEX "AIProvider_enabled_priority_idx" ON "AIProvider"("enabled", "priority");
CREATE INDEX "ContextSnapshot_type_createdAt_idx" ON "ContextSnapshot"("type", "createdAt");
CREATE UNIQUE INDEX "_ProjectToTeamMember_AB_unique" ON "_ProjectToTeamMember"("A", "B");
CREATE INDEX "_ProjectToTeamMember_B_index" ON "_ProjectToTeamMember"("B");
