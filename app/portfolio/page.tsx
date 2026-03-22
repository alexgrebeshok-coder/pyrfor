import { ErrorBoundary } from "@/components/error-boundary";
import { PortfolioCockpitPage } from "@/components/portfolio/portfolio-cockpit";

export default function PortfolioRoute() {
  return (
    <ErrorBoundary resetKey="portfolio">
      <PortfolioCockpitPage />
    </ErrorBoundary>
  );
}

