import { randomUUID } from "crypto";

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function ensureOrganizationAndWorkspace() {
  const now = new Date();

  const organization =
    (await prisma.organization.findFirst({
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.organization.create({
      data: {
        id: "preview-demo-org",
        slug: "preview-demo",
        name: "Preview Demo Organization",
        updatedAt: now,
      },
    }));

  const workspace =
    (await prisma.workspace.findFirst({
      where: { organizationId: organization.id },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.workspace.create({
      data: {
        id: "preview-demo-workspace",
        organizationId: organization.id,
        key: "main",
        name: "Main Workspace",
        initials: "HQ",
        isDefault: true,
        updatedAt: now,
      },
    }));

  return { organization, workspace };
}

async function main() {
  const email = process.env.SEED_AUTH_EMAIL?.trim();
  const password = process.env.SEED_AUTH_PASSWORD;
  const name = process.env.SEED_AUTH_NAME?.trim() || "Preview Test User";
  const role = process.env.SEED_AUTH_ROLE?.trim() || "EXEC";

  if (!email || !password) {
    console.log(
      "ℹ️  SEED_AUTH_EMAIL / SEED_AUTH_PASSWORD are not set; skipping preview auth seed."
    );
    return;
  }

  const now = new Date();
  const passwordHash = await bcrypt.hash(password, 10);
  const { organization, workspace } = await ensureOrganizationAndWorkspace();

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      password: passwordHash,
      emailVerified: now,
      updatedAt: now,
    },
    create: {
      id: randomUUID(),
      email,
      name,
      password: passwordHash,
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
        displayName: name,
        role,
        updatedAt: now,
      },
    }));

  if (membership.role !== role || membership.email !== email || membership.displayName !== name) {
    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        email,
        displayName: name,
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

  console.log("✅ Preview auth user is ready:", {
    email,
    name,
    role,
    organization: organization.name,
    workspace: workspace.name,
  });
}

main()
  .catch((error) => {
    console.error("❌ Preview auth seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
