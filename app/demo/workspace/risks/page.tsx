import { ErrorBoundary } from "@/components/error-boundary";
import { RisksPage } from "@/components/risks/risks-page";

export const metadata = {
  title: "Риски — Demo | CEOClaw",
};

export default function DemoRisksPage() {
  return (
    <ErrorBoundary resetKey="demo-risks">
      <RisksPage />
    </ErrorBoundary>
  );
}
