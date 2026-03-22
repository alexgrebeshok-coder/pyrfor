// Seed a production-ready auth user with hashed password, organization, workspace, and membership.
// Run manually with:
//   SEED_AUTH_EMAIL=operator@example.com SEED_AUTH_PASSWORD='strong-password' npm run seed:auth

import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function buildSlug(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'ceoclaw-test'
  );
}

function buildInitials(value: string) {
  const initials = value
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return initials || 'HQ';
}

/**
 * Hash a password using bcrypt
 * @param password - Plain text password
 * @param saltRounds - Number of salt rounds (default: 10)
 * @returns Hashed password
 */
export async function hashPassword(password: string, saltRounds: number = 10): Promise<string> {
  return await bcrypt.hash(password, saltRounds);
}

async function ensureOrganizationAndWorkspace(organizationName: string, workspaceName: string, workspaceKey: string) {
  const now = new Date();

  const organization =
    (await prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
    })) ??
    (await prisma.organization.create({
      data: {
        id: randomUUID(),
        slug: buildSlug(organizationName),
        name: organizationName,
        description: 'Provisioned for production test login.',
        updatedAt: now,
      },
    }));

  const workspace =
    (await prisma.workspace.findFirst({
      where: { organizationId: organization.id },
      orderBy: { createdAt: 'asc' },
    })) ??
    (await prisma.workspace.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        key: workspaceKey,
        name: workspaceName,
        initials: buildInitials(workspaceName),
        description: 'Default workspace for production test login.',
        isDefault: true,
        updatedAt: now,
      },
    }));

  return { organization, workspace };
}

export async function createTestUser(
  email: string,
  password: string,
  name?: string,
  role = 'EXEC'
) {
  const now = new Date();
  const hashedPassword = await hashPassword(password, 10);
  const displayName = name || email.split('@')[0] || 'CEOClaw Test User';
  const organizationName = process.env.SEED_AUTH_ORG_NAME?.trim() || 'CEOClaw Test Organization';
  const workspaceName = process.env.SEED_AUTH_WORKSPACE_NAME?.trim() || 'Main Workspace';
  const workspaceKey = process.env.SEED_AUTH_WORKSPACE_KEY?.trim() || 'main';
  const { organization, workspace } = await ensureOrganizationAndWorkspace(
    organizationName,
    workspaceName,
    workspaceKey
  );

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      name: displayName,
      emailVerified: now,
      updatedAt: now,
    },
    create: {
      id: randomUUID(),
      email,
      password: hashedPassword,
      name: displayName,
      emailVerified: now,
      updatedAt: now,
    },
  });

  const membership =
    (await prisma.membership.findFirst({
      where: {
        userId: user.id,
        organizationId: organization.id,
      },
    })) ??
    (await prisma.membership.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        userId: user.id,
        email,
        displayName,
        role,
        updatedAt: now,
      },
    }));

  if (membership.role !== role || membership.email !== email || membership.displayName !== displayName) {
    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        email,
        displayName,
        role,
        updatedAt: now,
      },
    });
  }

  const workspaceMembership = await prisma.workspaceMembership.findFirst({
    where: {
      workspaceId: workspace.id,
      membershipId: membership.id,
    },
  });

  if (!workspaceMembership) {
    await prisma.workspaceMembership.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        membershipId: membership.id,
        role,
      },
    });
  } else if (workspaceMembership.role !== role) {
    await prisma.workspaceMembership.update({
      where: { id: workspaceMembership.id },
      data: { role },
    });
  }

  return user;
}

async function main() {
  console.log('🔐 Seeding authentication users...');

  const email = process.env.SEED_AUTH_EMAIL?.trim();
  const password = process.env.SEED_AUTH_PASSWORD;
  const name = process.env.SEED_AUTH_NAME?.trim();
  const role = process.env.SEED_AUTH_ROLE?.trim() || 'EXEC';

  if (!email || !password) {
    throw new Error(
      'SEED_AUTH_EMAIL and SEED_AUTH_PASSWORD are required. Refusing to create default credentials.'
    );
  }

  const testUser = await createTestUser(email, password, name, role);

  console.log('✅ Created auth user:', {
    id: testUser.id,
    email: testUser.email,
    name: testUser.name,
    emailVerified: testUser.emailVerified,
    role,
  });
}

main()
  .catch((e) => {
    console.error('❌ Error seeding auth users:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
