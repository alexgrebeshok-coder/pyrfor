import { ErrorBoundary } from "@/components/error-boundary";
import { TeamPage } from "@/components/team/team-page";

export const metadata = {
  title: "Команда — Demo | CEOClaw",
};

export default function DemoTeamPage() {
  return (
    <ErrorBoundary resetKey="demo-team">
      <TeamPage />
    </ErrorBoundary>
  );
}
