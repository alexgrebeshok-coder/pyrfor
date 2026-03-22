/**
 * Admin API - Fix Membership table
 * Drops and recreates Membership table with correct columns
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

    // 1. Drop Membership table (and dependent tables)
    await prisma.$executeRaw`DROP TABLE IF EXISTS "WorkspaceMembership" CASCADE;`;
    results.push('WorkspaceMembership table dropped');

    await prisma.$executeRaw`DROP TABLE IF EXISTS "Membership" CASCADE;`;
    results.push('Membership table dropped');

    // 2. Recreate Membership table with ALL correct columns from schema
    await prisma.$executeRaw`
      CREATE TABLE "Membership" (
        "id" TEXT NOT NULL,
        "organizationId" TEXT NOT NULL,
        "userId" TEXT,
        "teamMemberId" TEXT,
        "externalUserId" TEXT UNIQUE,
        "email" TEXT,
        "displayName" TEXT NOT NULL,
        "role" TEXT NOT NULL DEFAULT 'MEMBER',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Membership table recreated ✅');

    // 3. Recreate WorkspaceMembership table
    await prisma.$executeRaw`
      CREATE TABLE "WorkspaceMembership" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "membershipId" TEXT NOT NULL,
        "role" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('WorkspaceMembership table recreated');

    // 4. Create indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Membership_userId_idx" ON "Membership"("userId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Membership_teamMemberId_idx" ON "Membership"("teamMemberId");`;
    results.push('Indexes created');

    return NextResponse.json({ 
      success: true, 
      message: 'Membership table fixed successfully',
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
