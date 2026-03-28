import { prisma } from "@/lib/prisma";

export function generateToolEntityId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function resolveActiveProjectId(projectId?: string): Promise<string | null> {
  if (projectId) {
    return projectId;
  }

  const first = await prisma.project.findFirst({
    where: { status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  return first?.id ?? null;
}
