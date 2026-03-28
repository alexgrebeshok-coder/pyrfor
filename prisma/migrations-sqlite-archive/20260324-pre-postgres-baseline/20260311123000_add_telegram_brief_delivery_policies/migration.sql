-- CreateTable
CREATE TABLE "TelegramBriefDeliveryPolicy" (
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

-- CreateIndex
CREATE INDEX "TelegramBriefDeliveryPolicy_workspaceId_active_idx" ON "TelegramBriefDeliveryPolicy"("workspaceId", "active");

-- CreateIndex
CREATE INDEX "TelegramBriefDeliveryPolicy_projectId_idx" ON "TelegramBriefDeliveryPolicy"("projectId");

-- CreateIndex
CREATE INDEX "TelegramBriefDeliveryPolicy_deliveryHour_active_idx" ON "TelegramBriefDeliveryPolicy"("deliveryHour", "active");
