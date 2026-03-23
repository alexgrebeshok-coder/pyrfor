import { randomUUID } from "crypto";

import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export interface ProvisionAuthUserInput {
  email: string;
  password: string;
  name?: string;
  role?: string;
  organizationName?: string;
  workspaceName?: string;
  workspaceKey?: string;
}

export interface ProvisionedAuthUser {
  id: string;
  email: string | null;
  name: string | null;
  emailVerified: Date | null;
  role: string;
}

function buildSlug(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "ceoclaw-test"
  );
}

function buildInitials(value: string) {
  const initials = value
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "HQ";
}

export async function hashPassword(password: string, saltRounds = 10): Promise<string> {
  return bcrypt.hash(password, saltRounds);
}

async function ensureOrganizationAndWorkspace(
  prisma: PrismaClient,
  organizationName: string,
  workspaceName: string,
  workspaceKey: string
) {
  const now = new Date();

  const organization =
    (await prisma.organization.findFirst({
      select: {
        id: true,
      },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.organization.create({
      data: {
        id: randomUUID(),
        slug: buildSlug(organizationName),
        name: organizationName,
        description: "Provisioned for production test login.",
        updatedAt: now,
      },
      select: {
        id: true,
      },
    }));

  const workspace =
    (await prisma.workspace.findFirst({
      select: {
        id: true,
      },
      where: { organizationId: organization.id },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.workspace.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        key: workspaceKey,
        name: workspaceName,
        initials: buildInitials(workspaceName),
        description: "Default workspace for production test login.",
        isDefault: true,
        updatedAt: now,
      },
      select: {
        id: true,
      },
    }));

  return { organization, workspace };
}

export async function provisionAuthUser(
  prisma: PrismaClient,
  input: ProvisionAuthUserInput
): Promise<ProvisionedAuthUser> {
  const now = new Date();
  const role = input.role?.trim() || "EXEC";
  const displayName = input.name?.trim() || input.email.split("@")[0] || "CEOClaw Test User";
  const organizationName = input.organizationName?.trim() || "CEOClaw Test Organization";
  const workspaceName = input.workspaceName?.trim() || "Main Workspace";
  const workspaceKey = input.workspaceKey?.trim() || "main";
  const hashedPassword = await hashPassword(input.password, 10);
  const { organization, workspace } = await ensureOrganizationAndWorkspace(
    prisma,
    organizationName,
    workspaceName,
    workspaceKey
  );

  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      password: hashedPassword,
      name: displayName,
      emailVerified: now,
      updatedAt: now,
    },
    create: {
      id: randomUUID(),
      email: input.email,
      password: hashedPassword,
      name: displayName,
      emailVerified: now,
      updatedAt: now,
    },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
    },
  });

  const membership =
    (await prisma.membership.findFirst({
      select: {
        id: true,
        role: true,
        email: true,
        displayName: true,
      },
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
        email: input.email,
        displayName,
        role,
        updatedAt: now,
      },
      select: {
        id: true,
        role: true,
        email: true,
        displayName: true,
      },
    }));

  if (membership.role !== role || membership.email !== input.email || membership.displayName !== displayName) {
    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        email: input.email,
        displayName,
        role,
        updatedAt: now,
      },
    });
  }

  const workspaceMembership = await prisma.workspaceMembership.findFirst({
    select: {
      id: true,
      role: true,
    },
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

  return {
    ...user,
    role,
  };
}
