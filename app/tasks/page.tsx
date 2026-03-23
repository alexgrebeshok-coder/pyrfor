import { ErrorBoundary } from "@/components/error-boundary";
import { TasksPage } from "@/components/tasks/tasks-page";
import { normalizeTask } from "@/lib/client/normalizers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TasksRoute({
  searchParams,
}: {
  searchParams?: Promise<{ projectId?: string; query?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const initialProjectId = resolvedSearchParams?.projectId?.trim() ?? "";
  const initialTasks = await prisma.task.findMany({
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
    });

  return (
    <ErrorBoundary resetKey={resolvedSearchParams?.query ?? "tasks"}>
      <TasksPage
        initialQuery={resolvedSearchParams?.query ?? ""}
        initialProjectId={initialProjectId}
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
      />
    </ErrorBoundary>
  );
}
