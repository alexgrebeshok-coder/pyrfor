import { ErrorBoundary } from "@/components/error-boundary";
import { TasksPage } from "@/components/tasks/tasks-page";

export const metadata = {
  title: "Задачи — Demo | CEOClaw",
};

export default function DemoTasksPage() {
  return (
    <ErrorBoundary resetKey="demo-tasks">
      {/* initialTasks is empty — the demo hooks supply data via useDemoWorkspaceMode() */}
      <TasksPage initialTasks={[]} />
    </ErrorBoundary>
  );
}
