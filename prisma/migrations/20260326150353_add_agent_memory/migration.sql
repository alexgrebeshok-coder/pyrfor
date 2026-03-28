-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "memoryType" TEXT NOT NULL DEFAULT 'episodic',
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "embedding_json" TEXT,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMemory_agentId_workspaceId_idx" ON "AgentMemory"("agentId", "workspaceId");

-- CreateIndex
CREATE INDEX "AgentMemory_agentId_memoryType_idx" ON "AgentMemory"("agentId", "memoryType");

-- CreateIndex
CREATE INDEX "AgentMemory_workspaceId_projectId_idx" ON "AgentMemory"("workspaceId", "projectId");
