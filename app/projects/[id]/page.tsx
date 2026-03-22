import { ErrorBoundary } from "@/components/error-boundary";
import { ProjectDetail } from "@/components/projects/project-detail";
import { prisma } from "@/lib/prisma";
import { normalizeMilestone, normalizeTask } from "@/lib/client/normalizers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProjectDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [initialTasks, initialMilestones] = await Promise.all([
    prisma.task.findMany({
      where: { projectId: id },
      orderBy: [{ order: "asc" }, { dueDate: "asc" }],
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            initials: true,
            role: true,
            capacity: true,
          },
        },
      },
    }),
    prisma.milestone.findMany({
      where: { projectId: id },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  return (
    <ErrorBoundary resetKey={id}>
      <ProjectDetail
        projectId={id}
        initialTasks={initialTasks.map((task) =>
          normalizeTask({
            ...task,
            description: task.description ?? "",
            dueDate: task.dueDate.toISOString(),
            completedAt: task.completedAt ? task.completedAt.toISOString() : null,
            createdAt: task.createdAt.toISOString(),
            updatedAt: task.updatedAt.toISOString(),
            assignee: task.assignee
              ? {
                  id: task.assignee.id,
                  name: task.assignee.name,
                  initials: task.assignee.initials,
                  role: task.assignee.role,
                  capacity: task.assignee.capacity,
                }
              : null,
          })
        )}
        initialMilestones={initialMilestones.map((milestone) =>
          normalizeMilestone({
            id: milestone.id,
            title: milestone.title,
            date: milestone.date.toISOString(),
            status: milestone.status,
            projectId: milestone.projectId,
          })
        )}
      />
    </ErrorBoundary>
  );
}
