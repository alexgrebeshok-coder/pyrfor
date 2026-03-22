/**
 * Admin API - Fix all tables (drop and recreate with FULL schema from Prisma)
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/app/api/middleware/auth';
import { prisma } from '@/lib/db';
import { authorizeAdminRoute } from "../_utils";

export async function GET(request: NextRequest) {
  const authResult = await authorizeAdminRoute(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const results: string[] = [];

    // Drop all business tables in reverse dependency order
    const dropTables = [
      'DROP TABLE IF EXISTS "Notification" CASCADE',
      'DROP TABLE IF EXISTS "TimeEntry" CASCADE',
      'DROP TABLE IF EXISTS "TaskDependency" CASCADE',
      'DROP TABLE IF EXISTS "Column" CASCADE',
      'DROP TABLE IF EXISTS "Board" CASCADE',
      'DROP TABLE IF EXISTS "Document" CASCADE',
      'DROP TABLE IF EXISTS "Milestone" CASCADE',
      'DROP TABLE IF EXISTS "Risk" CASCADE',
      'DROP TABLE IF EXISTS "Task" CASCADE',
      'DROP TABLE IF EXISTS "Project" CASCADE',
      'DROP TABLE IF EXISTS "Memory" CASCADE',
      'DROP TABLE IF EXISTS "TeamMember" CASCADE',
    ];

    for (const sql of dropTables) {
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch (e) {
        // Ignore if table doesn't exist
      }
    }
    results.push('Business tables dropped');

    // Organization table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Organization" (
        "id" TEXT NOT NULL,
        "slug" TEXT NOT NULL UNIQUE,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Organization table ready');

    // Workspace table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Workspace" (
        "id" TEXT NOT NULL,
        "organizationId" TEXT NOT NULL,
        "key" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "initials" TEXT NOT NULL,
        "description" TEXT,
        "isDefault" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Workspace table ready');

    // Memory table
    await prisma.$executeRaw`
      CREATE TABLE "Memory" (
        "id" TEXT NOT NULL,
        "key" TEXT NOT NULL UNIQUE,
        "value" TEXT NOT NULL,
        "category" TEXT,
        "type" TEXT NOT NULL DEFAULT 'episodic',
        "source" TEXT,
        "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
        "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "validUntil" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Memory table created ✅');

    // Project table - FULL SCHEMA from schema.prisma
    await prisma.$executeRaw`
      CREATE TABLE "Project" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "status" TEXT NOT NULL,
        "direction" TEXT NOT NULL,
        "priority" TEXT NOT NULL DEFAULT 'medium',
        "health" TEXT NOT NULL DEFAULT 'good',
        "start" TIMESTAMP(3) NOT NULL,
        "end" TIMESTAMP(3) NOT NULL,
        "budgetPlan" DOUBLE PRECISION,
        "budgetFact" DOUBLE PRECISION DEFAULT 0,
        "progress" INTEGER NOT NULL DEFAULT 0,
        "location" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Project table created ✅ (with direction)');

    // Task table - FULL SCHEMA from schema.prisma
    await prisma.$executeRaw`
      CREATE TABLE "Task" (
        "id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "status" TEXT NOT NULL DEFAULT 'todo',
        "priority" TEXT NOT NULL DEFAULT 'medium',
        "order" INTEGER NOT NULL DEFAULT 0,
        "dueDate" TIMESTAMP(3) NOT NULL,
        "completedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        "projectId" TEXT NOT NULL,
        "assigneeId" TEXT,
        "columnId" TEXT,
        CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Task table created ✅');

    // Risk table - FULL SCHEMA from schema.prisma
    await prisma.$executeRaw`
      CREATE TABLE "Risk" (
        "id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "severity" INTEGER NOT NULL DEFAULT 3,
        "probability" TEXT NOT NULL DEFAULT 'medium',
        "impact" TEXT NOT NULL DEFAULT 'medium',
        "status" TEXT NOT NULL DEFAULT 'open',
        "mitigation" TEXT,
        "ownerId" TEXT,
        "projectId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Risk table created ✅ (with severity INTEGER)');

    // Milestone table
    await prisma.$executeRaw`
      CREATE TABLE "Milestone" (
        "id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "date" TIMESTAMP(3) NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "projectId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Milestone table created');

    // Document table
    await prisma.$executeRaw`
      CREATE TABLE "Document" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "url" TEXT NOT NULL,
        "size" INTEGER,
        "projectId" TEXT,
        "uploadedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Document table created');

    // Board table
    await prisma.$executeRaw`
      CREATE TABLE "Board" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'kanban',
        "projectId" TEXT,
        "workspaceId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Board table created');

    // Column table
    await prisma.$executeRaw`
      CREATE TABLE "Column" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "color" TEXT,
        "order" INTEGER NOT NULL DEFAULT 0,
        "boardId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Column_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Column table created');

    // TaskDependency table
    await prisma.$executeRaw`
      CREATE TABLE "TaskDependency" (
        "id" TEXT NOT NULL,
        "taskId" TEXT NOT NULL,
        "dependsOnId" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'finish_to_start',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('TaskDependency table created');

    // TimeEntry table
    await prisma.$executeRaw`
      CREATE TABLE "TimeEntry" (
        "id" TEXT NOT NULL,
        "taskId" TEXT NOT NULL,
        "userId" TEXT,
        "hours" DOUBLE PRECISION NOT NULL,
        "date" TIMESTAMP(3) NOT NULL,
        "description" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('TimeEntry table created');

    // Notification table - FULL SCHEMA with entityType
    await prisma.$executeRaw`
      CREATE TABLE "Notification" (
        "id" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "entityType" TEXT,
        "entityId" TEXT,
        "read" BOOLEAN NOT NULL DEFAULT false,
        "userId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Notification table created ✅ (with entityType)');

    // TeamMember table
    await prisma.$executeRaw`
      CREATE TABLE "TeamMember" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "initials" TEXT,
        "email" TEXT,
        "role" TEXT NOT NULL,
        "avatar" TEXT,
        "capacity" INTEGER NOT NULL DEFAULT 100,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('TeamMember table created ✅ (with capacity)');

    // Create indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Memory_category_idx" ON "Memory"("category");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Memory_type_idx" ON "Memory"("type");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Project_status_idx" ON "Project"("status");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Project_direction_idx" ON "Project"("direction");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Project_health_idx" ON "Project"("health");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Task_status_idx" ON "Task"("status");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Task_priority_idx" ON "Task"("priority");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Task_dueDate_idx" ON "Task"("dueDate");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Task_projectId_idx" ON "Task"("projectId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Task_projectId_status_order_idx" ON "Task"("projectId", "status", "order");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Task_columnId_idx" ON "Task"("columnId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Risk_projectId_idx" ON "Risk"("projectId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Workspace_organizationId_idx" ON "Workspace"("organizationId");`;
    results.push('Indexes created');

    return NextResponse.json({ 
      success: true, 
      message: 'All tables recreated with FULL schema ✅',
      tables: results
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json({ 
      success: false, 
      error: String(error)
    }, { status: 500 });
  }
}
