/**
 * Admin API - Full database migration via raw SQL
 * Creates all tables needed for NextAuth authentication
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

    // 1. Account table (OAuth accounts)
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Account" (
        "id" TEXT NOT NULL,
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
        CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Account table created');

    // 2. Session table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Session" (
        "id" TEXT NOT NULL,
        "sessionToken" TEXT NOT NULL UNIQUE,
        "userId" TEXT NOT NULL,
        "expires" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('Session table created');

    // 3. VerificationToken table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "VerificationToken" (
        "identifier" TEXT NOT NULL,
        "token" TEXT NOT NULL UNIQUE,
        "expires" TIMESTAMP(3) NOT NULL
      );
    `;
    results.push('VerificationToken table created');

    // 4. Organization table
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
    results.push('Organization table created');

    // 5. TeamMember table (needed for Membership FK)
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "TeamMember" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "initials" TEXT,
        "role" TEXT NOT NULL,
        "email" TEXT,
        "avatar" TEXT,
        "capacity" INTEGER NOT NULL DEFAULT 100,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('TeamMember table created');

    // 6. Membership table (CRITICAL - links User to Organization)
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Membership" (
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
    results.push('Membership table created ✅ (CRITICAL)');

    // 7. Workspace table
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
    results.push('Workspace table created');

    // 8. WorkspaceMembership table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "WorkspaceMembership" (
        "id" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "membershipId" TEXT NOT NULL,
        "role" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
      );
    `;
    results.push('WorkspaceMembership table created');

    // Create indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Account_userId_idx" ON "Account"("userId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Membership_userId_idx" ON "Membership"("userId");`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Membership_teamMemberId_idx" ON "Membership"("teamMemberId");`;
    results.push('Indexes created');

    return NextResponse.json({ 
      success: true, 
      message: 'Authentication tables created successfully',
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
