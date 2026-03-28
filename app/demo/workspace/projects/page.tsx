import { ErrorBoundary } from "@/components/error-boundary";
import { ProjectsPage } from "@/components/projects/projects-page";

export const metadata = {
  title: "Проекты — Demo | CEOClaw",
};

export default function DemoProjectsPage() {
  return (
    <ErrorBoundary resetKey="demo-projects">
      <ProjectsPage initialQuery="" />
    </ErrorBoundary>
  );
}
