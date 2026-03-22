import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(8).regex(/[a-zA-Z]/).regex(/\d/),
});

function buildWorkspaceInitials(name: string) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || "HQ";
}

export async function POST(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { message: "Публичная регистрация отключена. Обратитесь к администратору CEOClaw." },
        { status: 403 }
      );
    }

    const body = await request.json();
    
    // Validate input
    const validationResult = registerSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { message: "Неверные данные", errors: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { name, email, password } = validationResult.data;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "Пользователь с таким email уже существует" },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const emailVerified = new Date();

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          id: randomUUID(),
          name,
          email,
          password: hashedPassword,
          emailVerified,
          updatedAt: new Date(),
        },
      });

      const organization = await tx.organization.create({
        data: {
          id: randomUUID(),
          slug: `org-${createdUser.id.slice(-8)}`,
          name: `${name} Workspace`,
          description: "Provisioned during local signup flow.",
          updatedAt: new Date(),
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          id: randomUUID(),
          organizationId: organization.id,
          key: "MAIN",
          name: "Main Workspace",
          initials: buildWorkspaceInitials(name),
          description: "Default workspace for a newly provisioned account.",
          isDefault: true,
          updatedAt: new Date(),
        },
      });

      const membership = await tx.membership.create({
        data: {
          id: randomUUID(),
          organizationId: organization.id,
          userId: createdUser.id,
          email,
          displayName: name,
          role: "EXEC",
          updatedAt: new Date(),
        },
      });

      await tx.workspaceMembership.create({
        data: {
          id: randomUUID(),
          workspaceId: workspace.id,
          membershipId: membership.id,
          role: "OWNER",
        },
      });

      return createdUser;
    });

    return NextResponse.json(
      {
        message: "Пользователь создан",
        userId: user.id,
        requiresVerification: false,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { message: "Ошибка сервера" },
      { status: 500 }
    );
  }
}
