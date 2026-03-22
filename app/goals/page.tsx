import { ErrorBoundary } from "@/components/error-boundary";
import { GoalsPage } from "@/components/goals/goals-page";

export default function GoalsRoute() {
  return (
    <ErrorBoundary resetKey="goals">
      <GoalsPage />
    </ErrorBoundary>
  );
}
