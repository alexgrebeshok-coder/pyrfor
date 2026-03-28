CREATE TABLE "PilotReviewDeliveryPolicy" (
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

CREATE INDEX "PilotReviewDeliveryPolicy_workspaceId_active_idx"
ON "PilotReviewDeliveryPolicy"("workspaceId", "active");

CREATE INDEX "PilotReviewDeliveryPolicy_deliveryWeekday_deliveryHour_active_idx"
ON "PilotReviewDeliveryPolicy"("deliveryWeekday", "deliveryHour", "active");
