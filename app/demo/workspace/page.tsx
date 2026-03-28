import { ErrorBoundary } from "@/components/error-boundary";
import { DashboardHome } from "@/components/dashboard/dashboard-home";

export const metadata = {
  title: "Demo Workspace | CEOClaw",
  description: "CEOClaw demo workspace with realistic project portfolio data.",
};

export default function DemoWorkspacePage() {
  return (
    <ErrorBoundary resetKey="demo-dashboard">
      <DashboardHome />
    </ErrorBoundary>
  );
}
