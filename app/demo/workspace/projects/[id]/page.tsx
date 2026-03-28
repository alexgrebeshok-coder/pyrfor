"use client";

import { useMemo } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { ProjectDetail } from "@/components/projects/project-detail";
import { demoDashboardState } from "@/lib/demo/workspace-data";
import { use } from "react";

export default function DemoProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const projectExists = useMemo(
    () => demoDashboardState.projects.some((p) => p.id === id),
    [id]
  );

  // Fall back to the first demo project if the id is not found
  const projectId = projectExists ? id : (demoDashboardState.projects[0]?.id ?? id);

  return (
    <ErrorBoundary resetKey={`demo-project-${projectId}`}>
      <ProjectDetail projectId={projectId} initialTasks={[]} initialMilestones={[]} />
    </ErrorBoundary>
  );
}
